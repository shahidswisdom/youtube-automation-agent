require('dotenv').config();
const { Logger } = require('../utils/logger');
const { Database } = require('../database/db');
const { CredentialManager } = require('../utils/credential-manager');
const { ContentStrategyAgent } = require('../agents/content-strategy-agent');
const { ScriptWriterAgent } = require('../agents/script-writer-agent');
const { ThumbnailDesignerAgent } = require('../agents/thumbnail-designer-agent');
const { SEOOptimizerAgent } = require('../agents/seo-optimizer-agent');
const { ProductionManagementAgent } = require('../agents/production-management-agent');
const { PublishingSchedulingAgent } = require('../agents/publishing-scheduling-agent');
const { AnalyticsOptimizationAgent } = require('../agents/analytics-optimization-agent');
const { DailyAutomation } = require('../schedules/daily-automation');
const fs = require('fs');
const path = require('path');

const logger = new Logger('CloudRunner');

async function main() {
  logger.info('Cloud Runner started');

  const db = new Database();
  await db.initialize();

  const credentials = new CredentialManager();
  const credentialsValid = await credentials.validateAll();
  if (!credentialsValid) {
    logger.error('Credential validation failed');
    process.exit(1);
  }

  const agents = {
    strategy: new ContentStrategyAgent(db, credentials),
    scriptWriter: new ScriptWriterAgent(db, credentials),
    thumbnailDesigner: new ThumbnailDesignerAgent(db, credentials),
    seoOptimizer: new SEOOptimizerAgent(db, credentials),
    production: new ProductionManagementAgent(db, credentials),
    publishing: new PublishingSchedulingAgent(db, credentials),
    analytics: new AnalyticsOptimizationAgent(db, credentials)
  };

  for (const agent of Object.values(agents)) {
    await agent.initialize();
  }

  const automation = new DailyAutomation(agents, db, { cloudMode: true });

  const dueTasks = await automation.getDueTasks();

  if (dueTasks.length === 0) {
    logger.info('No tasks due at this time');
  } else {
    logger.info(`Running ${dueTasks.length} due task(s)`);
    for (const task of dueTasks) {
      try {
        await automation.runDueTask(task);
      } catch (error) {
        logger.error(`Task ${task.name} failed`, error);
      }
    }
  }

  const lastDbCommit = await db.getSetting('last_db_commit_date');
  const commitDue = !lastDbCommit ||
    Math.floor((Date.now() - new Date(lastDbCommit).getTime()) / (1000 * 60 * 60 * 24)) >= 6;

  if (commitDue) {
    await db.setSetting('last_db_commit_date', new Date().toISOString());
    const markerPath = path.join(__dirname, '..', '.db-commit-needed');
    fs.writeFileSync(markerPath, '', 'utf-8');
    logger.info('DB commit cycle triggered — created marker file');
  }

  await db.close();
  logger.success('Cloud Runner completed');
  process.exit(0);
}

main().catch(error => {
  logger.error('Cloud Runner failed:', error);
  process.exit(1);
});

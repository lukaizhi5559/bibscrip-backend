#!/usr/bin/env ts-node

/**
 * Database Initialization Script
 * Uses migration runner to execute all SQL migrations
 */

import { runMigrations } from './migrate';
import { logger } from '../src/utils/logger';

async function initializeDatabase() {
  try {
    logger.info('🚀 Initializing database using migration runner...');
    
    // Use the migration runner to execute all migrations
    await runMigrations();
    
    logger.info('🎉 Database initialization completed successfully!');
    
  } catch (error) {
    logger.error('❌ Database initialization failed:', { error });
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase()
    .then(() => {
      console.log('✅ Database initialization completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Database initialization failed:', error);
      process.exit(1);
    });
}

export { initializeDatabase };

#!/usr/bin/env ts-node

/**
 * Database Reset Script
 * Drops and recreates all tables for UI-Indexed Agent system
 */

import pool from '../src/config/postgres';
import { logger } from '../src/utils/logger';
import { initializeDatabase } from './db-init';

async function resetDatabase() {
  try {
    logger.info('🔄 Resetting database for UI-Indexed Agent...');

    // Drop tables in reverse dependency order
    const dropTables = [
      'DROP TABLE IF EXISTS action_logs CASCADE;',
      'DROP TABLE IF EXISTS automation_sessions CASCADE;',
      'DROP TABLE IF EXISTS ui_elements CASCADE;'
    ];

    for (const dropQuery of dropTables) {
      await pool.query(dropQuery);
    }
    logger.info('✅ Dropped existing tables');

    // Close the pool before reinitializing
    await pool.end();
    
    // Reinitialize database
    await initializeDatabase();
    
    logger.info('🎉 Database reset completed successfully!');
    
  } catch (error) {
    logger.error('❌ Database reset failed:', { error });
    throw error;
  }
}

// Run if called directly
if (require.main === module) {
  resetDatabase()
    .then(() => {
      console.log('✅ Database reset completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Database reset failed:', error);
      process.exit(1);
    });
}

export { resetDatabase };

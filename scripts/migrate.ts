#!/usr/bin/env ts-node

/**
 * Database Migration Runner
 * Scans and executes all SQL migration files in order
 */

import fs from 'fs';
import path from 'path';
import pool from '../src/config/postgres';
import { logger } from '../src/utils/logger';

interface Migration {
  filename: string;
  filepath: string;
  timestamp: string;
  name: string;
}

async function createMigrationsTable() {
  const createTable = `
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
  `;
  
  await pool.query(createTable);
  logger.info('✅ Migrations tracking table ready');
}

async function getExecutedMigrations(): Promise<string[]> {
  const result = await pool.query('SELECT filename FROM migrations ORDER BY executed_at');
  return result.rows.map(row => row.filename);
}

async function markMigrationAsExecuted(filename: string) {
  await pool.query('INSERT INTO migrations (filename) VALUES ($1)', [filename]);
}

function parseMigrationFilename(filename: string): Migration | null {
  // Support formats: YYYYMMDD_HHMMSS_name.sql or timestamp_name.sql or just name.sql
  const patterns = [
    /^(\d{8}_\d{6})_(.+)\.sql$/,  // 20240101_120000_create_table.sql
    /^(\d+)_(.+)\.sql$/,          // 1234567890_create_table.sql
    /^(.+)\.sql$/                 // create_table.sql (fallback)
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match) {
      const timestamp = match[1] || '0';
      const name = match[2] || match[1];
      
      return {
        filename,
        filepath: '',
        timestamp,
        name
      };
    }
  }
  
  return null;
}

function sortMigrations(migrations: Migration[]): Migration[] {
  return migrations.sort((a, b) => {
    // Sort by timestamp first, then by filename
    if (a.timestamp !== b.timestamp) {
      return a.timestamp.localeCompare(b.timestamp);
    }
    return a.filename.localeCompare(b.filename);
  });
}

async function runMigrations(migrationsDir?: string) {
  try {
    const migrationPath = migrationsDir || path.join(__dirname, '../src/database/migrations');
    
    logger.info(`🚀 Running database migrations from: ${migrationPath}`);
    
    // Ensure migrations tracking table exists
    await createMigrationsTable();
    
    // Get already executed migrations
    const executedMigrations = await getExecutedMigrations();
    logger.info(`📋 Found ${executedMigrations.length} previously executed migrations`);
    
    // Scan migration directory
    if (!fs.existsSync(migrationPath)) {
      logger.warn(`⚠️ Migration directory not found: ${migrationPath}`);
      return;
    }
    
    const files = fs.readdirSync(migrationPath)
      .filter(file => file.endsWith('.sql'))
      .map(filename => {
        const migration = parseMigrationFilename(filename);
        if (migration) {
          migration.filepath = path.join(migrationPath, filename);
          return migration;
        }
        return null;
      })
      .filter(Boolean) as Migration[];
    
    if (files.length === 0) {
      logger.info('📁 No SQL migration files found');
      return;
    }
    
    // Sort migrations by timestamp/name
    const sortedMigrations = sortMigrations(files);
    logger.info(`📂 Found ${sortedMigrations.length} migration files`);
    
    // Execute pending migrations
    let executedCount = 0;
    
    for (const migration of sortedMigrations) {
      if (executedMigrations.includes(migration.filename)) {
        logger.info(`⏭️ Skipping already executed: ${migration.filename}`);
        continue;
      }
      
      logger.info(`🔄 Executing migration: ${migration.filename}`);
      
      try {
        const migrationSQL = fs.readFileSync(migration.filepath, 'utf8');
        
        // Execute the migration in a transaction
        await pool.query('BEGIN');
        await pool.query(migrationSQL);
        await markMigrationAsExecuted(migration.filename);
        await pool.query('COMMIT');
        
        logger.info(`✅ Successfully executed: ${migration.filename}`);
        executedCount++;
        
      } catch (error) {
        await pool.query('ROLLBACK');
        logger.error(`❌ Failed to execute migration: ${migration.filename}`, { error });
        throw error;
      }
    }
    
    if (executedCount === 0) {
      logger.info('✨ All migrations are up to date');
    } else {
      logger.info(`🎉 Successfully executed ${executedCount} new migrations`);
    }
    
  } catch (error) {
    logger.error('❌ Migration failed:', { error });
    throw error;
  } finally {
    await pool.end();
  }
}

// CLI interface
if (require.main === module) {
  const migrationsDir = process.argv[2]; // Optional custom migrations directory
  
  runMigrations(migrationsDir)
    .then(() => {
      console.log('✅ Database migrations completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('❌ Database migrations failed:', error);
      process.exit(1);
    });
}

export { runMigrations };

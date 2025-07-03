// Element Store - PostgreSQL and Redis integration for UI elements
// Handles persistent storage and fast caching of UI element index

import pool from '../config/postgres';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { UIElement } from './uiIndexerDaemon';

export class ElementStore {
  private readonly TABLE_NAME = 'ui_elements';
  private readonly REDIS_KEY_PREFIX = 'uiIndex:';
  private readonly CACHE_TTL = 300; // 5 minutes

  async initialize(): Promise<void> {
    try {
      // Ensure PostgreSQL table exists
      await this.createTableIfNotExists();
      
      // Test Redis connection
      const redis = await getRedisClient();
      await redis.ping();
      
      logger.info('ElementStore initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize ElementStore:', { error });
      throw error;
    }
  }

  private async createTableIfNotExists(): Promise<void> {
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS ${this.TABLE_NAME} (
        id SERIAL PRIMARY KEY,
        app_name VARCHAR(255) NOT NULL,
        window_title VARCHAR(500),
        element_role VARCHAR(100) NOT NULL,
        element_label VARCHAR(500),
        element_value TEXT,
        x INTEGER NOT NULL,
        y INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        accessibility_id VARCHAR(255),
        class_name VARCHAR(255),
        automation_id VARCHAR(255),
        is_enabled BOOLEAN DEFAULT true,
        is_visible BOOLEAN DEFAULT true,
        confidence_score FLOAT DEFAULT 1.0,
        last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_ui_elements_app_window ON ${this.TABLE_NAME}(app_name, window_title);
      CREATE INDEX IF NOT EXISTS idx_ui_elements_role_label ON ${this.TABLE_NAME}(element_role, element_label);
      CREATE INDEX IF NOT EXISTS idx_ui_elements_geometry ON ${this.TABLE_NAME}(x, y, width, height);
      CREATE INDEX IF NOT EXISTS idx_ui_elements_last_seen ON ${this.TABLE_NAME}(last_seen);
    `;

    await pool.query(createTableQuery);
  }

  async storeElements(elements: UIElement[]): Promise<void> {
    if (elements.length === 0) return;

    const client = await pool.connect();
    
    try {
      await client.query('BEGIN');
      
      // Clear existing elements for the same app/window (replace strategy)
      const firstElement = elements[0];
      await client.query(
        `DELETE FROM ${this.TABLE_NAME} WHERE app_name = $1 AND window_title = $2`,
        [firstElement.appName, firstElement.windowTitle]
      );
      
      // Insert new elements
      const insertQuery = `
        INSERT INTO ${this.TABLE_NAME} (
          app_name, window_title, element_role, element_label, element_value,
          x, y, width, height, accessibility_id, class_name, automation_id,
          is_enabled, is_visible, confidence_score, last_seen
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      `;
      
      for (const element of elements) {
        await client.query(insertQuery, [
          element.appName,
          element.windowTitle,
          element.elementRole,
          element.elementLabel,
          element.elementValue || null,
          element.x,
          element.y,
          element.width,
          element.height,
          element.accessibilityId || null,
          element.className || null,
          element.automationId || null,
          element.isEnabled,
          element.isVisible,
          element.confidenceScore,
          element.lastSeen
        ]);
      }
      
      await client.query('COMMIT');
      
      logger.debug(`Stored ${elements.length} UI elements for ${firstElement.appName}/${firstElement.windowTitle}`);
      
    } catch (error) {
      await client.query('ROLLBACK');
      logger.error('Failed to store UI elements:', { error });
      throw error;
    } finally {
      client.release();
    }
  }

  async getElements(appName?: string, windowTitle?: string): Promise<UIElement[]> {
    try {
      let query = `SELECT * FROM ${this.TABLE_NAME} WHERE last_seen > NOW() - INTERVAL '10 minutes'`;
      const params: any[] = [];
      
      if (appName) {
        params.push(appName);
        query += ` AND app_name = $${params.length}`;
      }
      
      if (windowTitle) {
        params.push(windowTitle);
        query += ` AND window_title = $${params.length}`;
      }
      
      query += ` ORDER BY last_seen DESC, confidence_score DESC`;
      
      const result = await pool.query(query, params);
      
      return result.rows.map(row => this.mapRowToUIElement(row));
      
    } catch (error) {
      logger.error('Failed to get UI elements:', { error });
      return [];
    }
  }

  async getElementsByRole(role: string, appName?: string): Promise<UIElement[]> {
    try {
      let query = `
        SELECT * FROM ${this.TABLE_NAME} 
        WHERE element_role = $1 
        AND last_seen > NOW() - INTERVAL '10 minutes'
        AND is_enabled = true 
        AND is_visible = true
      `;
      const params: any[] = [role];
      
      if (appName) {
        params.push(appName);
        query += ` AND app_name = $${params.length}`;
      }
      
      query += ` ORDER BY confidence_score DESC, last_seen DESC`;
      
      const result = await pool.query(query, params);
      
      return result.rows.map(row => this.mapRowToUIElement(row));
      
    } catch (error) {
      logger.error('Failed to get UI elements by role:', { error, role });
      return [];
    }
  }

  async getElementsByLabel(label: string, appName?: string): Promise<UIElement[]> {
    try {
      let query = `
        SELECT * FROM ${this.TABLE_NAME} 
        WHERE element_label ILIKE $1 
        AND last_seen > NOW() - INTERVAL '10 minutes'
        AND is_enabled = true 
        AND is_visible = true
      `;
      const params: any[] = [`%${label}%`];
      
      if (appName) {
        params.push(appName);
        query += ` AND app_name = $${params.length}`;
      }
      
      query += ` ORDER BY confidence_score DESC, last_seen DESC`;
      
      const result = await pool.query(query, params);
      
      return result.rows.map(row => this.mapRowToUIElement(row));
      
    } catch (error) {
      logger.error('Failed to get UI elements by label:', { error, label });
      return [];
    }
  }

  async searchElements(searchTerm: string, appName?: string): Promise<UIElement[]> {
    try {
      let query = `
        SELECT * FROM ${this.TABLE_NAME} 
        WHERE (
          element_label ILIKE $1 
          OR element_value ILIKE $1 
          OR element_role ILIKE $1
        )
        AND last_seen > NOW() - INTERVAL '10 minutes'
        AND is_enabled = true 
        AND is_visible = true
      `;
      const params: any[] = [`%${searchTerm}%`];
      
      if (appName) {
        params.push(appName);
        query += ` AND app_name = $${params.length}`;
      }
      
      query += ` ORDER BY confidence_score DESC, last_seen DESC LIMIT 20`;
      
      const result = await pool.query(query, params);
      
      return result.rows.map(row => this.mapRowToUIElement(row));
      
    } catch (error) {
      logger.error('Failed to search UI elements:', { error, searchTerm });
      return [];
    }
  }

  async getActiveApplications(): Promise<Array<{ appName: string; windowTitle: string; elementCount: number }>> {
    try {
      const query = `
        SELECT 
          app_name, 
          window_title, 
          COUNT(*) as element_count
        FROM ${this.TABLE_NAME} 
        WHERE last_seen > NOW() - INTERVAL '10 minutes'
        GROUP BY app_name, window_title
        ORDER BY element_count DESC, app_name
      `;
      
      const result = await pool.query(query);
      
      return result.rows.map(row => ({
        appName: row.app_name,
        windowTitle: row.window_title,
        elementCount: parseInt(row.element_count)
      }));
      
    } catch (error) {
      logger.error('Failed to get active applications:', { error });
      return [];
    }
  }

  async cleanupStaleElements(): Promise<number> {
    try {
      const result = await pool.query(
        `DELETE FROM ${this.TABLE_NAME} WHERE last_seen < NOW() - INTERVAL '1 hour'`
      );
      
      const deletedCount = result.rowCount || 0;
      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} stale UI elements`);
      }
      
      return deletedCount;
      
    } catch (error) {
      logger.error('Failed to cleanup stale elements:', { error });
      return 0;
    }
  }

  private mapRowToUIElement(row: any): UIElement {
    return {
      id: row.id,
      appName: row.app_name,
      windowTitle: row.window_title,
      elementRole: row.element_role,
      elementLabel: row.element_label,
      elementValue: row.element_value,
      x: row.x,
      y: row.y,
      width: row.width,
      height: row.height,
      accessibilityId: row.accessibility_id,
      className: row.class_name,
      automationId: row.automation_id,
      isEnabled: row.is_enabled,
      isVisible: row.is_visible,
      confidenceScore: row.confidence_score,
      lastSeen: row.last_seen
    };
  }

  // Cache management methods
  async getCachedElements(cacheKey: string): Promise<UIElement[] | null> {
    try {
      const redis = await getRedisClient();
      const cached = await redis.get(`${this.REDIS_KEY_PREFIX}${cacheKey}`);
      
      if (cached) {
        return JSON.parse(cached);
      }
      
      return null;
      
    } catch (error) {
      logger.error('Failed to get cached elements:', { error, cacheKey });
      return null;
    }
  }

  async setCachedElements(cacheKey: string, elements: UIElement[]): Promise<void> {
    try {
      const redis = await getRedisClient();
      await redis.setex(
        `${this.REDIS_KEY_PREFIX}${cacheKey}`,
        this.CACHE_TTL,
        JSON.stringify(elements)
      );
      
    } catch (error) {
      logger.error('Failed to cache elements:', { error, cacheKey });
    }
  }

  async clearCache(pattern?: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      const searchPattern = pattern ? `${this.REDIS_KEY_PREFIX}${pattern}*` : `${this.REDIS_KEY_PREFIX}*`;
      
      const keys = await redis.keys(searchPattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.debug(`Cleared ${keys.length} cached UI element entries`);
      }
      
    } catch (error) {
      logger.error('Failed to clear cache:', { error, pattern });
    }
  }
}

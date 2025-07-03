// Redis Sync - Real-time synchronization and caching for UI elements
// Handles fast lookups and daemon sync logic

import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';
import { UIElement } from './uiIndexerDaemon';

export class RedisSync {
  private readonly CACHE_PREFIX = 'uiIndex:';
  private readonly ACTIVE_APPS_KEY = 'uiIndex:activeApps';
  private readonly SYNC_LOCK_KEY = 'uiIndex:syncLock';
  private readonly DEFAULT_TTL = 300; // 5 minutes
  private readonly LOCK_TTL = 10; // 10 seconds

  async initialize(): Promise<void> {
    try {
      const redis = await getRedisClient();
      await redis.ping();
      logger.info('RedisSync initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize RedisSync:', { error });
      throw error;
    }
  }

  async syncElements(elements: UIElement[]): Promise<void> {
    if (elements.length === 0) return;

    const redis = await getRedisClient();
    
    try {
      // Acquire sync lock to prevent concurrent updates
      const lockAcquired = await this.acquireSyncLock();
      if (!lockAcquired) {
        logger.debug('Sync lock not acquired, skipping Redis sync');
        return;
      }

      const firstElement = elements[0];
      const appKey = this.getAppKey(firstElement.appName, firstElement.windowTitle);
      
      // Store elements for this app/window
      await redis.setex(
        appKey,
        this.DEFAULT_TTL,
        JSON.stringify(elements)
      );

      // Update active applications list
      await this.updateActiveApps(firstElement.appName, firstElement.windowTitle);

      // Create indexed lookups for fast searching
      await this.createSearchIndexes(elements);

      logger.debug(`Synced ${elements.length} elements to Redis for ${firstElement.appName}`);

    } catch (error) {
      logger.error('Failed to sync elements to Redis:', { error });
    } finally {
      await this.releaseSyncLock();
    }
  }

  async getElementsFromCache(appName: string, windowTitle?: string): Promise<UIElement[] | null> {
    try {
      const redis = await getRedisClient();
      const appKey = this.getAppKey(appName, windowTitle || '');
      
      const cached = await redis.get(appKey);
      if (cached) {
        return JSON.parse(cached);
      }
      
      return null;
      
    } catch (error) {
      logger.error('Failed to get elements from cache:', { error, appName, windowTitle });
      return null;
    }
  }

  async searchElementsInCache(searchTerm: string, appName?: string): Promise<UIElement[]> {
    try {
      const redis = await getRedisClient();
      const searchKey = this.getSearchKey('term', searchTerm.toLowerCase());
      
      // Try exact search first
      let cached = await redis.get(searchKey);
      if (cached) {
        const results = JSON.parse(cached) as UIElement[];
        return appName ? results.filter(el => el.appName === appName) : results;
      }

      // Fallback to scanning all active apps
      const activeApps = await this.getActiveApps();
      const allResults: UIElement[] = [];

      for (const app of activeApps) {
        const elements = await this.getElementsFromCache(app.appName, app.windowTitle);
        if (elements) {
          const filtered = elements.filter(el => 
            el.elementLabel.toLowerCase().includes(searchTerm.toLowerCase()) ||
            el.elementValue?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            el.elementRole.toLowerCase().includes(searchTerm.toLowerCase())
          );
          allResults.push(...filtered);
        }
      }

      // Cache the search result
      if (allResults.length > 0) {
        await redis.setex(searchKey, 60, JSON.stringify(allResults)); // 1 minute cache
      }

      return appName ? allResults.filter(el => el.appName === appName) : allResults;
      
    } catch (error) {
      logger.error('Failed to search elements in cache:', { error, searchTerm });
      return [];
    }
  }

  async getElementsByRoleFromCache(role: string, appName?: string): Promise<UIElement[]> {
    try {
      const redis = await getRedisClient();
      const roleKey = this.getSearchKey('role', role);
      
      // Try cached role lookup first
      let cached = await redis.get(roleKey);
      if (cached) {
        const results = JSON.parse(cached) as UIElement[];
        return appName ? results.filter(el => el.appName === appName) : results;
      }

      // Fallback to scanning active apps
      const activeApps = await this.getActiveApps();
      const allResults: UIElement[] = [];

      for (const app of activeApps) {
        const elements = await this.getElementsFromCache(app.appName, app.windowTitle);
        if (elements) {
          const filtered = elements.filter(el => el.elementRole === role);
          allResults.push(...filtered);
        }
      }

      // Cache the role search result
      if (allResults.length > 0) {
        await redis.setex(roleKey, 120, JSON.stringify(allResults)); // 2 minute cache
      }

      return appName ? allResults.filter(el => el.appName === appName) : allResults;
      
    } catch (error) {
      logger.error('Failed to get elements by role from cache:', { error, role });
      return [];
    }
  }

  async getActiveApps(): Promise<Array<{ appName: string; windowTitle: string }>> {
    try {
      const redis = await getRedisClient();
      const cached = await redis.get(this.ACTIVE_APPS_KEY);
      
      if (cached) {
        return JSON.parse(cached);
      }
      
      return [];
      
    } catch (error) {
      logger.error('Failed to get active apps from cache:', { error });
      return [];
    }
  }

  async clearAppCache(appName: string, windowTitle?: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      const appKey = this.getAppKey(appName, windowTitle || '');
      
      await redis.del(appKey);
      
      // Also clear search indexes that might contain this app's elements
      await this.clearSearchIndexes();
      
      logger.debug(`Cleared cache for ${appName}/${windowTitle}`);
      
    } catch (error) {
      logger.error('Failed to clear app cache:', { error, appName, windowTitle });
    }
  }

  async clearAllCache(): Promise<void> {
    try {
      const redis = await getRedisClient();
      const keys = await redis.keys(`${this.CACHE_PREFIX}*`);
      
      if (keys.length > 0) {
        await redis.del(...keys);
        logger.info(`Cleared ${keys.length} UI index cache entries`);
      }
      
    } catch (error) {
      logger.error('Failed to clear all cache:', { error });
    }
  }

  // Health check for Redis connectivity
  async healthCheck(): Promise<{ status: 'healthy' | 'unhealthy'; latency?: number; error?: string }> {
    try {
      const startTime = Date.now();
      const redis = await getRedisClient();
      await redis.ping();
      const latency = Date.now() - startTime;
      
      return { status: 'healthy', latency };
      
    } catch (error) {
      return { 
        status: 'unhealthy', 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  // Private helper methods
  private getAppKey(appName: string, windowTitle: string): string {
    return `${this.CACHE_PREFIX}app:${appName}:${windowTitle}`;
  }

  private getSearchKey(type: string, term: string): string {
    return `${this.CACHE_PREFIX}search:${type}:${term}`;
  }

  private async updateActiveApps(appName: string, windowTitle: string): Promise<void> {
    try {
      const redis = await getRedisClient();
      const activeApps = await this.getActiveApps();
      
      // Add or update the app entry
      const existingIndex = activeApps.findIndex(
        app => app.appName === appName && app.windowTitle === windowTitle
      );
      
      if (existingIndex >= 0) {
        // Update timestamp (move to front)
        activeApps.splice(existingIndex, 1);
      }
      
      activeApps.unshift({ appName, windowTitle });
      
      // Keep only the most recent 20 apps
      const trimmedApps = activeApps.slice(0, 20);
      
      await redis.setex(
        this.ACTIVE_APPS_KEY,
        this.DEFAULT_TTL,
        JSON.stringify(trimmedApps)
      );
      
    } catch (error) {
      logger.error('Failed to update active apps:', { error });
    }
  }

  private async createSearchIndexes(elements: UIElement[]): Promise<void> {
    try {
      const redis = await getRedisClient();
      
      // Group elements by role for fast role-based lookups
      const roleGroups: { [role: string]: UIElement[] } = {};
      
      for (const element of elements) {
        if (!roleGroups[element.elementRole]) {
          roleGroups[element.elementRole] = [];
        }
        roleGroups[element.elementRole].push(element);
      }
      
      // Cache role-based indexes
      for (const [role, roleElements] of Object.entries(roleGroups)) {
        const roleKey = this.getSearchKey('role', role);
        await redis.setex(roleKey, 120, JSON.stringify(roleElements)); // 2 minute cache
      }
      
    } catch (error) {
      logger.error('Failed to create search indexes:', { error });
    }
  }

  private async clearSearchIndexes(): Promise<void> {
    try {
      const redis = await getRedisClient();
      const searchKeys = await redis.keys(`${this.CACHE_PREFIX}search:*`);
      
      if (searchKeys.length > 0) {
        await redis.del(...searchKeys);
      }
      
    } catch (error) {
      logger.error('Failed to clear search indexes:', { error });
    }
  }

  private async acquireSyncLock(): Promise<boolean> {
    try {
      const redis = await getRedisClient();
      const result = await redis.set(this.SYNC_LOCK_KEY, '1', 'EX', this.LOCK_TTL, 'NX');
      return result === 'OK';
      
    } catch (error) {
      logger.error('Failed to acquire sync lock:', { error });
      return false;
    }
  }

  private async releaseSyncLock(): Promise<void> {
    try {
      const redis = await getRedisClient();
      await redis.del(this.SYNC_LOCK_KEY);
      
    } catch (error) {
      logger.error('Failed to release sync lock:', { error });
    }
  }
}

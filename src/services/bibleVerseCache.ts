import { getRedisClient } from '../config/redis';
import { BibleVerse } from '../utils/bible';
import { logger } from '../utils/logger';

/**
 * Service to handle caching of Bible verses to respect API rate limits
 */
export class BibleVerseCache {
  // Cache keys
  private static readonly CACHE_PREFIX = 'bible:verse';
  private static readonly CACHE_TTL = 60 * 60 * 24 * 30; // 30 days in seconds
  
  /**
   * Generate a cache key for a verse reference
   */
  private static getCacheKey(reference: string, translation: string): string {
    return `${BibleVerseCache.CACHE_PREFIX}:${reference.toLowerCase()}:${translation.toUpperCase()}`;
  }
  
  /**
   * Store a Bible verse in cache
   */
  static async store(reference: string, translation: string, verse: BibleVerse): Promise<void> {
    try {
      const redis = await getRedisClient();
      const cacheKey = BibleVerseCache.getCacheKey(reference, translation);
      
      // Store the verse with a long TTL since Bible verses don't change
      await redis.set(cacheKey, JSON.stringify(verse), { EX: BibleVerseCache.CACHE_TTL });
      
      logger.debug('Bible verse cached', { reference, translation });
    } catch (error) {
      logger.error('Error storing Bible verse in cache', { 
        error: error instanceof Error ? error.message : String(error),
        reference,
        translation 
      });
    }
  }
  
  /**
   * Retrieve a Bible verse from cache if it exists
   */
  static async get(reference: string, translation: string): Promise<BibleVerse | null> {
    try {
      const redis = await getRedisClient();
      const cacheKey = BibleVerseCache.getCacheKey(reference, translation);
      
      const cachedVerse = await redis.get(cacheKey);
      
      if (cachedVerse) {
        logger.debug('Bible verse cache hit', { reference, translation });
        return JSON.parse(cachedVerse);
      }
      
      logger.debug('Bible verse cache miss', { reference, translation });
      return null;
    } catch (error) {
      logger.error('Error getting Bible verse from cache', { 
        error: error instanceof Error ? error.message : String(error),
        reference,
        translation 
      });
      return null;
    }
  }
  
  /**
   * Increment the API call counter to track usage
   */
  static async incrementApiCounter(): Promise<number> {
    try {
      const redis = await getRedisClient();
      const counterKey = 'bible:api:daily_counter';
      const timestamp = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const dailyKey = `${counterKey}:${timestamp}`;
      
      // Increment the counter and set 24h expiry if it's new
      const count = await redis.incr(dailyKey);
      if (count === 1) {
        await redis.expire(dailyKey, 60 * 60 * 24); // 24 hours
      }
      
      return count;
    } catch (error) {
      logger.error('Error incrementing Bible API counter', {
        error: error instanceof Error ? error.message : String(error)
      });
      return 0;
    }
  }
  
  /**
   * Check if we've exceeded our daily API call limit
   */
  static async checkRateLimits(): Promise<boolean> {
    try {
      const redis = await getRedisClient();
      const timestamp = new Date().toISOString().split('T')[0];
      const dailyKey = `bible:api:daily_counter:${timestamp}`;
      
      const count = await redis.get(dailyKey);
      const usageCount = count ? parseInt(count, 10) : 0;
      
      // API.Bible allows 5,000 queries per day
      // We'll leave some margin and cap at 4,900
      const isWithinLimits = usageCount < 4900;
      
      if (!isWithinLimits) {
        logger.warn('Bible API daily rate limit reached', { 
          dailyCount: usageCount, 
          limit: 5000 
        });
      }
      
      return isWithinLimits;
    } catch (error) {
      logger.error('Error checking Bible API rate limits', {
        error: error instanceof Error ? error.message : String(error)
      });
      // Default to allowing the request if we can't check
      return true;
    }
  }
}

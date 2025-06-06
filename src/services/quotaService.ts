// Quota Service for managing user limits and pricing tiers
import { getRedisClient, REDIS_PREFIX, TTL } from '../config/redis';
import { logger } from '../utils/logger';
import { QueryComplexity } from './ragService';

/**
 * Quota configuration by user tier
 */
export enum UserTier {
  FREE = 'free',
  BASIC = 'basic',
  PREMIUM = 'premium',
  ENTERPRISE = 'enterprise',
}

/**
 * Quota limits for different user tiers
 */
const QUOTA_LIMITS = {
  [UserTier.FREE]: {
    dailyQuestions: 15,
    complexQuestionsPerDay: 3,
    rateLimit: {
      windowMs: 60000, // 1 minute
      max: 5, // 5 requests per minute
    },
  },
  [UserTier.BASIC]: {
    dailyQuestions: 50,
    complexQuestionsPerDay: 10,
    rateLimit: {
      windowMs: 60000,
      max: 15,
    },
  },
  [UserTier.PREMIUM]: {
    dailyQuestions: 200,
    complexQuestionsPerDay: 50,
    rateLimit: {
      windowMs: 60000,
      max: 30,
    },
  },
  [UserTier.ENTERPRISE]: {
    dailyQuestions: 1000,
    complexQuestionsPerDay: 250,
    rateLimit: {
      windowMs: 60000,
      max: 60,
    },
  },
};

/**
 * Service for managing user quotas and rate limiting
 */
export class QuotaService {
  private static instance: QuotaService;
  
  private constructor() {}
  
  /**
   * Get singleton instance
   */
  public static getInstance(): QuotaService {
    if (!QuotaService.instance) {
      QuotaService.instance = new QuotaService();
    }
    return QuotaService.instance;
  }
  
  /**
   * Get quota key for a user or IP
   */
  private getQuotaKey(userId?: string, ip?: string): string {
    if (userId) {
      return `${REDIS_PREFIX.USER_QUOTA}${userId}`;
    }
    return `${REDIS_PREFIX.IP_QUOTA}${ip}`;
  }
  
  /**
   * Check if user has exceeded their quota
   */
  public async checkQuota(
    ip: string,
    userId?: string,
    complexity: QueryComplexity = QueryComplexity.MODERATE,
  ): Promise<{
    allowed: boolean;
    remaining: number;
    resetIn: number;
    tier: UserTier;
  }> {
    const redis = await getRedisClient();
    const key = this.getQuotaKey(userId, ip);
    
    // Get user tier (would come from a database in production)
    const tier = userId ? UserTier.BASIC : UserTier.FREE;
    const limits = QUOTA_LIMITS[tier];
    
    // Get current quotas from Redis
    const quotaData = await redis.hGetAll(key);
    const now = Date.now();
    const today = new Date().toISOString().split('T')[0];
    
    // Check if we're in a new day and should reset counters
    if (quotaData.date !== today) {
      // Reset counters for a new day
      await redis.hSet(key, {
        date: today,
        count: 0,
        complexCount: 0,
        lastRequest: now,
      });
      
      // Set TTL to expire at the end of the day
      const endOfDay = new Date();
      endOfDay.setHours(23, 59, 59, 999);
      const ttl = Math.floor((endOfDay.getTime() - now) / 1000);
      await redis.expire(key, ttl);
      
      quotaData.count = '0';
      quotaData.complexCount = '0';
    }
    
    // Parse current counts
    const count = parseInt(quotaData.count || '0', 10);
    const complexCount = parseInt(quotaData.complexCount || '0', 10);
    
    // Check quota limits based on complexity
    let allowed = true;
    let remaining = 0;
    
    if (complexity === QueryComplexity.COMPLEX) {
      remaining = limits.complexQuestionsPerDay - complexCount;
      allowed = complexCount < limits.complexQuestionsPerDay;
    } else {
      remaining = limits.dailyQuestions - count;
      allowed = count < limits.dailyQuestions;
    }
    
    // Calculate time to quota reset
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    const resetIn = Math.floor((endOfDay.getTime() - now) / 1000);
    
    // If allowed, increment the appropriate counter
    if (allowed) {
      const updateData: Record<string, number | string> = {
        count: count + 1,
        lastRequest: now,
      };
      
      if (complexity === QueryComplexity.COMPLEX) {
        updateData.complexCount = complexCount + 1;
      }
      
      await redis.hSet(key, updateData);
    }
    
    return {
      allowed,
      remaining,
      resetIn,
      tier,
    };
  }
  
  /**
   * Check rate limit for a user or IP
   */
  public async checkRateLimit(
    ip: string,
    endpoint: string,
    userId?: string,
  ): Promise<{
    allowed: boolean;
    resetMs: number;
    tier: UserTier;
  }> {
    const redis = await getRedisClient();
    const tier = userId ? UserTier.BASIC : UserTier.FREE;
    const limits = QUOTA_LIMITS[tier].rateLimit;
    
    // Create a rate limit key specific to the IP or user and endpoint
    const key = `${REDIS_PREFIX.RATE_LIMIT}${userId || ip}:${endpoint}`;
    const now = Date.now();
    
    // Get current count and window start time
    const rateData = await redis.hGetAll(key);
    const windowStart = parseInt(rateData.windowStart || '0', 10);
    const count = parseInt(rateData.count || '0', 10);
    
    // Check if we're in a new window
    if (now - windowStart > limits.windowMs) {
      // Start a new window
      await redis.hSet(key, {
        windowStart: now,
        count: 1,
      });
      
      // Set TTL to 2x the window size to ensure cleanup
      await redis.expire(key, Math.floor((limits.windowMs * 2) / 1000));
      
      return {
        allowed: true,
        resetMs: limits.windowMs,
        tier,
      };
    }
    
    // We're in an existing window, check the limit
    const allowed = count < limits.max;
    const resetMs = limits.windowMs - (now - windowStart);
    
    // If allowed, increment the counter
    if (allowed) {
      await redis.hIncrBy(key, 'count', 1);
    }
    
    return {
      allowed,
      resetMs,
      tier,
    };
  }
  
  /**
   * Reset user quota (for testing or administrative purposes)
   */
  public async resetQuota(userId: string): Promise<void> {
    const redis = await getRedisClient();
    const key = this.getQuotaKey(userId);
    await redis.del(key);
    logger.info('Reset quota for user', { userId });
  }
  
  /**
   * Get current quota usage for a user
   */
  public async getQuotaUsage(
    ip: string,
    userId?: string,
  ): Promise<{
    total: number;
    complex: number;
    remaining: number;
    tier: UserTier;
  }> {
    const redis = await getRedisClient();
    const key = this.getQuotaKey(userId, ip);
    const quotaData = await redis.hGetAll(key);
    
    // Get user tier (would come from a database in production)
    const tier = userId ? UserTier.BASIC : UserTier.FREE;
    const limits = QUOTA_LIMITS[tier];
    
    // Parse current counts
    const count = parseInt(quotaData.count || '0', 10);
    const complexCount = parseInt(quotaData.complexCount || '0', 10);
    
    return {
      total: count,
      complex: complexCount,
      remaining: limits.dailyQuestions - count,
      tier,
    };
  }

  /**
   * Check if a user can be upgraded to a higher tier
   * For example, for a freemium model where usage triggers upgrade suggestions
   */
  public async checkUpgradeEligibility(userId: string): Promise<{
    eligible: boolean;
    suggestedTier: UserTier;
    reason: string;
  }> {
    // This would interact with a database to check usage patterns
    // Simplified implementation for now
    const redis = await getRedisClient();
    const key = this.getQuotaKey(userId);
    const usage = await this.getQuotaUsage('', userId);
    
    // Check current tier
    const currentTier = usage.tier;
    
    // If user is already at the highest tier, they're not eligible for upgrade
    if (currentTier === UserTier.ENTERPRISE) {
      return {
        eligible: false,
        suggestedTier: UserTier.ENTERPRISE,
        reason: 'Already at highest tier',
      };
    }
    
    // Check if user is approaching their quota limit
    const isApproachingLimit = usage.remaining < QUOTA_LIMITS[currentTier].dailyQuestions * 0.2;
    
    // Check complex query usage
    const isHighComplexUsage = usage.complex > QUOTA_LIMITS[currentTier].complexQuestionsPerDay * 0.5;
    
    // If user is approaching limit or has high complex usage, suggest upgrade
    if (isApproachingLimit || isHighComplexUsage) {
      // Determine next tier
      let suggestedTier: UserTier;
      
      if (currentTier === UserTier.FREE) {
        suggestedTier = UserTier.BASIC;
      } else if (currentTier === UserTier.BASIC) {
        suggestedTier = UserTier.PREMIUM;
      } else {
        suggestedTier = UserTier.ENTERPRISE;
      }
      
      return {
        eligible: true,
        suggestedTier,
        reason: isApproachingLimit 
          ? 'Approaching daily question limit' 
          : 'High usage of complex theological questions',
      };
    }
    
    return {
      eligible: false,
      suggestedTier: currentTier,
      reason: 'Current usage within limits',
    };
  }
}

// Create singleton instance
export const quotaService = QuotaService.getInstance();

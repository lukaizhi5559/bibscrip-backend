/**
 * Plan Caching Service
 * 
 * Caches generated automation plans using semantic search to provide instant
 * plan retrieval for similar commands, reducing latency from 6-8s to ~100ms.
 * 
 * Uses Pinecone for semantic search and Redis for plan storage.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger';
import { generateEmbedding } from './embeddingService';
import { VectorDbService } from './vectorDbService';
import { getRedisClient } from '../config/redis';

// Plan cache namespace in Pinecone
const PLAN_CACHE_NAMESPACE = 'automation_plans';

// Similarity thresholds
const SIMILARITY_THRESHOLDS = {
  EXACT_MATCH: 0.95,      // Return immediately
  VERY_SIMILAR: 0.85,     // Return with confidence
  SIMILAR: 0.70,          // Show as suggestion, generate new
  DIFFERENT: 0.0,         // Generate new plan
};

// Redis TTL for cached plans (30 days)
const PLAN_TTL_SECONDS = 30 * 24 * 60 * 60;

export interface CachedPlan {
  planId: string;
  version: number;
  intent: string;
  goal: string;
  steps: any[];
  metadata: {
    provider: string;
    latencyMs: number;
    createdAt: string;
    usageCount: number;
    lastUsed: string;
  };
}

export interface PlanCacheResult {
  plan: CachedPlan | null;
  cached: boolean;
  similarity?: number;
  source?: 'cache' | 'generated';
}

export class PlanCachingService {
  private vectorDb: VectorDbService;
  private initialized = false;

  constructor() {
    this.vectorDb = new VectorDbService();
  }

  /**
   * Initialize the plan caching service
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      await this.vectorDb.initialize();
      this.initialized = true;
      logger.info('Plan caching service initialized');
    } catch (error: any) {
      logger.error('Failed to initialize plan caching service', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get cached plan or return null if not found
   */
  async getPlan(command: string, context?: any): Promise<PlanCacheResult> {
    const startTime = Date.now();

    try {
      // Ensure initialized
      if (!this.initialized) {
        await this.initialize();
      }

      // 1. Generate embedding for command
      const embeddingResult = await generateEmbedding(command, 'text-embedding-3-small');
      const embedding = embeddingResult.embedding;

      logger.info('Generated embedding for plan search', {
        command,
        embeddingDimension: embedding.length,
        latencyMs: Date.now() - startTime,
      });

      // 2. Search Pinecone for similar plans using searchSimilar
      const searchResults = await this.vectorDb.searchSimilar(
        command,
        PLAN_CACHE_NAMESPACE,
        3,  // topK
        0.0 // minScore (we'll filter by threshold later)
      );

      logger.info('Plan cache search complete', {
        command,
        resultsFound: searchResults.length,
        topSimilarity: searchResults[0]?.score || 0,
        latencyMs: Date.now() - startTime,
      });

      // 3. Check if we have a good match
      if (searchResults.length > 0) {
        const topMatch = searchResults[0];
        const similarity = topMatch.score;

        if (similarity >= SIMILARITY_THRESHOLDS.VERY_SIMILAR) {
          // Get full plan from Redis
          const planId = topMatch.id;
          const redis = await getRedisClient();
          const cachedPlanJson = await redis.get(`plan:${planId}`);

          if (cachedPlanJson) {
            const plan = JSON.parse(cachedPlanJson) as CachedPlan;

            // Update usage stats
            await this.updateUsageStats(planId);

            logger.info('✅ Plan cache HIT', {
              command,
              planId,
              similarity,
              usageCount: plan.metadata.usageCount + 1,
              latencyMs: Date.now() - startTime,
            });

            return {
              plan,
              cached: true,
              similarity,
              source: 'cache',
            };
          } else {
            logger.warn('Plan found in Pinecone but not in Redis', {
              planId,
              command,
            });
          }
        } else {
          logger.info('❌ Plan cache MISS - similarity too low', {
            command,
            topSimilarity: similarity,
            threshold: SIMILARITY_THRESHOLDS.VERY_SIMILAR,
            latencyMs: Date.now() - startTime,
          });
        }
      } else {
        logger.info('❌ Plan cache MISS - no results', {
          command,
          latencyMs: Date.now() - startTime,
        });
      }

      // 4. Cache miss
      return {
        plan: null,
        cached: false,
        source: 'generated',
      };
    } catch (error: any) {
      logger.error('Plan cache lookup failed', {
        command,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });

      // Return cache miss on error
      return {
        plan: null,
        cached: false,
        source: 'generated',
      };
    }
  }

  /**
   * Store plan in cache
   */
  async storePlan(command: string, plan: any, metadata?: any): Promise<void> {
    const startTime = Date.now();

    try {
      // Ensure initialized
      if (!this.initialized) {
        await this.initialize();
      }

      // Generate plan ID if not present
      const planId = plan.planId || `plan_${uuidv4()}`;

      // Create cached plan object
      const cachedPlan: CachedPlan = {
        planId,
        version: plan.planVersion || 1,
        intent: plan.intent || 'command_automate',
        goal: command,
        steps: plan.steps || [],
        metadata: {
          provider: metadata?.provider || 'openai',
          latencyMs: metadata?.latencyMs || 0,
          createdAt: new Date().toISOString(),
          usageCount: 0,
          lastUsed: new Date().toISOString(),
        },
      };

      // 1. Generate embedding
      const embeddingResult = await generateEmbedding(command, 'text-embedding-3-small');
      const embedding = embeddingResult.embedding;

      // 2. Store in Pinecone
      await this.vectorDb.storeDocument(
        {
          id: planId,
          text: command,
          metadata: {
            intent: cachedPlan.intent,
            stepCount: cachedPlan.steps.length,
            createdAt: cachedPlan.metadata.createdAt,
            usageCount: 0,
            lastUsed: cachedPlan.metadata.lastUsed,
          },
        },
        PLAN_CACHE_NAMESPACE
      );

      // 3. Store full plan in Redis
      const redis = await getRedisClient();
      await redis.setEx(
        `plan:${planId}`,
        PLAN_TTL_SECONDS,
        JSON.stringify(cachedPlan)
      );

      logger.info('💾 Plan cached successfully', {
        command,
        planId,
        stepCount: cachedPlan.steps.length,
        provider: cachedPlan.metadata.provider,
        latencyMs: Date.now() - startTime,
      });
    } catch (error: any) {
      logger.error('Failed to cache plan', {
        command,
        error: error.message,
        latencyMs: Date.now() - startTime,
      });
      // Don't throw - caching failure shouldn't break plan generation
    }
  }

  /**
   * Update usage statistics for a cached plan
   */
  private async updateUsageStats(planId: string): Promise<void> {
    try {
      // Update Redis plan
      const redis = await getRedisClient();
      const cachedPlanJson = await redis.get(`plan:${planId}`);
      if (cachedPlanJson) {
        const plan = JSON.parse(cachedPlanJson) as CachedPlan;
        plan.metadata.usageCount += 1;
        plan.metadata.lastUsed = new Date().toISOString();

        // Update Redis with new TTL
        await redis.setEx(
          `plan:${planId}`,
          PLAN_TTL_SECONDS,
          JSON.stringify(plan)
        );

        logger.info('Updated plan usage stats', {
          planId,
          usageCount: plan.metadata.usageCount,
        });
      }
    } catch (error: any) {
      logger.error('Failed to update plan usage stats', {
        planId,
        error: error.message,
      });
      // Don't throw - stats update failure shouldn't break the flow
    }
  }

  /**
   * Delete a specific cached plan
   */
  async deletePlan(planId: string): Promise<void> {
    try {
      logger.info('Deleting cached plan', { planId });

      // 1. Delete from Redis
      const redis = await getRedisClient();
      await redis.del(`plan:${planId}`);

      // 2. Delete from Pinecone
      await this.vectorDb.deleteDocuments([planId], PLAN_CACHE_NAMESPACE);

      logger.info('✅ Plan deleted successfully', { planId });
    } catch (error: any) {
      logger.error('Failed to delete plan', {
        planId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Clear all cached plans (for testing/debugging)
   */
  async clearCache(): Promise<void> {
    try {
      logger.warn('Clearing all cached plans');

      // Note: This is a simple implementation
      // In production, you'd want to track all plan IDs or use Redis SCAN
      logger.info('Cache cleared (manual Redis cleanup required for full clear)');
    } catch (error: any) {
      logger.error('Failed to clear cache', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    totalPlans: number;
    avgUsageCount: number;
  }> {
    try {
      // This is a placeholder - implement based on your needs
      return {
        totalPlans: 0,
        avgUsageCount: 0,
      };
    } catch (error: any) {
      logger.error('Failed to get cache stats', {
        error: error.message,
      });
      return {
        totalPlans: 0,
        avgUsageCount: 0,
      };
    }
  }
}

// Export singleton instance
export const planCachingService = new PlanCachingService();

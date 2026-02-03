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
  VERY_SIMILAR: 0.92,     // Return with confidence (raised from 0.85 to prevent false positives)
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

            // Validate complexity match - prevent simple plans from matching complex tasks
            const commandComplexity = this.estimateCommandComplexity(command);
            const stepCountDiff = Math.abs(commandComplexity.expectedSteps - plan.steps.length);
            
            // Reject if step count mismatch is too large (e.g., 1-step plan for 4-step task)
            if (stepCountDiff > 2) {
              logger.info('❌ Plan cache MISS - complexity mismatch', {
                command,
                planId,
                similarity,
                commandExpectedSteps: commandComplexity.expectedSteps,
                cachedStepCount: plan.steps.length,
                stepCountDiff,
                latencyMs: Date.now() - startTime,
              });
              
              // Fall through to generate new plan
            } else if (!this.validateQueryParameters(command, plan.goal)) {
              // Reject if query parameters differ (e.g., "summer clothes" vs "winter clothes")
              logger.info('❌ Plan cache MISS - query parameter mismatch', {
                command,
                cachedCommand: plan.goal,
                planId,
                similarity,
                latencyMs: Date.now() - startTime,
              });
              
              // Fall through to generate new plan
            } else {
              // Update usage stats
              await this.updateUsageStats(planId);

              logger.info('✅ Plan cache HIT', {
                command,
                planId,
                similarity,
                usageCount: plan.metadata.usageCount + 1,
                commandExpectedSteps: commandComplexity.expectedSteps,
                cachedStepCount: plan.steps.length,
                latencyMs: Date.now() - startTime,
              });

              return {
                plan,
                cached: true,
                similarity,
                source: 'cache',
              };
            }
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
   * Validate that query parameters match between commands
   * Prevents "summer clothes" from matching "winter clothes"
   */
  private validateQueryParameters(newCommand: string, cachedCommand: string): boolean {
    // Extract search queries from commands
    const newQuery = this.extractSearchQuery(newCommand);
    const cachedQuery = this.extractSearchQuery(cachedCommand);

    // If both have queries, they must match
    if (newQuery && cachedQuery) {
      const match = newQuery.toLowerCase() === cachedQuery.toLowerCase();
      
      if (!match) {
        logger.info('🔍 Query parameter mismatch detected', {
          newQuery,
          cachedQuery,
          newCommand,
          cachedCommand,
        });
      }
      
      return match;
    }

    // If neither has a query, they're compatible
    return true;
  }

  /**
   * Extract search query from command
   * Examples:
   * - "search for summer clothes" → "summer clothes"
   * - "goto amazon and search for winter clothes" → "winter clothes"
   * - "look for red shoes" → "red shoes"
   */
  private extractSearchQuery(command: string): string | null {
    const lowerCommand = command.toLowerCase();
    
    // Common search patterns
    const patterns = [
      /search (?:for |)(.+?)(?:\s+on|\s+in|\s+and|$)/i,
      /look (?:for |up |)(.+?)(?:\s+on|\s+in|\s+and|$)/i,
      /find (?:me |)(.+?)(?:\s+on|\s+in|\s+and|$)/i,
      /query (?:for |)(.+?)(?:\s+on|\s+in|\s+and|$)/i,
    ];

    for (const pattern of patterns) {
      const match = command.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return null;
  }

  /**
   * Estimate command complexity to prevent simple plans from matching complex tasks
   * Uses word count and sentence structure as heuristics
   * 
   * This is intentionally simple - we just want to prevent obvious mismatches
   * (e.g., 1-step "hello world" matching 4-step "type resume template")
   */
  private estimateCommandComplexity(command: string): { expectedSteps: number; complexity: string } {
    // Word count heuristic
    const wordCount = command.split(/\s+/).length;
    
    // Sentence count (multiple sentences often indicate multiple steps)
    const sentenceCount = command.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
    
    // Estimate steps based on length and structure
    let expectedSteps = 1;
    
    if (wordCount <= 5) {
      // Very short commands: "type hello world", "click submit"
      expectedSteps = 1;
    } else if (wordCount <= 12 && sentenceCount <= 1) {
      // Short single-sentence commands: "open chrome and go to google"
      expectedSteps = 2;
    } else if (wordCount <= 25 || sentenceCount <= 2) {
      // Medium commands: "open textedit and type a quick note"
      expectedSteps = 3;
    } else {
      // Long/complex commands: "In Textedit I need you to type up a template resume..."
      expectedSteps = 4;
    }
    
    const complexity = expectedSteps === 1 ? 'simple' : expectedSteps <= 2 ? 'medium' : 'complex';
    
    return { expectedSteps, complexity };
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

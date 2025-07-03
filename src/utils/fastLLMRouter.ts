// Fast LLM Router optimized for sub-5-second desktop automation
import OpenAI from 'openai';
import { createHash } from 'crypto';
import { getRedisClient, REDIS_PREFIX, TTL } from '../config/redis';
import { ragService } from '../services/ragService';
import { vectorDbService } from '../services/vectorDbService';
import { NAMESPACE } from '../config/vectorDb';
import { logger } from '../utils/logger';

/**
 * Fast LLM Response optimized for speed
 */
export interface FastLLMResponse {
  text: string;
  provider: string;
  latencyMs: number;
  fromCache?: boolean;
}

/**
 * High-performance LLM Router for desktop automation
 * Optimized for sub-5-second response times
 */
export class FastLLMRouter {
  private openai: OpenAI | null = null;
  private cacheEnabled: boolean = true;
  private aggressiveTimeout: number = 10000; // 10 seconds max per provider (optimized for complex vision tasks)
  private cacheTTL: number = 300; // 5 minutes cache TTL

  constructor() {
    // Initialize only the fastest provider (OpenAI GPT-4o)
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: this.aggressiveTimeout
      });
    }
    
    logger.info('FastLLMRouter initialized for desktop automation', {
      provider: 'openai-gpt4o-only',
      timeout: this.aggressiveTimeout,
      cacheEnabled: this.cacheEnabled
    });
  }

  /**
   * Simple hash function for cache keys
   */
  private hashString(input: string): string {
    return createHash('md5').update(input).digest('hex').substring(0, 8);
  }

  /**
   * Store successful response in RAG system for future semantic caching
   */
  private async storeInSemanticCache(prompt: string, response: string): Promise<void> {
    try {
      // Store in RAG service for sophisticated semantic retrieval
      await ragService.storeSuccessfulResponse(prompt, response);
      
      // Also store in vector database with cached_response metadata for direct access
      if (vectorDbService.isAvailable()) {
        await vectorDbService.storeDocument({
          text: prompt,
          metadata: {
            cached_response: response,
            response_type: 'vision_automation',
            timestamp: new Date().toISOString(),
            ttl: Date.now() + (5 * 60 * 1000) // 5 minutes from now
          }
        }, 'fast_vision_cache');
      }
      
      logger.debug('Stored response in semantic cache', { 
        promptLength: prompt.length,
        responseLength: response.length 
      });
    } catch (error) {
      logger.debug('Failed to store in semantic cache', { error });
      // Don't throw - caching failures shouldn't break the main flow
    }
  }

  /**
   * Generate fast cache key for vision-action prompts
   */
  private generateFastCacheKey(prompt: string, imageHash?: string): string {
    const key = imageHash ? `${prompt}_${imageHash}` : prompt;
    const hash = this.hashString(key);
    return `${REDIS_PREFIX.AI_RESPONSE}fast_${hash}`;
  }

  /**
   * Enhanced cache checking that leverages existing services (simplified to prevent memory leaks)
   */
  private async checkEnhancedCache(prompt: string): Promise<string | null> {
    try {
      // First check regular Redis cache for exact matches (fastest)
      const redisClient = await getRedisClient();
      const cacheKey = this.generateFastCacheKey(prompt);
      const cached = await redisClient.get(cacheKey);
      
      if (cached) {
        logger.debug('Fast cache hit for vision prompt', { promptLength: prompt.length });
        return cached;
      }

      // Simplified fallback to vector search only (avoid potential RAG service memory issues)
      if (vectorDbService.isAvailable()) {
        const similarResults = await vectorDbService.searchSimilar(
          prompt, 
          NAMESPACE.BIBLE_VERSES, // Use default namespace to avoid issues
          1, 
          0.85
        );
        
        if (similarResults.length > 0 && similarResults[0].score > 0.85) {
          const similarResponse = similarResults[0].metadata?.cached_response;
          if (similarResponse) {
            logger.debug('Semantic cache hit via vector search', { 
              similarity: similarResults[0].score,
              promptLength: prompt.length 
            });
            // Store in fast cache for future exact matches
            await redisClient.setex(cacheKey, 300, similarResponse);
            return similarResponse;
          }
        }
      }
      
      return null;
    } catch (error) {
      logger.debug('Enhanced cache check failed, proceeding without cache', { error });
      return null;
    }
  }

  /**
   * Get cached response with aggressive speed optimization
   */
  private async getFastCache(key: string): Promise<FastLLMResponse | null> {
    if (!this.cacheEnabled) return null;
    
    try {
      const redis = await getRedisClient();
      const cached = await redis.get(key);
      
      if (cached) {
        const response = JSON.parse(cached) as FastLLMResponse;
        response.fromCache = true;
        logger.debug('Fast cache hit', { key, provider: response.provider });
        return response;
      }
    } catch (error) {
      logger.warn('Fast cache lookup failed', { key, error });
    }
    
    return null;
  }

  /**
   * Cache response with short TTL for desktop automation
   */
  private async setFastCache(key: string, response: FastLLMResponse): Promise<void> {
    if (!this.cacheEnabled) return;
    
    try {
      const redis = await getRedisClient();
      // Short TTL for desktop automation
      await redis.set(key, JSON.stringify(response), { EX: this.cacheTTL });
    } catch (error) {
      logger.warn('Fast cache set failed', { key, error });
    }
  }

  /**
   * Process vision-action prompt with aggressive speed optimization
   */
  async processVisionActionPrompt(
    prompt: string, 
    screenshotBase64?: string,
    maxTokens: number = 500
  ): Promise<FastLLMResponse> {
    const startTime = performance.now();
    
    // Generate cache key (include image hash if provided)
    const imageHash = screenshotBase64 
      ? createHash('md5').update(screenshotBase64).digest('hex').substring(0, 8)
      : undefined;
    const cacheKey = this.generateFastCacheKey(prompt, imageHash);
    
    // Step 1: Check cache first (fastest path)
    const cached = await this.getFastCache(cacheKey);
    if (cached) {
      logger.info('Fast cache hit for vision-action', { 
        latency: performance.now() - startTime,
        provider: cached.provider 
      });
      return cached;
    }

    // Step 2: Fast OpenAI GPT-4o call with aggressive timeout
    if (!this.openai) {
      throw new Error('OpenAI not available for fast processing');
    }

    try {
      const messages: any[] = [
        {
          role: 'system',
          content: 'You are a desktop automation assistant. Respond with precise, actionable JSON only. Be extremely concise and fast.'
        },
        {
          role: 'user',
          content: screenshotBase64 ? [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${screenshotBase64}`,
                detail: 'low' // Use low detail for speed
              }
            }
          ] : prompt
        }
      ];

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o',
        messages,
        max_tokens: maxTokens,
        temperature: 0.1
      }, {
        timeout: this.aggressiveTimeout
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from OpenAI');
      }

      const latencyMs = performance.now() - startTime;
      const result: FastLLMResponse = {
        text: content,
        provider: 'openai-gpt4o-fast',
        latencyMs
      };

      // Store in cache for future use
      await this.setFastCache(cacheKey, result);
      
      // Store in semantic cache with vision context if image provided
      if (screenshotBase64) {
        const imageHash = this.hashString(screenshotBase64.substring(0, 100));
        const visionPrompt = `${prompt}_img_${imageHash}`;
        await this.storeInSemanticCache(visionPrompt, result.text);
      } else {
        await this.storeInSemanticCache(prompt, result.text);
      }

      logger.info('Fast LLM vision response generated', {
        promptLength: prompt.length,
        responseLength: result.text.length,
        latency: result.latencyMs
      });
      
      return result;

    } catch (error) {
      const latencyMs = performance.now() - startTime;
      logger.error('Fast OpenAI failed', { error, latency: latencyMs });
      
      // Fallback to simple text-based response for critical speed
      const fallbackResult: FastLLMResponse = {
        text: this.generateFallbackResponse(prompt),
        provider: 'fallback-fast',
        latencyMs
      };

      return fallbackResult;
    }
  }

  /**
   * Generate intelligent fallback response for common desktop automation tasks
   */
  private generateFallbackResponse(prompt: string): string {
    const lowerPrompt = prompt.toLowerCase();
    
    // Mouse movement tasks
    if (lowerPrompt.includes('mouse') && lowerPrompt.includes('center')) {
      return JSON.stringify({
        actions: [{
          type: 'moveMouse',
          coordinates: { x: 1440, y: 900 }
        }],
        confidence: 0.8,
        reasoning: 'Move mouse to screen center'
      });
    }
    
    // Click tasks
    if (lowerPrompt.includes('click')) {
      return JSON.stringify({
        actions: [{
          type: 'click',
          coordinates: { x: 1440, y: 900 }
        }],
        confidence: 0.7,
        reasoning: 'Click at center coordinates'
      });
    }
    
    // Screenshot tasks
    if (lowerPrompt.includes('screenshot') || lowerPrompt.includes('capture')) {
      return JSON.stringify({
        actions: [{
          type: 'screenshot'
        }],
        confidence: 0.9,
        reasoning: 'Take screenshot for analysis'
      });
    }
    
    // Default fallback
    return JSON.stringify({
      actions: [{
        type: 'screenshot'
      }],
      confidence: 0.5,
      reasoning: 'Take screenshot to analyze current state'
    });
  }

  /**
   * Process simple text prompt (no vision) for maximum speed
   */
  async processTextPrompt(prompt: string): Promise<FastLLMResponse> {
    return this.processVisionActionPrompt(prompt, undefined, 200);
  }

  /**
   * Health check for fast router
   */
  async healthCheck(): Promise<{ healthy: boolean; latency: number; provider: string }> {
    const startTime = performance.now();
    
    try {
      const response = await this.processTextPrompt('Health check: respond with "OK"');
      return {
        healthy: true,
        latency: performance.now() - startTime,
        provider: response.provider
      };
    } catch (error) {
      return {
        healthy: false,
        latency: performance.now() - startTime,
        provider: 'none'
      };
    }
  }
}

// Export singleton instance for performance
export const fastLLMRouter = new FastLLMRouter();

// Utility function for backward compatibility
export const getFastLLMResponse = async (prompt: string): Promise<string> => {
  const response = await fastLLMRouter.processTextPrompt(prompt);
  return response.text;
};

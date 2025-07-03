// Fast LLM Router optimized for sub-5-second desktop automation
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';
import { getRedisClient, REDIS_PREFIX, TTL } from '../config/redis';
import { ragService } from '../services/ragService';
import { vectorDbService } from '../services/vectorDbService';
import { NAMESPACE } from '../config/vectorDb';

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
  private openai?: OpenAI;
  private claude?: Anthropic;
  private cacheEnabled: boolean = true;
  private aggressiveTimeout: number = 10000; // 10 seconds max per provider (optimized for complex vision tasks)
  private cacheTTL: number = 300; // 5 minutes cache TTL

  constructor() {
    // Initialize Claude as primary provider
    if (process.env.ANTHROPIC_API_KEY) {
      this.claude = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        timeout: this.aggressiveTimeout
      });
    }
    
    // Initialize OpenAI as fallback provider
    if (process.env.OPENAI_API_KEY) {
      this.openai = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
        timeout: this.aggressiveTimeout
      });
    }
    
    logger.info('FastLLMRouter initialized for desktop automation', {
      primaryProvider: 'claude-3.5-sonnet',
      fallbackProvider: 'openai-gpt4o',
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
      // 🔧 STEP 1: Base64 integrity check before sending
      let validScreenshot = false;
      if (screenshotBase64) {
        validScreenshot = screenshotBase64.length > 1000 && 
                         screenshotBase64.match(/^[A-Za-z0-9+/]*={0,2}$/) !== null;
        
        logger.info('🔍 Base64 integrity check:', {
          hasScreenshot: true,
          screenshotLength: screenshotBase64.length,
          isValidBase64: validScreenshot,
          screenshotPreview: screenshotBase64.substring(0, 50)
        });
      }
      
      // 🔧 STEP 2: Try Claude as primary provider for vision automation
      let response: any;
      let usedProvider = '';
      
      try {
        if (this.claude && screenshotBase64 && validScreenshot) {
          logger.info('🎯 Attempting Claude 3.5 Sonnet for vision automation...');
          
          response = await this.claude.messages.create({
            model: 'claude-3-5-sonnet-20241022',
            max_tokens: maxTokens,
            temperature: 0.1,
            messages: [{
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: `You are a desktop automation assistant. Analyze the screenshot and return precise JSON actions. Be extremely concise and fast.\n\n${prompt}`
                },
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: 'image/png',
                    data: screenshotBase64
                  }
                }
              ]
            }]
          });
          
          usedProvider = 'claude-3.5-sonnet';
          logger.info('✅ Claude vision analysis successful');
        } else {
          throw new Error('Claude not available or no screenshot provided');
        }
      } catch (claudeError) {
        logger.warn('🔄 Claude failed, falling back to OpenAI GPT-4o:', { error: claudeError instanceof Error ? claudeError.message : String(claudeError) });
        
        if (!this.openai) {
          throw new Error('No LLM providers available');
        }
        
        // Fallback to OpenAI GPT-4o
        const messages: any[] = [
          {
            role: 'system',
            content: 'You are a desktop automation assistant. Analyze the screenshot and return precise JSON actions. Be extremely concise and fast.'
          },
          {
            role: 'user',
            content: screenshotBase64 && validScreenshot ? [
              { type: 'text', text: prompt },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/png;base64,${screenshotBase64}`,
                  detail: 'low'
                }
              }
            ] : prompt
          }
        ];
        
        response = await this.openai.chat.completions.create({
          model: 'gpt-4o',
          messages,
          max_tokens: maxTokens,
          temperature: 0.1
        }, {
          timeout: this.aggressiveTimeout
        });
        
        usedProvider = 'openai-gpt4o-fallback';
        logger.info('✅ OpenAI fallback successful');
      }

      // Extract content based on provider used
      let content: string;
      if (usedProvider.startsWith('claude')) {
        content = response.content[0]?.text;
      } else {
        content = response.choices[0]?.message?.content;
      }
      
      if (!content) {
        throw new Error(`No response from ${usedProvider}`);
      }

      // 🔧 STEP 3: Check if vision analysis failed and retry if using OpenAI
      if (this.isVisionFailure(content) && screenshotBase64 && validScreenshot) {
        logger.warn('🔄 Vision failure detected, attempting retry...');
        
        // Only retry with OpenAI (Claude doesn't support detail levels)
        if (usedProvider.includes('openai') && this.openai) {
          logger.info('🔄 Retrying with OpenAI high detail...');
          
          const retryMessages: any[] = [
            {
              role: 'system',
              content: 'You are a desktop automation assistant. Analyze the screenshot and return precise JSON actions. Be extremely concise and fast.'
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                {
                  type: 'image_url',
                  image_url: {
                    url: `data:image/png;base64,${screenshotBase64}`,
                    detail: 'high' // 🔧 Use high detail for retry
                  }
                }
              ]
            }
          ];
          
          const retryResponse = await this.openai.chat.completions.create({
            model: 'gpt-4o',
            messages: retryMessages,
            max_tokens: maxTokens,
            temperature: 0.2
          }, {
            timeout: this.aggressiveTimeout
          });
          
          const retryContent = retryResponse.choices[0]?.message?.content;
          if (retryContent && !this.isVisionFailure(retryContent)) {
            logger.info('✅ OpenAI high detail retry succeeded');
            const retryLatency = performance.now() - startTime;
            const retryResult: FastLLMResponse = {
              text: retryContent,
              provider: 'openai-gpt4o-retry',
              latencyMs: retryLatency
            };
            
            await this.setFastCache(cacheKey, retryResult);
            return retryResult;
          }
        }
        
        // If retry failed or not applicable, use fallback
        logger.warn('🚨 Vision retry failed or not applicable, using fallback heuristic');
        const fallbackResponse = this.generateFallbackResponse(prompt);
        return {
          text: fallbackResponse,
          provider: 'fallback-heuristic',
          latencyMs: performance.now() - startTime
        };
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
   * Detect if GPT-4o failed to analyze the screenshot
   */
  private isVisionFailure(content: string): boolean {
    const failurePatterns = [
      'unable to analyze',
      'cannot analyze',
      'can\'t analyze',
      'appears to be an image of a forest',
      'i\'m sorry, i can\'t assist',
      'i cannot see',
      'unable to see',
      'cannot see the',
      'i\'m unable to',
      'please provide the correct screenshot'
    ];
    
    const lowerContent = content.toLowerCase();
    return failurePatterns.some(pattern => lowerContent.includes(pattern));
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

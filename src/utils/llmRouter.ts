// LLM Router for managing multiple AI providers and fallbacks
import OpenAI from 'openai';
import { Mistral } from '@mistralai/mistralai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';
import { createHash } from 'crypto';
import { getRedisClient, REDIS_PREFIX, TTL } from '../config/redis';
import { logger } from '../utils/logger';

/**
 * Provider attempt result for fallback chain tracking
 */
export interface ProviderAttempt {
  provider: string;
  success: boolean;
  error?: string;
  latencyMs?: number;
  timestamp: number;
}

/**
 * Response from an LLM model with detailed fallback chain information
 */
export interface LLMResponse {
  text: string;
  provider: string;
  tokenUsage?: {
    prompt?: number;
    completion?: number;
    total?: number;
  };
  latencyMs?: number;
  // Enhanced fallback chain visibility
  fallbackChain?: ProviderAttempt[];
  totalAttempts?: number;
  fromCache?: boolean;
  cacheType?: 'redis' | 'semantic' | 'none';
}

/**
 * LLM Router to handle multiple providers with fallbacks
 */
export class LLMRouter {
  // Updated provider order according to the fallback chain requirements
  // Note: Cache handling is done separately in the processPrompt method
  // Order: 1. Premium APIs (OpenAI, Claude, Gemini) 2. Cache 3. Cost-effective APIs (Mistral, Lambda)
  private providers: string[] = ['openai', 'claude', 'gemini', 'mistral', 'lambda'];
  private useSimulatedResponses: boolean;
  
  constructor() {
    // Check if we should use simulated responses
    this.useSimulatedResponses = process.env.SHOULD_RUN_SIMULATED_RESPONSES === 'true';
    console.log(`LLM Router initialized. Using simulated responses: ${this.useSimulatedResponses}`);
  }
  
  /**
   * Generate a cache key for a prompt
   */
  private generateCacheKey(prompt: string): string {
    // Use SHA-256 for more reliable hashing
    const normalizedPrompt = prompt.trim().toLowerCase();
    const hash = createHash('sha256')
      .update(normalizedPrompt)
      .digest('hex')
      .substring(0, 16); // Take first 16 chars for reasonable key size
    
    return `${REDIS_PREFIX.AI_RESPONSE}${hash}`;
  }
  
  /**
   * Cache an LLM response
   */
  private async cacheResponse(key: string, response: LLMResponse): Promise<void> {
    try {
      const redis = await getRedisClient();
      
      // Determine appropriate TTL based on response characteristics
      let ttl = TTL.AI_RESPONSE.DEFAULT;
      
      // Store in Redis with appropriate TTL
      const serializedResponse = JSON.stringify(response);
      await redis.set(key, serializedResponse, { EX: ttl });
      
      logger.debug('Cached AI response', { key, provider: response.provider });
    } catch (error) {
      logger.warn('Failed to cache AI response', { key, error });
      // Non-critical failure, continue without caching
    }
  }
  
  /**
   * Get a cached LLM response
   */
  private async getCachedResponse(key: string): Promise<LLMResponse | null> {
    try {
      const redis = await getRedisClient();
      
      // Try to get cached response from Redis
      const cached = await redis.get(key);
      if (!cached) return null;
      
      // Parse the cached response
      const cachedResponse = JSON.parse(cached) as LLMResponse;
      logger.debug('Cache hit for AI response', { key, provider: cachedResponse.provider });
      
      return cachedResponse;
    } catch (error) {
      logger.warn('Failed to get cached AI response', { key, error });
      return null;
    }
  }
  
  /**
   * Process a prompt through available LLM providers with fallbacks
   * Enhanced with detailed fallback chain tracking and visibility
   */
  async processPrompt(prompt: string, options: { skipCache?: boolean; taskType?: string } = {}): Promise<LLMResponse> {
    const overallStartTime = performance.now();
    const fallbackChain: ProviderAttempt[] = [];
    
    // Generate a cache key for this prompt
    const cacheKey = this.generateCacheKey(prompt);
    
    // Step 1: Check Redis cache FIRST - exact match (fastest)
    if (!options.skipCache) {
      const cacheStartTime = performance.now();
      try {
        const cachedResponse = await this.getCachedResponse(cacheKey);
        if (cachedResponse) {
          const cacheLatency = performance.now() - cacheStartTime;
          console.log('✅ Using Redis cached response');
          
          fallbackChain.push({
            provider: 'redis-cache',
            success: true,
            latencyMs: cacheLatency,
            timestamp: Date.now()
          });
          
          return {
            ...cachedResponse,
            provider: `cached-${cachedResponse.provider}`,
            fallbackChain,
            totalAttempts: 1,
            fromCache: true,
            cacheType: 'redis'
          };
        }
      } catch (error) {
        const cacheLatency = performance.now() - cacheStartTime;
        console.warn('❌ Redis cache lookup failed:', error);
        
        fallbackChain.push({
          provider: 'redis-cache',
          success: false,
          error: error instanceof Error ? error.message : String(error),
          latencyMs: cacheLatency,
          timestamp: Date.now()
        });
      }
    }
    
    // Step 2: Check enhanced RAG semantic cache with intelligent validation
    if (!options.skipCache && options.taskType !== 'generate_agent' && options.taskType !== 'orchestrate') {
      const semanticStartTime = performance.now();
      try {
        const { ragService } = await import('../services/ragService');
        const cacheResult = await (ragService as any).checkSemanticCache(prompt);
        const semanticLatency = performance.now() - semanticStartTime;
        
        if (cacheResult) {
          console.log('✅ Using enhanced RAG semantic cached response', {
            cacheAge: Math.round(cacheResult.cacheAge / 1000) + 's',
            latencyMs: Math.round(semanticLatency)
          });
          
          fallbackChain.push({
            provider: 'semantic-cache',
            success: true,
            latencyMs: semanticLatency,
            timestamp: Date.now()
          });
          
          return {
            text: cacheResult.response,
            provider: 'semantic-cache',
            latencyMs: Math.round(semanticLatency),
            fallbackChain,
            totalAttempts: fallbackChain.length,
            fromCache: true,
            cacheType: 'semantic'
          };
        } else {
          console.log('❌ No relevant semantic cache match found');
          fallbackChain.push({
            provider: 'semantic-cache',
            success: false,
            error: 'No relevant match found',
            latencyMs: semanticLatency,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        const semanticLatency = performance.now() - semanticStartTime;
        console.warn('❌ Enhanced RAG semantic cache lookup failed:', error);
        
        fallbackChain.push({
          provider: 'semantic-cache',
          success: false,
          error: error instanceof Error ? error.message : String(error),
          latencyMs: semanticLatency,
          timestamp: Date.now()
        });
      }
    } else if (options.taskType === 'generate_agent' || options.taskType === 'orchestrate') {
      console.log(`⏭️  Semantic cache bypassed for task type: ${options.taskType}`);
      fallbackChain.push({
        provider: 'semantic-cache',
        success: false,
        error: `Bypassed for task type: ${options.taskType}`,
        latencyMs: 0,
        timestamp: Date.now()
      });
    }
    
    // Step 3: Try all LLM providers in fallback order
    const allProviders = ['mistral', 'gemini', 'openai', 'claude', 'deepseek', 'lambda'];
    console.log('🚀 Starting LLM provider fallback chain:', allProviders);
    
    for (const provider of allProviders) {
      const providerStartTime = performance.now();
      try {
        console.log(`⚡ Attempting provider: ${provider}`);
        const result = await this.callProvider(provider, prompt);
        const providerLatency = performance.now() - providerStartTime;
        
        console.log(`✅ SUCCESS with provider: ${provider} (${Math.round(providerLatency)}ms)`);
        
        // Record successful attempt
        fallbackChain.push({
          provider,
          success: true,
          latencyMs: providerLatency,
          timestamp: Date.now()
        });
        
        // Cache successful responses
        await this.cacheResponse(cacheKey, result);
        
        // Return enhanced response with complete fallback chain visibility
        return {
          ...result,
          fallbackChain,
          totalAttempts: fallbackChain.length,
          fromCache: false,
          cacheType: 'none',
          latencyMs: performance.now() - overallStartTime
        };
        
      } catch (error: any) {
        const providerLatency = performance.now() - providerStartTime;
        const isQuotaError = error?.message?.toLowerCase().includes('quota') ||
                            error?.message?.toLowerCase().includes('rate limit') ||
                            error?.message?.toLowerCase().includes('usage limit');
        
        const errorType = isQuotaError ? 'QUOTA/RATE LIMIT' : 'API ERROR';
        console.warn(`❌ Provider ${provider} failed (${errorType}): ${error?.message} (${Math.round(providerLatency)}ms)`);
        
        // Record failed attempt with detailed information
        fallbackChain.push({
          provider,
          success: false,
          error: `${errorType}: ${error?.message || String(error)}`,
          latencyMs: providerLatency,
          timestamp: Date.now()
        });
        
        // Continue to next provider
      }
    }
    
    // All providers failed - provide comprehensive error with full fallback chain
    const totalLatency = performance.now() - overallStartTime;
    const quotaFailures = fallbackChain.filter(attempt => 
      attempt.error?.toLowerCase().includes('quota') || 
      attempt.error?.toLowerCase().includes('rate limit')
    );
    const apiFailures = fallbackChain.filter(attempt => 
      attempt.success === false && !quotaFailures.includes(attempt)
    );
    
    console.error('💥 ALL LLM PROVIDERS FAILED - Complete Fallback Chain:');
    fallbackChain.forEach((attempt, index) => {
      const status = attempt.success ? '✅' : '❌';
      const latency = attempt.latencyMs ? `${Math.round(attempt.latencyMs)}ms` : 'N/A';
      console.error(`  ${index + 1}. ${status} ${attempt.provider} (${latency}) ${attempt.error ? `- ${attempt.error}` : ''}`);
    });
    
    let errorMessage = `All LLM providers failed after ${fallbackChain.length} attempts (${Math.round(totalLatency)}ms total).`;
    if (quotaFailures.length > 0) {
      errorMessage += ` Quota/rate limit exceeded on: ${quotaFailures.map(f => f.provider).join(', ')}.`;
    }
    if (apiFailures.length > 0) {
      errorMessage += ` API errors on: ${apiFailures.map(f => f.provider).join(', ')}.`;
    }
    
    // Even in failure, return the fallback chain for debugging
    const errorResponse: LLMResponse = {
      text: '',
      provider: 'none',
      fallbackChain,
      totalAttempts: fallbackChain.length,
      fromCache: false,
      cacheType: 'none',
      latencyMs: totalLatency
    };
    
    throw new Error(`${errorMessage} Fallback chain: ${JSON.stringify(errorResponse.fallbackChain)}`);
  }
  
  /**
   * Call a specific LLM provider
   */
  private async callProvider(provider: string, prompt: string): Promise<LLMResponse> {
    const startTime = performance.now();
    
    switch (provider) {
      case 'deepseek':
        return await this.callDeepSeek(prompt, startTime);
      case 'openai':
        return await this.callOpenAI(prompt, startTime);
      case 'claude':
        return await this.callClaude(prompt, startTime);
      case 'gemini':
        return await this.callGemini(prompt, startTime);
      case 'lambda':
        return await this.callLambdaAI(prompt, startTime);
      case 'mistral':
        return await this.callMistral(prompt, startTime);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }
  
  /**
   * Call OpenAI API with GPT-4 Turbo and fallback to GPT-3.5 Turbo
   */
  private async callOpenAI(prompt: string, startTime: number): Promise<LLMResponse> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    // If using simulated responses, return the simulation
    if (this.useSimulatedResponses) {
      console.log('Using simulated OpenAI response');
      const latencyMs = performance.now() - startTime;
      return {
        text: 'This is a simulated response from GPT-3.5 Turbo (OpenAI fallback).',
        provider: 'openai-gpt3.5',
        tokenUsage: {
          prompt: prompt.length / 4,
          completion: 12,
          total: prompt.length / 4 + 12
        },
        latencyMs
      };
    }
    
    try {
      // Real OpenAI API call using GPT-4 Turbo
      console.log('Making real API call to OpenAI GPT-4 Turbo...');
      
      const openai = new OpenAI({ apiKey });
      const response = await openai.chat.completions.create({
        model: 'gpt-4-turbo-preview',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 4096  // Increased for complex orchestration responses
      });
      
      const latencyMs = performance.now() - startTime;
      return {
        text: response.choices[0]?.message?.content || 'No response from OpenAI',
        provider: 'openai-gpt4',
        tokenUsage: {
          prompt: response.usage?.prompt_tokens || 0,
          completion: response.usage?.completion_tokens || 0,
          total: response.usage?.total_tokens || 0
        },
        latencyMs
      };
    } catch (error: any) {
      // Check if this is a quota/rate limit error
      const isQuotaError = error?.status === 429 || 
                          error?.code === 'rate_limit_exceeded' ||
                          error?.message?.toLowerCase().includes('quota') ||
                          error?.message?.toLowerCase().includes('rate limit');
      
      console.warn(`GPT-4 Turbo failed (${isQuotaError ? 'QUOTA/RATE LIMIT' : 'OTHER ERROR'}), falling back to GPT-3.5 Turbo:`, {
        status: error?.status,
        code: error?.code,
        message: error?.message,
        isQuotaError
      });
      
      try {
        // Fall back to GPT-3.5 Turbo
        console.log('Using GPT-3.5 Turbo as fallback...');
        
        const openai = new OpenAI({ apiKey });
        const response = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 4096  // Increased for complex orchestration responses
        });
        
        const latencyMs = performance.now() - startTime;
        return {
          text: response.choices[0]?.message?.content || 'No response from OpenAI',
          provider: 'openai-gpt3.5',
          tokenUsage: {
            prompt: response.usage?.prompt_tokens || 0,
            completion: response.usage?.completion_tokens || 0,
            total: response.usage?.total_tokens || 0
          },
          latencyMs
        };
      } catch (fallbackError: any) {
        // Check if fallback also hit quota
        const fallbackIsQuotaError = fallbackError?.status === 429 || 
                                    fallbackError?.code === 'rate_limit_exceeded' ||
                                    fallbackError?.message?.toLowerCase().includes('quota') ||
                                    fallbackError?.message?.toLowerCase().includes('rate limit');
        
        console.error(`OpenAI complete failure (${fallbackIsQuotaError ? 'QUOTA/RATE LIMIT' : 'OTHER ERROR'}):`, {
          status: fallbackError?.status,
          code: fallbackError?.code,
          message: fallbackError?.message,
          isQuotaError: fallbackIsQuotaError
        });
        
        // Throw with more specific error information
        if (isQuotaError || fallbackIsQuotaError) {
          throw new Error(`OpenAI quota/rate limit exceeded - both GPT-4 and GPT-3.5 hit limits`);
        } else {
          throw new Error(`OpenAI API error: ${fallbackError?.message || 'Unknown error'}`);
        }
      }
    }
  }
  
  /**
   * Call DeepSeek API
   */
  private async callDeepSeek(prompt: string, startTime: number): Promise<LLMResponse> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      throw new Error('DeepSeek API key not configured');
    }
    
    // If using simulated responses, return the simulation
    if (this.useSimulatedResponses) {
      console.log('Using simulated DeepSeek response');
      const latencyMs = performance.now() - startTime;
      return {
        text: 'This is a simulated response from DeepSeek AI.',
        provider: 'deepseek',
        tokenUsage: {
          prompt: prompt.length / 4, 
          completion: 15,
          total: prompt.length / 4 + 15
        },
        latencyMs
      };
    }
    
    try {
      // Real DeepSeek API call using axios directly
      console.log('Making real API call to DeepSeek...');
      
      const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
        model: 'deepseek-chat',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        max_tokens: 4096  // Increased for complex orchestration responses
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      const latencyMs = performance.now() - startTime;
      return {
        text: response.data.choices[0]?.message?.content || 'No response from DeepSeek',
        provider: 'deepseek',
        tokenUsage: {
          prompt: response.data.usage?.prompt_tokens || 0,
          completion: response.data.usage?.completion_tokens || 0,
          total: response.data.usage?.total_tokens || 0
        },
        latencyMs
      };
    } catch (error) {
      console.error('DeepSeek API error:', error);
      throw new Error('DeepSeek limit hit');
    }
  }
  
  /**
   * Call Mistral API (External API service)
   */
  private async callMistral(prompt: string, startTime: number): Promise<LLMResponse> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) {
      throw new Error('Mistral API key not configured');
    }
    
    // If using simulated responses, return the simulation
    if (this.useSimulatedResponses) {
      console.log('Using simulated Mistral response');
      const latencyMs = performance.now() - startTime;
      return {
        text: 'This is a simulated response from Mistral AI API.',
        provider: 'mistral-api',
        tokenUsage: {
          prompt: prompt.length / 4,
          completion: 15,
          total: prompt.length / 4 + 15
        },
        latencyMs
      };
    }
    
    try {
      // Real Mistral API call
      console.log('Making real API call to Mistral...');
      
      const client = new Mistral({ apiKey });
      const response = await client.chat.complete({
        model: 'mistral-medium',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.7,
        maxTokens: 4096
      });
      
      const latencyMs = performance.now() - startTime;
      return {
        text: typeof response.choices[0]?.message?.content === 'string' 
          ? response.choices[0].message.content 
          : 'No response from Mistral',
        provider: 'mistral',
        tokenUsage: {
          prompt: response.usage?.promptTokens || 0,
          completion: response.usage?.completionTokens || 0,
          total: response.usage?.totalTokens || 0
        },
        latencyMs
      };
    } catch (error) {
      console.error('Mistral API error:', error);
      throw new Error('Mistral limit hit - all providers failed');
    }
  }
  
  /**
   * Call Claude API
   */
  private async callClaude(prompt: string, startTime: number): Promise<LLMResponse> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Anthropic API key not configured');
    }
    
    // If using simulated responses, return the simulation
    if (this.useSimulatedResponses) {
      console.log('Using simulated Claude response');
      const latencyMs = performance.now() - startTime;
      return {
        text: 'This is a simulated response from Claude AI.',
        provider: 'claude',
        tokenUsage: {
          prompt: prompt.length / 4,
          completion: 13,
          total: prompt.length / 4 + 13
        },
        latencyMs
      };
    }
    
    try {
      // Real Claude API call
      console.log('Making real API call to Claude...');
      
      const client = new Anthropic({ apiKey });
      const response = await client.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 4096,  // Increased for complex orchestration responses
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }]
      });
      
      const latencyMs = performance.now() - startTime;
      
      // Extract text from content blocks
      let textContent = '';
      for (const block of response.content) {
        // Handle different types of content blocks
        if (block.type === 'text') {
          textContent += block.text;
        }
        // If needed, handle other content block types here
      }
      
      return {
        text: textContent || 'No response from Claude',
        provider: 'claude',
        tokenUsage: {
          prompt: response.usage?.input_tokens || 0,
          completion: response.usage?.output_tokens || 0,
          total: (response.usage?.input_tokens || 0) + (response.usage?.output_tokens || 0)
        },
        latencyMs
      };
    } catch (error: any) {
      // Check if this is a quota/rate limit error
      const isQuotaError = error?.status === 429 || 
                          error?.code === 'rate_limit_exceeded' ||
                          error?.message?.toLowerCase().includes('quota') ||
                          error?.message?.toLowerCase().includes('rate limit') ||
                          error?.message?.toLowerCase().includes('usage limit');
      
      console.error(`Claude API error (${isQuotaError ? 'QUOTA/RATE LIMIT' : 'OTHER ERROR'}):`, {
        status: error?.status,
        code: error?.code,
        message: error?.message,
        isQuotaError
      });
      
      // Throw with more specific error information
      if (isQuotaError) {
        throw new Error(`Claude quota/rate limit exceeded: ${error?.message || 'Unknown quota error'}`);
      } else {
        throw new Error(`Claude API error: ${error?.message || 'Unknown error'}`);
      }
    }
  }
  
  /**
   * Call Gemini API
   */
  private async callGemini(prompt: string, startTime: number): Promise<LLMResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('Google AI API key not configured');
    }
    
    // If using simulated responses, return the simulation
    if (this.useSimulatedResponses) {
      console.log('Using simulated Gemini response');
      const latencyMs = performance.now() - startTime;
      return {
        text: 'This is a simulated response from Gemini AI.',
        provider: 'gemini',
        tokenUsage: {
          prompt: prompt.length / 4,
          completion: 10,
          total: prompt.length / 4 + 10
        },
        latencyMs
      };
    }
    
    try {
      // Real Gemini API call
      console.log('Making real API call to Gemini...');
      
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: 'gemini-1.5-pro' });
      
      const result = await model.generateContent(prompt);
      const response = result.response;
      
      const latencyMs = performance.now() - startTime;
      
      // Safely extract text from Gemini response
      let responseText = 'No response from Gemini';
      try {
        if (typeof response.text === 'function') {
          responseText = response.text() || responseText;
        } else if (response.text) {
          responseText = String(response.text);
        }
      } catch (textError) {
        console.warn('Error extracting text from Gemini response:', textError);
      }
      
      return {
        text: responseText,
        provider: 'gemini',
        tokenUsage: {
          // Gemini doesn't provide token counts directly in the same way
          prompt: Math.round(prompt.length / 4),
          completion: Math.round(responseText.length / 4),
          total: Math.round((prompt.length + responseText.length) / 4)
        },
        latencyMs
      };
    } catch (error) {
      console.error('Gemini API error:', error);
      throw new Error('Gemini limit hit');
    }
  }

  /**
   * Call Lambda.ai API with various model options
   */
  private async callLambdaAI(prompt: string, startTime: number): Promise<LLMResponse> {
    const apiKey = process.env.LAMBDA_AI;
    if (!apiKey) {
      throw new Error('Lambda.ai API key not configured');
    }
    
    // If using simulated responses, return the simulation
    if (this.useSimulatedResponses) {
      console.log('Using simulated Lambda.ai response');
      const latencyMs = performance.now() - startTime;
      return {
        text: 'This is a simulated response from Lambda.ai (hosted models).',
        provider: 'lambda-simulated',
        tokenUsage: {
          prompt: prompt.length / 4,
          completion: 14,
          total: prompt.length / 4 + 14
        },
        latencyMs
      };
    }
    
    try {
      // Real Lambda.ai API call using their API
      console.log('Making real API call to Lambda.ai...');
      
      // Lambda.ai is OpenAI API compatible
      const response = await axios.post('https://api.lambda.chat/v1/chat/completions', {
        model: 'deepseek-chat', // Options: 'deepseek-chat', 'llama3-8b', 'mistral-small', etc.
        messages: [
          { role: 'system', content: 'You are a helpful assistant specializing in Bible study and interpretation.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 4096  // Increased for complex orchestration responses
      }, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      
      const latencyMs = performance.now() - startTime;
      
      // Extract the response content
      const responseContent = response.data.choices[0]?.message?.content || 'No response from Lambda.ai';
      
      return {
        text: responseContent,
        provider: 'lambda-ai',
        tokenUsage: {
          prompt: response.data.usage?.prompt_tokens || 0,
          completion: response.data.usage?.completion_tokens || 0,
          total: response.data.usage?.total_tokens || 0
        },
        latencyMs
      };
    } catch (error) {
      console.error('Lambda.ai API error:', error);
      throw new Error('Lambda.ai limit hit or error');
    }
  }
}

// Export a utility function for backward compatibility
export const getBestLLMResponse = async (prompt: string): Promise<string> => {
  const router = new LLMRouter();
  const response = await router.processPrompt(prompt);
  return response.text;
};

// Check if running simulated responses
export const isUsingSimulatedResponses = (): boolean => {
  return process.env.SHOULD_RUN_SIMULATED_RESPONSES === 'true';
};

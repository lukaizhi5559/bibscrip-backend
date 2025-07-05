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
 * Response from an LLM model
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
   */
  async processPrompt(prompt: string, options: { skipCache?: boolean; taskType?: string } = {}): Promise<LLMResponse> {
    // Generate a cache key for this prompt
    const cacheKey = this.generateCacheKey(prompt);
    
    // Step 1: Check Redis cache FIRST - exact match (fastest)
    if (!options.skipCache) {
      try {
        const cachedResponse = await this.getCachedResponse(cacheKey);
        if (cachedResponse) {
          console.log('Using Redis cached response');
          return {
            ...cachedResponse,
            provider: `cached-${cachedResponse.provider}`
          };
        }
      } catch (error) {
        console.warn('Redis cache lookup failed:', error);
        // Continue to semantic cache
      }
    }
    
    // Step 2: Check semantic cache - similar questions (cost-effective)
    // Skip semantic cache for agent generation and orchestration to prevent incorrect matches
    if (!options.skipCache && options.taskType !== 'generate_agent' && options.taskType !== 'orchestrate') {
      try {
        // Import ragService dynamically to avoid circular dependencies
        const { ragService } = await import('../services/ragService');
        
        // Use the public process method to get RAG result which includes semantic cache check
        const ragResult = await ragService.process(prompt);
        
        // Check if we got contexts from cache (indicating a semantic cache hit)
        if (ragResult.contexts.length > 0) {
          // Look for cached responses in the contexts
          const cachedResponse = ragResult.contexts.find(ctx => 
            ctx.source.toString().includes('cached_response') || 
            ctx.source.toString().includes('answered_question')
          );
          
          if (cachedResponse && cachedResponse.score > 0.8) { // High similarity threshold
            console.log('Using semantic cached response', {
              score: cachedResponse.score,
              source: cachedResponse.source
            });
            
            return {
              text: cachedResponse.text,
              provider: 'semantic-cache',
              latencyMs: ragResult.latencyMs
            };
          }
        }
      } catch (error) {
        console.warn('Semantic cache lookup failed:', error);
        // Continue to LLM providers
      }
    } else if (options.taskType === 'generate_agent' || options.taskType === 'orchestrate') {
      console.log(`Semantic cache bypassed for task type: ${options.taskType}`);
    }
    
    // Step 2-4: Try premium providers (OpenAI, Claude, Gemini)
    const premiumProviders = ['openai', 'claude', 'gemini'];
    for (const provider of premiumProviders) {
      try {
        const result = await this.callProvider(provider, prompt);
        // Cache successful responses from premium providers
        await this.cacheResponse(cacheKey, result);
        return result;
      } catch (error) {
        console.warn(`Provider ${provider} failed:`, error);
        // Continue to next provider
      }
    }
    
    // Step 5-6: Try cost-effective external API providers (both are external APIs, not local)
    const fallbackProviders = ['mistral', 'lambda'];
    for (const provider of fallbackProviders) {
      try {
        const result = await this.callProvider(provider, prompt);
        // Still cache results from fallbacks
        await this.cacheResponse(cacheKey, result);
        return result;
      } catch (error) {
        console.warn(`Provider ${provider} failed:`, error);
        // Continue to next provider
      }
    }
    
    // All providers failed
    throw new Error('All LLM providers failed to process the request');
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
        max_tokens: 1024
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
    } catch (error) {
      // Log the error but don't fail yet
      console.warn('GPT-4 Turbo failed, falling back to GPT-3.5 Turbo:', error);
      
      try {
        // Fall back to GPT-3.5 Turbo
        console.log('Using GPT-3.5 Turbo as fallback...');
        
        const openai = new OpenAI({ apiKey });
        const response = await openai.chat.completions.create({
          model: 'gpt-3.5-turbo',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.7,
          max_tokens: 1024
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
      } catch (fallbackError) {
        // If both fail, we'll throw the error to try the next provider
        console.error('OpenAI complete failure:', fallbackError);
        throw new Error('OpenAI limit hit');
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
        max_tokens: 1024
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
        maxTokens: 1024
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
        model: 'claude-3-sonnet-20240229',
        max_tokens: 1024,
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
    } catch (error) {
      console.error('Claude API error:', error);
      throw new Error('Claude limit hit');
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
        max_tokens: 1024
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

// LLM Router for managing multiple AI providers and fallbacks
import OpenAI from 'openai';
import { Mistral } from '@mistralai/mistralai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import axios from 'axios';

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
  private providers: string[] = ['deepseek', 'openai', 'claude', 'gemini', 'mistral'];
  private useSimulatedResponses: boolean;
  
  constructor() {
    // Check if we should use simulated responses
    this.useSimulatedResponses = process.env.SHOULD_RUN_SIMULATED_RESPONSES === 'true';
    console.log(`LLM Router initialized. Using simulated responses: ${this.useSimulatedResponses}`);
  }
  
  /**
   * Process a prompt through available LLM providers with fallbacks
   */
  async processPrompt(prompt: string): Promise<LLMResponse> {
    // Try each provider in sequence
    for (const provider of this.providers) {
      try {
        const result = await this.callProvider(provider, prompt);
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
   * Call Mistral API
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
        text: 'This is a simulated response from Mistral AI (final fallback).',
        provider: 'mistral',
        tokenUsage: {
          prompt: prompt.length / 4,
          completion: 8,
          total: prompt.length / 4 + 8
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

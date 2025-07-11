/**
 * Streaming layer built on top of existing LLMRouter
 * Provides unified streaming responses for WebSocket/voice integration
 */

import { LLMRouter } from './llmRouter';
import {
  StreamingMessage,
  StreamingMessageType,
  LLMStreamRequest,
  LLMStreamChunk,
  LLMStreamResult,
  StreamingError,
  StreamingMetadata
} from '../types/streaming';
import { buildPrompt } from '../services/promptBuilder';
import { logger } from './logger';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { Mistral } from '@mistralai/mistralai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';

export class LLMStreamingRouter extends LLMRouter {
  private activeStreams: Map<string, AbortController> = new Map();

  /**
   * Process prompt with streaming support
   * Built on top of existing LLMRouter without disrupting REST APIs
   */
  async processPromptWithStreaming(
    request: LLMStreamRequest,
    onChunk: (chunk: StreamingMessage) => void,
    metadata: StreamingMetadata
  ): Promise<LLMStreamResult> {
    const { prompt: userPrompt, provider: preferredProvider, options = {} } = request;
    
    // Build Thinkdrop AI branded prompt with proper context
    const enhancedPrompt = buildPrompt('ask', {
      userQuery: userPrompt,
      context: {}
    });
    
    const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = performance.now();
    
    // Create abort controller for this stream
    const abortController = new AbortController();
    this.activeStreams.set(streamId, abortController);

    try {
      // Send stream start message
      onChunk({
        id: streamId,
        type: StreamingMessageType.LLM_STREAM_START,
        payload: {
          prompt: userPrompt.substring(0, 100) + '...', // Truncated for logging
          preferredProvider,
          options
        },
        timestamp: Date.now(),
        metadata
      });

      let streamResult: LLMStreamResult | undefined;
      let fullText = '';
      let tokenCount = 0;

      // Create chunk handler
      const handleChunk = (chunk: LLMStreamChunk) => {
        if (abortController.signal.aborted) return;
        
        fullText += chunk.text;
        tokenCount += chunk.tokenCount || 0;
        
        onChunk({
          id: `${streamId}_chunk_${Date.now()}`,
          type: StreamingMessageType.LLM_STREAM_CHUNK,
          payload: chunk,
          timestamp: Date.now(),
          parentId: streamId,
          metadata: {
            ...metadata,
            provider: chunk.provider
          }
        });
      };

      // Try preferred provider first if specified
      if (preferredProvider) {
        try {
          streamResult = await this.callProviderWithStreaming(
            preferredProvider,
            enhancedPrompt,
            handleChunk,
            abortController.signal
          );
        } catch (error) {
          logger.warn(`❌ Preferred provider ${preferredProvider} streaming failed:`, { 
            error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error) 
          });
          // Fall through to try other providers
        }
      }

      // If no result yet, try fallback chain
      if (!streamResult) {

        /* 
        *   Claude has been removed for now They Stated:
        *   I can see that the WebSocket test revealed an important issue: 
        *   Claude is rejecting the Thinkdrop Al prompt due to the religious/political 
        *   worldview language. The LLM is refusing to adopt the "Biblical worldview and 
        *   traditional conservative values" persona, which means our Thinkdrop Al branding 
        *   isn't working as intended.
        *   Let me update the plan and then fix this issue by modifying the prompt to be more 
        *   acceptable to LLM providers while still maintaining Thinkdrop Al branding.
        */
        const allProviders = ['claude', 'openai', 'grok', 'gemini', 'mistral', 'deepseek', 'lambda'];
        
        for (const provider of allProviders) {
          if (provider === preferredProvider) continue; // Skip if already tried
          if (abortController.signal.aborted) break;
          
          try {
            logger.info(`⚡ Attempting streaming with provider: ${provider}`);
            streamResult = await this.callProviderWithStreaming(
              provider,
              enhancedPrompt,
              handleChunk,
              abortController.signal
            );
            break; // Success, exit loop
          } catch (error) {
            logger.warn(`❌ Provider ${provider} streaming failed:`, { 
              error: error instanceof Error ? { message: error.message, stack: error.stack } : String(error) 
            });
            continue; // Try next provider
          }
        }
      }

      if (!streamResult) {
        throw new Error('All LLM providers failed for streaming request');
      }

      // Send stream end message
      onChunk({
        id: `${streamId}_end`,
        type: StreamingMessageType.LLM_STREAM_END,
        payload: {
          fullText: streamResult.fullText,
          provider: streamResult.provider,
          processingTime: streamResult.processingTime,
          tokenUsage: streamResult.tokenUsage,
          fallbackChain: streamResult.fallbackChain
        },
        timestamp: Date.now(),
        parentId: streamId,
        metadata: {
          ...metadata,
          provider: streamResult.provider
        }
      });

      return streamResult;

    } catch (error) {
      const streamingError: StreamingError = {
        code: 'STREAMING_ERROR',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
        provider: preferredProvider
      };

      onChunk({
        id: `${streamId}_error`,
        type: StreamingMessageType.LLM_ERROR,
        payload: streamingError,
        timestamp: Date.now(),
        parentId: streamId,
        metadata
      });

      throw error;
    } finally {
      // Clean up
      this.activeStreams.delete(streamId);
    }
  }

  /**
   * Call specific provider with streaming support
   */
  private async callProviderWithStreaming(
    provider: string,
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    abortSignal: AbortSignal
  ): Promise<LLMStreamResult> {
    const startTime = performance.now();
    
    switch (provider) {
      case 'claude':
        return this.callClaudeWithStreaming(prompt, onChunk, abortSignal, startTime);
      case 'openai':
        return this.callOpenAIWithStreaming(prompt, onChunk, abortSignal, startTime);
      case 'grok':
        return this.callGrokWithStreaming(prompt, onChunk, abortSignal, startTime);
      case 'gemini':
        return this.callGeminiWithStreaming(prompt, onChunk, abortSignal, startTime);
      case 'mistral':
        return this.callMistralWithStreaming(prompt, onChunk, abortSignal, startTime);
      case 'deepseek':
        return this.callDeepseekWithStreaming(prompt, onChunk, abortSignal, startTime);
      case 'lambda':
        return this.callLambdaWithStreaming(prompt, onChunk, abortSignal, startTime);
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }
  }

  /**
   * Claude streaming implementation
   */
  private async callClaudeWithStreaming(
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    abortSignal: AbortSignal,
    startTime: number
  ): Promise<LLMStreamResult> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('Claude API key not configured');

    if ((this as any).useSimulatedResponses) {
      return this.simulateStreamingResponse('claude', prompt, onChunk, startTime);
    }

    const anthropic = new Anthropic({ apiKey });
    let fullText = '';
    let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const stream = await anthropic.messages.create({
      model: 'claude-3-opus-20240229',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
      stream: true
    });

    for await (const chunk of stream) {
      if (abortSignal.aborted) break;
      
      if (chunk.type === 'content_block_delta' && chunk.delta && 'text' in chunk.delta) {
        const text = (chunk.delta as any).text;
        fullText += text;
        
        onChunk({
          text,
          provider: 'claude',
          tokenCount: text.split(' ').length, // Rough estimate
          finishReason: null
        });
      }
      
      if (chunk.type === 'message_delta' && chunk.usage) {
        tokenUsage = {
          promptTokens: chunk.usage.input_tokens || 0,
          completionTokens: chunk.usage.output_tokens || 0,
          totalTokens: (chunk.usage.input_tokens || 0) + (chunk.usage.output_tokens || 0)
        };
      }
    }

    return {
      fullText,
      provider: 'claude',
      processingTime: performance.now() - startTime,
      tokenUsage
    };
  }

  /**
   * OpenAI streaming implementation
   */
  private async callOpenAIWithStreaming(
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    abortSignal: AbortSignal,
    startTime: number
  ): Promise<LLMStreamResult> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OpenAI API key not configured');

    if ((this as any).useSimulatedResponses) {
      return this.simulateStreamingResponse('openai', prompt, onChunk, startTime);
    }

    const openai = new OpenAI({ apiKey });
    let fullText = '';
    let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const stream = await openai.chat.completions.create({
      model: 'gpt-4-turbo',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7,
      max_tokens: 4096
    });

    for await (const chunk of stream) {
      if (abortSignal.aborted) break;
      
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullText += content;
        
        onChunk({
          text: content,
          provider: 'openai',
          tokenCount: content.split(' ').length,
          finishReason: (chunk.choices[0]?.finish_reason as any) || null
        });
      }
      
      if (chunk.usage) {
        tokenUsage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens
        };
      }
    }

    return {
      fullText,
      provider: 'openai',
      processingTime: performance.now() - startTime,
      tokenUsage
    };
  }

  /**
   * Grok streaming implementation
   */
  private async callGrokWithStreaming(
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    abortSignal: AbortSignal,
    startTime: number
  ): Promise<LLMStreamResult> {
    const apiKey = process.env.GROK_API_KEY;
    if (!apiKey) throw new Error('Grok API key not configured');

    if ((this as any).useSimulatedResponses) {
      return this.simulateStreamingResponse('grok', prompt, onChunk, startTime);
    }

    let fullText = '';
    let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'grok-1',
      messages: [
        { role: 'system', content: 'You are a helpful assistant specializing in Bible study and interpretation.' },
        { role: 'user', content: prompt }
      ],
      stream: true,
      temperature: 0.7,
      max_tokens: 4096
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream',
      signal: abortSignal
    });

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        if (abortSignal.aborted) return;
        
        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            if (data === '[DONE]') {
              resolve({
                fullText,
                provider: 'grok',
                processingTime: performance.now() - startTime,
                tokenUsage
              });
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content;
              
              if (content) {
                fullText += content;
                
                onChunk({
                  text: content,
                  provider: 'grok',
                  tokenCount: content.split(' ').length,
                  finishReason: parsed.choices[0]?.finish_reason || null
                });
              }
              
              if (parsed.usage) {
                tokenUsage = {
                  promptTokens: parsed.usage.prompt_tokens,
                  completionTokens: parsed.usage.completion_tokens,
                  totalTokens: parsed.usage.total_tokens
                };
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      });

      response.data.on('error', reject);
      response.data.on('end', () => {
        resolve({
          fullText,
          provider: 'grok',
          processingTime: performance.now() - startTime,
          tokenUsage
        });
      });
    });
  }

  /**
   * Gemini streaming implementation
   */
  private async callGeminiWithStreaming(
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    abortSignal: AbortSignal,
    startTime: number
  ): Promise<LLMStreamResult> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('Gemini API key not configured');

    if ((this as any).useSimulatedResponses) {
      return this.simulateStreamingResponse('gemini', prompt, onChunk, startTime);
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
    let fullText = '';
    let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const result = await model.generateContentStream({
      contents: [{ role: "user", parts: [{ text: prompt }] }]
    });

    for await (const chunk of result.stream) {
      if (abortSignal.aborted) break;
      
      const chunkText = chunk.text();
      if (chunkText) {
        fullText += chunkText;
        
        onChunk({
          text: chunkText,
          provider: 'gemini',
          tokenCount: chunkText.split(' ').length,
          finishReason: null
        });
      }
    }

    return {
      fullText,
      provider: 'gemini',
      processingTime: performance.now() - startTime,
      tokenUsage
    };
  }

  /**
   * Mistral streaming implementation
   */
  private async callMistralWithStreaming(
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    abortSignal: AbortSignal,
    startTime: number
  ): Promise<LLMStreamResult> {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error('Mistral API key not configured');

    if ((this as any).useSimulatedResponses) {
      return this.simulateStreamingResponse('mistral', prompt, onChunk, startTime);
    }

    const client = new Mistral({ apiKey });
    let fullText = '';
    let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const stream = await (client as any).chatStream({
      model: "mistral-medium",
      messages: [{ role: "user", content: prompt }]
    });

    for await (const chunk of stream) {
      if (abortSignal.aborted) break;
      
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullText += content;
        
        onChunk({
          text: content,
          provider: 'mistral',
          tokenCount: content.split(' ').length,
          finishReason: chunk.choices[0]?.finish_reason || null
        });
      }
      
      if (chunk.usage) {
        tokenUsage = {
          promptTokens: chunk.usage.prompt_tokens,
          completionTokens: chunk.usage.completion_tokens,
          totalTokens: chunk.usage.total_tokens
        };
      }
    }

    return {
      fullText,
      provider: 'mistral',
      processingTime: performance.now() - startTime,
      tokenUsage
    };
  }

  /**
   * DeepSeek streaming implementation
   */
  private async callDeepseekWithStreaming(
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    abortSignal: AbortSignal,
    startTime: number
  ): Promise<LLMStreamResult> {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) throw new Error('DeepSeek API key not configured');

    if ((this as any).useSimulatedResponses) {
      return this.simulateStreamingResponse('deepseek', prompt, onChunk, startTime);
    }

    // Similar implementation to Grok (OpenAI-compatible)
    let fullText = '';
    let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const response = await axios.post('https://api.deepseek.com/v1/chat/completions', {
      model: 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      stream: true,
      temperature: 0.7,
      max_tokens: 4096
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      responseType: 'stream',
      signal: abortSignal
    });

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        if (abortSignal.aborted) return;
        
        const lines = chunk.toString().split('\n').filter(line => line.trim() !== '');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.substring(6);
            if (data === '[DONE]') {
              resolve({
                fullText,
                provider: 'deepseek',
                processingTime: performance.now() - startTime,
                tokenUsage
              });
              return;
            }
            
            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices[0]?.delta?.content;
              
              if (content) {
                fullText += content;
                
                onChunk({
                  text: content,
                  provider: 'deepseek',
                  tokenCount: content.split(' ').length,
                  finishReason: parsed.choices[0]?.finish_reason || null
                });
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      });

      response.data.on('error', reject);
      response.data.on('end', () => {
        resolve({
          fullText,
          provider: 'deepseek',
          processingTime: performance.now() - startTime,
          tokenUsage
        });
      });
    });
  }

  /**
   * Lambda streaming implementation
   */
  private async callLambdaWithStreaming(
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    abortSignal: AbortSignal,
    startTime: number
  ): Promise<LLMStreamResult> {
    const apiKey = process.env.LAMBDA_AI;
    if (!apiKey) throw new Error('Lambda AI API key not configured');

    if ((this as any).useSimulatedResponses) {
      return this.simulateStreamingResponse('lambda', prompt, onChunk, startTime);
    }

    // Custom Lambda AI streaming implementation
    let fullText = '';
    let tokenUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    const response = await axios.post('https://api.lambda.ai/v1/generate/stream', {
      prompt: prompt,
      model: 'lambda-large',
      stream: true
    }, {
      headers: {
        'x-api-key': apiKey,
        'Content-Type': 'application/json'
      },
      responseType: 'stream',
      signal: abortSignal
    });

    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk: Buffer) => {
        if (abortSignal.aborted) return;
        
        try {
          const data = JSON.parse(chunk.toString());
          const text = data.text || '';
          
          if (text) {
            fullText += text;
            
            onChunk({
              text,
              provider: 'lambda',
              tokenCount: text.split(' ').length,
              finishReason: data.finish_reason || null
            });
          }
          
          if (data.done) {
            resolve({
              fullText,
              provider: 'lambda',
              processingTime: performance.now() - startTime,
              tokenUsage
            });
          }
        } catch (e) {
          // Handle partial JSON or other formats
        }
      });

      response.data.on('error', reject);
      response.data.on('end', () => {
        resolve({
          fullText,
          provider: 'lambda',
          processingTime: performance.now() - startTime,
          tokenUsage
        });
      });
    });
  }

  /**
   * Simulate streaming response for testing
   */
  private async simulateStreamingResponse(
    provider: string,
    prompt: string,
    onChunk: (chunk: LLMStreamChunk) => void,
    startTime: number
  ): Promise<LLMStreamResult> {
    const fullText = `This is a simulated streaming response from ${provider}. The original prompt was: "${prompt.substring(0, 50)}..."`;
    const words = fullText.split(' ');
    
    for (let i = 0; i < words.length; i++) {
      const word = words[i] + (i < words.length - 1 ? ' ' : '');
      
      onChunk({
        text: word,
        provider: `${provider}-simulated`,
        tokenCount: 1,
        finishReason: i === words.length - 1 ? 'stop' : null
      });
      
      // Simulate typing delay
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    
    return {
      fullText,
      provider: `${provider}-simulated`,
      processingTime: performance.now() - startTime,
      tokenUsage: {
        promptTokens: prompt.split(' ').length,
        completionTokens: words.length,
        totalTokens: prompt.split(' ').length + words.length
      }
    };
  }

  /**
   * Interrupt active stream
   */
  interruptStream(streamId: string): boolean {
    const controller = this.activeStreams.get(streamId);
    if (controller) {
      controller.abort();
      this.activeStreams.delete(streamId);
      return true;
    }
    return false;
  }

  /**
   * Get active stream count
   */
  getActiveStreamCount(): number {
    return this.activeStreams.size;
  }

  /**
   * Clean up all active streams
   */
  cleanup(): void {
    for (const [streamId, controller] of this.activeStreams) {
      controller.abort();
    }
    this.activeStreams.clear();
  }
}

// Export singleton instance
export const llmStreamingRouter = new LLMStreamingRouter();

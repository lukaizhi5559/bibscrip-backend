/**
 * WebSocket streaming handler that integrates with existing REST API architecture
 * Handles real-time voice and conversation streaming without disrupting CRUD operations
 */

import WebSocket from 'ws';
import { llmStreamingRouter } from '../utils/llmStreamingRouter';
import {
  StreamingMessage,
  StreamingMessageType,
  LLMStreamRequest,
  VoiceSTTChunk,
  VoiceTTSRequest,
  ConversationContext,
  StreamingMetadata,
  StreamingError
} from '../types/streaming';
import { logger } from '../utils/logger';

export class StreamingHandler {
  private ws: WebSocket;
  private sessionId: string;
  private userId?: string;
  private clientId?: string;
  private conversationContext: ConversationContext;
  private activeRequests: Map<string, AbortController> = new Map();

  constructor(ws: WebSocket, sessionId: string, userId?: string, clientId?: string) {
    this.ws = ws;
    this.sessionId = sessionId;
    this.userId = userId;
    this.clientId = clientId;
    
    // Initialize conversation context
    this.conversationContext = {
      sessionId,
      userId,
      conversationHistory: [],
      localLLMCapabilities: ['simple_qa', 'intent_routing', 'context_switching'],
      backendLLMCapabilities: ['orchestration', 'code_generation', 'complex_reasoning', 'api_calls']
    };
  }

  /**
   * Handle incoming streaming message
   */
  async handleMessage(message: StreamingMessage): Promise<void> {
    const { type, id, payload } = message;
    
    try {
      switch (type) {
        case StreamingMessageType.LLM_REQUEST:
          await this.handleLLMRequest(id, payload as LLMStreamRequest, message.metadata);
          break;
          
        case StreamingMessageType.VOICE_STT_CHUNK:
          await this.handleVoiceSTTChunk(id, payload as VoiceSTTChunk, message.metadata);
          break;
          
        case StreamingMessageType.VOICE_TTS_REQUEST:
          await this.handleVoiceTTSRequest(id, payload as VoiceTTSRequest, message.metadata);
          break;
          
        case StreamingMessageType.CONVERSATION_START:
          await this.handleConversationStart(id, payload, message.metadata);
          break;
          
        case StreamingMessageType.INTERRUPT:
          await this.handleInterrupt(id, payload);
          break;
          
        case StreamingMessageType.CANCEL:
          await this.handleCancel(id, payload);
          break;
          
        case StreamingMessageType.HEARTBEAT:
          await this.handleHeartbeat(id);
          break;
          
        default:
          this.sendError(id, `Unknown message type: ${type}`);
      }
    } catch (error) {
      logger.error('Error handling streaming message:', error as any);
      this.sendError(id, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle LLM streaming request
   */
  private async handleLLMRequest(
    requestId: string,
    request: any, // Accept any payload structure from WebSocket
    metadata?: StreamingMetadata
  ): Promise<void> {
    const abortController = new AbortController();
    this.activeRequests.set(requestId, abortController);

    try {
      // Map WebSocket payload to LLMStreamRequest format
      const llmRequest: LLMStreamRequest = {
        prompt: request.message || request.prompt || '', // Support both 'message' and 'prompt' fields
        provider: request.provider,
        options: request.options || {}
      };

      // Validate that we have a prompt
      if (!llmRequest.prompt) {
        this.sendError(requestId, 'Missing message or prompt in request');
        return;
      }

      // Create streaming metadata
      const streamingMetadata: StreamingMetadata = {
        source: 'backend_llm',
        sessionId: this.sessionId,
        userId: this.userId,
        clientId: this.clientId,
        ...metadata
      };

      // Process with streaming
      const result = await llmStreamingRouter.processPromptWithStreaming(
        llmRequest,
        (chunk: StreamingMessage) => {
          // Forward streaming chunks to client
          if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(chunk));
          }
        },
        streamingMetadata
      );

      // Add to conversation history
      this.conversationContext.conversationHistory.push({
        id: requestId,
        role: 'user',
        content: llmRequest.prompt,
        timestamp: Date.now(),
        source: 'text'
      });

      this.conversationContext.conversationHistory.push({
        id: `${requestId}_response`,
        role: 'assistant',
        content: result.fullText,
        timestamp: Date.now(),
        source: 'text',
        metadata: {
          provider: result.provider,
          processingTime: result.processingTime
        }
      });

      // Keep conversation history manageable (last 20 messages)
      if (this.conversationContext.conversationHistory.length > 20) {
        this.conversationContext.conversationHistory = 
          this.conversationContext.conversationHistory.slice(-20);
      }

    } catch (error) {
      this.sendError(requestId, error instanceof Error ? error.message : String(error));
    } finally {
      this.activeRequests.delete(requestId);
    }
  }

  /**
   * Handle voice STT chunk
   */
  private async handleVoiceSTTChunk(
    requestId: string,
    chunk: VoiceSTTChunk,
    metadata?: StreamingMetadata
  ): Promise<void> {
    try {
      // Process STT chunk (integrate with your voice service)
      // This would typically involve:
      // 1. Accumulating audio chunks
      // 2. Running STT processing
      // 3. Returning transcribed text
      
      // For now, simulate STT processing
      const transcription = await this.processSTTChunk(chunk);
      
      if (transcription) {
        this.send({
          id: `${requestId}_stt_result`,
          type: StreamingMessageType.VOICE_STT_CHUNK,
          payload: {
            text: transcription.text,
            confidence: transcription.confidence,
            isFinal: transcription.isFinal
          },
          timestamp: Date.now(),
          parentId: requestId,
          metadata: {
            source: 'voice_service',
            ...metadata
          }
        });

        // If final transcription, potentially trigger LLM processing
        if (transcription.isFinal && transcription.text.trim()) {
          await this.handleLLMRequest(`${requestId}_llm`, {
            prompt: transcription.text,
            options: { taskType: 'conversation' }
          }, metadata);
        }
      }
    } catch (error) {
      this.sendError(requestId, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle voice TTS request
   */
  private async handleVoiceTTSRequest(
    requestId: string,
    request: VoiceTTSRequest,
    metadata?: StreamingMetadata
  ): Promise<void> {
    try {
      // Process TTS request (integrate with your voice service)
      // This would typically involve:
      // 1. Calling TTS service (ElevenLabs, OpenAI, etc.)
      // 2. Streaming audio chunks back to client
      
      // For now, simulate TTS processing
      const audioChunks = await this.processTTSRequest(request);
      
      for (const chunk of audioChunks) {
        this.send({
          id: `${requestId}_tts_chunk_${Date.now()}`,
          type: StreamingMessageType.VOICE_TTS_CHUNK,
          payload: chunk,
          timestamp: Date.now(),
          parentId: requestId,
          metadata: {
            source: 'voice_service',
            ...metadata
          }
        });
      }

      // Send TTS end signal
      this.send({
        id: `${requestId}_tts_end`,
        type: StreamingMessageType.VOICE_TTS_END,
        payload: { completed: true },
        timestamp: Date.now(),
        parentId: requestId,
        metadata: {
          source: 'voice_service',
          ...metadata
        }
      });

    } catch (error) {
      this.sendError(requestId, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle conversation start
   */
  private async handleConversationStart(
    requestId: string,
    payload: any,
    metadata?: StreamingMetadata
  ): Promise<void> {
    try {
      // Initialize or reset conversation context
      this.conversationContext.currentTopic = payload.topic;
      this.conversationContext.userPreferences = payload.preferences || {};
      
      this.send({
        id: `${requestId}_conversation_ready`,
        type: StreamingMessageType.CONVERSATION_START,
        payload: {
          sessionId: this.sessionId,
          capabilities: {
            local: this.conversationContext.localLLMCapabilities,
            backend: this.conversationContext.backendLLMCapabilities
          },
          ready: true
        },
        timestamp: Date.now(),
        metadata: {
          source: 'local_llm',
          ...metadata
        }
      });

    } catch (error) {
      this.sendError(requestId, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle interrupt request
   */
  private async handleInterrupt(requestId: string, payload: any): Promise<void> {
    try {
      const targetId = payload.targetId;
      
      if (targetId && this.activeRequests.has(targetId)) {
        const controller = this.activeRequests.get(targetId);
        controller?.abort();
        this.activeRequests.delete(targetId);
        
        this.send({
          id: `${requestId}_interrupt_success`,
          type: StreamingMessageType.INTERRUPT,
          payload: { interrupted: targetId, success: true },
          timestamp: Date.now(),
          metadata: { source: 'local_llm' }
        });
      } else {
        // Interrupt all active requests
        for (const [id, controller] of this.activeRequests) {
          controller.abort();
        }
        this.activeRequests.clear();
        
        this.send({
          id: `${requestId}_interrupt_all`,
          type: StreamingMessageType.INTERRUPT,
          payload: { interrupted: 'all', success: true },
          timestamp: Date.now(),
          metadata: { source: 'local_llm' }
        });
      }
    } catch (error) {
      this.sendError(requestId, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle cancel request
   */
  private async handleCancel(requestId: string, payload: any): Promise<void> {
    try {
      const targetId = payload.targetId;
      
      if (targetId && this.activeRequests.has(targetId)) {
        const controller = this.activeRequests.get(targetId);
        controller?.abort();
        this.activeRequests.delete(targetId);
        
        this.send({
          id: `${requestId}_cancel_success`,
          type: StreamingMessageType.CANCEL,
          payload: { cancelled: targetId, success: true },
          timestamp: Date.now(),
          metadata: { source: 'local_llm' }
        });
      } else {
        this.sendError(requestId, `Request ${targetId} not found or already completed`);
      }
    } catch (error) {
      this.sendError(requestId, error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Handle heartbeat
   */
  private async handleHeartbeat(requestId: string): Promise<void> {
    this.send({
      id: `${requestId}_heartbeat`,
      type: StreamingMessageType.HEARTBEAT,
      payload: {
        timestamp: Date.now(),
        activeRequests: this.activeRequests.size,
        sessionId: this.sessionId
      },
      timestamp: Date.now(),
      metadata: { source: 'local_llm' }
    });
  }

  /**
   * Send message to client
   */
  private send(message: StreamingMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error message to client
   */
  private sendError(requestId: string, message: string, code: string = 'STREAMING_ERROR'): void {
    const error: StreamingError = {
      code,
      message,
      recoverable: true
    };

    this.send({
      id: `${requestId}_error`,
      type: StreamingMessageType.ERROR,
      payload: error,
      timestamp: Date.now(),
      metadata: { source: 'local_llm' }
    });
  }

  /**
   * Process STT chunk (placeholder for actual STT integration)
   */
  private async processSTTChunk(chunk: VoiceSTTChunk): Promise<{
    text: string;
    confidence: number;
    isFinal: boolean;
  } | null> {
    // This would integrate with your actual STT service
    // For now, return a simulated result
    return {
      text: "This is simulated speech-to-text result",
      confidence: 0.95,
      isFinal: Math.random() > 0.7 // Randomly decide if final
    };
  }

  /**
   * Process TTS request (placeholder for actual TTS integration)
   */
  private async processTTSRequest(request: VoiceTTSRequest): Promise<Array<{
    audioData: string;
    format: string;
    sampleRate: number;
    channels: number;
    duration: number;
    isLast: boolean;
  }>> {
    // This would integrate with your actual TTS service
    // For now, return simulated audio chunks
    return [
      {
        audioData: "base64_encoded_audio_chunk_1",
        format: "wav",
        sampleRate: 44100,
        channels: 1,
        duration: 1000,
        isLast: false
      },
      {
        audioData: "base64_encoded_audio_chunk_2",
        format: "wav",
        sampleRate: 44100,
        channels: 1,
        duration: 1000,
        isLast: true
      }
    ];
  }

  /**
   * Get conversation context
   */
  getConversationContext(): ConversationContext {
    return this.conversationContext;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // Abort all active requests
    for (const [id, controller] of this.activeRequests) {
      controller.abort();
    }
    this.activeRequests.clear();
    
    // Clean up streaming router
    llmStreamingRouter.cleanup();
  }
}

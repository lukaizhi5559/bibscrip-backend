/**
 * WebSocket streaming handler that integrates with existing REST API architecture
 * Handles real-time voice and conversation streaming without disrupting CRUD operations
 */

import WebSocket from 'ws';
import { llmStreamingRouter } from '../utils/llmStreamingRouter';
// Intent classification is now handled on the frontend
// import { websocketIntentService, WebSocketIntentResult } from '../services/websocketIntentService';
// import { aiMemoryService } from '../services/aiMemoryService';
import { buildPrompt } from '../services/promptBuilder';
import { v4 as uuidv4 } from 'uuid';
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
// import { WebSocketMemoryPayload } from '../types/aiMemory';
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
    request: LLMStreamRequest,
    metadata?: StreamingMetadata
  ): Promise<void> {
    const abortController = new AbortController();
    this.activeRequests.set(requestId, abortController);

    try {
      // Create streaming metadata
      const streamingMetadata: StreamingMetadata = {
        source: 'backend_llm',
        sessionId: this.sessionId,
        userId: this.userId,
        clientId: this.clientId,
        ...metadata
      };

      // Extract clean user message from prompt (remove JSON metadata if present)
      const cleanMessage = this.extractCleanMessage(request.prompt);
      
      logger.info(`🧹 Cleaned message for ${requestId}:`, {
        originalLength: request.prompt.length,
        cleanedLength: cleanMessage.length,
        originalPreview: request.prompt.substring(0, 100),
        cleanedPreview: cleanMessage.substring(0, 100)
      });
      
      // Add current user message to conversation history BEFORE building prompt
      this.conversationContext.conversationHistory.push({
        id: requestId,
        role: 'user',
        content: cleanMessage,
        timestamp: Date.now(),
        source: 'text'
      });
      
      // Build Thinkdrop AI context-aware prompt with frontend context
      logger.info(`🔧 Building Thinkdrop AI context-aware prompt for request ${requestId}`);
      logger.info(`📋 Context debug for ${requestId}:`, {
        internalHistoryCount: this.conversationContext.conversationHistory?.length || 0,
        frontendContextCount: request.context?.recentContext?.length || 0,
        sessionFactsCount: request.context?.sessionFacts?.length || 0,
        sessionEntitiesCount: request.context?.sessionEntities?.length || 0,
        memoriesCount: request.context?.memories?.length || 0,
        webSearchResultsCount: request.context?.webSearchResults?.length || 0,
        hasSystemInstructions: !!request.context?.systemInstructions
      });
      
      const enhancedPrompt = await this.buildThinkdropAIPrompt(cleanMessage, request.context);
      
      logger.info(`📝 Enhanced prompt built for ${requestId}:`, {
        originalLength: request.prompt.length,
        enhancedLength: enhancedPrompt.length,
        originalPrompt: request.prompt.substring(0, 100),
        enhancedPromptPreview: enhancedPrompt.substring(0, 200)
      });
      
      // Create enhanced request with Thinkdrop AI context
      const enhancedRequest: LLMStreamRequest = {
        ...request,
        prompt: enhancedPrompt
      };

      // Process with streaming using context-enriched prompt
      logger.info(`🚀 Starting LLM streaming for request ${requestId}`);
      const result = await llmStreamingRouter.processPromptWithStreaming(
        enhancedRequest,
        (chunk: StreamingMessage) => {
          // Forward streaming chunks to client
          logger.info(`📦 Streaming chunk for ${requestId}:`, {
            type: chunk.type,
            hasPayload: !!chunk.payload,
            payloadPreview: typeof chunk.payload === 'string' ? chunk.payload.substring(0, 100) : 'non-string'
          });
          
          if (this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(chunk));
          }
        },
        streamingMetadata
      );

      // Ensure llm_stream_end is always sent (backup mechanism)
      logger.info(`✅ LLM streaming completed for ${requestId}, sending explicit end signal`);
      if (this.ws.readyState === WebSocket.OPEN) {
        this.send({
          id: `${requestId}_stream_end`,
          type: StreamingMessageType.LLM_STREAM_END,
          payload: {
            fullText: result.fullText,
            provider: result.provider,
            processingTime: result.processingTime,
            tokenUsage: result.tokenUsage,
            completed: true
          },
          timestamp: Date.now(),
          parentId: requestId,
          metadata: {
            ...streamingMetadata,
            provider: result.provider,
            source: 'backend_llm'
          }
        });
      }

      // Add assistant response to conversation history
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

  // Intent classification and memory storage are now handled on the frontend
  // These methods have been removed: evaluateIntentInBackground, evaluateIntentInParallel, storeIntentMemory

  /**
   * Build prompt specifically for Thinkdrop AI context awareness
   * Makes the LLM aware of what Thinkdrop AI can do without complex intent classification
   * Now processes rich frontend context including facts, entities, memories, and web search results
   */
  private async buildThinkdropAIPrompt(message: string, context?: any): Promise<string> {
    // Extract all context components from frontend
    const recentContext = context?.recentContext || [];
    const sessionFacts = context?.sessionFacts || [];
    const sessionEntities = context?.sessionEntities || [];
    const memories = context?.memories || [];
    const webSearchResults = context?.webSearchResults || [];
    const systemInstructions = context?.systemInstructions || '';
    
    logger.info(`🔍 [buildThinkdropAIPrompt] Context analysis:`, {
      recentContextCount: recentContext.length,
      sessionFactsCount: sessionFacts.length,
      sessionEntitiesCount: sessionEntities.length,
      memoriesCount: memories.length,
      webSearchResultsCount: webSearchResults.length,
      hasSystemInstructions: !!systemInstructions,
      contextPreview: recentContext.slice(-3).map((h: any) => `${h.role}: ${h.content?.substring(0, 100)}...`)
    });
    
    // Build conversation history context
    const historyContext = recentContext.length > 0 
      ? `\n\nRecent Conversation History:\n${recentContext.slice(-8).map((h: any) => `${h.role}: ${h.content}`).join('\n')}` 
      : '';
    
    // Build session facts context
    const factsContext = sessionFacts.length > 0
      ? `\n\nSession Facts (extracted from this conversation):\n${sessionFacts.map((f: any) => `- ${f.fact} (confidence: ${f.confidence})`).join('\n')}`
      : '';
    
    // Build session entities context
    const entitiesContext = sessionEntities.length > 0
      ? `\n\nSession Entities (mentioned in this conversation):\n${sessionEntities.map((e: any) => `- ${e.entity} (${e.type})${e.value ? `: ${e.value}` : ''}`).join('\n')}`
      : '';
    
    // Build memories context
    const memoriesContext = memories.length > 0
      ? `\n\nRelevant User Memories (from past conversations):\n${memories.map((m: any) => `- ${m.content}${m.relevance ? ` (relevance: ${m.relevance})` : ''}`).join('\n')}`
      : '';
    
    // Build web search results context
    const webSearchContext = webSearchResults.length > 0
      ? `\n\nWeb Search Results (current information):\n${webSearchResults.map((r: any, i: number) => `${i + 1}. ${r.title}\n   ${r.snippet}\n   Source: ${r.url}`).join('\n\n')}`
      : '';
    
    // Build system instructions context
    const systemInstructionsContext = systemInstructions
      ? `\n\nSystem Instructions:\n${systemInstructions}`
      : '';
      
    if (recentContext.length === 0 && sessionFacts.length === 0 && memories.length === 0) {
      logger.warn(`⚠️ [buildThinkdropAIPrompt] Minimal context available for message: ${message.substring(0, 50)}...`);
    }

    // Minimal response guidance - frontend systemInstructions already provide detailed guidance
    const responseGuidance = '';

    // Determine if web search is needed based on query type
    const needsWebSearch = this.shouldEnableWebSearch(message);
    
    // Use the centralized prompt builder with conditional web search
    const basePrompt = await buildPrompt('ask', {
      userQuery: message,
      context: {
        responseLength: 'medium',
        enableWebSearch: needsWebSearch,
      }
    });
    
    // Streamlined prompt - frontend systemInstructions already provide detailed guidance
    const enhancedPrompt = `
You are **Thinkdrop AI**, a proactive, emotionally intelligent personal assistant.

**Core Capabilities:**
- 📸 Take screenshots and analyze screen content
- 🧠 Access user memories and conversation history
- 🌐 Monitor desktop & browser activity
- 🎯 Automate system tasks (mouse/keyboard control)
- ⏰ Send reminders and notifications
- 📖 Provide biblical guidance and spiritual insights
- 💬 Converse naturally with emotional intelligence

**Agent Recommendations:**
Suggest creating agents (Drops) for recurring, multi-tool, or complex workflow tasks.

**Reasoning Techniques:**
Use Chain of Thought, Few-shot prompting, Self-consistency, or Tree of Thought when helpful.

${basePrompt}

User Message: "${message}"${historyContext}${factsContext}${entitiesContext}${memoriesContext}${webSearchContext}${systemInstructionsContext}
`.trim();
    
    return enhancedPrompt;
  }  

  /**
   * Get conversation context
   */
  getConversationContext(): ConversationContext {
    return this.conversationContext;
  }

  /**
   * Extract clean user message from prompt (remove JSON metadata)
   */
  private extractCleanMessage(prompt: string): string {
    // Check if prompt contains JSON metadata (common pattern from frontend)
    const jsonPattern = /\n\n\{["']sessionId["']:/;
    
    if (jsonPattern.test(prompt)) {
      // Extract only the message before the JSON
      const parts = prompt.split(/\n\n\{/);
      return parts[0].trim();
    }
    
    return prompt.trim();
  }
  
  /**
   * Determine if web search should be enabled for this query
   */
  private shouldEnableWebSearch(message: string): boolean {
    const lower = message.toLowerCase();
    
    // Disable web search for code/technical questions
    const codePatterns = [
      /\b(function|method|class|variable|code|syntax|error|bug|debug)\b/i,
      /\b(write|refactor|optimize|improve).*\b(code|function|method|class)\b/i,
      /\bhow (to|do i|can i).*(code|program|implement|write|create)\b/i,
      /\b(javascript|typescript|python|java|react|node|api)\b/i,
      /\bscreen\b.*\b(corner|bottom|top|left|right|content|element)\b/i,
      /\bwhat('?s| is) (at|on|in) (the|my) (screen|display|monitor)\b/i
    ];
    
    // If it matches code patterns, disable web search
    if (codePatterns.some(pattern => pattern.test(message))) {
      logger.info(`🚫 Web search disabled for code/technical query: ${message.substring(0, 50)}...`);
      return false;
    }
    
    // Enable web search for current events, news, etc.
    const webSearchPatterns = [
      /\b(latest|recent|current|today|news|update|happening)\b/i,
      /\b(weather|stock|price|score)\b/i,
      /\bwhat (day|time|date) is (it|today)\b/i
    ];
    
    const shouldEnable = webSearchPatterns.some(pattern => pattern.test(message));
    
    if (shouldEnable) {
      logger.info(`✅ Web search enabled for current events query: ${message.substring(0, 50)}...`);
    }
    
    return shouldEnable;
  }
  
  /**
   * Validate if a string is a valid UUID
   */
  private isValidUUID(uuid: string): boolean {
    // Regular expression to check if string is a valid UUID
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
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

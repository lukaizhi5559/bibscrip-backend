/**
 * WebSocket streaming handler that integrates with existing REST API architecture
 * Handles real-time voice and conversation streaming without disrupting CRUD operations
 */

import WebSocket from 'ws';
import { llmStreamingRouter } from '../utils/llmStreamingRouter';
import { websocketIntentService, WebSocketIntentResult } from '../services/websocketIntentService';
import { aiMemoryService } from '../services/aiMemoryService';
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
import { WebSocketMemoryPayload } from '../types/aiMemory';
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

      // Start intent classification in parallel (don't await - let it run alongside streaming)
      const intentPromise = this.evaluateIntentInBackground(requestId, request.prompt);
      
      // Build Thinkdrop AI context-aware prompt
      logger.info(`🔧 Building Thinkdrop AI context-aware prompt for request ${requestId}`);
      const enhancedPrompt = await this.buildThinkdropAIPrompt(request.prompt, {
        conversationHistory: this.conversationContext.conversationHistory || [],
        userId: this.userId,
        sessionId: this.sessionId
      });
      
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

      // Wait for intent classification to complete and send results
      logger.info(`🎯 Waiting for intent classification to complete for request ${requestId}`);
      try {
        const intentResult = await intentPromise;
        
        if (intentResult) {
          // Send intent classification results to client after streaming completes
          this.send({
            id: `${requestId}_intent`,
            type: StreamingMessageType.INTENT_CLASSIFICATION,
            payload: {
              intents: intentResult.intents,
              primaryIntent: intentResult.primaryIntent,
              entities: intentResult.entities,
              requiresMemoryAccess: intentResult.requiresMemoryAccess,
              requiresExternalData: intentResult.requiresExternalData,
              captureScreen: intentResult.captureScreen,
              queryType: intentResult.queryType,
              suggestedResponse: intentResult.suggestedResponse,
              sourceText: intentResult.sourceText
            },
            timestamp: Date.now(),
            metadata: {
              source: 'intent_evaluation',
              confidence: intentResult.intents[0]?.confidence || 0
            }
          });
          
          logger.info(`📤 Intent classification sent after streaming for request ${requestId}:`, {
            primaryIntent: intentResult.primaryIntent,
            totalIntents: intentResult.intents.length,
            intents: intentResult.intents.map(i => `${i.intent}(${i.confidence})`)
          });
        }
      } catch (error) {
        logger.error(`Failed to complete intent classification for request ${requestId}:`, {
          error,
          message: error instanceof Error ? error.message : String(error)
        });
      }

      // Add to conversation history
      this.conversationContext.conversationHistory.push({
        id: requestId,
        role: 'user',
        content: request.prompt,
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
   * Evaluate intent in background while streaming runs in parallel
   * Returns the intent result to be sent after streaming completes
   */
  private async evaluateIntentInBackground(requestId: string, prompt: string): Promise<WebSocketIntentResult | null> {
    try {
      logger.info(`🔍 Starting background intent evaluation for: "${prompt.substring(0, 100)}..."`);
      
      const intentResult = await websocketIntentService.evaluateIntent(prompt);
      
      logger.info(`✅ Intent evaluation completed in background:`, {
        primaryIntent: intentResult.primaryIntent,
        totalIntents: intentResult.intents.length
      });
      
      // Store intent classification in AI Memory (async, non-blocking)
      this.storeIntentMemory(requestId, prompt, intentResult).catch((memoryError: any) => {
        logger.error(`⚠️ Failed to store intent memory for ${requestId}:`, memoryError);
        // Memory storage failure doesn't affect the main flow
      });
      
      return intentResult;
    } catch (intentError) {
      logger.error(`❌ Background intent evaluation failed for request ${requestId}:`, {
        error: intentError,
        message: (intentError as any)?.message,
        stack: (intentError as any)?.stack
      });
      return null;
    }
  }

  /**
   * Evaluate intent in parallel without blocking LLM streaming (deprecated - keeping for reference)
   */
  private async evaluateIntentInParallel(requestId: string, prompt: string): Promise<void> {
    try {
      logger.info(`🔍 Starting parallel intent evaluation for: "${prompt.substring(0, 100)}..."`);
      
      const intentResult = await websocketIntentService.evaluateIntent(prompt);
      
      logger.info(`✅ Intent evaluation completed:`, {
        primaryIntent: intentResult.primaryIntent,
        totalIntents: intentResult.intents.length
      });
      
      // Send intent classification results to client
      this.send({
        id: `${requestId}_intent`,
        type: StreamingMessageType.INTENT_CLASSIFICATION,
        payload: {
          intents: intentResult.intents,
          primaryIntent: intentResult.primaryIntent,
          entities: intentResult.entities,
          requiresMemoryAccess: intentResult.requiresMemoryAccess,
          requiresExternalData: intentResult.requiresExternalData,
          captureScreen: intentResult.captureScreen, // Include screen capture flag
          queryType: intentResult.queryType, // Add queryType for frontend routing
          suggestedResponse: intentResult.suggestedResponse,
          sourceText: intentResult.sourceText
        },
        timestamp: Date.now(),
        metadata: {
          source: 'intent_evaluation',
          confidence: intentResult.intents[0]?.confidence || 0
        }
      });
      
      // Store intent classification in AI Memory (async, non-blocking)
      this.storeIntentMemory(requestId, prompt, intentResult).catch((memoryError: any) => {
        logger.error(`⚠️ Failed to store intent memory for ${requestId}:`, memoryError);
        // Memory storage failure doesn't affect the main flow
      });
      
      logger.info(`📤 Intent classification sent for request ${requestId}:`, {
        primaryIntent: intentResult.primaryIntent,
        totalIntents: intentResult.intents.length,
        intents: intentResult.intents.map(i => `${i.intent}(${i.confidence})`)
      });
    } catch (intentError) {
      logger.error(`❌ Parallel intent evaluation failed for request ${requestId}:`, {
        error: intentError,
        message: (intentError as any)?.message,
        stack: (intentError as any)?.stack
      });
      // Intent evaluation failure doesn't affect LLM streaming
    }
  }

  /**
   * Store intent classification results in AI Memory
   */
  private async storeIntentMemory(
    requestId: string,
    prompt: string,
    intentResult: WebSocketIntentResult
  ): Promise<void> {
    try {
      // Extract user ID from connection metadata or generate a valid UUID for anonymous users
      let userId = this.conversationContext.userId;
      
      // Check if userId is a valid UUID, if not generate one
      // This handles cases where userId is undefined, 'anonymous', 'default-user', etc.
      if (!userId || !this.isValidUUID(userId)) {
        // Generate a consistent UUID based on sessionId for the same anonymous user
        // This ensures the same anonymous user gets the same UUID in a session
        userId = this.sessionId ? 
          uuidv4({ random: Array.from(this.sessionId).map(c => c.charCodeAt(0)) }) : 
          uuidv4(); // Fallback to completely random UUID
        
        logger.info(`🔄 Generated UUID for non-UUID userId: ${userId}`);
      }
      
      // Prepare memory payload
      const memoryPayload: WebSocketMemoryPayload = {
        source_text: prompt,
        primary_intent: intentResult.primaryIntent,
        intents: intentResult.intents.map(intent => ({
          intent: intent.intent,
          confidence: intent.confidence,
          reasoning: intent.reasoning
        })),
        entities: intentResult.entities || [],
        requires_memory_access: intentResult.requiresMemoryAccess || false,
        requires_external_data: intentResult.requiresExternalData || false,
        suggested_response: intentResult.suggestedResponse,
        session_metadata: {
          request_id: requestId,
          session_id: this.conversationContext.sessionId,
          client_id: this.conversationContext.sessionId, // Using sessionId as clientId fallback
          timestamp: new Date().toISOString(),
          websocket_connection: true
        }
      };
      
      // Store in AI Memory
      const storedMemory = await aiMemoryService.storeWebSocketMemory(userId, memoryPayload);
      
      logger.info(`🧠 AI memory stored successfully:`, {
        memoryId: storedMemory.memory.id,
        userId,
        requestId,
        primaryIntent: intentResult.primaryIntent,
        intentsCount: intentResult.intents.length,
        entitiesCount: intentResult.entities?.length || 0
      });
      
    } catch (error) {
      logger.error(`❌ Failed to store AI memory:`, {
        requestId,
        error,
        message: (error as any)?.message
      });
      // Don't throw - memory storage failure shouldn't break the main flow
    }
  }

  /**
   * Build prompt specifically for Thinkdrop AI context awareness
   * Makes the LLM aware of what Thinkdrop AI can do without complex intent classification
   */
  private async buildThinkdropAIPrompt(message: string, context?: Record<string, any>): Promise<string> {
    const conversationHistory = context?.conversationHistory || [];
    const historyContext = conversationHistory.length > 0 
      ? `\n\nRecent Conversation History:\n${conversationHistory.slice(-5).map((h: any) => `${h.role}: ${h.content}`).join('\n')}`
      : '';

    // Use strong positive response guidance to enforce short responses
    const queryTypeGuidance = `
**CRITICAL: YOU MUST RESPOND WITH EXACTLY 1-5 WORDS ONLY**

VALID RESPONSES (choose one):
- "I'm on it!"
- "Got it!"
- "Sure thing!"
- "Absolutely!"
- "Let me help!"

**FORBIDDEN:**
- Long explanations
- Questions back to user
- Multiple sentences
- Detailed responses

**YOUR RESPONSE MUST BE UNDER 10 WORDS TOTAL**`;
  
    return `
  You are **Thinkdrop AI**, a proactive, emotionally intelligent personal assistant.
  
  ${queryTypeGuidance}
  
  You *can directly perform* the following actions **without asking the user to create agents**:
  - 📸 **Take screenshots** of the desktop, browser, or specific regions
  - 🧠 **Read and update memory**: store, retrieve, delete, and update long-term user memories using local and online context
  - 🌐 **Understand desktop & browser activity**: read screen content, monitor recent browser history and app usage
  - 🎯 **Control the system**: simulate mouse/keyboard actions to automate user tasks
  - ⏰ **Send proactive reminders**, notifications, or messages
  - 📖 **Provide biblical guidance**, devotionals, and spiritual insights
  - 💬 **Converse naturally** with emotional intelligence and adaptive reasoning
  
  You can also **recommend agents (Drops)** when:
  - A task is ongoing, recurring, or spans multiple tools (e.g., “monitor email and auto-respond”)
  - The user wants something scalable, repeatable, or requires complex workflow orchestration
  
 You are allowed and encouraged to use reasoning techniques like:

  - **Chain of Thought (CoT)**  
    *Think step-by-step to solve multi-part tasks*  
    **Example:**  
    User: “Remind me to call Mom every Sunday.”  
    You: “Sure. Step 1: Create a recurring reminder for Sunday. Step 2: Add the label 'Call Mom'. Step 3: Confirm it in your reminders list. Done!”

  - **Few-shot prompting**  
    *Use a past example to clarify a current request*  
    **Example:**  
    User: “Schedule a devotion like last week.”  
    You: “Got it! Last week you had a morning devotional at 7AM with Psalm 23. Shall I use the same time and theme?”

  - **Self-consistency**  
    *Try multiple thoughts, compare them, and choose the best*  
    **Example:**  
    User: “What’s the best time to schedule focus work?”  
    You: “One thought: Mornings (most productive). Another: Late evenings (quiet time). Given your previous behavior, mornings may be ideal. Let’s set it for 9AM.”

  - **Tree of Thought (ToT)**  
    *Explore different paths when there are branches of reasoning*  
    **Example:**  
    User: “How can I stay spiritually balanced while working remote?”  
    You:  
    “Let’s explore:  
    - Branch 1: Structured daily devotionals  
    - Branch 2: AI reminders for prayer breaks  
    - Branch 3: Weekly digital fellowship sessions  
    I recommend starting with daily devotionals and adding reminders. Want help setting that up?”

  User Message:
  "${message}"${historyContext}
  
  **REMEMBER: RESPOND WITH ONLY 1-5 WORDS. NO EXCEPTIONS.**
  
  Examples of CORRECT responses:
  - "Got it!"
  - "I'm on it!"
  - "Sure thing!"
  - "Absolutely!"
  
  Examples of WRONG responses (TOO LONG):
  - "Sure thing! It seems that we haven't discussed..."
  - "I can help you with that. Let me..."
  - Any response longer than 5 words
  
  **STOP AFTER YOUR SHORT RESPONSE. DO NOT CONTINUE.**
  `.trim();
  }  

  /**
   * Get conversation context
   */
  getConversationContext(): ConversationContext {
    return this.conversationContext;
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

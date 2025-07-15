/**
 * WebSocket Intent Evaluation Service
 * Classifies incoming WebSocket messages into specific intent categories
 */

import { buildPrompt } from './promptBuilder';
import { llmStreamingRouter } from '../utils/llmStreamingRouter';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';
import { smartPromptBuilder } from './smartPromptBuilder';

export type WebSocketIntentType = 
  | 'memory_store'
  | 'memory_retrieve' 
  | 'memory_update'
  | 'memory_delete'
  | 'greeting'
  | 'question'
  | 'command';

export interface WebSocketIntentResult {
  intents: Array<{
    intent: WebSocketIntentType;
    confidence: number;
    reasoning?: string;
  }>;
  entities?: string[];
  requiresMemoryAccess?: boolean;
  requiresExternalData?: boolean;
  suggestedResponse?: string;
  sourceText?: string;
  primaryIntent: WebSocketIntentType;
  captureScreen?: boolean;
}

export interface WebSocketIntentOptions {
  provider?: string;
  timeout?: number;
  context?: {
    conversationHistory?: Array<{ role: string; content: string }>;
    userPreferences?: Record<string, any>;
    sessionContext?: Record<string, any>;
  };
}

export class WebSocketIntentService {
  /**
   * Evaluate the intent of a WebSocket message
   */
  async evaluateIntent(
    message: string, 
    options: WebSocketIntentOptions = {}
  ): Promise<WebSocketIntentResult> {
    try {
      const prompt = await this.buildWebSocketIntentPrompt(message, options.context);
      
      // Use the streaming router for intent classification
      const result = await llmStreamingRouter.processPromptWithStreaming(
        {
          prompt,
          provider: options.provider || 'openai',
          options: { 
            maxTokens: 500 // Keep response concise for intent classification
          }
        },
        () => {}, // No streaming needed for intent classification
        {
          source: 'backend_llm',
          sessionId: 'intent_eval',
          clientId: 'intent_service'
        }
      );

      if (!result.fullText) {
        throw new Error('Failed to get LLM response for intent evaluation');
      }

      logger.info('Intent classification result:', { fullText: result.fullText });
      return this.parseIntentResponse(result.fullText, message);
    } catch (error) {
      logger.info('LLM intent classification failed, using fallback:', { error: (error as Error).message });
      
      // Fallback to rule-based classification
      return this.fallbackIntentClassification(message);
    }
  }

  /**
   * Build prompt specifically for WebSocket intent classification
   * Enhanced with SmartPromptBuilder contextual intelligence
   */
  private async buildWebSocketIntentPrompt(message: string, context?: Record<string, any>): Promise<string> {
    const conversationHistory = context?.conversationHistory || [];
    const historyContext = conversationHistory.length > 0 
      ? `\n\nConversation History:\n${conversationHistory.map((h: any) => `${h.role}: ${h.content}`).join('\n')}`
      : '';

    // Get SmartPromptBuilder contextual enhancements
    let contextualEnhancements;
    try {
      const userId = context?.userPreferences?.userId;
      if (userId) {
        contextualEnhancements = await smartPromptBuilder.getContextualEnhancements(message, userId, context);
        logger.info('SmartPromptBuilder enhancements loaded for WebSocket intent classification', {
          userId,
          memoryMatches: contextualEnhancements.memoryMatches.length,
          ragContextSize: contextualEnhancements.ragContextArray.length,
          complexity: contextualEnhancements.complexityAnalysis.level
        });
      }
    } catch (error) {
      logger.warn('Failed to load SmartPromptBuilder enhancements, using basic WebSocket prompt', {
        error: error instanceof Error ? error.message : String(error)
      });
    }

    // Build enhanced prompt with contextual intelligence
    let enhancedPrompt = `
You are Thinkdrop AI's intent classifier for WebSocket messages. Analyze the user's message and identify ALL applicable intents - messages can have multiple intents simultaneously.`;

    // Add contextual memory summary if available
    if (contextualEnhancements?.contextualMemory) {
      enhancedPrompt += `

**User Context & Memory:**
${contextualEnhancements.contextualMemory}`;
    }

    // Add message complexity analysis if available
    if (contextualEnhancements?.complexityAnalysis) {
      enhancedPrompt += `

**Message Complexity:** ${contextualEnhancements.complexityAnalysis.level} (${contextualEnhancements.complexityAnalysis.score.toFixed(2)})`;
    }

    // Add relevant RAG context if available
    if (contextualEnhancements?.ragContextArray && contextualEnhancements.ragContextArray.length > 0) {
      const topRagContext = contextualEnhancements.ragContextArray.slice(0, 2);
      enhancedPrompt += `

**Relevant Context:**
${topRagContext.map(ctx => `- ${ctx.text || ctx.content || ctx}`).join('\n')}`;
    }

    enhancedPrompt += `

**Intent Categories:**
- **memory_store**: User wants to save/store information OR is sharing personal information, facts, experiences, preferences, plans, tasks, intentions, activities, or any data about themselves, their life, or their future actions (e.g., "I need to buy snacks", "I'm going to the gym", "My favorite color is blue")
- **memory_retrieve**: User wants to recall/find previously stored information
- **memory_update**: User wants to modify/edit existing stored information
- **memory_delete**: User wants to remove/delete stored information
- **greeting**: User is greeting, saying hello, or starting conversation
- **question**: User is asking a question that requires an informative answer
- **command**: User is giving a command or instruction to perform an action (e.g., "take a picture", "screenshot this", "capture my screen", "do something")

**IMPORTANT**: You MUST only use these 7 intent types. Do NOT create new intent types like "general_query" or "other". Every message must be classified as one of these 7 types.

**Screen Capture Detection:**
Set "captureScreen": true if the user's message indicates they need visual context or want to capture/store the current page, such as:
- "I need help understand this page"
- "guide me through this"
- "store/capture this page for later"
- "what is this all about"
- "explain what I'm looking at"
- "save this screen"
- "help me with this interface"
- "take a picture of my screen"
- "take a screenshot"
- "screenshot this"
- "capture my screen"
- "snap a picture of what I'm seeing"
- "picture of my display"
- "what am I looking at here"
- "help me understand what's on my screen"
- Any request that would benefit from seeing the current screen/page or involves capturing visual content

User Message: "${message}"${historyContext}

**Examples:**
- "Hello, I have appt. at 3pm next week that I need you to email to my wife" → intents: ["greeting", "memory_store", "command"]
- "I need to buy some snacks today" → intents: ["memory_store"] (personal plan/task to remember)
- "I'm going to the gym after work" → intents: ["memory_store"] (personal activity plan)
- "I ate salad and green beans for breakfast" → intents: ["memory_store"] (sharing personal dietary information)
- "My favorite color is blue" → intents: ["memory_store"] (sharing personal preference)
- "I have a meeting tomorrow at 2pm" → intents: ["memory_store"] (personal schedule information)
- "Open Spotify" → intents: ["command"] (pure command, no personal info to store)
- "Play my workout playlist on Spotify" → intents: ["command", "memory_store"] (command + personal preference about playlists)
- "Send an email to john@example.com" → intents: ["command"] (pure command)
- "Email my mom about the dinner plans" → intents: ["command", "memory_store"] (command + personal relationship info)
- "Take a picture of my screen" → intents: ["command"], captureScreen: true (screen capture command)
- "Help me understand this page" → intents: ["question"], captureScreen: true (question requiring visual context)

Analyze the message and respond in this exact JSON format:
{
  "intents": [
    {
      "intent": "greeting",
      "confidence": 0.95,
      "reasoning": "Message starts with greeting"
    },
    {
      "intent": "memory_store", 
      "confidence": 0.90,
      "reasoning": "User wants to store appointment information"
    },
    {
      "intent": "command",
      "confidence": 0.85,
      "reasoning": "User requests email action to be performed"
    }
  ],
  "primaryIntent": "command",
  "entities": ["appointment", "3pm", "next week", "email", "wife"],
  "requiresMemoryAccess": true,
  "requiresExternalData": false,
  "captureScreen": false,
  "suggestedResponse": "Acknowledge greeting, confirm appointment storage, and execute email command",
  "sourceText": "Hello, I have appt. at 3pm next week that I need you to email to my wife"
}

Identify ALL applicable intents with individual confidence scores. The primaryIntent should be the most important/actionable intent.
    `.trim();

    return enhancedPrompt;
  }

  /**
   * Parse LLM response to extract intent classification
   */
  private parseIntentResponse(response: string, originalMessage: string): WebSocketIntentResult {
    try {
      // Try to extract JSON from the response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const parsed = JSON.parse(jsonMatch[0]);
      
      // Validate the intent types
      const validIntents: WebSocketIntentType[] = [
        'memory_store', 'memory_retrieve', 'memory_update', 'memory_delete',
        'greeting', 'question', 'command'
      ];

      // Validate intents array
      if (!parsed.intents || !Array.isArray(parsed.intents)) {
        throw new Error('Invalid intents array in response');
      }

      // Validate each intent
      for (const intentObj of parsed.intents) {
        if (!validIntents.includes(intentObj.intent)) {
          throw new Error(`Invalid intent type: ${intentObj.intent}`);
        }
      }

      // Validate primary intent
      if (!validIntents.includes(parsed.primaryIntent)) {
        throw new Error(`Invalid primary intent type: ${parsed.primaryIntent}`);
      }

      logger.info(`Intent classification completed: ${parsed.primaryIntent} with ${parsed.intents.length} total intents`);

      return {
        intents: parsed.intents.map((intentObj: any) => ({
          intent: intentObj.intent,
          confidence: intentObj.confidence || 0.8,
          reasoning: intentObj.reasoning || ''
        })),
        primaryIntent: parsed.primaryIntent,
        entities: parsed.entities || [],
        requiresMemoryAccess: parsed.requiresMemoryAccess || false,
        requiresExternalData: parsed.requiresExternalData || false,
        captureScreen: parsed.captureScreen || false,
        suggestedResponse: parsed.suggestedResponse || '',
        sourceText: parsed.sourceText || ''
      };
    } catch (error) {
      logger.warn('Failed to parse intent response, using fallback:', error as any);
      return this.fallbackIntentClassification(originalMessage);
    }
  }

  /**
   * Fallback rule-based intent classification when LLM fails
   */
  private fallbackIntentClassification(message: string): WebSocketIntentResult {
    const lowerMessage = message.toLowerCase().trim();
    const detectedIntents: Array<{ intent: WebSocketIntentType; confidence: number; reasoning: string }> = [];
    
    // Check for greeting patterns
    if (/^(hi|hello|hey|good morning|good afternoon|good evening|greetings)/.test(lowerMessage)) {
      detectedIntents.push({
        intent: 'greeting',
        confidence: 0.9,
        reasoning: 'Message starts with greeting pattern'
      });
    }

    // Check for memory store patterns - both explicit and implicit
    if (/(remember|save|store|note|record|keep track)/.test(lowerMessage)) {
      detectedIntents.push({
        intent: 'memory_store',
        confidence: 0.8,
        reasoning: 'Contains explicit memory storage keywords'
      });
    }
    
    // Check for implicit personal information sharing patterns
    const personalInfoPatterns = [
      /\b(i|my|me|i'm|i am|i've|i have)\s+(ate|had|like|love|prefer|enjoy|did|went|saw|bought|made|feel|felt|think|believe|want|need)/i,
      /\b(my|our)\s+(favorite|name|age|birthday|job|work|family|friend|pet|hobby|interest)/i,
      /\b(i|we)\s+(live|work|study|go to|come from|was born)/i,
      /\b(yesterday|today|this morning|last night|last week)\s+(i|we)\s+/i
    ];
    
    if (personalInfoPatterns.some(pattern => pattern.test(lowerMessage)) && 
        !detectedIntents.some(i => i.intent === 'memory_store')) {
      detectedIntents.push({
        intent: 'memory_store',
        confidence: 0.75,
        reasoning: 'User is sharing personal information or experiences'
      });
    }

    // Check for memory retrieve patterns
    if (/(recall|remember|what did|find|retrieve|show me|tell me about)/.test(lowerMessage)) {
      detectedIntents.push({
        intent: 'memory_retrieve',
        confidence: 0.8,
        reasoning: 'Contains memory retrieval keywords'
      });
    }

    // Check for question patterns
    if (/^(what|how|why|when|where|who|can you|could you|is it|are you|\?)/.test(lowerMessage) || lowerMessage.includes('?')) {
      detectedIntents.push({
        intent: 'question',
        confidence: 0.7,
        reasoning: 'Message contains question patterns or question mark'
      });
    }

    // Check for command patterns
    if (/(please|can you|could you|would you|do|perform|execute|run|start|stop|email|send|call|take a picture|screenshot|capture|snap)/.test(lowerMessage)) {
      detectedIntents.push({
        intent: 'command',
        confidence: 0.7,
        reasoning: 'Contains command or request keywords'
      });
    }

    // Check for screen capture patterns
    if (/(take a picture of my screen|screenshot this|capture my screen|snap a picture of what I'm seeing|picture of my display|help me understand what's on my screen)/.test(lowerMessage)) {
      detectedIntents.push({
        intent: 'command',
        confidence: 0.7,
        reasoning: 'Contains screen capture keywords'
      });
    }

    // If no intents detected, default to question
    if (detectedIntents.length === 0) {
      detectedIntents.push({
        intent: 'question',
        confidence: 0.5,
        reasoning: 'Default classification for unclear intent'
      });
    }

    // Determine primary intent (highest confidence)
    const primaryIntent = detectedIntents.reduce((prev, current) => 
      (prev.confidence > current.confidence) ? prev : current
    ).intent;

    // Determine if memory access or external data is required
    const requiresMemoryAccess = detectedIntents.some(i => 
      ['memory_store', 'memory_retrieve', 'memory_update', 'memory_delete'].includes(i.intent)
    );
    const requiresExternalData = detectedIntents.some(i => 
      i.intent === 'command' // Commands may require external data
    );

    // Determine if screen capture is needed
    const captureScreen = lowerMessage.includes('this page') || 
                       lowerMessage.includes('guide me through') ||
                       lowerMessage.includes('what is this') ||
                       lowerMessage.includes('explain what') ||
                       lowerMessage.includes('help me with this') ||
                       lowerMessage.includes('save this screen') ||
                       lowerMessage.includes('capture this') ||
                       lowerMessage.includes('store this page') ||
                       lowerMessage.includes('what i\'m seeing') ||
                       lowerMessage.includes('what am i seeing') ||
                       lowerMessage.includes('take a picture') ||
                       lowerMessage.includes('take a screenshot') ||
                       lowerMessage.includes('screenshot') ||
                       lowerMessage.includes('picture of my screen') ||
                       lowerMessage.includes('capture my screen') ||
                       lowerMessage.includes('snap a picture') ||
                       lowerMessage.includes('take a snap');

    return {
      intents: detectedIntents,
      primaryIntent,
      entities: [message],
      requiresMemoryAccess,
      requiresExternalData,
      captureScreen,
      suggestedResponse: detectedIntents.length > 1 
        ? 'Handle multiple intents: ' + detectedIntents.map(i => i.intent).join(', ')
        : 'Handle ' + primaryIntent,
      sourceText: message
    };
  }

  /**
   * Quick intent classification without LLM (for performance)
   */
  async quickClassifyIntent(message: string): Promise<WebSocketIntentType> {
    const result = this.fallbackIntentClassification(message);
    return result.primaryIntent;
  }
}

// Export singleton instance
export const websocketIntentService = new WebSocketIntentService();

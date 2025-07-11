/**
 * WebSocket Intent Evaluation Service
 * Classifies incoming WebSocket messages into specific intent categories
 */

import { buildPrompt } from './promptBuilder';
import { llmStreamingRouter } from '../utils/llmStreamingRouter';
import { logger } from '../utils/logger';

export type WebSocketIntentType = 
  | 'memory_store'
  | 'memory_retrieve' 
  | 'memory_update'
  | 'memory_delete'
  | 'greeting'
  | 'question'
  | 'command'
  | 'external_data_required';

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
  primaryIntent: WebSocketIntentType;
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
      const prompt = this.buildWebSocketIntentPrompt(message, options.context);
      
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
   */
  private buildWebSocketIntentPrompt(message: string, context?: Record<string, any>): string {
    const conversationHistory = context?.conversationHistory || [];
    const historyContext = conversationHistory.length > 0 
      ? `\n\nConversation History:\n${conversationHistory.map((h: any) => `${h.role}: ${h.content}`).join('\n')}`
      : '';

    return `
You are Thinkdrop AI's intent classifier for WebSocket messages. Analyze the user's message and identify ALL applicable intents - messages can have multiple intents simultaneously.

**Intent Categories:**
- **memory_store**: User wants to save/store information, notes, or data
- **memory_retrieve**: User wants to recall/find previously stored information
- **memory_update**: User wants to modify/edit existing stored information
- **memory_delete**: User wants to remove/delete stored information
- **greeting**: User is greeting, saying hello, or starting conversation
- **question**: User is asking a question that requires an informative answer
- **command**: User is giving a command or instruction to perform an action
- **external_data_required**: User's request requires fetching external data/APIs

User Message: "${message}"${historyContext}

**Example:** "Hello, I have appt. at 3pm next week that I need you to email to my wife" would have intents: ["greeting", "memory_store", "command"]

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
  "suggestedResponse": "Acknowledge greeting, confirm appointment storage, and execute email command"
}

Identify ALL applicable intents with individual confidence scores. The primaryIntent should be the most important/actionable intent.
    `.trim();
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
        'greeting', 'question', 'command', 'external_data_required'
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
        suggestedResponse: parsed.suggestedResponse || ''
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

    // Check for memory store patterns
    if (/(remember|save|store|note|record|keep track)/.test(lowerMessage)) {
      detectedIntents.push({
        intent: 'memory_store',
        confidence: 0.8,
        reasoning: 'Contains memory storage keywords'
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
    if (/(please|can you|could you|would you|do|perform|execute|run|start|stop|email|send|call)/.test(lowerMessage)) {
      detectedIntents.push({
        intent: 'command',
        confidence: 0.7,
        reasoning: 'Contains command or request keywords'
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
      i.intent === 'external_data_required'
    );

    return {
      intents: detectedIntents,
      primaryIntent,
      entities: [message],
      requiresMemoryAccess,
      requiresExternalData,
      suggestedResponse: detectedIntents.length > 1 
        ? 'Handle multiple intents: ' + detectedIntents.map(i => i.intent).join(', ')
        : 'Handle ' + primaryIntent
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

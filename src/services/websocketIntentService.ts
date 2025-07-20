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
    options: {
      provider?: string;
      context?: Record<string, any>;
    } = {}
  ): Promise<WebSocketIntentResult> {
    logger.info('🔍 Starting intent evaluation', {
      message,
      provider: options.provider || 'openai',
      hasContext: !!options.context,
      contextKeys: options.context ? Object.keys(options.context) : []
    });

    try {
      const prompt = await this.buildWebSocketIntentPrompt(message, options.context);
      
      logger.info('📝 Built LLM prompt', {
        promptLength: prompt.length,
        message
      });
      
      const result = await llmStreamingRouter.processPromptWithStreaming(
        {
          prompt,
          provider: options.provider || 'openai',
          options: {
            temperature: 0.1,
            maxTokens: 500,
            stream: false
          }
        },
        () => {}, // No streaming needed for intent classification
        {
          source: 'backend_llm',
          sessionId: 'intent_eval',
          clientId: 'intent_service'
        }
      );

      logger.info('🤖 LLM response received', {
        provider: result.provider,
        hasFullText: !!result.fullText,
        textLength: result.fullText?.length || 0,
        processingTime: result.processingTime,
        message
      });

      if (result.fullText) {
        try {
          logger.info('🔄 Attempting to parse LLM response', {
            fullText: result.fullText,
            message
          });
          
          const parsed = JSON.parse(result.fullText);
          
          logger.info('✅ Successfully parsed LLM intent result', {
            primaryIntent: parsed.primaryIntent,
            intentsCount: parsed.intents?.length || 0,
            intents: parsed.intents?.map((i: any) => `${i.intent}(${i.confidence})`) || [],
            requiresMemoryAccess: parsed.requiresMemoryAccess,
            message
          });
          
          return parsed as WebSocketIntentResult;
        } catch (parseError) {
          logger.warn('❌ Failed to parse LLM intent response, using fallback', {
            error: parseError instanceof Error ? parseError.message : String(parseError),
            fullText: result.fullText,
            message
          });
          
          const fallbackResult = this.fallbackIntentClassification(message);
          
          logger.info('🔄 Fallback classification result', {
            primaryIntent: fallbackResult.primaryIntent,
            intentsCount: fallbackResult.intents?.length || 0,
            intents: fallbackResult.intents?.map((i: any) => `${i.intent}(${i.confidence})`) || [],
            message
          });
          
          return fallbackResult;
        }
      } else {
        logger.warn('❌ LLM intent classification failed (no fullText), using fallback', {
          provider: result.provider,
          processingTime: result.processingTime,
          message
        });
        
        const fallbackResult = this.fallbackIntentClassification(message);
        
        logger.info('🔄 Fallback classification result', {
          primaryIntent: fallbackResult.primaryIntent,
          intentsCount: fallbackResult.intents?.length || 0,
          intents: fallbackResult.intents?.map((i: any) => `${i.intent}(${i.confidence})`) || [],
          message
        });
        
        return fallbackResult;
      }
    } catch (error) {
      logger.error('💥 Error in intent evaluation, using fallback', {
        error: error instanceof Error ? error.message : String(error),
        message
      });
      
      const fallbackResult = this.fallbackIntentClassification(message);
      
      logger.info('🔄 Fallback classification result', {
        primaryIntent: fallbackResult.primaryIntent,
        intentsCount: fallbackResult.intents?.length || 0,
        intents: fallbackResult.intents?.map((i: any) => `${i.intent}(${i.confidence})`) || [],
        message
      });
      
      return fallbackResult;
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

**Intent Classification Framework:**

You are an expert intent classifier. Use the following systematic approach:

**Step 1: Analyze the Message Structure**
- What is the user doing? (sharing, asking, commanding, greeting)
- What information is being communicated?
- What is the user's underlying need or goal?

**Step 2: Apply Intent Categories**
**IMPORTANT**: You MUST only use these 7 intent types. Do NOT create new intent types like "general_query" or "other". Every message must be classified as one or more of these 7 types.
- **memory_store**: User is sharing personal information, experiences, plans, tasks, needs, problems, or any data about themselves that should be remembered for future reference
- **memory_retrieve**: User wants to recall/find previously stored information
- **memory_update**: User wants to modify/edit existing stored information  
- **memory_delete**: User wants to remove/delete stored information
- **greeting**: User is greeting, saying hello, or starting conversation
- **question**: User is asking for information, guidance, or explanations (seeking knowledge)
- **command**: User is giving a command or instruction to perform an action (e.g., "take a picture", "screenshot this", "capture my screen", "do something")

**Step 3: Chain-of-Thought Analysis**
For each message, think through:
1. "What is the user telling me about themselves or their situation?"
2. "Should this information be remembered for future conversations?"
3. "Is the user asking me to do something, or just sharing information?"

**CRITICAL DISTINCTION - Memory Store vs Question:**
- **memory_store**: "I need a new car title" (sharing a personal need/task)
- **question**: "How do I get a new car title?" (asking for information)
- **memory_store**: "I lost my car keys" (sharing a personal problem)
- **question**: "What should I do if I lose my car keys?" (asking for advice)

**Few-Shot Examples with Chain-of-Thought:**

**Example 1: "I need a new title for my car. Lost mine"**
Step 1 Analysis: User is sharing a personal problem/need
Step 2 Reasoning: This is personal information about their situation that should be remembered
Step 3 CoT: (1) User is telling me they have a car title problem (2) Yes, this should be remembered for future help (3) They're sharing, not asking how to solve it
Classification: memory_store (confidence: 0.9)

**Example 2: "How do I get a new car title?"**
Step 1 Analysis: User is asking for information/guidance
Step 2 Reasoning: This is seeking knowledge, not sharing personal info
Step 3 CoT: (1) User wants to know the process (2) No personal info to remember (3) They're asking for instructions
Classification: question (confidence: 0.9)

**Example 3: "I lost my wallet yesterday"**
Step 1 Analysis: User is sharing a personal incident
Step 2 Reasoning: Personal experience that should be remembered
Step 3 CoT: (1) User experienced a loss (2) Yes, important personal event (3) Sharing information, not requesting action
Classification: memory_store (confidence: 0.85)

**Example 4: "What should I do if I lose my wallet?"**
Step 1 Analysis: User is asking for advice/guidance
Step 2 Reasoning: Hypothetical question seeking information
Step 3 CoT: (1) User wants advice for a scenario (2) No personal info shared (3) Asking for guidance
Classification: question (confidence: 0.9)

**Example 5: "I have a dentist appointment at 3pm tomorrow"**
Step 1 Analysis: User is sharing personal schedule information
Step 2 Reasoning: Personal appointment that should be remembered
Step 3 CoT: (1) User has a scheduled appointment (2) Yes, important personal schedule (3) Sharing information
Classification: memory_store (confidence: 0.9)

**Example 6: "Take a screenshot of this page"**
Step 1 Analysis: User is giving a direct instruction
Step 2 Reasoning: Command to perform an action
Step 3 CoT: (1) User wants an action performed (2) No personal info to store (3) Direct command
Classification: command (confidence: 0.95)

**Self-Consistency Check:**
Before finalizing, ask yourself:
- "If I were having a conversation with this person next week, would knowing this information be helpful?"
- "Is the user sharing something about themselves, or asking me to provide information?"
- "Would a human friend remember this if the user told them?"

**Screen Capture Detection:**
Set "captureScreen": true if the user's message indicates they need visual context or want to capture/store the current page. This includes:

**Direct Screen References:**
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

**Content Analysis/Processing:**
- "sum up this page"
- "summarize this page"
- "summarize what's on my screen"
- "give me a summary of this"
- "tell me about this page"
- "analyze this page"
- "review this page"
- "break down this page"

**Indirect/Contextual References (requiring visual context):**
- "let's get this data in an email" (extracting visible data)
- "clean up all these words" (processing visible text)
- "organize this information" (structuring visible content)
- "extract the key points" (analyzing visible content)
- "turn this into a list" (reformatting visible content)
- "make sense of this" (interpreting visible content)
- "what should I do with this" (contextual advice about visible content)
- "help me process this" (working with visible information)
- "anything else to consider" (when context suggests visible content)
- "what's missing here" (analyzing visible content gaps)
- "how can I improve this" (evaluating visible content)
- "what's the next step" (when context involves visible workflow/process)
- "convert this to [format]" (transforming visible content)
- "send this to [someone]" (sharing visible content)
- "save this as [format]" (preserving visible content)

**Key Principle:** If the request implies the AI needs to see what the user is currently viewing to provide a meaningful response, set captureScreen: true. This includes data extraction, content analysis, formatting requests, and contextual advice about visible information.


User Message: "${message}"${historyContext}

**Additional Examples:**
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

**ANALYSIS INSTRUCTIONS:**

1. **Apply the 3-Step Framework** to the user message
2. **Use Chain-of-Thought reasoning** for each potential intent
3. **Reference the Few-Shot examples** for similar patterns
4. **Apply Self-Consistency checks** before finalizing
5. **Include your reasoning** in the JSON response

**CRITICAL REQUIREMENT:** You MUST always include both \`suggestedResponse\` and \`sourceText\` fields in your response. These are REQUIRED fields, not optional.

- \`suggestedResponse\`: A brief, actionable response that describes what should be done based on the detected intents
- \`sourceText\`: The exact original user message (for reference and context)

Analyze the message and respond in this exact JSON format:
{
  "chainOfThought": {
    "step1_analysis": "What is the user doing and what information are they communicating?",
    "step2_reasoning": "Which intent category best fits this message and why?",
    "step3_consistency": "Self-consistency check: Would this information be valuable to remember?"
  },
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
      // Try to extract JSON from the response, handling markdown code blocks
      let jsonText = response;
      
      // Remove markdown code blocks if present
      const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (codeBlockMatch) {
        jsonText = codeBlockMatch[1].trim();
      }
      
      // Extract JSON object from the cleaned text
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
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

    // Generate default suggestedResponse if not provided by LLM
    const defaultSuggestedResponse = parsed.suggestedResponse || 
      `Handle ${parsed.primaryIntent}${parsed.intents.length > 1 ? ` and ${parsed.intents.length - 1} other intent(s)` : ''}: ${parsed.intents.map((i: any) => i.intent).join(', ')}`;

    // Ensure sourceText is always the original message
    const sourceText = parsed.sourceText || originalMessage;

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
      suggestedResponse: defaultSuggestedResponse,
      sourceText: sourceText
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
    // Direct screen references
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
                       lowerMessage.includes('take a snap') ||
                       // Content analysis/processing
                       lowerMessage.includes('sum up this page') ||
                       lowerMessage.includes('summarize this page') ||
                       lowerMessage.includes('summarize what') ||
                       lowerMessage.includes('give me a summary') ||
                       lowerMessage.includes('tell me about this page') ||
                       lowerMessage.includes('analyze this page') ||
                       lowerMessage.includes('review this page') ||
                       lowerMessage.includes('break down this page') ||
                       // Indirect/contextual references (data processing)
                       lowerMessage.includes('get this data') ||
                       lowerMessage.includes('clean up all these') ||
                       lowerMessage.includes('organize this information') ||
                       lowerMessage.includes('extract the key points') ||
                       lowerMessage.includes('turn this into') ||
                       lowerMessage.includes('make sense of this') ||
                       lowerMessage.includes('what should i do with this') ||
                       lowerMessage.includes('help me process this') ||
                       lowerMessage.includes('anything else to consider') ||
                       lowerMessage.includes('what\'s missing here') ||
                       lowerMessage.includes('how can i improve this') ||
                       lowerMessage.includes('what\'s the next step') ||
                       lowerMessage.includes('convert this to') ||
                       lowerMessage.includes('send this to') ||
                       lowerMessage.includes('save this as') ||
                       // Contextual processing patterns
                       (lowerMessage.includes('this') && (lowerMessage.includes('email') || lowerMessage.includes('format') || lowerMessage.includes('list') || lowerMessage.includes('organize'))) ||
                       // Questions about visible content
                       (lowerMessage.includes('what') && lowerMessage.includes('here')) ||
                       (lowerMessage.includes('how') && lowerMessage.includes('this'));

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

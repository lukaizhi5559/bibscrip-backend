import { logger } from '../utils/logger';
import { ragService } from './ragService';
import { vectorDbService } from './vectorDbService';
import { aiMemoryService } from './aiMemoryService';
import { llmOrchestratorService } from './llmOrchestrator';
import { performance } from 'perf_hooks';
import fuzzysort from 'fuzzysort';

// Enhanced interfaces for smart prompt building
export interface MessageComplexity {
  level: 'minimal' | 'light' | 'medium' | 'high' | 'complex';
  score: number;
  factors: {
    length: number;
    questionCount: number;
    keywordDensity: number;
    technicalTerms: number;
    contextReferences: number;
  };
}

export interface HybridMemoryMatch {
  id: string;
  content: string;
  type: 'user' | 'system' | 'agent';
  userId?: string;
  semanticScore: number;
  lexicalScore: number;
  hybridScore: number;
  metadata?: Record<string, any>;
}

export interface RAGWeighting {
  bible: number;
  knowledge: number;
  memory: number;
}

export interface RAGContext {
  bible: Array<{ text: string; score: number; metadata: Record<string, any> }>;
  knowledge: Array<{ text: string; score: number; metadata: Record<string, any> }>;
  memory: Array<{ text: string; score: number; metadata: Record<string, any> }>;
}

export interface IntentLevelConfig {
  minimal: string[];
  light: string[];
  medium: string[];
  high: string[];
  complex: string[];
}

export interface SmartPromptResult {
  // Core prompt components
  leveledPrompt: string;
  contextualMemory: string;
  
  // RAG integration results
  ragContext: RAGContext;
  semanticCacheHit?: { response: string; cacheAge: number };
  
  // Intent classification results
  intentClassification: {
    primaryIntent: string;
    allIntents: Array<{ intent: string; confidence: number; reasoning?: string }>;
    requiresMemoryAccess: boolean;
  };
  
  // Analysis metadata
  complexityAnalysis: MessageComplexity;
  memoryMatches: HybridMemoryMatch[];
  ragWeighting: RAGWeighting;
  
  // Performance metrics
  processingTime: number;
  cacheStatus: 'hit' | 'miss' | 'bypassed';
  hybridSearchTime: number;
  ragRetrievalTime: number;
}

export interface SmartPromptConfig {
  userId: string;
  useSemanticCache: boolean;
  useVectorSearch: boolean;
  maxContextDocuments: number;
  hybridSearchWeight: { semantic: number; lexical: number };
  intentType?: 'memory_store' | 'memory_retrieve' | 'memory_update' | 'memory_delete' | 'greeting' | 'question' | 'command';
}

export class SmartPromptBuilder {
  private static instance: SmartPromptBuilder;
  
  // Intent level configurations
  private intentLevels: IntentLevelConfig = {
    minimal: ['question', 'greeting', 'communication_completion'],
    light: ['question', 'memory_store', 'memory_retrieve', 'speak', 'listen', 'communication_completion'],
    medium: [
      'question', 'command', 'memory_store', 'memory_retrieve', 'memory_update', 'memory_delete',
      'external_data_required', 'devotion_suggest', 'verse_lookup', 'prayer_request', 
      'mood_checkin', 'communication_completion'
    ],
    high: [
      'question', 'command', 'memory_store', 'memory_retrieve', 'memory_update', 'memory_delete',
      'agent_run', 'agent_schedule', 'task_create', 'task_update', 'task_summarize',
      'external_data_required', 'context_enrich', 'devotion_suggest', 'verse_lookup',
      'prayer_request', 'mood_checkin', 'speak', 'listen', 'communication_completion'
    ],
    complex: [
      'question', 'command', 'memory_store', 'memory_retrieve', 'memory_update', 'memory_delete',
      'agent_run', 'agent_schedule', 'agent_stop', 'agent_generate', 'agent_orchestrate',
      'task_create', 'task_update', 'task_delete', 'task_summarize', 'task_prioritize',
      'context_enrich', 'context_retrieve', 'external_data_required', 'feedback_submit',
      'session_restart', 'devotion_suggest', 'verse_lookup', 'prayer_request',
      'mood_checkin', 'speak', 'listen', 'communication_completion'
    ]
  };

  // Dynamic RAG weighting strategies
  private ragWeightingStrategies: Record<string, RAGWeighting> = {
    memory_store: { bible: 0.0, knowledge: 0.1, memory: 0.9 },
    memory_retrieve: { bible: 0.0, knowledge: 0.1, memory: 0.9 },
    memory_update: { bible: 0.0, knowledge: 0.1, memory: 0.9 },
    memory_delete: { bible: 0.0, knowledge: 0.1, memory: 0.9 },
    question: { bible: 0.4, knowledge: 0.4, memory: 0.2 },
    command: { bible: 0.1, knowledge: 0.4, memory: 0.5 }, // Enhanced for external data + actions
    greeting: { bible: 0.1, knowledge: 0.1, memory: 0.8 }
  };

  private constructor() {
    // Services are imported as singletons
  }

  public static getInstance(): SmartPromptBuilder {
    if (!SmartPromptBuilder.instance) {
      SmartPromptBuilder.instance = new SmartPromptBuilder();
    }
    return SmartPromptBuilder.instance;
  }

  /**
   * Main orchestrator method - builds smart prompts with hybrid search and dynamic weighting
   */
  public async buildSmartPrompt(
    message: string, 
    config: SmartPromptConfig
  ): Promise<SmartPromptResult> {
    const startTime = performance.now();
    
    try {
      logger.info('Building smart prompt', { 
        messageLength: message.length, 
        userId: config.userId,
        intentType: config.intentType 
      });

      // Step 1: Analyze message complexity
      const complexityAnalysis = this.analyzeMessageComplexity(message);
      
      // Step 2: Classify intent directly (avoiding circular dependency)
      const intentResult = await this.classifyIntentDirect(message, config.userId);
      
      logger.info('Intent classification result', {
        primaryIntent: intentResult.primaryIntent,
        allIntents: intentResult.intents.map(i => ({ intent: i.intent, confidence: i.confidence })),
        requiresMemoryAccess: intentResult.requiresMemoryAccess
      });
      
      // Step 3: Check semantic cache first
      let semanticCacheHit: { response: string; cacheAge: number } | undefined;
      let cacheStatus: 'hit' | 'miss' | 'bypassed' = 'bypassed';
      
      if (config.useSemanticCache) {
        const cachedResponse = await ragService.checkSemanticCache(message);
        if (cachedResponse) {
          cacheStatus = 'hit';
          semanticCacheHit = cachedResponse;
        } else {
          cacheStatus = 'miss';
        }
      }

      // Step 3: Perform hybrid memory search using enhanced services
      const hybridSearchStart = performance.now();
      const memoryMatches = await this.performHybridMemorySearch(config.userId, message, complexityAnalysis);
      const hybridSearchTime = performance.now() - hybridSearchStart;

      // Step 4: Retrieve RAG context with dynamic weighting based on classified intent
      const ragRetrievalStart = performance.now();
      const ragWeighting = this.getRagWeighting(intentResult.primaryIntent);
      const ragContext = await this.retrieveRAGContext(message, complexityAnalysis, ragWeighting);
      const ragRetrievalTime = performance.now() - ragRetrievalStart;

      // Combine RAG contexts into array for compatibility
      const ragContextArray = [
        ...ragContext.bible,
        ...ragContext.knowledge,
        ...ragContext.memory
      ];

      // Step 5: Generate contextual memory summary
      const contextualMemory = this.generateContextualMemoryResponse(memoryMatches, ragContextArray, message);

      // Step 6: Generate leveled prompt
      const leveledPrompt = this.generateLeveledPrompt(message, complexityAnalysis.level);

      const processingTime = performance.now() - startTime;

      logger.info('Smart prompt built successfully', {
        userId: config.userId,
        intentType: config.intentType,
        complexity: complexityAnalysis.level,
        memoryMatches: memoryMatches.length,
        ragContextSize: ragContextArray.length,
        cacheStatus,
        processingTime: Date.now() - startTime
      });

      return {
        leveledPrompt,
        contextualMemory,
        ragContext,
        semanticCacheHit,
        intentClassification: {
          primaryIntent: intentResult.primaryIntent,
          allIntents: intentResult.intents,
          requiresMemoryAccess: intentResult.requiresMemoryAccess || false
        },
        complexityAnalysis,
        memoryMatches,
        ragWeighting,
        processingTime,
        cacheStatus,
        hybridSearchTime,
        ragRetrievalTime
      };

    } catch (error) {
      logger.error('Error building smart prompt', { error, message: message.substring(0, 100) });
      throw error;
    }
  }

  /**
   * Analyze message complexity with enhanced factors
   */
  private analyzeMessageComplexity(message: string): MessageComplexity {
    const words = message.split(/\s+/);
    const factors = {
      length: words.length,
      questionCount: (message.match(/\?/g) || []).length,
      keywordDensity: words.filter(word => 
        ['analyze', 'compare', 'evaluate', 'research', 'investigate', 'schedule', 'remind',
        'create agent', 'orchestrate', 'plan', 'strategy', 'workflow', 'automation'].includes(word.toLowerCase())
      ).length / words.length,
      technicalTerms: words.filter(word => 
        ['analyze', 'compare', 'evaluate', 'research', 'investigate', 'schedule', 'remind',
        'create agent', 'orchestrate', 'plan', 'strategy', 'workflow', 'automation'].includes(word.toLowerCase())
      ).length,
      contextReferences: (message.match(/\b(this|that|these|those|it|they)\b/gi) || []).length
    };

    // Scoring algorithm
    let score = factors.length;
    if (factors.contextReferences > 2) score += 10;
    if (factors.questionCount > 1) score += factors.questionCount * 5;
    score += factors.technicalTerms * 8;
    score += factors.keywordDensity * 20;

    // Determine complexity level
    let level: MessageComplexity['level'];
    if (score <= 10) level = 'minimal';
    else if (score <= 25) level = 'light';
    else if (score <= 50) level = 'medium';
    else if (score <= 80) level = 'high';
    else level = 'complex';

    return {
      level,
      score,
      factors
    };
  }

  /**
   * Perform hybrid memory search combining lexical and semantic approaches
   */
  private async performHybridMemorySearch(
    userId: string,
    message: string,
    complexity: MessageComplexity
  ): Promise<HybridMemoryMatch[]> {
    try {
      // Step 1: Get user memories using aiMemoryService
      const userMemories = await aiMemoryService.getMemories(userId, {
        limit: 50,
        includeMetadata: true
      });
      
      if (userMemories.length === 0) {
        logger.debug('No memories found for user', { userId });
        return [];
      }

      // Step 2: Perform lexical search using fuzzysort
      const memoryTexts = userMemories.map(m => m.content);
      const lexicalMatches = fuzzysort.go(message, memoryTexts, {
        threshold: -10000, // Allow lower scores
        limit: 20
      });

      // Step 3: Perform semantic search using enhanced vectorDbService
      const semanticResults = await vectorDbService.searchUserMemories(
        userId,
        message,
        { user: 1.0, system: 0.7, agent: 0.5 },
        20,
        0.5
      );

      // Step 4: Create hybrid matches by combining lexical and semantic results
      const hybridMatches: HybridMemoryMatch[] = [];
      const processedIds = new Set<string>();

      // Process lexical matches
      lexicalMatches.forEach((match, index) => {
        const memory = userMemories[match.target ? memoryTexts.indexOf(match.target) : index];
        if (!memory || processedIds.has(memory.id)) return;
        
        processedIds.add(memory.id);
        const lexicalScore = Math.max(0, (match.score + 10000) / 10000); // Normalize to 0-1
        
        // Find corresponding semantic match
        const semanticMatch = semanticResults.find((sm: any) => 
          sm.metadata?.userId === userId && sm.text === memory.content
        );
        const semanticScore = semanticMatch?.score || 0.3; // Default semantic score
        
        hybridMatches.push({
          id: memory.id,
          content: memory.content,
          type: memory.type,
          userId: memory.userId,
          lexicalScore,
          semanticScore,
          hybridScore: (lexicalScore * 0.4) + (semanticScore * 0.6),
          metadata: ({
            createdAt: memory.createdAt,
            namespace: semanticMatch?.metadata?.namespace
          }) as Record<string, any>
        });
      });

      // Process semantic matches not found in lexical search
      semanticResults.forEach((semanticMatch: any) => {
        if (processedIds.has(semanticMatch.id)) return;
        
        const lexicalScore = 0.1; // Default lexical score for semantic-only matches
        const memory = userMemories.find((m: any) => m.content === semanticMatch.text);
        if (!memory) return;
        
        processedIds.add(semanticMatch.id);
        
        hybridMatches.push({
          id: semanticMatch.id,
          content: semanticMatch.text,
          type: (semanticMatch.metadata?.memoryType as 'user' | 'system' | 'agent') || 'user',
          userId: semanticMatch.metadata?.userId || userId,
          lexicalScore,
          semanticScore: semanticMatch.score,
          hybridScore: (lexicalScore * 0.4) + (semanticMatch.score * 0.6),
          metadata: ({
            createdAt: new Date(semanticMatch.metadata?.storedAt || Date.now()),
            namespace: semanticMatch.metadata?.namespace
          }) as Record<string, any>
        });
      });

      // Filter by minimum threshold and sort by hybrid score
      const filteredMatches = hybridMatches
        .filter(match => match.hybridScore >= 0.3)
        .sort((a, b) => b.hybridScore - a.hybridScore)
        .slice(0, complexity.level === 'complex' ? 15 : 10);

      logger.debug('Hybrid memory search completed', {
        userId,
        totalMemories: userMemories.length,
        lexicalMatches: lexicalMatches.length,
        semanticMatches: semanticResults.length,
        hybridMatches: hybridMatches.length,
        filteredMatches: filteredMatches.length,
        topScore: filteredMatches[0]?.hybridScore || 0
      });

      return filteredMatches;
        
    } catch (error) {
      logger.error('Failed to perform hybrid memory search:', error as Record<string, any>);
      return [];
    }
  }

  /**
   * Retrieve RAG context with dynamic weighting based on intent
   */
  private async retrieveRAGContext(
    message: string,
    complexity: MessageComplexity,
    weighting: RAGWeighting
  ): Promise<RAGContext> {
    try {
      const contexts: RAGContext = {
        bible: [],
        knowledge: [],
        memory: []
      };

      // Retrieve Bible context if weighted
      if (weighting.bible > 0) {
        try {
          const bibleResults = await vectorDbService.searchSimilar(
            message,
            'bible_verses', // Use standard Bible namespace
            Math.ceil(5 * weighting.bible),
            0.6
          );
          contexts.bible = bibleResults.map(result => ({
            text: result.text,
            score: result.score,
            metadata: (result.metadata || {}) as Record<string, any>
          }));
        } catch (error) {
          logger.warn('Failed to retrieve Bible context:', error as Record<string, any>);
        }
      }

      // Retrieve knowledge base context if weighted
      if (weighting.knowledge > 0) {
        try {
          // Use ragService's existing method for knowledge base retrieval
          const cachedResponse = await ragService.checkSemanticCache(message);
          if (cachedResponse) {
            contexts.knowledge = [{
              text: cachedResponse.response,
              score: 0.9,
              metadata: { source: 'semantic_cache', cacheAge: cachedResponse.cacheAge }
            }];
          }
        } catch (error) {
          logger.warn('Failed to retrieve knowledge base context:', error as Record<string, any>);
        }
      }

      logger.debug('RAG context retrieved', {
        bibleResults: contexts.bible.length,
        knowledgeResults: contexts.knowledge.length,
        weighting
      });

      return contexts;
      
    } catch (error) {
      logger.error('Failed to retrieve RAG context:', error as Record<string, any>);
      return { bible: [], knowledge: [], memory: [] };
    }
  }

  /**
   * Get RAG weighting strategy for intent type
   */
  private getRagWeighting(intentType: string): RAGWeighting {
    return this.ragWeightingStrategies[intentType] || this.ragWeightingStrategies.question;
  }

  /**
   * Generate contextual memory response
   */
  private generateContextualMemoryResponse(
    memoryMatches: HybridMemoryMatch[],
    ragContext: any[],
    userInput: string
  ): string {
    if (memoryMatches.length === 0 && ragContext.length === 0) {
      return '';
    }

    let contextResponse = 'Based on relevant context:\n\n';

    // Add memory matches
    if (memoryMatches.length > 0) {
      contextResponse += 'Personal Memory:\n';
      memoryMatches.forEach((match, i) => {
        contextResponse += `${i + 1}. ${match.content} (relevance: ${Math.round(match.hybridScore * 100)}%)\n`;
      });
      contextResponse += '\n';
    }

    // Add RAG context
    if (ragContext.length > 0) {
      contextResponse += 'Knowledge Context:\n';
      ragContext.forEach((context, i) => {
        contextResponse += `${i + 1}. [${context.source}] ${context.text} (score: ${Math.round(context.score * 100)}%)\n`;
      });
      contextResponse += '\n';
    }

    contextResponse += `User Query: ${userInput}`;
    return contextResponse;
  }

  /**
   * Generate leveled prompt based on complexity
   */
  private generateLeveledPrompt(message: string, level: MessageComplexity['level']): string {
    const baseInstruction = 'Analyze the user message and return JSON only. Do not include any other text, explanation, or conversation. IMPORTANT: If the message contains multiple distinct pieces of information that should be stored separately (like name AND phone number, or color AND address), use multiIntent: true with multiple memory_store intents.';
    const returnFormat = 'Return: {"multiIntent": false, "primaryIntent": "intent_name"} OR {"multiIntent": true, "intents": ["intent1", "intent2"]}';
    
    const availableIntents = this.intentLevels[level].join(', ');
    
    return `${baseInstruction}\n${returnFormat}\nAvailable Intents: ${availableIntents}\nUser: ${message}`;
  }

  /**
   * Classify intent directly without circular dependency
   */
  private async classifyIntentDirect(message: string, userId: string): Promise<{
    primaryIntent: string;
    intents: Array<{ intent: string; confidence: number; reasoning: string }>;
    requiresMemoryAccess: boolean;
    entities: string[];
    captureScreen: boolean;
  }> {
    try {
      const prompt = `
You are Thinkdrop AI's intent classifier. Analyze the user's message and identify ALL applicable intents.

**Intent Categories:**
- **memory_store**: User wants to save/store information OR is sharing personal information, facts, experiences, preferences, plans, tasks, intentions, activities, or any data about themselves, their life, or their future actions (e.g., "I need to buy snacks", "I'm going to the gym", "My favorite color is blue")
- **memory_retrieve**: User wants to recall/find previously stored information
- **memory_update**: User wants to modify/edit existing stored information
- **memory_delete**: User wants to remove/delete stored information
- **greeting**: User is greeting, saying hello, or starting conversation
- **question**: User is asking a question that requires an informative answer
- **command**: User is giving a command or instruction to perform an action

**Screen Capture Detection:**
Set "captureScreen": true if the user's message indicates they need visual context or want to capture/store the current page, such as:
- "I need help understand this page"
- "guide me through this"
- "store/capture this page for later"
- "what is this all about"
- "explain what I'm looking at"
- "save this screen"
- "help me with this interface"
- Any request that would benefit from seeing the current screen/page

User Message: "${message}"

Analyze the message and respond in this exact JSON format:
{
  "intents": [
    {
      "intent": "greeting",
      "confidence": 0.95,
      "reasoning": "Message starts with greeting"
    }
  ],
  "primaryIntent": "greeting",
  "entities": ["hello"],
  "requiresMemoryAccess": false,
  "requiresExternalData": false,
  "suggestedResponse": "Hello! Nice to meet you.",
  "sourceText": "Hello, my name is John",
  "captureScreen": false
}

Identify ALL applicable intents with individual confidence scores. The primaryIntent should be the most important/actionable intent.
      `.trim();

      const response = await llmOrchestratorService.processIntent(message, {
        userId,
        temperature: 0.1,
        maxTokens: 500
      });

      if (response && response.text) {
        try {
          const parsed = JSON.parse(response.text);
          
          // Explicit screen capture detection (don't rely solely on LLM)
          const lowerMessage = message.toLowerCase();
          const needsScreenCapture = lowerMessage.includes('this page') || 
                                    lowerMessage.includes('guide me through') ||
                                    lowerMessage.includes('what is this') ||
                                    lowerMessage.includes('explain what') ||
                                    lowerMessage.includes('help me with this') ||
                                    lowerMessage.includes('save this screen') ||
                                    lowerMessage.includes('capture this') ||
                                    lowerMessage.includes('store this page') ||
                                    lowerMessage.includes('what i\'m seeing') ||
                                    lowerMessage.includes('what am i seeing');
          
          return {
            primaryIntent: parsed.primaryIntent || 'question',
            intents: parsed.intents || [{ intent: 'question', confidence: 0.5, reasoning: 'Default classification' }],
            requiresMemoryAccess: parsed.requiresMemoryAccess || false,
            entities: parsed.entities || [],
            captureScreen: parsed.captureScreen || needsScreenCapture || false
          };
        } catch (parseError) {
          logger.warn('Failed to parse intent classification response', { parseError, response: response.text });
        }
      }

      // Fallback to rule-based classification
      return this.fallbackIntentClassification(message);
      
    } catch (error) {
      logger.error('Error in direct intent classification', { error: error instanceof Error ? error.message : String(error), userId });
      return this.fallbackIntentClassification(message);
    }
  }

  /**
   * Fallback rule-based intent classification
   */
  private fallbackIntentClassification(message: string): {
    primaryIntent: string;
    intents: Array<{ intent: string; confidence: number; reasoning: string }>;
    requiresMemoryAccess: boolean;
    entities: string[];
    captureScreen: boolean;
  } {
    const lowerMessage = message.toLowerCase();
    
    // Check for screen capture indicators
    const needsScreenCapture = lowerMessage.includes('this page') || 
                              lowerMessage.includes('guide me through') ||
                              lowerMessage.includes('what is this') ||
                              lowerMessage.includes('explain what') ||
                              lowerMessage.includes('help me with this') ||
                              lowerMessage.includes('save this screen') ||
                              lowerMessage.includes('capture this') ||
                              lowerMessage.includes('store this page') ||
                              lowerMessage.includes('what i\'m seeing') ||
                              lowerMessage.includes('what am i seeing');
    
    // Simple rule-based classification
    if (lowerMessage.includes('hello') || lowerMessage.includes('hi ') || lowerMessage.includes('hey')) {
      return {
        primaryIntent: 'greeting',
        intents: [{ intent: 'greeting', confidence: 0.8, reasoning: 'Contains greeting words' }],
        requiresMemoryAccess: false,
        entities: ['greeting'],
        captureScreen: needsScreenCapture
      };
    }
    
    if (lowerMessage.includes('remember') || lowerMessage.includes('save') || lowerMessage.includes('store')) {
      return {
        primaryIntent: 'memory_store',
        intents: [{ intent: 'memory_store', confidence: 0.7, reasoning: 'Contains memory storage keywords' }],
        requiresMemoryAccess: true,
        entities: ['memory'],
        captureScreen: needsScreenCapture
      };
    }
    
    if (lowerMessage.includes('what') || lowerMessage.includes('how') || lowerMessage.includes('?')) {
      return {
        primaryIntent: 'question',
        intents: [{ intent: 'question', confidence: 0.6, reasoning: 'Contains question indicators' }],
        requiresMemoryAccess: false,
        entities: ['question'],
        captureScreen: needsScreenCapture
      };
    }
    
    // Default to command
    return {
      primaryIntent: 'command',
      intents: [{ intent: 'command', confidence: 0.5, reasoning: 'Default classification' }],
      requiresMemoryAccess: false,
      entities: [],
      captureScreen: needsScreenCapture
    };
  }

  /**
   * Get contextual enhancements for intent classification
   * Extracts all SmartPromptBuilder intelligence without circular dependencies
   */
  async getContextualEnhancements(message: string, userId: string, context?: any): Promise<{
    complexityAnalysis: any;
    memoryMatches: any[];
    ragContext: any;
    ragContextArray: any[];
    contextualMemory: string;
    leveledPrompt: string;
    userContext: string;
    conversationContext: any[];
    cacheStatus: 'hit' | 'miss' | 'bypassed';
    semanticCacheHit?: { response: string; cacheAge: number };
  }> {
    try {
      logger.info('Building contextual enhancements', { userId, messageLength: message.length });
      
      // Step 1: Analyze message complexity
      const complexityAnalysis = this.analyzeMessageComplexity(message);
      
      // Step 2: Check semantic cache first
      let semanticCacheHit: { response: string; cacheAge: number } | undefined;
      let cacheStatus: 'hit' | 'miss' | 'bypassed' = 'bypassed';
      
      // For intent classification, we can use semantic cache but with different key
      const cachedResponse = await ragService.checkSemanticCache(`intent_${message}`);
      if (cachedResponse) {
        cacheStatus = 'hit';
        semanticCacheHit = cachedResponse;
      } else {
        cacheStatus = 'miss';
      }
      
      // Step 3: Perform hybrid memory search
      const memoryMatches = await this.performHybridMemorySearch(userId, message, complexityAnalysis);
      
      // Step 4: Retrieve RAG context with balanced weighting for intent classification
      const ragWeighting = {
        bible: 0.3,
        knowledge: 0.4, 
        memory: 0.3
      };
      const ragContext = await this.retrieveRAGContext(message, complexityAnalysis, ragWeighting);
      
      // Step 5: Combine RAG contexts into array for compatibility
      const ragContextArray = [
        ...ragContext.bible,
        ...ragContext.knowledge,
        ...ragContext.memory
      ];
      
      // Step 6: Generate contextual memory summary
      const contextualMemory = this.generateContextualMemoryResponse(memoryMatches, ragContextArray, message);
      
      // Step 7: Generate leveled prompt foundation
      const leveledPrompt = this.generateLeveledPrompt(message, complexityAnalysis.level);
      
      logger.info('Contextual enhancements built successfully', {
        userId,
        complexity: complexityAnalysis.level,
        memoryMatches: memoryMatches.length,
        ragContextSize: ragContextArray.length,
        cacheStatus
      });
      
      return {
        complexityAnalysis,
        memoryMatches,
        ragContext,
        ragContextArray,
        contextualMemory,
        leveledPrompt,
        userContext: `User has ${memoryMatches.length} relevant memories`,
        conversationContext: context?.conversationHistory || [],
        cacheStatus,
        semanticCacheHit
      };
      
    } catch (error) {
      logger.error('Error building contextual enhancements', { error: error instanceof Error ? error.message : String(error), userId });
      
      // Return minimal context on error
      return {
        complexityAnalysis: { level: 'medium', factors: [] },
        memoryMatches: [],
        ragContext: { bible: [], knowledge: [], memory: [] },
        ragContextArray: [],
        contextualMemory: 'No contextual memory available',
        leveledPrompt: 'Standard prompt approach',
        userContext: 'No user context available',
        conversationContext: [],
        cacheStatus: 'bypassed' as const
      };
    }
  }

  /**
   * Map intent to appropriate route/handler
   */
  private getIntentRoute(intent: string): string {
    const intentRouteMap: Record<string, string> = {
      'communication_completion': 'agent.sendText',
      'memory_store': 'memoryAgent.save',
      'memory_retrieve': 'memoryAgent.retrieve',
      'memory_update': 'memoryAgent.update',
      'memory_delete': 'memoryAgent.delete',
      'external_data_required': 'externalPlugin.fetch',
      'agent_run': 'agentOrchestrator.run',
      'agent_schedule': 'agentOrchestrator.schedule',
      'agent_generate': 'agentOrchestrator.generate',
      'devotion_suggest': 'devotionAgent.suggest',
      'verse_lookup': 'bibleAgent.lookup',
      'prayer_request': 'prayerAgent.handle',
      'task_create': 'taskAgent.create',
      'task_update': 'taskAgent.update',
      'context_enrich': 'contextAgent.enrich'
    };

    return intentRouteMap[intent] || 'defaultAgent.handle';
  }
}

// Export singleton instance
export const smartPromptBuilder = SmartPromptBuilder.getInstance();

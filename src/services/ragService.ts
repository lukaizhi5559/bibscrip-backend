// Retrieval Augmented Generation (RAG) System for ThinkDrop AI
import { vectorDbService, SearchResult } from './vectorDbService';
import { generateEmbedding } from './embeddingService';
import { NAMESPACE } from '../config/vectorDb';
import { getRedisClient, REDIS_PREFIX, TTL } from '../config/redis';
import { logger } from '../utils/logger';
import { analytics } from '../utils/analytics';

/**
 * The complexity level of a user query
 */
export enum QueryComplexity {
  SIMPLE = 'simple',
  MODERATE = 'moderate',
  COMPLEX = 'complex',
}

/**
 * Source types for content in ThinkDrop AI system
 */
export enum ContentSource {
  BIBLE_VERSE = 'bible_verse',
  COMMENTARY = 'commentary',
  ANSWERED_QUESTION = 'answered_question',
  BIBLIOGRAPHY = 'bibliography',
  RESEARCH_DOCUMENT = 'research_document',
  AUTOMATION_CONTEXT = 'automation_context',
  CACHED_RESPONSE = 'cached_response',
  USER_DOCUMENT = 'user_document',
}

/**
 * Context document retrieved from the knowledge base
 */
interface ContextDocument {
  text: string;
  source: ContentSource;
  reference?: string;
  score: number;
  metadata: Record<string, any>;
}

/**
 * Structure of the RAG content to be passed to the LLM
 */
interface RagContent {
  query: string;
  contexts: ContextDocument[];
  complexity: QueryComplexity;
  timestamp: string;
}

/**
 * Result of the RAG pipeline
 */
interface RagResult {
  ragContent: RagContent;
  contexts: ContextDocument[];
  latencyMs: number;
}

/**
 * Service that handles the Retrieval Augmented Generation pipeline
 * - Classifies queries by complexity
 * - Retrieves relevant context from vector database
 * - Prepares prompts with context for LLMs
 */
export class RagService {
  private static instance: RagService;
  private initialized = false;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): RagService {
    if (!RagService.instance) {
      RagService.instance = new RagService();
    }
    return RagService.instance;
  }

  /**
   * Initialize the RAG service
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize vector database service
      await vectorDbService.initialize();
      this.initialized = true;
      logger.info('RAG service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize RAG service', { error });
      throw error;
    }
  }

  /**
   * Get semantic cache key for a question
   */
  private getSemanticCacheKey(questionEmbedding: number[]): string {
    // Simple hash function for embedding vector
    const hash = Array.from(questionEmbedding)
      .slice(0, 10) // Use first 10 dimensions for the key
      .map(v => Math.round(v * 1000))
      .join('-');
    
    return `${REDIS_PREFIX.SEMANTIC_CACHE}${hash}`;
  }

  /**
   * Check if a similar question exists in cache
   * @param question User's question
   * @returns Cached response or null
   */
  private async checkSemanticCache(question: string): Promise<{ response: string; cacheAge: number } | null> {
    try {
      const startTime = performance.now();
      const redisClient = await getRedisClient();
      
      // Generate embedding for the question
      const { embedding } = await generateEmbedding(question);
      
      // Get semantic cache key
      const cacheKey = this.getSemanticCacheKey(embedding);
      
      // Check cache
      const cachedData = await redisClient.get(cacheKey);
      
      if (cachedData) {
        const parsed = JSON.parse(cachedData);
        const cacheAge = Date.now() - parsed.timestamp;
        
        analytics.trackCacheOperation({
          operation: 'hit',
          key: cacheKey,
          category: 'semantic',
        });
        
        logger.debug(`Semantic cache hit for question`, {
          questionLength: question.length,
          cacheAge: cacheAge,
        });
        
        return {
          response: parsed.response,
          cacheAge,
        };
      }
      
      analytics.trackCacheOperation({
        operation: 'miss',
        key: cacheKey,
        category: 'semantic',
      });
      
      return null;
    } catch (error) {
      logger.error('Error checking semantic cache', { error });
      return null;
    }
  }

  /**
   * Store response in semantic cache
   * @param question Original question
   * @param response The response to cache
   * @param ttl Cache time-to-live in seconds
   */
  private async storeInSemanticCache(question: string, response: string, ttl: number): Promise<void> {
    try {
      const redisClient = await getRedisClient();
      
      // Generate embedding for the question
      const { embedding } = await generateEmbedding(question);
      
      // Get semantic cache key
      const cacheKey = this.getSemanticCacheKey(embedding);
      
      // Store in cache
      const data = {
        question,
        response,
        timestamp: Date.now(),
      };
      
      await redisClient.set(cacheKey, JSON.stringify(data), { EX: ttl });
      
      analytics.trackCacheOperation({
        operation: 'set',
        key: cacheKey,
        category: 'semantic',
        ttl,
      });
      
      logger.debug(`Stored response in semantic cache`, { ttl });
    } catch (error) {
      logger.error('Error storing in semantic cache', { error });
    }
  }

  /**
   * Classify query complexity to determine appropriate model routing
   * @param query User's query
   * @returns Complexity level
   */
  public async classifyQuery(query: string): Promise<QueryComplexity> {
    try {
      // General-purpose heuristics for query complexity
      const queryLower = query.toLowerCase();
      const queryLength = query.length;
      const wordCount = query.split(/\s+/).length;
      
      // Complex queries - research, analysis, multi-step reasoning
      const complexKeywords = [
        'analyze', 'compare', 'evaluate', 'research', 'investigate',
        'methodology', 'framework', 'systematic', 'comprehensive',
        'relationship', 'correlation', 'causation', 'implications',
        'theology', 'doctrine', 'hermeneutics', 'exegesis', // Keep theological terms for backward compatibility
        'automation', 'workflow', 'integration', 'architecture'
      ];
      
      // Simple queries - direct lookups, basic questions
      const simplePatterns = [
        /what is/,
        /who is/,
        /when did/,
        /where is/,
        /how to/,
        /find .+/,
        /show me/,
        /list .+/,
        /verse about/, // Keep Bible patterns for backward compatibility
        /bible verse/,
        /scripture about/
      ];
      
      // Complex if contains complex keywords or is very long
      if (complexKeywords.some(keyword => queryLower.includes(keyword)) || 
          queryLength > 200 || wordCount > 30) {
        return QueryComplexity.COMPLEX;
      }
      
      // Simple if matches simple patterns or is very short
      if (simplePatterns.some(pattern => pattern.test(queryLower)) || 
          queryLength < 50 || wordCount < 8) {
        return QueryComplexity.SIMPLE;
      }
      
      // Default to moderate for most queries
      return QueryComplexity.MODERATE;
    } catch (error) {
      logger.error('Error classifying query complexity', { error });
      return QueryComplexity.MODERATE;
    }
  }

  /**
   * Retrieve relevant context from the vector database
   * @param query User's query
   * @param namespaces Optional specific namespaces to search (defaults to all available)
   * @returns Array of context documents
   */
  public async retrieveContext(query: string, namespaces?: string[]): Promise<ContextDocument[]> {
    const startTime = performance.now();
    
    try {
      // Ensure initialization
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Array to hold all retrieved contexts
      const contexts: ContextDocument[] = [];
      
      // Define search configurations for different content types
      const searchConfigs = [
        // Bible content (maintain backward compatibility)
        { namespace: NAMESPACE.BIBLE_VERSES, topK: 5, threshold: 0.65, source: ContentSource.BIBLE_VERSE },
        { namespace: NAMESPACE.COMMENTARIES, topK: 3, threshold: 0.7, source: ContentSource.COMMENTARY },
        { namespace: NAMESPACE.ANSWERED_QUESTIONS, topK: 2, threshold: 0.75, source: ContentSource.ANSWERED_QUESTION },
        
        // ThinkDrop AI content types
        { namespace: NAMESPACE.BIBLIOGRAPHY, topK: 4, threshold: 0.7, source: ContentSource.BIBLIOGRAPHY },
        { namespace: NAMESPACE.RESEARCH_DOCUMENTS, topK: 3, threshold: 0.72, source: ContentSource.RESEARCH_DOCUMENT },
        { namespace: NAMESPACE.AUTOMATION_CONTEXT, topK: 2, threshold: 0.8, source: ContentSource.AUTOMATION_CONTEXT },
        { namespace: NAMESPACE.FAST_VISION_CACHE, topK: 2, threshold: 0.85, source: ContentSource.CACHED_RESPONSE },
        { namespace: NAMESPACE.USER_DOCUMENTS, topK: 3, threshold: 0.7, source: ContentSource.USER_DOCUMENT },
      ];
      
      // Filter search configs if specific namespaces are requested
      const activeConfigs = namespaces 
        ? searchConfigs.filter(config => namespaces.includes(config.namespace))
        : searchConfigs;
      
      // Search across all configured namespaces
      const searchPromises = activeConfigs.map(async (config) => {
        try {
          const results = await vectorDbService.searchSimilar(
            query,
            config.namespace,
            config.topK,
            config.threshold
          );
          
          return results.map(result => ({
            text: result.text,
            source: config.source,
            reference: this.extractReference(result, config.source),
            score: result.score,
            metadata: { ...result.metadata, namespace: config.namespace },
          }));
        } catch (error) {
          logger.debug(`Failed to search namespace ${config.namespace}`, { error });
          return [];
        }
      });
      
      // Wait for all searches to complete
      const searchResults = await Promise.all(searchPromises);
      
      // Flatten and combine all results
      searchResults.forEach(results => {
        contexts.push(...results);
      });
      
      // Sort all contexts by relevance score (highest first)
      contexts.sort((a, b) => b.score - a.score);
      
      // Limit total results to prevent overwhelming the LLM
      const maxResults = 15;
      const finalContexts = contexts.slice(0, maxResults);
      
      // Track RAG operation in analytics
      analytics.trackRagOperation({
        operation: 'retrieve',
        status: 'success',
        documentCount: finalContexts.length,
        sourceType: finalContexts.length > 0 ? finalContexts[0].source : 'none',
        latencyMs: performance.now() - startTime,
      });
      
      logger.debug(`Retrieved ${finalContexts.length} contexts from ${activeConfigs.length} namespaces`, {
        queryLength: query.length,
        namespaces: activeConfigs.map(c => c.namespace)
      });
      
      return finalContexts;
    } catch (error) {
      logger.error('Error retrieving context for query', { error, query });
      
      // Track error in analytics
      analytics.trackRagOperation({
        operation: 'retrieve',
        status: 'error',
        errorType: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: performance.now() - startTime,
      });
      
      return [];
    }
  }
  
  /**
   * Extract appropriate reference based on content source
   */
  private extractReference(result: SearchResult, source: ContentSource): string {
    const metadata = result.metadata || {};
    
    switch (source) {
      case ContentSource.BIBLE_VERSE:
        return metadata.reference || 'Unknown reference';
      case ContentSource.COMMENTARY:
        return metadata.source || 'Unknown commentary';
      case ContentSource.ANSWERED_QUESTION:
        return metadata.question || 'Related question';
      case ContentSource.BIBLIOGRAPHY:
        return metadata.title || metadata.author || 'Bibliography entry';
      case ContentSource.RESEARCH_DOCUMENT:
        return metadata.title || metadata.filename || 'Research document';
      case ContentSource.AUTOMATION_CONTEXT:
        return metadata.task || metadata.context || 'Automation context';
      case ContentSource.CACHED_RESPONSE:
        return metadata.prompt || 'Cached response';
      case ContentSource.USER_DOCUMENT:
        return metadata.filename || metadata.title || 'User document';
      default:
        return 'Unknown source';
    }
  }

  /**
   * Format retrieved contexts into a prompt for the LLM
   * @param contexts Retrieved context documents
   * @returns Formatted context string
   */
  private formatContextsForPrompt(contexts: ContextDocument[]): string {
    if (contexts.length === 0) {
      return 'No relevant context found.';
    }
    
    let formattedContext = 'Here is relevant context from various sources:\n\n';
    
    // Group contexts by source type
    const contextsBySource = contexts.reduce((acc, context) => {
      if (!acc[context.source]) {
        acc[context.source] = [];
      }
      acc[context.source].push(context);
      return acc;
    }, {} as Record<ContentSource, ContextDocument[]>);
    
    // Format each source type with appropriate headers and formatting
    const sourceFormatters = {
      [ContentSource.BIBLE_VERSE]: (items: ContextDocument[]) => {
        formattedContext += '==== BIBLE VERSES ====\n';
        items.forEach(verse => {
          formattedContext += `${verse.reference}: "${verse.text}"\n\n`;
        });
      },
      [ContentSource.COMMENTARY]: (items: ContextDocument[]) => {
        formattedContext += '==== COMMENTARIES ====\n';
        items.forEach(commentary => {
          formattedContext += `From ${commentary.reference}:\n${commentary.text}\n\n`;
        });
      },
      [ContentSource.ANSWERED_QUESTION]: (items: ContextDocument[]) => {
        formattedContext += '==== PREVIOUSLY ANSWERED QUESTIONS ====\n';
        items.forEach(qa => {
          formattedContext += `Q: ${qa.reference}\nA: ${qa.text}\n\n`;
        });
      },
      [ContentSource.BIBLIOGRAPHY]: (items: ContextDocument[]) => {
        formattedContext += '==== BIBLIOGRAPHY ENTRIES ====\n';
        items.forEach(bib => {
          formattedContext += `${bib.reference}:\n${bib.text}\n\n`;
        });
      },
      [ContentSource.RESEARCH_DOCUMENT]: (items: ContextDocument[]) => {
        formattedContext += '==== RESEARCH DOCUMENTS ====\n';
        items.forEach(doc => {
          formattedContext += `From ${doc.reference}:\n${doc.text}\n\n`;
        });
      },
      [ContentSource.AUTOMATION_CONTEXT]: (items: ContextDocument[]) => {
        formattedContext += '==== AUTOMATION CONTEXT ====\n';
        items.forEach(ctx => {
          formattedContext += `${ctx.reference}:\n${ctx.text}\n\n`;
        });
      },
      [ContentSource.CACHED_RESPONSE]: (items: ContextDocument[]) => {
        formattedContext += '==== SIMILAR PREVIOUS RESPONSES ====\n';
        items.forEach(cached => {
          formattedContext += `Previous query: ${cached.reference}\nResponse: ${cached.text}\n\n`;
        });
      },
      [ContentSource.USER_DOCUMENT]: (items: ContextDocument[]) => {
        formattedContext += '==== USER DOCUMENTS ====\n';
        items.forEach(doc => {
          formattedContext += `From ${doc.reference}:\n${doc.text}\n\n`;
        });
      }
    };
    
    // Apply formatters in priority order
    const priorityOrder = [
      ContentSource.CACHED_RESPONSE,
      ContentSource.ANSWERED_QUESTION,
      ContentSource.AUTOMATION_CONTEXT,
      ContentSource.BIBLIOGRAPHY,
      ContentSource.RESEARCH_DOCUMENT,
      ContentSource.USER_DOCUMENT,
      ContentSource.BIBLE_VERSE,
      ContentSource.COMMENTARY
    ];
    
    priorityOrder.forEach(source => {
      if (contextsBySource[source] && contextsBySource[source].length > 0) {
        sourceFormatters[source](contextsBySource[source]);
      }
    });
    
    return formattedContext;
  }

  /**
   * Process a query through the RAG pipeline
   * @param query User's question
   * @returns RAG result with contexts and formatted content
   */
  public async process(query: string): Promise<RagResult> {
    const startTime = performance.now();
    
    try {
      // First check semantic cache
      const cachedResponse = await this.checkSemanticCache(query);
      if (cachedResponse) {
        return {
          ragContent: {
            query,
            contexts: [],
            complexity: QueryComplexity.SIMPLE,
            timestamp: new Date().toISOString(),
          },
          contexts: [],
          latencyMs: performance.now() - startTime,
        };
      }
      
      // Classify query complexity
      const complexity = await this.classifyQuery(query);
      
      // Retrieve relevant context
      const contexts = await this.retrieveContext(query);
      
      // Format RAG content
      const ragContent: RagContent = {
        query,
        contexts,
        complexity,
        timestamp: new Date().toISOString(),
      };
      
      // Track RAG operation in analytics
      analytics.trackRagOperation({
        operation: 'augment',
        status: 'success',
        documentCount: contexts.length,
        latencyMs: performance.now() - startTime,
      });
      
      return {
        ragContent,
        contexts,
        latencyMs: performance.now() - startTime,
      };
    } catch (error) {
      logger.error('Error in RAG pipeline', { error, query });
      
      // Track error in analytics
      analytics.trackRagOperation({
        operation: 'augment',
        status: 'error',
        errorType: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: performance.now() - startTime,
      });
      
      // Return minimal content on error
      return {
        ragContent: {
          query,
          contexts: [],
          complexity: QueryComplexity.SIMPLE,
          timestamp: new Date().toISOString(),
        },
        contexts: [],
        latencyMs: performance.now() - startTime,
      };
    }
  }

  /**
   * Create a prompt for the LLM that includes retrieved context
   * @param query User's question
   * @param contexts Retrieved context
   * @param systemPrompt Optional custom system prompt (defaults to general-purpose)
   * @returns Formatted prompt with context
   */
  public createAugmentedPrompt(query: string, contexts: ContextDocument[], systemPrompt?: string): string {
    const formattedContext = this.formatContextsForPrompt(contexts);
    
    // Default system prompt for ThinkDrop AI
    const defaultSystemPrompt = `You are an intelligent assistant for Thinkdrop AI. Answer the user's question using the provided context from retrieved sources whenever possible.

- Prioritize the retrieved context when relevant, and cite sources clearly (e.g., [Source Name] or [1]).
- If the context does not contain enough information, respond using general knowledge, but indicate when you're doing so.
- Be concise, accurate, and helpful. Structure your answer logically.
- When multiple sources are relevant, synthesize them for a complete answer.

Always distinguish between cited context and model-generated inference.`;
    
    // Detect if this is a Bible-related query for backward compatibility
    const isBibleQuery = query.toLowerCase().includes('bible') || 
                        query.toLowerCase().includes('scripture') || 
                        query.toLowerCase().includes('verse') ||
                        contexts.some(c => c.source === ContentSource.BIBLE_VERSE || c.source === ContentSource.COMMENTARY);
    
    const finalSystemPrompt = systemPrompt || 
      (isBibleQuery ? 
        `Answer the following question about the Bible using the provided context.
If the context doesn't contain relevant information, rely on your general knowledge but clearly indicate this.
Always cite specific Bible verses when they're directly relevant to the answer.` :
        defaultSystemPrompt);
    
    const prompt = `
${finalSystemPrompt}

CONTEXT:
${formattedContext}

QUESTION:
${query}

ANSWER:
`;
    
    return prompt;
  }

  /**
   * Store a successful response in the RAG system for future retrieval
   * @param question Original user question
   * @param answer AI-generated answer
   * @returns Success status
   */
  public async storeSuccessfulResponse(question: string, answer: string): Promise<boolean> {
    try {
      const startTime = performance.now();
      
      // Store in vector database for future retrieval
      await vectorDbService.storeDocument(
        {
          text: answer,
          metadata: {
            question,
            timestamp: new Date().toISOString(),
          },
        },
        NAMESPACE.ANSWERED_QUESTIONS
      );
      
      // Also store in semantic cache with appropriate TTL based on complexity
      const complexity = await this.classifyQuery(question);
      let ttl = TTL.AI_RESPONSE.DEFAULT;
      
      // Adjust TTL based on complexity
      switch (complexity) {
        case QueryComplexity.COMPLEX:
          ttl = TTL.AI_RESPONSE.THEOLOGICAL; // Longer TTL for complex theological questions
          break;
        case QueryComplexity.SIMPLE:
          ttl = TTL.AI_RESPONSE.TRENDING; // Shorter TTL for simple questions that may change with trends
          break;
      }
      
      // Store in semantic cache
      await this.storeInSemanticCache(question, answer, ttl);
      
      // Track in analytics
      analytics.trackRagOperation({
        operation: 'store',
        status: 'success',
        sourceType: 'QA',
        latencyMs: performance.now() - startTime,
      });
      
      return true;
    } catch (error) {
      logger.error('Error storing successful response', { error });
      
      // Track error in analytics
      analytics.trackRagOperation({
        operation: 'store',
        status: 'error',
        errorType: error instanceof Error ? error.message : 'Unknown error',
        latencyMs: 0,
      });
      
      return false;
    }
  }
}

// Create singleton instance
export const ragService = RagService.getInstance();

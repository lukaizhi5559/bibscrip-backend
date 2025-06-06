// Retrieval Augmented Generation (RAG) System for BibScrip
import { vectorDbService, SearchResult } from './vectorDbService';
import { generateEmbedding } from './embeddingService';
import { NAMESPACE } from '../config/vectorDb';
import { getRedisClient, REDIS_PREFIX, TTL } from '../config/redis';
import { logger } from '../utils/logger';
import { analytics } from '../utils/analytics';

/**
 * The complexity level of a theological query
 */
export enum QueryComplexity {
  SIMPLE = 'simple',
  MODERATE = 'moderate',
  COMPLEX = 'complex',
}

/**
 * Source types for theological content
 */
export enum ContentSource {
  BIBLE_VERSE = 'bible_verse',
  COMMENTARY = 'commentary',
  ANSWERED_QUESTION = 'answered_question',
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
    // TODO: For a production system, implement a more sophisticated classifier
    // using a small ML model or content-based heuristics
    
    // Simple heuristics for now:
    const complexWords = ['why', 'compare', 'contrast', 'explain', 'theological', 'doctrine', 'reconcile'];
    const moderateWords = ['how', 'what is', 'meaning', 'interpret', 'context'];
    
    const queryLower = query.toLowerCase();
    
    if (complexWords.some(word => queryLower.includes(word))) {
      return QueryComplexity.COMPLEX;
    } else if (moderateWords.some(word => queryLower.includes(word))) {
      return QueryComplexity.MODERATE;
    } else {
      return QueryComplexity.SIMPLE;
    }
  }

  /**
   * Retrieve relevant context from the vector database
   * @param query User's query
   * @returns Array of context documents
   */
  public async retrieveContext(query: string): Promise<ContextDocument[]> {
    const startTime = performance.now();
    
    try {
      // Ensure initialization
      if (!this.initialized) {
        await this.initialize();
      }
      
      // Array to hold all retrieved contexts
      const contexts: ContextDocument[] = [];
      
      // Get Bible verses (higher number for Bible verses to prioritize them)
      const bibleVerses = await vectorDbService.searchSimilar(
        query,
        NAMESPACE.BIBLE_VERSES,
        5, // Top 5 relevant verses
        0.65 // Lower threshold for Bible verses
      );
      
      // Get commentaries
      const commentaries = await vectorDbService.searchSimilar(
        query,
        NAMESPACE.COMMENTARIES,
        3, // Top 3 commentaries
        0.7
      );
      
      // Get previously answered questions
      const answeredQuestions = await vectorDbService.searchSimilar(
        query,
        NAMESPACE.ANSWERED_QUESTIONS,
        2, // Top 2 answered questions
        0.75 // Higher threshold for QA matches
      );
      
      // Transform search results to context documents
      bibleVerses.forEach(result => {
        contexts.push({
          text: result.text,
          source: ContentSource.BIBLE_VERSE,
          reference: result.metadata?.reference || 'Unknown reference',
          score: result.score,
          metadata: result.metadata,
        });
      });
      
      commentaries.forEach(result => {
        contexts.push({
          text: result.text,
          source: ContentSource.COMMENTARY,
          reference: result.metadata?.source || 'Unknown commentary',
          score: result.score,
          metadata: result.metadata,
        });
      });
      
      answeredQuestions.forEach(result => {
        contexts.push({
          text: result.text,
          source: ContentSource.ANSWERED_QUESTION,
          reference: result.metadata?.question || 'Related question',
          score: result.score,
          metadata: result.metadata,
        });
      });
      
      // Sort all contexts by relevance score
      contexts.sort((a, b) => b.score - a.score);
      
      // Track RAG operation in analytics
      analytics.trackRagOperation({
        operation: 'retrieve',
        status: 'success',
        documentCount: contexts.length,
        latencyMs: performance.now() - startTime,
      });
      
      return contexts;
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
   * Format retrieved contexts into a prompt for the LLM
   * @param contexts Retrieved context documents
   * @returns Formatted context string
   */
  private formatContextsForPrompt(contexts: ContextDocument[]): string {
    if (contexts.length === 0) {
      return 'No relevant Bible passages or commentaries found.';
    }
    
    let formattedContext = 'Here are relevant Bible passages and commentaries:\n\n';
    
    // Format Bible verses
    const bibleVerses = contexts.filter(c => c.source === ContentSource.BIBLE_VERSE);
    if (bibleVerses.length > 0) {
      formattedContext += '==== BIBLE VERSES ====\n';
      bibleVerses.forEach(verse => {
        formattedContext += `${verse.reference}: "${verse.text}"\n\n`;
      });
    }
    
    // Format commentaries
    const commentaries = contexts.filter(c => c.source === ContentSource.COMMENTARY);
    if (commentaries.length > 0) {
      formattedContext += '==== COMMENTARIES ====\n';
      commentaries.forEach(commentary => {
        formattedContext += `From ${commentary.reference}:\n${commentary.text}\n\n`;
      });
    }
    
    // Format previously answered questions
    const answeredQuestions = contexts.filter(c => c.source === ContentSource.ANSWERED_QUESTION);
    if (answeredQuestions.length > 0) {
      formattedContext += '==== PREVIOUSLY ANSWERED SIMILAR QUESTIONS ====\n';
      answeredQuestions.forEach(qa => {
        formattedContext += `Q: ${qa.reference}\nA: ${qa.text}\n\n`;
      });
    }
    
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
   * @returns Formatted prompt with context
   */
  public createAugmentedPrompt(query: string, contexts: ContextDocument[]): string {
    const formattedContext = this.formatContextsForPrompt(contexts);
    
    const prompt = `
Answer the following question about the Bible using the provided context. 
If the context doesn't contain relevant information, rely on your general knowledge but clearly indicate this.
Always cite specific Bible verses when they're directly relevant to the answer.

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

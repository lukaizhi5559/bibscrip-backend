// Queue Service for request pooling and batching
import { Queue, Worker, Job } from 'bullmq';
import { getRedisClient, REDIS_PREFIX } from '../config/redis';
import { analytics } from './analyticsService';
import { logger } from '../utils/logger';
import { ragService, QueryComplexity } from './ragService';
import { getBestLLMResponse, LLMResponse } from '../utils/llmRouter';
import { vectorDbService } from './vectorDbService';
import { performance } from 'perf_hooks';

// Import AIResponseObject interface for type safety
// Interface for AI response object that guarantees tokenUsage.total exists
interface AIResponseObject {
  text: string;
  provider?: string;
  tokenUsage: {
    total: number;
    [key: string]: number;
  };
  raw?: any;
  latencyMs?: number;
}

// Define job complexity levels (for pooling and batching)
export type ComplexityLevel = QueryComplexity | 'batch';

// Queue names
const QUEUES = {
  AI_REQUESTS: 'ai-requests',
  SIMILAR_QUESTIONS: 'similar-questions',
  EMBEDDING_GENERATION: 'embedding-generation',
};

// Job types
export enum JobType {
  AI_REQUEST = 'ai-request',
  BATCH_SIMILAR_QUESTIONS = 'batch-similar-questions',
  GENERATE_EMBEDDINGS = 'generate-embeddings',
}

// Request job data
interface AIRequestJobData {
  query: string;
  userId?: string;
  ip: string;
  timestamp: number;
  requestId: string;
  complexity: ComplexityLevel;
}

// Similar questions batch data
export interface SimilarQuestionsBatchData {
  queries: Array<{
    query: string;
    requestId: string;
    userId?: string;
    ip: string;
  }>;
  batchId: string;
  timestamp: number;
}

// Embedding generation job data
interface EmbeddingJobData {
  texts: string[];
  namespace: string;
  jobType: 'batch' | 'single';
  metadata?: Record<string, any>[];
}

// Queue service for managing request batching and processing
export class QueueService {
  private static instance: QueueService;
  private aiRequestsQueue!: Queue;
  private similarQuestionsQueue!: Queue;
  private embeddingQueue!: Queue;
  private initialized = false;

  private constructor() {
    // Will be initialized later when Redis is available
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): QueueService {
    if (!QueueService.instance) {
      QueueService.instance = new QueueService();
    }
    return QueueService.instance;
  }

  /**
   * Initialize queues and workers
   */
  public async initialize(): Promise<void> {
    if (this.initialized) return;
    
    try {
      // Make sure Redis client is ready
      await getRedisClient();
      
      const connection = {
        // Using the shared Redis connection
        host: process.env.REDIS_URL || 'localhost',
        port: 6379,
        password: process.env.REDIS_PASSWORD || undefined,
      };
      
      // Create queues
      this.aiRequestsQueue = new Queue(QUEUES.AI_REQUESTS, {
        connection,
        prefix: REDIS_PREFIX.QUEUE,
      });
      
      this.similarQuestionsQueue = new Queue(QUEUES.SIMILAR_QUESTIONS, {
        connection,
        prefix: REDIS_PREFIX.QUEUE,
      });
      
      this.embeddingQueue = new Queue(QUEUES.EMBEDDING_GENERATION, {
        connection,
        prefix: REDIS_PREFIX.QUEUE,
      });
      
      // In BullMQ 5.x, delayed job handling is automatic with properly configured queues
      // Just ensure worker options are properly set for stalled job handling
      
      // Initialize workers
      this.initializeWorkers(connection);
      
      this.initialized = true;
      logger.info('Queue service initialized');
    } catch (error) {
      logger.error('Failed to initialize queue service', { error });
      throw error;
    }
  }

  /**
   * Initialize workers for processing jobs
   */
  private initializeWorkers(connection: Record<string, any>): void {
    // AI requests worker
    new Worker(QUEUES.AI_REQUESTS, async (job: Job<AIRequestJobData>) => {
      return this.processAIRequest(job);
    }, { connection, prefix: REDIS_PREFIX.QUEUE });
    
    // Similar questions batch worker
    new Worker(QUEUES.SIMILAR_QUESTIONS, async (job: Job<SimilarQuestionsBatchData>) => {
      return this.processSimilarQuestionsBatch(job);
    }, { connection, prefix: REDIS_PREFIX.QUEUE });
    
    // Embedding generation worker
    new Worker(QUEUES.EMBEDDING_GENERATION, async (job: Job<EmbeddingJobData>) => {
      return this.processEmbeddingGeneration(job);
    }, { connection, prefix: REDIS_PREFIX.QUEUE });
  }

  /**
   * Queue an AI request for processing
   * Will attempt to batch similar questions received within a short time window
   * @param query User's query
   * @param userId Optional user ID for tracking
   * @param ip User's IP address
   * @returns Job ID for tracking
   */
  public async queueAIRequest(
    query: string,
    userId: string | undefined,
    ip: string
  ): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    
    try {
      // First determine question complexity for proper routing
      const complexity: ComplexityLevel = await ragService.classifyQuery(query);
      
      const jobData: AIRequestJobData = {
        query,
        userId,
        ip,
        timestamp: Date.now(),
        requestId,
        complexity,
      };
      
      // Add job to queue
      // Only batch simple questions; complex theological questions get immediate processing
      if (complexity === QueryComplexity.SIMPLE || complexity === QueryComplexity.MODERATE) {
        // Queue with a 500ms delay to allow for batching of similar questions
        await this.aiRequestsQueue.add(JobType.AI_REQUEST, jobData, {
          delay: 500,
          removeOnComplete: true,
          attempts: 2,
        });
        
        logger.debug('Queued simple question with batching delay', { requestId });
      } else {
        // Process complex questions immediately
        await this.aiRequestsQueue.add(JobType.AI_REQUEST, jobData, {
          removeOnComplete: true,
          attempts: 2,
        });
        
        logger.debug(`Queued ${complexity} question for immediate processing`, { requestId });
      }
      
      return requestId;
    } catch (error) {
      logger.error('Error queueing AI request', { error, requestId });
      throw error;
    }
  }

  /**
   * Process an AI request job
   * For simple questions, may batch with similar questions
   */
  private async processAIRequest(job: Job<AIRequestJobData>): Promise<any> {
    const { query, userId, ip, timestamp, requestId, complexity } = job.data;
    const startTime = performance.now();
    
    try {
      // For simple or moderate complexity, try to batch with similar questions
      if (complexity === QueryComplexity.SIMPLE || complexity === QueryComplexity.MODERATE) {
        // Check for similar questions in the queue
        const similarJobs = await this.aiRequestsQueue.getJobs(
          ['waiting', 'active', 'delayed']
        );
        
        // Find a similar batch job to add this to
        for (const j of similarJobs as Array<Job<AIRequestJobData>>) {
          const jData = j.data;
          // Only batch simple questions that are within 2 seconds of this one
          if (
            jData.complexity === 'simple' &&
            Math.abs(jData.timestamp - timestamp) < 2000
          ) {
            // Add this job to the batch
            const batchId = `batch-${Date.now()}`;
            const batchData: SimilarQuestionsBatchData = {
              queries: [
                { query, requestId, userId, ip },
                ...similarJobs.map((j: Job<AIRequestJobData>) => ({
                  query: j.data.query,
                  requestId: j.data.requestId,
                  userId: j.data.userId,
                  ip: j.data.ip,
                })),
              ],
              batchId,
              timestamp: Date.now(),
            };
            
            // Remove the jobs we're batching
            await Promise.all(similarJobs.map((j: Job<AIRequestJobData>) => j.remove()));
            
            // Add a new batch job
            await this.similarQuestionsQueue.add(JobType.BATCH_SIMILAR_QUESTIONS, batchData, {
              removeOnComplete: true,
            });
            
            logger.info(`Batched ${similarJobs.length + 1} similar questions`, { batchId });
            
            // Return early as the batch job will handle this
            return { status: 'batched', batchId };
          }
        }
      }
      
      // If we got here, process the question normally
      return this.processSingleQuestion(query, requestId, userId, ip);
    } catch (error) {
      logger.error('Error processing AI request', { error, requestId });
      throw error;
    }
  }

  /**
   * Process a batch of similar questions with a single AI call
   */
  private async processSimilarQuestionsBatch(job: Job<SimilarQuestionsBatchData>): Promise<any> {
    // We need to use the first query in the batch as our main query
    const { queries, batchId } = job.data;
    const mainQuery = queries[0]?.query || '';
    const startTime = performance.now();
    
    try {
      // Process through the RAG system to get relevant context for the main query
      const batchRagResult = await ragService.process(mainQuery);
      
      // Get all query texts for context
      const allQueryTexts = queries.map(q => q.query);
      
      // Create an augmented prompt with batch context
      // Note: We assume createAugmentedPrompt only takes two arguments
      const augmentedPrompt = ragService.createAugmentedPrompt(
        mainQuery, 
        batchRagResult.contexts
      );
      
      // Get response from AI model (will always return a string from getBestLLMResponse)
      const responseText = await getBestLLMResponse(augmentedPrompt);
      // Create a properly typed response object
      const typedResponse: AIResponseObject = {
        text: responseText,
        provider: 'unknown', // getBestLLMResponse only returns the text, not the provider
        tokenUsage: { 
          total: Math.ceil(responseText.length / 4), // Ensure total is a number, not undefined
          prompt: Math.ceil(augmentedPrompt.length / 4)
        }
      };
      
      // Store the successful response for primary query
      if (typedResponse.text) {
        await ragService.storeSuccessfulResponse(mainQuery, typedResponse.text);
      }
      
      // Track analytics for the batch
      analytics.trackAIRequest({
        provider: typedResponse.provider || 'unknown',
        fromCache: false,
        tokenUsage: typedResponse.tokenUsage,
        latencyMs: performance.now() - startTime,
        status: 'success',
        query: `batch:${batchId}`,
        complexity: 'batch', // 'batch' is part of ComplexityLevel which is accepted by analytics
      });
      
      // Track additional analytics for the similarity detection
      analytics.trackSimilarQuestionsBatch({
        count: queries.length,
        batchId,
        latencyMs: performance.now() - startTime
      });
      
      logger.info(`Processed batch of ${queries.length} similar questions`, {
        batchId,
        provider: typedResponse.provider || 'unknown',
        latencyMs: performance.now() - startTime,
      });
      
      // Return batch results
      return {
        batchId,
        response: typedResponse.text,
        queries: queries.map(q => q.requestId),
        provider: typedResponse.provider || 'unknown',
      };
    } catch (error) {
      logger.error('Error processing question batch', { error, batchId });
      throw error;
    }
  }

  /**
   * Process a single question (non-batched)
   */
  private async processSingleQuestion(
    query: string,
    requestId: string,
    userId: string | undefined,
    ip: string
  ): Promise<any> {
    const startTime = performance.now();
    
    try {
      // Process through RAG system
      const ragResult = await ragService.process(query);
      
      // Generate the augmented prompt
      const augmentedPrompt = ragService.createAugmentedPrompt(
        query,
        ragResult.contexts
      );
      
      // Get AI response (will always return a string from getBestLLMResponse)
      const responseText = await getBestLLMResponse(augmentedPrompt);
      // Create a properly typed response object
      const typedResponse: AIResponseObject = {
        text: responseText,
        provider: 'unknown', // getBestLLMResponse only returns the text, not the provider
        tokenUsage: { 
          total: Math.ceil(responseText.length / 4), // Ensure total is a number, not undefined
          prompt: Math.ceil(augmentedPrompt.length / 4)
        }
      };
      
      // Store the successful response for future retrieval
      if (typedResponse.text) {
        await ragService.storeSuccessfulResponse(query, typedResponse.text);
      }
      
      // Track analytics
      analytics.trackAIRequest({
        provider: typedResponse.provider || 'unknown',
        fromCache: false,
        tokenUsage: typedResponse.tokenUsage,
        latencyMs: performance.now() - startTime,
        status: 'success',
        query,
        complexity: String(ragResult.ragContent.complexity || QueryComplexity.MODERATE)
      });
      
      logger.info(`Processed single question`, {
        requestId,
        provider: typedResponse.provider,
        latencyMs: performance.now() - startTime,
      });
      
      return {
        requestId,
        response: typedResponse.text,
        provider: typedResponse.provider || 'unknown',
        contexts: ragResult.contexts.map(c => ({ source: c.source, content: c.text })),
        tokenUsage: typedResponse.tokenUsage,
        latencyMs: performance.now() - startTime,
      };
    } catch (error) {
      logger.error('Error processing single question', { error, requestId });
      throw error;
    }
  }

  /**
   * Queue embedding generation for multiple texts
   */
  public async queueEmbeddingGeneration(
    texts: string[],
    namespace: string,
    metadata?: Record<string, any>[]
  ): Promise<string> {
    if (!this.initialized) {
      await this.initialize();
    }
    
    const jobId = `emb-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    
    try {
      const jobData: EmbeddingJobData = {
        texts,
        namespace,
        jobType: texts.length > 1 ? 'batch' : 'single',
        metadata,
      };
      
      // Add job to queue
      await this.embeddingQueue.add(JobType.GENERATE_EMBEDDINGS, jobData, {
        jobId,
        removeOnComplete: true,
        attempts: 3,
      });
      
      logger.debug(`Queued ${texts.length} texts for embedding generation`, { jobId, namespace });
      return jobId;
    } catch (error) {
      logger.error('Error queueing embedding generation', { error });
      throw error;
    }
  }

  /**
   * Process embedding generation job
   */
  private async processEmbeddingGeneration(job: Job<EmbeddingJobData>): Promise<any> {
    const { texts, namespace, jobType, metadata } = job.data;
    
    try {
      // For batch processing, use vectorDbService.storeBatchDocuments
      if (jobType === 'batch' && texts.length > 1) {
        // Create documents with text and metadata
        const documents = texts.map((text: string, index: number) => ({
          text,
          metadata: metadata?.[index] || {},
        }));
        
        // Store batch in vector database
        const ids = await vectorDbService.storeBatchDocuments(documents, namespace);
        
        logger.info(`Batch processed ${texts.length} embeddings`, { namespace, job: job.id });
        return { status: 'success', count: texts.length, ids };
      } else {
        // Process single embedding
        const document = {
          text: texts[0],
          metadata: metadata?.[0] || {},
        };
        
        const id = await vectorDbService.storeDocument(document, namespace);
        
        logger.info('Processed single embedding', { namespace, job: job.id });
        return { status: 'success', id };
      }
    } catch (error) {
      logger.error('Error processing embedding generation', { error, job: job.id });
      throw error;
    }
  }

  /**
   * Close all queues and connections
   */
  public async close(): Promise<void> {
    if (this.initialized) {
      await this.aiRequestsQueue.close();
      await this.similarQuestionsQueue.close();
      await this.embeddingQueue.close();
      logger.info('Queue service closed');
    }
  }
}

// Create singleton instance
export const queueService = QueueService.getInstance();

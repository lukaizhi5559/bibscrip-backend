import OpenAI from 'openai';
import { getRedisClient } from '../config/redis';
import { logger } from '../utils/logger';

// Type definitions
export interface CachedResponse {
  question: string;
  answer: any;
  embedding: number[];
  timestamp: number;
}

export interface CacheHit {
  cachedResponse: CachedResponse;
  similarity: number;
  exactMatch: boolean;
}

export class SemanticCacheService {
  private readonly namespace: string;
  private readonly embeddingModel: string;
  private readonly similarityThreshold: number;
  private readonly ttlSeconds: number;
  
  constructor({
    namespace = 'semantic-cache:responses',
    embeddingModel = 'text-embedding-ada-002',
    similarityThreshold = 0.92, // High threshold for similarity
    ttlSeconds = 60 * 60 * 24 * 7 // 1 week default
  } = {}) {
    this.namespace = namespace;
    this.embeddingModel = embeddingModel;
    this.similarityThreshold = similarityThreshold;
    this.ttlSeconds = ttlSeconds;
    
    logger.info(`Semantic cache service initialized with threshold: ${this.similarityThreshold}`, {
      service: 'bibscrip-backend',
      component: 'semanticCache',
      threshold: this.similarityThreshold
    });
  }
  
  /**
   * Store a question and its response with embedding in the cache
   */
  async store(question: string, response: any): Promise<void> {
    try {
      const startTime = performance.now();
      const embedding = await this.getEmbedding(question);
      
      // Normalize the response - ensures consistent structure for easier retrieval
      let normalizedResponse: any;
      
      // Log the structure of the response for debugging
      console.log('STORING IN CACHE - Original response structure:', JSON.stringify(response, null, 2));
      
      // Handle different response structures
      if (typeof response === 'string') {
        // If it's a simple string, wrap it in a standard object format
        normalizedResponse = { text: response };
      } else if (typeof response === 'object' && response !== null) {
        if ('text' in response) {
          // Already in a suitable format
          normalizedResponse = response;
        } else {
          // Try to preserve the original structure but ensure there's a text field
          normalizedResponse = { ...response };
          // If no text field is present, try to extract it from common patterns
          if (!normalizedResponse.text) {
            if (typeof response.answer === 'string') {
              normalizedResponse.text = response.answer;
            } else if (response.content) {
              normalizedResponse.text = response.content;
            } else if (response.message) {
              normalizedResponse.text = response.message;
            }
          }
        }
      } else {
        // Fallback for unexpected formats
        normalizedResponse = { text: 'Error: Unable to process response' };
      }
      
      console.log('STORING IN CACHE - Normalized response structure:', JSON.stringify(normalizedResponse, null, 2));
      
      const cacheItem: CachedResponse = {
        question,
        answer: normalizedResponse,
        embedding,
        timestamp: Date.now()
      };
      
      const key = `${this.namespace}:${this.normalizeKey(question)}`;
      const redis = await getRedisClient();
      await redis.set(key, JSON.stringify(cacheItem), { EX: this.ttlSeconds });
      
      // Also store in the embedding index
      await this.addToEmbeddingIndex(key, embedding);
      
      const duration = performance.now() - startTime;
      logger.info(`Stored in semantic cache: "${question.substring(0, 50)}..."`, { 
        service: 'bibscrip-backend',
        operation: 'cache_store',
        duration
      });
    } catch (error) {
      logger.error('Error storing in semantic cache:', { errorMessage: error instanceof Error ? error.message : String(error) });
    }
  }
  
  /**
   * Find a semantically similar cached response
   */
  async find(question: string): Promise<CacheHit | null> {
    try {
      const startTime = performance.now();
      
      // First check for exact match (which is faster)
      const exactKey = `${this.namespace}:${this.normalizeKey(question)}`;
      const redis = await getRedisClient();
      const exactMatch = await redis.get(exactKey);
      
      if (exactMatch) {
        const cachedResponse = JSON.parse(exactMatch) as CachedResponse;
        const duration = performance.now() - startTime;
        
        logger.info(`Exact match found in semantic cache: "${question.substring(0, 50)}..."`, { 
          service: 'bibscrip-backend',
          operation: 'cache_hit_exact',
          duration
        });
        
        return {
          cachedResponse,
          similarity: 1.0,
          exactMatch: true
        };
      }
      
      // If no exact match, try semantic matching
      const questionEmbedding = await this.getEmbedding(question);
      const similarCache = await this.findSimilarEmbedding(questionEmbedding);
      
      if (similarCache) {
        const duration = performance.now() - startTime;
        logger.info(`Similar match found in semantic cache (${similarCache.similarity.toFixed(3)}): "${question.substring(0, 50)}..."`, { 
          service: 'bibscrip-backend',
          operation: 'cache_hit_similar',
          similarity: similarCache.similarity,
          duration
        });
        return similarCache;
      }
      
      const duration = performance.now() - startTime;
      logger.info(`No match found in semantic cache: "${question.substring(0, 50)}..."`, { 
        service: 'bibscrip-backend',
        operation: 'cache_miss',
        duration
      });
      return null;
    } catch (error) {
      logger.error('Error finding in semantic cache:', { errorMessage: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }
  
  /**
   * Get embedding for a text string
   */
  private async getEmbedding(text: string): Promise<number[]> {
    try {
      // Use direct OpenAI client
      const openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      
      const response = await openaiClient.embeddings.create({
        model: this.embeddingModel,
        input: text
      });
      
      // Cast the embedding to number[] as we know the OpenAI API returns this format
      const embedding = response.data[0].embedding as number[];
      
      return embedding;
    } catch (error) {
      logger.error('Error generating embedding:', { 
        errorMessage: error instanceof Error ? error.message : String(error),
        service: 'bibscrip-backend',
        component: 'semanticCache'
      });
      throw error;
    }
  }
  
  /**
   * Normalize a cache key to be Redis-friendly
   */
  private normalizeKey(text: string): string {
    // Convert to lowercase and remove special chars
    return text
      .trim()
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '_')
      .substring(0, 100); // Limit key length
  }
  
  /**
   * Add an embedding to our Redis index
   */
  private async addToEmbeddingIndex(key: string, embedding: number[]): Promise<void> {
    // Store the embedding with its key for later lookup
    const embedKey = `${this.namespace}:embeddings:${key}`;
    const redis = await getRedisClient();
    await redis.set(embedKey, JSON.stringify({ key, embedding }), { EX: this.ttlSeconds });
    
    // Add to the set of all embeddings for this namespace
    await redis.sAdd(`${this.namespace}:all_keys`, key);
  }
  
  /**
   * Find the most similar embedding in the cache
   */
  private async findSimilarEmbedding(embedding: number[]): Promise<CacheHit | null> {
    // Get Redis client
    const redis = await getRedisClient();
    
    // Get all cache keys
    const allKeys = await redis.sMembers(`${this.namespace}:all_keys`);
    
    let highestSimilarity = 0;
    let bestMatch: CachedResponse | null = null;
    
    // Fetch and compare all embeddings
    for (const key of allKeys) {
      const embedKeyData = await redis.get(`${this.namespace}:embeddings:${key}`);
      if (!embedKeyData) continue;
      
      const { key: itemKey } = JSON.parse(embedKeyData);
      
      // Get the full cached response
      const cachedItemData = await redis.get(itemKey);
      if (!cachedItemData) {
        // This is a stale reference, clean it up
        await redis.sRem(`${this.namespace}:all_keys`, key);
        continue;
      }
      
      const cachedItem = JSON.parse(cachedItemData) as CachedResponse;
      const similarity = this.cosineSimilarity(embedding, cachedItem.embedding);
      
      if (similarity > highestSimilarity) {
        highestSimilarity = similarity;
        bestMatch = cachedItem;
      }
    }
    
    // Check if the best match exceeds our threshold
    if (bestMatch && highestSimilarity >= this.similarityThreshold) {
      return {
        cachedResponse: bestMatch,
        similarity: highestSimilarity,
        exactMatch: false
      };
    }
    
    return null;
  }
  
  /**
   * Calculate cosine similarity between two embeddings
   */
  private cosineSimilarity(embeddingA: number[], embeddingB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    
    for (let i = 0; i < embeddingA.length; i++) {
      dotProduct += embeddingA[i] * embeddingB[i];
      normA += embeddingA[i] * embeddingA[i];
      normB += embeddingB[i] * embeddingB[i];
    }
    
    // If either vector is zero, similarity is 0
    if (normA === 0 || normB === 0) {
      return 0;
    }
    
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

// Export a default instance
export const semanticCache = new SemanticCacheService();

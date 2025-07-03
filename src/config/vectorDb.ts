// Vector Database Configuration for RAG system
import { Pinecone, Index } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

// Index configuration
const INDEX_NAME = process.env.PINECONE_INDEX || 'bibscrip-index';
const NAMESPACE = {
  // Bible content (backward compatibility)
  BIBLE_VERSES: 'bible-verses',
  COMMENTARIES: 'commentaries',
  ANSWERED_QUESTIONS: 'answered-questions',
  
  // ThinkDrop AI content types
  BIBLIOGRAPHY: 'bibliography',
  RESEARCH_DOCUMENTS: 'research_documents',
  AUTOMATION_CONTEXT: 'automation_context',
  FAST_VISION_CACHE: 'fast_vision_cache',
  USER_DOCUMENTS: 'user_documents',
  
  // Additional utility namespaces
  CACHED_RESPONSES: 'cached_responses',
  SYSTEM_CONTEXT: 'system_context',
};

// Pinecone client initialization with better error handling
let pinecone: Pinecone;
try {
  // Log the environment variables for debugging (masking the API key)
  logger.info('Initializing Pinecone client with:', { 
    apiKeyPresent: !!process.env.PINECONE_API_KEY,
    environment: process.env.PINECONE_ENVIRONMENT,
    index: process.env.PINECONE_INDEX || INDEX_NAME
  });
  
  // For SDK v6.1.0 we only need the apiKey
  pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY || '',
  });
} catch (error) {
  logger.error('Failed to initialize Pinecone client', { error });
  // Create a mock client that won't throw errors when used for basic operations
  pinecone = {} as Pinecone;
}

// Dimensions for OpenAI embeddings (text-embedding-ada-002 uses 1536 dimensions)
const EMBEDDING_DIMENSIONS = 1536;

// Initialize index with retry mechanism and fallback
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds
const FALLBACK_WARMUP_DELAY = 3000; // 3 seconds

let indexInitialized = false;
let indexInstance: Index | null = null;

const initVectorDb = async () => {
  if (!process.env.PINECONE_API_KEY) {
    logger.warn('Pinecone API key missing in environment variables. Vector database will not be available.');
    return null;
  }

  // If we've already tried and failed, use fallback after a small warmup delay
  if (indexInitialized && !indexInstance) {
    await new Promise(resolve => setTimeout(resolve, FALLBACK_WARMUP_DELAY));
    logger.info('Using fallback mode for vector database operations');
    return null;
  }

  let retryCount = 0;
  let lastError: Error | null = null;

  while (retryCount < MAX_RETRIES) {
    try {
      // Check if pinecone client is properly initialized
      if (!pinecone.listIndexes) {
        throw new Error('Pinecone client was not properly initialized');
      }

      // Check if index exists - modern SDK v6.1.0 syntax
      const indexesResponse = await pinecone.listIndexes();
      
      // In SDK v6.1.0, the response contains an 'indexes' array property
      const indexArray = indexesResponse.indexes || [];
      const indexExists = indexArray.some(idx => idx.name === INDEX_NAME);
      
      logger.info(`Index check result: ${indexExists ? 'found' : 'not found'}`, { 
        indexName: INDEX_NAME,
        availableIndexes: indexArray.map(idx => idx.name)
      });
      
      if (!indexExists) {
        logger.info(`Index ${INDEX_NAME} doesn't exist but we won't create it automatically`);
        logger.info(`Please create the index manually in the Pinecone console with proper settings`);
        throw new Error(`Index ${INDEX_NAME} does not exist`);
      } else {
        logger.info(`Index ${INDEX_NAME} already exists, getting details...`);
        
        // Get the index details
        const indexInfo = indexArray.find(idx => idx.name === INDEX_NAME);
        if (indexInfo) {
          logger.info(`Connected to index: ${INDEX_NAME}`, { 
            dimension: indexInfo.dimension,
            metric: indexInfo.metric,
            host: indexInfo.host
          });
        }
      }
      
      // Get the index using the modern API (lowercase 'index' method)
      indexInitialized = true;
      indexInstance = pinecone.index(INDEX_NAME);
      return indexInstance;
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Pinecone initialization attempt ${retryCount + 1}/${MAX_RETRIES} failed`, { error });
      retryCount++;
      
      if (retryCount < MAX_RETRIES) {
        logger.info(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  // All retries failed
  indexInitialized = true; // Mark as initialized but failed
  indexInstance = null;
  logger.error('Failed to initialize vector database after multiple attempts', { lastError });
  return null;
};

// Graceful index accessor function that won't throw if index initialization failed
const getIndex = async (): Promise<Index | null> => {
  if (indexInstance) {
    return indexInstance;
  }
  
  if (!indexInitialized) {
    try {
      const index = await initVectorDb();
      return index;
    } catch (error) {
      logger.error('Error accessing vector database index', { error });
      return null;
    }
  }
  
  return null;
};

export { pinecone, initVectorDb, getIndex, INDEX_NAME, NAMESPACE, EMBEDDING_DIMENSIONS };

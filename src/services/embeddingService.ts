// Text embedding generation service using OpenAI
import OpenAI from 'openai';
import { analytics } from '../utils/analytics';
import dotenv from 'dotenv';

dotenv.config();

// Initialize OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Default embedding model - text-embedding-ada-002
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-ada-002';

interface EmbeddingResult {
  embedding: number[];
  usage: {
    promptTokens: number;
    totalTokens: number;
  };
}

/**
 * Generate an embedding vector for a text string
 * @param text The text to create an embedding for
 * @param model Optional embedding model name
 * @returns Vector embedding array
 */
export async function generateEmbedding(text: string, model: string = DEFAULT_EMBEDDING_MODEL): Promise<EmbeddingResult> {
  const startTime = performance.now();

  try {
    const response = await openai.embeddings.create({
      model,
      input: text,
    });

    const embedding = response.data[0].embedding;
    const usage = response.usage;

    // Track embedding creation in analytics
    analytics.trackEmbeddingRequest({
      status: 'success',
      model,
      tokens: usage.total_tokens,
      latencyMs: performance.now() - startTime,
    });

    return {
      embedding,
      usage: {
        promptTokens: usage.prompt_tokens,
        totalTokens: usage.total_tokens,
      },
    };
  } catch (error) {
    console.error('Error generating embedding:', error);
    
    // Track embedding error in analytics
    analytics.trackEmbeddingRequest({
      status: 'error',
      model,
      errorType: error instanceof Error ? error.name : 'Unknown',
      latencyMs: performance.now() - startTime,
    });
    
    throw error;
  }
}

/**
 * Generate multiple embeddings in batch
 * @param texts Array of text strings to create embeddings for
 * @param model Optional embedding model name
 * @returns Array of embedding vectors
 */
export async function generateBatchEmbeddings(
  texts: string[],
  model: string = DEFAULT_EMBEDDING_MODEL
): Promise<number[][]> {
  const startTime = performance.now();
  
  try {
    const response = await openai.embeddings.create({
      model,
      input: texts,
    });

    // Track batch embedding in analytics
    analytics.trackEmbeddingRequest({
      status: 'success',
      model,
      tokens: response.usage.total_tokens,
      count: texts.length,
      latencyMs: performance.now() - startTime,
    });

    // Extract and return the embeddings in order
    return response.data.map(item => item.embedding);
  } catch (error) {
    console.error('Error generating batch embeddings:', error);
    
    // Track embedding error in analytics
    analytics.trackEmbeddingRequest({
      status: 'error',
      model,
      count: texts.length,
      errorType: error instanceof Error ? error.name : 'Unknown',
      latencyMs: performance.now() - startTime,
    });
    
    throw error;
  }
}

export { DEFAULT_EMBEDDING_MODEL };

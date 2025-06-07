import OpenAI from 'openai';
import { logger } from './logger';

// Initialize the OpenAI client
export const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function getEmbedding(text: string, model = 'text-embedding-ada-002'): Promise<number[]> {
  try {
    const response = await openai.embeddings.create({
      model,
      input: text
    });
    
    // Ensure embedding is an array of numbers
    const embedding = response.data[0].embedding;
    if (!Array.isArray(embedding)) {
      throw new Error('Unexpected embedding format from OpenAI API');
    }
    
    return embedding;
  } catch (error) {
    logger.error('Error getting embedding from OpenAI:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

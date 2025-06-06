// AI service for handling LLM requests
import { LLMRouter } from './llmRouter';

// Create a default LLM router instance
const llmRouter = new LLMRouter();

/**
 * Get response from an AI model
 * @param prompt The user prompt to send to the AI
 * @returns AI response text
 */
export async function getAIResponse(prompt: string): Promise<string> {
  try {
    // Use the LLM router to determine the appropriate model/provider
    const result = await llmRouter.processPrompt(prompt);
    return result.text;
  } catch (error) {
    console.error('Error getting AI response:', error);
    throw error;
  }
}

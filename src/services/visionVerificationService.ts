/**
 * Vision Verification Service
 * 
 * Shared service for verifying UI elements using LLM vision with fallback strategy
 * Used by both vision.ts API and intentExecutionEngine.ts
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { logger } from '../utils/logger';

// LLM client instances (injected from vision.ts)
let geminiClient: GoogleGenerativeAI | null = null;
let claudeClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let grokClient: OpenAI | null = null;

/**
 * Initialize the service with LLM clients
 */
export function initializeVisionVerification(clients: {
  gemini?: GoogleGenerativeAI;
  claude?: Anthropic;
  openai?: OpenAI;
  grok?: OpenAI;
}) {
  geminiClient = clients.gemini || null;
  claudeClient = clients.claude || null;
  openaiClient = clients.openai || null;
  grokClient = clients.grok || null;

  logger.info('Vision verification service initialized', {
    hasGemini: !!geminiClient,
    hasClaude: !!claudeClient,
    hasOpenAI: !!openaiClient,
    hasGrok: !!grokClient,
  });
}

/**
 * Verification result interface
 */
export interface VisionVerificationResult {
  exists: boolean;
  confidence: number;
  provider: 'gemini' | 'openai' | 'claude' | 'grok';
  latencyMs: number;
  reasoning?: string;
}

/**
 * Verify if an element exists in a screenshot using LLM vision with fallback
 * Tries providers in order: Gemini → OpenAI → Claude → Grok
 */
export async function verifyElementWithVision(
  screenshot: { base64: string; mimeType: string },
  description: string,
  options?: {
    includeReasoning?: boolean;
  }
): Promise<VisionVerificationResult> {
  const startTime = Date.now();
  const includeReasoning = options?.includeReasoning || false;

  // Try Gemini first (Priority 1 - best overall)
  if (geminiClient) {
    try {
      const result = await verifyWithGemini(screenshot, description, includeReasoning);
      const latencyMs = Date.now() - startTime;

      logger.info('Vision verify successful with Gemini', {
        description,
        exists: result.exists,
        confidence: result.confidence,
        latencyMs,
      });

      return {
        ...result,
        provider: 'gemini',
        latencyMs,
      };
    } catch (error: any) {
      logger.warn('Gemini vision verify failed, falling back to OpenAI', {
        error: error.message,
      });
    }
  }

  // Fallback to OpenAI (Priority 2)
  if (openaiClient) {
    try {
      const result = await verifyWithOpenAI(screenshot, description, includeReasoning);
      const latencyMs = Date.now() - startTime;

      logger.info('Vision verify successful with OpenAI', {
        description,
        exists: result.exists,
        confidence: result.confidence,
        latencyMs,
      });

      return {
        ...result,
        provider: 'openai',
        latencyMs,
      };
    } catch (error: any) {
      logger.warn('OpenAI vision verify failed, falling back to Claude', {
        error: error.message,
      });
    }
  }

  // Fallback to Claude (Priority 3)
  if (claudeClient) {
    try {
      const result = await verifyWithClaude(screenshot, description, includeReasoning);
      const latencyMs = Date.now() - startTime;

      logger.info('Vision verify successful with Claude', {
        description,
        exists: result.exists,
        confidence: result.confidence,
        latencyMs,
      });

      return {
        ...result,
        provider: 'claude',
        latencyMs,
      };
    } catch (error: any) {
      logger.warn('Claude vision verify failed, falling back to Grok', {
        error: error.message,
      });
    }
  }

  // Fallback to Grok (Priority 4 - last resort)
  if (grokClient) {
    try {
      const result = await verifyWithGrok(screenshot, description, includeReasoning);
      const latencyMs = Date.now() - startTime;

      logger.info('Vision verify successful with Grok', {
        description,
        exists: result.exists,
        confidence: result.confidence,
        latencyMs,
      });

      return {
        ...result,
        provider: 'grok',
        latencyMs,
      };
    } catch (error: any) {
      logger.error('All vision providers failed', {
        error: error.message,
      });
      throw new Error('All vision providers failed for verification');
    }
  }

  throw new Error('No vision providers available');
}

/**
 * Verify with Gemini
 */
async function verifyWithGemini(
  screenshot: { base64: string; mimeType: string },
  description: string,
  includeReasoning: boolean
): Promise<{ exists: boolean; confidence: number; reasoning?: string }> {
  if (!geminiClient) {
    throw new Error('Gemini client not initialized');
  }

  const model = geminiClient.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

  const prompt = includeReasoning
    ? `You are a vision AI that verifies if UI elements exist in screenshots.

Does this element exist: "${description}"?

Analyze the screenshot and return ONLY a JSON object:

{
  "exists": <true or false>,
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation of what you see>"
}`
    : `You are a vision AI that verifies if UI elements exist in screenshots.

Does this element exist: "${description}"?

Analyze the screenshot and return ONLY a JSON object:

{
  "exists": <true or false>,
  "confidence": <0.0 to 1.0>
}`;

  const result = await model.generateContent([
    prompt,
    {
      inlineData: {
        data: screenshot.base64,
        mimeType: screenshot.mimeType || 'image/png',
      },
    },
  ]);

  const response = result.response.text();
  const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);

  return {
    exists: parsed.exists,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
  };
}

/**
 * Verify with OpenAI
 */
async function verifyWithOpenAI(
  screenshot: { base64: string; mimeType: string },
  description: string,
  includeReasoning: boolean
): Promise<{ exists: boolean; confidence: number; reasoning?: string }> {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized');
  }

  const prompt = includeReasoning
    ? `You are a vision AI that verifies if UI elements exist in screenshots.

Does this element exist: "${description}"?

Analyze the screenshot and return ONLY a JSON object:

{
  "exists": <true or false>,
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation of what you see>"
}`
    : `You are a vision AI that verifies if UI elements exist in screenshots.

Does this element exist: "${description}"?

Analyze the screenshot and return ONLY a JSON object:

{
  "exists": <true or false>,
  "confidence": <0.0 to 1.0>
}`;

  const completion = await openaiClient.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${screenshot.mimeType || 'image/png'};base64,${screenshot.base64}`,
              detail: 'high',
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
    max_tokens: 100,
    temperature: 0.1,
  });

  const response = completion.choices[0]?.message?.content || '';
  const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
  const result = JSON.parse(cleaned);

  return {
    exists: result.exists,
    confidence: result.confidence,
    reasoning: result.reasoning,
  };
}

/**
 * Verify with Claude
 */
async function verifyWithClaude(
  screenshot: { base64: string; mimeType: string },
  description: string,
  includeReasoning: boolean
): Promise<{ exists: boolean; confidence: number; reasoning?: string }> {
  if (!claudeClient) {
    throw new Error('Claude client not initialized');
  }

  const prompt = includeReasoning
    ? `Does this element exist: "${description}"?

CRITICAL: Return ONLY valid JSON. No explanations. No markdown. No extra text before or after.

Required format:
{
  "exists": <true or false>,
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation of what you see>"
}`
    : `Does this element exist: "${description}"?

CRITICAL: Return ONLY valid JSON. No explanations. No markdown. No extra text before or after.

Required format:
{
  "exists": <true or false>,
  "confidence": <0.0 to 1.0>
}`;

  const message = await claudeClient.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 100,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: (screenshot.mimeType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp') || 'image/png',
              data: screenshot.base64,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  const response = message.content[0]?.type === 'text' ? message.content[0].text : '';
  const result = extractJsonFromResponse(response);

  return {
    exists: result.exists,
    confidence: result.confidence,
    reasoning: result.reasoning,
  };
}

/**
 * Verify with Grok
 */
async function verifyWithGrok(
  screenshot: { base64: string; mimeType: string },
  description: string,
  includeReasoning: boolean
): Promise<{ exists: boolean; confidence: number; reasoning?: string }> {
  if (!grokClient) {
    throw new Error('Grok client not initialized');
  }

  const prompt = includeReasoning
    ? `You are a vision AI that verifies if UI elements exist in screenshots.

Does this element exist: "${description}"?

Analyze the screenshot and return ONLY a JSON object:

{
  "exists": <true or false>,
  "confidence": <0.0 to 1.0>,
  "reasoning": "<brief explanation of what you see>"
}`
    : `You are a vision AI that verifies if UI elements exist in screenshots.

Does this element exist: "${description}"?

Analyze the screenshot and return ONLY a JSON object:

{
  "exists": <true or false>,
  "confidence": <0.0 to 1.0>
}`;

  const completion = await grokClient.chat.completions.create({
    model: 'grok-2-vision-1212',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${screenshot.mimeType || 'image/png'};base64,${screenshot.base64}`,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
    max_tokens: 100,
    temperature: 0.1,
  });

  const response = completion.choices[0]?.message?.content || '';
  const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
  const result = JSON.parse(cleaned);

  return {
    exists: result.exists,
    confidence: result.confidence,
    reasoning: result.reasoning,
  };
}

/**
 * Extract JSON from response (handles markdown code blocks)
 */
function extractJsonFromResponse(response: string): any {
  try {
    // Remove markdown code blocks
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    
    // Try to find JSON object
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
    
    // Try parsing the whole response
    return JSON.parse(cleaned);
  } catch (error) {
    logger.error('Failed to extract JSON from response', {
      response: response.substring(0, 200),
      error: (error as Error).message,
    });
    throw new Error('Failed to parse verification response');
  }
}

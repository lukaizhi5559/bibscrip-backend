import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const router = Router();

// Initialize vision clients
const claudeClient = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;

const openaiClient = process.env.OPENAI_API_KEY
  ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  : null;

const grokClient = process.env.GROK_API_KEY
  ? new OpenAI({ 
      apiKey: process.env.GROK_API_KEY,
      baseURL: 'https://api.x.ai/v1'
    })
  : null;

/**
 * POST /api/vision/locate
 * Find element coordinates in screenshot using vision AI
 * 
 * Request body:
 * {
 *   "screenshot": { "base64": "...", "mimeType": "image/png" },
 *   "description": "the chat input field at the bottom",
 *   "role": "input" // optional: button, input, link, etc.
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "coordinates": { "x": 640, "y": 850 },
 *   "confidence": 0.95,
 *   "provider": "claude",
 *   "latencyMs": 1234
 * }
 */
router.post('/locate', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { screenshot, description, role } = req.body;

    // Validate request
    if (!screenshot?.base64 || !description) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: screenshot.base64 and description',
      });
      return;
    }

    logger.info('Vision locate request received', {
      description,
      role,
      screenshotSize: screenshot.base64.length,
      userId: (req as any).user?.id,
    });

    const startTime = Date.now();

    // Try Claude first (best for vision)
    if (claudeClient) {
      try {
        const result = await locateWithClaude(screenshot, description, role);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision locate successful with Claude', {
          description,
          coordinates: result.coordinates,
          confidence: result.confidence,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'claude',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('Claude vision locate failed, falling back to OpenAI', {
          error: error.message,
        });
      }
    }

    // Fallback to OpenAI
    if (openaiClient) {
      try {
        const result = await locateWithOpenAI(screenshot, description, role);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision locate successful with OpenAI', {
          description,
          coordinates: result.coordinates,
          confidence: result.confidence,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'openai',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('OpenAI vision locate failed, falling back to Grok', {
          error: error.message,
        });
      }
    }

    // Fallback to Grok (slowest)
    if (grokClient) {
      try {
        const result = await locateWithGrok(screenshot, description, role);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision locate successful with Grok', {
          description,
          coordinates: result.coordinates,
          confidence: result.confidence,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'grok',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.error('Grok vision locate failed', { error: error.message });
      }
    }

    // All providers failed
    res.status(500).json({
      success: false,
      error: 'All vision providers failed',
      message: 'No vision API keys configured or all providers failed',
    });
  } catch (error: any) {
    logger.error('Vision locate failed', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to locate element',
      message: error.message,
    });
  }
});

/**
 * POST /api/vision/verify
 * Verify if an element exists in screenshot
 * 
 * Request body:
 * {
 *   "screenshot": { "base64": "...", "mimeType": "image/png" },
 *   "description": "the submit button"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "exists": true,
 *   "confidence": 0.92,
 *   "provider": "claude",
 *   "latencyMs": 1100
 * }
 */
router.post('/verify', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { screenshot, description } = req.body;

    // Validate request
    if (!screenshot?.base64 || !description) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: screenshot.base64 and description',
      });
      return;
    }

    logger.info('Vision verify request received', {
      description,
      screenshotSize: screenshot.base64.length,
      userId: (req as any).user?.id,
    });

    const startTime = Date.now();

    // Try Claude first
    if (claudeClient) {
      try {
        const result = await verifyWithClaude(screenshot, description);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision verify successful with Claude', {
          description,
          exists: result.exists,
          confidence: result.confidence,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'claude',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('Claude vision verify failed, falling back to OpenAI', {
          error: error.message,
        });
      }
    }

    // Fallback to OpenAI
    if (openaiClient) {
      try {
        const result = await verifyWithOpenAI(screenshot, description);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision verify successful with OpenAI', {
          description,
          exists: result.exists,
          confidence: result.confidence,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'openai',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('OpenAI vision verify failed, falling back to Grok', {
          error: error.message,
        });
      }
    }

    // Fallback to Grok (slowest)
    if (grokClient) {
      try {
        const result = await verifyWithGrok(screenshot, description);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision verify successful with Grok', {
          description,
          exists: result.exists,
          confidence: result.confidence,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'grok',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.error('Grok vision verify failed', { error: error.message });
      }
    }

    // All providers failed
    res.status(500).json({
      success: false,
      error: 'All vision providers failed',
      message: 'No vision API keys configured or all providers failed',
    });
  } catch (error: any) {
    logger.error('Vision verify failed', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to verify element',
      message: error.message,
    });
  }
});

/**
 * POST /api/vision/analyze
 * Analyze screenshot for OCR/text extraction
 * 
 * Request body:
 * {
 *   "screenshot": { "base64": "...", "mimeType": "image/png" },
 *   "query": "What text is visible on screen?" // optional
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "text": "Extracted text content...",
 *   "analysis": "Description of what's visible",
 *   "provider": "claude",
 *   "latencyMs": 1500
 * }
 */
router.post('/analyze', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { screenshot, query } = req.body;

    // Validate request
    if (!screenshot?.base64) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: screenshot.base64',
      });
      return;
    }

    logger.info('Vision analyze request received', {
      query: query || 'general analysis',
      screenshotSize: screenshot.base64.length,
      userId: (req as any).user?.id,
    });

    const startTime = Date.now();

    // Try Claude first
    if (claudeClient) {
      try {
        const result = await analyzeWithClaude(screenshot, query);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision analyze successful with Claude', {
          textLength: result.text?.length || 0,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'claude',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('Claude vision analyze failed, falling back to OpenAI', {
          error: error.message,
        });
      }
    }

    // Fallback to OpenAI
    if (openaiClient) {
      try {
        const result = await analyzeWithOpenAI(screenshot, query);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision analyze successful with OpenAI', {
          textLength: result.text?.length || 0,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'openai',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('OpenAI vision analyze failed, falling back to Grok', {
          error: error.message,
        });
      }
    }

    // Fallback to Grok (slowest)
    if (grokClient) {
      try {
        const result = await analyzeWithGrok(screenshot, query);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision analyze successful with Grok', {
          textLength: result.text?.length || 0,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'grok',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.error('Grok vision analyze failed', { error: error.message });
      }
    }

    // All providers failed
    res.status(500).json({
      success: false,
      error: 'All vision providers failed',
      message: 'No vision API keys configured or all providers failed',
    });
  } catch (error: any) {
    logger.error('Vision analyze failed', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to analyze screenshot',
      message: error.message,
    });
  }
});

// ============================================================================
// Helper Functions - Claude
// ============================================================================

async function locateWithClaude(
  screenshot: { base64: string; mimeType: string },
  description: string,
  role?: string
): Promise<{ coordinates: { x: number; y: number }; confidence: number }> {
  if (!claudeClient) {
    throw new Error('Claude client not initialized');
  }

  const roleHint = role ? ` (a ${role} element)` : '';
  const prompt = `You are a vision AI that locates UI elements in screenshots.

Find the element: "${description}"${roleHint}

Analyze the screenshot and return ONLY a JSON object with the pixel coordinates of the element's center:

{
  "x": <number>,
  "y": <number>,
  "confidence": <0.0 to 1.0>
}

If the element is not found, return confidence 0.0 and estimate where it might be.`;

  const message = await claudeClient.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 200,
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
  const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
  const result = JSON.parse(cleaned);

  return {
    coordinates: { x: result.x, y: result.y },
    confidence: result.confidence,
  };
}

async function verifyWithClaude(
  screenshot: { base64: string; mimeType: string },
  description: string
): Promise<{ exists: boolean; confidence: number }> {
  if (!claudeClient) {
    throw new Error('Claude client not initialized');
  }

  const prompt = `You are a vision AI that verifies if UI elements exist in screenshots.

Does this element exist: "${description}"?

Analyze the screenshot and return ONLY a JSON object:

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
  const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
  const result = JSON.parse(cleaned);

  return {
    exists: result.exists,
    confidence: result.confidence,
  };
}

async function analyzeWithClaude(
  screenshot: { base64: string; mimeType: string },
  query?: string
): Promise<{ text: string; analysis: string }> {
  if (!claudeClient) {
    throw new Error('Claude client not initialized');
  }

  const prompt = query || `Analyze this screenshot and extract all visible text. Also provide a brief description of what you see.

Return a JSON object:
{
  "text": "<all visible text>",
  "analysis": "<brief description of UI>"
}`;

  const message = await claudeClient.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 2000,
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
  
  // Try to parse as JSON first
  try {
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    const result = JSON.parse(cleaned);
    return {
      text: result.text || '',
      analysis: result.analysis || response,
    };
  } catch {
    // If not JSON, return raw response
    return {
      text: response,
      analysis: response,
    };
  }
}

// ============================================================================
// Helper Functions - OpenAI
// ============================================================================

async function locateWithOpenAI(
  screenshot: { base64: string; mimeType: string },
  description: string,
  role?: string
): Promise<{ coordinates: { x: number; y: number }; confidence: number }> {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized');
  }

  const roleHint = role ? ` (a ${role} element)` : '';
  const prompt = `You are a vision AI that locates UI elements in screenshots.

Find the element: "${description}"${roleHint}

Analyze the screenshot and return ONLY a JSON object with the pixel coordinates of the element's center:

{
  "x": <number>,
  "y": <number>,
  "confidence": <0.0 to 1.0>
}

If the element is not found, return confidence 0.0 and estimate where it might be.`;

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
    max_tokens: 200,
    temperature: 0.1,
  });

  const response = completion.choices[0]?.message?.content || '';
  const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
  const result = JSON.parse(cleaned);

  return {
    coordinates: { x: result.x, y: result.y },
    confidence: result.confidence,
  };
}

async function verifyWithOpenAI(
  screenshot: { base64: string; mimeType: string },
  description: string
): Promise<{ exists: boolean; confidence: number }> {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized');
  }

  const prompt = `You are a vision AI that verifies if UI elements exist in screenshots.

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
  };
}

async function analyzeWithOpenAI(
  screenshot: { base64: string; mimeType: string },
  query?: string
): Promise<{ text: string; analysis: string }> {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized');
  }

  const prompt = query || `Analyze this screenshot and extract all visible text. Also provide a brief description of what you see.

Return a JSON object:
{
  "text": "<all visible text>",
  "analysis": "<brief description of UI>"
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
    max_tokens: 2000,
    temperature: 0.1,
  });

  const response = completion.choices[0]?.message?.content || '';
  
  // Try to parse as JSON first
  try {
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    const result = JSON.parse(cleaned);
    return {
      text: result.text || '',
      analysis: result.analysis || response,
    };
  } catch {
    // If not JSON, return raw response
    return {
      text: response,
      analysis: response,
    };
  }
}

// ============================================================================
// Helper Functions - Grok
// ============================================================================

async function locateWithGrok(
  screenshot: { base64: string; mimeType: string },
  description: string,
  role?: string
): Promise<{ coordinates: { x: number; y: number }; confidence: number }> {
  if (!grokClient) {
    throw new Error('Grok client not initialized');
  }

  const roleHint = role ? ` (a ${role} element)` : '';
  const prompt = `You are a vision AI that locates UI elements in screenshots.

Find the element: "${description}"${roleHint}

Analyze the screenshot and return ONLY a JSON object with the pixel coordinates of the element's center:

{
  "x": <number>,
  "y": <number>,
  "confidence": <0.0 to 1.0>
}

If the element is not found, return confidence 0.0 and estimate where it might be.`;

  const completion = await grokClient.chat.completions.create({
    model: 'grok-vision-beta', // Grok's vision model
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
    max_tokens: 200,
    temperature: 0.1,
  });

  const response = completion.choices[0]?.message?.content || '';
  const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
  const result = JSON.parse(cleaned);

  return {
    coordinates: { x: result.x, y: result.y },
    confidence: result.confidence,
  };
}

async function verifyWithGrok(
  screenshot: { base64: string; mimeType: string },
  description: string
): Promise<{ exists: boolean; confidence: number }> {
  if (!grokClient) {
    throw new Error('Grok client not initialized');
  }

  const prompt = `You are a vision AI that verifies if UI elements exist in screenshots.

Does this element exist: "${description}"?

Analyze the screenshot and return ONLY a JSON object:

{
  "exists": <true or false>,
  "confidence": <0.0 to 1.0>
}`;

  const completion = await grokClient.chat.completions.create({
    model: 'grok-vision-beta',
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
  };
}

async function analyzeWithGrok(
  screenshot: { base64: string; mimeType: string },
  query?: string
): Promise<{ text: string; analysis: string }> {
  if (!grokClient) {
    throw new Error('Grok client not initialized');
  }

  const prompt = query || `Analyze this screenshot and extract all visible text. Also provide a brief description of what you see.

Return a JSON object:
{
  "text": "<all visible text>",
  "analysis": "<brief description of UI>"
}`;

  const completion = await grokClient.chat.completions.create({
    model: 'grok-vision-beta',
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
    max_tokens: 2000,
    temperature: 0.1,
  });

  const response = completion.choices[0]?.message?.content || '';
  
  // Try to parse as JSON first
  try {
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    const result = JSON.parse(cleaned);
    return {
      text: result.text || '',
      analysis: result.analysis || response,
    };
  } catch {
    // If not JSON, return raw response
    return {
      text: response,
      analysis: response,
    };
  }
}

export default router;

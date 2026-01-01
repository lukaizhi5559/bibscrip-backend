import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { guiActorClient } from '../services/guiActorClient';

const router = Router();

// Initialize vision clients
const geminiClient = process.env.GEMINI_API_KEY
  ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY)
  : null;

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
    const { screenshot, description, role, screenInfo, windowBounds } = req.body;

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
      hasScreenInfo: !!screenInfo,
      screenInfo: screenInfo ? {
        width: screenInfo.width,
        height: screenInfo.height,
        scaleFactor: screenInfo.scaleFactor,
      } : undefined,
      hasWindowBounds: !!windowBounds,
      windowBounds: windowBounds ? {
        x: windowBounds.x,
        y: windowBounds.y,
        width: windowBounds.width,
        height: windowBounds.height,
      } : undefined,
      userId: (req as any).user?.id,
    });

    const startTime = Date.now();

    // Try GUI-Actor first (highest accuracy for UI grounding - 75-85% vs OpenAI's 16%)
    if (guiActorClient.isEnabled()) {
      try {
        const result = await guiActorClient.locate(screenshot, description, screenInfo);
        const latencyMs = Date.now() - startTime;

        // Apply window bounds offset if provided
        const finalCoordinates = windowBounds ? {
          x: result.coordinates.x + windowBounds.x,
          y: result.coordinates.y + windowBounds.y,
        } : result.coordinates;

        logger.info('Vision locate successful with GUI-Actor', {
          description,
          coordinates: finalCoordinates,
          rawCoordinates: result.coordinates,
          windowOffset: windowBounds ? { x: windowBounds.x, y: windowBounds.y } : null,
          confidence: result.confidence,
          latencyMs,
          isZeroCoordinates: result.coordinates.x === 0 && result.coordinates.y === 0,
          isLowConfidence: result.confidence < 0.3,
        });
        
        // Log warning if returning (0,0) coordinates
        if (result.coordinates.x === 0 && result.coordinates.y === 0) {
          logger.warn('⚠️ GUI-Actor returned (0,0) coordinates - element likely not found', {
            description,
            confidence: result.confidence,
            provider: 'gui-actor',
          });
        }

        res.status(200).json({
          success: true,
          coordinates: finalCoordinates,
          confidence: result.confidence,
          provider: 'gui-actor',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('GUI-Actor vision locate failed, falling back to OpenAI', {
          error: error.message,
        });
      }
    }

    // Try Gemini (Priority 2 - best bounding box accuracy, returns normalized 0-1000 coordinates)
    if (geminiClient) {
      try {
        const result = await locateWithGemini(screenshot, description, role, screenInfo);
        const latencyMs = Date.now() - startTime;

        // Apply window bounds offset if provided
        const finalCoordinates = windowBounds ? {
          x: result.coordinates.x + windowBounds.x,
          y: result.coordinates.y + windowBounds.y,
        } : result.coordinates;

        logger.info('Vision locate successful with Gemini', {
          description,
          coordinates: finalCoordinates,
          rawCoordinates: result.coordinates,
          windowOffset: windowBounds ? { x: windowBounds.x, y: windowBounds.y } : null,
          confidence: result.confidence,
          latencyMs,
          isZeroCoordinates: result.coordinates.x === 0 && result.coordinates.y === 0,
          isLowConfidence: result.confidence < 0.3,
        });
        
        // Log warning if returning (0,0) coordinates
        if (result.coordinates.x === 0 && result.coordinates.y === 0) {
          logger.warn('⚠️ Gemini returned (0,0) coordinates - element likely not found', {
            description,
            confidence: result.confidence,
            provider: 'gemini',
          });
        }

        res.status(200).json({
          success: true,
          coordinates: finalCoordinates,
          confidence: result.confidence,
          provider: 'gemini',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('Gemini vision locate failed, falling back to OpenAI', {
          error: error.message,
        });
      }
    }

    // Try OpenAI (Priority 3 - general vision model)
    if (openaiClient) {
      try {
        const result = await locateWithOpenAI(screenshot, description, role, screenInfo);
        const latencyMs = Date.now() - startTime;

        // Apply window bounds offset if provided
        const finalCoordinates = windowBounds ? {
          x: result.coordinates.x + windowBounds.x,
          y: result.coordinates.y + windowBounds.y,
        } : result.coordinates;

        logger.info('Vision locate successful with OpenAI', {
          description,
          coordinates: finalCoordinates,
          rawCoordinates: result.coordinates,
          windowOffset: windowBounds ? { x: windowBounds.x, y: windowBounds.y } : null,
          confidence: result.confidence,
          latencyMs,
          isZeroCoordinates: result.coordinates.x === 0 && result.coordinates.y === 0,
          isLowConfidence: result.confidence < 0.3,
        });
        
        // Log warning if returning (0,0) coordinates
        if (result.coordinates.x === 0 && result.coordinates.y === 0) {
          logger.warn('⚠️ Vision API returned (0,0) coordinates - element likely not found', {
            description,
            confidence: result.confidence,
            provider: 'openai',
          });
        }

        res.status(200).json({
          success: true,
          coordinates: finalCoordinates,
          confidence: result.confidence,
          provider: 'openai',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('OpenAI vision locate failed, falling back to Claude', {
          error: error.message,
        });
      }
    }

    // Fallback to Claude
    if (claudeClient) {
      try {
        const result = await locateWithClaude(screenshot, description, role, screenInfo);
        const latencyMs = Date.now() - startTime;

        // Apply window bounds offset if provided
        const finalCoordinates = windowBounds ? {
          x: result.coordinates.x + windowBounds.x,
          y: result.coordinates.y + windowBounds.y,
        } : result.coordinates;

        logger.info('Vision locate successful with Claude', {
          description,
          coordinates: finalCoordinates,
          rawCoordinates: result.coordinates,
          windowOffset: windowBounds ? { x: windowBounds.x, y: windowBounds.y } : null,
          confidence: result.confidence,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          coordinates: finalCoordinates,
          confidence: result.confidence,
          provider: 'claude',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('Claude vision locate failed, falling back to Grok', {
          error: error.message,
        });
      }
    }

    // Fallback to Grok (slowest)
    if (grokClient) {
      try {
        const result = await locateWithGrok(screenshot, description, role, screenInfo);
        const latencyMs = Date.now() - startTime;

        // Apply window bounds offset if provided
        const finalCoordinates = windowBounds ? {
          x: result.coordinates.x + windowBounds.x,
          y: result.coordinates.y + windowBounds.y,
        } : result.coordinates;

        logger.info('Vision locate successful with Grok', {
          description,
          coordinates: finalCoordinates,
          rawCoordinates: result.coordinates,
          windowOffset: windowBounds ? { x: windowBounds.x, y: windowBounds.y } : null,
          confidence: result.confidence,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          coordinates: finalCoordinates,
          confidence: result.confidence,
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

    // Try OpenAI first (best for vision verification)
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
        logger.warn('OpenAI vision verify failed, falling back to Claude', {
          error: error.message,
        });
      }
    }

    // Fallback to Claude
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
        logger.warn('Claude vision verify failed, falling back to Grok', {
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
 * Analyze screenshot content with optional query
 * 
 * Request body:
 * {
 *   "screenshot": { "base64": "...", "mimeType": "image/png" },
 *   "query": "What's on my screen?" (optional),
 *   "speedMode": "fast" | "balanced" | "accurate" (optional, default: "balanced"),
 *   "stream": true | false (optional, default: false)
 * }
 * 
 * Response (non-streaming):
 * {
 *   "success": true,
 *   "text": "Extracted text content...",
 *   "analysis": "Description of what's visible",
 *   "provider": "claude",
 *   "latencyMs": 1500
 * }
 * 
 * Response (streaming): Server-Sent Events (SSE)
 * data: {"type": "chunk", "content": "partial text..."}
 * data: {"type": "done", "provider": "claude", "latencyMs": 1234}
 */
router.post('/analyze', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { screenshot, query, speedMode, stream, provider } = req.body;

    // Validate request
    if (!screenshot?.base64) {
      res.status(400).json({
        success: false,
        error: 'Missing required field: screenshot.base64',
      });
      return;
    }

    // Default to 'balanced' mode (best speed/accuracy trade-off)
    const mode = speedMode || 'balanced';

    // Default to Gemini if no provider is specified
    const preferredProvider = provider || 'gemini';

    logger.info('Vision analyze request received', {
      query: query || 'general analysis',
      screenshotSize: screenshot.base64.length,
      speedMode: mode,
      stream: !!stream,
      preferredProvider: provider,
      userId: (req as any).user?.id,
    });

    const startTime = Date.now();

    // If streaming is requested, set up SSE
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.flushHeaders();

      // Helper to send SSE events
      const sendEvent = (data: any) => {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
      };

      try {
        // If specific provider requested, try that first
        if (preferredProvider === 'claude' && claudeClient) {
          try {
            await analyzeWithClaudeStreaming(screenshot, query, mode, sendEvent);
            const latencyMs = Date.now() - startTime;
            
            sendEvent({ type: 'done', provider: 'claude', latencyMs });
            res.end();
            return;
          } catch (error: any) {
            logger.warn('Claude streaming failed', { error: error.message });
          }
        }

        // Default: Try OpenAI first (with streaming)
        if (openaiClient && preferredProvider !== 'claude') {
          try {
            await analyzeWithOpenAIStreaming(screenshot, query, mode, sendEvent);
            const latencyMs = Date.now() - startTime;
            
            sendEvent({ type: 'done', provider: 'openai', latencyMs });
            res.end();
            return;
          } catch (error: any) {
            logger.warn('OpenAI streaming failed, falling back to Claude', {
              error: error.message,
            });
          }
        }

        // Fallback to Claude streaming
        if (claudeClient) {
          try {
            await analyzeWithClaudeStreaming(screenshot, query, mode, sendEvent);
            const latencyMs = Date.now() - startTime;
            
            sendEvent({ type: 'done', provider: 'claude', latencyMs });
            res.end();
            return;
          } catch (error: any) {
            logger.warn('Claude streaming failed', { error: error.message });
          }
        }

        // If streaming fails, send error
        sendEvent({ type: 'error', error: 'All streaming providers failed' });
        res.end();
        return;
      } catch (error: any) {
        sendEvent({ type: 'error', error: error.message });
        res.end();
        return;
      }
    }

    // Non-streaming path (original logic)
    // If specific provider requested, try that first
    if (preferredProvider === 'gemini' && geminiClient) {
      try {
        const result = await analyzeWithGemini(screenshot, query, mode);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision analyze successful with Gemini 3 Pro (forced)', {
          textLength: result.text?.length || 0,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'gemini',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('Gemini 3 Pro vision analyze failed', {
          error: error.message,
        });
      }
    }

    if (preferredProvider === 'gemini-2.5' && geminiClient) {
      try {
        const result = await analyzeWithGemini25(screenshot, query, mode);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision analyze successful with Gemini 2.5 Pro (forced)', {
          textLength: result.text?.length || 0,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'gemini-2.5',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('Gemini 2.5 Pro vision analyze failed', {
          error: error.message,
        });
      }
    }

    if (preferredProvider === 'claude' && claudeClient) {
      try {
        const result = await analyzeWithClaude(screenshot, query, mode);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision analyze successful with Claude (forced)', {
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
        logger.warn('Claude vision analyze failed', {
          error: error.message,
        });
      }
    }

    if (preferredProvider === 'grok' && grokClient) {
      try {
        const result = await analyzeWithGrok(screenshot, query, mode);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision analyze successful with Grok (forced)', {
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
        logger.warn('Grok vision analyze failed', {
          error: error.message,
        });
      }
    }

    // Default fallback order: Try Gemini 3 Pro first (latest model)
    if (geminiClient && preferredProvider !== 'claude' && preferredProvider !== 'grok' && preferredProvider !== 'openai' && preferredProvider !== 'gemini-2.5') {
      try {
        const result = await analyzeWithGemini(screenshot, query, mode);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision analyze successful with Gemini 3 Pro', {
          textLength: result.text?.length || 0,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'gemini',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('Gemini 3 Pro vision analyze failed, trying Gemini 2.5', {
          error: error.message,
        });
      }
    }

    // Fallback to Gemini 2.5 Pro (faster, more stable)
    if (geminiClient && preferredProvider !== 'claude' && preferredProvider !== 'grok' && preferredProvider !== 'openai') {
      try {
        const result = await analyzeWithGemini25(screenshot, query, mode);
        const latencyMs = Date.now() - startTime;

        logger.info('Vision analyze successful with Gemini 2.5 Pro', {
          textLength: result.text?.length || 0,
          latencyMs,
        });

        res.status(200).json({
          success: true,
          ...result,
          provider: 'gemini-2.5',
          latencyMs,
        });
        return;
      } catch (error: any) {
        logger.warn('Gemini 2.5 Pro vision analyze failed, falling back to OpenAI', {
          error: error.message,
        });
      }
    }

    // Fallback to OpenAI
    if (openaiClient && preferredProvider !== 'claude' && preferredProvider !== 'grok') {
      try {
        const result = await analyzeWithOpenAI(screenshot, query, mode);
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
        logger.warn('OpenAI vision analyze failed, falling back to Claude', {
          error: error.message,
        });
      }
    }

    // Fallback to Claude
    if (claudeClient) {
      try {
        const result = await analyzeWithClaude(screenshot, query, mode);
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
        logger.warn('Claude vision analyze failed, falling back to Grok', {
          error: error.message,
        });
      }
    }

    // Fallback to Grok (slowest)
    if (grokClient) {
      try {
        const result = await analyzeWithGrok(screenshot, query, mode);
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

/**
 * Extracts JSON from Claude's response, handling various formats:
 * - Plain JSON
 * - JSON in markdown code blocks
 * - JSON with surrounding text
 */
function extractJsonFromResponse(response: string): any {
  let cleaned = response.trim();
  
  // Remove markdown code blocks
  cleaned = cleaned.replace(/```(?:json)?\n?/g, '').trim();
  
  // Try to parse as-is first
  try {
    return JSON.parse(cleaned);
  } catch {
    // If that fails, try to find JSON object in the text
    // Look for { ... } pattern
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // If still fails, try to find the last complete JSON object
        const lastBraceIndex = cleaned.lastIndexOf('}');
        if (lastBraceIndex !== -1) {
          const firstBraceIndex = cleaned.indexOf('{');
          if (firstBraceIndex !== -1 && firstBraceIndex < lastBraceIndex) {
            const jsonStr = cleaned.substring(firstBraceIndex, lastBraceIndex + 1);
            return JSON.parse(jsonStr);
          }
        }
      }
    }
    
    // If all else fails, throw the original error
    throw new Error(`Failed to extract JSON from response: ${response.substring(0, 100)}...`);
  }
}

async function locateWithClaude(
  screenshot: { base64: string; mimeType: string },
  description: string,
  role?: string,
  screenInfo?: { width: number; height: number; scaleFactor: number }
): Promise<{ coordinates: { x: number; y: number }; confidence: number }> {
  if (!claudeClient) {
    throw new Error('Claude client not initialized');
  }

  const roleHint = role ? ` (a ${role} element)` : '';
  const screenDimensions = screenInfo 
    ? `\n\n**SCREEN DIMENSIONS (CRITICAL):**\n- Screen width: ${screenInfo.width}px\n- Screen height: ${screenInfo.height}px\n- Scale factor: ${screenInfo.scaleFactor}x\n- Screenshot dimensions: ${screenInfo.width}x${screenInfo.height}\n- Coordinate space: (0,0) to (${screenInfo.width}, ${screenInfo.height})`
    : '';
  
  const prompt = `You are a precise UI element locator. Find the EXACT pixel coordinates of: "${description}"${roleHint}${screenDimensions}

**CRITICAL - UI CONTEXT AWARENESS:**

The screenshot may show EITHER:
A) **Full Desktop View** - Multiple UI layers visible:
   1. Desktop Background (wallpaper)
   2. Desktop Folders/Icons (typically right side - blue/colored folder icons)
   3. OS Menu Bar (top - system menu)
   4. Dock/Taskbar (bottom/side - app launcher)
   5. Application Window (browser, app - contains the interface)
   6. Web/App Interface (INSIDE the window)

B) **Fullscreen Application** - Single app fills entire screen:
   - No desktop folders/icons visible
   - No OS menu bar or dock visible
   - Application UI fills the entire screenshot
   - Examples: Slack fullscreen, Chrome fullscreen, VS Code fullscreen

**CRITICAL DISTINCTION - Desktop Files vs Application Content:**
- **Desktop folders/files** = OS-level icons (blue/colored folder icons on desktop background)
- **Application content** = UI elements INSIDE the application (buttons, sidebars, panels, text)
- **NEVER confuse desktop folders with application UI elements**
- If description mentions "sidebar", "panel", "project", "conversation" → Look for UI elements INSIDE the application
- If description mentions "blue folder icon" or "desktop folder" → Check if it's a desktop file (return confidence 0.0) or app UI element

**PIXEL-ACCURATE COORDINATE SYSTEM:**
- **CRITICAL**: The screenshot has EXACT dimensions (see above)
- Coordinates are in PIXELS relative to the screenshot image
- (0, 0) = top-left corner of the screenshot
- (${screenInfo?.width || 'width'}, ${screenInfo?.height || 'height'}) = bottom-right corner
- Return the CENTER POINT of the element (where a mouse click would land)
- **Precision matters** - your coordinates will be used for mouse clicks

**CONTEXT VALIDATION (MUST DO FIRST):**
1. Identify what application/website is visible in the screenshot
2. Check if the target element matches the visible context
3. Distinguish between desktop UI and application UI
4. Return confidence 0.0 if:
   - Wrong application/website is visible
   - Description references desktop folders but should be app UI
   - Element not visible or doesn't exist
   - Context doesn't match expected application

**CONFIDENCE LEVELS:**
- 0.9-1.0: Element clearly visible, correct context, precise location
- 0.7-0.8: Element visible but slightly uncertain about exact position
- 0.4-0.6: Element might be there but uncertain
- 0.0-0.3: Element not found, wrong context, or desktop folder confusion

**EXAMPLES:**
- "hamburger menu in app" + app visible → {"x": 50, "y": 120, "confidence": 0.95}
- "blue folder icon" in description → {"x": 0, "y": 0, "confidence": 0.0} (desktop element, not app UI)
- "sidebar project" but sidebar collapsed → {"x": 0, "y": 0, "confidence": 0.0} (not visible)
- Wrong app visible → {"x": 0, "y": 0, "confidence": 0.0}

Return ONLY valid JSON. No explanations. No markdown. No extra text.

Required format:
{
  "x": <pixel number>,
  "y": <pixel number>,
  "confidence": <0.0 to 1.0>
}`;

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
  
  // Log raw response for debugging
  logger.debug('Claude vision raw response', {
    description,
    rawResponse: response.substring(0, 500),
  });
  
  const result = extractJsonFromResponse(response);
  
  // Enhanced logging for (0,0) coordinates
  if (result.x === 0 && result.y === 0) {
    logger.warn('⚠️ Claude Vision returned (0,0) coordinates', {
      description,
      role,
      confidence: result.confidence,
      rawResponse: response.substring(0, 1000),
      screenInfo,
      interpretation: result.confidence === 0 
        ? 'Element not found or wrong context (expected behavior)'
        : 'Possible bug - high confidence but (0,0) coordinates',
    });
  }

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

  const prompt = `Does this element exist: "${description}"?

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
  };
}

async function analyzeWithGemini(
  screenshot: { base64: string; mimeType: string },
  query?: string,
  speedMode: 'fast' | 'balanced' | 'accurate' = 'balanced'
): Promise<{ text: string; analysis: string }> {
  if (!geminiClient) {
    throw new Error('Gemini client not initialized');
  }

  const prompt = query || `Analyze this screenshot and extract all visible text. Also provide a brief description of what you see.

Return a JSON object:
{
  "text": "<all visible text>",
  "analysis": "<brief description of UI>"
}`;

  // Speed mode configurations
  const config = {
    fast: {
      model: 'gemini-2.0-flash',  // Fastest
      maxTokens: 300,
    },
    balanced: {
      model: 'gemini-3-pro-preview',  // Best balance
      maxTokens: 800,
    },
    accurate: {
      model: 'gemini-3-pro-preview',  // Most accurate
      maxTokens: 2000,
    },
  }[speedMode];

  const model = geminiClient.getGenerativeModel({ 
    model: config.model,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: config.maxTokens,
    }
  });

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: screenshot.mimeType || 'image/png',
            data: screenshot.base64,
          },
        },
        {
          text: prompt,
        },
      ],
    }],
  });

  const response = result.response.text();
  
  // Try to parse as JSON first
  try {
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    const parsedResult = JSON.parse(cleaned);
    return {
      text: parsedResult.text || '',
      analysis: parsedResult.analysis || response,
    };
  } catch {
    // If not JSON, return raw response
    return {
      text: response,
      analysis: response,
    };
  }
}

async function analyzeWithGemini25(
  screenshot: { base64: string; mimeType: string },
  query?: string,
  speedMode: 'fast' | 'balanced' | 'accurate' = 'balanced'
): Promise<{ text: string; analysis: string }> {
  if (!geminiClient) {
    throw new Error('Gemini client not initialized');
  }

  const prompt = query || `Analyze this screenshot and extract all visible text. Also provide a brief description of what you see.

Return a JSON object:
{
  "text": "<all visible text>",
  "analysis": "<brief description of UI>"
}`;

  // Speed mode configurations - all use Gemini 2.5 Pro
  const config = {
    fast: {
      model: 'gemini-2.5-flash',  // Fastest 2.5 model
      maxTokens: 300,
    },
    balanced: {
      model: 'gemini-2.5-pro',  // Stable, fast
      maxTokens: 800,
    },
    accurate: {
      model: 'gemini-2.5-pro',  // Most accurate 2.5
      maxTokens: 2000,
    },
  }[speedMode];

  const model = geminiClient.getGenerativeModel({ 
    model: config.model,
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: config.maxTokens,
    }
  });

  const result = await model.generateContent({
    contents: [{
      role: 'user',
      parts: [
        {
          inlineData: {
            mimeType: screenshot.mimeType || 'image/png',
            data: screenshot.base64,
          },
        },
        {
          text: prompt,
        },
      ],
    }],
  });

  const response = result.response.text();
  
  // Try to parse as JSON first
  try {
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    const parsedResult = JSON.parse(cleaned);
    return {
      text: parsedResult.text || '',
      analysis: parsedResult.analysis || response,
    };
  } catch {
    // If not JSON, return raw response
    return {
      text: response,
      analysis: response,
    };
  }
}

async function analyzeWithClaude(
  screenshot: { base64: string; mimeType: string },
  query?: string,
  speedMode: 'fast' | 'balanced' | 'accurate' = 'balanced'
): Promise<{ text: string; analysis: string }> {
  if (!claudeClient) {
    throw new Error('Claude client not initialized');
  }

  const prompt = query || `Analyze this screenshot and extract all visible text. Also provide a brief description of what you see.

CRITICAL: Return ONLY valid JSON. No explanations. No markdown. No extra text before or after.

Required format:
{
  "text": "<all visible text>",
  "analysis": "<brief description of UI>"
}`;

  // Speed mode configurations
  const config = {
    fast: {
      model: 'claude-3-5-haiku-20241022',  // Fastest - minimal tokens
      maxTokens: 300,  // Reduced for maximum speed
    },
    balanced: {
      model: 'claude-3-5-haiku-20241022',  // Fast but with more detail
      maxTokens: 800,
    },
    accurate: {
      model: 'claude-sonnet-4-20250514',   // Most accurate
      maxTokens: 2000,
    },
  }[speedMode];

  const message = await claudeClient.messages.create({
    model: config.model,
    max_tokens: config.maxTokens,
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
    const result = extractJsonFromResponse(response);
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

async function analyzeWithClaudeStreaming(
  screenshot: { base64: string; mimeType: string },
  query: string | undefined,
  speedMode: 'fast' | 'balanced' | 'accurate',
  sendEvent: (data: any) => void
): Promise<void> {
  if (!claudeClient) {
    throw new Error('Claude client not initialized');
  }

  const prompt = query || `Analyze this screenshot and extract all visible text. Also provide a brief description of what you see.

Return a JSON object:
{
  "text": "<all visible text>",
  "analysis": "<brief description of UI>"
}`;

  const config = {
    fast: { model: 'claude-3-5-haiku-20241022', maxTokens: 300 },
    balanced: { model: 'claude-3-5-haiku-20241022', maxTokens: 800 },
    accurate: { model: 'claude-sonnet-4-20250514', maxTokens: 2000 },
  }[speedMode];

  const stream = await claudeClient.messages.stream({
    model: config.model,
    max_tokens: config.maxTokens,
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

  let fullText = '';

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const chunk = event.delta.text;
      fullText += chunk;
      sendEvent({ type: 'chunk', content: chunk });
    }
  }

  // Send final parsed result
  try {
    const cleaned = fullText.replace(/```(?:json)?\n?/g, '').trim();
    const result = JSON.parse(cleaned);
    sendEvent({ 
      type: 'complete', 
      text: result.text || '', 
      analysis: result.analysis || fullText 
    });
  } catch {
    sendEvent({ type: 'complete', text: fullText, analysis: fullText });
  }
}

// ============================================================================
// Helper Functions - OpenAI
// ============================================================================

async function locateWithOpenAI(
  screenshot: { base64: string; mimeType: string },
  description: string,
  role?: string,
  screenInfo?: { width: number; height: number; scaleFactor: number }
): Promise<{ coordinates: { x: number; y: number }; confidence: number }> {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized');
  }

  const roleHint = role ? ` (a ${role} element)` : '';
  const screenDimensions = screenInfo 
    ? `\n\n**SCREEN DIMENSIONS (CRITICAL):**\n- Screen width: ${screenInfo.width}px\n- Screen height: ${screenInfo.height}px\n- Scale factor: ${screenInfo.scaleFactor}x\n- Screenshot dimensions: ${screenInfo.width}x${screenInfo.height}\n- Coordinate space: (0,0) to (${screenInfo.width}, ${screenInfo.height})`
    : '';
  
  const prompt = `You are a precise UI element locator. Find the EXACT pixel coordinates of: "${description}"${roleHint}${screenDimensions}

**CRITICAL - UI CONTEXT AWARENESS:**

The screenshot may show EITHER:
A) **Full Desktop View** - Multiple UI layers visible:
   1. Desktop Background (wallpaper)
   2. Desktop Folders/Icons (typically right side - blue/colored folder icons)
   3. OS Menu Bar (top - system menu)
   4. Dock/Taskbar (bottom/side - app launcher)
   5. Application Window (browser, app - contains the interface)
   6. Web/App Interface (INSIDE the window)

B) **Fullscreen Application** - Single app fills entire screen:
   - No desktop folders/icons visible
   - No OS menu bar or dock visible
   - Application UI fills the entire screenshot
   - Examples: Slack fullscreen, Chrome fullscreen, VS Code fullscreen

**CRITICAL DISTINCTION - Desktop Files vs Application Content:**
- **Desktop folders/files** = OS-level icons (blue/colored folder icons on desktop background)
- **Application content** = UI elements INSIDE the application (buttons, sidebars, panels, text)
- **NEVER confuse desktop folders with application UI elements**
- If description mentions "sidebar", "panel", "project", "conversation" → Look for UI elements INSIDE the application
- If description mentions "blue folder icon" or "desktop folder" → Check if it's a desktop file (return confidence 0.0) or app UI element

**PIXEL-ACCURATE COORDINATE SYSTEM:**
- **CRITICAL**: The screenshot has EXACT dimensions (see above)
- Coordinates are in PIXELS relative to the screenshot image
- Origin: Top-left corner (0, 0)
- X axis: Left (0) → Right (${screenInfo?.width || 'width'})
- Y axis: Top (0) → Bottom (${screenInfo?.height || 'height'})
- Return the CENTER POINT of the element (where a mouse click would land)
- **Precision matters** - your coordinates will be used for mouse clicks

**CRITICAL Y-COORDINATE ADJUSTMENT:**
- **Bottom elements are SIGNIFICANTLY HIGHER than they appear**
- **INPUT FIELDS**: Target the TEXT ENTRY AREA, not the bounding box center
  * Input fields have borders, padding, and bottom spacing
  * The clickable text area is in the UPPER portion of the bounding box
  * For input fields: Use Y coordinate of TOP EDGE + 15-25px (not center)
  * Example: Input field bounding box y=800-900 → Click at y=800-810 (top + 15px)
- **Message input fields at bottom: Subtract 80-100px from bounding box center**
- Bottom buttons/controls: Subtract 30-50px from visual position
- **For elements in bottom 20% of screen (y > ${(screenInfo?.height || 900) * 0.8}):**
  * Reduce Y coordinate by 80-100 pixels from bounding box center
  * Message inputs typically at y = ${(screenInfo?.height || 900) - 100} to ${(screenInfo?.height || 900) - 80}
  * Aim for the TEXT CURSOR position, NOT the toolbar buttons below
  * The input container includes toolbar buttons - target the TEXT AREA only

**CONTEXT VALIDATION (MUST DO FIRST):**
1. Identify what application/website is visible in the screenshot
2. Check if the target element matches the visible context
3. Distinguish between desktop UI and application UI
4. Return confidence 0.0 if:
   - Wrong application/website is visible
   - Description references desktop folders but should be app UI
   - Element not visible or doesn't exist
   - Context doesn't match expected application

**CONFIDENCE LEVELS:**
- 0.9-1.0: Element clearly visible, correct context, precise location
- 0.7-0.8: Element visible but slightly uncertain about exact position
- 0.4-0.6: Element might be there but uncertain
- 0.0-0.3: Element not found, wrong context, or desktop folder confusion

**EXAMPLES:**
- "hamburger menu in app" + app visible → {"x": 50, "y": 120, "confidence": 0.95}
- "message input at bottom" (900px screen) → {"x": 720, "y": 800, "confidence": 0.95} (NOT y=820 or y=860)
- "blue folder icon" in description → {"x": 0, "y": 0, "confidence": 0.0} (desktop element, not app UI)
- "sidebar project" but sidebar collapsed → {"x": 0, "y": 0, "confidence": 0.0} (not visible)
- Wrong app visible → {"x": 0, "y": 0, "confidence": 0.0}

Return ONLY valid JSON. No explanations. No markdown. No extra text.

Required format:
{
  "x": <pixel number>,
  "y": <pixel number>,
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
    max_tokens: 200,
    temperature: 0.1,
  });

  const response = completion.choices[0]?.message?.content || '';
  const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
  
  // Log raw response for debugging
  logger.debug('OpenAI vision raw response', {
    description,
    rawResponse: response.substring(0, 500), // First 500 chars
    cleanedResponse: cleaned.substring(0, 500),
  });
  
  const result = JSON.parse(cleaned);
  
  // Enhanced logging for (0,0) coordinates
  if (result.x === 0 && result.y === 0) {
    logger.warn('⚠️ OpenAI Vision returned (0,0) coordinates', {
      description,
      role,
      confidence: result.confidence,
      rawResponse: response.substring(0, 1000), // More context for debugging
      screenInfo,
      interpretation: result.confidence === 0 
        ? 'Element not found or wrong context (expected behavior)'
        : 'Possible bug - high confidence but (0,0) coordinates',
    });
  }

  return {
    coordinates: { x: result.x, y: result.y },
    confidence: result.confidence,
  };
}

async function locateWithGemini(
  screenshot: { base64: string; mimeType: string },
  description: string,
  role?: string,
  screenInfo?: { width: number; height: number; scaleFactor: number }
): Promise<{ coordinates: { x: number; y: number }; confidence: number }> {
  if (!geminiClient) {
    throw new Error('Gemini client not initialized');
  }

  const roleHint = role ? ` (a ${role} element)` : '';
  const screenDimensions = screenInfo 
    ? `\n\n**SCREEN DIMENSIONS:**\n- Width: ${screenInfo.width}px\n- Height: ${screenInfo.height}px\n- Scale: ${screenInfo.scaleFactor}x`
    : '';
  
  const prompt = `You are a precise UI element locator with superior bounding box detection capabilities.

**TASK:** Locate "${description}"${roleHint} in this screenshot and return its bounding box.${screenDimensions}

**CRITICAL INSTRUCTIONS:**
1. Analyze the screenshot to find the UI element matching the description
2. Return bounding box coordinates in the format: [ymin, xmin, ymax, xmax]
3. Coordinates MUST be normalized to a 0-1000 scale (NOT pixels)
4. The coordinate system is: [top, left, bottom, right]
5. Return the center point for clicking: x = (xmin + xmax) / 2, y = (ymin + ymax) / 2

**COORDINATE FORMAT:**
- ymin: Top edge (0 = top of image, 1000 = bottom)
- xmin: Left edge (0 = left of image, 1000 = right)
- ymax: Bottom edge
- xmax: Right edge

**CONFIDENCE LEVELS:**
- 0.9-1.0: Element clearly visible and precisely located
- 0.7-0.8: Element visible but position slightly uncertain
- 0.4-0.6: Element might be present but very uncertain
- 0.0-0.3: Element not found or wrong context

**RESPONSE FORMAT (JSON only, no markdown):**
{
  "boundingBox": [ymin, xmin, ymax, xmax],
  "confidence": 0.95,
  "elementType": "button|input|link|icon|etc"
}

If element not found:
{
  "boundingBox": [0, 0, 0, 0],
  "confidence": 0.0,
  "elementType": "not_found"
}

Return ONLY the JSON object. No explanations. No markdown code blocks.`;

  const model = geminiClient.getGenerativeModel({ 
    model: 'gemini-2.0-flash-exp',
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 300,
    },
  });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: screenshot.mimeType || 'image/png',
        data: screenshot.base64,
      },
    },
    { text: prompt },
  ]);

  const response = result.response.text();
  const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
  
  logger.debug('Gemini vision raw response', {
    description,
    rawResponse: response.substring(0, 500),
    cleanedResponse: cleaned.substring(0, 500),
  });
  
  const parsed = JSON.parse(cleaned);
  
  // Convert normalized 0-1000 coordinates to pixel coordinates
  const bbox = parsed.boundingBox || [0, 0, 0, 0];
  const [ymin, xmin, ymax, xmax] = bbox;
  
  // Calculate center point in normalized space (0-1000)
  const centerX = (xmin + xmax) / 2;
  const centerY = (ymin + ymax) / 2;
  
  // Convert to pixel coordinates if screen dimensions provided
  let pixelX = 0;
  let pixelY = 0;
  
  if (screenInfo && centerX > 0 && centerY > 0) {
    // Convert from 0-1000 scale to pixel coordinates
    pixelX = Math.round((centerX / 1000) * screenInfo.width);
    pixelY = Math.round((centerY / 1000) * screenInfo.height);
  }
  
  const confidence = parsed.confidence || 0.0;
  
  // Enhanced logging for (0,0) coordinates
  if (pixelX === 0 && pixelY === 0) {
    logger.warn('⚠️ Gemini returned (0,0) coordinates', {
      description,
      role,
      confidence,
      boundingBox: bbox,
      normalizedCenter: { x: centerX, y: centerY },
      rawResponse: response.substring(0, 1000),
      screenInfo,
      interpretation: confidence === 0 
        ? 'Element not found (expected behavior)'
        : 'Possible bug - high confidence but (0,0) coordinates',
    });
  }

  return {
    coordinates: { x: pixelX, y: pixelY },
    confidence,
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
  query?: string,
  speedMode: 'fast' | 'balanced' | 'accurate' = 'balanced'
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

  // Speed mode configurations
  const config = {
    fast: {
      detail: 'low' as const,      // Low detail = faster processing
      maxTokens: 300,              // Minimal tokens for speed
    },
    balanced: {
      detail: 'low' as const,      // Low detail is usually sufficient
      maxTokens: 800,
    },
    accurate: {
      detail: 'high' as const,     // High detail for precision
      maxTokens: 2000,
    },
  }[speedMode];

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
              detail: config.detail,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
    max_tokens: config.maxTokens,
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

async function analyzeWithOpenAIStreaming(
  screenshot: { base64: string; mimeType: string },
  query: string | undefined,
  speedMode: 'fast' | 'balanced' | 'accurate',
  sendEvent: (data: any) => void
): Promise<void> {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized');
  }

  const prompt = query || `Analyze this screenshot and extract all visible text. Also provide a brief description of what you see.

Return a JSON object:
{
  "text": "<all visible text>",
  "analysis": "<brief description of UI>"
}`;

  const config = {
    fast: { detail: 'low' as const, maxTokens: 300 },
    balanced: { detail: 'low' as const, maxTokens: 800 },
    accurate: { detail: 'high' as const, maxTokens: 2000 },
  }[speedMode];

  const stream = await openaiClient.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${screenshot.mimeType || 'image/png'};base64,${screenshot.base64}`,
              detail: config.detail,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
    max_tokens: config.maxTokens,
    temperature: 0.1,
    stream: true,
  });

  let fullText = '';

  for await (const chunk of stream) {
    const content = chunk.choices[0]?.delta?.content;
    if (content) {
      fullText += content;
      sendEvent({ type: 'chunk', content });
    }
  }

  // Send final parsed result
  try {
    const cleaned = fullText.replace(/```(?:json)?\n?/g, '').trim();
    const result = JSON.parse(cleaned);
    sendEvent({ 
      type: 'complete', 
      text: result.text || '', 
      analysis: result.analysis || fullText 
    });
  } catch {
    sendEvent({ type: 'complete', text: fullText, analysis: fullText });
  }
}

// ============================================================================
// Helper Functions - Grok
// ============================================================================

async function locateWithGrok(
  screenshot: { base64: string; mimeType: string },
  description: string,
  role?: string,
  screenInfo?: { width: number; height: number; scaleFactor: number }
): Promise<{ coordinates: { x: number; y: number }; confidence: number }> {
  if (!grokClient) {
    throw new Error('Grok client not initialized');
  }

  const roleHint = role ? ` (a ${role} element)` : '';
  const screenDimensions = screenInfo 
    ? `\n\n**SCREEN DIMENSIONS (CRITICAL):**\n- Screen width: ${screenInfo.width}px\n- Screen height: ${screenInfo.height}px\n- Scale factor: ${screenInfo.scaleFactor}x\n- Screenshot dimensions: ${screenInfo.width}x${screenInfo.height}\n- Coordinate space: (0,0) to (${screenInfo.width}, ${screenInfo.height})`
    : '';
  
  const prompt = `You are a precise UI element locator. Find the EXACT pixel coordinates of: "${description}"${roleHint}${screenDimensions}

**CRITICAL - UI CONTEXT AWARENESS:**

The screenshot may show EITHER:
A) **Full Desktop View** - Multiple UI layers visible:
   1. Desktop Background (wallpaper)
   2. Desktop Folders/Icons (typically right side - blue/colored folder icons)
   3. OS Menu Bar (top - system menu)
   4. Dock/Taskbar (bottom/side - app launcher)
   5. Application Window (browser, app - contains the interface)
   6. Web/App Interface (INSIDE the window)

B) **Fullscreen Application** - Single app fills entire screen:
   - No desktop folders/icons visible
   - No OS menu bar or dock visible
   - Application UI fills the entire screenshot
   - Examples: Slack fullscreen, Chrome fullscreen, VS Code fullscreen

**CRITICAL DISTINCTION - Desktop Files vs Application Content:**
- **Desktop folders/files** = OS-level icons (blue/colored folder icons on desktop background)
- **Application content** = UI elements INSIDE the application (buttons, sidebars, panels, text)
- **NEVER confuse desktop folders with application UI elements**
- If description mentions "sidebar", "panel", "project", "conversation" → Look for UI elements INSIDE the application
- If description mentions "blue folder icon" or "desktop folder" → Check if it's a desktop file (return confidence 0.0) or app UI element

**PIXEL-ACCURATE COORDINATE SYSTEM:**
- **CRITICAL**: The screenshot has EXACT dimensions (see above)
- Coordinates are in PIXELS relative to the screenshot image
- (0, 0) = top-left corner of the screenshot
- (${screenInfo?.width || 'width'}, ${screenInfo?.height || 'height'}) = bottom-right corner
- Return the CENTER POINT of the element (where a mouse click would land)
- **Precision matters** - your coordinates will be used for mouse clicks

**CONTEXT VALIDATION (MUST DO FIRST):**
1. Identify what application/website is visible in the screenshot
2. Check if the target element matches the visible context
3. Distinguish between desktop UI and application UI
4. Return confidence 0.0 if:
   - Wrong application/website is visible
   - Description references desktop folders but should be app UI
   - Element not visible or doesn't exist
   - Context doesn't match expected application

**CONFIDENCE LEVELS:**
- 0.9-1.0: Element clearly visible, correct context, precise location
- 0.7-0.8: Element visible but slightly uncertain about exact position
- 0.4-0.6: Element might be there but uncertain
- 0.0-0.3: Element not found, wrong context, or desktop folder confusion

**EXAMPLES:**
- "hamburger menu in app" + app visible → {"x": 50, "y": 120, "confidence": 0.95}
- "blue folder icon" in description → {"x": 0, "y": 0, "confidence": 0.0} (desktop element, not app UI)
- "sidebar project" but sidebar collapsed → {"x": 0, "y": 0, "confidence": 0.0} (not visible)
- Wrong app visible → {"x": 0, "y": 0, "confidence": 0.0}

Return ONLY valid JSON. No explanations. No markdown. No extra text.

Required format:
{
  "x": <pixel number>,
  "y": <pixel number>,
  "confidence": <0.0 to 1.0>
}`;

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
  
  // Log raw response for debugging
  logger.debug('Grok vision raw response', {
    description,
    rawResponse: response.substring(0, 500),
    cleanedResponse: cleaned.substring(0, 500),
  });
  
  const result = JSON.parse(cleaned);
  
  // Enhanced logging for (0,0) coordinates
  if (result.x === 0 && result.y === 0) {
    logger.warn('⚠️ Grok Vision returned (0,0) coordinates', {
      description,
      role,
      confidence: result.confidence,
      rawResponse: response.substring(0, 1000),
      screenInfo,
      interpretation: result.confidence === 0 
        ? 'Element not found or wrong context (expected behavior)'
        : 'Possible bug - high confidence but (0,0) coordinates',
    });
  }

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
  query?: string,
  speedMode: 'fast' | 'balanced' | 'accurate' = 'balanced'
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

  // Speed mode configurations
  const config = {
    fast: {
      detail: 'low' as const,
      maxTokens: 300,
    },
    balanced: {
      detail: 'low' as const,
      maxTokens: 800,
    },
    accurate: {
      detail: 'high' as const,
      maxTokens: 2000,
    },
  }[speedMode];

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
              detail: config.detail,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
    max_tokens: config.maxTokens,
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

/**
 * POST /api/vision/locate-element
 * Locate an element in a screenshot and return its boundary coordinates
 * Used by interactive guide mode to dynamically find UI elements
 * 
 * Request body:
 * {
 *   "screenshot": { "base64": "...", "mimeType": "image/png" },
 *   "locator": {
 *     "strategy": "vision",
 *     "description": "the Add to Slack button",
 *     "nodeQuery": { "textContains": "Add to Slack", "role": "button" }
 *   },
 *   "screenDimensions": { "width": 1920, "height": 1080 }
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "boundary": { "x": 640, "y": 400, "width": 120, "height": 40 },
 *   "coordinateSpace": "screen",
 *   "confidence": 0.92,
 *   "provider": "claude",
 *   "latencyMs": 1234
 * }
 */
router.post('/locate-element', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { screenshot, locator, screenDimensions } = req.body;

    // Validate request
    if (!screenshot?.base64 || !locator) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: screenshot and locator',
      });
      return;
    }

    logger.info('Locate element request received', {
      strategy: locator.strategy,
      description: locator.description,
      hasNodeQuery: !!locator.nodeQuery,
      userId: (req as any).user?.id,
    });

    const startTime = Date.now();

    // Build vision prompt
    const prompt = buildLocateElementPrompt(locator, screenDimensions);

    // Try Claude first (best for vision)
    let result: any = null;
    let provider = '';

    if (claudeClient) {
      try {
        const message = await claudeClient.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 1024,
          temperature: 0.1,
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image',
                  source: {
                    type: 'base64',
                    media_type: (screenshot.mimeType || 'image/png') as any,
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
        result = parseLocateElementResponse(response, screenDimensions);
        provider = 'claude';
      } catch (error: any) {
        logger.warn('Claude locate-element failed, trying OpenAI', { error: error.message });
      }
    }

    // Fallback to OpenAI
    if (!result && openaiClient) {
      try {
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
                  },
                },
                {
                  type: 'text',
                  text: prompt,
                },
              ],
            },
          ],
          max_tokens: 1024,
          temperature: 0.1,
        });

        const response = completion.choices[0]?.message?.content || '';
        result = parseLocateElementResponse(response, screenDimensions);
        provider = 'openai';
      } catch (error: any) {
        logger.error('OpenAI locate-element failed', { error: error.message });
      }
    }

    const latencyMs = Date.now() - startTime;

    if (!result) {
      res.status(500).json({
        success: false,
        error: 'All vision providers failed to locate element',
      });
      return;
    }

    logger.info('Element located successfully', {
      provider,
      boundary: result.boundary,
      confidence: result.confidence,
      latencyMs,
    });

    res.status(200).json({
      success: true,
      ...result,
      provider,
      latencyMs,
    });
  } catch (error: any) {
    logger.error('Locate element failed', {
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
 * POST /api/vision/verify-step
 * Verify that a guide step has been completed by analyzing screenshots
 * 
 * Request body:
 * {
 *   "stepId": "step_1",
 *   "screenshot": { "base64": "...", "mimeType": "image/png" },
 *   "previousScreenshot": { "base64": "...", "mimeType": "image/png" },
 *   "verification": {
 *     "strategy": "element_visible",
 *     "expectedElement": "Spotlight search box",
 *     "timeoutMs": 5000
 *   }
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "verified": true,
 *   "confidence": 0.88,
 *   "explanation": "Spotlight search box is now visible in the screenshot",
 *   "provider": "claude",
 *   "latencyMs": 1234
 * }
 */
router.post('/verify-step', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { stepId, screenshot, previousScreenshot, verification } = req.body;

    // Validate request
    if (!stepId || !screenshot?.base64 || !verification) {
      res.status(400).json({
        success: false,
        error: 'Missing required fields: stepId, screenshot, and verification',
      });
      return;
    }

    logger.info('Verify step request received', {
      stepId,
      strategy: verification.strategy,
      hasPreviousScreenshot: !!previousScreenshot,
      userId: (req as any).user?.id,
    });

    const startTime = Date.now();

    // Build verification prompt
    const prompt = buildVerifyStepPrompt(verification, !!previousScreenshot);

    // Try Claude first
    let result: any = null;
    let provider = '';

    if (claudeClient) {
      try {
        const content: any[] = [];

        // Add previous screenshot if provided (for comparison)
        if (previousScreenshot?.base64) {
          content.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: (previousScreenshot.mimeType || 'image/png') as any,
              data: previousScreenshot.base64,
            },
          });
          content.push({
            type: 'text',
            text: '^ BEFORE (previous state)',
          });
        }

        // Add current screenshot
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: (screenshot.mimeType || 'image/png') as any,
            data: screenshot.base64,
          },
        });
        content.push({
          type: 'text',
          text: previousScreenshot ? '^ AFTER (current state)' : '^ CURRENT STATE',
        });

        // Add verification prompt
        content.push({
          type: 'text',
          text: prompt,
        });

        const message = await claudeClient.messages.create({
          model: 'claude-3-5-sonnet-20241022',
          max_tokens: 512,
          temperature: 0.1,
          messages: [
            {
              role: 'user',
              content,
            },
          ],
        });

        const response = message.content[0]?.type === 'text' ? message.content[0].text : '';
        result = parseVerifyStepResponse(response);
        provider = 'claude';
      } catch (error: any) {
        logger.warn('Claude verify-step failed, trying OpenAI', { error: error.message });
      }
    }

    // Fallback to OpenAI
    if (!result && openaiClient) {
      try {
        const content: any[] = [];

        if (previousScreenshot?.base64) {
          content.push({
            type: 'image_url',
            image_url: {
              url: `data:${previousScreenshot.mimeType || 'image/png'};base64,${previousScreenshot.base64}`,
            },
          });
          content.push({
            type: 'text',
            text: '^ BEFORE (previous state)',
          });
        }

        content.push({
          type: 'image_url',
          image_url: {
            url: `data:${screenshot.mimeType || 'image/png'};base64,${screenshot.base64}`,
          },
        });
        content.push({
          type: 'text',
          text: previousScreenshot ? '^ AFTER (current state)' : '^ CURRENT STATE',
        });
        content.push({
          type: 'text',
          text: prompt,
        });

        const completion = await openaiClient.chat.completions.create({
          model: 'gpt-4o',
          messages: [
            {
              role: 'user',
              content,
            },
          ],
          max_tokens: 512,
          temperature: 0.1,
        });

        const response = completion.choices[0]?.message?.content || '';
        result = parseVerifyStepResponse(response);
        provider = 'openai';
      } catch (error: any) {
        logger.error('OpenAI verify-step failed', { error: error.message });
      }
    }

    const latencyMs = Date.now() - startTime;

    if (!result) {
      res.status(500).json({
        success: false,
        error: 'All vision providers failed to verify step',
      });
      return;
    }

    logger.info('Step verification complete', {
      stepId,
      verified: result.verified,
      confidence: result.confidence,
      provider,
      latencyMs,
    });

    res.status(200).json({
      success: true,
      ...result,
      provider,
      latencyMs,
    });
  } catch (error: any) {
    logger.error('Verify step failed', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to verify step',
      message: error.message,
    });
  }
});

// ============================================================================
// HELPER FUNCTIONS FOR NEW ENDPOINTS
// ============================================================================

function buildLocateElementPrompt(locator: any, screenDimensions?: any): string {
  const { strategy, description, nodeQuery } = locator;
  
  let prompt = `Analyze this screenshot and locate the following UI element:\n\n`;
  
  if (description) {
    prompt += `**Element Description:** ${description}\n`;
  }
  
  if (nodeQuery) {
    if (nodeQuery.textContains) {
      prompt += `**Text Content:** Contains "${nodeQuery.textContains}"\n`;
    }
    if (nodeQuery.role) {
      prompt += `**UI Role:** ${nodeQuery.role}\n`;
    }
    if (nodeQuery.app) {
      prompt += `**Application:** ${nodeQuery.app}\n`;
    }
  }
  
  if (screenDimensions) {
    prompt += `\n**Screen Dimensions:** ${screenDimensions.width}x${screenDimensions.height}\n`;
  }
  
  prompt += `\n**Task:** Return a JSON object with the element's bounding box coordinates:\n`;
  prompt += `{\n`;
  prompt += `  "found": true,\n`;
  prompt += `  "boundary": { "x": <left>, "y": <top>, "width": <width>, "height": <height> },\n`;
  prompt += `  "confidence": <0.0-1.0>,\n`;
  prompt += `  "explanation": "Brief explanation of what you found"\n`;
  prompt += `}\n\n`;
  prompt += `If the element is not found, return: { "found": false, "explanation": "reason" }\n`;
  prompt += `Return ONLY the JSON object, no other text.`;
  
  return prompt;
}

function parseLocateElementResponse(response: string, screenDimensions?: any): any {
  try {
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    const result = JSON.parse(cleaned);
    
    if (!result.found) {
      return {
        success: false,
        error: result.explanation || 'Element not found',
      };
    }
    
    return {
      boundary: result.boundary,
      coordinateSpace: 'screen',
      confidence: result.confidence || 0.8,
      explanation: result.explanation,
    };
  } catch (error) {
    throw new Error(`Failed to parse locate element response: ${error}`);
  }
}

function buildVerifyStepPrompt(verification: any, hasComparison: boolean): string {
  const { strategy, expectedElement, expectedApp, nodeQuery } = verification;
  
  let prompt = `Analyze the screenshot${hasComparison ? 's' : ''} and verify if the following condition is met:\n\n`;
  
  if (strategy === 'element_visible') {
    prompt += `**Verification:** Check if "${expectedElement}" is visible\n`;
  } else if (strategy === 'app_running') {
    prompt += `**Verification:** Check if "${expectedApp}" application is running/active\n`;
  } else if (strategy === 'screenshot_comparison') {
    prompt += `**Verification:** Compare BEFORE and AFTER screenshots to detect changes\n`;
  } else if (strategy === 'screen_intel_node_present') {
    prompt += `**Verification:** Check if UI element matching the following is present:\n`;
    if (nodeQuery?.textContains) {
      prompt += `  - Text contains: "${nodeQuery.textContains}"\n`;
    }
    if (nodeQuery?.role) {
      prompt += `  - UI role: ${nodeQuery.role}\n`;
    }
  }
  
  prompt += `\n**Task:** Return a JSON object with verification result:\n`;
  prompt += `{\n`;
  prompt += `  "verified": true/false,\n`;
  prompt += `  "confidence": <0.0-1.0>,\n`;
  prompt += `  "explanation": "What you observed",\n`;
  prompt += `  "suggestion": "Optional: what user should do next if not verified"\n`;
  prompt += `}\n\n`;
  prompt += `Return ONLY the JSON object, no other text.`;
  
  return prompt;
}

function parseVerifyStepResponse(response: string): any {
  try {
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    const result = JSON.parse(cleaned);
    
    return {
      verified: result.verified === true,
      confidence: result.confidence || 0.8,
      explanation: result.explanation || '',
      suggestion: result.suggestion,
    };
  } catch (error) {
    throw new Error(`Failed to parse verify step response: ${error}`);
  }
}

export default router;

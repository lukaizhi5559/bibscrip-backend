/**
 * Nut.js Code Generation API
 * Endpoint for generating Nut.js desktop automation code via MCP command
 */

import express, { Request, Response, NextFunction } from 'express';
import { nutjsCodeGenerator, ScreenshotData } from '../services/nutjsCodeGenerator';
import { logger } from '../utils/logger';
import { authenticate } from '../middleware/auth';
import { InteractiveGuideRequest } from '../types/automationGuide';

const router = express.Router();

/**
 * POST /api/nutjs
 * Generate Nut.js code from natural language command
 * Supports vision-enhanced generation with screenshot context
 * 
 * Request body:
 * {
 *   "command": "open my terminal",
 *   "screenshot": {  // Optional - for vision-enhanced generation
 *     "base64": "iVBORw0KGgoAAAANSUhEUgAA...",
 *     "mimeType": "image/png"  // Optional, defaults to image/png
 *   }
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "code": "import { keyboard, Key } from '@nut-tree/nut-js'; ...",
 *   "provider": "grok",
 *   "latencyMs": 1234,
 *   "usedVision": true,  // Indicates if screenshot was processed
 *   "validation": {
 *     "valid": true
 *   }
 * }
 */
router.post('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { command, screenshot, fastMode, context } = req.body;

    // Validate request
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid "command" parameter. Please provide a natural language command.',
        example: {
          command: 'open my terminal',
          screenshot: {
            base64: 'iVBORw0KGgoAAAANSUhEUgAA...',
            mimeType: 'image/png',
          },
          fastMode: false, // Optional: skip vision for 5-10x faster response
        },
      });
      return;
    }

    // Validate screenshot if provided
    let screenshotData: ScreenshotData | undefined;
    if (screenshot && !fastMode) { // Skip vision if fastMode is enabled
      if (!screenshot.base64 || typeof screenshot.base64 !== 'string') {
        res.status(400).json({
          success: false,
          error: 'Invalid screenshot data. "base64" field is required and must be a string.',
        });
        return;
      }
      screenshotData = {
        base64: screenshot.base64,
        mimeType: screenshot.mimeType || 'image/png',
      };
    }

    logger.info('Nut.js code generation request received', {
      command,
      hasScreenshot: !!screenshotData,
      fastMode: !!fastMode,
      responseMode: context?.responseMode,
      requestId: context?.requestId,
      userId: (req as any).user?.id,
    });

    // Generate Nut.js code (with optional screenshot and context)
    const result = await nutjsCodeGenerator.generateCode(command, screenshotData, context);

    // Validate the generated code
    const validation = nutjsCodeGenerator.validateNutjsCode(result.code);

    if (!validation.valid) {
      logger.warn('Generated code failed validation', {
        command,
        reason: validation.reason,
        provider: result.provider,
      });
      
      res.status(500).json({
        success: false,
        error: 'Generated code failed validation',
        reason: validation.reason,
        code: result.code,
        provider: result.provider,
        latencyMs: result.latencyMs,
      });
      return;
    }

    // Success response
    logger.info('Nut.js code generated successfully', {
      command,
      provider: result.provider,
      latencyMs: result.latencyMs,
      codeLength: result.code.length,
      usedVision: result.usedVision,
    });

    res.status(200).json({
      success: true,
      code: result.code,
      provider: result.provider,
      latencyMs: result.latencyMs,
      usedVision: result.usedVision,
      validation: {
        valid: true,
      },
    });
  } catch (error: any) {
    logger.error('Nut.js code generation failed', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to generate Nut.js code',
      message: error.message,
    });
  }
});

/**
 * POST /api/nutjs/plan
 * Generate context-aware structured automation plan from natural language command
 * Supports replanning with feedback for adaptive automation
 * 
 * Request body:
 * {
 *   "command": "Generate Mickey Mouse images in ChatGPT, Grok and Perplexity",
 *   "intent": "command_automate",  // Optional: 'command_automate' | 'command_guide'
 *   "context": {  // Optional: context for plan generation
 *     "screenIntel": {...},  // OCR snapshot from screen-intel MCP
 *     "activeApp": "Google Chrome",
 *     "activeUrl": "https://chat.openai.com",
 *     "history": {...}
 *   },
 *   "previousPlan": {...},  // Optional: for replanning
 *   "feedback": {  // Optional: user feedback for replanning
 *     "reason": "failure",  // 'clarification' | 'failure' | 'scope_change'
 *     "message": "Perplexity login failed, use ChatGPT and Grok only",
 *     "stepId": "step_5"
 *   }
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "plan": {
 *     "planId": "uuid",
 *     "version": 1,
 *     "intent": "command_automate",
 *     "goal": "Generate Mickey Mouse images in ChatGPT, Grok and Perplexity",
 *     "steps": [
 *       {
 *         "id": "step_1",
 *         "kind": { "type": "focusApp", "appName": "Google Chrome" },
 *         "description": "Focus browser",
 *         "status": "pending",
 *         "retry": { "maxAttempts": 2, "delayMs": 1000 },
 *         "onError": { "strategy": "fail_plan" }
 *       },
 *       ...
 *     ],
 *     "questions": [...],  // Optional clarifying questions
 *     "metadata": {...}
 *   },
 *   "provider": "grok",
 *   "latencyMs": 1234
 * }
 */
router.post('/plan', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { command, intent, context, previousPlan, feedback, clarificationAnswers, screenshot } = req.body;

    // Validate request
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid "command" parameter. Please provide a natural language command.',
        example: {
          command: 'Generate Mickey Mouse images in ChatGPT, Grok and Perplexity',
          intent: 'command_automate',
          context: {
            screenIntel: { /* OCR data */ },
            activeApp: 'Google Chrome',
            activeUrl: 'https://chat.openai.com',
          },
        },
      });
      return;
    }

    // Normalize screenshot location: frontend may send at top level or in context
    const normalizedContext = context || {};
    if (screenshot && !normalizedContext.screenshot) {
      normalizedContext.screenshot = screenshot;
    }
    
    // Sanitize base64 screenshot data - strip data URL prefix if present
    if (normalizedContext.screenshot?.base64) {
      let base64Data = normalizedContext.screenshot.base64;
      
      // Check if it has data URL prefix (e.g., "data:image/png;base64,")
      if (base64Data.includes('data:image')) {
        const base64Match = base64Data.match(/^data:image\/[a-z]+;base64,(.+)$/);
        if (base64Match && base64Match[1]) {
          base64Data = base64Match[1];
          logger.info('Stripped data URL prefix from screenshot', {
            originalLength: normalizedContext.screenshot.base64.length,
            strippedLength: base64Data.length,
          });
        }
      }
      
      // Update with sanitized base64
      normalizedContext.screenshot.base64 = base64Data;
      
      // Ensure mimeType is set
      if (!normalizedContext.screenshot.mimeType) {
        normalizedContext.screenshot.mimeType = 'image/png';
      }
    }

    logger.info('Automation plan generation request received', {
      command,
      intent: intent || 'command_automate',
      hasContext: !!normalizedContext,
      hasScreenshot: !!(screenshot || normalizedContext.screenshot),
      screenshotLocation: screenshot ? 'top-level' : (normalizedContext.screenshot ? 'context' : 'none'),
      hasPreviousPlan: !!previousPlan,
      hasFeedback: !!feedback,
      hasClarificationAnswers: !!clarificationAnswers,
      isReplan: !!previousPlan || !!feedback,
      userId: (req as any).user?.id,
    });

    // Generate structured automation plan with context
    const result = await nutjsCodeGenerator.generatePlan({
      command,
      intent: intent || 'command_automate',
      context: normalizedContext,
      previousPlan,
      feedback,
      clarificationAnswers,
    });

    // Success response
    logger.info('Automation plan generated successfully', {
      command,
      provider: result.provider,
      latencyMs: result.latencyMs,
      stepCount: result.plan?.steps?.length || 0,
      planId: result.plan?.planId,
      planVersion: result.plan?.version || 1,
      hasQuestions: !!result.plan?.questions && result.plan.questions.length > 0,
      needsClarification: result.needsClarification || false,
      clarificationQuestionCount: result.clarificationQuestions?.length || 0,
    });

    // Return full result including clarification fields
    res.status(200).json({
      ...result, // Spread all fields from result (plan, needsClarification, clarificationQuestions, etc.)
      success: true, // Ensure success is always true for 200 responses
    });
  } catch (error: any) {
    logger.error('Automation plan generation failed', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to generate automation plan',
      message: error.message,
    });
  }
});

/**
 * POST /api/nutjs/guide
 * Generate interactive guide with visual overlays for step-by-step guidance
 * Protected by API key authentication
 * 
 * Request body:
 * {
 *   "command": "Show me how to buy winter clothes on Amazon",
 *   "context": {
 *     "screenshot": { "base64": "...", "mimeType": "image/png" },
 *     "activeApp": "Google Chrome",
 *     "activeUrl": "https://amazon.com",
 *     "os": "darwin",
 *     "screenDimensions": { "width": 1920, "height": 1080 }
 *   }
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "guide": {
 *     "id": "uuid",
 *     "command": "Show me how to buy winter clothes on Amazon",
 *     "intent": "command_guide",
 *     "intro": "I'll guide you through...",
 *     "steps": [
 *       {
 *         "id": "step_1",
 *         "title": "Open Chrome",
 *         "description": "...",
 *         "overlays": [...],
 *         "completionMode": "either",
 *         "visionCheck": {...}
 *       }
 *     ],
 *     "totalSteps": 3,
 *     "metadata": {...}
 *   },
 *   "provider": "claude",
 *   "latencyMs": 1234
 * }
 */
router.post('/guide', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { command, context, previousGuide, feedback } = req.body as InteractiveGuideRequest;

    if (!command || typeof command !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Invalid request: command is required and must be a string',
        example: {
          command: 'Show me how to buy winter clothes on Amazon',
          context: {
            screenshot: { base64: '...', mimeType: 'image/png' },
            activeApp: 'Google Chrome',
            os: 'darwin',
          },
          feedback: {
            reason: 'missing_prerequisite',
            message: "Don't have n8n installed",
            stepId: 'step_1'
          }
        },
      });
      return;
    }

    const isReplan = !!previousGuide || !!feedback;

    logger.info('Generating interactive guide', { 
      command, 
      hasContext: !!context,
      hasScreenshot: !!context?.screenshot,
      activeApp: context?.activeApp,
      isReplan,
      hasFeedback: !!feedback,
    });

    const request: InteractiveGuideRequest = {
      command,
      context: context || {},
      previousGuide,
      feedback,
    };

    const result = await nutjsCodeGenerator.generateGuide(request);

    res.json(result);
  } catch (error: any) {
    logger.error('Failed to generate interactive guide', {
      error: error.message,
      stack: error.stack,
    });

    res.status(500).json({
      success: false,
      error: 'Failed to generate interactive guide',
      message: error.message,
    });
  }
});

/**
 * GET /api/nutjs/health
 * Health check endpoint for Nut.js code generation service
 */
router.get('/health', async (req: Request, res: Response): Promise<void> => {
  try {
    const grokAvailable = !!process.env.GROK_API_KEY;
    const claudeAvailable = !!process.env.ANTHROPIC_API_KEY;

    const status = {
      service: 'nutjs-code-generator',
      status: grokAvailable || claudeAvailable ? 'healthy' : 'degraded',
      providers: {
        grok: {
          available: grokAvailable,
          primary: true,
        },
        claude: {
          available: claudeAvailable,
          primary: false,
          fallback: true,
        },
      },
      timestamp: new Date().toISOString(),
    };

    const httpStatus = status.status === 'healthy' ? 200 : 503;

    res.status(httpStatus).json(status);
  } catch (error: any) {
    logger.error('Health check failed', { error: error.message });
    res.status(503).json({
      service: 'nutjs-code-generator',
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * GET /api/nutjs/examples
 * Get example commands and their expected Nut.js code patterns
 */
router.get('/examples', (req: Request, res: Response): void => {
  const examples = [
    {
      command: 'open my terminal',
      description: 'Opens the terminal application using keyboard shortcuts',
      pattern: 'Uses Cmd+Space (Spotlight) → type "terminal" → Enter',
      visionEnhanced: false,
    },
    {
      command: 'find winter clothes on Amazon',
      description: 'Opens browser, navigates to Amazon, and searches for winter clothes',
      pattern: 'Opens browser → navigates to amazon.com → types in search → clicks search',
      visionEnhanced: false,
    },
    {
      command: 'Polish up this email',
      description: 'Vision-enhanced: Analyzes screenshot to see email draft, improves text, and types it back',
      pattern: 'Sees email content in screenshot → selects all text → generates improved version → types polished text',
      visionEnhanced: true,
      requiresScreenshot: true,
    },
    {
      command: 'Fill out this form',
      description: 'Vision-enhanced: Identifies form fields from screenshot and fills them appropriately',
      pattern: 'Analyzes form structure → navigates to each field → fills with appropriate data',
      visionEnhanced: true,
      requiresScreenshot: true,
    },
    {
      command: 'how much memory left on my computer',
      description: 'Opens Activity Monitor/Task Manager to check memory usage',
      pattern: 'Opens system monitor → navigates to memory tab → reads memory info',
      visionEnhanced: false,
    },
    {
      command: 'take a screenshot',
      description: 'Captures a screenshot using Nut.js screen API',
      pattern: 'Uses screen.capture() to take screenshot',
      visionEnhanced: false,
    },
    {
      command: 'type hello world',
      description: 'Types the text "hello world" at current cursor position',
      pattern: 'Uses keyboard.type() to input text',
      visionEnhanced: false,
    },
  ];

  res.status(200).json({
    success: true,
    examples,
    visionSupport: {
      enabled: true,
      description: 'Send a screenshot with your command for context-aware automation. The AI will analyze what\'s on screen and generate precise NutJS code.',
      usage: 'Include a "screenshot" object with "base64" image data in your request.',
    },
    note: 'These are example commands. The actual generated code will vary based on the specific command and system.',
  });
});

export default router;

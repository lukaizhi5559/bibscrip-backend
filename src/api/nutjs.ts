/**
 * Nut.js Code Generation API
 * Endpoint for generating Nut.js desktop automation code via MCP command
 */

import express, { Request, Response, NextFunction } from 'express';
import { nutjsCodeGenerator } from '../services/nutjsCodeGenerator';
import { logger } from '../utils/logger';
import { authenticate } from '../middleware/auth';

const router = express.Router();

/**
 * POST /api/nutjs
 * Generate Nut.js code from natural language command
 * 
 * Request body:
 * {
 *   "command": "open my terminal"
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "code": "import { keyboard, Key } from '@nut-tree/nut-js'; ...",
 *   "provider": "grok",
 *   "latencyMs": 1234,
 *   "validation": {
 *     "valid": true
 *   }
 * }
 */
router.post('/', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { command } = req.body;

    // Validate request
    if (!command || typeof command !== 'string' || command.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid "command" parameter. Please provide a natural language command.',
        example: {
          command: 'open my terminal',
        },
      });
      return;
    }

    logger.info('Nut.js code generation request received', {
      command,
      userId: (req as any).user?.id,
    });

    // Generate Nut.js code
    const result = await nutjsCodeGenerator.generateCode(command);

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
    });

    res.status(200).json({
      success: true,
      code: result.code,
      provider: result.provider,
      latencyMs: result.latencyMs,
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
    },
    {
      command: 'find winter clothes on Amazon',
      description: 'Opens browser, navigates to Amazon, and searches for winter clothes',
      pattern: 'Opens browser → navigates to amazon.com → types in search → clicks search',
    },
    {
      command: 'how much memory left on my computer',
      description: 'Opens Activity Monitor/Task Manager to check memory usage',
      pattern: 'Opens system monitor → navigates to memory tab → reads memory info',
    },
    {
      command: 'take a screenshot',
      description: 'Captures a screenshot using Nut.js screen API',
      pattern: 'Uses screen.capture() to take screenshot',
    },
    {
      command: 'type hello world',
      description: 'Types the text "hello world" at current cursor position',
      pattern: 'Uses keyboard.type() to input text',
    },
  ];

  res.status(200).json({
    success: true,
    examples,
    note: 'These are example commands. The actual generated code will vary based on the specific command and system.',
  });
});

export default router;

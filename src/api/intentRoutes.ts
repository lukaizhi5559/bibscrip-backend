/**
 * REST API Routes for Intent Testing
 * 
 * Provides isolated endpoints for testing individual intent types
 * Useful for development, debugging, and unit testing
 */

import { Router, Request, Response, RequestHandler } from 'express';
import { logger } from '../utils/logger';
import { intentExecutionEngine } from '../services/intentExecutionEngine';
import { IntentExecutionRequest, IntentType } from '../types/intentTypes';

const router = Router();

/**
 * Generic intent execution endpoint
 * POST /api/intent/execute
 */
const executeHandler: RequestHandler = async (req: Request, res: Response) => {
  try {
    const request: IntentExecutionRequest = req.body;

    // Validate request
    if (!request.intentType) {
      res.status(400).json({
        success: false,
        error: 'Missing intentType'
      });
      return;
    }

    if (!request.stepData) {
      res.status(400).json({
        success: false,
        error: 'Missing stepData'
      });
      return;
    }

    if (!request.context?.screenshot) {
      res.status(400).json({
        success: false,
        error: 'Missing context.screenshot'
      });
      return;
    }

    logger.info('Intent execution request received', {
      intentType: request.intentType,
      stepId: request.stepData.id,
      endpoint: '/api/intent/execute'
    });

    // Execute intent
    const result = await intentExecutionEngine.executeIntent(request);

    res.json({
      success: result.status === 'step_complete',
      result
    });

  } catch (error: any) {
    logger.error('Intent execution failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

router.post('/execute', executeHandler);

/**
 * Intent-specific endpoints for easier testing
 * POST /api/intent/navigate
 * POST /api/intent/capture
 * POST /api/intent/type_text
 * etc.
 */

const intentEndpoints: IntentType[] = [
  // Navigation & App Control
  'navigate', 'switch_app', 'close_app',
  // UI Interaction
  'click_element', 'type_text', 'search', 'select', 'drag', 'scroll',
  // Data Operations
  'capture', 'extract', 'copy', 'paste', 'store', 'retrieve',
  // Verification & Control Flow
  'wait', 'verify', 'compare', 'check',
  // File Operations (Basic)
  'upload', 'download', 'open_file', 'save_file',
  // File Operations (Extended - Phase 4)
  'read_file', 'write_file', 'copy_file', 'move_file', 'delete_file',
  'list_files', 'search_files', 'create_folder', 'delete_folder',
  'file_info', 'modify_permissions', 'compress', 'decompress',
  // Advanced Interactions
  'zoom', 'authenticate', 'form_fill', 'multi_select',
  // Custom
  'custom'
];

for (const intentType of intentEndpoints) {
  const handler: RequestHandler = async (req: Request, res: Response) => {
    try {
      const { stepData, context, userId } = req.body;

      // Validate
      if (!stepData) {
        res.status(400).json({
          success: false,
          error: 'Missing stepData'
        });
        return;
      }

      if (!context?.screenshot) {
        res.status(400).json({
          success: false,
          error: 'Missing context.screenshot'
        });
        return;
      }

      // Build request
      const request: IntentExecutionRequest = {
        intentType,
        stepData: {
          id: stepData.id || `test_${intentType}_${Date.now()}`,
          description: stepData.description || `Test ${intentType} intent`,
          target: stepData.target,
          query: stepData.query,
          element: stepData.element,
          successCriteria: stepData.successCriteria,
          maxAttempts: stepData.maxAttempts || 3,
          notes: stepData.notes
        },
        context,
        userId: userId || 'test-user'
      };

      logger.info(`Intent ${intentType} execution request`, {
        stepId: request.stepData.id,
        endpoint: `/api/intent/${intentType}`
      });

      // Execute intent
      const result = await intentExecutionEngine.executeIntent(request);

      res.json({
        success: result.status === 'step_complete',
        result
      });

    } catch (error: any) {
      logger.error(`Intent ${intentType} execution failed`, { error: error.message });
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  };
  
  router.post(`/${intentType}`, handler);
}

/**
 * Health check endpoint
 * GET /api/intent/health
 */
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'intent-execution',
    availableIntents: intentEndpoints.length,
    timestamp: new Date().toISOString()
  });
});

/**
 * List available intents
 * GET /api/intent/list
 */
router.get('/list', (req: Request, res: Response) => {
  res.json({
    intents: intentEndpoints,
    total: intentEndpoints.length,
    categories: {
      navigation: ['navigate', 'switch_app', 'close_app'],
      interaction: ['click_element', 'type_text', 'search', 'select', 'drag', 'scroll'],
      data: ['capture', 'extract', 'copy', 'paste', 'store', 'retrieve'],
      verification: ['wait', 'verify', 'compare', 'check'],
      file_basic: ['upload', 'download', 'open_file', 'save_file'],
      file_extended: [
        'read_file', 'write_file', 'copy_file', 'move_file', 'delete_file',
        'list_files', 'search_files', 'create_folder', 'delete_folder',
        'file_info', 'modify_permissions', 'compress', 'decompress'
      ],
      advanced: ['zoom', 'authenticate', 'form_fill', 'multi_select'],
      custom: ['custom']
    }
  });
});

export default router;

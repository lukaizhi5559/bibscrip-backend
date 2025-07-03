import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import multer from 'multer';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { visualAgentService, VisualContext, ActionPlan } from '../services/visualAgentService';
import { desktopAutomationService, ExecutionResult } from '../services/desktopAutomationService';
import { llmPlanningService, LLMResponse } from '../services/llmPlanningService';
import { logger } from '../utils/logger';

const router = Router();

// Configure multer for file uploads (screenshots)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit for screenshots
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Request schemas
const ExecutePromptSchema = z.object({
  prompt: z.string().min(1).max(1000),
  provider: z.string().optional(),
  dryRun: z.boolean().optional().default(false)
});

const ExecuteActionPlanSchema = z.object({
  actionPlan: z.object({
    actions: z.array(z.any()),
    reasoning: z.string(),
    confidence: z.number().min(0).max(1),
    expectedOutcome: z.string()
  }),
  dryRun: z.boolean().optional().default(false)
});

/**
 * @swagger
 * components:
 *   schemas:
 *     VisualContext:
 *       type: object
 *       properties:
 *         screenshot:
 *           type: object
 *           properties:
 *             width:
 *               type: number
 *             height:
 *               type: number
 *             timestamp:
 *               type: string
 *             format:
 *               type: string
 *         ocrResult:
 *           type: object
 *           properties:
 *             text:
 *               type: string
 *             confidence:
 *               type: number
 *         clipboardContent:
 *           type: string
 *         userPrompt:
 *           type: string
 *         timestamp:
 *           type: string
 *     
 *     ActionPlan:
 *       type: object
 *       properties:
 *         actions:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [moveMouse, click, type, wait, scroll, keyPress, screenshot]
 *               coordinates:
 *                 type: object
 *                 properties:
 *                   x:
 *                     type: number
 *                   y:
 *                     type: number
 *               text:
 *                 type: string
 *               key:
 *                 type: string
 *               duration:
 *                 type: number
 *         reasoning:
 *           type: string
 *         confidence:
 *           type: number
 *         expectedOutcome:
 *           type: string
 *     
 *     ExecutionResult:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         executedActions:
 *           type: number
 *         totalActions:
 *           type: number
 *         error:
 *           type: string
 *         duration:
 *           type: number
 *         timestamp:
 *           type: string
 */

/**
 * @swagger
 * /api/visual-agent/status:
 *   get:
 *     summary: Get Visual Agent service status
 *     tags: [Visual Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Service status information
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 visualAgent:
 *                   type: object
 *                   properties:
 *                     ready:
 *                       type: boolean
 *                     initialized:
 *                       type: boolean
 *                 desktopAutomation:
 *                   type: object
 *                   properties:
 *                     ready:
 *                       type: boolean
 *                 llmPlanning:
 *                   type: object
 *                   properties:
 *                     ready:
 *                       type: boolean
 *                     availableProviders:
 *                       type: array
 *                       items:
 *                         type: string
 *                 overall:
 *                   type: object
 *                   properties:
 *                     ready:
 *                       type: boolean
 *                     message:
 *                       type: string
 */
router.get('/status', authenticate, asyncHandler(async (req, res) => {
  const visualAgentStatus = {
    ready: visualAgentService.isReady(),
    initialized: visualAgentService.isReady()
  };

  const desktopAutomationStatus = {
    ready: desktopAutomationService.isReady()
  };

  const llmPlanningStatus = llmPlanningService.getStatus();

  const overallReady = visualAgentStatus.ready && 
                      desktopAutomationStatus.ready && 
                      llmPlanningStatus.ready;

  res.json({
    visualAgent: visualAgentStatus,
    desktopAutomation: desktopAutomationStatus,
    llmPlanning: llmPlanningStatus,
    overall: {
      ready: overallReady,
      message: overallReady ? 'All services ready' : 'Some services not ready'
    }
  });
}));

/**
 * @swagger
 * /api/visual-agent/screenshot:
 *   post:
 *     summary: Capture current screen screenshot
 *     tags: [Visual Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Screenshot captured successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 screenshot:
 *                   type: object
 *                   properties:
 *                     width:
 *                       type: number
 *                     height:
 *                       type: number
 *                     timestamp:
 *                       type: string
 *                     format:
 *                       type: string
 *                     base64:
 *                       type: string
 *                       description: Base64 encoded screenshot data
 */
router.post('/screenshot', authenticate, asyncHandler(async (req, res) => {
  try {
    const screenshot = await visualAgentService.captureScreenshot();
    const base64Data = await visualAgentService.screenshotToBase64(screenshot.buffer);

    res.json({
      success: true,
      screenshot: {
        width: screenshot.width,
        height: screenshot.height,
        timestamp: screenshot.timestamp,
        format: screenshot.format,
        base64: base64Data
      }
    });
  } catch (error) {
    logger.error('Screenshot capture failed:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Screenshot capture failed'
    });
  }
}));

/**
 * @swagger
 * /api/visual-agent/analyze:
 *   post:
 *     summary: Analyze current screen with OCR
 *     tags: [Visual Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: User prompt for context
 *                 example: "What's currently on screen?"
 *     responses:
 *       200:
 *         description: Screen analysis completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VisualContext'
 */
router.post('/analyze', authenticate, asyncHandler(async (req, res) => {
  try {
    const { prompt = "Analyze current screen" } = req.body;
    
    const context = await visualAgentService.createVisualContext(prompt);
    
    // Don't send the raw buffer in response, convert to base64
    const responseContext = {
      ...context,
      screenshot: {
        ...context.screenshot,
        base64: await visualAgentService.screenshotToBase64(context.screenshot.buffer),
        buffer: undefined // Remove buffer from response
      }
    };

    res.json({
      success: true,
      context: responseContext
    });
  } catch (error) {
    logger.error('Screen analysis failed:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Screen analysis failed'
    });
  }
}));

/**
 * @swagger
 * /api/visual-agent/plan:
 *   post:
 *     summary: Generate action plan from user prompt
 *     tags: [Visual Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: User instruction for the visual agent
 *                 example: "Click on the search button and type 'hello world'"
 *               provider:
 *                 type: string
 *                 description: Preferred LLM provider
 *                 enum: [openai-gpt4v, anthropic-claude]
 *     responses:
 *       200:
 *         description: Action plan generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 actionPlan:
 *                   $ref: '#/components/schemas/ActionPlan'
 *                 provider:
 *                   type: string
 *                 processingTime:
 *                   type: number
 *                 tokensUsed:
 *                   type: number
 */
router.post('/plan', authenticate, asyncHandler(async (req, res) => {
  try {
    const validatedData = ExecutePromptSchema.parse(req.body);
    
    // Create visual context
    const context = await visualAgentService.createVisualContext(validatedData.prompt);
    
    // Generate action plan with LLM
    const llmResponse = await llmPlanningService.generateActionPlan(context, validatedData.provider);
    
    res.json({
      success: true,
      actionPlan: llmResponse.actionPlan,
      provider: llmResponse.provider,
      processingTime: llmResponse.processingTime,
      tokensUsed: llmResponse.tokensUsed,
      confidence: llmResponse.confidence
    });
  } catch (error) {
    logger.error('Action plan generation failed:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Action plan generation failed'
    });
  }
}));

/**
 * @swagger
 * /api/visual-agent/execute:
 *   post:
 *     summary: Execute action plan on desktop
 *     tags: [Visual Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - actionPlan
 *             properties:
 *               actionPlan:
 *                 $ref: '#/components/schemas/ActionPlan'
 *               dryRun:
 *                 type: boolean
 *                 description: If true, validate but don't execute actions
 *                 default: false
 *     responses:
 *       200:
 *         description: Action plan executed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 result:
 *                   $ref: '#/components/schemas/ExecutionResult'
 *                 dryRun:
 *                   type: boolean
 */
router.post('/execute', authenticate, asyncHandler(async (req, res) => {
  try {
    const validatedData = ExecuteActionPlanSchema.parse(req.body);
    
    // Validate action plan
    const actionPlan = visualAgentService.validateActionPlan(validatedData.actionPlan);
    
    if (validatedData.dryRun) {
      // Dry run - just validate and return
      res.json({
        success: true,
        result: {
          success: true,
          executedActions: 0,
          totalActions: actionPlan.actions.length,
          duration: 0,
          timestamp: new Date().toISOString()
        },
        dryRun: true,
        message: 'Action plan validated successfully (dry run)'
      });
      return;
    }
    
    // Execute action plan
    const result = await desktopAutomationService.executeActionPlan(actionPlan);
    
    res.json({
      success: result.success,
      result,
      dryRun: false
    });
  } catch (error) {
    logger.error('Action plan execution failed:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Action plan execution failed'
    });
  }
}));

/**
 * @swagger
 * /api/visual-agent/execute-prompt:
 *   post:
 *     summary: Complete workflow - analyze screen, plan, and execute from user prompt
 *     tags: [Visual Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - prompt
 *             properties:
 *               prompt:
 *                 type: string
 *                 description: User instruction for the visual agent
 *                 example: "Open a new browser tab and search for 'BibScrip documentation'"
 *               provider:
 *                 type: string
 *                 description: Preferred LLM provider
 *               dryRun:
 *                 type: boolean
 *                 description: If true, plan but don't execute actions
 *                 default: false
 *     responses:
 *       200:
 *         description: Complete workflow executed successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 context:
 *                   $ref: '#/components/schemas/VisualContext'
 *                 actionPlan:
 *                   $ref: '#/components/schemas/ActionPlan'
 *                 executionResult:
 *                   $ref: '#/components/schemas/ExecutionResult'
 *                 llmResponse:
 *                   type: object
 *                 dryRun:
 *                   type: boolean
 */
router.post('/execute-prompt', authenticate, asyncHandler(async (req, res) => {
  try {
    const validatedData = ExecutePromptSchema.parse(req.body);
    
    logger.info('Starting complete visual agent workflow', {
      prompt: validatedData.prompt,
      provider: validatedData.provider,
      dryRun: validatedData.dryRun
    });
    
    // Step 1: Create visual context (screenshot + OCR)
    const context = await visualAgentService.createVisualContext(validatedData.prompt);
    
    // Step 2: Generate action plan with LLM
    const llmResponse = await llmPlanningService.generateActionPlan(context, validatedData.provider);
    
    // Step 3: Execute action plan (unless dry run)
    let executionResult: ExecutionResult | null = null;
    if (!validatedData.dryRun) {
      executionResult = await desktopAutomationService.executeActionPlan(llmResponse.actionPlan);
    }
    
    // Prepare response context (without raw buffer)
    const responseContext = {
      ...context,
      screenshot: {
        ...context.screenshot,
        base64: await visualAgentService.screenshotToBase64(context.screenshot.buffer),
        buffer: undefined
      }
    };
    
    res.json({
      success: true,
      context: responseContext,
      actionPlan: llmResponse.actionPlan,
      executionResult,
      llmResponse: {
        provider: llmResponse.provider,
        processingTime: llmResponse.processingTime,
        tokensUsed: llmResponse.tokensUsed,
        confidence: llmResponse.confidence
      },
      dryRun: validatedData.dryRun
    });
  } catch (error) {
    logger.error('Complete visual agent workflow failed:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Visual agent workflow failed'
    });
  }
}));

/**
 * @swagger
 * /api/visual-agent/emergency-stop:
 *   post:
 *     summary: Emergency stop - halt all automation and move mouse to safe position
 *     tags: [Visual Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Emergency stop executed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 */
router.post('/emergency-stop', authenticate, asyncHandler(async (req, res) => {
  try {
    await desktopAutomationService.emergencyStop();
    
    res.json({
      success: true,
      message: 'Emergency stop executed - mouse moved to safe position'
    });
  } catch (error) {
    logger.error('Emergency stop failed:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Emergency stop failed'
    });
  }
}));

/**
 * @swagger
 * /api/visual-agent/mouse-position:
 *   get:
 *     summary: Get current mouse position
 *     tags: [Visual Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Current mouse position
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 position:
 *                   type: object
 *                   properties:
 *                     x:
 *                       type: number
 *                     y:
 *                       type: number
 */
router.get('/mouse-position', authenticate, asyncHandler(async (req, res) => {
  try {
    const position = await desktopAutomationService.getCurrentMousePosition();
    
    res.json({
      success: true,
      position
    });
  } catch (error) {
    logger.error('Failed to get mouse position:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get mouse position'
    });
  }
}));

/**
 * @swagger
 * /api/visual-agent/screen-dimensions:
 *   get:
 *     summary: Get screen dimensions
 *     tags: [Visual Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Screen dimensions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 dimensions:
 *                   type: object
 *                   properties:
 *                     width:
 *                       type: number
 *                     height:
 *                       type: number
 */
router.get('/screen-dimensions', authenticate, asyncHandler(async (req, res) => {
  try {
    const dimensions = await desktopAutomationService.getScreenDimensions();
    
    res.json({
      success: true,
      dimensions
    });
  } catch (error) {
    logger.error('Failed to get screen dimensions:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get screen dimensions'
    });
  }
}));

export default router;

import { Router, Request, Response } from 'express';
import expressAsyncHandler from 'express-async-handler';
import { VisionFirstAutomationService } from '../services/visionFirstAutomationService';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';

const router = Router();
const visionFirstService = new VisionFirstAutomationService();

/**
 * @swagger
 * components:
 *   schemas:
 *     VisionFirstTaskRequest:
 *       type: object
 *       required:
 *         - taskDescription
 *       properties:
 *         taskDescription:
 *           type: string
 *           description: Natural language description of the task to accomplish
 *           example: "Create a new folder called 'MyProject' on the desktop"
 *         maxIterations:
 *           type: number
 *           description: Maximum number of vision-action iterations (default 10)
 *           example: 15
 *           default: 10
 *         dryRun:
 *           type: boolean
 *           description: If true, only analyze and plan without executing actions
 *           example: false
 *           default: false
 *     
 *     VisionFirstTaskResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         iterations:
 *           type: number
 *           example: 3
 *         finalState:
 *           type: object
 *           properties:
 *             contextDescription:
 *               type: string
 *               example: "Desktop is visible with Finder window open"
 *             isFullscreen:
 *               type: boolean
 *               example: false
 *             desktopVisible:
 *               type: boolean
 *               example: true
 *             uiElements:
 *               type: array
 *               items:
 *                 type: object
 *         executionLog:
 *           type: array
 *           items:
 *             type: string
 *           example: ["Starting vision-first execution", "Visual State: Desktop visible", "Action: rightClick at (800, 400)"]
 *         processingTime:
 *           type: number
 *           example: 5432.1
 *         timestamp:
 *           type: string
 *           format: date-time
 *           example: "2025-07-03T04:45:00.000Z"
 *     
 *     VisualStateResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           example: true
 *         visualState:
 *           type: object
 *           properties:
 *             screenDimensions:
 *               type: object
 *               properties:
 *                 width:
 *                   type: number
 *                   example: 1440
 *                 height:
 *                   type: number
 *                   example: 900
 *             isFullscreen:
 *               type: boolean
 *               example: false
 *             activeApplication:
 *               type: string
 *               example: "Finder"
 *             desktopVisible:
 *               type: boolean
 *               example: true
 *             uiElements:
 *               type: array
 *               items:
 *                 type: object
 *             contextDescription:
 *               type: string
 *               example: "macOS desktop with Finder window open, showing Documents folder"
 *             recommendedActions:
 *               type: array
 *               items:
 *                 type: string
 *               example: ["Click on desktop", "Open context menu", "Navigate to folder"]
 */

/**
 * @swagger
 * /api/vision-first-agent/execute-task:
 *   post:
 *     summary: Execute task using vision-first automation
 *     tags: [Vision-First Agent]
 *     description: Execute a natural language task using real-time visual feedback and adaptive automation
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/VisionFirstTaskRequest'
 *     responses:
 *       200:
 *         description: Task execution completed (success or failure)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VisionFirstTaskResponse'
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Internal server error during task execution
 */
router.post('/execute-task', 
  authenticate,
  expressAsyncHandler(async (req: Request, res: Response) => {
    // Basic validation
    const { taskDescription, maxIterations = 10, dryRun = false } = req.body;
    
    if (!taskDescription || typeof taskDescription !== 'string' || taskDescription.length < 5) {
      res.status(400).json({ 
        success: false, 
        error: 'Task description must be at least 5 characters long'
      });
      return;
    }

    const startTime = performance.now();

    try {
      logger.info('Vision-first task execution started', { 
        taskDescription, 
        maxIterations, 
        dryRun,
        userId: req.user?.id 
      });

      if (dryRun) {
        // For dry run, only analyze current state and plan first action
        const visualState = await visionFirstService.analyzeCurrentVisualState();
        const processingTime = performance.now() - startTime;

        res.json({
          success: true,
          dryRun: true,
          visualState,
          processingTime,
          timestamp: new Date().toISOString(),
          message: 'Dry run completed - visual state analyzed, no actions executed'
        });
        return;
      }

      // Execute the task with vision-first approach
      const result = await visionFirstService.executeTaskWithVision(
        taskDescription, 
        maxIterations
      );

      const processingTime = performance.now() - startTime;

      logger.info('Vision-first task execution completed', {
        success: result.success,
        iterations: result.iterations,
        processingTime,
        userId: req.user?.id
      });

      res.json({
        ...result,
        processingTime,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const processingTime = performance.now() - startTime;
      
      logger.error('Vision-first task execution failed', { 
        error, 
        taskDescription,
        processingTime,
        userId: req.user?.id 
      });

      res.status(500).json({
        success: false,
        error: 'Task execution failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        processingTime,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/vision-first-agent/analyze-state:
 *   get:
 *     summary: Analyze current visual state
 *     tags: [Vision-First Agent]
 *     description: Capture screenshot and analyze current visual state without executing any actions
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Visual state analysis completed
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VisualStateResponse'
 *       401:
 *         description: Unauthorized - invalid or missing token
 *       500:
 *         description: Internal server error during visual analysis
 */
router.get('/analyze-state',
  authenticate,
  expressAsyncHandler(async (req: Request, res: Response) => {
    const startTime = performance.now();

    try {
      logger.info('Visual state analysis started', { userId: req.user?.id });

      const visualState = await visionFirstService.analyzeCurrentVisualState();
      const processingTime = performance.now() - startTime;

      logger.info('Visual state analysis completed', {
        processingTime,
        elementsFound: visualState.uiElements.length,
        userId: req.user?.id
      });

      res.json({
        success: true,
        visualState,
        processingTime,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      const processingTime = performance.now() - startTime;
      
      logger.error('Visual state analysis failed', { 
        error, 
        processingTime,
        userId: req.user?.id 
      });

      res.status(500).json({
        success: false,
        error: 'Visual state analysis failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        processingTime,
        timestamp: new Date().toISOString()
      });
    }
  })
);

/**
 * @swagger
 * /api/vision-first-agent/health:
 *   get:
 *     summary: Check vision-first agent health
 *     tags: [Vision-First Agent]
 *     description: Check if the vision-first automation service is operational
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Service health status
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                   example: true
 *                 status:
 *                   type: string
 *                   example: "operational"
 *                 services:
 *                   type: object
 *                   properties:
 *                     screenshot:
 *                       type: boolean
 *                       example: true
 *                     ocr:
 *                       type: boolean
 *                       example: true
 *                     llm:
 *                       type: boolean
 *                       example: true
 *                     automation:
 *                       type: boolean
 *                       example: true
 *                 timestamp:
 *                   type: string
 *                   format: date-time
 */
router.get('/health',
  authenticate,
  expressAsyncHandler(async (req: Request, res: Response) => {
    try {
      // Test basic services
      const healthChecks = {
        screenshot: false,
        ocr: false,
        llm: false,
        automation: false
      };

      try {
        // Test screenshot capture
        const visualState = await visionFirstService.analyzeCurrentVisualState();
        healthChecks.screenshot = true;
        healthChecks.ocr = true;
        healthChecks.llm = visualState.contextDescription.length > 0;
        healthChecks.automation = true;
      } catch (error) {
        logger.warn('Health check partial failure', { error });
      }

      const allHealthy = Object.values(healthChecks).every(status => status);

      res.json({
        success: true,
        status: allHealthy ? 'operational' : 'degraded',
        services: healthChecks,
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      logger.error('Health check failed', { error });
      
      res.status(500).json({
        success: false,
        status: 'error',
        error: 'Health check failed',
        timestamp: new Date().toISOString()
      });
    }
  })
);

export default router;

// Action Planner API - Pure Planning Engine for Electron Client
// Accepts screenshot/OCR data, returns JSON action plans

import express, { Request, Response, NextFunction } from 'express';
import { authenticateJWT } from '../middleware/auth';
import { rateLimiter } from '../middleware/rateLimiter';
import { logger } from '../utils/logger';
import { getBestLLMResponse } from '../utils/llmRouter';
import { automationLogger } from '../services/automationLogger';
import expressAsyncHandler from '../utils/asyncHandler';
import { 
  validateElectronRequest, 
  createSuccessResponse, 
  createErrorResponse,
  type ElectronRequest,
  type Action 
} from '../types/electronSchema';

const router = express.Router();

/**
 * @swagger
 * /api/action-planner/plan:
 *   post:
 *     summary: Generate action plan from screenshot and OCR data
 *     description: Pure planning endpoint that accepts screenshot/OCR from Electron client and returns JSON action plan
 *     tags: [Action Planner]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - taskDescription
 *               - screenshot
 *               - ocrResult
 *               - appContext
 *               - screenContext
 *             properties:
 *               taskDescription:
 *                 type: string
 *                 description: Natural language description of the task
 *                 example: "Click the Search button"
 *               screenshot:
 *                 type: string
 *                 description: Base64 encoded screenshot
 *               ocrResult:
 *                 type: object
 *                 properties:
 *                   text:
 *                     type: string
 *                   boundingBoxes:
 *                     type: array
 *                   confidence:
 *                     type: number
 *                   source:
 *                     type: string
 *                     enum: [local, google, azure]
 *               appContext:
 *                 type: object
 *                 properties:
 *                   name:
 *                     type: string
 *                   windowTitle:
 *                     type: string
 *               screenContext:
 *                 type: object
 *                 properties:
 *                   width:
 *                     type: number
 *                   height:
 *                     type: number
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
 *                 actions:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       action:
 *                         type: string
 *                         enum: [click, doubleClick, rightClick, type, keyPress, scroll, drag, wait, screenshot, moveMouse, focus, switchApp]
 *                       target:
 *                         type: object
 *                         properties:
 *                           x:
 *                             type: number
 *                           y:
 *                             type: number
 *                       confidence:
 *                         type: number
 *                       reasoning:
 *                         type: string
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Authentication required
 *       429:
 *         description: Rate limit exceeded
 *       500:
 *         description: Internal server error
 */
router.post('/plan', authenticateJWT, expressAsyncHandler(rateLimiter('/api/action-planner/plan'))), expressAsyncHandler(async (req: Request, res: Response, next: NextFunction) => {
  const startTime = performance.now();
  let sessionId: string | undefined;

  try {
    // Validate request data
    let requestData: ElectronRequest;
    try {
      requestData = validateElectronRequest(req.body);
    } catch (validationError) {
      return res.status(400).json({
        success: false,
        error: 'Invalid request data',
        details: validationError instanceof Error ? validationError.message : 'Validation failed'
      });
    }
    
    // Create automation session for tracking
    sessionId = await automationLogger.createSession(
      `Planning: ${requestData.taskDescription}`,
      requestData.appContext.name,
      undefined,
      requestData.maxActions || 5
    );

    logger.info('Action planning request received', {
      sessionId,
      taskDescription: requestData.taskDescription,
      appName: requestData.appContext.name,
      screenSize: `${requestData.screenContext.width}x${requestData.screenContext.height}`,
      ocrSource: requestData.ocrResult.source,
      ocrConfidence: requestData.ocrResult.confidence
    });

    // Generate action plan using LLM
    const actionPlan = await generateActionPlan(requestData, sessionId);

    // Log the planning result
    await automationLogger.logAction(
      sessionId,
      'plan_generated',
      true,
      Math.round(performance.now() - startTime),
      {
        confidence: actionPlan.confidence,
        reasoning: actionPlan.reasoning,
        actionCount: actionPlan.actions.length
      },
      undefined,
      undefined
    );

    const processingTime = performance.now() - startTime;
    
    const response = createSuccessResponse(
      actionPlan.actions,
      actionPlan.reasoning,
      actionPlan.confidence,
      sessionId,
      {
        processingTime: Math.round(processingTime),
        llmProvider: actionPlan.llmProvider,
        tokensUsed: actionPlan.tokensUsed,
        cacheHit: actionPlan.cacheHit
      }
    );

    return res.json(response);
  } catch (error: any) {
    logger.error('Action planning failed', { 
      error: error.message, 
      sessionId,
      processingTime: Math.round(performance.now() - startTime)
    });

    if (sessionId) {
      await automationLogger.logAction(
        sessionId,
        'plan_failed',
        false,
        Math.round(performance.now() - startTime),
        { error: error.message },
        undefined,
        error.message
      );
    }

    const errorResponse = createErrorResponse(
      error.message || 'Action planning failed',
      'PLANNING_FAILED',
      { stack: error.stack },
      sessionId
    );

    return res.status(500).json(errorResponse);
  }
});

/**
 * Generate action plan using LLM based on screenshot and OCR data
 */
async function generateActionPlan(
  request: ElectronRequest, 
  sessionId: string
): Promise<{
  actions: Action[];
  reasoning: string;
  confidence: number;
  llmProvider?: string;
  tokensUsed?: number;
  cacheHit: boolean;
}> {
  const prompt = buildPlanningPrompt(request);
  
  const llmResponse = await getBestLLMResponse(prompt);

  // Parse LLM response into structured actions
  const parsedPlan = parseLLMResponse(llmResponse, request);
  
  return {
    actions: parsedPlan.actions,
    reasoning: parsedPlan.reasoning,
    confidence: parsedPlan.confidence,
    llmProvider: 'openai-gpt4o',
    tokensUsed: 0,
    cacheHit: false
  };
}

/**
 * Build comprehensive planning prompt for LLM
 */
function buildPlanningPrompt(request: ElectronRequest): string {
  return `You are an expert desktop automation planner. Analyze the provided screenshot and OCR data to generate a precise action plan.

TASK: ${request.taskDescription}

CONTEXT:
- Application: ${request.appContext.name}
- Window: ${request.appContext.windowTitle}
- Screen: ${request.screenContext.width}x${request.screenContext.height}
- OCR Text: ${request.ocrResult.text}
- OCR Confidence: ${request.ocrResult.confidence}
- OCR Source: ${request.ocrResult.source}

AVAILABLE ACTIONS:
- click: Click at specific coordinates
- doubleClick: Double-click at coordinates
- rightClick: Right-click for context menu
- type: Type text (specify text in "text" field)
- keyPress: Press specific key (specify key in "key" field)
- scroll: Scroll in direction (up/down/left/right)
- drag: Drag from one point to another
- wait: Wait for specified duration (ms)
- moveMouse: Move mouse to coordinates
- focus: Focus on application/window
- switchApp: Switch to different application

INSTRUCTIONS:
1. Analyze the screenshot visually to understand the UI layout
2. Use OCR bounding boxes to locate clickable elements precisely
3. Generate a step-by-step action plan to complete the task
4. Each action must include precise coordinates and high confidence
5. Provide clear reasoning for each action
6. Keep actions minimal but complete

RESPONSE FORMAT (JSON):
{
  "actions": [
    {
      "action": "click",
      "target": { "x": 412, "y": 187 },
      "confidence": 0.93,
      "reasoning": "Clicking Search button located at top-right"
    }
  ],
  "reasoning": "Overall plan explanation",
  "confidence": 0.90
}

Generate the action plan now:`;
}

/**
 * Parse LLM response into structured action plan
 */
function parseLLMResponse(llmContent: string, request: ElectronRequest): {
  actions: Action[];
  reasoning: string;
  confidence: number;
} {
  try {
    // Extract JSON from LLM response
    const jsonMatch = llmContent.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in LLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]);
    
    // Validate and normalize actions
    const actions: Action[] = (parsed.actions || []).map((action: any) => ({
      action: action.action || 'click',
      target: action.target || { x: 0, y: 0 },
      text: action.text,
      key: action.key,
      duration: action.duration,
      direction: action.direction,
      distance: action.distance,
      confidence: Math.min(Math.max(action.confidence || 0.5, 0), 1),
      reasoning: action.reasoning || 'No reasoning provided',
      metadata: action.metadata
    }));

    return {
      actions,
      reasoning: parsed.reasoning || 'Action plan generated',
      confidence: Math.min(Math.max(parsed.confidence || 0.7, 0), 1)
    };

  } catch (error) {
    logger.error('Failed to parse LLM response', { error, llmContent });
    
    // Fallback: create a simple screenshot action
    return {
      actions: [{
        action: 'screenshot',
        confidence: 0.5,
        reasoning: 'Failed to parse plan, taking screenshot for analysis'
      }],
      reasoning: 'LLM response parsing failed, using fallback action',
      confidence: 0.3
    };
  }
}

/**
 * @swagger
 * /api/action-planner/health:
 *   get:
 *     summary: Health check for action planner service
 *     tags: [Action Planner]
 *     responses:
 *       200:
 *         description: Service is healthy
 */
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'action-planner',
    timestamp: new Date().toISOString(),
    capabilities: [
      'screenshot_analysis',
      'ocr_processing',
      'action_planning',
      'multi_step_workflows'
    ]
  });
});

export default router;

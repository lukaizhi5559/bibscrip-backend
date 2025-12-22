import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';

const router = Router();

const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

interface ComputerUseRequest {
  goal: string;
  context?: {
    activeApp?: string;
    activeUrl?: string;
    os?: string;
  };
  maxIterations?: number;
  provider?: 'openai' | 'anthropic';
}

/**
 * Computer Use action types - aligned with MCP/NutJS interpreter
 * These map to the valid step types that the frontend interpreter can execute
 */
interface ComputerAction {
  // Action type - must match MCP interpreter valid types
  type: 'focusApp' | 'openUrl' | 'typeText' | 'hotkey' | 'click' | 'scroll' | 
        'pause' | 'waitForElement' | 'screenshot' | 'findAndClick' | 
        'log' | 'pressKey' | 'end';
  
  // Parameters for different action types
  appName?: string;              // for focusApp
  url?: string;                  // for openUrl
  text?: string;                 // for typeText, log
  submit?: boolean;              // for typeText
  key?: string;                  // for hotkey, pressKey
  modifiers?: string[];          // for hotkey, pressKey
  button?: 'left' | 'right';     // for click
  clickCount?: number;           // for click
  coordinates?: { x: number; y: number }; // for click (if not using findAndClick)
  direction?: 'up' | 'down' | 'left' | 'right'; // for scroll
  amount?: number;               // for scroll
  ms?: number;                   // for pause
  locator?: {                    // for findAndClick, waitForElement
    strategy: 'vision' | 'textMatch' | 'contains' | 'bbox';
    description?: string;
    text?: string;
    bbox?: [number, number, number, number];
  };
  timeoutMs?: number;            // for waitForElement
  tag?: string;                  // for screenshot
  analyzeWithVision?: boolean;   // for screenshot
  level?: 'info' | 'warn' | 'error'; // for log
  message?: string;              // for log
  reason?: string;               // for end
  
  // AI reasoning (not sent to interpreter, just for logging)
  reasoning?: string;
}

interface ComputerUseResponse {
  success: boolean;
  actions: ComputerAction[];
  iterations: number;
  finalState?: string;
  error?: string;
}

/**
 * Computer Use API - Agentic Loop
 * 
 * This endpoint implements an Anthropic Computer Use-style agentic loop:
 * 1. Take screenshot
 * 2. Analyze with vision LLM
 * 3. Decide next action
 * 4. Execute action (via frontend)
 * 5. Repeat until goal achieved or max iterations
 * 
 * Flow:
 * Backend (this) ←→ Frontend (Ghost Mouse)
 *   - Backend: Analyzes screenshots, decides actions
 *   - Frontend: Executes actions, sends back screenshots
 */
router.post('/execute', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const { goal, context, maxIterations = 20, provider = 'anthropic' } = req.body as ComputerUseRequest;

    if (!goal || typeof goal !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Missing or invalid "goal" parameter',
      });
      return;
    }

    logger.info('Computer Use execution request', {
      goal,
      provider,
      maxIterations,
      userId: (req as any).user?.id,
    });

    // Start streaming response
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const sendAction = (action: ComputerAction) => {
      res.write(`data: ${JSON.stringify({ type: 'action', action })}\n\n`);
    };

    const sendStatus = (status: string) => {
      res.write(`data: ${JSON.stringify({ type: 'status', message: status })}\n\n`);
    };

    const sendComplete = (result: any) => {
      res.write(`data: ${JSON.stringify({ type: 'complete', result })}\n\n`);
      res.end();
    };

    const sendError = (error: string) => {
      res.write(`data: ${JSON.stringify({ type: 'error', error })}\n\n`);
      res.end();
    };

    // Initial screenshot request
    sendAction({
      type: 'screenshot',
      reasoning: 'Capturing initial state to understand current UI',
    });

    // Note: Frontend will send screenshot back via WebSocket or separate endpoint
    // For now, this is the architecture design

    sendStatus('Waiting for initial screenshot from frontend...');

  } catch (error: any) {
    logger.error('Computer Use execution error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Analyze screenshot and decide next action
 * This is called by frontend after taking a screenshot
 */
router.post('/analyze', authenticate, async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      goal,
      screenshot,
      previousActions = [],
      iteration = 0,
      maxIterations = 20,
      provider = 'anthropic',
      context,
    } = req.body;

    if (!goal || !screenshot) {
      res.status(400).json({
        success: false,
        error: 'Missing goal or screenshot',
      });
      return;
    }

    logger.info('Analyzing screenshot for next action', {
      goal,
      iteration,
      previousActionsCount: previousActions.length,
    });

    // Check if max iterations reached
    if (iteration >= maxIterations) {
      res.json({
        success: false,
        action: { type: 'end', reason: 'Max iterations reached', reasoning: 'Reached maximum iteration limit without completing goal' },
        complete: true,
      });
      return;
    }

    // Analyze screenshot and decide next action
    const nextAction = await analyzeAndDecide(
      goal,
      screenshot,
      previousActions,
      context,
      provider
    );

    res.json({
      success: true,
      action: nextAction,
      complete: nextAction.type === 'end',
      iteration: iteration + 1,
    });

  } catch (error: any) {
    logger.error('Screenshot analysis error', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * Core logic: Analyze screenshot and decide next action
 */
async function analyzeAndDecide(
  goal: string,
  screenshot: { base64: string; mimeType: string },
  previousActions: ComputerAction[],
  context: any,
  provider: 'openai' | 'anthropic'
): Promise<ComputerAction> {
  
  const prompt = buildComputerUsePrompt(goal, previousActions, context);

  if (provider === 'anthropic' && anthropicClient) {
    return await analyzeWithAnthropic(prompt, screenshot);
  } else if (provider === 'openai' && openaiClient) {
    return await analyzeWithOpenAI(prompt, screenshot);
  } else {
    throw new Error(`Provider ${provider} not available or not configured`);
  }
}

/**
 * Build prompt for Computer Use analysis
 */
function buildComputerUsePrompt(
  goal: string,
  previousActions: ComputerAction[],
  context: any
): string {
  return `You are a desktop automation agent. Your goal is to accomplish the following task:

<<GOAL>>
${goal}
<</GOAL>>

<<CURRENT_CONTEXT>>
Active App: ${context?.activeApp || 'unknown'}
Active URL: ${context?.activeUrl || 'unknown'}
OS: ${context?.os || 'unknown'}
<</CURRENT_CONTEXT>>

${previousActions.length > 0 ? `<<PREVIOUS_ACTIONS>>
${previousActions.map((a, i) => `${i + 1}. ${a.type} - ${a.reasoning || 'No reasoning'}`).join('\n')}
<</PREVIOUS_ACTIONS>>` : ''}

TASK: Analyze the current screenshot and decide the NEXT SINGLE ACTION to take.

AVAILABLE ACTIONS (must use exact type names):
1. findAndClick: { "type": "findAndClick", "locator": { "strategy": "vision", "description": "the blue button in top left" }, "reasoning": "..." }
2. click: { "type": "click", "button": "left", "coordinates": { "x": 100, "y": 200 }, "reasoning": "..." }
3. typeText: { "type": "typeText", "text": "...", "submit": false, "reasoning": "..." }
4. pressKey: { "type": "pressKey", "key": "Enter", "modifiers": ["Cmd"], "reasoning": "..." }
5. scroll: { "type": "scroll", "direction": "up" | "down", "amount": 300, "reasoning": "..." }
6. pause: { "type": "pause", "ms": 1000, "reasoning": "..." }
7. waitForElement: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "..." }, "timeoutMs": 3000, "reasoning": "..." }
8. screenshot: { "type": "screenshot", "tag": "verify_state", "analyzeWithVision": true, "reasoning": "..." }
9. focusApp: { "type": "focusApp", "appName": "Google Chrome", "reasoning": "..." }
10. openUrl: { "type": "openUrl", "url": "https://...", "reasoning": "..." }
11. end: { "type": "end", "reason": "Goal achieved" | "Impossible to complete", "reasoning": "..." }

CRITICAL RULES:
1. Return ONLY ONE action as valid JSON
2. Use "findAndClick" with vision locator (PREFERRED) instead of hardcoded coordinates
3. Include "reasoning" field explaining why this action moves toward the goal
4. If goal is achieved, return type: "end" with reason: "Goal achieved"
5. If stuck or impossible, return type: "end" with reason explaining why
6. No markdown fences, no explanations outside JSON
7. ALWAYS use locator.strategy = "vision" for findAndClick and waitForElement

VISION LOCATOR GUIDANCE:
- Describe UI elements naturally: "the blue Send button in bottom right"
- Be specific about location: "in top left corner", "at the bottom"
- Mention visual characteristics: "blue button", "text input field", "sidebar toggle icon"
- The vision service will find exact coordinates from your description

PIXEL COUNTING (only if using click with coordinates):
- Count pixels from top-left corner (0, 0)
- X increases going RIGHT
- Y increases going DOWN
- Click on CENTER of UI elements for reliability

PREFERRED: Use findAndClick with vision
{ "type": "findAndClick", "locator": { "strategy": "vision", "description": "ChatGPT sidebar toggle button in upper left corner" }, "reasoning": "Opening sidebar to access projects" }

FALLBACK: Use click with coordinates (only if vision not available)
{ "type": "click", "button": "left", "coordinates": { "x": 18, "y": 79 }, "reasoning": "Clicking sidebar toggle" }

Now analyze the screenshot and return the next action:`;
}

/**
 * Analyze with Anthropic Claude
 */
async function analyzeWithAnthropic(
  prompt: string,
  screenshot: { base64: string; mimeType: string }
): Promise<ComputerAction> {
  if (!anthropicClient) {
    throw new Error('Anthropic client not initialized');
  }

  const message = await anthropicClient.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 500,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: (screenshot.mimeType as any) || 'image/png',
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
  return parseActionFromResponse(response);
}

/**
 * Analyze with OpenAI GPT-4 Vision
 */
async function analyzeWithOpenAI(
  prompt: string,
  screenshot: { base64: string; mimeType: string }
): Promise<ComputerAction> {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized');
  }

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
    max_tokens: 500,
    temperature: 0.1,
  });

  const response = completion.choices[0]?.message?.content || '';
  return parseActionFromResponse(response);
}

/**
 * Parse action from LLM response
 */
function parseActionFromResponse(response: string): ComputerAction {
  try {
    // Remove markdown fences if present
    const cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    const action = JSON.parse(cleaned);

    // Validate action has required fields
    if (!action.type) {
      throw new Error('Action missing "type" field');
    }

    return action as ComputerAction;
  } catch (error: any) {
    logger.error('Failed to parse action from response', {
      response,
      error: error.message,
    });
    
    // Fallback: return end action with error
    return {
      type: 'end',
      reason: 'Failed to parse LLM response',
      reasoning: `Failed to parse action: ${error.message}`,
    };
  }
}

export default router;

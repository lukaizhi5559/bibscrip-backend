import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { logger } from '../utils/logger';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { uiDetectionService } from '../services/uiDetectionService';

// Session persistence across WebSocket reconnections
const sessionStore = new Map<string, any>();

const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;

/**
 * Call hybrid UI detection (OmniParser + OCR + Vision API fallback)
 */
async function callVisionAPI(
  screenshot: { base64: string; mimeType: string },
  description: string,
  context: any
): Promise<{ coordinates: { x: number; y: number }; confidence: number }> {
  // Use spatial-aware hybrid detection
  const result = await uiDetectionService.detectElement(screenshot, description, context);
  
  logger.info('✅ [COMPUTER-USE] Element detected via hybrid system', {
    method: result.method,
    coordinates: result.coordinates,
    confidence: result.confidence,
    selectedElement: result.selectedElement,
  });

  return {
    coordinates: result.coordinates,
    confidence: result.confidence,
  };
}

interface ComputerAction {
  type: 'focusApp' | 'openUrl' | 'typeText' | 'hotkey' | 'click' | 'scroll' | 
        'pause' | 'waitForElement' | 'screenshot' | 'findAndClick' | 
        'log' | 'pressKey' | 'end';
  appName?: string;
  url?: string;
  text?: string;
  submit?: boolean;
  key?: string;
  modifiers?: string[];
  button?: 'left' | 'right';
  clickCount?: number;
  coordinates?: { x: number; y: number };
  direction?: 'up' | 'down' | 'left' | 'right';
  amount?: number;
  ms?: number;
  locator?: {
    strategy: 'text' | 'image' | 'element' | 'vision' | 'textMatch' | 'contains' | 'bbox';
    // Nut.js native strategies (preferred)
    value?: string;           // Text to find, image name, or element title
    context?: string;         // Optional hint: "dock icon", "button", "menu item"
    role?: string;            // For element strategy: "button", "menuItem", "textField"
    // Legacy Vision API (fallback)
    description?: string;     // Natural language description for Vision API
    text?: string;            // For textMatch strategy
    bbox?: [number, number, number, number];
  };
  timeoutMs?: number;
  tag?: string;
  analyzeWithVision?: boolean;
  level?: 'info' | 'warn' | 'error';
  message?: string;
  reason?: string;
  reasoning?: string;
}

interface ClarificationQuestion {
  id: string;
  question: string;
  options?: string[];
  required: boolean;
}

interface WebSocketMessage {
  type: 'start' | 'screenshot' | 'clarification_answer' | 'cancel' | 'action_failed';
  goal?: string;
  context?: any;
  screenshot?: { base64: string; mimeType: string };
  answers?: Record<string, string>;
  maxIterations?: number;
  provider?: 'openai' | 'anthropic';
  failedAction?: ComputerAction;
  failureReason?: string;
}

interface ServerMessage {
  type: 'action' | 'clarification' | 'clarification_needed' | 'status' | 'complete' | 'error';
  action?: ComputerAction;
  questions?: ClarificationQuestion[];
  message?: string;
  result?: any;
  error?: string;
  iteration?: number;
}

/**
 * Computer Use WebSocket Handler
 * Handles bidirectional communication for agentic loop with clarification support
 */
export function handleComputerUseWebSocket(ws: WebSocket, req: IncomingMessage) {
  // Session state will be loaded from store or created fresh
  let sessionState: any = null;

  logger.info('Computer Use WebSocket connection established');

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'status',
    message: 'Connected to Computer Use API. Send "start" message to begin.',
  } as ServerMessage));

  ws.on('message', async (data: WebSocket.Data) => {
    try {
      const message: WebSocketMessage = JSON.parse(data.toString());
      
      logger.info('📨 [COMPUTER-USE] Received message from frontend', {
        type: message.type,
        hasScreenshot: !!message.screenshot,
        hasAnswers: !!message.answers,
      });

      // Load session state from store if not in memory
      if (!sessionState && message.context) {
        const sessionKey = `${message.context.userId || 'default'}_${message.context.sessionId || 'default'}`;
        sessionState = sessionStore.get(sessionKey);
        if (sessionState) {
          logger.info('🔄 [COMPUTER-USE] Loaded session state from store', {
            sessionKey,
            type: message.type,
          });
        }
      }

      switch (message.type) {
        case 'start':
          sessionState = await handleStart(ws, message, sessionState);
          break;

        case 'screenshot':
          await handleScreenshot(ws, message, sessionState);
          break;

        case 'clarification_answer':
          sessionState = await handleClarificationAnswer(ws, message, sessionState);
          break;

        case 'cancel':
          ws.send(JSON.stringify({
            type: 'status',
            message: 'Task cancelled by user',
          } as ServerMessage));
          ws.close();
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            error: `Unknown message type: ${message.type}`,
          } as ServerMessage));
      }
    } catch (error: any) {
      logger.error('WebSocket message handling error', { error: error.message });
      ws.send(JSON.stringify({
        type: 'error',
        error: error.message,
      } as ServerMessage));
    }
  });

  ws.on('close', () => {
    logger.info('Computer Use WebSocket connection closed');
    // Session state is preserved in sessionStore for reconnections
  });

  ws.on('error', (error) => {
    logger.error('WebSocket error', { error: error.message });
  });
}

/**
 * Handle start message - initialize session and request first screenshot
 */
async function handleStart(
  ws: WebSocket,
  message: WebSocketMessage,
  state: any
) {
  try {
    logger.info('🚀 [COMPUTER-USE] handleStart called', {
      hasGoal: !!message.goal,
      hasContext: !!message.context,
    });

    if (!message.goal) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Missing "goal" in start message',
      } as ServerMessage));
      return state;
    }

    // Generate session key from userId + sessionId
    const context = message.context || {};
    const sessionKey = `${context.userId || 'default'}_${context.sessionId || 'default'}`;
    
    // Load existing session or create new one
    let sessionState = sessionStore.get(sessionKey);
    
    if (!sessionState) {
      // Create new session
      sessionState = {
        goal: message.goal,
        context: context,
        previousActions: [] as ComputerAction[],
        iteration: 0,
        maxIterations: message.maxIterations || 20,
        provider: message.provider || 'anthropic',
        waitingForClarification: false,
        clarificationAnswers: {} as Record<string, string>,
        conversationHistory: [] as Array<{ timestamp: number; goal: string; completed: boolean }>,
        completedMilestones: new Set<string>(), // Track completed milestones
      };
      
      logger.info('📝 [COMPUTER-USE] Created new session', {
        sessionKey,
        goal: message.goal,
      });
    } else {
      // Reconnecting to existing session
      logger.info('🔄 [COMPUTER-USE] Reconnecting to existing session', {
        sessionKey,
        previousGoalsCount: sessionState.conversationHistory.length,
        newGoal: message.goal,
      });
      
      // Update session with new goal but preserve history
      sessionState.goal = message.goal;
      sessionState.context = context;
      sessionState.maxIterations = message.maxIterations || 20;
      sessionState.provider = message.provider || 'anthropic';
      sessionState.iteration = 0;
      sessionState.previousActions = [];
      sessionState.completedMilestones = sessionState.completedMilestones || [];
    }
    
    // Add current goal to conversation history
    sessionState.conversationHistory.push({
      timestamp: Date.now(),
      goal: message.goal,
      completed: false,
    });
    
    // Store session
    sessionStore.set(sessionKey, sessionState);
    
    state = sessionState;

    logger.info('Computer Use session started', {
      goal: state.goal,
      provider: state.provider,
      contextKeys: Object.keys(state.context),
      conversationHistoryLength: state.conversationHistory.length,
    });

    // Check if we need clarification before starting
    const needsClarification = checkForClarification(state.goal, state.context);
    
    logger.info('🔍 [COMPUTER-USE] Clarification check result', {
      questionsCount: needsClarification.questions.length,
      hasActiveApp: !!state.context.activeApp,
      contextKeys: Object.keys(state.context),
    });
    
    if (needsClarification.questions.length > 0) {
      state.waitingForClarification = true;
      logger.info('❓ [COMPUTER-USE] Sending clarification request to frontend');
      ws.send(JSON.stringify({
        type: 'clarification_needed',
        questions: needsClarification.questions,
      } as ServerMessage));
      return state;
    }

    // Request initial screenshot
    logger.info('📸 [COMPUTER-USE] About to create screenshot action...');
    const screenshotAction = {
      type: 'action',
      action: {
        type: 'screenshot',
        reasoning: 'Capturing initial screen state',
      },
      iteration: 0,
    } as ServerMessage;
    
    logger.info('📸 [COMPUTER-USE] Requesting initial screenshot from frontend', {
      action: screenshotAction.action,
    });
    
    ws.send(JSON.stringify(screenshotAction));
    logger.info('✅ [COMPUTER-USE] Screenshot request sent successfully');
    
    return state;
  } catch (error: any) {
    logger.error('❌ [COMPUTER-USE] Error in handleStart', {
      error: error.message,
      stack: error.stack,
    });
    ws.send(JSON.stringify({
      type: 'error',
      error: `Failed to start session: ${error.message}`,
    } as ServerMessage));
    return state;
  }
}

/**
 * Handle screenshot message - analyze and decide next action
 */
async function handleScreenshot(
  ws: WebSocket,
  message: WebSocketMessage,
  state: any
) {
  if (!message.screenshot) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Missing screenshot data',
    } as ServerMessage));
    return;
  }

  state.iteration++;

  // Check max iterations
  if (state.iteration > state.maxIterations) {
    ws.send(JSON.stringify({
      type: 'complete',
      result: {
        success: false,
        reason: 'Max iterations reached',
      },
    } as ServerMessage));
    ws.close();
    return;
  }

  logger.info('Analyzing screenshot', {
    iteration: state.iteration,
    goal: state.goal,
  });

  // Screenshot comparison to detect UI changes
  const currentScreenshotHash = message.context?.screenshotHash || message.screenshot.base64.substring(0, 50);
  const previousScreenshotHash = state.lastScreenshotHash;
  const uiChanged = currentScreenshotHash !== previousScreenshotHash;
  
  // Track unchanged UI iterations
  if (!uiChanged && previousScreenshotHash) {
    state.unchangedCount = (state.unchangedCount || 0) + 1;
    logger.warn('⚠️ [COMPUTER-USE] UI unchanged after action', {
      iteration: state.iteration,
      unchangedCount: state.unchangedCount,
      lastAction: state.previousActions[state.previousActions.length - 1]?.type,
    });
  } else {
    state.unchangedCount = 0;
    logger.info('✅                     [COMPUTER-USE] UI changed - action had effect', {
      iteration: state.iteration,
    });
  }
  
  state.lastScreenshotHash = currentScreenshotHash;

  logger.info('📸 [COMPUTER-USE] Screenshot received', {
    iteration: state.iteration,
    screenshotHashPrefix: currentScreenshotHash.substring(0, 50),
    screenshotLength: message.screenshot.base64.length,
    uiChanged,
    unchangedCount: state.unchangedCount || 0,
  });

  // Analyze screenshot and decide next action
  let nextAction: ComputerAction;
  try {
    logger.info('🤖 [COMPUTER-USE] Calling LLM for decision', {
      provider: state.provider,
      previousActionsCount: state.previousActions.length,
    });

    // Enrich context with UI change detection
    const enrichedContext = {
      ...state.context,
      uiChanged,
      unchangedCount: state.unchangedCount || 0,
    };

    nextAction = await analyzeAndDecide(
      state.goal,
      message.screenshot,
      state.previousActions,
      enrichedContext,
      state.provider,
      state.clarificationAnswers,
      state.conversationHistory,
      state.completedMilestones
    );

    logger.info('✅ [COMPUTER-USE] LLM returned action', {
      actionType: nextAction.type,
      reasoning: nextAction.reasoning,
    });
  } catch (error: any) {
    logger.error('❌ [COMPUTER-USE] LLM analysis failed', {
      error: error.message,
      stack: error.stack,
    });

    ws.send(JSON.stringify({
      type: 'error',
      error: `LLM analysis failed: ${error.message}`,
    } as ServerMessage));
    return;
  }

  state.previousActions.push(nextAction);
  
  // Track completed milestones to prevent re-doing tasks
  const lastAction = state.previousActions[state.previousActions.length - 1];
  
  // Milestone: Input field focused (single character typed to test focus)
  // Detect: typeText with exactly 1 character, regardless of reasoning
  if (lastAction?.type === 'typeText' && lastAction.text?.length === 1) {
    if (!state.completedMilestones.has('input_field_focused')) {
      state.completedMilestones.add('input_field_focused');
      logger.info('✅ [MILESTONE] Input field focused (single character typed)', {
        iteration: state.iteration,
        char: lastAction.text,
      });
    }
  }
  
  // Milestone: Test character deleted
  // Detect: Backspace OR Cmd+A after single character was typed
  if ((lastAction?.type === 'pressKey' && 
       (lastAction.key === 'Backspace' || 
        (lastAction.key === 'a' && lastAction.modifiers?.includes('Cmd')))) &&
      state.completedMilestones.has('input_field_focused')) {
    if (!state.completedMilestones.has('test_char_deleted')) {
      state.completedMilestones.add('test_char_deleted');
      logger.info('✅ [MILESTONE] Test character deleted/selected', {
        iteration: state.iteration,
        action: lastAction.key === 'Backspace' ? 'Backspace' : 'Cmd+A',
      });
    }
  }
  
  // Milestone: Content typed (any text longer than 1 character)
  // This covers: messages, search queries, file names, etc.
  if (lastAction?.type === 'typeText' && lastAction.text && lastAction.text.length > 1) {
    if (!state.completedMilestones.has('content_typed')) {
      state.completedMilestones.add('content_typed');
      logger.info('✅ [MILESTONE] Content typed', {
        iteration: state.iteration,
        length: lastAction.text.length,
        preview: lastAction.text.substring(0, 20),
      });
    }
  }
  
  // Milestone: Content submitted (Enter pressed after typing)
  if (lastAction?.type === 'pressKey' && lastAction.key === 'Enter' &&
      state.completedMilestones.has('content_typed')) {
    if (!state.completedMilestones.has('content_submitted')) {
      state.completedMilestones.add('content_submitted');
      logger.info('✅ [MILESTONE] Content submitted (Enter pressed)', {
        iteration: state.iteration,
      });
    }
  }
  
  // Milestone: App focused (focusApp action completed)
  if (lastAction?.type === 'focusApp') {
    const appName = (lastAction as any).appName;
    const milestoneKey = `app_focused_${appName}`;
    if (!state.completedMilestones.has(milestoneKey)) {
      state.completedMilestones.add(milestoneKey);
      logger.info('✅ [MILESTONE] App focused', {
        iteration: state.iteration,
        app: appName,
      });
    }
  }
  
  // Milestone: URL opened (openUrl action completed)
  if (lastAction?.type === 'openUrl') {
    if (!state.completedMilestones.has('url_opened')) {
      state.completedMilestones.add('url_opened');
      logger.info('✅ [MILESTONE] URL opened', {
        iteration: state.iteration,
      });
    }
  }
  
  // Save session state with milestones
  const sessionKey = `${state.context.userId || 'default'}_${state.context.sessionId || 'default'}`;
  sessionStore.set(sessionKey, state);

  // Proactive UI state verification (every 3 iterations or when stuck)
  if (state.iteration % 3 === 0 || state.iteration > 5) {
    const verification = await verifyUIStateAlignment(
      state.goal,
      message.screenshot,
      state.context,
      state.previousActions,
      state.iteration
    );

    if (!verification.aligned && verification.needsClarification) {
      logger.warn('⚠️ [COMPUTER-USE] UI state misalignment detected', {
        reason: verification.reason,
        confidence: verification.confidence,
      });

      logger.info('🤔 [COMPUTER-USE] Generating clarification questions...');
      const questions = await generateClarificationQuestions(
        state.goal,
        message.screenshot,
        state.context,
        verification.reason
      );

      logger.info('📋 [COMPUTER-USE] Clarification questions generated', {
        count: questions.length,
        questions: questions.map(q => q.question),
      });

      if (questions.length > 0) {
        state.waitingForClarification = true;
        logger.info('📤 [COMPUTER-USE] Sending clarification to frontend', {
          questionsCount: questions.length,
        });
        ws.send(JSON.stringify({
          type: 'clarification',
          questions,
        } as ServerMessage));
        return;
      } else {
        logger.warn('⚠️ [COMPUTER-USE] No clarification questions generated, continuing execution');
      }
    }
  }

  // Check if action needs clarification
  if (nextAction.type === 'end' && nextAction.reason === 'Need clarification') {
    const questions = await generateClarificationQuestions(
      state.goal,
      message.screenshot,
      state.context
    );
    
    state.waitingForClarification = true;
    ws.send(JSON.stringify({
      type: 'clarification',
      questions,
    } as ServerMessage));
    return;
  }

  // Handle findAndClick action
  if (nextAction.type === 'findAndClick' && nextAction.locator) {
    const { strategy } = nextAction.locator;
    
    // New nut.js native strategies - send directly to frontend (no backend processing)
    if (strategy === 'text' || strategy === 'image' || strategy === 'element') {
      logger.info('🎯 [COMPUTER-USE] Sending nut.js native detection to frontend', {
        strategy,
        value: nextAction.locator.value,
        context: nextAction.locator.context,
      });

      ws.send(JSON.stringify({
        type: 'action',
        action: nextAction,
        iteration: state.iteration,
      } as ServerMessage));
      return;
    }
    
    // Legacy Vision API strategy - resolve coordinates on backend (fallback)
    if (strategy === 'vision') {
      logger.info('🔍 [COMPUTER-USE] Handling findAndClick with Vision API (fallback)', {
        description: nextAction.locator.description,
      });

      try {
        const visionResult = await callVisionAPI(
          message.screenshot,
          nextAction.locator.description!,
          state.context
        );

        // Check if coordinates are (0, 0) which indicates element not found
        if (visionResult.coordinates.x === 0 && visionResult.coordinates.y === 0) {
          logger.warn('⚠️ [COMPUTER-USE] Vision API returned (0,0) - element not found', {
            description: nextAction.locator.description,
            confidence: visionResult.confidence,
          });

          ws.send(JSON.stringify({
            type: 'action',
            action: {
              type: 'log',
              level: 'warn',
              message: `Vision API could not locate element: "${nextAction.locator.description}". Consider using text/image/element strategy instead.`,
              reasoning: 'Element not found - try native nut.js detection strategies',
            },
            iteration: state.iteration,
          } as ServerMessage));
          return;
        }

        // Element found - send findAndClick with resolved coordinates
        logger.info('✅ [COMPUTER-USE] Vision API located element', {
          description: nextAction.locator.description,
          coordinates: visionResult.coordinates,
          confidence: visionResult.confidence,
        });

        const findAndClickAction: ComputerAction = {
          type: 'findAndClick',
          locator: nextAction.locator,
          coordinates: visionResult.coordinates,
          reasoning: nextAction.reasoning,
        };

        ws.send(JSON.stringify({
          type: 'action',
          action: findAndClickAction,
          iteration: state.iteration,
        } as ServerMessage));
        return;
      } catch (error: any) {
        logger.error('❌ [COMPUTER-USE] Vision API error', {
          error: error.message,
          description: nextAction.locator?.description,
        });

        ws.send(JSON.stringify({
          type: 'error',
          error: `Vision API error: ${error.message}. Try using text/image/element strategy instead.`,
        } as ServerMessage));
        return;
      }
    }
  }

  // Send next action (for non-findAndClick actions)
  ws.send(JSON.stringify({
    type: 'action',
    action: nextAction,
    iteration: state.iteration,
  } as ServerMessage));

  // If task complete, close connection
  if (nextAction.type === 'end') {
    // Mark current goal as completed in conversation history
    if (state.conversationHistory && state.conversationHistory.length > 0) {
      state.conversationHistory[state.conversationHistory.length - 1].completed = true;
      
      // Save updated session state
      const sessionKey = `${state.context.userId || 'default'}_${state.context.sessionId || 'default'}`;
      sessionStore.set(sessionKey, state);
      
      logger.info('✅ [COMPUTER-USE] Task completed and marked in conversation history', {
        sessionKey,
        completedGoal: state.goal,
        totalGoalsInHistory: state.conversationHistory.length,
      });
    }
    
    ws.send(JSON.stringify({
      type: 'complete',
      result: {
        success: true,
        reason: nextAction.reason,
        iterations: state.iteration,
      },
    } as ServerMessage));
    ws.close();
  }
}

/**
 * Handle clarification answer - resume agentic loop
 */
async function handleClarificationAnswer(
  ws: WebSocket,
  message: WebSocketMessage,
  state: any
) {
  if (!message.answers) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Missing answers in clarification_answer message',
    } as ServerMessage));
    return state;
  }

  // Try to load session from store if not provided
  if (!state && message.context) {
    const sessionKey = `${message.context.userId || 'default'}_${message.context.sessionId || 'default'}`;
    state = sessionStore.get(sessionKey);
    logger.info('🔍 [COMPUTER-USE] Attempting to load session from store', {
      sessionKey,
      found: !!state,
    });
  }

  if (!state) {
    logger.error('❌ [COMPUTER-USE] No session state found for clarification answer', {
      hasContext: !!message.context,
      contextKeys: message.context ? Object.keys(message.context) : [],
    });
    ws.send(JSON.stringify({
      type: 'error',
      error: 'No active session found. Please start a new session.',
    } as ServerMessage));
    return state;
  }

  state.clarificationAnswers = { ...state.clarificationAnswers, ...message.answers };
  state.waitingForClarification = false;

  logger.info('✅ [COMPUTER-USE] Clarification answers received', {
    answers: state.clarificationAnswers,
    sessionKey: `${state.context.userId || 'default'}_${state.context.sessionId || 'default'}`,
  });

  // Save updated session state
  const sessionKey = `${state.context.userId || 'default'}_${state.context.sessionId || 'default'}`;
  sessionStore.set(sessionKey, state);
  
  logger.info('💾 [COMPUTER-USE] Session state saved after clarification', {
    sessionKey,
    waitingForClarification: state.waitingForClarification,
  });

  // Request screenshot to resume
  ws.send(JSON.stringify({
    type: 'action',
    action: {
      type: 'screenshot',
      reasoning: 'Resuming after clarification',
    },
    iteration: state.iteration,
  } as ServerMessage));
  
  logger.info('📸 [COMPUTER-USE] Screenshot requested to resume automation');
  
  return state;
}

/**
 * Check if goal needs clarification before starting
 */
function checkForClarification(
  goal: string,
  context: any
): { questions: ClarificationQuestion[] } {
  const goalLower = goal.toLowerCase();
  
  // Check for truly ambiguous goals that lack context
  // Examples: "click it", "open that", "go there" (without prior reference)
  const vaguePatterns = [
    /^(click|open|go to|find)\s+(it|that|there)(\s|$|\.|,)/i,  // Starts with vague command
    /^(do|execute|run)\s+(it|that)(\s|$|\.|,)/i,                // Generic action + pronoun
    /(what|where|which)\s+(is|are)\s+(it|that)/i,               // Question about unclear target
  ];
  
  const isVague = vaguePatterns.some(pattern => pattern.test(goalLower));
  
  // Only ask for clarification if goal is genuinely vague AND no active app context
  if (isVague && !context.activeApp) {
    return {
      questions: [
        {
          id: 'target_app',
          question: 'Which application should I work with?',
          options: ['Google Chrome', 'Safari', 'Firefox', 'Other'],
          required: true,
        },
      ],
    };
  }

  return { questions: [] };
}

/**
 * Verify if current UI state aligns with the goal
 */
async function verifyUIStateAlignment(
  goal: string,
  screenshot: { base64: string; mimeType: string },
  context: any,
  previousActions: ComputerAction[],
  iteration: number
): Promise<{
  aligned: boolean;
  confidence: number;
  reason?: string;
  needsClarification: boolean;
}> {
  // Skip verification for first 2 iterations (still navigating)
  if (iteration < 3) {
    return { aligned: true, confidence: 1.0, needsClarification: false };
  }

  const prompt = `You are verifying if the current UI state aligns with the user's goal.

<<GOAL>>
${goal}
<</GOAL>>

<<CONTEXT>>
Active App: ${context?.activeApp || 'unknown'}
Active URL: ${context?.activeUrl || 'unknown'}
Iteration: ${iteration}
<</CONTEXT>>

<<RECENT_ACTIONS>>
${previousActions.slice(-3).map((a, i) => `${i + 1}. ${a.type} - ${a.reasoning}`).join('\n')}
<</RECENT_ACTIONS>>

Analyze the screenshot and determine:
1. Does the current UI state align with what's needed to accomplish the goal?
2. Are we in the right application/context?
3. Is there confusion or misalignment that needs user clarification?

**CRITICAL - VISUAL FOCUS INDICATORS:**
When checking if an input field is focused, look for these SUCCESS indicators:
- ✅ **Blinking cursor visible** inside the input field (thin vertical line)
- ✅ **Text already typed** in the field (even partial text like "ff" or "a")
- ✅ **Border highlight** or color change around the field
- ✅ **Active state styling** (shadow, glow, different background)

If ANY of these are present → Field IS focused → aligned: true, needsClarification: false

Return ONLY valid JSON:
{
  "aligned": true/false,
  "confidence": 0.0-1.0,
  "reason": "explanation if not aligned",
  "needsClarification": true/false
}

Examples:
- Goal mentions ChatGPT but screenshot shows terminal → aligned: false, needsClarification: true
- Goal mentions sidebar but can't find it → aligned: false, needsClarification: false (just need to search more)
- Repeated failed clicks on same element → aligned: false, needsClarification: true
- **Cursor visible in input field** → aligned: true, needsClarification: false (field is focused!)
- **Text typed in field** (even "ff" or "a") → aligned: true, needsClarification: false (focus confirmed!)`;

  try {
    if (anthropicClient) {
      const response = await anthropicClient.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 300,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: screenshot.mimeType as any,
                  data: screenshot.base64,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
      
      // Extract JSON from response (handle cases where LLM adds explanatory text)
      let jsonStr = text;
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        jsonStr = jsonMatch[0];
      } else {
        // Fallback: remove code fences and trim
        jsonStr = text.replace(/```(?:json)?\n?/g, '').trim();
      }
      
      const result = JSON.parse(jsonStr);

      logger.info('✅ [COMPUTER-USE] UI state verification complete', {
        aligned: result.aligned,
        confidence: result.confidence,
        needsClarification: result.needsClarification,
      });

      return result;
    }
  } catch (error: any) {
    logger.error('❌ [COMPUTER-USE] UI verification failed', {
      error: error.message,
    });
  }

  // Default: assume aligned if verification fails
  return { aligned: true, confidence: 0.5, needsClarification: false };
}

/**
 * Generate clarification questions based on current state
 */
async function generateClarificationQuestions(
  goal: string,
  screenshot: { base64: string; mimeType: string },
  context: any,
  verificationReason?: string
): Promise<ClarificationQuestion[]> {
  logger.info('🔍 [CLARIFICATION] Generating questions', {
    hasReason: !!verificationReason,
    reason: verificationReason,
  });

  // Use LLM to generate clarification questions
  const reasonContext = verificationReason ? `\n\nREASON FOR CLARIFICATION:\n${verificationReason}` : '';
  const prompt = `You are analyzing a screenshot to accomplish this goal: "${goal}"${reasonContext}

The current state is ambiguous or misaligned. Generate 1-3 specific clarification questions to ask the user.

**IMPORTANT:** Always generate at least 1 question. Be specific about what you need to know.

Return ONLY valid JSON in this format:
{
  "questions": [
    {
      "id": "unique_id",
      "question": "Specific question about the current situation?",
      "options": ["Option 1", "Option 2", "Option 3"],
      "required": true
    }
  ]
}

Example questions:
- "I can't find Chrome. Should I open it from the dock or use Spotlight search?"
- "The sidebar appears closed. Should I click the hamburger menu to open it?"
- "I see multiple profiles. Which Chrome profile should I use?"`;

  try {
    if (anthropicClient) {
      logger.info('📤 [CLARIFICATION] Sending request to Claude');
      const response = await anthropicClient.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: screenshot.mimeType as any,
                  data: screenshot.base64,
                },
              },
              { type: 'text', text: prompt },
            ],
          },
        ],
      });

      const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
      logger.info('📥 [CLARIFICATION] Received response from Claude', {
        textLength: text.length,
        textPreview: text.substring(0, 200),
      });

      const cleaned = text.replace(/```(?:json)?\n?/g, '').trim();
      const result = JSON.parse(cleaned);
      
      if (result.questions && result.questions.length > 0) {
        logger.info('✅ [CLARIFICATION] Questions parsed successfully', {
          count: result.questions.length,
        });
        return result.questions;
      } else {
        logger.warn('⚠️ [CLARIFICATION] No questions in LLM response, using fallback');
      }
    } else {
      logger.warn('⚠️ [CLARIFICATION] No anthropic client available, using fallback');
    }
  } catch (error: any) {
    logger.error('❌ [CLARIFICATION] Failed to generate questions', { 
      error: error.message,
      stack: error.stack,
    });
  }

  // Fallback: context-aware question based on verification reason
  const fallbackQuestion = verificationReason 
    ? `I'm having trouble: ${verificationReason}. What should I do?`
    : 'I need help understanding what to do next. Can you provide guidance?';

  logger.info('📋 [CLARIFICATION] Using fallback question');
  return [
    {
      id: 'next_step',
      question: fallbackQuestion,
      required: true,
    },
  ];
}

/**
 * Analyze screenshot and decide next action
 */
async function analyzeAndDecide(
  goal: string,
  screenshot: { base64: string; mimeType: string },
  previousActions: ComputerAction[],
  context: any,
  provider: 'openai' | 'anthropic',
  clarificationAnswers: Record<string, string>,
  conversationHistory?: Array<{ timestamp: number; goal: string; completed: boolean }>,
  completedMilestones?: Set<string>
): Promise<ComputerAction> {
  const prompt = buildPrompt(goal, previousActions, context, clarificationAnswers, conversationHistory, completedMilestones);

  // Try OpenAI first, fallback to Claude
  if (provider === 'openai' && openaiClient) {
    return await analyzeWithOpenAI(prompt, screenshot);
  } else if (provider === 'anthropic' && anthropicClient) {
    return await analyzeWithAnthropic(prompt, screenshot);
  } else if (openaiClient) {
    // Fallback to OpenAI if provider not specified
    return await analyzeWithOpenAI(prompt, screenshot);
  } else if (anthropicClient) {
    // Fallback to Claude if OpenAI not available
    return await analyzeWithAnthropic(prompt, screenshot);
  }

  throw new Error('No LLM provider available');
}

function buildPrompt(
  goal: string,
  previousActions: ComputerAction[],
  context: any,
  clarificationAnswers: Record<string, string>,
  conversationHistory?: Array<{ timestamp: number; goal: string; completed: boolean }>,
  completedMilestones?: Set<string>
): string {
  // Collect all previous reasoning text to filter from screenshot analysis
  const previousReasoningTexts = previousActions
    .filter(a => a.reasoning)
    .map(a => a.reasoning as string);
  // Deterministic delimiters for user input (prevents injection)
  const userGoal = `<<USER_GOAL>>
${goal}
<</USER_GOAL>>`;
  
  // Conversation history section
  let conversationHistorySection = '';
  if (conversationHistory && conversationHistory.length > 1) {
    conversationHistorySection = '\n\n=== CONVERSATION HISTORY ===';
    conversationHistorySection += '\n**CRITICAL**: You have context from previous interactions in this session:';
    conversationHistory.slice(0, -1).forEach((entry, i) => {
      const timeAgo = Math.floor((Date.now() - entry.timestamp) / 1000);
      conversationHistorySection += `\n${i + 1}. [${timeAgo}s ago] "${entry.goal}" ${entry.completed ? '✅ COMPLETED' : '⏳ IN PROGRESS'}`;
    });
    conversationHistorySection += '\n\n**When user says "previous task" or "fulfill the previous task", they are referring to the goals listed above.**';
    conversationHistorySection += '\n**Use this context to understand what the user is asking you to do.**';
  }
  
  // Single source of truth for OS
  const os = context?.os || 'unknown';
  
  // Build context section
  let contextSection = '\n\n=== CONTEXT ===';
  contextSection += `\n- Active App: ${context?.activeApp || 'unknown'}`;
  contextSection += `\n- Active URL: ${context?.activeUrl || 'unknown'}`;
  contextSection += `\n- OS: ${os}`;
  contextSection += `\n- Screen Resolution: ${context?.screenWidth && context?.screenHeight ? `${context.screenWidth}x${context.screenHeight}` : 'unknown'}`;
  contextSection += `\n- Screenshot Dimensions: ${context?.screenshotWidth && context?.screenshotHeight ? `${context.screenshotWidth}x${context.screenshotHeight}` : 'unknown'}`;
  
  // Add reasoning filter section
  let reasoningFilterSection = '';
  if (previousReasoningTexts.length > 0) {
    reasoningFilterSection = '\n\n=== 🚨 CRITICAL - IGNORE YOUR OWN REASONING TEXT 🚨 ===';
    reasoningFilterSection += '\n**The screenshot may contain notification popups showing YOUR previous reasoning text.**';
    reasoningFilterSection += '\n**This is NOT actual UI content - it is just your own thoughts being displayed back to you.**';
    reasoningFilterSection += '\n\n**IGNORE the following text if you see it in the screenshot:**';
    previousReasoningTexts.slice(-5).forEach((reasoning, i) => {
      reasoningFilterSection += `\n${i + 1}. "${reasoning}"`;
    });
    reasoningFilterSection += '\n\n**CRITICAL RULES:**';
    reasoningFilterSection += '\n- If you see text matching your previous reasoning → IGNORE IT';
    reasoningFilterSection += '\n- Do NOT use your own reasoning text as evidence of what happened in the UI';
    reasoningFilterSection += '\n- ONLY look at the ACTUAL UI elements (input fields, buttons, messages, etc.)';
    reasoningFilterSection += '\n- Notification popups showing "AI Thinking" are NOT part of the application UI';
    reasoningFilterSection += '\n- **NEVER try to click on automation popups** - they are not clickable UI elements';
    reasoningFilterSection += '\n- Automation popups are overlays that show YOUR reasoning - look PAST them to the real UI';
    reasoningFilterSection += '\n- **NEVER copy files instead of code content** - you are working with code, not files';
    reasoningFilterSection += '\n- **ALWAYS look for code content in the UI** - do not assume it is a file';
    reasoningFilterSection += '\n\n**Example of WRONG behavior:**';
    reasoningFilterSection += '\n- ❌ "I can see that the text selection was successful (Cmd+A was pressed in the previous action)"';
    reasoningFilterSection += '\n- ❌ Reading notification text that says "typing this is cool" and assuming it was typed';
    reasoningFilterSection += '\n\n**Example of CORRECT behavior:**';
    reasoningFilterSection += '\n- ✅ "I see a notification popup with my reasoning, but looking at the ACTUAL input field, I see only placeholder text"';
    reasoningFilterSection += '\n- ✅ "I see a notification popup with my reasoning, but looking at the ACTUAL code content, I see the correct code"';
    reasoningFilterSection += '\n- ✅ "Ignoring the notification popup, the input field shows \'[exact text]\' or placeholder only"';
  }
  
  // UI change detection
  if (context?.uiChanged !== undefined) {
    contextSection += `\n- UI Changed Since Last Action: ${context.uiChanged ? 'YES ✅' : 'NO ⚠️'}`;
    if (!context.uiChanged && context.unchangedCount > 0) {
      contextSection += `\n- **CRITICAL**: UI has been UNCHANGED for ${context.unchangedCount} iterations`;
      contextSection += `\n- **This means**: Your last action either (1) already succeeded, or (2) had no effect`;
      contextSection += `\n- **What to do**: Look carefully at the screenshot - did the previous action already complete?`;
      contextSection += `\n- **Example**: If you tried to send a message and UI unchanged → message was likely already sent, move on`;
    }
  }
  
  // Milestone tracking section
  let milestonesSection = '';
  if (completedMilestones && completedMilestones.size > 0) {
    milestonesSection = '\n\n=== ✅ COMPLETED MILESTONES (DO NOT REDO) ✅ ===';
    milestonesSection += '\n**The following sub-tasks have been COMPLETED. DO NOT repeat them:**';
    const milestones = Array.from(completedMilestones);
    milestones.forEach((milestone, i) => {
      let description = milestone;
      
      // Generic milestone descriptions
      if (milestone === 'input_field_focused') {
        description = 'Input field is focused (single character was typed and appeared)';
      } else if (milestone === 'test_char_deleted') {
        description = 'Test character was deleted/selected (field is ready for content)';
      } else if (milestone === 'content_typed') {
        description = 'Content has been typed (message/search/text entered)';
      } else if (milestone === 'content_submitted') {
        description = 'Content has been submitted (Enter was pressed)';
      } else if (milestone === 'url_opened') {
        description = 'URL has been opened in browser';
      } else if (milestone.startsWith('app_focused_')) {
        const appName = milestone.replace('app_focused_', '');
        description = `${appName} app has been focused and opened`;
      }
      
      milestonesSection += `\n${i + 1}. ✅ ${description}`;
    });
    milestonesSection += '\n\n**🚨 CRITICAL ANTI-LOOP RULES 🚨**';
    milestonesSection += '\n- DO NOT click the input field again if "input_field_focused" is completed';
    milestonesSection += '\n- DO NOT type a single test character again if "input_field_focused" is completed';
    milestonesSection += '\n- DO NOT delete/select test character again if "test_char_deleted" is completed';
    milestonesSection += '\n- DO NOT type the content again if "content_typed" is completed';
    milestonesSection += '\n- DO NOT press Enter again if "content_submitted" is completed';
    milestonesSection += '\n- DO NOT focus the same app again if "app_focused_[name]" is completed';
    milestonesSection += '\n\n**NEXT STEP LOGIC:**';
    if (milestones.includes('content_submitted')) {
      milestonesSection += '\n- ✅ Content submitted → Next: Continue with remaining goal steps or quit app';
    } else if (milestones.includes('content_typed')) {
      milestonesSection += '\n- ✅ Content typed → Next: Press Enter to submit (if required by goal)';
    } else if (milestones.includes('test_char_deleted')) {
      milestonesSection += '\n- ✅ Test char deleted → Next: Type the full content';
    } else if (milestones.includes('input_field_focused')) {
      milestonesSection += '\n- ✅ Field focused → Next: Delete test character (Backspace or Cmd+A)';
    }
    milestonesSection += '\n\n**DO NOT GO BACKWARDS. ONLY MOVE FORWARD TO THE NEXT STEP.**';
    milestonesSection += '\n**If a milestone is completed, that step is DONE. Move to the next step in your goal.**';
  }
  
  // Clarification answers section
  let clarificationSection = '';
  if (Object.keys(clarificationAnswers).length > 0) {
    clarificationSection = '\n\n=== CLARIFICATION ANSWERS ===';
    for (const [q, a] of Object.entries(clarificationAnswers)) {
      clarificationSection += `\n- ${q}: ${a}`;
    }
  }
  
  // Previous actions section
  let previousActionsSection = '';
  if (previousActions.length > 0) {
    previousActionsSection = '\n\n=== PREVIOUS ACTIONS ===';
    previousActions.forEach((a, i) => {
      previousActionsSection += `\n${i + 1}. ${a.type} - ${a.reasoning || 'No reasoning'}`;
    });
  }
  
  // Detect if stuck
  const lastFiveActions = previousActions.slice(-5);
  const findAndClickAttempts = lastFiveActions.filter(a => a.type === 'findAndClick');
  const isFindingElement = findAndClickAttempts.length >= 3;
  
  const lastThreeActions = previousActions.slice(-3);
  const isStuck = lastThreeActions.length === 3 && 
    lastThreeActions.every(a => a.type === lastThreeActions[0].type && 
                                 JSON.stringify(a.locator) === JSON.stringify(lastThreeActions[0].locator));
  
  // Detect repeated clicking on menu bar or same wrong element
  const lastFourClicks = previousActions.slice(-4).filter(a => a.type === 'findAndClick');
  const isClickingWrongElement = lastFourClicks.length >= 3;
  
  let stuckWarning = '';
  if (isStuck || isFindingElement || isClickingWrongElement) {
    stuckWarning = '\n\n=== WARNING: STUCK DETECTION ===';
    if (isStuck) {
      stuckWarning += '\n- Same action repeated 3 times';
      stuckWarning += '\n- Consider: pause for page load, try different approach, or end if truly stuck';
    }
    if (isFindingElement || isClickingWrongElement) {
      stuckWarning += `\n- ${findAndClickAttempts.length} findAndClick attempts in last 5 actions`;
      stuckWarning += '\n- **CRITICAL**: If clicking menu bar text or wrong elements repeatedly:';
      stuckWarning += '\n  * STOP using findAndClick for this element';
      stuckWarning += '\n  * Try keyboard shortcuts instead (Cmd+N for new file, Cmd+Space for Spotlight, etc.)';
      stuckWarning += '\n  * Try focusApp to bring window forward';
      stuckWarning += '\n  * For "open TextEdit": Use Cmd+Space, type "TextEdit", press Enter';
      stuckWarning += '\n- Check: Is sidebar collapsed? Need to expand? Need to scroll? Try different approach?';
    }
  }

  // Add mandatory focus check for input field interactions
  let focusCheckSection = '';
  const lastAction = previousActions[previousActions.length - 1];
  const lastTwoActions = previousActions.slice(-2);
  
  // Check if we just typed a test character
  const justTypedTestChar = lastAction?.type === 'typeText' && 
                            lastAction.text?.length === 1 && 
                            lastAction.reasoning?.toLowerCase().includes('test');
  
  if (justTypedTestChar) {
    focusCheckSection = '\n\n=== ⚠️ TEST CHARACTER CLEANUP REQUIRED ===';
    focusCheckSection += '\n**You just typed a test character to verify focus.**';
    focusCheckSection += '\n\n**MANDATORY NEXT STEPS:**';
    focusCheckSection += '\n1. **LOOK at the screenshot**: Did the test character appear in the field?';
    focusCheckSection += '\n   - **READ what you see** - is the test character visible?';
    focusCheckSection += '\n   - **DO NOT assume** it appeared - VERIFY with your eyes!';
    focusCheckSection += '\n2. **If YES (field is focused):**';
    focusCheckSection += '\n   - ✅ **DELETE the test character first** (press Backspace OR Cmd+A then type)';
    focusCheckSection += '\n   - ✅ **VERIFY deletion**: Next screenshot should show empty field or only your new text';
    focusCheckSection += '\n   - ✅ Then type the full message';
    focusCheckSection += '\n   - ✅ **VERIFY typing**: Next screenshot MUST show the full text you typed';
    focusCheckSection += '\n   - ✅ **CRITICAL**: Do NOT type the full message without deleting the test character first!';
    focusCheckSection += '\n3. **If NO (field not focused):**';
    focusCheckSection += '\n   - ❌ Click the field again with adjusted coordinates';
    focusCheckSection += '\n\n**EXAMPLE WORKFLOW:**';
    focusCheckSection += '\n- Test char "a" appeared → Press Backspace → **VERIFY "a" is gone** → Type "this is cool" → **VERIFY "this is cool" appears** → Result: "this is cool" ✅';
    focusCheckSection += '\n- Test char "a" did NOT appear → Field not focused → Click field again ❌';
    focusCheckSection += '\n\n**🚨 ANTI-HALLUCINATION RULE 🚨**';
    focusCheckSection += '\n- **NEVER say text was typed unless you SEE it in the screenshot**';
    focusCheckSection += '\n- **NEVER say text was deleted unless you SEE it gone in the screenshot**';
    focusCheckSection += '\n- If screenshot shows placeholder text only → Text was NOT typed';
    focusCheckSection += '\n- If screenshot shows test character still there → It was NOT deleted';
  }
  
  // Check if we just clicked an input field
  else if (lastAction?.type === 'findAndClick' && lastAction.reasoning?.toLowerCase().includes('input')) {
    focusCheckSection = '\n\n=== ⚠️ MANDATORY FOCUS VERIFICATION ===';
    focusCheckSection += '\n**CRITICAL**: Screenshots lose subtle focus indicators (thin borders, cursor) due to compression.';
    focusCheckSection += '\n**DO NOT rely on visual detection alone.**';
    focusCheckSection += '\n\n**REQUIRED ACTION AFTER CLICKING INPUT FIELD:**';
    focusCheckSection += '\n1. **First check**: Look for OBVIOUS indicators:';
    focusCheckSection += '\n   - ✅ Text already typed in the field (even 1 character like "a")';
    focusCheckSection += '\n   - ✅ Placeholder text completely gone/replaced';
    focusCheckSection += '\n   - ✅ Very obvious border color change (bright blue, thick outline)';
    focusCheckSection += '\n\n2. **If NO obvious indicators visible:**';
    focusCheckSection += '\n   - ✅ **TYPE A SINGLE TEST CHARACTER** (e.g., "a") to verify focus';
    focusCheckSection += '\n   - ✅ Check next screenshot: Did the "a" appear in the field?';
    focusCheckSection += '\n   - ✅ If YES → **DELETE IT FIRST** (Backspace), then type the full message';
    focusCheckSection += '\n   - ✅ If NO → Click the field again with adjusted coordinates';
    focusCheckSection += '\n\n**DO NOT:**';
    focusCheckSection += '\n❌ Click the same field repeatedly without testing';
    focusCheckSection += '\n❌ Assume focus based on subtle visual changes you cannot clearly see';
    focusCheckSection += '\n❌ Look for "blinking cursor" or "thin border" - these are invisible in screenshots';
    focusCheckSection += '\n❌ Type full message without deleting test character first';
    focusCheckSection += '\n\n**NEXT ACTION MUST BE:** Type a single test character OR type the full text if obvious indicators present';
  }
  
  // Check if we're stuck clicking the same input field repeatedly
  if (lastTwoActions.length === 2 && 
      lastTwoActions.every(a => a.type === 'findAndClick' && a.reasoning?.toLowerCase().includes('input'))) {
    focusCheckSection += '\n\n**⚠️ WARNING: REPEATED INPUT FIELD CLICKING DETECTED**';
    focusCheckSection += '\n- You clicked the input field 2+ times without testing focus';
    focusCheckSection += '\n- **STOP CLICKING** and **START TYPING** to test if field is focused';
    focusCheckSection += '\n- Type a single "a" character now to verify focus';
  }
  
  // Check if we just quit an app (task completion detection)
  const justQuitApp = lastAction?.type === 'pressKey' && 
                      lastAction.key === 'Q' && 
                      lastAction.modifiers?.includes('Cmd');
  
  let taskCompletionSection = '';
  if (justQuitApp) {
    taskCompletionSection = '\n\n=== 🎯 TASK COMPLETION CHECK ===';
    taskCompletionSection += '\n**You just pressed Cmd+Q to quit an application.**';
    taskCompletionSection += '\n\n**CRITICAL - Check if task is complete:**';
    taskCompletionSection += '\n1. **Review the goal**: What app did the user want you to work with?';
    taskCompletionSection += '\n2. **Check your actions**: Did you complete all required steps in that app?';
    taskCompletionSection += '\n3. **If YES - Task is complete:**';
    taskCompletionSection += '\n   - ✅ Return { "type": "end", "reasoning": "Successfully completed: [summary of what you did]" }';
    taskCompletionSection += '\n   - ✅ DO NOT try to quit other applications';
    taskCompletionSection += '\n   - ✅ DO NOT continue working - the task is done';
    taskCompletionSection += '\n4. **If NO - More work needed:**';
    taskCompletionSection += '\n   - ❌ Continue with the next step in the goal';
    taskCompletionSection += '\n\n**EXAMPLE:**';
    taskCompletionSection += '\n- Goal: "Open Slack, send message, quit app"';
    taskCompletionSection += '\n- You: Opened Slack → Sent message → Pressed Cmd+Q';
    taskCompletionSection += '\n- **CORRECT**: Return "end" action (task complete!)';
    taskCompletionSection += '\n- **WRONG**: Try to quit other apps like terminal, browser, etc.';
    taskCompletionSection += '\n\n**ONLY quit the app mentioned in the goal. Do not quit other apps!**';
  }

  // Self-awareness section - force LLM to analyze current state
  let selfAwarenessSection = '\n\n=== 🧠 SELF-AWARENESS & ACTION VERIFICATION ===';
  selfAwarenessSection += '\n**Before deciding your next action, you MUST explicitly state:**';
  selfAwarenessSection += '\n\n1. **CURRENT STATE ANALYSIS:**';
  selfAwarenessSection += '\n   - "In this screenshot, I see: [describe what you actually see]"';
  selfAwarenessSection += '\n   - "The current UI state is: [describe app, page, focused element, etc.]"';
  selfAwarenessSection += '\n   - "My last action was: [state previous action if any]"';
  selfAwarenessSection += '\n   - "The result of my last action: [did it work? what changed?]"';
  selfAwarenessSection += '\n\n2. **GOAL ALIGNMENT CHECK:**';
  selfAwarenessSection += '\n   - "My overall goal is: [restate the user\'s goal]"';
  selfAwarenessSection += '\n   - "The next step to achieve this goal is: [what needs to happen next]"';
  selfAwarenessSection += '\n   - "Progress so far: [list completed steps]"';
  selfAwarenessSection += '\n   - "Remaining steps: [list what still needs to be done]"';
  selfAwarenessSection += '\n\n3. **NEXT ACTION REASONING:**';
  selfAwarenessSection += '\n   - "I am about to: [describe the action you will take]"';
  selfAwarenessSection += '\n   - "This action will: [explain what this action should accomplish]"';
  selfAwarenessSection += '\n   - "After this action, I expect to see: [predict what the next screenshot will show]"';
  selfAwarenessSection += '\n   - "This moves me toward the goal because: [explain how this helps]"';
  selfAwarenessSection += '\n\n4. **VERIFICATION CHECKLIST:**';
  selfAwarenessSection += '\n   - ✅ Have I looked at the ACTUAL screenshot (not assumptions)?';
  selfAwarenessSection += '\n   - ✅ Am I ignoring automation popups showing my own reasoning?';
  selfAwarenessSection += '\n   - ✅ Is this action moving FORWARD (not repeating completed steps)?';
  selfAwarenessSection += '\n   - ✅ Do I have a clear expectation of what should happen next?';
  selfAwarenessSection += '\n   - ✅ Am I working on the user\'s goal (not getting distracted)?';
  selfAwarenessSection += '\n\n**CRITICAL RULES:**';
  selfAwarenessSection += '\n- **NEVER assume** an action succeeded without seeing visual confirmation';
  selfAwarenessSection += '\n- **ALWAYS describe** what you see in the current screenshot before acting';
  selfAwarenessSection += '\n- **ALWAYS predict** what you expect to see after your action';
  selfAwarenessSection += '\n- **ALWAYS verify** your prediction matches reality in the next screenshot';
  selfAwarenessSection += '\n- If your prediction was WRONG → Adjust your approach, don\'t repeat the same action';
  selfAwarenessSection += '\n\n**EXAMPLE OF GOOD SELF-AWARENESS:**';
  selfAwarenessSection += '\n```';
  selfAwarenessSection += '\nCurrent State: I see Windsurf IDE with capabilities.ts file highlighted in sidebar.';
  selfAwarenessSection += '\nGoal: Copy code from capabilities.ts and paste in ChatGPT.';
  selfAwarenessSection += '\nNext Action: Click capabilities.ts to open it in the editor.';
  selfAwarenessSection += '\nExpected Result: File will open in center panel showing code content.';
  selfAwarenessSection += '\nReasoning: I need to open the file before I can select and copy the code.';
  selfAwarenessSection += '\n```';
  selfAwarenessSection += '\n\n**EXAMPLE OF BAD BEHAVIOR (NO SELF-AWARENESS):**';
  selfAwarenessSection += '\n```';
  selfAwarenessSection += '\n❌ "Clicking the file" (no description of current state)';
  selfAwarenessSection += '\n❌ "The file is now open" (assumption without verification)';
  selfAwarenessSection += '\n❌ "Copying the code" (no prediction of what should happen)';
  selfAwarenessSection += '\n```';
  selfAwarenessSection += '\n\n**Your reasoning field MUST include this self-awareness analysis!**';
  selfAwarenessSection += '\n\n**REASONING FORMAT** (human-readable):';
  selfAwarenessSection += '\n- Keep reasoning clear and structured';
  selfAwarenessSection += '\n- Use bullet points or short paragraphs';
  selfAwarenessSection += '\n- State what you see, what you\'re doing, and why';
  selfAwarenessSection += '\n- Example: "I see the ChatGPT input field centered on screen. I will click it to focus, then type the question. This is the first step in comparing ChatGPT vs Perplexity."';

  return `You are a desktop automation agent.

${userGoal}${conversationHistorySection}${contextSection}${milestonesSection}${reasoningFilterSection}${clarificationSection}${previousActionsSection}${focusCheckSection}${taskCompletionSection}${stuckWarning}${selfAwarenessSection}

=== CONTRACT ===

OUTPUT FORMAT: Return ONLY valid JSON. No markdown. No explanations. No code fences.

SCHEMA:
- Action fields: type (enum), reasoning (string), plus type-specific fields
- type MUST be one of the allowed action types
- reasoning MUST explain why this action moves toward the goal

ENUMS (single source of truth):
- type: focusApp | openUrl | typeText | scroll | pause | screenshot | findAndClick | pressKey | waitForElement | log | end
- OS: ${os}

**NOTE**: click action is DEPRECATED and removed - use findAndClick instead

=== DECISION RULES ===

**🚨 CRITICAL - IGNORE AUTOMATION POPUPS 🚨**
- **NEVER click on popups showing "AI Thinking" or automation status**
- These popups display YOUR OWN reasoning text - they are NOT part of the application UI
- They appear as overlays with text like "I need to click...", "Typing...", etc.
- **COMPLETELY IGNORE these popups** - they are not clickable and not part of your task
- Only interact with the ACTUAL application UI elements (buttons, inputs, menus, etc.)
- If you see a popup with your previous reasoning → Look PAST it to the real UI underneath

**🚨 CRITICAL - COPYING CODE vs FILES 🚨**
- **When goal says "copy code" or "copy file contents":**
  1. ✅ Click the file in sidebar to OPEN it in the editor (center panel)
  2. ✅ Wait for file to load in editor
  3. ✅ Select all code: pressKey "A" with modifiers ["Cmd"]
  4. ✅ Copy code: pressKey "C" with modifiers ["Cmd"]
  5. ✅ This copies the CODE CONTENT, not the file path
                                                                                                                 
- **WRONG workflow (copies file path, not code):**
  - ❌ Click file in sidebar → Cmd+C → Only copies file path like "src/file.ts"
  - ❌ Right-click file → Copy → Only copies file path

- **CORRECT workflow (copies code content):**
  - ✅ Click file in sidebar → File opens in editor → Cmd+A → Cmd+C → Copies actual code
  - ✅ Verify: After Cmd+A, you should see ALL text in editor highlighted/selected
  - ✅ Verify: After Cmd+C, the code content is in clipboard (not just filename)

- **Key distinction:**
  - Sidebar file tree = File management (clicking copies file path)
  - Editor center panel = Code viewing (selecting + copying gets code content)
  - **ALWAYS open file in editor before copying if goal mentions "code" or "contents"**

BLOCKING SCREENS (HIGHEST PRIORITY):
- Profile selection screen → Click ANY profile (first one is fine) to proceed
- **Login/authentication screen → { "type": "end", "reason": "Need user input: login required", "reasoning": "..." }**
- **NEVER hallucinate credentials** - if login is required, end and ask user to login first
- Only AFTER clearing blocking screens can you proceed with main goal

NAVIGATION:
- Goal mentions app (ChatGPT, Slack, etc.) + on profile screen → Click profile FIRST, then focusApp
- Goal mentions app + on desktop → focusApp directly
- Web task + activeUrl matches target domain → Skip openUrl, use focusApp
- Web task + activeUrl mismatch or missing → Use openUrl first
- Desktop app task → Use focusApp (automatically fullscreens)

UI STATE CHANGES:
- After clicking toggles/buttons that change UI → Add pause (1000-1500ms) to verify
- Never assume success without verification
- Sidebar collapsed → Click hamburger menu (☰) to expand before searching
- List truncated → Look for "See More" button or scroll

=== SPATIAL CONTEXT ===

1. **Pixel-Accurate Coordinates**:
   - **CRITICAL**: The screenshot you're analyzing has EXACT dimensions (Screenshot Dimensions in context)
   - **Coordinate System**: Return coordinates in PIXELS relative to the screenshot image
     * (0, 0) = top-left corner of the screenshot
     * (Screenshot Width, Screenshot Height) = bottom-right corner
     * Example: If screenshot is 1440x900, valid coordinates are 0-1440 for X, 0-900 for Y
   - **Precision**: Count pixels carefully - your coordinates will be used for mouse clicks
   
   - **CRITICAL - Fullscreen Strategy**:
     * **focusApp automatically fullscreens the application** - no separate fullscreen action needed
     * This eliminates desktop background noise and prevents confusion with desktop folders
     * After focusApp, the entire screenshot will be the application UI (no desktop folders visible)
     * Example flow: focusApp → findAndClick (sidebar item)
   
   - **CRITICAL - Desktop vs Application Context (Multi-Layer UI)**:
     * The screenshot may show a FULL DESKTOP with multiple UI layers:
       1. **Desktop Background** (wallpaper, bottom layer)
       2. **Desktop Folders/Icons** (typically right side - blue/colored folder icons)
       3. **OS Menu Bar** (top of screen - system menu)
       4. **Dock/Taskbar** (bottom/side - app launcher icons)
       5. **Application Window** (browser, desktop app - contains the target interface)
       6. **Web/App Interface** (the actual application UI - INSIDE the window)
     
     * **CRITICAL DISTINCTION - Desktop Files vs Application Content**:
       → Desktop folders/files = OS-level icons (usually on right/desktop background)
       → Application content = UI elements INSIDE the application window
       → **NEVER confuse desktop folders with application UI elements**
       → If goal mentions "sidebar", "panel", "project", "conversation" → Look INSIDE the application window
     
     * **When Uncertain About UI Layout**:
       → **STOP and use self-learning** (Google Image Search for "[app name] interface screenshot")
       → Don't guess - verify what you're looking for before taking action
       → If you can't find an element after 2 attempts, acknowledge uncertainty and search for visual reference

2. **Common UI Patterns** (works for ChatGPT, Claude, Grok, Perplexity, Gemini, etc.):
   - **Collapsed Sidebar**: If sidebar is collapsed (narrow ~50px), look for hamburger menu (☰) icon to expand it first
   - **Conversation/Project Lists**: Usually in left sidebar (0-300px from left edge when expanded)
   - **"See More" / "Show More" Buttons**: Conversation lists often truncate - look for expand buttons at bottom of list
   - **Scrollable Lists**: If element not visible, try scrolling in the sidebar area before giving up
   - **Chat Input**: Usually at bottom center of screen
   - **Send Button**: Adjacent to input field (right side or below)
   - **Settings/Profile**: Usually top-right corner
   - **New Chat/Conversation**: Usually top-left or in sidebar header
   - **Search**: Usually top bar or sidebar header

3. **Sequential Task Execution**:
   - Break multi-step goals into logical sequence
   - **CRITICAL - Application Navigation Flow**:
     → **Step 0 (MANDATORY)**: If goal mentions an app (ChatGPT, Slack, etc.) and you're NOT in that app → Use focusApp FIRST
     → **Why**: focusApp automatically fullscreens the app, eliminating desktop folder confusion
     → **Example**: Goal mentions "ChatGPT" → First action MUST be focusApp with appName: "Google Chrome"
   - Example: "Find project X in ChatGPT and ask about Y"
     → Step 0: If on Chrome profile selection → Select ANY profile (first one is fine) to get into Chrome
     → Step 1: focusApp (Google Chrome) - triggers fullscreen automatically
     → Step 2: openUrl (https://chat.openai.com) if not already on ChatGPT
     → Step 3: Check if sidebar is expanded (if collapsed, click hamburger menu)
     → Step 4: Locate project in sidebar/list
     → Step 5: Click to open it
     → Step 6: Wait for content to load (pause 2-3s)
     → Step 7: Click input field
     → Step 8: Type query
     → Step 9: Submit
   - Never skip steps or assume state changes happened without verification
   - **CRITICAL**: If you're on a profile/login screen, you CANNOT proceed with the main goal until you complete the profile/login flow

4. **Smart Navigation Decision-Making**:
   - **CRITICAL - Profile/Login Screens**: If you see a profile selection or login screen:
     * This means you're NOT yet in the app - complete the login/profile selection FIRST
     * Select the appropriate profile/account
     * THEN use focusApp to fullscreen the app
     * Example: Chrome profile selection → Click profile → focusApp (Google Chrome) → Navigate to ChatGPT
   
   - **MANDATORY FIRST ACTION**: If goal mentions specific app (ChatGPT, Claude, Slack, etc.) and you're on desktop or profile screen → Navigate to that app first
     * If on profile selection → Select profile FIRST, then focusApp
     * If on desktop → focusApp directly
   
   - If goal mentions "sidebar", "panel", "conversation", "project" → Look INSIDE the active app window, not desktop
   - **CRITICAL - Check Sidebar State First**: Before searching for items in sidebar, verify if sidebar is expanded or collapsed
     * Collapsed sidebar = narrow vertical bar (~50px wide) with only icons
     * Expanded sidebar = wide panel (~250-300px) showing full conversation/project names
     * If collapsed, MUST click hamburger menu (☰) icon first to expand before searching for items
   - **Check for Truncated Lists**: If sidebar is expanded but item not visible, look for:
     * "See More" / "Show More" button at bottom of list
     * Scroll indicator or scrollable area
     * Try scrolling down in the sidebar before assuming item doesn't exist
   - If UI hasn't changed after 3 identical actions → Try different approach or acknowledge limitation

5. **Vision-Based Element Location**:
   - **CRITICAL**: ALWAYS specify the application context in your description
   - **WRONG**: "project folder in the right sidebar" (ambiguous - could be desktop folder!)
   - **CORRECT**: "project item in the [app name] left sidebar conversation list"
   - **Template**: "[element name] in the [app name] [specific UI area]"
   - Examples:
     * "Send button in the [app name] message input area at the bottom"
     * "New conversation button in the [app name] left sidebar header"
     * "Settings icon in the [app name] top-right corner"
   - If element not found (0,0 coordinates) → Try broader description or different strategy
   - **NEVER use generic terms like "sidebar" or "panel" without specifying the application name**

6. **Application-Specific Adaptability**:
   - AI Chat Apps (ChatGPT, Claude, Grok, Gemini, Perplexity): Sidebar for history, input field location VARIES
   - Email Apps: Left panel for folders, center for message list, right for preview
   - Browsers: Top for tabs/address bar, main area for content
   - Code Editors: Left for file tree, center for editor, right for panels
   - **CRITICAL**: Adapt your approach based on what you SEE in the screenshot, not assumptions
   
   **🚨 CRITICAL - ADAPTIVE UI POSITIONING IN CHAT APPS 🚨**
   - **NEVER assume input field is at the bottom** - UI layout changes based on context:
     * Empty/new chat → Input field is CENTERED vertically on page (middle of screen)
     * Active conversation → Input field is at BOTTOM of screen
     * Different apps have different layouts
   
   - **REQUIRED WORKFLOW - Locating Input Fields**:
     1. ✅ **LOOK at the screenshot** - Where is the input field actually located?
     2. ✅ **DESCRIBE the position** - "I see the input field at [top/middle/bottom] of screen"
     3. ✅ **USE VISION API** - Never assume coordinates, use findAndClick with vision strategy
     4. ✅ **VERIFY after click** - Check if field is focused before typing
   
   - **WRONG behavior (assumption-based):**
     * ❌ "Input field is at bottom" (assumption without looking)
     * ❌ "Clicking at coordinates (500, 800)" (hardcoded bottom position)
     * ❌ "The input field should be here" (should ≠ is)
   
   - **CORRECT behavior (observation-based):**
     * ✅ "I see the input field centered at approximately Y=310 in the screenshot"
     * ✅ "Using vision API to locate 'Ask anything' input field"
     * ✅ "The input field is in the middle of the screen, not at the bottom"
   
   - **Examples of UI variations:**
     * ChatGPT new chat: Input centered with "What's on the agenda today?"
     * ChatGPT conversation: Input at bottom with previous messages above
     * Claude new chat: Input centered with prompt suggestions
     * Slack: Input always at bottom of channel
   
   **CRITICAL - Message Submission in Chat Apps**:
   - **ALWAYS use Enter key to send messages** in chat applications (Slack, Discord, Teams, etc.)
   - **DO NOT click send buttons** - they are unreliable and harder to locate accurately
   - After typing a message in a focused input field → Press Enter to send
   - Example workflow: Click input → Type message → Press Enter (NOT click send button)
   - This applies to: Slack, Discord, Microsoft Teams, WhatsApp Web, Telegram, etc.
   - Only click send buttons if Enter key explicitly fails after 2 attempts

7. **SELF-LEARNING CAPABILITY** (Meta-Cognitive Enhancement):
   **CRITICAL**: Before making assumptions about unfamiliar UI elements, VERIFY your understanding.
   
   **Triggers for Self-Learning** (use Google Image Search):
   - ✅ Can't find an element after 2 attempts with different descriptions
   - ✅ Unfamiliar application interface (never seen it before)
   - ✅ Ambiguous UI terminology in the goal ("sidebar", "panel" in unfamiliar app)
   - ✅ Uncertain about where specific features are located
   - ✅ Making assumptions about UI layout without visual confirmation
   
   **Self-Learning Process**:
   1. **Recognize uncertainty**: "I'm not certain where [element] is in [app name]"
   2. **Navigate to Google Images**: openUrl → "https://www.google.com/imghp"
   3. **Search**: "[app name] [element] screenshot" (e.g., "Perplexity sidebar screenshot")
   4. **Analyze results**: Take screenshot, review UI layout
   5. **Return to task**: Navigate back to target app
   6. **Apply knowledge**: Use verified understanding to locate element
   
   **Additional Self-Learning Options**:
   - **Concepts/APIs**: Search web or ask AI for definitions
   - **Current events**: Google search for recent information
   - **Technical terms**: Look up documentation or examples
   
   **Important**: 
   - Self-learning is REQUIRED when uncertain, not optional
   - Don't guess UI locations - verify first
   - This prevents wasted iterations on incorrect assumptions

8. **VISUAL FOCUS DETECTION & TRIAL-AND-ERROR TESTING** (Human-Like Debugging):
   **CRITICAL**: When interacting with input fields, OBSERVE visual indicators like a human would:
   
   **Visual Focus Indicators to Look For**:
   - ✅ **Blinking cursor** visible inside the input field (thin vertical line)
   - ✅ **Border highlight** or color change (e.g., blue border when focused)
   - ✅ **Placeholder text dimmed** or changed appearance when focused
   - ✅ **Active state styling** (shadow, glow, different background color)
   
   **Trial-and-Error Testing When Uncertain**:
   - If you clicked an input field but UNSURE if it's focused:
     * **Test 1**: Type a single test character (e.g., "a") and observe if it appears
     * **Test 2**: Look for cursor blinking in the next screenshot
     * **Test 3**: Check if placeholder text behavior changed
   
   - If first click doesn't work (no visual change):
     * **Adjust coordinates**: Try clicking ±10-20px in different directions
     * **Example**: First click at (500, 778) failed → Try (510, 778), then (500, 788)
     * **Observe result**: Check each screenshot for cursor/focus indicators
   
   - If element found but click seems off:
     * **Don't repeat same coordinates** - adjust position slightly
     * **Try different parts** of the element (top, center, bottom)
     * **Look for visual feedback** after each attempt
   
   **Success Detection for Input Fields**:
   - ✅ Cursor visible = Field is focused, ready for typing
   - ✅ Border highlighted = Field is active
   - ✅ Test character appeared = Focus confirmed, proceed with full text
   - ❌ No visual change after 2-3 attempts = Try different strategy (keyboard navigation, different coordinates)
   
   **Example Workflow**:
   1. Click input field at detected coordinates
   2. **Check screenshot**: Is cursor visible? Border highlighted?
   3. If YES → Proceed with typing
   4. If NO → Type single "a" to test focus
   5. If "a" appears → Field is focused, continue typing
   6. If nothing happens → Adjust click coordinates ±10-20px and retry
   7. **Maximum 3 coordinate adjustments** before trying different approach (Tab key, etc.)
   
   **CRITICAL**: Don't assume focus without visual confirmation. Use your eyes like a human would!

=== ACTION PRIMITIVES ===

Each action has: type (enum) + type-specific fields + reasoning (string)

**🚨 CRITICAL STRATEGY SELECTION RULE 🚨**
For findAndClick actions:

**When you have a screenshot (screenshot-driven mode):**
- ✅ Use strategy: "vision" for locating input fields, verifying UI state, spatial layout decisions
- ✅ Use strategy: "text" ONLY when you can quote the EXACT visible text from the screenshot
- ✅ Use strategy: "image" for icons without text
- ✅ Use strategy: "element" for native UI elements with accessibility info

**Strategy selection guide:**
- Vision: Input fields, dynamic UI, verifying results, spatial positioning ("input field in center")
- Text: Stable buttons/labels with exact known text ("Save", "Cancel", "Send")
- Image: Icons without text (hamburger menu, settings icon)
- Element: Native OS elements with accessibility roles

**Key principle**: Screenshot-driven automation prioritizes vision for grounding, text for precision

1. focusApp - Switch to desktop app (automatically fullscreens)
   { "type": "focusApp", "appName": "Google Chrome", "reasoning": "..." }

2. openUrl - Navigate to URL
   { "type": "openUrl", "url": "https://some-web-page.com", "reasoning": "..." }

3. findAndClick - Native element detection (REQUIRED for all UI elements)
   **PREFERRED STRATEGIES** (fast, accurate, local):
   
   a) Text-based (for buttons, labels, menu items with visible text):
   { "type": "findAndClick", "locator": { "strategy": "text", "value": "Save", "context": "button", "description": "Save button" }, "reasoning": "..." }
   
   **EXAMPLES OF WHEN TO USE TEXT STRATEGY:**
   - Buttons with text: "Save", "Cancel", "Send", "Submit", "OK", "Close"
   - Menu items: "File", "Edit", "View", "Help"
   - Links with text: "Learn more", "Sign in", "Get started"
   - Labels: "Username", "Password", "Email"
   - **ANY UI element with visible text - use strategy: "text" with the EXACT visible text as value**
   - **CRITICAL**: Look at the screenshot and READ the text - don't describe it, USE it
   
   b) Image-based (for icons without text):
   { "type": "findAndClick", "locator": { "strategy": "image", "value": "textedit-icon", "context": "dock", "description": "TextEdit icon in dock" }, "reasoning": "..." }
   
   c) Element-based (for native UI elements with accessibility info):
   { "type": "findAndClick", "locator": { "strategy": "element", "value": "File", "role": "menuItem", "description": "File menu item" }, "reasoning": "..." }
   
   **FALLBACK STRATEGY** (slower, requires API):
   d) Vision-based (when text/image/element strategies fail):
   { "type": "findAndClick", "locator": { "strategy": "vision", "description": "blue Send button in bottom right" }, "reasoning": "..." }
   
   - **CRITICAL**: ALWAYS include "description" field in ALL locators (used for Vision API fallback)
   - **CRITICAL**: ALWAYS prefer text/image/element strategies over vision
   - Text strategy: Use exact visible text (case-sensitive)
   - Image strategy: Reference icon name (frontend has icon templates)
   - Element strategy: Use accessibility role + title
   - Vision strategy: Only when element has no text, no icon template, and no accessibility info
   - Description field: Natural language description for Vision API fallback if native detection fails
   - NEVER use direct click coordinates - they are inaccurate


5. typeText - Type literal text (NOT for shortcuts)
   { "type": "typeText", "text": "Hello world", "submit": false, "reasoning": "..." }
   
   **🚨 CRITICAL - VISUAL GROUNDING AFTER TYPING 🚨**
   After ANY typeText action, you MUST:
   1. **DESCRIBE what you SEE** in the input field in the screenshot:
      - Quote the EXACT text visible: "I see the text '[exact text]' in the field"
      - If placeholder only: "I see only placeholder text '[placeholder]' - NO typed text"
      - If empty: "I see an empty field - NO text"
   2. **COMPARE** what you see vs what you typed:
      - Match: "Text matches - typed 'hello' and see 'hello' ✅"
      - Mismatch: "Text does NOT match - typed 'hello' but see only placeholder ❌"
   3. **DO NOT assume** the text was typed just because you sent the action
   4. **If text is NOT visible** in the screenshot:
      - The typing failed (wrong field focused, clipboard issue, etc.)
      - DO NOT proceed to next step
      - Try clicking the field again or use different approach
   5. **ONLY proceed** if you can SEE and QUOTE the exact text you typed in the screenshot
   
   **ANTI-HALLUCINATION CHECK:**
   - ❌ WRONG: "The text has been typed" (vague, no visual confirmation)
   - ❌ WRONG: "I can see the text in the field" (no specific quote)
   - ✅ CORRECT: "I see the exact text 'this is cool' in the input field" (specific quote)
   - ✅ CORRECT: "I see only placeholder 'Jot something down' - my text did NOT appear" (honest failure)
   
   **Example of CORRECT behavior**:
   - Action: typeText "this is cool"
   - Next screenshot: Look at input field
   - ✅ SEE "this is cool" in field → Proceed to submit
   - ❌ DON'T see text → Field not focused, retry click
   
   **Example of WRONG behavior (HALLUCINATION)**:
   - Action: typeText "this is cool"
   - Next screenshot: Input field shows only placeholder text
   - ❌ WRONG: "The message 'this is cool' has been typed (as shown by the text appearing)"
   - ✅ CORRECT: "I don't see the text in the field. The input field still shows placeholder. Need to click field again."
   
   **NEVER say text was typed unless you can SEE it in the screenshot!**

6. pressKey - Keyboard shortcuts and special keys
   { "type": "pressKey", "key": "Enter", "modifiers": ["Cmd"], "reasoning": "..." }
   Modifiers: "Cmd" (macOS), "Ctrl" (Windows/Linux), "Shift", "Alt"

7. scroll - Scroll in direction
   { "type": "scroll", "direction": "down", "amount": 300, "reasoning": "..." }

8. pause - Wait milliseconds
   { "type": "pause", "ms": 1500, "reasoning": "..." }

9. waitForElement - Wait for element to appear (CRITICAL for verification)
   { "type": "waitForElement", "locator": { "strategy": "vision", "description": "assistant response visible" }, "timeoutMs": 5000, "reasoning": "..." }
   - Use after actions that change state (submit, send, navigate)
   - Ensures next action doesn't proceed until UI is ready
   - Example: After pressing Enter → waitForElement for response → screenshot result

10. screenshot - Capture screen
    { "type": "screenshot", "tag": "verify_state", "reasoning": "..." }

11. log - Log message for debugging
    { "type": "log", "level": "info", "message": "Starting task", "reasoning": "..." }
    - Levels: "info" | "warn" | "error"
    - Use to mark progress milestones or debug issues

12. end - End execution
    { "type": "end", "reason": "Goal achieved", "reasoning": "..." }

CRITICAL: typeText vs pressKey
- typeText: Literal text only (messages, filenames, search queries)
- pressKey: Keyboard shortcuts (Cmd+A, Cmd+C, Enter, Tab, etc.)
- WRONG: { "type": "typeText", "text": "Cmd+A" } → Types "C-m-d-+-A" literally
- CORRECT: { "type": "pressKey", "key": "A", "modifiers": ["Cmd"] } → Selects all

=== COMPARISON TASK PLAYBOOK ===

**When goal involves comparing multiple AI assistants (ChatGPT vs Perplexity, etc.):**

**Required workflow:**
1. Focus browser → Open first AI (ChatGPT)
2. Locate input → Type question → Submit
3. **waitForElement** (assistant response visible) → **screenshot tag "chatgpt_result"**
4. Open second AI (Perplexity)
5. Locate input → Type same question → Submit
6. **waitForElement** (answer visible) → **screenshot tag "perplexity_result"**
7. **end** with comparison summary

**Comparison criteria (in order of importance):**
1. **Correctness**: Is the answer factually accurate?
2. **Citations**: Does it provide sources/references?
3. **Clarity**: Is the explanation clear and well-structured?
4. **Conciseness**: Is it brief without losing important details?

**Example end reasoning (human-readable format for comparison results):**
\`\`\`json
{
  "type": "end",
  "reason": "Comparison complete",
  "reasoning": "Comparison Results:\\n\\nChatGPT Response:\\n- Correctness: ✅ Accurate (confirmed 1+1=2)\\n- Citations: ❌ No sources provided\\n- Clarity: ✅ Clear and well-explained\\n- Conciseness: ✅ Brief and to the point\\n\\nPerplexity Response:\\n- Correctness: ✅ Accurate (confirmed 1+1=2)\\n- Citations: ✅ Included mathematical proof and sources\\n- Clarity: ✅ Clear explanation with step-by-step reasoning\\n- Conciseness: ✅ Comprehensive yet concise\\n\\nVerdict: Perplexity provides a better response due to superior citations and mathematical proof, making it more authoritative and educational."
}
\`\`\`

**NOTE**: Always use human-readable format for reasoning - clear, structured, and easy to understand.

**CRITICAL**: Use **screenshot with tags** to capture results for comparison.

=== EXECUTION RULES ===

1. Return ONLY ONE action as valid JSON
2. No markdown fences, no explanations outside JSON
3. Include "reasoning" field in human-readable format (clear description of what you see, what you're doing, and why)
4. **After state-changing actions** → Use waitForElement OR screenshot to verify
5. If goal achieved → { "type": "end", "reason": "Goal achieved", "reasoning": "..." }
6. If need user input → { "type": "end", "reason": "Need user input: [what is needed]", "reasoning": "..." }
7. If stuck or impossible → { "type": "end", "reason": "[explain why]", "reasoning": "..." }

Now analyze the screenshot and return the next action:`;
}

async function analyzeWithAnthropic(
  prompt: string,
  screenshot: { base64: string; mimeType: string }
): Promise<ComputerAction> {
  if (!anthropicClient) {
    throw new Error('Anthropic client not initialized');
  }

  logger.info('📤 [COMPUTER-USE] Sending request to Claude', {
    model: 'claude-sonnet-4-20250514',
    promptLength: prompt.length,
  });

  const response = await anthropicClient.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1000,
    temperature: 0.1,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: screenshot.mimeType as any,
              data: screenshot.base64,
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });

  logger.info('📥 [COMPUTER-USE] Received response from Claude', {
    contentType: response.content[0]?.type,
    textLength: response.content[0]?.type === 'text' ? response.content[0].text.length : 0,
  });

  const text = response.content[0]?.type === 'text' ? response.content[0].text : '{}';
  
  logger.debug('[COMPUTER-USE] Claude raw response', {
    text: text.substring(0, 500), // First 500 chars
  });

  return parseActionFromResponse(text);
}

async function analyzeWithOpenAI(
  prompt: string,
  screenshot: { base64: string; mimeType: string }
): Promise<ComputerAction> {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized');
  }

  logger.info('📤 [COMPUTER-USE] Sending request to OpenAI', {
    model: 'gpt-4o',
    promptLength: prompt.length,
  });

  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:${screenshot.mimeType};base64,${screenshot.base64}`,
              detail: 'high',
            },
          },
          { type: 'text', text: prompt },
        ],
      },
    ],
    max_tokens: 1000,
    temperature: 0.1,
  });

  logger.info('📥 [COMPUTER-USE] Received response from OpenAI', {
    hasContent: !!response.choices[0]?.message?.content,
    textLength: response.choices[0]?.message?.content?.length || 0,
  });

  const text = response.choices[0]?.message?.content || '{}';
  
  logger.debug('[COMPUTER-USE] OpenAI raw response', {
    text: text.substring(0, 500), // First 500 chars
  });

  return parseActionFromResponse(text);
}

function parseActionFromResponse(response: string): ComputerAction {
  try {
    // Remove markdown code fences
    let cleaned = response.replace(/```(?:json)?\n?/g, '').trim();
    
    // Extract JSON from verbose responses (Claude often adds explanations before JSON)
    // Look for JSON object pattern: {...}
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      cleaned = jsonMatch[0];
    }
    
    const action = JSON.parse(cleaned);

    if (!action.type) {
      throw new Error('Action missing "type" field');
    }

    return action as ComputerAction;
  } catch (error: any) {
    logger.error('Failed to parse action from response', {
      response,
      error: error.message,
    });
    
    return {
      type: 'end',
      reason: 'Failed to parse LLM response',
      reasoning: `Failed to parse action: ${error.message}`,
    };
  }
}

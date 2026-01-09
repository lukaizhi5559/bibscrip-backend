import WebSocket from 'ws';
import { IncomingMessage } from 'http';
import { logger } from '../utils/logger';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { uiDetectionService } from '../services/uiDetectionService';
import { omniParserService } from '../services/omniParserService';

// Session persistence across WebSocket reconnections
const sessionStore = new Map<string, any>();

const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;
const anthropicClient = process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : null;
const geminiClient = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;

/**
 * Call hybrid UI detection (OmniParser + Vision API fallback)
 * OmniParser is used for findAndClick and clickAndDrag actions for higher accuracy
 */
/**
 * Determine if element description suggests a simple (text-based) or complex (icon/spatial) element
 */
function isSimpleElement(description: string): boolean {
  const simplePatterns = [
    // Text-based buttons
    /button.*(?:submit|login|sign|search|send|save|cancel|close|ok|yes|no|next|back|continue)/i,
    // Input fields with labels/placeholders
    /(?:input|field|box).*(?:placeholder|label|text)/i,
    /(?:search|email|password|username|name).*(?:input|field|box)/i,
    // Links with text
    /link.*(?:with text|labeled|saying)/i,
    // Standard UI patterns with text
    /(?:menu item|tab|option).*(?:labeled|text|saying)/i,
  ];
  
  const complexPatterns = [
    // Icon-only elements
    /icon(?!.*text)/i,
    /hamburger menu/i,
    /three dots/i,
    /gear icon/i,
    // Spatial/positional descriptions
    /(?:top|bottom|left|right).*(?:corner|edge)/i,
    // Drag and drop
    /drag|drop/i,
    // Dense UIs
    /among many|multiple similar|grid of/i,
  ];
  
  // Check for complex patterns first (higher priority)
  if (complexPatterns.some(pattern => pattern.test(description))) {
    return false;
  }
  
  // Check for simple patterns
  if (simplePatterns.some(pattern => pattern.test(description))) {
    return true;
  }
  
  // Default: treat as complex for safety (use OmniParser)
  return false;
}

async function callVisionAPI(
  screenshot: { base64: string; mimeType: string },
  description: string,
  context: any,
  actionType?: string
): Promise<{ coordinates: { x: number; y: number }; confidence: number }> {
  // Hybrid strategy: Try OmniParser FIRST for better caching, fall back to Vision API
  // OmniParser provides consistent element detection that caches well across page changes
  const useOmniParser = (actionType === 'findAndClick' || actionType === 'clickAndDrag');
  
  logger.info('🔍 [HYBRID-STRATEGY] Element detection strategy', {
    description,
    willTryOmniParserFirst: useOmniParser,
    actionType,
    reason: useOmniParser ? 'omniparser_first_for_caching' : 'vision_api_only',
  });
  
  if (useOmniParser && omniParserService.isAvailable()) {
    try {
      logger.info('🎯 [COMPUTER-USE] Using OmniParser for element detection', {
        actionType,
        description,
      });
      
      const result = await omniParserService.detectElement(screenshot, description, context);
      
      logger.info('✅ [COMPUTER-USE] Element detected via OmniParser', {
        method: result.method,
        coordinates: result.coordinates,
        confidence: result.confidence,
        selectedElement: result.selectedElement,
        cacheHit: result.cacheHit,
      });

      return {
        coordinates: result.coordinates,
        confidence: result.confidence,
      };
    } catch (error: any) {
      logger.warn('⚠️ [COMPUTER-USE] OmniParser failed, falling back to Vision API', {
        error: error.message,
        actionType,
      });
      // Fall through to vision API fallback
    }
  }
  
  // Use Vision API (as fallback when OmniParser fails or for non-click actions)
  logger.info('🔍 [COMPUTER-USE] Using Vision API', {
    actionType,
    reason: useOmniParser ? 'omniparser_failed_fallback' : 'non_click_action',
  });
  
  const result = await uiDetectionService.detectElement(screenshot, description, context);
  
  logger.info('✅ [COMPUTER-USE] Element detected via Vision API', {
    method: result.method,
    coordinates: result.coordinates,
    confidence: result.confidence,
    selectedElement: result.selectedElement,
  });

  // No retry logic needed - we already tried OmniParser first if applicable

  return {
    coordinates: result.coordinates,
    confidence: result.confidence,
  };
}

interface ComputerAction {
  type: 'focusApp' | 'openUrl' | 'typeText' | 'hotkey' | 'click' | 'scroll' |
        'pause' | 'waitForElement' | 'screenshot' | 'findAndClick' |
        'log' | 'pressKey' | 'clickAndDrag' | 'zoom' | 'end';
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
    strategy: 'text' | 'image' | 'element' | 'vision' | 'textMatch' | 'contains' | 'bbox' | 'omniparser';
    // Nut.js native strategies (preferred)
    value?: string;           // Text to find, image name, or element title
    context?: string;         // Context for search (e.g., "button", "menu", "dock")
    role?: string;            // Accessibility role (for element strategy)
    // Vision API fallback (legacy)
    description?: string;     // Natural language description for Vision API
    // OmniParser strategy (LLM-driven element selection)
    elementId?: number;       // OmniParser element ID for direct lookup
    // Advanced strategies
    text?: string;            // For textMatch/contains
    bbox?: [number, number, number, number]; // For bbox strategy
  };
  timeoutMs?: number;
  tag?: string;
  analyzeWithVision?: boolean;
  level?: 'info' | 'warn' | 'error';
  message?: string;
  reason?: string;
  reasoning?: string;
  // clickAndDrag fields
  fromLocator?: {
    strategy: 'text' | 'image' | 'element' | 'vision' | 'textMatch' | 'contains' | 'bbox';
    value?: string;
    description?: string;
    text?: string;
    bbox?: [number, number, number, number];
  };
  toLocator?: {
    strategy: 'text' | 'image' | 'element' | 'vision' | 'textMatch' | 'contains' | 'bbox';
    value?: string;
    description?: string;
    text?: string;
    bbox?: [number, number, number, number];
  };
  fromCoordinates?: { x: number; y: number };
  toCoordinates?: { x: number; y: number };
  // zoom fields
  zoomDirection?: 'in' | 'out';
  zoomLevel?: number;  // For specific zoom levels (e.g., 150%)
}

interface ClarificationQuestion {
  id: string;
  question: string;
  options?: string[];
  required: boolean;
}

interface PlanStep {
  stepId: string;
  intent: 'navigate' | 'search' | 'click_element' | 'type_text' | 'capture' | 'compare' | 'wait' | 'custom';
  description: string;
  target?: string;      // For navigate: URL, For click: element description
  query?: string;       // For search/type
  element?: string;     // For click_element: natural language element description
  successCriteria: string;  // How to know step is complete
  maxAttempts?: number;     // Allow retries with different approaches
}

interface AutomationPlan {
  planId: string;
  goal: string;
  steps: PlanStep[];
  estimatedDuration?: string;
}

interface WebSocketMessage {
  type: 'start' | 'start_with_plan' | 'screenshot' | 'clarification_answer' | 'cancel' | 'action_failed' | 'action_complete';
  goal?: string;
  plan?: AutomationPlan;  // For start_with_plan
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

        case 'start_with_plan':
          sessionState = await handleStartWithPlan(ws, message, sessionState);
          break;

        case 'screenshot':
          await handleScreenshot(ws, message, sessionState);
          break;

        case 'action_complete':
          await handleActionComplete(ws, message, sessionState);
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
        // OmniParser cache metadata
        omniParserCache: {
          lastScreenshotHash: null,
          lastUrl: null,
          lastCacheHit: false,
          cacheInvalidatedAt: null,
        },
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
      
      // Preserve OmniParser cache metadata
      sessionState.omniParserCache = sessionState.omniParserCache || {
        lastScreenshotHash: null,
        lastUrl: null,
        lastCacheHit: false,
        cacheInvalidatedAt: null,
      };
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
 * Handle start_with_plan message - initialize session with pre-generated plan
 */
async function handleStartWithPlan(
  ws: WebSocket,
  message: WebSocketMessage,
  state: any
) {
  try {
    logger.info('🗺️ [COMPUTER-USE] handleStartWithPlan called', {
      hasPlan: !!message.plan,
      hasContext: !!message.context,
      stepCount: message.plan?.steps?.length || 0,
    });

    if (!message.plan || !message.plan.steps || message.plan.steps.length === 0) {
      ws.send(JSON.stringify({
        type: 'error',
        error: 'Missing or invalid "plan" in start_with_plan message',
      } as ServerMessage));
      return state;
    }

    // Generate session key from userId + sessionId
    const context = message.context || {};
    const sessionKey = `${context.userId || 'default'}_${context.sessionId || 'default'}`;
    
    // Create new session with plan
    const sessionState = {
      goal: message.plan.goal,
      context: context,
      previousActions: [] as ComputerAction[],
      iteration: 0,
      maxIterations: message.maxIterations || 50, // More iterations for plan-based execution
      provider: message.provider || 'anthropic',
      waitingForClarification: false,
      clarificationAnswers: {} as Record<string, string>,
      conversationHistory: [] as Array<{ timestamp: number; goal: string; completed: boolean }>,
      completedMilestones: new Set<string>(),
      // Plan-specific fields
      plan: message.plan,
      currentStepIndex: 0,
      currentStepAttempts: 0,
      completedSteps: [] as string[],
    };
    
    // Add current goal to conversation history
    sessionState.conversationHistory.push({
      timestamp: Date.now(),
      goal: message.plan.goal,
      completed: false,
    });
    
    // Store session
    sessionStore.set(sessionKey, sessionState);
    
    logger.info('📝 [COMPUTER-USE] Created new plan-based session', {
      sessionKey,
      goal: message.plan.goal,
      planId: message.plan.planId,
      stepCount: message.plan.steps.length,
      firstStep: message.plan.steps[0].description,
    });

    state = sessionState;

    // Send status update
    ws.send(JSON.stringify({
      type: 'status',
      message: `Plan loaded: ${message.plan.steps.length} steps. Starting execution...`,
    } as ServerMessage));

    // Request initial screenshot to begin execution
    logger.info('📸 [COMPUTER-USE] Requesting initial screenshot for plan execution');
    ws.send(JSON.stringify({
      type: 'action',
      action: {
        type: 'screenshot',
        reasoning: `Starting plan execution - Step 1: ${message.plan.steps[0].description}`,
      },
      iteration: 0,
    } as ServerMessage));
    
    return state;
  } catch (error: any) {
    logger.error('❌ [COMPUTER-USE] Error in handleStartWithPlan', {
      error: error.message,
      stack: error.stack,
    });
    ws.send(JSON.stringify({
      type: 'error',
      error: `Failed to start plan-based session: ${error.message}`,
    } as ServerMessage));
    return state;
  }
}

/**
 * Validate screenshot context before executing action
 * Detects modals, overlays, or context mismatches
 */
async function validateScreenshotContext(
  action: ComputerAction,
  screenshot: { base64: string; mimeType: string },
  goal: string,
  previousActions: ComputerAction[]
): Promise<{
  isValid: boolean;
  hasModal: boolean;
  issue?: string;
  suggestion?: string;
}> {
  try {
    // Quick heuristic checks first (no LLM call needed)
    
    // Check 1: If trying to click "search input" but previous action was also "search input"
    // AND the coordinates are the same (actually stuck, not just retrying with better element detection)
    if (action.type === 'findAndClick' && action.locator?.value?.toLowerCase().includes('search')) {
      const recentSearchClicks = previousActions.slice(-5).filter(a => 
        a.type === 'findAndClick' && 
        a.locator?.value?.toLowerCase().includes('search') &&
        a.coordinates // Only count clicks that actually executed
      );
      
      // Check if clicking the EXACT SAME coordinates repeatedly (stuck)
      if (recentSearchClicks.length >= 3) {
        const uniqueCoords = new Set(
          recentSearchClicks.map(a => `${a.coordinates?.x},${a.coordinates?.y}`)
        );
        
        // Only trigger if clicking same spot 3+ times
        if (uniqueCoords.size === 1) {
          logger.warn('⚠️ [PRE-ACTION] Clicking same search coordinates repeatedly', {
            count: recentSearchClicks.length,
            coordinates: recentSearchClicks[0].coordinates,
          });
          
          return {
            isValid: false,
            hasModal: true,
            issue: 'Clicking same search input coordinates repeatedly without progress',
            suggestion: 'Close modal/overlay first',
          };
        }
      }
    }
    
    // Check 2: If goal mentions specific site but we're clicking generic elements repeatedly
    // DISABLED - Too aggressive, prevents normal retries with improved element detection
    // const goalLower = goal.toLowerCase();
    // if ((goalLower.includes('perplexity') || goalLower.includes('chatgpt') || goalLower.includes('youtube')) &&
    //     action.type === 'findAndClick') {
    //   const recentClicks = previousActions.slice(-5).filter(a => a.type === 'findAndClick');
    //   
    //   if (recentClicks.length >= 4) {
    //     logger.warn('⚠️ [PRE-ACTION] Many clicks without progress on specific site', {
    //       goal,
    //       recentClickCount: recentClicks.length,
    //     });
    //     
    //     return {
    //       isValid: false,
    //       hasModal: true,
    //       issue: 'Multiple clicks without progress suggests modal/overlay blocking target',
    //       suggestion: 'Close modal/overlay first',
    //     };
    //   }
    // }
    
    // If no issues detected, action is valid
    return {
      isValid: true,
      hasModal: false,
    };
    
  } catch (error: any) {
    logger.error('❌ [PRE-ACTION] Context validation failed', {
      error: error.message,
    });
    
    // On error, allow action to proceed
    return {
      isValid: true,
      hasModal: false,
    };
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
  const handleStartTime = Date.now();
  
  if (!message.screenshot) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'Missing screenshot data',
    } as ServerMessage));
    return;
  }

  state.iteration++;
  
  // Track time since last action
  if (state.lastActionTime) {
    const timeSinceLastAction = Date.now() - state.lastActionTime;
    logger.info('⏱️ [TIMING] Time since last action sent', {
      iteration: state.iteration,
      milliseconds: timeSinceLastAction,
      seconds: (timeSinceLastAction / 1000).toFixed(2),
    });
  }
  state.lastActionTime = Date.now();

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

  // Store screenshot for later OmniParser calls (only fetch when needed for findAndClick/clickAndDrag)
  state.currentScreenshot = message.screenshot;
  state.currentScreenshotHash = currentScreenshotHash;

  // Analyze screenshot and decide next action
  let nextAction: ComputerAction;
  try {
    const llmStartTime = Date.now();
    
    logger.info('🤖 [COMPUTER-USE] Calling LLM for decision', {
      provider: state.provider,
      previousActionsCount: state.previousActions.length,
    });

    // Enrich context with UI change detection (no OmniParser elements yet - fetch on-demand)
    const enrichedContext = {
      ...state.context,
      ...message.context,  // Merge in context from screenshot message
      uiChanged,
      unchangedCount: state.unchangedCount || 0,
    };
    
    // Log context for debugging
    logger.debug('📋 [COMPUTER-USE] Context being sent to LLM', {
      service: 'bibscrip-backend',
      iteration: state.iteration,
      activeApp: enrichedContext.activeApp,
      activeUrl: enrichedContext.activeUrl,
      hasMessageContext: !!message.context,
    });

    nextAction = await analyzeAndDecide(
      state.goal,
      message.screenshot,
      state.previousActions,
      enrichedContext,
      state.provider,
      state.clarificationAnswers,
      state.conversationHistory,
      state.completedMilestones,
      state.plan,  // Pass plan if exists
      state.currentStepIndex,  // Current step index
      state.completedSteps  // Completed steps
    );
    
    const llmDuration = Date.now() - llmStartTime;
    state.lastLLMDuration = llmDuration; // Store for timing metadata

    logger.info('✅ [COMPUTER-USE] LLM returned action', {
      actionType: nextAction.type,
      reasoning: nextAction.reasoning,
    });
    
    logger.info('⏱️ [TIMING] LLM decision time', {
      iteration: state.iteration,
      milliseconds: llmDuration,
      seconds: (llmDuration / 1000).toFixed(2),
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

  // ========== ACTION LOOP DETECTION ==========
  // Detect if same action is repeating without progress (stuck in loop)
  const recentActions = state.previousActions.slice(-5);
  const sameActionCount = recentActions.filter((a: ComputerAction) => {
    if (a.type !== nextAction.type) return false;
    
    // For findAndClick, check if targeting same element
    if (a.type === 'findAndClick' && nextAction.type === 'findAndClick') {
      const sameLocator = a.locator?.value === nextAction.locator?.value;
      return sameLocator;
    }
    
    // For typeText, check if typing same text
    if (a.type === 'typeText' && nextAction.type === 'typeText') {
      return a.text === nextAction.text;
    }
    
    return a.type === nextAction.type;
  }).length;

  // If same action repeated 3+ times AND UI hasn't changed in last 2 iterations
  if (sameActionCount >= 3 && state.unchangedCount >= 2) {
    logger.error('❌ [LOOP DETECTED] Same action repeated without progress', {
      service: 'bibscrip-backend',
      iteration: state.iteration,
      actionType: nextAction.type,
      locator: nextAction.locator,
      repeatedCount: sameActionCount,
      unchangedCount: state.unchangedCount,
      reasoning: 'Action is not having the expected effect. System is stuck in a loop.',
    });
    
    // Send error to frontend with helpful message
    ws.send(JSON.stringify({
      type: 'error',
      error: `Action loop detected: "${nextAction.type}" repeated ${sameActionCount} times without progress. The action may be targeting the wrong element or a modal/overlay may be blocking it. Please check the screenshot and provide guidance.`,
      iteration: state.iteration,
    } as ServerMessage));
    return;
  }

  // ========== PRE-ACTION SCREENSHOT CONTEXT VALIDATION ==========
  // Validate screenshot context before executing action to detect modals/overlays
  if (nextAction.type === 'findAndClick' || nextAction.type === 'typeText') {
    const contextValidation = await validateScreenshotContext(
      nextAction,
      message.screenshot,
      state.goal,
      state.previousActions
    );
    
    if (!contextValidation.isValid) {
      logger.warn('⚠️ [PRE-ACTION] Screenshot context mismatch detected', {
        service: 'bibscrip-backend',
        iteration: state.iteration,
        actionType: nextAction.type,
        issue: contextValidation.issue,
        suggestion: contextValidation.suggestion,
      });
      
      // If a modal/overlay is detected, auto-correct to close it first
      if (contextValidation.hasModal && contextValidation.suggestion) {
        logger.info('🔄 [PRE-ACTION] Auto-correcting action to close modal first', {
          service: 'bibscrip-backend',
          originalAction: nextAction.type,
          correctedAction: 'findAndClick close button',
        });
        
        nextAction = {
          type: 'findAndClick',
          locator: {
            strategy: 'vision',
            value: 'close button',
            description: 'Close modal/overlay to access underlying content',
          },
          reasoning: `Detected modal/overlay blocking target element. Closing it first. Original intent: ${nextAction.reasoning}`,
        } as ComputerAction;
      }
    }
  }

  // ========== PROGRAMMATIC VALIDATION: REJECT INVALID typeText ==========
  // STRICT RULE: typeText MUST be preceded by successful findAndClick - NO OVERRIDES
  if (nextAction.type === 'typeText') {
    const lastAction = state.previousActions[state.previousActions.length - 1];
    
    // Find the most recent openUrl action
    const lastOpenUrlIndex = state.previousActions.map((a: ComputerAction) => a.type).lastIndexOf('openUrl');
    
    // If there was an openUrl, check if there's been a successful findAndClick since then
    if (lastOpenUrlIndex !== -1) {
      const actionsSinceOpenUrl = state.previousActions.slice(lastOpenUrlIndex + 1);
      
      // Check for successful findAndClick with OmniParser/Vision (coordinates present and not (0,0))
      const successfulFindAndClick = actionsSinceOpenUrl.find((a: ComputerAction) => 
        a.type === 'findAndClick' && 
        a.coordinates && 
        !(a.coordinates.x === 0 && a.coordinates.y === 0)
      );
      
      // REJECT typeText if no successful findAndClick or if last action was openUrl
      if (!successfulFindAndClick || lastAction?.type === 'openUrl') {
        logger.error('❌ [VALIDATION] REJECTED typeText - input not focused', {
          iteration: state.iteration,
          lastAction: lastAction?.type,
          lastOpenUrlIndex,
          actionsSinceOpenUrl: actionsSinceOpenUrl.map((a: ComputerAction) => a.type),
          hasSuccessfulFindAndClick: !!successfulFindAndClick,
          reasoning: 'CRITICAL: Must click input field BEFORE typing. LLM violated protocol.',
        });
        
        // Send error back to frontend and STOP
        ws.send(JSON.stringify({
          type: 'error',
          error: 'Invalid action sequence: typeText requires findAndClick first. Input fields must be clicked to focus before typing.',
          iteration: state.iteration,
        } as ServerMessage));
        return;
      }
    }
    
    // Also check for repeated typeText (typing the EXACT SAME text multiple times)
    const recentTypeTextActions = state.previousActions
      .slice(-5) // Check last 5 actions
      .filter((a: ComputerAction) => a.type === 'typeText');
    
    // Only reject if typing the EXACT SAME text 2+ times (actual loop)
    if (recentTypeTextActions.length >= 2) {
      const sameTextActions = recentTypeTextActions.filter((a: ComputerAction) => 
        a.text === nextAction.text
      );
      
      if (sameTextActions.length >= 1) {
        logger.error('❌ [VALIDATION] REJECTED repeated typeText with same text', {
          iteration: state.iteration,
          text: nextAction.text,
          previousOccurrences: sameTextActions.length,
          reasoning: 'CRITICAL: Typing the same text multiple times. This is a loop.',
        });
        
        ws.send(JSON.stringify({
          type: 'error',
          error: `Invalid action sequence: Already typed "${nextAction.text}" in a previous action. This appears to be a loop. If you need to type in a different field, use findAndClick first.`,
          iteration: state.iteration,
        } as ServerMessage));
        return;
      }
    }
  }

  state.previousActions.push(nextAction);
  
  // ========== PLAN-BASED STEP COMPLETION DETECTION ==========
  // Check if LLM signaled step completion via log action
  if (state.plan && state.currentStepIndex !== undefined && 
      nextAction.type === 'log' && nextAction.message?.includes('STEP_COMPLETE')) {
    
    const currentStep = state.plan.steps[state.currentStepIndex];
    logger.info('✅ [PLAN] Step completed', {
      stepId: currentStep.stepId,
      stepIndex: state.currentStepIndex + 1,
      totalSteps: state.plan.steps.length,
      description: currentStep.description,
    });
    
    // Mark step as complete
    state.completedSteps = state.completedSteps || [];
    state.completedSteps.push(currentStep.stepId);
    
    // Move to next step
    state.currentStepIndex++;
    state.currentStepAttempts = 0;
    
    // Check if all steps complete
    if (state.currentStepIndex >= state.plan.steps.length) {
      logger.info('🎉 [PLAN] All plan steps completed successfully');
      
      // Mark conversation as completed
      if (state.conversationHistory.length > 0) {
        state.conversationHistory[state.conversationHistory.length - 1].completed = true;
      }
      
      // Send final completion action
      const actionSentTime = Date.now();
      const totalHandleTime = actionSentTime - handleStartTime;
      const timeSinceLastAction = state.lastActionTime ? (Date.now() - state.lastActionTime) : 0;
      
      ws.send(JSON.stringify({
        type: 'action',
        action: {
          type: 'end',
          reasoning: `Successfully completed all ${state.plan.steps.length} steps of the plan:\n${state.completedSteps.map((id: string, i: number) => `${i + 1}. ${state.plan.steps.find((s: PlanStep) => s.stepId === id)?.description}`).join('\n')}`,
        },
        iteration: state.iteration,
        timing: {
          llmDecisionMs: state.lastLLMDuration || 0,
          totalProcessingMs: totalHandleTime,
          timeSinceLastActionMs: timeSinceLastAction,
          timestamp: Date.now(),
        },
      } as ServerMessage));
      
      state.lastActionTime = Date.now();
      return;
    }
    
    // Request screenshot for next step
    logger.info('📸 [PLAN] Moving to next step, requesting screenshot', {
      nextStepIndex: state.currentStepIndex + 1,
      nextStepDescription: state.plan.steps[state.currentStepIndex].description,
    });
    
    const actionSentTime = Date.now();
    const totalHandleTime = actionSentTime - handleStartTime;
    const timeSinceLastAction = state.lastActionTime ? (Date.now() - state.lastActionTime) : 0;
    
    ws.send(JSON.stringify({
      type: 'action',
      action: {
        type: 'screenshot',
        reasoning: `Step ${state.currentStepIndex} of ${state.plan.steps.length}: ${state.plan.steps[state.currentStepIndex].description}`,
      },
      iteration: state.iteration,
      timing: {
        llmDecisionMs: state.lastLLMDuration || 0,
        totalProcessingMs: totalHandleTime,
        timeSinceLastActionMs: timeSinceLastAction,
        timestamp: Date.now(),
      },
    } as ServerMessage));
    
    state.lastActionTime = Date.now();
    return;
  }
  
  // Track step attempts for plan-based execution
  // Only increment attempts when UI is unchanged (stuck) or repeating same action type
  if (state.plan && state.currentStepIndex !== undefined) {
    const currentStep = state.plan.steps[state.currentStepIndex];
    const maxAttempts = currentStep.maxAttempts || 5;
    
    // Initialize attempt counter if needed
    if (state.currentStepAttempts === undefined) {
      state.currentStepAttempts = 0;
    }
    
    // Increment attempts only if we're stuck (UI unchanged) or repeating same action
    const lastActionType = state.previousActions.length > 0 ? 
      state.previousActions[state.previousActions.length - 1].type : null;
    const isRepeatingAction = lastActionType === nextAction.type;
    const isStuck = state.unchangedCount > 0;
    
    if (isStuck || (isRepeatingAction && ['findAndClick', 'waitForElement'].includes(nextAction.type))) {
      state.currentStepAttempts++;
      
      logger.info('📊 [PLAN] Step retry attempt', {
        stepId: currentStep.stepId,
        attempt: state.currentStepAttempts,
        maxAttempts: maxAttempts,
        actionType: nextAction.type,
        reason: isStuck ? 'UI unchanged' : 'Repeating action',
      });
      
      // If max attempts exceeded, log warning but continue (LLM should adapt)
      if (state.currentStepAttempts > maxAttempts) {
        logger.warn('⚠️ [PLAN] Max retry attempts exceeded for step', {
          stepId: currentStep.stepId,
          attempts: state.currentStepAttempts,
          maxAttempts: maxAttempts,
          description: currentStep.description,
        });
        // Could generate clarification questions here or auto-skip
        // For now, let LLM continue trying with adaptive approaches
      }
    } else {
      // Making progress, log action count but don't treat as retry
      logger.info('📊 [PLAN] Step in progress', {
        stepId: currentStep.stepId,
        actionType: nextAction.type,
        totalActionsInStep: state.previousActions.filter((a: ComputerAction) => 
          !a.message?.includes('STEP_COMPLETE')
        ).length + 1,
      });
    }
  }
  
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

  // Proactive UI state verification (check for misalignment every 3 iterations)
  if (state.iteration % 3 === 0 || state.iteration > 5) {
    const verification = await verifyUIStateAlignment(
      state.goal,
      message.screenshot,
      state.context,
      state.previousActions,
      state.iteration
    );
    
    if (verification.needsClarification) {
      logger.warn('⚠️ [COMPUTER-USE] UI state misalignment detected', {
        reason: verification.reason,
        confidence: verification.confidence,
      });
      
      logger.info('🤔 [COMPUTER-USE] Generating clarification questions...', {});
      
      const questions = await generateClarificationQuestions(
        state.goal,
        message.screenshot,
        state.context,
        verification.reason
      );
      
      if (questions.length > 0) {
        logger.info('📋 [COMPUTER-USE] Clarification questions generated', {
          count: questions.length,
          questions: questions.map(q => q.question),
        });
        
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

      const actionSentTime = Date.now();
      const totalHandleTime = actionSentTime - handleStartTime;
      const timeSinceLastAction = state.lastActionTime ? (Date.now() - state.lastActionTime) : 0;
      
      ws.send(JSON.stringify({
        type: 'action',
        action: nextAction,
        iteration: state.iteration,
        timing: {
          llmDecisionMs: state.lastLLMDuration || 0,
          totalProcessingMs: totalHandleTime,
          timeSinceLastActionMs: timeSinceLastAction,
          timestamp: Date.now(),
        },
      } as ServerMessage));
      
      logger.info('⏱️ [TIMING] Total handleScreenshot time (native detection)', {
        iteration: state.iteration,
        milliseconds: totalHandleTime,
        seconds: (totalHandleTime / 1000).toFixed(2),
      });
      
      logger.info('📤 [TIMING] Action sent to frontend', {
        iteration: state.iteration,
        actionType: nextAction.type,
        strategy,
        timestamp: new Date().toISOString(),
      });
      
      return;
    }
    
    // OmniParser strategy - lookup element by ID OR auto-fetch if vision strategy used
    if (strategy === 'omniparser' || strategy === 'vision') {
      // Fetch OmniParser elements on-demand for this screenshot (with caching)
      let omniParserElements: any[] = [];
      const screenshotHash = state.currentScreenshotHash?.split('-')[2] || '';
      
      if (state.cachedOmniParserElements && state.cachedOmniParserHash === screenshotHash) {
        omniParserElements = state.cachedOmniParserElements;
        logger.info('✅ [OMNIPARSER] Using cached elements', {
          elementCount: omniParserElements.length,
        });
      } else {
        try {
          logger.info('🔍 [OMNIPARSER] Fetching elements on-demand for findAndClick', {
            iteration: state.iteration,
          });
          
          const enrichedContext = {
            ...state.context,
            ...message.context,
          };

          const omniResult = await omniParserService.detectElement(
            state.currentScreenshot!,
            'fetch_all_elements',
            enrichedContext
          );
          
          if (omniResult.allElements) {
            omniParserElements = omniResult.allElements;
            state.cachedOmniParserElements = omniParserElements;
            state.cachedOmniParserHash = screenshotHash;
            
            logger.info('✅ [OMNIPARSER] Elements fetched on-demand', {
              elementCount: omniParserElements.length,
              interactive: omniParserElements.filter((e: any) => e.interactivity).length,
            });
          }
        } catch (error: any) {
          logger.warn('⚠️ [OMNIPARSER] Failed to fetch elements', {
            error: error.message,
          });
        }
      }
      
      // OPTION A: Programmatic enforcement - convert vision strategy to element lookup
      if (strategy === 'vision' && omniParserElements.length > 0) {
        logger.info('🔄 [OPTION-A] Converting vision strategy to OmniParser element lookup', {
          searchText: nextAction.locator?.value || nextAction.locator?.description,
        });
        
        const searchText = (nextAction.locator?.value || nextAction.locator?.description || '').toLowerCase();
        
        // Search for matching element by content
        const matchingElement = omniParserElements.find((e: any) => 
          e.interactivity && e.content.toLowerCase().includes(searchText)
        );
        
        if (matchingElement) {
          logger.info('✅ [OPTION-A] Found matching element, using OmniParser', {
            elementId: matchingElement.id,
            content: matchingElement.content,
          });
          
          // Override to use OmniParser element
          nextAction.locator!.strategy = 'omniparser';
          nextAction.locator!.elementId = matchingElement.id;
        } else {
          logger.warn('⚠️ [OPTION-A] No matching element found, falling back to Vision API', {
            searchText,
            availableElements: omniParserElements.slice(0, 5).map((e: any) => e.content),
          });
        }
      }
      
      // If we have elementId, look it up
      if (nextAction.locator?.elementId !== undefined) {
        logger.info('🎯 [COMPUTER-USE] Looking up element by OmniParser ID', {
          elementId: nextAction.locator.elementId,
        });

        const elements = omniParserElements;
        const element = elements.find((e: any) => e.id === nextAction.locator!.elementId);

        if (!element) {
          logger.error('❌ [COMPUTER-USE] Element ID not found', {
            elementId: nextAction.locator.elementId,
            availableIds: elements.map((e: any) => e.id),
          });

          ws.send(JSON.stringify({
            type: 'action',
            action: {
              type: 'log',
              level: 'error',
              message: `Element ID ${nextAction.locator.elementId} not found in OmniParser results`,
              reasoning: 'Invalid element ID - check available elements',
            },
            iteration: state.iteration,
          } as ServerMessage));
          return;
        }

        // Calculate center coordinates from bbox
        const coordinates = {
          x: Math.round((element.bbox.x1 + element.bbox.x2) / 2),
          y: Math.round((element.bbox.y1 + element.bbox.y2) / 2),
        };

        logger.info('✅ [COMPUTER-USE] Element found by ID', {
          elementId: element.id,
          content: element.content,
          coordinates,
        });

        // Send findAndClick with resolved coordinates
        ws.send(JSON.stringify({
          type: 'action',
          action: {
            type: 'findAndClick',
            coordinates,
            reasoning: nextAction.reasoning,
          },
          iteration: state.iteration,
        } as ServerMessage));

        logger.info('📤 [TIMING] Action sent to frontend', {
          iteration: state.iteration,
          actionType: 'findAndClick',
          method: 'omniparser_id_lookup',
        });

        return;
      }
    }
    
    // Legacy Vision API strategy - resolve coordinates on backend (fallback)
    if (strategy === 'vision') {
      // Prefer locator.value (exact text from LLM) over description (generic label)
      const searchText = nextAction.locator.value || nextAction.locator.description;
      
      logger.info('🔍 [COMPUTER-USE] Handling findAndClick with Vision API (fallback)', {
        description: nextAction.locator.description,
        value: nextAction.locator.value,
        searchText,
      });

      try {
        const visionResult = await callVisionAPI(
          message.screenshot,
          searchText!,
          state.context,
          'findAndClick'
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

        // CRITICAL: Add action to previousActions BEFORE sending to frontend
        state.previousActions.push(findAndClickAction);

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
  } // Close findAndClick handler

  // Handle clickAndDrag action
  if (nextAction.type === 'clickAndDrag' && nextAction.fromLocator && nextAction.toLocator) {
    const fromStrategy = nextAction.fromLocator.strategy;
    const toStrategy = nextAction.toLocator.strategy;
    
    // If either locator uses vision strategy, detect on backend
    if (fromStrategy === 'vision' || toStrategy === 'vision') {
      logger.info('🎯 [COMPUTER-USE] Handling clickAndDrag with Vision API', {
        fromDescription: nextAction.fromLocator.description,
        toDescription: nextAction.toLocator.description,
      });

      try {
        // Detect FROM element
        let fromCoordinates = null;
        if (fromStrategy === 'vision' && nextAction.fromLocator.description) {
          const fromSearchText = nextAction.fromLocator.value || nextAction.fromLocator.description;
          const fromResult = await callVisionAPI(
            message.screenshot,
            fromSearchText,
            state.context,
            'clickAndDrag'
          );
          fromCoordinates = fromResult.coordinates;
          
          logger.info('✅ [COMPUTER-USE] FROM element located', {
            description: nextAction.fromLocator.description,
            coordinates: fromCoordinates,
          });
        }

        // Detect TO element
        let toCoordinates = null;
        if (toStrategy === 'vision' && nextAction.toLocator.description) {
          const toSearchText = nextAction.toLocator.value || nextAction.toLocator.description;
          const toResult = await callVisionAPI(
            message.screenshot,
            toSearchText,
            state.context,
            'clickAndDrag'
          );
          toCoordinates = toResult.coordinates;
          
          logger.info('✅ [COMPUTER-USE] TO element located', {
            description: nextAction.toLocator.description,
            coordinates: toCoordinates,
          });
        }

        // Check if either detection failed (0, 0)
        if (fromCoordinates && fromCoordinates.x === 0 && fromCoordinates.y === 0) {
          logger.warn('⚠️ [COMPUTER-USE] FROM element not found', {
            description: nextAction.fromLocator.description,
          });
          ws.send(JSON.stringify({
            type: 'action',
            action: {
              type: 'log',
              level: 'warn',
              message: `Could not locate FROM element: "${nextAction.fromLocator.description}"`,
            },
            iteration: state.iteration,
          } as ServerMessage));
          return;
        }

        if (toCoordinates && toCoordinates.x === 0 && toCoordinates.y === 0) {
          logger.warn('⚠️ [COMPUTER-USE] TO element not found', {
            description: nextAction.toLocator.description,
          });
          ws.send(JSON.stringify({
            type: 'action',
            action: {
              type: 'log',
              level: 'warn',
              message: `Could not locate TO element: "${nextAction.toLocator.description}"`,
            },
            iteration: state.iteration,
          } as ServerMessage));
          return;
        }

        // Send clickAndDrag with resolved coordinates
        const clickAndDragAction: ComputerAction = {
          type: 'clickAndDrag',
          fromLocator: nextAction.fromLocator,
          toLocator: nextAction.toLocator,
          fromCoordinates: fromCoordinates || undefined,
          toCoordinates: toCoordinates || undefined,
          reasoning: nextAction.reasoning,
        };

        logger.info('✅ [COMPUTER-USE] clickAndDrag action ready', {
          fromCoordinates,
          toCoordinates,
        });

        ws.send(JSON.stringify({
          type: 'action',
          action: clickAndDragAction,
          iteration: state.iteration,
        } as ServerMessage));
        return;
      } catch (error: any) {
        logger.error('❌ [COMPUTER-USE] clickAndDrag detection error', {
          error: error.message,
          fromDescription: nextAction.fromLocator?.description,
          toDescription: nextAction.toLocator?.description,
        });

        ws.send(JSON.stringify({
          type: 'error',
          error: `clickAndDrag detection error: ${error.message}`,
        } as ServerMessage));
        return;
      }
    }
  }

  // Send next action (for non-findAndClick/clickAndDrag actions)
  const actionSentTime = Date.now();
  const totalHandleTime = actionSentTime - handleStartTime;
  const timeSinceLastAction = state.lastActionTime ? (Date.now() - state.lastActionTime) : 0;
  
  ws.send(JSON.stringify({
    type: 'action',
    action: nextAction,
    iteration: state.iteration,
    timing: {
      llmDecisionMs: state.lastLLMDuration || 0,
      totalProcessingMs: totalHandleTime,
      timeSinceLastActionMs: timeSinceLastAction,
      timestamp: Date.now(),
    },
  } as ServerMessage));
  
  logger.info('⏱️ [TIMING] Total handleScreenshot time', {
    iteration: state.iteration,
    milliseconds: totalHandleTime,
    seconds: (totalHandleTime / 1000).toFixed(2),
  });
  
  logger.info('📤 [TIMING] Action sent to frontend', {
    iteration: state.iteration,
    actionType: nextAction.type,
    timestamp: new Date().toISOString(),
  });

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
 * Handle action_complete message - for actions that don't require screenshot analysis
 * (e.g., log, pause actions that don't change UI)
 */
async function handleActionComplete(
  ws: WebSocket,
  message: WebSocketMessage,
  state: any
) {
  if (!state) {
    ws.send(JSON.stringify({
      type: 'error',
      error: 'No active session',
    } as ServerMessage));
    return;
  }

  state.iteration++;
  
  logger.info('✅ [COMPUTER-USE] Action completed without screenshot', {
    iteration: state.iteration,
    lastAction: state.previousActions[state.previousActions.length - 1]?.type,
  });

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

  // For actions like log and pause, immediately send next action without LLM analysis
  // The last action is already in state.previousActions from when it was sent
  
  // Check if this was a step completion log
  const lastAction = state.previousActions[state.previousActions.length - 1];
  if (state.plan && state.currentStepIndex !== undefined && 
      lastAction?.type === 'log' && lastAction.message?.includes('STEP_COMPLETE')) {
    
    const currentStep = state.plan.steps[state.currentStepIndex];
    logger.info('✅ [PLAN] Step completed (via action_complete)', {
      stepId: currentStep.stepId,
      stepIndex: state.currentStepIndex + 1,
      totalSteps: state.plan.steps.length,
      description: currentStep.description,
    });
    
    // Mark step as complete
    state.completedSteps = state.completedSteps || [];
    state.completedSteps.push(currentStep.stepId);
    
    // Move to next step
    state.currentStepIndex++;
    state.currentStepAttempts = 0;
    
    // Check if all steps complete
    if (state.currentStepIndex >= state.plan.steps.length) {
      logger.info('🎉 [PLAN] All plan steps completed successfully');
      
      // Mark conversation as completed
      if (state.conversationHistory.length > 0) {
        state.conversationHistory[state.conversationHistory.length - 1].completed = true;
      }
      
      ws.send(JSON.stringify({
        type: 'action',
        action: {
          type: 'end',
          reasoning: `Successfully completed all ${state.plan.steps.length} steps of the plan`,
        },
        iteration: state.iteration,
      } as ServerMessage));
      return;
    }
  }

  // Request screenshot to continue with next action
  logger.info('📸 [COMPUTER-USE] Requesting screenshot for next action');
  ws.send(JSON.stringify({
    type: 'action',
    action: {
      type: 'screenshot',
      reasoning: 'Capturing current state to decide next action',
    },
    iteration: state.iteration,
  } as ServerMessage));
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

🚨 CRITICAL: Return ONLY valid JSON, no explanations or text before/after the JSON object.

Format:
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
- **Text typed in field** (even "ff" or "a") → aligned: true, needsClarification: false (focus confirmed!)

DO NOT include any text like "Looking at..." or explanations. ONLY return the JSON object.`;

  try {
    if (anthropicClient) {
      const response = await anthropicClient.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 500,
        temperature: 0.0,
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
  provider: 'gemini' | 'openai' | 'anthropic',
  clarificationAnswers: Record<string, string>,
  conversationHistory?: Array<{ timestamp: number; goal: string; completed: boolean }>,
  completedMilestones?: Set<string>,
  plan?: AutomationPlan,
  currentStepIndex?: number,
  completedSteps?: string[]
): Promise<ComputerAction> {
  const prompt = buildPrompt(goal, previousActions, context, clarificationAnswers, conversationHistory, completedMilestones, plan, currentStepIndex, completedSteps);

  // Define fallback order based on requested provider
  const fallbackOrder: Array<'gemini' | 'openai' | 'anthropic'> = [];
  
  if (provider === 'gemini') {
    fallbackOrder.push('gemini', 'openai', 'anthropic');
  } else if (provider === 'openai') {
    fallbackOrder.push('openai', 'gemini', 'anthropic');
  } else if (provider === 'anthropic') {
    fallbackOrder.push('anthropic', 'gemini', 'openai');
  }

  // Try providers in fallback order, automatically switching on error
  let action: ComputerAction | null = null;
  let lastError: Error | null = null;
  let usedProvider: string | null = null;

  for (const currentProvider of fallbackOrder) {
    try {
      if (currentProvider === 'gemini' && geminiClient) {
        logger.info('🤖 [COMPUTER-USE] Attempting with Gemini', { service: 'bibscrip-backend' });
        action = await analyzeWithGemini(prompt, screenshot);
        usedProvider = 'gemini';
        break;
      } else if (currentProvider === 'openai' && openaiClient) {
        logger.info('🤖 [COMPUTER-USE] Attempting with OpenAI', { service: 'bibscrip-backend' });
        action = await analyzeWithOpenAI(prompt, screenshot);
        usedProvider = 'openai';
        break;
      } else if (currentProvider === 'anthropic' && anthropicClient) {
        logger.info('🤖 [COMPUTER-USE] Attempting with Anthropic', { service: 'bibscrip-backend' });
        action = await analyzeWithAnthropic(prompt, screenshot);
        usedProvider = 'anthropic';
        break;
      }
    } catch (error: any) {
      lastError = error;
      logger.warn(`⚠️ [COMPUTER-USE] ${currentProvider} failed, trying next provider`, {
        service: 'bibscrip-backend',
        provider: currentProvider,
        error: error.message,
        errorCode: error.status || error.code,
      });
      // Continue to next provider in fallback order
    }
  }

  // If all providers failed, throw error
  if (!action) {
    logger.error('❌ [COMPUTER-USE] All LLM providers failed', {
      service: 'bibscrip-backend',
      requestedProvider: provider,
      lastError: lastError?.message,
    });
    throw new Error(`All LLM providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  // Log successful provider if different from requested
  if (usedProvider !== provider) {
    logger.info('✅ [COMPUTER-USE] Fallback successful', {
      service: 'bibscrip-backend',
      requestedProvider: provider,
      usedProvider,
    });
  }

  // CRITICAL: Prevent consecutive focusApp loops - if LLM sends focusApp twice in a row, force end with error
  const lastAction = previousActions[previousActions.length - 1];
  if (action.type === 'focusApp' && lastAction?.type === 'focusApp') {
    logger.error('🚨 [COMPUTER-USE] Detected consecutive focusApp loop - stopping automation', {
      service: 'bibscrip-backend',
      lastApp: lastAction.appName,
      attemptedApp: action.appName,
      previousActionsCount: previousActions.length,
      provider,
    });
    // End automation with error - something is wrong (frontend focusApp not working or LLM can't see app)
    return {
      type: 'end',
      reason: 'focusApp loop detected - app switching may not be working or LLM cannot see the app in screenshots',
      reasoning: `Backend detected ${previousActions.length} actions with consecutive focusApp. This indicates either: (1) Frontend focusApp is not working, (2) Screenshots are captured before app switch completes, or (3) LLM vision model cannot recognize the app. Provider: ${provider}`,
    };
  }

  return action;
}

function buildPrompt(
  goal: string,
  previousActions: ComputerAction[],
  context: any,
  clarificationAnswers: Record<string, string> = {},
  conversationHistory?: Array<{ timestamp: number; goal: string; completed: boolean }>,
  completedMilestones?: Set<string>,
  plan?: AutomationPlan,
  currentStepIndex?: number,
  completedSteps?: string[]
): string {
  // Core delimiters
  const userGoal = `<<USER_GOAL>>${goal}<</USER_GOAL>>`;

  // Conversation history (concise)
  let historySection = '';
  if (conversationHistory && conversationHistory.length > 1) {
    historySection = '\n\n=== CONVERSATION HISTORY ===\nPrevious goals:';
    conversationHistory.slice(0, -1).forEach((entry, i) => {
      const timeAgo = Math.floor((Date.now() - entry.timestamp) / 1000);
      historySection += `\n${i + 1}. [${timeAgo}s ago] "${entry.goal}" ${entry.completed ? '✅' : '⏳'}`;
    });
    historySection += '\nUse this to understand references like "previous task".';
  }

  // Context (single source: OS, app, UI state)
  const os = context?.os || 'unknown';
  let contextSection = '\n\n=== CONTEXT ===';
  contextSection += `\n- OS: ${os}`;
  contextSection += `\n- Active App: ${context?.activeApp || 'unknown'}`;
  contextSection += `\n- Active URL: ${context?.activeUrl || 'unknown'}`;
  contextSection += `\n- Screen: ${context?.screenWidth}x${context?.screenHeight || 'unknown'}`;
  contextSection += `\n- Screenshot Size: ${context?.screenshotWidth}x${context?.screenshotHeight || 'unknown'}`;
  if (context?.uiChanged !== undefined) {
    contextSection += `\n- UI Changed: ${context.uiChanged ? 'Yes' : 'No'} (Unchanged count: ${context.unchangedCount || 0})`;
  }

  // Clarifications (simple list)
  let clarificationSection = '';
  if (Object.keys(clarificationAnswers).length > 0) {
    clarificationSection = '\n\n=== CLARIFICATIONS ===';
    for (const [q, a] of Object.entries(clarificationAnswers)) {
      clarificationSection += `\n- ${q}: ${a}`;
    }
  }

  // Previous actions (last 5 only, concise)
  let previousActionsSection = '';
  if (previousActions.length > 0) {
    previousActionsSection = '\n\n=== PREVIOUS ACTIONS (LAST 5) ===';
    previousActions.slice(-5).forEach((a, i) => {
      previousActionsSection += `\n${i + 1}. ${a.type} - ${a.reasoning?.slice(0, 50) || 'No reasoning'}...`;
    });
  }

  // Plan/step (if provided, keep adaptive)
  let planSection = '';
  if (plan && currentStepIndex !== undefined && currentStepIndex < plan.steps.length) {
    const step = plan.steps[currentStepIndex];
    planSection = '\n\n=== CURRENT STEP ===\nStep ${currentStepIndex + 1}/${plan.steps.length}: ${step.description}\nIntent: ${step.intent}\nAdapt based on what you see.';
    if (completedSteps?.length) {
      planSection += `\nCompleted: ${completedSteps.join(', ')}`;
    }
  }

  // Milestones (concise list)
  let milestonesSection = '';
  if (completedMilestones && completedMilestones.size > 0) {
    milestonesSection = `\n\n=== COMPLETED MILESTONES ===\nDo not redo: ${Array.from(completedMilestones).join(', ')}`;
  }

  // Note: OmniParser elements are now fetched on-demand after LLM decision (Option A)
  // LLM uses vision strategy, backend automatically converts to OmniParser if elements match

  // Assemble prompt
  return `You are a desktop automation agent controlling a computer via actions.

${userGoal}${historySection}${contextSection}${clarificationSection}${previousActionsSection}${planSection}${milestonesSection}

=== DECISION TREE (ACTION SELECTION) ===
**CRITICAL: Take ACTION, not log observations. This is a LOOP - repeat steps 1-3 as needed for multi-part goals.**

🚨 **EXECUTE TASKS IN ORDER** - Don't skip ahead! If goal is "A then B then C", do A first, complete it, then B, then C.
   Example: "Goto perplexity, search X, copy results, paste to TextEdit" → Do perplexity FIRST, not TextEdit!

**1. Start: Open the right app/site (repeat this when switching apps/sites)**
   🚨 CRITICAL RULE: If your last action was focusApp → DO NOT send focusApp again! Skip to step 2 or use openUrl.
   🚨 CRITICAL RULE: If CONTEXT shows "Active App: Google Chrome" and you need a browser → SKIP focusApp! Go directly to step 2 (openUrl).
   
   - What app do I need for the CURRENT/NEXT task? (Examples: browser for web | text editor for files | terminal for commands | any other app)
   - Check PREVIOUS ACTIONS - did I just send focusApp?
     * YES → App is now active, SKIP to step 2 immediately (use openUrl, findAndClick, typeText, etc.)
     * NO → Check CONTEXT "Active App" field:
       - Active App = "Google Chrome" and I need browser? → SKIP focusApp! Go to step 2 (openUrl)!
       - Active App = "TextEdit" and I need text editor? → SKIP focusApp! Go to step 2 (typeText)!
       - Active App matches what I need? → SKIP focusApp! Go to step 2!
       - Active App is different or unknown? → Send focusApp "[AppName]" ONCE (use real app name from screenshot/dock)
   
   🚨 NEVER send focusApp if the app is already active! Check CONTEXT "Active App" field first!

**2. Interact: Choose based on what you need to do**
   🚨 CRITICAL: Check PREVIOUS ACTIONS before repeating! Don't type the same text twice or click the same element repeatedly.
   
   🚨 **BEFORE USING typeText - MANDATORY CHECK:**
   - Want to type in search box/input field?
     🚨 🚨 🚨 ABSOLUTE RULE: typeText is FORBIDDEN after openUrl without findAndClick! 🚨 🚨 🚨
     🚨 CRITICAL: openUrl NEVER EVER focuses inputs! After openUrl, you MUST send findAndClick!
     
     **STEP-BY-STEP CHECK (DO THIS EVERY TIME):**
     1. Check PREVIOUS ACTIONS - what was the LAST action?
        * Last action = openUrl? → STOP! You MUST send findAndClick FIRST! typeText is FORBIDDEN!
        * Last action = findAndClick? → Go to step 2
        * Last action = something else? → Check if findAndClick exists after last openUrl (step 3)
     
     2. Look at the SCREENSHOT - do you see a BLINKING CURSOR inside the input field?
        * YES (cursor visible) → Field IS focused! Use typeText NOW (don't click again!)
        * NO (no cursor visible) → Field should be focused (cursor may appear after typing), use typeText NOW
     
     3. Find the most recent openUrl in PREVIOUS ACTIONS - is there a findAndClick AFTER it?
        * YES → Use typeText NOW
        * NO → STOP! You MUST send findAndClick FIRST! typeText is FORBIDDEN!
        * No openUrl found? → Use typeText NOW
     
     4. Did I already type this exact text before?
        * YES → DON'T type again! Wait or proceed to next task
        * NO → Proceed with typeText
     
     🚨 NEVER ASSUME INPUT IS FOCUSED AFTER openUrl - YOU MUST ALWAYS SEND findAndClick FIRST!
     🚨 If last action was openUrl → Send findAndClick NOW, NOT typeText!
   
   **Other actions:**
   - Element not visible? → scroll (up/down to reveal it) THEN findAndClick
   - Need to click button/link/input? → findAndClick with strategy "vision" (ALWAYS use "vision" - it uses OmniParser for accuracy)
   - 🚨 CRITICAL: NEVER use strategy "text" for input fields, search boxes, or placeholder text!
   - Only use strategy "text" for clickable button labels with unique text (e.g., "Submit", "Login", "Save")
   - Need keyboard action? → pressKey (Enter, Backspace, Cmd+A, etc.)
   - Need to drag element? → clickAndDrag (for map markers, canvas elements, sliders, n8n nodes)
   - Need to zoom? → scroll with Cmd (maps, images) OR use zoom controls

**3. Wait: Let UI respond (if needed)**
   - After submit/click that loads content → waitForElement OR pause (500-2000ms)
   - After simple action (type, scroll) → No wait needed, next screenshot shows result
   - Check next screenshot to verify change before proceeding

**4. Complete: End or continue to next part**
   🚨 **CRITICAL - SEARCH QUERY COMPLETION:**
   - If you just typed a search query with submit=true → **TASK IS COMPLETE!**
   - Example: typeText "Strip API integration" with submit=true → Search submitted → Send END action NOW!
   - **DO NOT** wait for results to load
   - **DO NOT** try to type the same query again
   - **DO NOT** keep clicking the search box
   - ✅ **CORRECT**: { "type": "end", "reason": "Goal achieved", "reasoning": "Successfully searched for 'X' on [site]" }
   
   **Other completion scenarios:**
   - Current task done, more tasks remain → Go back to step 1 (switch app/site for next task)
   - Plan step done → log "STEP_COMPLETE" then go back to step 1 for next step
   - ALL tasks done → end "Goal achieved: [summary]"
   - Stuck/need login/clarification → end "Need user input: [details]"

**CRITICAL - Memory & Content Gathering:**
When gathering information for comparison/analysis:
1. **Read ALL content by scrolling** - Don't assume you've seen everything
   - If content extends below/above viewport → scroll down/up to see more
   - Continue scrolling until you've seen all relevant content
   - Note key points in your reasoning at each scroll position

2. **Accumulate knowledge across iterations** - Your reasoning builds memory
   - Iteration 5: "I see Source A suggests approach X with feature Y..."
   - Iteration 6: scroll down/up → "I see Source A also mentions benefit Z..."
   - Iteration 7: scroll down/up → "I see example code showing implementation..."
   - Your previous reasoning is your memory - reference it when synthesizing

3. **Synthesize from accumulated reasoning** - When typing final output
   - Review what you noted across all iterations
   - TYPE intelligent comparison based on everything you saw
   - Example: "Source A (from iterations 5-7) recommends X. Source B (from iterations 10-12) recommends Y. Key difference: ..."

4. **Don't just copy-paste** - Provide analyzed summary
   - Bad: Paste raw output from Source A, paste raw output from Source B
   - Good: "Source A emphasizes approach X with benefits A,B. Source B emphasizes approach Y with benefits C,D. Best for: ..."

=== KEY PRINCIPLES ===
- **App Names**: When using focusApp, look at screenshot for REAL app names in Dock/taskbar
  - NEVER use generic names like "Browser App" or "Desktop App" - these don't exist on the OS
- **Visual Verification**: Describe what you SEE and verify actions worked in next screenshot
- **No Loops**: If UI unchanged after 2 tries, try alternative approach or end with reason

=== ACTIONS (JSON SCHEMA) ===
Output ONLY valid JSON: { "type": string, "reasoning": string, ...fields }

**Available Actions:**
- focusApp: { "appName": "[Appname]" }  // Use REAL app names from screenshot: "Safari", "Google Chrome", "TextEdit", "Notes", etc.
- openUrl: { "url": "https://example.com" }
- findAndClick: { "locator": { "strategy": "text"|"image"|"element"|"vision", "value": string, "description": string } }
- typeText: { "text": string, "submit": boolean }
- pressKey: { "key": "Enter", "modifiers": ["Cmd"] }
- scroll: { "direction": "down"|"up", "amount": 300 }
- clickAndDrag: { "fromLocator": {...}, "toLocator": {...} }  // For dragging map markers, canvas elements, sliders
- zoom: { "zoomDirection": "in"|"out", "zoomLevel": 150 }  // For maps, images, canvas (zoomLevel optional)
- pause: { "ms": 1500 }
- waitForElement: { "locator": {...}, "timeoutMs": 5000 }
- log: { "message": "STEP_COMPLETE" }  // ONLY for plan milestones
- end: { "reason": "Goal achieved: [summary]" }

**Reasoning format:** Bullets - What I see | Goal recap | Next action per decision tree | Expected result

Analyze the screenshot and return ONE action:`;
}

// function buildPrompt(
//   goal: string,
//   previousActions: ComputerAction[],
//   context: any,
//   clarificationAnswers: Record<string, string>,
//   conversationHistory?: Array<{ timestamp: number; goal: string; completed: boolean }>,
//   completedMilestones?: Set<string>,
//   plan?: AutomationPlan,
//   currentStepIndex?: number,
//   completedSteps?: string[]
// ): string {
//   // Collect all previous reasoning text to filter from screenshot analysis
//   const previousReasoningTexts = previousActions
//     .filter(a => a.reasoning)
//     .map(a => a.reasoning as string);
//   // Deterministic delimiters for user input (prevents injection)
//   const userGoal = `<<USER_GOAL>>
// ${goal}
// <</USER_GOAL>>`;
  
//   // Conversation history section
//   let conversationHistorySection = '';
//   if (conversationHistory && conversationHistory.length > 1) {
//     conversationHistorySection = '\n\n=== CONVERSATION HISTORY ===';
//     conversationHistorySection += '\n**CRITICAL**: You have context from previous interactions in this session:';
//     conversationHistory.slice(0, -1).forEach((entry, i) => {
//       const timeAgo = Math.floor((Date.now() - entry.timestamp) / 1000);
//       conversationHistorySection += `\n${i + 1}. [${timeAgo}s ago] "${entry.goal}" ${entry.completed ? '✅ COMPLETED' : '⏳ IN PROGRESS'}`;
//     });
//     conversationHistorySection += '\n\n**When user says "previous task" or "fulfill the previous task", they are referring to the goals listed above.**';
//     conversationHistorySection += '\n**Use this context to understand what the user is asking you to do.**';
//   }
  
//   // Single source of truth for OS
//   const os = context?.os || 'unknown';
  
//   // Build context section
//   let contextSection = '\n\n=== CONTEXT ===';
//   contextSection += `\n- Active App: ${context?.activeApp || 'unknown'}`;
//   contextSection += `\n- Active URL: ${context?.activeUrl || 'unknown'}`;
//   contextSection += `\n- OS: ${os}`;
//   contextSection += `\n- Screen Resolution: ${context?.screenWidth && context?.screenHeight ? `${context.screenWidth}x${context.screenHeight}` : 'unknown'}`;
//   contextSection += `\n- Screenshot Dimensions: ${context?.screenshotWidth && context?.screenshotHeight ? `${context.screenshotWidth}x${context.screenshotHeight}` : 'unknown'}`;
  
//   // Add reasoning filter section
//   let reasoningFilterSection = '';
//   if (previousReasoningTexts.length > 0) {
//     reasoningFilterSection = '\n\n=== 🚨 CRITICAL - IGNORE YOUR OWN REASONING TEXT 🚨 ===';
//     reasoningFilterSection += '\n**The screenshot may contain notification popups showing YOUR previous reasoning text.**';
//     reasoningFilterSection += '\n**This is NOT actual UI content - it is just your own thoughts being displayed back to you.**';
//     reasoningFilterSection += '\n\n**IGNORE the following text if you see it in the screenshot:**';
//     previousReasoningTexts.slice(-5).forEach((reasoning, i) => {
//       reasoningFilterSection += `\n${i + 1}. "${reasoning}"`;
//     });
//     reasoningFilterSection += '\n\n**CRITICAL RULES:**';
//     reasoningFilterSection += '\n- If you see text matching your previous reasoning → IGNORE IT';
//     reasoningFilterSection += '\n- Do NOT use your own reasoning text as evidence of what happened in the UI';
//     reasoningFilterSection += '\n- ONLY look at the ACTUAL UI elements (input fields, buttons, messages, etc.)';
//     reasoningFilterSection += '\n- Notification popups showing "AI Thinking" are NOT part of the application UI';
//     reasoningFilterSection += '\n- **NEVER try to click on automation popups** - they are not clickable UI elements';
//     reasoningFilterSection += '\n- Automation popups are overlays that show YOUR reasoning - look PAST them to the real UI';
//     reasoningFilterSection += '\n- **NEVER copy files instead of code content** - you are working with code, not files';
//     reasoningFilterSection += '\n- **ALWAYS look for code content in the UI** - do not assume it is a file';
//     reasoningFilterSection += '\n\n**Example of WRONG behavior:**';
//     reasoningFilterSection += '\n- ❌ "I can see that the text selection was successful (Cmd+A was pressed in the previous action)"';
//     reasoningFilterSection += '\n- ❌ Reading notification text that says "typing this is cool" and assuming it was typed';
//     reasoningFilterSection += '\n\n**Example of CORRECT behavior:**';
//     reasoningFilterSection += '\n- ✅ "I see a notification popup with my reasoning, but looking at the ACTUAL input field, I see only placeholder text"';
//     reasoningFilterSection += '\n- ✅ "I see a notification popup with my reasoning, but looking at the ACTUAL code content, I see the correct code"';
//     reasoningFilterSection += '\n- ✅ "Ignoring the notification popup, the input field shows \'[exact text]\' or placeholder only"';
//   }
  
//   // UI change detection
//   if (context?.uiChanged !== undefined) {
//     contextSection += `\n- UI Changed Since Last Action: ${context.uiChanged ? 'YES ✅' : 'NO ⚠️'}`;
//     if (!context.uiChanged && context.unchangedCount > 0) {
//       contextSection += `\n- **CRITICAL**: UI has been UNCHANGED for ${context.unchangedCount} iterations`;
//       contextSection += `\n- **This means**: Your last action either (1) already succeeded, or (2) had no effect`;
//       contextSection += `\n- **What to do**: Look carefully at the screenshot - did the previous action already complete?`;
//       contextSection += `\n- **Example**: If you tried to send a message and UI unchanged → message was likely already sent, move on`;
//     }
//   }
  
//   // ========== PLAN-BASED STEP INTENT SECTION ==========
//   let stepIntentSection = '';
//   if (plan && currentStepIndex !== undefined && currentStepIndex < plan.steps.length) {
//     const currentStep = plan.steps[currentStepIndex];
//     const totalSteps = plan.steps.length;
    
//     stepIntentSection = '\n\n=== 🎯 CURRENT STEP INTENT (FROM PLAN) ===';
//     stepIntentSection += `\n**Step ${currentStepIndex + 1} of ${totalSteps}**`;
//     stepIntentSection += `\n**Intent**: ${currentStep.intent}`;
//     stepIntentSection += `\n**Description**: ${currentStep.description}`;
    
//     if (currentStep.target) {
//       stepIntentSection += `\n**Target**: ${currentStep.target}`;
//     }
//     if (currentStep.query) {
//       stepIntentSection += `\n**Query**: ${currentStep.query}`;
//     }
//     if (currentStep.element) {
//       stepIntentSection += `\n**Element**: ${currentStep.element}`;
//     }
//     if (currentStep.successCriteria) {
//       stepIntentSection += `\n**Success Criteria**: ${currentStep.successCriteria}`;
//     }
    
//     const attempts = (currentStepIndex === 0 ? 1 : previousActions.filter(a => a.type !== 'log' || !a.message?.includes('STEP_COMPLETE')).length + 1);
//     const maxAttempts = currentStep.maxAttempts || 5;
//     stepIntentSection += `\n**Attempt**: ${attempts} of ${maxAttempts}`;
    
//     stepIntentSection += '\n\n**YOUR JOB - ADAPTIVE EXECUTION:**';
//     stepIntentSection += '\n1. **Examine the screenshot** - What do you see right now?';
//     stepIntentSection += '\n2. **Decide tactical actions** - What specific actions will achieve this intent?';
//     stepIntentSection += '\n3. **Be flexible** - If your approach doesn\'t work, try a different way';
//     stepIntentSection += '\n4. **Signal completion** - When intent is satisfied: { "type": "log", "message": "STEP_COMPLETE" }';
    
//     stepIntentSection += '\n\n**IMPORTANT:**';
//     stepIntentSection += '\n- The plan tells you WHAT to accomplish (intent)';
//     stepIntentSection += '\n- YOU decide HOW to accomplish it (by examining UI)';
//     stepIntentSection += '\n- You are NOT bound to specific coordinates or rigid actions';
//     stepIntentSection += '\n- Adapt based on what you actually see in the screenshot';
//     stepIntentSection += '\n- When you believe the success criteria is met, return a log action with "STEP_COMPLETE"';
    
//     if (completedSteps && completedSteps.length > 0) {
//       stepIntentSection += `\n\n**Completed Steps**: ${completedSteps.map((id: string) => {
//         const step = plan.steps.find((s: any) => s.id === id);
//         return step ? `Step ${plan.steps.indexOf(step) + 1}` : id;
//       }).join(', ')}`;
//     }
    
//     // Show next steps for context
//     if (currentStepIndex < totalSteps - 1) {
//       stepIntentSection += '\n\n**Upcoming Steps**:';
//       for (let i = currentStepIndex + 1; i < Math.min(currentStepIndex + 3, totalSteps); i++) {
//         stepIntentSection += `\n- Step ${i + 1}: ${plan.steps[i].description}`;
//       }
//     }
//   }
  
//   // Milestone tracking section
//   let milestonesSection = '';
//   if (completedMilestones && completedMilestones.size > 0) {
//     milestonesSection = '\n\n=== ✅ COMPLETED MILESTONES (DO NOT REDO) ✅ ===';
//     milestonesSection += '\n**The following sub-tasks have been COMPLETED. DO NOT repeat them:**';
//     const milestones = Array.from(completedMilestones);
//     milestones.forEach((milestone, i) => {
//       let description = milestone;
      
//       // Generic milestone descriptions
//       if (milestone === 'input_field_focused') {
//         description = 'Input field is focused (single character was typed and appeared)';
//       } else if (milestone === 'test_char_deleted') {
//         description = 'Test character was deleted/selected (field is ready for content)';
//       } else if (milestone === 'content_typed') {
//         description = 'Content has been typed (message/search/text entered)';
//       } else if (milestone === 'content_submitted') {
//         description = 'Content has been submitted (Enter was pressed)';
//       } else if (milestone === 'url_opened') {
//         description = 'URL has been opened in browser';
//       } else if (milestone.startsWith('app_focused_')) {
//         const appName = milestone.replace('app_focused_', '');
//         description = `${appName} app has been focused and opened`;
//       }
      
//       milestonesSection += `\n${i + 1}. ✅ ${description}`;
//     });
//     milestonesSection += '\n\n**🚨 CRITICAL ANTI-LOOP RULES 🚨**';
//     milestonesSection += '\n- DO NOT click the input field again if "input_field_focused" is completed';
//     milestonesSection += '\n- DO NOT type a single test character again if "input_field_focused" is completed';
//     milestonesSection += '\n- DO NOT delete/select test character again if "test_char_deleted" is completed';
//     milestonesSection += '\n- DO NOT type the content again if "content_typed" is completed';
//     milestonesSection += '\n- DO NOT press Enter again if "content_submitted" is completed';
//     milestonesSection += '\n- DO NOT focus the same app again if "app_focused_[name]" is completed';
//     milestonesSection += '\n\n**NEXT STEP LOGIC:**';
//     if (milestones.includes('content_submitted')) {
//       milestonesSection += '\n- ✅ Content submitted → Next: Continue with remaining goal steps or quit app';
//     } else if (milestones.includes('content_typed')) {
//       milestonesSection += '\n- ✅ Content typed → Next: Press Enter to submit (if required by goal)';
//     } else if (milestones.includes('test_char_deleted')) {
//       milestonesSection += '\n- ✅ Test char deleted → Next: Type the full content';
//     } else if (milestones.includes('input_field_focused')) {
//       milestonesSection += '\n- ✅ Field focused → Next: Delete test character (Backspace or Cmd+A)';
//     }
//     milestonesSection += '\n\n**DO NOT GO BACKWARDS. ONLY MOVE FORWARD TO THE NEXT STEP.**';
//     milestonesSection += '\n**If a milestone is completed, that step is DONE. Move to the next step in your goal.**';
//   }
  
//   // Clarification answers section
//   let clarificationSection = '';
//   if (Object.keys(clarificationAnswers).length > 0) {
//     clarificationSection = '\n\n=== CLARIFICATION ANSWERS ===';
//     for (const [q, a] of Object.entries(clarificationAnswers)) {
//       clarificationSection += `\n- ${q}: ${a}`;
//     }
//   }
  
//   // Previous actions section
//   let previousActionsSection = '';
//   if (previousActions.length > 0) {
//     previousActionsSection = '\n\n=== PREVIOUS ACTIONS ===';
//     previousActions.forEach((a, i) => {
//       previousActionsSection += `\n${i + 1}. ${a.type} - ${a.reasoning || 'No reasoning'}`;
//     });
//   }
  
//   // Detect if stuck
//   const lastFiveActions = previousActions.slice(-5);
//   const findAndClickAttempts = lastFiveActions.filter(a => a.type === 'findAndClick');
//   const isFindingElement = findAndClickAttempts.length >= 3;
  
//   const lastThreeActions = previousActions.slice(-3);
//   const isStuck = lastThreeActions.length === 3 && 
//     lastThreeActions.every(a => a.type === lastThreeActions[0].type && 
//                                  JSON.stringify(a.locator) === JSON.stringify(lastThreeActions[0].locator));
  
//   // Detect repeated clicking on menu bar or same wrong element
//   const lastFourClicks = previousActions.slice(-4).filter(a => a.type === 'findAndClick');
//   const isClickingWrongElement = lastFourClicks.length >= 3;
  
//   let stuckWarning = '';
//   if (isStuck || isFindingElement || isClickingWrongElement) {
//     stuckWarning = '\n\n=== 🚨 ADAPTIVE INTELLIGENCE REQUIRED - REPEATED FAILURES DETECTED 🚨 ===';
//     stuckWarning += '\n\n**SITUATION:** You are repeating the same action multiple times without success.';
//     stuckWarning += '\n**THIS IS NOT WORKING.** You must adapt your approach.';
//     stuckWarning += '\n\n**🧠 STEP-BY-STEP ADAPTIVE PROBLEM-SOLVING 🧠**';
//     stuckWarning += '\n\n**1. ACKNOWLEDGE THE FAILURE**';
//     stuckWarning += '\n- Your current approach has failed multiple times';
//     stuckWarning += '\n- Repeating the same action will NOT suddenly work';
//     stuckWarning += '\n- You need to think differently';
//     stuckWarning += '\n\n**2. ANALYZE WHAT YOU\'VE TRIED**';
//     if (isStuck) {
//       const repeatedAction = lastThreeActions[0];
//       stuckWarning += `\n- You repeated: ${repeatedAction.type} (same action 3+ times)`;
//       stuckWarning += '\n- Why did it fail? Look at the screenshots - what\'s different from your expectation?';
//     }
//     if (isFindingElement || isClickingWrongElement) {
//       stuckWarning += `\n- You attempted ${findAndClickAttempts.length} findAndClick actions in the last 5 attempts`;
//       stuckWarning += '\n- Are you clicking the wrong element? Is the element not responding?';
//       stuckWarning += '\n- Is the UI different from what you expected?';
//     }
//     stuckWarning += '\n\n**3. UNDERSTAND WHY IT\'S FAILING**';
//     stuckWarning += '\nCommon reasons for repeated failures:';
//     stuckWarning += '\n- Element doesn\'t exist or is in a different location';
//     stuckWarning += '\n- Wrong interaction method (clicking when you should type, or vice versa)';
//     stuckWarning += '\n- UI requires a different sequence (e.g., menu → submenu → action)';
//     stuckWarning += '\n- Need to use keyboard shortcuts instead of clicking';
//     stuckWarning += '\n- Page/content hasn\'t loaded yet (need to wait/scroll)';
//     stuckWarning += '\n- Clicking menu bar text instead of actual interactive elements';
//     stuckWarning += '\n\n**4. GENERATE ALTERNATIVE APPROACHES**';
//     stuckWarning += '\nBased on your goal, consider these alternatives:';
//     stuckWarning += '\n\n**Alternative A: Use Keyboard Shortcuts**';
//     stuckWarning += '\n- Opening app? → Use Cmd+Space (Spotlight), type app name, Enter';
//     stuckWarning += '\n- New file? → Cmd+N';
//     stuckWarning += '\n- Save? → Cmd+S';
//     stuckWarning += '\n- Copy? → Cmd+C';
//     stuckWarning += '\n- Paste? → Cmd+V';
//     stuckWarning += '\n- Quit? → Cmd+Q';
//     stuckWarning += '\n\n**Alternative B: Different UI Path**';
//     stuckWarning += '\n- Can\'t click button? → Look for menu option';
//     stuckWarning += '\n- Can\'t find menu? → Try right-click context menu';
//     stuckWarning += '\n- Sidebar collapsed? → Look for expand button or use keyboard';
//     stuckWarning += '\n\n**Alternative C: Change Interaction Method**';
//     stuckWarning += '\n- Clicking not working? → Try typing (if it\'s a search/input)';
//     stuckWarning += '\n- Button not responding? → Try pressing Enter or Space';
//     stuckWarning += '\n- Submit button missing? → Try pressing Enter in the field';
//     stuckWarning += '\n\n**Alternative D: Wait or Scroll**';
//     stuckWarning += '\n- Content not visible? → Scroll down to reveal it';
//     stuckWarning += '\n- Page loading? → Pause 2-3 seconds, then try again';
//     stuckWarning += '\n- Dynamic content? → Wait for it to appear';
//     stuckWarning += '\n\n**5. CHOOSE AND EXECUTE A DIFFERENT APPROACH**';
//     stuckWarning += '\n- Pick ONE alternative that makes sense for your current situation';
//     stuckWarning += '\n- Explain your reasoning: "I tried [X] which failed, so now I\'ll try [Y] because [reason]"';
//     stuckWarning += '\n- Execute the new approach';
//     stuckWarning += '\n- If this also fails, try a DIFFERENT alternative (not the same one again)';
//     stuckWarning += '\n\n**CRITICAL RULES:**';
//     stuckWarning += '\n- ❌ DO NOT repeat the same action that already failed';
//     stuckWarning += '\n- ❌ DO NOT make minor variations of the failed action (e.g., clicking slightly different coordinates)';
//     stuckWarning += '\n- ❌ DO NOT assume "maybe it will work this time"';
//     stuckWarning += '\n- ✅ DO try a fundamentally different approach';
//     stuckWarning += '\n- ✅ DO explain why you\'re changing your strategy';
//     stuckWarning += '\n- ✅ DO learn from what didn\'t work';
//     stuckWarning += '\n\n**EXAMPLE OF GOOD ADAPTIVE REASONING:**';
//     stuckWarning += '\n"I\'ve tried clicking the File menu 3 times without success. Looking at the screenshot,';
//     stuckWarning += '\nI see the menu bar but clicking isn\'t working. Instead, I\'ll use the keyboard shortcut';
//     stuckWarning += '\nCmd+N to create a new file, which bypasses the menu entirely."';
//     stuckWarning += '\n\n**EXAMPLE OF BAD REASONING (DON\'T DO THIS):**';
//     stuckWarning += '\n"Clicking the File menu again." ❌ (Same failed action!)';
//     stuckWarning += '\n"Trying to click File menu with slightly different coordinates." ❌ (Minor variation, not a new approach!)';
//   }

//   // Add mandatory focus check for input field interactions
//   let focusCheckSection = '';
//   const lastAction = previousActions[previousActions.length - 1];
//   const lastTwoActions = previousActions.slice(-2);
  
//   // Check if we just typed actual content (not a test character)
//   const justTypedContent = lastAction?.type === 'typeText' && 
//                           lastAction.text && 
//                           lastAction.text.length > 1 &&
//                           !lastAction.reasoning?.toLowerCase().includes('test');
  
//   // Check if we just typed a test character
//   const justTypedTestChar = lastAction?.type === 'typeText' && 
//                             lastAction.text?.length === 1 && 
//                             lastAction.reasoning?.toLowerCase().includes('test');
  
//   if (justTypedContent) {
//     focusCheckSection = '\n\n=== 🚨 MANDATORY TEXT VERIFICATION 🚨 ===';
//     focusCheckSection += `\n**You just attempted to type: "${lastAction.text}"**`;
//     focusCheckSection += '\n\n**CRITICAL - VERIFY THE TEXT ACTUALLY APPEARED:**';
//     focusCheckSection += '\n1. **LOOK at the screenshot RIGHT NOW:**';
//     focusCheckSection += `\n   - Do you SEE the text "${lastAction.text}" in the input field?`;
//     focusCheckSection += '\n   - **READ what is actually in the field** - do not assume!';
//     focusCheckSection += '\n   - Is the placeholder text still there? If YES → Text was NOT typed!';
//     focusCheckSection += '\n\n2. **If you SEE the text you typed:**';
//     focusCheckSection += '\n   - ✅ Text successfully appeared - proceed with next step (submit, etc.)';
//     focusCheckSection += '\n   - ✅ You can continue with the task';
//     focusCheckSection += '\n\n3. **If you DO NOT see the text (placeholder still visible or field empty):**';
//     focusCheckSection += '\n   - ❌ **TYPING FAILED** - The field was not focused!';
//     focusCheckSection += '\n   - ❌ **DO NOT press Enter** - there is nothing to submit!';
//     focusCheckSection += '\n   - ❌ **DO NOT continue** as if typing succeeded!';
//     focusCheckSection += '\n   - ✅ **REQUIRED ACTION**: Click the input field again to focus it';
//     focusCheckSection += '\n   - ✅ Then type a single test character to verify focus';
//     focusCheckSection += '\n   - ✅ Then delete test character and type the full text again';
//     focusCheckSection += '\n\n**🚨 ANTI-HALLUCINATION RULES 🚨**';
//     focusCheckSection += '\n- **NEVER assume typing succeeded** - you MUST see the text in the screenshot';
//     focusCheckSection += '\n- **NEVER press Enter** if the text is not visible in the field';
//     focusCheckSection += '\n- **NEVER say "I typed X"** unless you can SEE "X" in the current screenshot';
//     focusCheckSection += '\n- If you see placeholder text → Typing FAILED, field was not focused';
//     focusCheckSection += '\n- If you see empty field → Typing FAILED, field was not focused';
//     focusCheckSection += `\n- If you see "${lastAction.text}" → Typing SUCCEEDED, you can proceed`;
//     focusCheckSection += '\n\n**EXAMPLE - TYPING FAILED:**';
//     focusCheckSection += '\n- You typed: "best runners"';
//     focusCheckSection += '\n- Screenshot shows: "Ask anything. Type @ for mentions..." (placeholder)';
//     focusCheckSection += '\n- **CORRECT ACTION**: Click field again, type test char, verify, then retype';
//     focusCheckSection += '\n- **WRONG ACTION**: Press Enter (nothing to submit!)';
//     focusCheckSection += '\n\n**EXAMPLE - TYPING SUCCEEDED:**';
//     focusCheckSection += '\n- You typed: "best runners"';
//     focusCheckSection += '\n- Screenshot shows: "best runners" in the field';
//     focusCheckSection += '\n- **CORRECT ACTION**: Press Enter to submit';
//   }
//   else if (justTypedTestChar) {
//     focusCheckSection = '\n\n=== ⚠️ TEST CHARACTER CLEANUP REQUIRED ===';
//     focusCheckSection += '\n**You just typed a test character to verify focus.**';
//     focusCheckSection += '\n\n**MANDATORY NEXT STEPS:**';
//     focusCheckSection += '\n1. **LOOK at the screenshot**: Did the test character appear in the field?';
//     focusCheckSection += '\n   - **READ what you see** - is the test character visible?';
//     focusCheckSection += '\n   - **DO NOT assume** it appeared - VERIFY with your eyes!';
//     focusCheckSection += '\n2. **If YES (field is focused):**';
//     focusCheckSection += '\n   - ✅ **DELETE the test character first** (press Backspace OR Cmd+A then type)';
//     focusCheckSection += '\n   - ✅ **VERIFY deletion**: Next screenshot should show empty field or only your new text';
//     focusCheckSection += '\n   - ✅ Then type the full message';
//     focusCheckSection += '\n   - ✅ **VERIFY typing**: Next screenshot MUST show the full text you typed';
//     focusCheckSection += '\n   - ✅ **CRITICAL**: Do NOT type the full message without deleting the test character first!';
//     focusCheckSection += '\n3. **If NO (field not focused):**';
//     focusCheckSection += '\n   - ❌ Click the field again with adjusted coordinates';
//     focusCheckSection += '\n\n**EXAMPLE WORKFLOW:**';
//     focusCheckSection += '\n- Test char "a" appeared → Press Backspace → **VERIFY "a" is gone** → Type "this is cool" → **VERIFY "this is cool" appears** → Result: "this is cool" ✅';
//     focusCheckSection += '\n- Test char "a" did NOT appear → Field not focused → Click field again ❌';
//     focusCheckSection += '\n\n**🚨 ANTI-HALLUCINATION RULE 🚨**';
//     focusCheckSection += '\n- **NEVER say text was typed unless you SEE it in the screenshot**';
//     focusCheckSection += '\n- **NEVER say text was deleted unless you SEE it gone in the screenshot**';
//     focusCheckSection += '\n- If screenshot shows placeholder text only → Text was NOT typed';
//     focusCheckSection += '\n- If screenshot shows test character still there → It was NOT deleted';
//   }
  
//   // Check if we pressed Enter recently and are now waiting for results
//   const pressedEnterRecently = previousActions.slice(-3).some(a => a?.type === 'pressKey' && a?.key === 'Enter');
//   const nowWaitingForResults = lastAction?.type === 'waitForElement' && pressedEnterRecently;
  
//   // Check if we're stuck waiting after Enter press (Enter didn't submit the form)
//   if (nowWaitingForResults && context?.unchangedCount >= 1) {
//     focusCheckSection = '\n\n=== 🚨 CRITICAL - ENTER DIDN\'T SUBMIT, TRY SUBMIT BUTTON 🚨 ===';
//     focusCheckSection += '\n**SITUATION ANALYSIS:**';
//     focusCheckSection += '\n- You pressed Enter to submit the query';
//     focusCheckSection += '\n- You\'re now waiting for results to load';
//     focusCheckSection += '\n- BUT the UI is unchanged - results are NOT loading';
//     focusCheckSection += '\n- **This means: Enter did NOT submit the form**';
//     focusCheckSection += '\n\n**🔍 ANALYZE THE SCREENSHOT - What do you SEE?**';
//     focusCheckSection += '\n1. **Is your query text still visible in the input field?**';
//     focusCheckSection += '\n   - If YES → The form was NOT submitted, you\'re still on the search page';
//     focusCheckSection += '\n   - If NO → The page changed but results haven\'t loaded yet';
//     focusCheckSection += '\n\n2. **Do you see a submit button or icon?**';
//     focusCheckSection += '\n   - Look for: Search icon 🔍, arrow button →, "Go" button, "Submit" button';
//     focusCheckSection += '\n   - Look near the input field, to the right, or inside the field';
//     focusCheckSection += '\n   - On Perplexity: Look for a blue/cyan arrow button to the right of the input';
//     focusCheckSection += '\n\n**✅ REQUIRED ACTION:**';
//     focusCheckSection += '\n\n**If you SEE your query text still in the input field:**';
//     focusCheckSection += '\n→ The form was NOT submitted';
//     focusCheckSection += '\n→ STOP using waitForElement - results will never appear';
//     focusCheckSection += '\n→ **CLICK the submit button/icon** to actually submit the query';
//     focusCheckSection += '\n→ Use findAndClick with strategy "vision" to locate the submit button';
//     focusCheckSection += '\n→ Example: { "type": "findAndClick", "locator": { "strategy": "vision", "description": "submit button" } }';
//     focusCheckSection += '\n\n**If you DON\'T see your query text (page changed):**';
//     focusCheckSection += '\n→ The form WAS submitted, results are loading';
//     focusCheckSection += '\n→ Wait ONE more time for content to appear';
//     focusCheckSection += '\n→ If still no content after 2nd wait → Results have loaded, proceed';
//     focusCheckSection += '\n\n**CRITICAL RULES:**';
//     focusCheckSection += '\n- ❌ DO NOT keep using waitForElement if query is still in input field';
//     focusCheckSection += '\n- ❌ DO NOT press Enter again - it already failed';
//     focusCheckSection += '\n- ✅ DO click the submit button instead - it\'s more reliable';
//     focusCheckSection += '\n- ✅ DO describe what you see: "I see [query text in field], so I will [click submit button]"';
//     focusCheckSection += '\n\n**EXAMPLE - CORRECT ADAPTIVE BEHAVIOR:**';
//     focusCheckSection += '\n"I see \'how to integrate Stripe API\' still in the input field, which means Enter';
//     focusCheckSection += '\ndidn\'t submit the form. I also see a blue arrow button to the right of the input.';
//     focusCheckSection += '\nI will click this submit button to actually submit the query."';
//   }
//   // Check if we just pressed Enter but UI didn't change (frontend failed to execute)
//   else if (lastAction?.type === 'pressKey' && lastAction.key === 'Enter' && context?.uiChanged === false) {
//     focusCheckSection = '\n\n=== 🚨 CRITICAL - ENTER KEY FAILED, ADAPT YOUR APPROACH 🚨 ===';
//     focusCheckSection += '\n**SITUATION ANALYSIS:**';
//     focusCheckSection += '\n- You pressed Enter but the UI did NOT change';
//     focusCheckSection += '\n- This means: The Enter key was never actually executed by the system';
//     focusCheckSection += '\n- The query/form was NOT submitted - no results will appear';
//     focusCheckSection += '\n\n**🧠 ADAPTIVE PROBLEM-SOLVING REQUIRED 🧠**';
//     focusCheckSection += '\n\n**Step 1: ANALYZE THE CURRENT SCREENSHOT**';
//     focusCheckSection += '\n- What do you SEE in the screenshot right now?';
//     focusCheckSection += '\n- Is there a submit button visible? (Search icon, arrow, "Go", "Submit", "Send")';
//     focusCheckSection += '\n- Is the input field still focused? (text visible, cursor present)';
//     focusCheckSection += '\n- Are there any visual clues about how to submit? (icons, buttons, hints)';
//     focusCheckSection += '\n\n**Step 2: UNDERSTAND WHY ENTER FAILED**';
//     focusCheckSection += '\nPossible reasons:';
//     focusCheckSection += '\n- Frontend execution issue (system didn\'t receive the key press)';
//     focusCheckSection += '\n- Field lost focus (click happened elsewhere)';
//     focusCheckSection += '\n- Site doesn\'t support Enter key (requires button click)';
//     focusCheckSection += '\n- Site uses alternative submission (Cmd+Enter, Shift+Enter)';
//     focusCheckSection += '\n\n**Step 3: CHOOSE THE BEST ALTERNATIVE APPROACH**';
//     focusCheckSection += '\nBased on what you see, decide:';
//     focusCheckSection += '\n\n**If you see a submit button/icon:**';
//     focusCheckSection += '\n→ Click it directly (most reliable for web forms)';
//     focusCheckSection += '\n→ Examples: Search icon 🔍, arrow →, "Go" button, "Submit" button';
//     focusCheckSection += '\n→ This bypasses keyboard issues entirely';
//     focusCheckSection += '\n\n**If NO submit button visible:**';
//     focusCheckSection += '\n→ Re-focus the input field (click it again)';
//     focusCheckSection += '\n→ Pause briefly (500ms) to ensure focus';
//     focusCheckSection += '\n→ Try Enter again';
//     focusCheckSection += '\n\n**If Enter fails twice:**';
//     focusCheckSection += '\n→ Try keyboard modifiers: Cmd+Enter or Shift+Enter';
//     focusCheckSection += '\n→ Some sites use these for submission';
//     focusCheckSection += '\n\n**Step 4: EXECUTE YOUR CHOSEN APPROACH**';
//     focusCheckSection += '\n- Explain your reasoning: "I see [X] in the screenshot, so I will [Y]"';
//     focusCheckSection += '\n- Take the action that makes sense for THIS specific situation';
//     focusCheckSection += '\n- Don\'t follow a rigid script - adapt to what you observe';
//     focusCheckSection += '\n\n**CRITICAL RULES:**';
//     focusCheckSection += '\n- ❌ DO NOT press Enter again without changing your approach';
//     focusCheckSection += '\n- ❌ DO NOT wait for results - they won\'t come until you submit successfully';
//     focusCheckSection += '\n- ❌ DO NOT repeat the same failed action';
//     focusCheckSection += '\n- ✅ DO analyze the screenshot and choose a different method';
//     focusCheckSection += '\n- ✅ DO explain why you\'re choosing this new approach';
//     focusCheckSection += '\n- ✅ DO be flexible - there are multiple ways to submit a form';
//     focusCheckSection += '\n\n**EXAMPLE OF GOOD ADAPTIVE REASONING:**';
//     focusCheckSection += '\n"I see a blue arrow button to the right of the search field. Since Enter didn\'t work,';
//     focusCheckSection += '\nI\'ll click this submit button instead - it\'s the visual submission method for this site."';
//     focusCheckSection += '\n\n**EXAMPLE OF BAD REASONING (DON\'T DO THIS):**';
//     focusCheckSection += '\n"Pressing Enter again to submit the query." ❌ (Same failed action!)';
//   }
  
//   // Check if we just clicked an input field
//   else if (lastAction?.type === 'findAndClick' && lastAction.reasoning?.toLowerCase().includes('input')) {
//     focusCheckSection = '\n\n=== ⚠️ MANDATORY FOCUS VERIFICATION ===';
//     focusCheckSection += '\n**CRITICAL**: Screenshots lose subtle focus indicators (thin borders, cursor) due to compression.';
//     focusCheckSection += '\n**DO NOT rely on visual detection alone.**';
//     focusCheckSection += '\n\n**REQUIRED ACTION AFTER CLICKING INPUT FIELD:**';
//     focusCheckSection += '\n1. **First check**: Look for OBVIOUS indicators:';
//     focusCheckSection += '\n   - ✅ Text already typed in the field (even 1 character like "a")';
//     focusCheckSection += '\n   - ✅ Placeholder text completely gone/replaced';
//     focusCheckSection += '\n   - ✅ Very obvious border color change (bright blue, thick outline)';
//     focusCheckSection += '\n\n2. **If NO obvious indicators visible:**';
//     focusCheckSection += '\n   - ✅ **TYPE A SINGLE TEST CHARACTER** (e.g., "a") to verify focus';
//     focusCheckSection += '\n   - ✅ Check next screenshot: Did the "a" appear in the field?';
//     focusCheckSection += '\n   - ✅ If YES → **DELETE IT FIRST** (Backspace), then type the full message';
//     focusCheckSection += '\n   - ✅ If NO → Click the field again with adjusted coordinates';
//     focusCheckSection += '\n\n**DO NOT:**';
//     focusCheckSection += '\n❌ Click the same field repeatedly without testing';
//     focusCheckSection += '\n❌ Assume focus based on subtle visual changes you cannot clearly see';
//     focusCheckSection += '\n❌ Look for "blinking cursor" or "thin border" - these are invisible in screenshots';
//     focusCheckSection += '\n❌ Type full message without deleting test character first';
//     focusCheckSection += '\n\n**NEXT ACTION MUST BE:** Type a single test character OR type the full text if obvious indicators present';
//   }
  
//   // Check if we're stuck clicking the same input field repeatedly
//   if (lastTwoActions.length === 2 && 
//       lastTwoActions.every(a => a.type === 'findAndClick' && a.reasoning?.toLowerCase().includes('input'))) {
//     focusCheckSection += '\n\n**⚠️ WARNING: REPEATED INPUT FIELD CLICKING DETECTED**';
//     focusCheckSection += '\n- You clicked the input field 2+ times without testing focus';
//     focusCheckSection += '\n- **STOP CLICKING** and **START TYPING** to test if field is focused';
//     focusCheckSection += '\n- Type a single "a" character now to verify focus';
//   }
  
//   // Check if we just quit an app (task completion detection)
//   const justQuitApp = lastAction?.type === 'pressKey' && 
//                       lastAction.key === 'Q' && 
//                       lastAction.modifiers?.includes('Cmd');
  
//   let taskCompletionSection = '';
//   if (justQuitApp) {
//     taskCompletionSection = '\n\n=== 🎯 TASK COMPLETION CHECK ===';
//     taskCompletionSection += '\n**You just pressed Cmd+Q to quit an application.**';
//     taskCompletionSection += '\n\n**CRITICAL - Check if task is complete:**';
//     taskCompletionSection += '\n1. **Review the goal**: What app did the user want you to work with?';
//     taskCompletionSection += '\n2. **Check your actions**: Did you complete all required steps in that app?';
//     taskCompletionSection += '\n3. **If YES - Task is complete:**';
//     taskCompletionSection += '\n   - ✅ Return { "type": "end", "reasoning": "Successfully completed: [summary of what you did]" }';
//     taskCompletionSection += '\n   - ✅ DO NOT try to quit other applications';
//     taskCompletionSection += '\n   - ✅ DO NOT continue working - the task is done';
//     taskCompletionSection += '\n4. **If NO - More work needed:**';
//     taskCompletionSection += '\n   - ❌ Continue with the next step in the goal';
//     taskCompletionSection += '\n\n**EXAMPLE:**';
//     taskCompletionSection += '\n- Goal: "Open Slack, send message, quit app"';
//     taskCompletionSection += '\n- You: Opened Slack → Sent message → Pressed Cmd+Q';
//     taskCompletionSection += '\n- **CORRECT**: Return "end" action (task complete!)';
//     taskCompletionSection += '\n- **WRONG**: Try to quit other apps like terminal, browser, etc.';
//     taskCompletionSection += '\n\n**ONLY quit the app mentioned in the goal. Do not quit other apps!**';
//   }

//   // Self-awareness section - force LLM to analyze current state
//   let selfAwarenessSection = '\n\n=== 🧠 SELF-AWARENESS & ACTION VERIFICATION ===';
//   selfAwarenessSection += '\n**Before deciding your next action, you MUST explicitly state:**';
//   selfAwarenessSection += '\n\n1. **CURRENT STATE ANALYSIS:**';
//   selfAwarenessSection += '\n   - "In this screenshot, I see: [describe what you actually see]"';
//   selfAwarenessSection += '\n   - "The current UI state is: [describe app, page, focused element, etc.]"';
//   selfAwarenessSection += '\n   - "My last action was: [state previous action if any]"';
//   selfAwarenessSection += '\n   - "The result of my last action: [did it work? what changed?]"';
//   selfAwarenessSection += '\n\n2. **GOAL ALIGNMENT CHECK:**';
//   selfAwarenessSection += '\n   - "My overall goal is: [restate the user\'s goal]"';
//   selfAwarenessSection += '\n   - "The next step to achieve this goal is: [what needs to happen next]"';
//   selfAwarenessSection += '\n   - "Progress so far: [list completed steps]"';
//   selfAwarenessSection += '\n   - "Remaining steps: [list what still needs to be done]"';
//   selfAwarenessSection += '\n\n3. **NEXT ACTION REASONING:**';
//   selfAwarenessSection += '\n   - "I am about to: [describe the action you will take]"';
//   selfAwarenessSection += '\n   - "This action will: [explain what this action should accomplish]"';
//   selfAwarenessSection += '\n   - "After this action, I expect to see: [predict what the next screenshot will show]"';
//   selfAwarenessSection += '\n   - "This moves me toward the goal because: [explain how this helps]"';
//   selfAwarenessSection += '\n\n4. **VERIFICATION CHECKLIST:**';
//   selfAwarenessSection += '\n   - ✅ Have I looked at the ACTUAL screenshot (not assumptions)?';
//   selfAwarenessSection += '\n   - ✅ Am I ignoring automation popups showing my own reasoning?';
//   selfAwarenessSection += '\n   - ✅ Is this action moving FORWARD (not repeating completed steps)?';
//   selfAwarenessSection += '\n   - ✅ Do I have a clear expectation of what should happen next?';
//   selfAwarenessSection += '\n   - ✅ Am I working on the user\'s goal (not getting distracted)?';
//   selfAwarenessSection += '\n\n**CRITICAL RULES:**';
//   selfAwarenessSection += '\n- **NEVER assume** an action succeeded without seeing visual confirmation';
//   selfAwarenessSection += '\n- **ALWAYS describe** what you see in the current screenshot before acting';
//   selfAwarenessSection += '\n- **ALWAYS predict** what you expect to see after your action';
//   selfAwarenessSection += '\n- **ALWAYS verify** your prediction matches reality in the next screenshot';
//   selfAwarenessSection += '\n- If your prediction was WRONG → Adjust your approach, don\'t repeat the same action';
//   selfAwarenessSection += '\n\n**EXAMPLE OF GOOD SELF-AWARENESS:**';
//   selfAwarenessSection += '\n```';
//   selfAwarenessSection += '\nCurrent State: I see Windsurf IDE with capabilities.ts file highlighted in sidebar.';
//   selfAwarenessSection += '\nGoal: Copy code from capabilities.ts and paste in ChatGPT.';
//   selfAwarenessSection += '\nNext Action: Click capabilities.ts to open it in the editor.';
//   selfAwarenessSection += '\nExpected Result: File will open in center panel showing code content.';
//   selfAwarenessSection += '\nReasoning: I need to open the file before I can select and copy the code.';
//   selfAwarenessSection += '\n```';
//   selfAwarenessSection += '\n\n**EXAMPLE OF BAD BEHAVIOR (NO SELF-AWARENESS):**';
//   selfAwarenessSection += '\n```';
//   selfAwarenessSection += '\n❌ "Clicking the file" (no description of current state)';
//   selfAwarenessSection += '\n❌ "The file is now open" (assumption without verification)';
//   selfAwarenessSection += '\n❌ "Copying the code" (no prediction of what should happen)';
//   selfAwarenessSection += '\n```';
//   selfAwarenessSection += '\n\n**Your reasoning field MUST include this self-awareness analysis!**';
//   selfAwarenessSection += '\n\n**REASONING FORMAT** (human-readable):';
//   selfAwarenessSection += '\n- Keep reasoning clear and structured';
//   selfAwarenessSection += '\n- Use bullet points or short paragraphs';
//   selfAwarenessSection += '\n- State what you see, what you\'re doing, and why';
//   selfAwarenessSection += '\n- Example: "I see the ChatGPT input field centered on screen. I will click it to focus, then type the question. This is the first step in comparing ChatGPT vs Perplexity."';

//   return `You are a desktop automation agent.

// ${userGoal}${conversationHistorySection}${contextSection}${stepIntentSection}${milestonesSection}${reasoningFilterSection}${clarificationSection}${previousActionsSection}${focusCheckSection}${taskCompletionSection}${stuckWarning}${selfAwarenessSection}

// === CONTRACT ===

// OUTPUT FORMAT: Return ONLY valid JSON. No markdown. No explanations. No code fences.

// SCHEMA:
// - Action fields: type (enum), reasoning (string), plus type-specific fields
// - type MUST be one of the allowed action types
// - reasoning MUST explain why this action moves toward the goal

// ENUMS (single source of truth):
// - type: focusApp | openUrl | typeText | scroll | pause | screenshot | findAndClick | pressKey | waitForElement | log | end
// - OS: ${os}

// **NOTE**: click action is DEPRECATED and removed - use findAndClick instead

// === DECISION RULES ===

// **🚨 CRITICAL - IGNORE AUTOMATION POPUPS 🚨**
// - **NEVER click on popups showing "AI Thinking" or automation status**
// - These popups display YOUR OWN reasoning text - they are NOT part of the application UI
// - They appear as overlays with text like "I need to click...", "Typing...", etc.
// - **COMPLETELY IGNORE these popups** - they are not clickable and not part of your task
// - Only interact with the ACTUAL application UI elements (buttons, inputs, menus, etc.)
// - If you see a popup with your previous reasoning → Look PAST it to the real UI underneath

// **🚨 CRITICAL - COPYING CODE vs FILES 🚨**
// - **When goal says "copy code" or "copy file contents":**
//   1. ✅ Click the file in sidebar to OPEN it in the editor (center panel)
//   2. ✅ Wait for file to load in editor
//   3. ✅ Select all code: pressKey "A" with modifiers ["Cmd"]
//   4. ✅ Copy code: pressKey "C" with modifiers ["Cmd"]
//   5. ✅ This copies the CODE CONTENT, not the file path
                                                                                                                 
// - **WRONG workflow (copies file path, not code):**
//   - ❌ Click file in sidebar → Cmd+C → Only copies file path like "src/file.ts"
//   - ❌ Right-click file → Copy → Only copies file path

// - **CORRECT workflow (copies code content):**
//   - ✅ Click file in sidebar → File opens in editor → Cmd+A → Cmd+C → Copies actual code
//   - ✅ Verify: After Cmd+A, you should see ALL text in editor highlighted/selected
//   - ✅ Verify: After Cmd+C, the code content is in clipboard (not just filename)

// - **Key distinction:**
//   - Sidebar file tree = File management (clicking copies file path)
//   - Editor center panel = Code viewing (selecting + copying gets code content)
//   - **ALWAYS open file in editor before copying if goal mentions "code" or "contents"**

// BLOCKING SCREENS (HIGHEST PRIORITY):
// - Profile selection screen → Click ANY profile (first one is fine) to proceed
// - **Login/authentication screen → { "type": "end", "reason": "Need user input: login required", "reasoning": "..." }**
// - **NEVER hallucinate credentials** - if login is required, end and ask user to login first
// - Only AFTER clearing blocking screens can you proceed with main goal

// NAVIGATION:
// - Goal mentions app (ChatGPT, Slack, etc.) + on profile screen → Click profile FIRST, then focusApp
// - Goal mentions app + on desktop → focusApp directly
// - Web task + activeUrl matches target domain → Skip openUrl, use focusApp
// - Web task + activeUrl mismatch or missing → Use openUrl first
// - Desktop app task → Use focusApp (automatically fullscreens)

// **🚨 CRITICAL - WEB SEARCH ANTI-HALLUCINATION 🚨**
// **PROBLEM**: You keep claiming to see search results when the search box is EMPTY!

// **MANDATORY RULES FOR WEB SEARCHES** (Perplexity, Google, ChatGPT, etc.):

// 1. **BEFORE claiming results are loaded, CHECK THE SCREENSHOT:**
//    - ✅ **EMPTY search box** = NO query was typed = NO results exist
//    - ✅ **Placeholder text visible** ("Ask anything...", "Search Google") = Field is EMPTY
//    - ✅ **No text in search box** = You did NOT type the query yet
//    - ❌ **NEVER say "results are loaded" if search box is empty**

// 2. **WORKFLOW FOR WEB SEARCHES** (MUST follow this order):
   
//    Step 1: Navigate to website (openUrl)
//    Step 2: Click search/input field (findAndClick)
//    Step 3: Type the search query (typeText with full query text)
//    Step 4: Submit query (pressKey "Enter" OR findAndClick submit button)
//    Step 5: Wait for results to load (waitForElement OR pause)
//    Step 6: Verify results are visible (look for paragraphs, lists, content)
//    Step 7: Proceed with next task (copy, screenshot, etc.)

// 3. **VERIFICATION CHECKLIST** (before marking search step complete):
//    - ✅ Did I TYPE the query text? (Check: Is text visible in search box?)
//    - ✅ Did I SUBMIT the query? (Check: Did I press Enter or click submit?)
//    - ✅ Do I SEE actual results? (Check: Paragraphs, bullet points, content blocks?)
//    - ❌ If ANY answer is NO → Search is NOT complete, continue working

// 4. **WHAT SEARCH RESULTS LOOK LIKE**:
//    - ✅ Multiple paragraphs of text content
//    - ✅ Bullet points or numbered lists
//    - ✅ Source citations or links
//    - ✅ Code blocks or formatted content
//    - ✅ "Answer" or "Response" sections with substantial text
//    - ❌ Empty search box = NOT results
//    - ❌ Placeholder text only = NOT results
//    - ❌ Just the website homepage = NOT results

// 5. **EXAMPLE - CORRECT BEHAVIOR**:
//    Iteration 1: openUrl "https://perplexity.ai"
//    Iteration 2: findAndClick search box
//    Iteration 3: typeText "how to integrate Stripe API"
//    Iteration 4: pressKey "Enter"
//    Iteration 5: waitForElement "search results"
//    Iteration 6: SEE paragraphs of content → Results are ready!
//    Iteration 7: Proceed to copy/screenshot

// 6. **EXAMPLE - WRONG BEHAVIOR** (what you're doing now):
//    Iteration 1: openUrl "https://perplexity.ai"
//    Iteration 2: See empty search box
//    Iteration 3: log "STEP_COMPLETE" ❌ WRONG - you never typed!
//    Iteration 4-20: Keep taking screenshots claiming to see results ❌ HALLUCINATION

// **🚨 NEVER SKIP TYPING THE QUERY 🚨**
// - If search box is empty → You MUST type the query
// - If you don't see your query text in the box → It was NOT typed
// - If you don't see results content → Query was NOT submitted
// - **STOP HALLUCINATING** - Only claim results exist if you SEE them!

// **🚨 CRITICAL - WEBSITE NAVIGATION 🚨**
// **When goal mentions a SPECIFIC WEBSITE by name:**
// 1. **CHECK CURRENT URL FIRST**: Look at activeUrl in context
//    - Example: Goal says "goto Perplexity" but activeUrl shows "chatgpt.com" → WRONG SITE!
//    - Example: Goal says "goto ChatGPT" but activeUrl shows "perplexity.ai" → WRONG SITE!

// 2. **IF WRONG SITE OR NO URL**: Use openUrl action FIRST
//    - ✅ { "type": "openUrl", "url": "https://example.ai", "reasoning": "Navigating to Example as requested" }
//    - ✅ Wait for page to load (screenshot will show new site)
//    - ✅ THEN proceed with typing/searching

// 3. **IF CORRECT SITE**: Skip openUrl, proceed with task
//    - Example: Goal says "goto ChatGPT" and activeUrl is "chatgpt.com" → Already there, continue

// **NEVER assume you're on the right website without checking activeUrl!**

// UI STATE CHANGES:
// - After clicking toggles/buttons that change UI → Add pause (1000-1500ms) to verify
// - Never assume success without verification
// - Sidebar collapsed → Click hamburger menu (☰) to expand before searching
// - List truncated → Look for "See More" button or scroll

// === SPATIAL CONTEXT ===

// 1. **Pixel-Accurate Coordinates**:
//    - **CRITICAL**: The screenshot you're analyzing has EXACT dimensions (Screenshot Dimensions in context)
//    - **Coordinate System**: Return coordinates in PIXELS relative to the screenshot image
//      * (0, 0) = top-left corner of the screenshot
//      * (Screenshot Width, Screenshot Height) = bottom-right corner
//      * Example: If screenshot is 1440x900, valid coordinates are 0-1440 for X, 0-900 for Y
//    - **Precision**: Count pixels carefully - your coordinates will be used for mouse clicks
   
//    - **CRITICAL - Fullscreen Strategy**:
//      * **focusApp automatically fullscreens the application** - no separate fullscreen action needed
//      * This eliminates desktop background noise and prevents confusion with desktop folders
//      * After focusApp, the entire screenshot will be the application UI (no desktop folders visible)
//      * Example flow: focusApp → findAndClick (sidebar item)
   
//    - **CRITICAL - Desktop vs Application Context (Multi-Layer UI)**:
//      * The screenshot may show a FULL DESKTOP with multiple UI layers:
//        1. **Desktop Background** (wallpaper, bottom layer)
//        2. **Desktop Folders/Icons** (typically right side - blue/colored folder icons)
//        3. **OS Menu Bar** (top of screen - system menu)
//        4. **Dock/Taskbar** (bottom/side - app launcher icons)
//        5. **Application Window** (browser, desktop app - contains the target interface)
//        6. **Web/App Interface** (the actual application UI - INSIDE the window)
     
//      * **CRITICAL DISTINCTION - Desktop Files vs Application Content**:
//        → Desktop folders/files = OS-level icons (usually on right/desktop background)
//        → Application content = UI elements INSIDE the application window
//        → **NEVER confuse desktop folders with application UI elements**
//        → If goal mentions "sidebar", "panel", "project", "conversation" → Look INSIDE the application window
     
//      * **When Uncertain About UI Layout**:
//        → **STOP and use self-learning** (Google Image Search for "[app name] interface screenshot")
//        → Don't guess - verify what you're looking for before taking action
//        → If you can't find an element after 2 attempts, acknowledge uncertainty and search for visual reference

// 2. **Common UI Patterns** (works for ChatGPT, Claude, Grok, Perplexity, Gemini, etc.):
//    - **Collapsed Sidebar**: If sidebar is collapsed (narrow ~50px), look for hamburger menu (☰) icon to expand it first
//    - **Conversation/Project Lists**: Usually in left sidebar (0-300px from left edge when expanded)
//    - **"See More" / "Show More" Buttons**: Conversation lists often truncate - look for expand buttons at bottom of list
//    - **Scrollable Lists**: If element not visible, try scrolling in the sidebar area before giving up
//    - **Chat Input**: Usually at bottom center of screen
//    - **Send Button**: Adjacent to input field (right side or below)
//    - **Settings/Profile**: Usually top-right corner
//    - **New Chat/Conversation**: Usually top-left or in sidebar header
//    - **Search**: Usually top bar or sidebar header

// 3. **Sequential Task Execution**:
//    - Break multi-step goals into logical sequence
//    - **CRITICAL - Application Navigation Flow**:
//      → **Step 0 (MANDATORY)**: If goal mentions an app (ChatGPT, Slack, etc.) and you're NOT in that app → Use focusApp FIRST
//      → **Why**: focusApp automatically fullscreens the app, eliminating desktop folder confusion
//      → **Example**: Goal mentions "ChatGPT" → First action MUST be focusApp with appName: "Google Chrome"
//    - Example: "Find project X in ChatGPT and ask about Y"
//      → Step 0: If on Chrome profile selection → Select ANY profile (first one is fine) to get into Chrome
//      → Step 1: focusApp (Google Chrome) - triggers fullscreen automatically
//      → Step 2: openUrl (https://chat.openai.com) if not already on ChatGPT
//      → Step 3: Check if sidebar is expanded (if collapsed, click hamburger menu)
//      → Step 4: Locate project in sidebar/list
//      → Step 5: Click to open it
//      → Step 6: Wait for content to load (pause 2-3s)
//      → Step 7: Click input field
//      → Step 8: Type query
//      → Step 9: Submit
//    - Never skip steps or assume state changes happened without verification
//    - **CRITICAL**: If you're on a profile/login screen, you CANNOT proceed with the main goal until you complete the profile/login flow

// 4. **Smart Navigation Decision-Making**:
//    - **CRITICAL - Profile/Login Screens**: If you see a profile selection or login screen:
//      * This means you're NOT yet in the app - complete the login/profile selection FIRST
//      * Select the appropriate profile/account
//      * THEN use focusApp to fullscreen the app
//      * Example: Chrome profile selection → Click profile → focusApp (Google Chrome) → Navigate to ChatGPT
   
//    - **MANDATORY FIRST ACTION**: If goal mentions specific app (ChatGPT, Claude, Slack, etc.) and you're on desktop or profile screen → Navigate to that app first
//      * If on profile selection → Select profile FIRST, then focusApp
//      * If on desktop → focusApp directly
   
//    - If goal mentions "sidebar", "panel", "conversation", "project" → Look INSIDE the active app window, not desktop
//    - **CRITICAL - Check Sidebar State First**: Before searching for items in sidebar, verify if sidebar is expanded or collapsed
//      * Collapsed sidebar = narrow vertical bar (~50px wide) with only icons
//      * Expanded sidebar = wide panel (~250-300px) showing full conversation/project names
//      * If collapsed, MUST click hamburger menu (☰) icon first to expand before searching for items
//    - **Check for Truncated Lists**: If sidebar is expanded but item not visible, look for:
//      * "See More" / "Show More" button at bottom of list
//      * Scroll indicator or scrollable area
//      * Try scrolling down in the sidebar before assuming item doesn't exist
//    - If UI hasn't changed after 3 identical actions → Try different approach or acknowledge limitation

// 5. **Vision-Based Element Location**:
//    - **CRITICAL**: ALWAYS specify the application context in your description
//    - **WRONG**: "project folder in the right sidebar" (ambiguous - could be desktop folder!)
//    - **CORRECT**: "project item in the [app name] left sidebar conversation list"
//    - **Template**: "[element name] in the [app name] [specific UI area]"
//    - Examples:
//      * "Send button in the [app name] message input area at the bottom"
//      * "New conversation button in the [app name] left sidebar header"
//      * "Settings icon in the [app name] top-right corner"
//    - If element not found (0,0 coordinates) → Try broader description or different strategy
//    - **NEVER use generic terms like "sidebar" or "panel" without specifying the application name**

// 6. **Application-Specific Adaptability**:
//    - AI Chat Apps (ChatGPT, Claude, Grok, Gemini, Perplexity): Sidebar for history, input field location VARIES
//    - Email Apps: Left panel for folders, center for message list, right for preview
//    - Browsers: Top for tabs/address bar, main area for content
//    - Code Editors: Left for file tree, center for editor, right for panels
//    - **CRITICAL**: Adapt your approach based on what you SEE in the screenshot, not assumptions
   
//    **🚨 CRITICAL - ADAPTIVE UI POSITIONING IN CHAT APPS 🚨**
//    - **NEVER assume input field is at the bottom** - UI layout changes based on context:
//      * Empty/new chat → Input field is CENTERED vertically on page (middle of screen)
//      * Active conversation → Input field is at BOTTOM of screen
//      * Different apps have different layouts
   
//    - **REQUIRED WORKFLOW - Locating Input Fields**:
//      1. ✅ **LOOK at the screenshot** - Where is the input field actually located?
//      2. ✅ **DESCRIBE the position** - "I see the input field at [top/middle/bottom] of screen"
//      3. ✅ **USE VISION API** - Never assume coordinates, use findAndClick with vision strategy
//      4. ✅ **VERIFY after click** - Check if field is focused before typing
   
//    - **WRONG behavior (assumption-based):**
//      * ❌ "Input field is at bottom" (assumption without looking)
//      * ❌ "Clicking at coordinates (500, 800)" (hardcoded bottom position)
//      * ❌ "The input field should be here" (should ≠ is)
   
//    - **CORRECT behavior (observation-based):**
//      * ✅ "I see the input field centered at approximately Y=310 in the screenshot"
//      * ✅ "Using vision API to locate 'Ask anything' input field"
//      * ✅ "The input field is in the middle of the screen, not at the bottom"
   
//    - **Examples of UI variations:**
//      * ChatGPT new chat: Input centered with "What's on the agenda today?"
//      * ChatGPT conversation: Input at bottom with previous messages above
//      * Claude new chat: Input centered with prompt suggestions
//      * Slack: Input always at bottom of channel
   
//    **CRITICAL - Message Submission in Chat Apps**:
//    - **ALWAYS use Enter key to send messages** in chat applications (Slack, Discord, Teams, etc.)
//    - **DO NOT click send buttons** - they are unreliable and harder to locate accurately
//    - After typing a message in a focused input field → Press Enter to send
//    - Example workflow: Click input → Type message → Press Enter (NOT click send button)
//    - This applies to: Slack, Discord, Microsoft Teams, WhatsApp Web, Telegram, etc.
//    - Only click send buttons if Enter key explicitly fails after 2 attempts

// 6. **SELF-LEARNING CAPABILITY** (Meta-Cognitive Enhancement):
//    **CRITICAL**: Before making assumptions about unfamiliar UI elements, VERIFY your understanding.
   
//    **Triggers for Self-Learning** (use Google Image Search):
//    - ✅ Can't find an element after 2 attempts with different descriptions
//    - ✅ Unfamiliar application interface (never seen it before)
//    - ✅ Ambiguous UI terminology in the goal ("sidebar", "panel" in unfamiliar app)
//    - ✅ Uncertain about where specific features are located
//    - ✅ Making assumptions about UI layout without visual confirmation
   
//    **Self-Learning Process**:
//    1. **Recognize uncertainty**: "I'm not certain where [element] is in [app name]"
//    2. **Navigate to Google Images**: openUrl → "https://www.google.com/imghp"
//    3. **Search**: "[app name] [element] screenshot" (e.g., "Perplexity sidebar screenshot")
//    4. **Analyze results**: Take screenshot, review UI layout
//    5. **Return to task**: Navigate back to target app
//    6. **Apply knowledge**: Use verified understanding to locate element
   
//    **Additional Self-Learning Options**:
//    - **Concepts/APIs**: Search web or ask AI for definitions
//    - **Current events**: Google search for recent information
//    - **Technical terms**: Look up documentation or examples
   
//    **Important**: 
//    - Self-learning is REQUIRED when uncertain, not optional
//    - Don't guess UI locations - verify first
//    - This prevents wasted iterations on incorrect assumptions

// 8. **VISUAL FOCUS DETECTION & TRIAL-AND-ERROR TESTING** (Human-Like Debugging):
//    **CRITICAL**: When interacting with input fields, OBSERVE visual indicators like a human would:
   
//    **Visual Focus Indicators to Look For**:
//    - ✅ **Blinking cursor** visible inside the input field (thin vertical line)
//    - ✅ **Border highlight** or color change (e.g., blue border when focused)
//    - ✅ **Placeholder text dimmed** or changed appearance when focused
//    - ✅ **Active state styling** (shadow, glow, different background color)
   
//    **Trial-and-Error Testing When Uncertain**:
//    - If you clicked an input field but UNSURE if it's focused:
//      * **Test 1**: Type a single test character (e.g., "a") and observe if it appears
//      * **Test 2**: Look for cursor blinking in the next screenshot
//      * **Test 3**: Check if placeholder text behavior changed
   
//    - If first click doesn't work (no visual change):
//      * **Adjust coordinates**: Try clicking ±10-20px in different directions
//      * **Example**: First click at (500, 778) failed → Try (510, 778), then (500, 788)
//      * **Observe result**: Check each screenshot for cursor/focus indicators
   
//    - If element found but click seems off:
//      * **Don't repeat same coordinates** - adjust position slightly
//      * **Try different parts** of the element (top, center, bottom)
//      * **Look for visual feedback** after each attempt
   
//    **Success Detection for Input Fields**:
//    - ✅ Cursor visible = Field is focused, ready for typing
//    - ✅ Border highlighted = Field is active
//    - ✅ Test character appeared = Focus confirmed, proceed with full text
//    - ❌ No visual change after 2-3 attempts = Try different strategy (keyboard navigation, different coordinates)
   
//    **Example Workflow**:
//    1. Click input field at detected coordinates
//    2. **Check screenshot**: Is cursor visible? Border highlighted?
//    3. If YES → Proceed with typing
//    4. If NO → Type single "a" to test focus
//    5. If "a" appears → Field is focused, continue typing
//    6. If nothing happens → Adjust click coordinates ±10-20px and retry
//    7. **Maximum 3 coordinate adjustments** before trying different approach (Tab key, etc.)
   
//    **CRITICAL**: Don't assume focus without visual confirmation. Use your eyes like a human would!

// === ACTION PRIMITIVES ===

// Each action has: type (enum) + type-specific fields + reasoning (string)

// **🚨 CRITICAL STRATEGY SELECTION RULE 🚨**
// For findAndClick actions:

// **PRIORITY ORDER (use first applicable strategy):**

// 1. **TEXT STRATEGY (HIGHEST PRIORITY)** - Use frontend OCR for ANY visible text:
//    - ✅ Input field placeholders: "Ask anything", "Type a message", "Search"
//    - ✅ Buttons with text: "Save", "Cancel", "Send", "Submit"
//    - ✅ Labels and headings: "Settings", "Profile", "New Chat"
//    - ✅ Menu items: "File", "Edit", "View"
//    - ✅ Links with text: "Learn more", "Sign in"
//    - **Frontend OCR (Tesseract.js) handles text detection - fast and accurate**

// 2. **IMAGE STRATEGY** - For icons without text:
//    - ✅ Hamburger menu icon (☰)
//    - ✅ Settings gear icon
//    - ✅ Close/minimize/maximize buttons

// 3. **ELEMENT STRATEGY** - For native OS elements:
//    - ✅ macOS menu bar items
//    - ✅ System dialogs and buttons

// 4. **VISION STRATEGY (LAST RESORT)** - Only when text/image/element fail:
//    - ❌ Avoid for text elements - frontend OCR is better
//    - ✅ Use only for: complex UI patterns, non-text visual elements, spatial relationships
//    - **Backend Vision API is slow and less accurate than frontend OCR**

// **Key principle**: Frontend OCR (text strategy) is PRIMARY. Vision API is FALLBACK ONLY.

// 1. focusApp - Switch to desktop app (automatically fullscreens)
//    { "type": "focusApp", "appName": "Google Chrome", "reasoning": "..." }

// 2. openUrl - Navigate to URL
//    { "type": "openUrl", "url": "https://some-web-page.com", "reasoning": "..." }

// 3. findAndClick - Native element detection (REQUIRED for all UI elements)
//    **PREFERRED STRATEGIES** (fast, accurate, local):
   
//    a) Text-based (for buttons, labels, menu items with visible text):
//    { "type": "findAndClick", "locator": { "strategy": "text", "value": "Save", "context": "button", "description": "Save button" }, "reasoning": "..." }
   
//    **EXAMPLES OF WHEN TO USE TEXT STRATEGY (MOST COMMON):**
//    - Input field placeholders: "Ask anything", "Type a message", "Jot something down"
//    - Buttons with text: "Save", "Cancel", "Send", "Submit", "OK", "Close"
//    - Menu items: "File", "Edit", "View", "Help"
//    - Links with text: "Learn more", "Sign in", "Get started"
//    - Labels: "Username", "Password", "Email", "Settings"
//    - **ANY UI element with visible text - use strategy: "text" with the EXACT visible text as value**
//    - **CRITICAL**: Look at the screenshot and READ the text - don't describe it, USE it
//    - **Frontend OCR will detect the text coordinates - you just provide the text value**
   
//    b) Image-based (for icons without text):
//    { "type": "findAndClick", "locator": { "strategy": "image", "value": "textedit-icon", "context": "dock", "description": "TextEdit icon in dock" }, "reasoning": "..." }
   
//    c) Element-based (for native UI elements with accessibility info):
//    { "type": "findAndClick", "locator": { "strategy": "element", "value": "File", "role": "menuItem", "description": "File menu item" }, "reasoning": "..." }
   
//    **FALLBACK STRATEGY** (slower, less accurate - avoid if possible):
//    d) Vision-based (ONLY when text/image/element all fail):
//    { "type": "findAndClick", "locator": { "strategy": "vision", "description": "blue circular icon in top right corner" }, "reasoning": "..." }
   
//    - **CRITICAL**: ALWAYS include "description" field in ALL locators (used for Vision API fallback)
//    - **CRITICAL**: ALWAYS prefer text strategy first - frontend OCR is faster and more accurate than Vision API
//    - **Text strategy**: Use exact visible text (case-sensitive) - triggers frontend OCR (Tesseract.js)
//    - **Image strategy**: Reference icon name (frontend has icon templates)
//    - **Element strategy**: Use accessibility role + title for native OS elements
//    - **Vision strategy**: LAST RESORT - only for non-text visual elements without icon templates
//    - Description field: Natural language description for Vision API fallback
//    - **NEVER use vision strategy for text elements** - always use text strategy instead
//    - NEVER use direct click coordinates - they are inaccurate


// 4. typeText - Type literal text (NOT for shortcuts)
//    { "type": "typeText", "text": "Hello world", "submit": false, "reasoning": "..." }
   
//    **🚨 CRITICAL - VISUAL GROUNDING AFTER TYPING 🚨**
//    After ANY typeText action, you MUST:
//    1. **DESCRIBE what you SEE** in the input field in the screenshot:
//       - Quote the EXACT text visible: "I see the text '[exact text]' in the field"
//       - If placeholder only: "I see only placeholder text '[placeholder]' - NO typed text"
//       - If empty: "I see an empty field - NO text"
//    2. **COMPARE** what you see vs what you typed:
//       - Match: "Text matches - typed 'hello' and see 'hello' ✅"
//       - Mismatch: "Text does NOT match - typed 'hello' but see only placeholder ❌"
//    3. **DO NOT assume** the text was typed just because you sent the action
//    4. **If text is NOT visible** in the screenshot:
//       - The typing failed (wrong field focused, clipboard issue, etc.)
//       - DO NOT proceed to next step
//       - Try clicking the field again or use different approach
//    5. **ONLY proceed** if you can SEE and QUOTE the exact text you typed in the screenshot
   
//    **ANTI-HALLUCINATION CHECK:**
//    - ❌ WRONG: "The text has been typed" (vague, no visual confirmation)
//    - ❌ WRONG: "I can see the text in the field" (no specific quote)
//    - ✅ CORRECT: "I see the exact text 'this is cool' in the input field" (specific quote)
//    - ✅ CORRECT: "I see only placeholder 'Jot something down' - my text did NOT appear" (honest failure)
   
//    **Example of CORRECT behavior**:
//    - Action: typeText "this is cool"
//    - Next screenshot: Look at input field
//    - ✅ SEE "this is cool" in field → Proceed to submit
//    - ❌ DON'T see text → Field not focused, retry click
   
//    **Example of WRONG behavior (HALLUCINATION)**:
//    - Action: typeText "this is cool"
//    - Next screenshot: Input field shows only placeholder text
//    - ❌ WRONG: "The message 'this is cool' has been typed (as shown by the text appearing)"
//    - ✅ CORRECT: "I don't see the text in the field. The input field still shows placeholder. Need to click field again."
   
//    **NEVER say text was typed unless you can SEE it in the screenshot!**

// 6. pressKey - Keyboard shortcuts and special keys
//    { "type": "pressKey", "key": "Enter", "modifiers": ["Cmd"], "reasoning": "..." }
//    Modifiers: "Cmd" (macOS), "Ctrl" (Windows/Linux), "Shift", "Alt"

// 7. scroll - Scroll in direction
//    { "type": "scroll", "direction": "down", "amount": 300, "reasoning": "..." }

// 8. pause - Wait milliseconds
//    { "type": "pause", "ms": 1500, "reasoning": "..." }

// 9. waitForElement - Wait for element to appear (CRITICAL for verification)
//    { "type": "waitForElement", "locator": { "strategy": "vision", "description": "assistant response visible" }, "timeoutMs": 5000, "reasoning": "..." }
//    - Use after actions that change state (submit, send, navigate)
//    - Ensures next action doesn't proceed until UI is ready
//    - Example: After pressing Enter → waitForElement for response → screenshot result
   
//    **🚨 CRITICAL - ADAPTIVE CONTENT DETECTION 🚨**
   
//    **PROBLEM**: You keep using waitForElement when content is ALREADY VISIBLE!
   
//    **ANALYZE THE SCREENSHOT - What do you actually SEE?**
   
//    **Signs content is STILL LOADING** (use waitForElement):
//    - Empty/blank page after just submitting
//    - Loading spinner, progress bar, or "Loading..." text
//    - "Thinking...", "Generating...", or similar indicators
//    - Page just changed but no content appeared yet
   
//    **Signs content HAS LOADED** (STOP waiting, proceed):
//    - Multiple paragraphs of text (3+ lines)
//    - Bullet points or numbered lists
//    - Section headers or titles
//    - Images, videos, or media content
//    - Tables, code blocks, or formatted content
//    - Links, buttons, or interactive elements
//    - ANY substantial visible content
   
//    **ADAPTIVE DECISION-MAKING**:
   
//    **Step 1: OBSERVE**
//    Look at the screenshot and describe what you see:
//    - Is the page mostly empty or populated with content?
//    - Do you see text, images, or UI elements?
//    - Is there a loading indicator?
   
//    **Step 2: REASON**
//    Based on what you observe:
//    - Empty + just submitted → Content is loading, wait is appropriate
//    - Substantial content visible → Content has loaded, proceed
//    - Already waited 2+ times + unchanged → Content won't appear, move on
   
//    **Step 3: DECIDE**
//    Choose the appropriate action:
//    - See loading indicator? → waitForElement (once)
//    - See substantial content? → Scroll to check for more, then proceed
//    - Waited 2+ times already? → Stop waiting, proceed with what's visible
   
//    **Step 4: ACT**
//    Execute your decision with clear reasoning:
//    "I see [what's in screenshot], which means [interpretation], so I will [action]"
   
//    **CRITICAL RULES**:
//    - ❌ DO NOT wait if you see substantial content already loaded
//    - ❌ DO NOT wait more than 2 times in a row for the same thing
//    - ❌ DO NOT assume content is loading when you see paragraphs of text
//    - ✅ DO describe what you actually see in the screenshot
//    - ✅ DO scroll to check for more content instead of waiting repeatedly
//    - ✅ DO proceed with visible content rather than waiting indefinitely
//    - ✅ DO adapt your approach based on visual observations

// 10. screenshot - Capture screen
//     { "type": "screenshot", "tag": "verify_state", "reasoning": "..." }

// 11. log - Log message for debugging
//     { "type": "log", "level": "info", "message": "Starting task", "reasoning": "..." }
//     - Levels: "info" | "warn" | "error"
//     - Use to mark progress milestones or debug issues

// 12. end - End execution
//     { "type": "end", "reason": "Goal achieved", "reasoning": "..." }

// CRITICAL: typeText vs pressKey
// - typeText: Literal text only (messages, filenames, search queries)
// - pressKey: Keyboard shortcuts (Cmd+A, Cmd+C, Enter, Tab, etc.)
// - WRONG: { "type": "typeText", "text": "Cmd+A" } → Types "C-m-d-+-A" literally
// - CORRECT: { "type": "pressKey", "key": "A", "modifiers": ["Cmd"] } → Selects all

// === COMPARISON TASK PLAYBOOK ===

// **When goal involves comparing multiple AI assistants (ChatGPT vs Perplexity, etc.):**

// **Required workflow:**
// 1. Focus browser → Open first AI (ChatGPT)
// 2. Locate input → Type question → Submit
// 3. **waitForElement** (assistant response visible) → **screenshot tag "chatgpt_result"**
// 4. Open second AI (Perplexity)
// 5. Locate input → Type same question → Submit
// 6. **waitForElement** (answer visible) → **screenshot tag "perplexity_result"**
// 7. **end** with comparison summary

// **Comparison criteria (in order of importance):**
// 1. **Correctness**: Is the answer factually accurate?
// 2. **Citations**: Does it provide sources/references?
// 3. **Clarity**: Is the explanation clear and well-structured?
// 4. **Conciseness**: Is it brief without losing important details?

// **Example end reasoning (human-readable format for comparison results):**
// \`\`\`json
// {
//   "type": "end",
//   "reason": "Comparison complete",
//   "reasoning": "Comparison Results:\\n\\nChatGPT Response:\\n- Correctness: ✅ Accurate (confirmed 1+1=2)\\n- Citations: ❌ No sources provided\\n- Clarity: ✅ Clear and well-explained\\n- Conciseness: ✅ Brief and to the point\\n\\nPerplexity Response:\\n- Correctness: ✅ Accurate (confirmed 1+1=2)\\n- Citations: ✅ Included mathematical proof and sources\\n- Clarity: ✅ Clear explanation with step-by-step reasoning\\n- Conciseness: ✅ Comprehensive yet concise\\n\\nVerdict: Perplexity provides a better response due to superior citations and mathematical proof, making it more authoritative and educational."
// }
// \`\`\`

// **NOTE**: Always use human-readable format for reasoning - clear, structured, and easy to understand.

// **CRITICAL**: Use **screenshot with tags** to capture results for comparison.

// === EXECUTION RULES ===

// 1. Return ONLY ONE action as valid JSON
// 2. No markdown fences, no explanations outside JSON
// 3. Include "reasoning" field in human-readable format (clear description of what you see, what you're doing, and why)
// 4. **After state-changing actions** → Use waitForElement OR screenshot to verify
// 5. If goal achieved → { "type": "end", "reason": "Goal achieved", "reasoning": "..." }
// 6. If need user input → { "type": "end", "reason": "Need user input: [what is needed]", "reasoning": "..." }
// 7. If stuck or impossible → { "type": "end", "reason": "[explain why]", "reasoning": "..." }

// Now analyze the screenshot and return the next action:`;
// }

async function analyzeWithAnthropic(
  prompt: string,
  screenshot: { base64: string; mimeType: string }
): Promise<ComputerAction> {
  if (!anthropicClient) {
    throw new Error('Anthropic client not initialized');
  }

  logger.info('📤 [COMPUTER-USE] Sending request to Claude', {
    model: 'claude-3-5-haiku-20241022',
    promptLength: prompt.length,
  });

  const response = await anthropicClient.messages.create({
    model: 'claude-3-5-haiku-20241022',
    max_tokens: 1000,
    temperature: 0,
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

async function analyzeWithGemini(
  prompt: string,
  screenshot: { base64: string; mimeType: string }
): Promise<ComputerAction> {
  if (!geminiClient) {
    throw new Error('Gemini client not initialized');
  }

  logger.info('📤 [COMPUTER-USE] Sending request to Gemini', {
    model: 'gemini-2.0-flash',
    promptLength: prompt.length,
  });

  const model = geminiClient.getGenerativeModel({ 
    model: 'gemini-2.0-flash',
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1000,
    },
  });

  const result = await model.generateContent([
    {
      inlineData: {
        mimeType: screenshot.mimeType,
        data: screenshot.base64,
      },
    },
    { text: prompt },
  ]);

  const response = await result.response;
  const text = response.text();

  logger.info('📥 [COMPUTER-USE] Received response from Gemini', {
    hasContent: !!text,
    textLength: text.length,
  });

  logger.debug('[COMPUTER-USE] Gemini raw response', {
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
    model: 'gpt-4o-mini',
    promptLength: prompt.length,
  });

  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4o-mini',
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
    
    // Fix unescaped newlines in string values (Claude formatting issue)
    // Replace literal newlines within quoted strings with escaped \n
    cleaned = cleaned.replace(/"([^"]*?)"/g, (match, content) => {
      return '"' + content.replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t') + '"';
    });
    
    // Remove trailing commas before closing braces/brackets (common LLM mistake)
    cleaned = cleaned.replace(/,(\s*[}\]])/g, '$1');
    
    // Log the cleaned JSON for debugging
    logger.debug('📋 [COMPUTER-USE] Cleaned JSON before parsing', {
      service: 'bibscrip-backend',
      cleaned: cleaned.substring(0, 300),
      length: cleaned.length,
    });
    
    const action = JSON.parse(cleaned);

    if (!action.type) {
      throw new Error('Action missing "type" field');
    }

    return action as ComputerAction;
  } catch (error: any) {
    logger.error('Failed to parse action from response', {
      response: response.substring(0, 500),
      cleaned: response.replace(/```(?:json)?\n?/g, '').trim().substring(0, 500),
      error: error.message,
      errorStack: error.stack,
    });
    
    return {
      type: 'end',
      reason: 'Failed to parse LLM response',
      reasoning: `Failed to parse action: ${error.message}`,
    };
  }
}

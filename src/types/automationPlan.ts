/**
 * Context-Aware Automation Plan Types
 * 
 * Architecture:
 * - LLM generates structured JSON plans (not raw code)
 * - Frontend interpreter executes steps using NutJS + screen-intel
 * - Plans support retries, replanning, and user questions
 * - Low-level steps for debuggability and cross-app compatibility
 */

// ============================================================================
// CORE TYPES
// ============================================================================

export type AutomationIntent = 'command_automate' | 'command_guide';

export type StepStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

// ============================================================================
// STEP KINDS (Low-level, debuggable actions)
// ============================================================================

/**
 * Vision-based element locator
 * Uses LLM vision to find elements in screenshots
 */
export interface VisionLocator {
  /** Matching strategy */
  strategy: 'vision' | 'textMatch' | 'contains' | 'regex' | 'bbox';
  
  /** Natural language description for vision strategy */
  description?: string;  // e.g., "the blue Send button in the bottom right"
  
  /** Text to match (for textMatch/contains) */
  text?: string;
  
  /** Regex pattern (for regex strategy) */
  regex?: string;
  
  /** Normalized bounding box [x, y, width, height] (for bbox strategy) */
  bbox?: [number, number, number, number];
  
  /** UI role hint for better matching */
  roleHint?: 'button' | 'input' | 'tab' | 'image' | 'link' | 'checkbox' | 'menu';
  
  /** Contextual hint like "near 'New chat'" */
  contextWindow?: string;
}

/** @deprecated Use VisionLocator instead */
export type OcrLocator = VisionLocator;

/**
 * Discriminated union of all possible step types
 * LLM must emit one of these - no arbitrary code execution
 * 
 * NOTE: Must match frontend interpreter valid types:
 * ['focusApp', 'openUrl', 'typeText', 'hotkey', 'click', 'scroll', 
 *  'pause', 'apiAction', 'waitForElement', 'screenshot', 'findAndClick', 
 *  'log', 'pressKey', 'end']
 */
export type AutomationStepKind =
  // UI Primitives (NutJS "hands + eyes")
  | { type: 'focusApp'; appName: string }
  | { type: 'openUrl'; url: string }
  | { type: 'waitForElement'; locator: VisionLocator; timeoutMs: number }
  | { type: 'findAndClick'; locator: VisionLocator; timeoutMs?: number }
  | { type: 'movePointer'; target: VisionLocator | { x: number; y: number } }
  | { type: 'click'; x?: number; y?: number }  // Frontend uses x, y directly (not coordinates object)
  | { type: 'typeText'; text: string; submit?: boolean }
  | { type: 'pressKey'; key: string; modifiers?: string[] }
  | { type: 'hotkey'; keys: string[] }  // Frontend uses keys array, not key + modifiers
  | { type: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; amount: number }
  | { type: 'pause'; ms: number }
  | { type: 'screenshot'; tag?: string; analyzeWithVision?: boolean }
  | { type: 'clickAndDrag'; fromLocator: VisionLocator; toLocator: VisionLocator }
  | { type: 'zoom'; zoomDirection: 'in' | 'out'; zoomLevel?: number }
  
  // Data Operations (for intent-driven automation)
  | { type: 'ocr'; region?: { x: number; y: number; width: number; height: number } }  // Extract text from screenshot
  | { type: 'store'; key: string; value: any }  // Store data for later steps
  | { type: 'retrieve'; key: string }  // Retrieve stored data
  
  // Domain Skills (API setup communication - NOT for execution, MCP handles that)
  | { type: 'apiAction'; skill: string; params: Record<string, any>; description?: string }
  | { type: 'notifyUser'; message: string; skillRegistered?: string }
  
  // Control Flow
  | { type: 'askUser'; questionId: string }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string }
  | { type: 'end'; reason?: string };

// ============================================================================
// DOMAIN SKILLS (API Actions)
// ============================================================================

/**
 * Available domain skills for SETUP communication
 * These are NOT for execution - MCP layer handles execution
 * Backend helps users SET UP integrations via NutJS automation
 */
export type SkillId =
  // Setup Skills (help user configure integrations)
  | 'setup.homeAssistant'
  | 'setup.slack'
  | 'setup.calendar'
  | 'setup.n8n'
  | 'setup.email'
  | 'setup.car'
  | 'setup.generic'
  
  // Notification Skills (inform user/MCP of setup completion)
  | 'notify.user'
  | 'notify.skillRegistered'
  | 'notify.setupComplete';

/**
 * Skill definition for registration
 */
export interface SkillDefinition {
  id: SkillId;
  name: string;
  description: string;
  category: 'calendar' | 'automation' | 'home' | 'car' | 'email' | 'messaging' | 'http';
  paramsSchema: Record<string, any>;  // JSON Schema for validation
  requiresAuth?: boolean;
  authType?: 'oauth' | 'apiKey' | 'basic';
}

/**
 * Result of a skill execution
 */
export interface SkillExecutionResult {
  success: boolean;
  data?: any;
  error?: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// ERROR HANDLING
// ============================================================================

/**
 * What to do when a step fails after all retries
 */
export type AutomationErrorHandler =
  | { strategy: 'fail_plan'; message?: string }
  | { strategy: 'skip_step'; message?: string }
  | { strategy: 'goto_step'; stepId: string; message?: string }
  | { strategy: 'ask_user'; questionId: string; message?: string }
  | { strategy: 'replan'; reason: string };

// ============================================================================
// STEPS
// ============================================================================

export interface AutomationStep {
  /** Unique step identifier (e.g., "step_1", "step_2") */
  id: string;
  
  /** Low-level action to perform (for action-based plans) */
  kind?: AutomationStepKind;
  
  /** High-level intent (for intent-based plans with computer-use execution) */
  intent?: 'navigate' | 'switch_app' | 'close_app' | 'click_element' | 'type_text' | 'search' | 'select' | 'drag' | 'scroll' 
    | 'capture' | 'extract' | 'copy' | 'paste' | 'store' | 'retrieve' 
    | 'wait' | 'verify' | 'compare' | 'check' 
    | 'upload' | 'download' | 'open_file' | 'save_file' 
    | 'zoom' | 'authenticate' | 'form_fill' | 'multi_select' 
    | 'custom';
  
  /** Human-readable description */
  description: string;
  
  /** Current execution status */
  status: StepStatus;
  
  /** Step IDs that must succeed before this step runs */
  dependsOn?: string[];
  
  /** Retry configuration for this step */
  retry?: {
    maxAttempts: number;
    delayMs?: number;
  };
  
  /** What to do if this step fails after all retries */
  onError?: AutomationErrorHandler;
  
  // ========== INTENT-BASED FIELDS (for hybrid plan + computer-use) ==========
  
  /** Target URL for navigate intent, or element description for click_element */
  target?: string;
  
  /** Query text for search/type_text intents */
  query?: string;
  
  /** Element description for click_element intent (natural language) */
  element?: string;
  
  /** How to verify this step is complete (for computer-use LLM) */
  successCriteria?: string;
  
  /** Maximum attempts for this step (for computer-use adaptive execution) */
  maxAttempts?: number;
  
  /** Expected duration estimate */
  expectedDuration?: string;
  
  /** Additional notes or context for the computer-use LLM */
  notes?: string;
}

// ============================================================================
// QUESTIONS (Proactive & Reactive)
// ============================================================================

export interface AutomationQuestion {
  /** Unique question identifier */
  id: string;
  
  /** Question text to show user */
  text: string;
  
  /** Question type */
  type: 'choice' | 'freeform';
  
  /** Choices for choice-type questions */
  choices?: string[];
  
  /** Whether user must answer before proceeding */
  required: boolean;
}

// ============================================================================
// AUTOMATION PLAN
// ============================================================================

export interface AutomationPlan {
  /** Unique plan identifier */
  planId: string;
  
  /** Plan version (increments on replan) */
  version: number;
  
  /** Intent type */
  intent: AutomationIntent;
  
  /** Natural language goal summary */
  goal: string;
  
  /** ISO timestamp of plan creation */
  createdAt: string;
  
  /** Context snapshot used to generate this plan */
  contextSnapshot?: {
    screenshot?: {
      base64: string;
      mimeType?: string;
    };
    screenIntel?: any;  // OCR nodes from screen-intel MCP (optional)
    activeApp?: string;
    activeUrl?: string;
    os?: string;
    timestamp?: string;
    storedData?: Record<string, any>;  // Data passed between steps (frontend manages)
  };
  
  /** Ordered list of steps to execute */
  steps: AutomationStep[];
  
  /** Global retry policy */
  retryPolicy?: {
    maxGlobalRetries: number;
  };
  
  /** Proactive clarifying questions (asked before execution) */
  questions?: AutomationQuestion[];
  
  /** Additional metadata */
  metadata?: {
    provider?: 'grok' | 'claude' | 'openai';
    generationTimeMs?: number;
    targetOS?: 'darwin' | 'win32' | 'linux';
    targetApp?: string;
    /** Indicates this is a partial fix plan for a failed step */
    isFixPlan?: boolean;
    /** Original plan ID this fix plan is for */
    originalPlanId?: string;
    /** Index of the step this fix plan addresses */
    fixesStepIndex?: number;
    [key: string]: any;
  };
}

// ============================================================================
// REQUEST / RESPONSE (API Contract)
// ============================================================================

/**
 * User feedback for replanning
 */
export interface AutomationUserFeedback {
  /** Why we're providing feedback */
  reason: 'clarification' | 'failure' | 'scope_change';
  
  /** Natural language feedback */
  message: string;
  
  /** Step ID this feedback relates to (if applicable) */
  stepId?: string;
}

/**
 * Request to generate or replan an automation
 */
export interface AutomationPlanRequest {
  /** Natural language command */
  command: string;
  
  /** Intent type */
  intent?: AutomationIntent;
  
  /** Context for plan generation */
  context?: {
    /** Base64 screenshot for vision analysis */
    screenshot?: {
      base64: string;
      mimeType?: string;  // Default: 'image/png'
    };
    
    /** Screen-intel OCR snapshot (optional, for text-based locators) */
    screenIntel?: any;
    
    /** Currently active application */
    activeApp?: string;
    
    /** Current URL (if browser) */
    activeUrl?: string;
    
    /** Operating system */
    os?: 'darwin' | 'win32' | 'linux';
    
    /** Previous attempts or history */
    history?: any;
    
    /** Request a partial fix plan instead of full plan (for step failures) */
    requestPartialPlan?: boolean;
    
    /** Indicates this is a replanning request */
    isReplanning?: boolean;
    
    /** Index of the failed step (for partial fix plans) */
    failedStepIndex?: number;
    
    /** Data stored from previous steps (frontend manages, passed between steps) */
    storedData?: Record<string, any>;
  };
  
  /** Previous plan (for replanning) */
  previousPlan?: AutomationPlan;
  
  /** User feedback (for replanning) */
  feedback?: AutomationUserFeedback;
  
  /** Answers to clarification questions (follow-up after needsClarification) */
  clarificationAnswers?: Record<string, string>;
}

/**
 * Response from plan generation API
 */
export interface AutomationPlanResponse {
  success: boolean;
  
  /** Full automation plan (when query is clear) */
  plan?: AutomationPlan;
  
  /** True if LLM needs clarification before planning */
  needsClarification?: boolean;
  
  /** Clarifying questions to ask user (before generating plan) */
  clarificationQuestions?: AutomationQuestion[];
  
  /** Partial context extracted from ambiguous query */
  partialContext?: {
    intent?: string;
    apps?: string[];
    workflow?: string;
    extractedInfo?: Record<string, any>;
  };
  
  /** Answers to clarification questions (for follow-up request) */
  clarificationAnswers?: Record<string, string>;
  
  provider?: string;
  latencyMs?: number;
  error?: string;
  message?: string;
}

// ============================================================================
// EXECUTION RESULTS
// ============================================================================

export interface StepExecutionResult {
  stepId: string;
  status: 'success' | 'failed' | 'skipped';
  error?: string;
  retries: number;
  executionTimeMs: number;
  screenshotPath?: string;
  method?: string;  // Which approach succeeded (primary, alternative, etc.)
}

export interface PlanExecutionResult {
  planId: string;
  status: 'completed' | 'failed' | 'timeout' | 'user_cancelled';
  steps: StepExecutionResult[];
  totalTimeMs: number;
  failedStepId?: string;
  error?: string;
}

// ============================================================================
// LEGACY TYPES (for backward compatibility with existing /api/nutjs)
// ============================================================================

/** @deprecated Use AutomationStepKind instead */
export type ActionType = 
  | 'click_button'
  | 'fill_field'
  | 'navigate_url'
  | 'wait'
  | 'press_key'
  | 'open_app'
  | 'focus_window';

/** @deprecated Use AutomationStep.kind instead */
export type VerificationType =
  | 'element_visible'
  | 'element_not_visible'
  | 'text_present'
  | 'url_changed'
  | 'window_focused'
  | 'field_filled'
  | 'button_enabled'
  | 'compose_dialog_visible'
  | 'recipient_added'
  | 'send_button_enabled'
  | 'email_sent'
  | 'none';

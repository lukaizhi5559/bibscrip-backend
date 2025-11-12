/**
 * Structured Automation Plan Types
 * Used for self-correcting desktop automation workflows
 */

export type ActionType = 
  | 'click_button'
  | 'fill_field'
  | 'navigate_url'
  | 'wait'
  | 'press_key'
  | 'open_app'
  | 'focus_window';

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

export interface AutomationStep {
  /** Unique step identifier */
  id: number;
  
  /** Human-readable description of what this step does */
  description: string;
  
  /** Type of action to perform */
  action: ActionType;
  
  /** Target element label/text (for click/fill actions) */
  target?: string;
  
  /** Element role (button, input, textbox, link, etc.) */
  role?: string;
  
  /** Value to type/enter (for fill actions) */
  value?: string;
  
  /** URL to navigate to (for navigate actions) */
  url?: string;
  
  /** Executable Nut.js code for this step */
  code: string;
  
  /** How to verify this step succeeded */
  verification: VerificationType;
  
  /** Alternative label to try if primary target fails */
  alternativeLabel?: string;
  
  /** Alternative role to try if primary role fails */
  alternativeRole?: string;
  
  /** Keyboard shortcut as fallback (e.g., "Cmd+N" or code snippet) */
  keyboardShortcut?: string;
  
  /** Milliseconds to wait after executing this step */
  waitAfter?: number;
  
  /** Maximum retries for this specific step */
  maxRetries?: number;
  
  /** Additional context for verification */
  verificationContext?: {
    /** Expected text to find in screenshot */
    expectedText?: string;
    /** Expected URL pattern */
    expectedUrl?: string;
    /** Element that should be visible */
    shouldSeeElement?: string;
    /** Element that should NOT be visible */
    shouldNotSeeElement?: string;
  };
}

export interface AutomationPlan {
  /** Unique plan identifier */
  planId: string;
  
  /** Original user command */
  originalCommand: string;
  
  /** List of steps to execute in order */
  steps: AutomationStep[];
  
  /** Maximum retries per step (default fallback) */
  maxRetriesPerStep: number;
  
  /** Total timeout for entire plan in milliseconds */
  totalTimeout: number;
  
  /** Operating system this plan is for */
  targetOS: 'darwin' | 'win32' | 'linux';
  
  /** Application being automated (gmail, outlook, slack, etc.) */
  targetApp?: string;
  
  /** Metadata about plan generation */
  metadata: {
    /** LLM provider used to generate plan */
    provider: 'grok' | 'claude';
    /** Time taken to generate plan in ms */
    generationTime: number;
    /** Timestamp of plan creation */
    createdAt: string;
  };
}

export interface StepExecutionResult {
  stepId: number;
  status: 'success' | 'success_retry' | 'failed';
  method?: string; // Which method succeeded (primary, alternative, keyboard_shortcut)
  error?: string;
  retries: number;
  executionTime: number;
  screenshotPath?: string;
}

export interface PlanExecutionResult {
  planId: string;
  status: 'completed' | 'failed' | 'timeout';
  steps: StepExecutionResult[];
  totalTime: number;
  failedStep?: number;
  error?: string;
}

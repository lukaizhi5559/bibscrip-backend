/**
 * Type definitions for the Guide API
 * Used for interactive tutorial/guide automation with step-by-step explanations
 */

/**
 * Verification type for guide steps
 */
export type VerificationType = 
  | 'element_visible'
  | 'window_title'
  | 'app_running'
  | 'none';

/**
 * Common failure types that can occur during guide execution
 */
export type FailureType =
  | 'execution_error'
  | 'timeout'
  | 'verification_failed'
  | 'app_not_found'
  | 'permission_denied'
  | 'network_error';

/**
 * A single step in the automation guide
 */
export interface GuideStep {
  /** Unique step identifier */
  id: number;
  
  /** Human-readable step title */
  title: string;
  
  /** Detailed explanation of what this step does and why */
  explanation: string;
  
  /** Executable Nut.js code for this step */
  code: string;
  
  /** Console.log marker for frontend parsing (e.g., "[GUIDE STEP 1]") */
  marker: string;
  
  /** Whether this step can fail (e.g., app not installed) */
  canFail: boolean;
  
  /** Expected duration in milliseconds (for timeout detection) */
  expectedDuration?: number;
  
  /** Verification to perform after step execution */
  verification?: {
    type: VerificationType;
    expectedElement?: string;
    expectedWindowTitle?: string;
    expectedAppName?: string;
  };
  
  /** Common failure type for this step (if canFail is true) */
  commonFailure?: FailureType;
  
  /** Wait time after step completion (milliseconds) */
  waitAfter?: number;
}

/**
 * Recovery instructions for a specific failure type
 */
export interface RecoveryStep {
  /** Type of failure this recovery addresses */
  failureType: FailureType;
  
  /** Human-readable title for the recovery */
  title: string;
  
  /** Detailed explanation of the recovery process */
  explanation: string;
  
  /** Manual instructions for the user to follow */
  manualInstructions: string;
  
  /** Optional automation code for recovery (if possible) */
  code?: string;
  
  /** Links to helpful resources */
  helpLinks?: Array<{
    title: string;
    url: string;
  }>;
}

/**
 * Complete automation guide structure
 */
export interface AutomationGuide {
  /** Unique guide identifier */
  id: string;
  
  /** Original user command */
  command: string;
  
  /** Introductory summary explaining what the guide will do */
  intro: string;
  
  /** Array of guide steps */
  steps: GuideStep[];
  
  /** Full executable code with all markers */
  code: string;
  
  /** Total number of steps */
  totalSteps: number;
  
  /** Pre-generated recovery steps for common failures */
  commonRecoveries: RecoveryStep[];
  
  /** Metadata about guide generation */
  metadata: {
    provider: 'grok' | 'claude';
    generationTime: number;
    targetApp?: string;
    targetOS: 'darwin' | 'win32';
    estimatedDuration?: number; // Total estimated time in ms
  };
}

/**
 * Request body for guide generation
 */
export interface GuideRequest {
  /** User command requesting guidance */
  command: string;
  
  /** Optional context (e.g., for failure recovery) */
  context?: {
    /** Step that failed (if recovering from failure) */
    failedStep?: number;
    
    /** Type of failure that occurred */
    failureType?: FailureType;
    
    /** Error message from failure */
    error?: string;
    
    /** User's OS */
    os?: 'darwin' | 'win32';
    
    /** User ID for personalization */
    userId?: string;
  };
}

/**
 * Response from guide generation API
 */
export interface GuideResponse {
  /** Generated automation guide */
  guide: AutomationGuide;
  
  /** LLM provider used */
  provider: 'grok' | 'claude';
  
  /** Generation latency in milliseconds */
  latencyMs: number;
  
  /** Optional error message */
  error?: string;
}

/**
 * Failure report from frontend
 */
export interface GuideFailureReport {
  /** Guide ID */
  guideId: string;
  
  /** Step that failed */
  stepId: number;
  
  /** Type of failure */
  failureType: FailureType;
  
  /** Error message */
  error: string;
  
  /** Timestamp of failure */
  timestamp: string;
  
  /** Additional context */
  context?: {
    exitCode?: number;
    stderr?: string;
    stdout?: string;
    duration?: number;
  };
}

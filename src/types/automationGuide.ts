/**
 * Type definitions for Interactive Guide API (command_guide intent)
 * Used for step-by-step visual guidance with overlay rendering
 */

// ============================================================================
// COORDINATE SYSTEMS & OVERLAYS
// ============================================================================

/**
 * Coordinate space for overlay positioning
 */
export type OverlayCoordinateSpace = 'screen' | 'normalized' | 'node';

/**
 * Visual overlay types for guiding users
 */
export type GuidanceOverlayType = 'highlight' | 'arrow' | 'textBox' | 'label' | 'callout';

/**
 * Node query for dynamic element location (used with coordinateSpace: "node")
 */
export interface NodeQuery {
  /** Text content to match */
  textContains?: string;
  
  /** Application name */
  app?: string;
  
  /** UI role hint */
  role?: 'button' | 'input' | 'tab' | 'image' | 'link' | 'checkbox' | 'menu';
  
  /** Additional context for matching */
  context?: string;
}

/**
 * Visual overlay for guiding user attention
 */
export interface GuidanceOverlay {
  /** Unique overlay identifier */
  id: string;
  
  /** Type of visual overlay */
  type: GuidanceOverlayType;
  
  /** Boundary coordinates */
  boundary: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  
  /** Coordinate system for boundary */
  coordinateSpace: OverlayCoordinateSpace;
  
  /** Node query for dynamic location (when coordinateSpace is "node") */
  nodeQuery?: NodeQuery;
  
  /** Arrow direction (for arrow type) */
  arrowDirection?: 'up' | 'down' | 'left' | 'right';
  
  /** Position relative to boundary (for callout/textBox) */
  position?: 'top' | 'bottom' | 'left' | 'right';
  
  /** Message to display */
  message?: string;
  
  /** Label text (for label type) */
  label?: string;
  
  /** Opacity (0-1) */
  opacity?: number;
  
  /** Pulse animation */
  pulse?: boolean;
  
  /** Z-index for layering */
  zIndex?: number;
}

// ============================================================================
// GHOST POINTER ACTIONS
// ============================================================================

/**
 * Ghost pointer action types
 */
export type GhostPointerAction =
  | {
      type: 'moveToBoundary';
      boundaryId: string;
      easing?: 'linear' | 'easeOut' | 'spring';
      durationMs?: number;
    }
  | {
      type: 'clickOnBoundary';
      boundaryId: string;
      clickType?: 'single' | 'double' | 'right';
      withRipple?: boolean;
    }
  | {
      type: 'moveToPoint';
      x: number;
      y: number;
      coordinateSpace: OverlayCoordinateSpace;
      durationMs?: number;
    };

// ============================================================================
// VISION VERIFICATION
// ============================================================================

/**
 * Completion detection mode for guide steps
 */
export type CompletionMode = 'vision' | 'manual' | 'either';

/**
 * Vision verification strategy
 */
export interface VisionVerificationStrategy {
  /** Strategy type */
  strategy: 'screen_intel_node_present' | 'screenshot_comparison' | 'element_visible' | 'app_running';
  
  /** Node query for verification */
  nodeQuery?: NodeQuery;
  
  /** Expected element description */
  expectedElement?: string;
  
  /** Expected app name */
  expectedApp?: string;
  
  /** Timeout in milliseconds */
  timeoutMs?: number;
  
  /** Polling interval in milliseconds */
  pollIntervalMs?: number;
}

// ============================================================================
// INTERACTIVE GUIDE STEPS
// ============================================================================

/**
 * A single step in an interactive guide
 */
export interface InteractiveGuideStep {
  /** Unique step identifier */
  id: string;
  
  /** Human-readable step title */
  title: string;
  
  /** Detailed explanation of what to do and why */
  description: string;
  
  /** Visual overlays to render */
  overlays: GuidanceOverlay[];
  
  /** Ghost pointer actions (optional) */
  pointerActions?: GhostPointerAction[];
  
  /** How to detect step completion */
  completionMode: CompletionMode;
  
  /** Vision verification strategy (if completionMode includes "vision") */
  visionCheck?: VisionVerificationStrategy;
  
  /** Fallback instruction if vision can't locate elements */
  fallbackInstruction?: string;
  
  /** Expected duration in milliseconds */
  expectedDuration?: number;
  
  /** Wait time after step completion (milliseconds) */
  waitAfter?: number;
}

// ============================================================================
// INTERACTIVE GUIDE
// ============================================================================

/**
 * Complete interactive automation guide
 */
export interface InteractiveGuide {
  /** Unique guide identifier */
  id: string;
  
  /** Original user command */
  command: string;
  
  /** Intent type (always "command_guide") */
  intent: 'command_guide';
  
  /** Introductory summary */
  intro: string;
  
  /** Array of interactive guide steps */
  steps: InteractiveGuideStep[];
  
  /** Total number of steps */
  totalSteps: number;
  
  /** Metadata about guide generation */
  metadata: {
    provider: 'gemini' | 'grok' | 'claude' | 'openai';
    generationTime: number;
    targetApp?: string;
    targetOS: 'darwin' | 'win32';
    estimatedDuration?: number;
  };
}

// ============================================================================
// REQUEST / RESPONSE
// ============================================================================

/**
 * Feedback for guide replanning
 */
export interface GuideFeedback {
  /** Reason for replanning */
  reason: 'missing_prerequisite' | 'step_failed' | 'user_clarification' | 'scope_change';
  
  /** User's feedback message */
  message: string;
  
  /** Step ID where issue occurred (optional) */
  stepId?: string;
}

/**
 * Request body for interactive guide generation
 */
export interface InteractiveGuideRequest {
  /** User command requesting guidance (e.g., "Show me how to buy winter clothes on Amazon") */
  command: string;
  
  /** Context for guide generation */
  context?: {
    /** Base64 screenshot for vision analysis */
    screenshot?: {
      base64: string;
      mimeType?: string;
    };
    
    /** Currently active application */
    activeApp?: string;
    
    /** Current URL (if browser) */
    activeUrl?: string;
    
    /** Operating system */
    os?: 'darwin' | 'win32';
    
    /** Screen dimensions */
    screenDimensions?: {
      width: number;
      height: number;
    };
  };
  
  /** Previous guide for replanning (optional) */
  previousGuide?: InteractiveGuide;
  
  /** User feedback for replanning (optional) */
  feedback?: GuideFeedback;
}

/**
 * Response from interactive guide generation API
 */
export interface InteractiveGuideResponse {
  success: boolean;
  
  /** Generated interactive guide */
  guide: InteractiveGuide;
  
  /** LLM provider used */
  provider: 'gemini' | 'grok' | 'claude' | 'openai';
  
  /** Generation latency in milliseconds */
  latencyMs: number;
  
  /** Optional error message */
  error?: string;
}

// ============================================================================
// VISION API TYPES
// ============================================================================

/**
 * Request to locate an element using vision
 */
export interface LocateElementRequest {
  /** Base64 screenshot */
  screenshot: {
    base64: string;
    mimeType?: string;
  };
  
  /** Element description or query */
  locator: {
    strategy: 'vision' | 'textMatch' | 'nodeQuery';
    description?: string;
    nodeQuery?: NodeQuery;
  };
  
  /** Screen dimensions for coordinate normalization */
  screenDimensions?: {
    width: number;
    height: number;
  };
}

/**
 * Response from element location
 */
export interface LocateElementResponse {
  success: boolean;
  
  /** Found element boundary */
  boundary?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  
  /** Coordinate space of returned boundary */
  coordinateSpace: OverlayCoordinateSpace;
  
  /** Confidence score (0-1) */
  confidence?: number;
  
  /** Error message if not found */
  error?: string;
}

/**
 * Request to verify a step completion
 */
export interface VerifyStepRequest {
  /** Step ID being verified */
  stepId: string;
  
  /** Current screenshot */
  screenshot: {
    base64: string;
    mimeType?: string;
  };
  
  /** Previous screenshot (for comparison) */
  previousScreenshot?: {
    base64: string;
    mimeType?: string;
  };
  
  /** Verification strategy */
  verification: VisionVerificationStrategy;
}

/**
 * Response from step verification
 */
export interface VerifyStepResponse {
  success: boolean;
  
  /** Whether step is verified as complete */
  verified: boolean;
  
  /** Confidence score (0-1) */
  confidence?: number;
  
  /** Explanation of verification result */
  explanation?: string;
  
  /** Suggested next action if not verified */
  suggestion?: string;
  
  /** Error message */
  error?: string;
}

// ============================================================================
// LEGACY TYPES (deprecated, kept for reference)
// ============================================================================

/** @deprecated Use InteractiveGuideRequest instead */
export interface GuideRequest {
  command: string;
  context?: {
    failedStep?: number;
    failureType?: string;
    error?: string;
    os?: 'darwin' | 'win32';
    userId?: string;
  };
}

/**
 * Intent-Driven Automation Types
 * 
 * Architecture:
 * - High-level intent types for plan generation (one-to-many with actions)
 * - Each intent has available actions that LLM can choose from
 * - Input/output screenshots for state verification
 * - Isolated execution with step_complete protocol
 */

// ============================================================================
// INTENT TYPES (High-Level Plan Steps)
// ============================================================================

/**
 * Comprehensive intent types covering 95%+ of automation scenarios
 */
export type IntentType =
  // Navigation & App Control
  | 'navigate'          // Go to URL or focus app
  | 'switch_app'        // Switch between applications
  | 'close_app'         // Close application or tab
  
  // UI Interaction
  | 'click_element'     // Click on UI element
  | 'type_text'         // Type text into field
  | 'search'            // Find and search for something
  | 'select'            // Select from dropdown/menu
  | 'drag'              // Drag and drop elements
  | 'scroll'            // Scroll page/element
  
  // Data Operations
  | 'capture'           // Screenshot + OCR + store data
  | 'extract'           // Extract specific data from screen
  | 'copy'              // Copy text/data to clipboard
  | 'paste'             // Paste from clipboard
  | 'store'             // Store data for later use
  | 'retrieve'          // Retrieve stored data
  
  // Verification & Control Flow
  | 'wait'              // Wait for element/condition
  | 'verify'            // Verify state/condition
  | 'compare'           // Compare multiple sources
  | 'check'             // Check if condition is met
  
  // File Operations
  | 'upload'            // Upload file
  | 'download'          // Download file
  | 'open_file'         // Open file in app
  | 'save_file'         // Save file
  
  // Advanced Interactions
  | 'zoom'              // Zoom in/out (maps, images)
  | 'authenticate'      // Handle login/auth flows
  | 'form_fill'         // Fill out form with multiple fields
  | 'multi_select'      // Select multiple items
  
  // Custom & Fallback
  | 'custom';           // Complex multi-action intent

// ============================================================================
// ACTION TYPES (Low-Level Execution Primitives)
// ============================================================================

/**
 * Available action primitives that intents can use
 * Maps to AutomationStepKind types in automationPlan.ts
 */
export type ActionType =
  // App & Navigation
  | 'focusApp'
  | 'openUrl'
  
  // Element Interaction
  | 'findAndClick'
  | 'typeText'
  | 'pressKey'
  | 'clickAndDrag'
  
  // Screen Operations
  | 'screenshot'
  | 'ocr'
  | 'scroll'
  | 'zoom'
  
  // Data Operations
  | 'store'
  | 'retrieve'
  
  // Control Flow
  | 'waitForElement'
  | 'pause'
  | 'log'
  | 'end';

// ============================================================================
// INTENT-TO-ACTION MAPPING
// ============================================================================

/**
 * Defines available actions for each intent type
 * LLM chooses which actions to use based on context
 */
export const INTENT_AVAILABLE_ACTIONS: Record<IntentType, ActionType[]> = {
  // Navigation & App Control
  navigate: ['focusApp', 'openUrl', 'waitForElement', 'screenshot', 'end'],
  switch_app: ['focusApp', 'waitForElement', 'screenshot', 'end'],
  close_app: ['pressKey', 'findAndClick', 'pause', 'screenshot', 'end'],
  
  // UI Interaction
  click_element: ['findAndClick', 'waitForElement', 'pause', 'screenshot', 'end'],
  type_text: ['findAndClick', 'typeText', 'pressKey', 'waitForElement', 'screenshot', 'end'],
  search: ['findAndClick', 'typeText', 'pressKey', 'waitForElement', 'screenshot', 'end'],
  select: ['findAndClick', 'waitForElement', 'pause', 'screenshot', 'end'],
  drag: ['clickAndDrag', 'waitForElement', 'pause', 'screenshot', 'end'],
  scroll: ['scroll', 'pause', 'screenshot', 'end'],
  
  // Data Operations
  capture: ['screenshot', 'ocr', 'store', 'waitForElement', 'end'],
  extract: ['screenshot', 'ocr', 'store', 'findAndClick', 'end'],
  copy: ['findAndClick', 'pressKey', 'pause', 'screenshot', 'end'],
  paste: ['findAndClick', 'pressKey', 'pause', 'screenshot', 'end'],
  store: ['store', 'screenshot', 'end'],
  retrieve: ['retrieve', 'screenshot', 'end'],
  
  // Verification & Control Flow
  wait: ['waitForElement', 'pause', 'screenshot', 'end'],
  verify: ['screenshot', 'ocr', 'waitForElement', 'end'],
  compare: ['screenshot', 'ocr', 'store', 'retrieve', 'end'],
  check: ['screenshot', 'ocr', 'waitForElement', 'end'],
  
  // File Operations
  upload: ['findAndClick', 'typeText', 'pressKey', 'waitForElement', 'screenshot', 'end'],
  download: ['findAndClick', 'waitForElement', 'pause', 'screenshot', 'end'],
  open_file: ['focusApp', 'pressKey', 'typeText', 'waitForElement', 'screenshot', 'end'],
  save_file: ['pressKey', 'typeText', 'waitForElement', 'screenshot', 'end'],
  
  // Advanced Interactions
  zoom: ['zoom', 'pause', 'screenshot', 'end'],
  authenticate: ['findAndClick', 'typeText', 'pressKey', 'waitForElement', 'screenshot', 'end'],
  form_fill: ['findAndClick', 'typeText', 'pressKey', 'waitForElement', 'screenshot', 'end'],
  multi_select: ['findAndClick', 'pressKey', 'waitForElement', 'screenshot', 'end'],
  
  // Custom & Fallback
  custom: ['focusApp', 'openUrl', 'findAndClick', 'typeText', 'pressKey', 'clickAndDrag', 'scroll', 'zoom', 'screenshot', 'ocr', 'store', 'retrieve', 'waitForElement', 'pause', 'log', 'end'],
};

// ============================================================================
// INTENT EXECUTION TYPES
// ============================================================================

/**
 * Input for executing a single intent step
 */
export interface IntentExecutionRequest {
  /** Intent type to execute */
  intentType: IntentType;
  
  /** Step data from plan */
  stepData: {
    id: string;
    description: string;
    target?: string;
    query?: string;
    element?: string;
    successCriteria?: string;
    maxAttempts?: number;
    notes?: string;
  };
  
  /** Current context */
  context: {
    /** Input screenshot (current state) */
    screenshot: {
      base64: string;
      mimeType?: string;
    };
    
    /** Active app */
    activeApp?: string;
    
    /** Active URL */
    activeUrl?: string;
    
    /** OS */
    os?: 'darwin' | 'win32' | 'linux';
    
    /** Stored data from previous steps */
    storedData?: Record<string, any>;
    
    /** Previous step results */
    previousStepResults?: any[];
  };
  
  /** User ID for tracking */
  userId?: string;
}

/**
 * Clarification question for user input
 */
export interface ClarificationQuestion {
  id: string;
  question: string;
  type?: 'text' | 'choice' | 'confirm';
  choices?: string[];
}

/**
 * Result of executing a single intent step
 */
export interface IntentExecutionResult {
  /** Execution status */
  status: 'step_complete' | 'step_failed' | 'clarification_needed' | 'needs_user_input';
  
  /** Intent type executed */
  intentType: IntentType;
  
  /** Step ID */
  stepId: string;
  
  /** Actions taken during execution */
  actions: Array<{
    type: ActionType;
    timestamp: number;
    success: boolean;
    error?: string;
    metadata?: any;
  }>;
  
  /** Output screenshot (final state after actions) */
  outputScreenshot?: {
    base64: string;
    mimeType?: string;
  };
  
  /** Extracted/stored data */
  data?: any;
  
  /** Error message if failed */
  error?: string;
  
  /** Execution time in ms */
  executionTimeMs: number;
  
  /** LLM reasoning/explanation */
  reasoning?: string;
  
  /** Clarification questions (if status is clarification_needed) */
  clarificationQuestions?: ClarificationQuestion[];
}

/**
 * Full automation completion result
 */
export interface AutomationCompletionResult {
  /** Overall status */
  status: 'completed' | 'failed' | 'partial';
  
  /** Plan ID */
  planId: string;
  
  /** Step results */
  steps: IntentExecutionResult[];
  
  /** Total execution time */
  totalTimeMs: number;
  
  /** Final output data */
  finalData?: any;
  
  /** Completion message */
  message: string;
}

// ============================================================================
// STEP COMPLETION PROTOCOL
// ============================================================================

/**
 * Protocol for signaling step completion
 */
export interface StepCompletionSignal {
  /** Signal type */
  type: 'step_complete' | 'step_failed' | 'automation_end';
  
  /** Step ID */
  stepId: string;
  
  /** Success status */
  success: boolean;
  
  /** Result data */
  result?: IntentExecutionResult | AutomationCompletionResult;
  
  /** Message for user */
  message: string;
  
  /** Timestamp */
  timestamp: number;
}

// ============================================================================
// INTENT METADATA
// ============================================================================

/**
 * Metadata for each intent type
 */
export interface IntentMetadata {
  name: string;
  description: string;
  category: 'navigation' | 'interaction' | 'data' | 'verification' | 'file' | 'advanced' | 'custom';
  requiredFields: string[];
  optionalFields: string[];
  typicalDuration: string;
  examples: string[];
}

/**
 * Complete intent metadata catalog
 */
export const INTENT_METADATA: Record<IntentType, IntentMetadata> = {
  navigate: {
    name: 'Navigate',
    description: 'Navigate to URL or focus application',
    category: 'navigation',
    requiredFields: ['target'],
    optionalFields: ['successCriteria'],
    typicalDuration: '2-5s',
    examples: ['Go to jira.com', 'Open Chrome browser', 'Navigate to dashboard'],
  },
  
  switch_app: {
    name: 'Switch App',
    description: 'Switch between applications',
    category: 'navigation',
    requiredFields: ['target'],
    optionalFields: [],
    typicalDuration: '1-2s',
    examples: ['Switch to Warp', 'Focus Windsurf', 'Go to Safari'],
  },
  
  close_app: {
    name: 'Close App',
    description: 'Close application or tab',
    category: 'navigation',
    requiredFields: [],
    optionalFields: ['target'],
    typicalDuration: '1-2s',
    examples: ['Close current tab', 'Quit Chrome', 'Close window'],
  },
  
  click_element: {
    name: 'Click Element',
    description: 'Click on UI element',
    category: 'interaction',
    requiredFields: ['element'],
    optionalFields: ['successCriteria'],
    typicalDuration: '1-3s',
    examples: ['Click submit button', 'Click search icon', 'Click menu item'],
  },
  
  type_text: {
    name: 'Type Text',
    description: 'Type text into field',
    category: 'interaction',
    requiredFields: ['query'],
    optionalFields: ['element', 'successCriteria'],
    typicalDuration: '2-5s',
    examples: ['Type search query', 'Enter email address', 'Fill in form field'],
  },
  
  search: {
    name: 'Search',
    description: 'Find and search for something',
    category: 'interaction',
    requiredFields: ['query'],
    optionalFields: ['successCriteria'],
    typicalDuration: '3-8s',
    examples: ['Search for ticket PEG-19313', 'Search Google for best runners', 'Find file in Finder'],
  },
  
  select: {
    name: 'Select',
    description: 'Select from dropdown or menu',
    category: 'interaction',
    requiredFields: ['element'],
    optionalFields: ['query'],
    typicalDuration: '2-4s',
    examples: ['Select option from dropdown', 'Choose menu item', 'Pick date from calendar'],
  },
  
  drag: {
    name: 'Drag',
    description: 'Drag and drop elements',
    category: 'interaction',
    requiredFields: ['element', 'target'],
    optionalFields: [],
    typicalDuration: '2-5s',
    examples: ['Drag file to folder', 'Move map marker', 'Reorder list items'],
  },
  
  scroll: {
    name: 'Scroll',
    description: 'Scroll page or element',
    category: 'interaction',
    requiredFields: [],
    optionalFields: ['target'],
    typicalDuration: '1-3s',
    examples: ['Scroll down page', 'Scroll to bottom', 'Scroll up to top'],
  },
  
  capture: {
    name: 'Capture',
    description: 'Screenshot + OCR + store data',
    category: 'data',
    requiredFields: [],
    optionalFields: ['successCriteria'],
    typicalDuration: '2-5s',
    examples: ['Capture Jira ticket data', 'Screenshot search results', 'Capture error message'],
  },
  
  extract: {
    name: 'Extract',
    description: 'Extract specific data from screen',
    category: 'data',
    requiredFields: ['element'],
    optionalFields: [],
    typicalDuration: '2-5s',
    examples: ['Extract ticket number', 'Get error message text', 'Read table data'],
  },
  
  copy: {
    name: 'Copy',
    description: 'Copy text/data to clipboard',
    category: 'data',
    requiredFields: ['element'],
    optionalFields: [],
    typicalDuration: '1-3s',
    examples: ['Copy code snippet', 'Copy URL', 'Copy selected text'],
  },
  
  paste: {
    name: 'Paste',
    description: 'Paste from clipboard',
    category: 'data',
    requiredFields: ['element'],
    optionalFields: [],
    typicalDuration: '1-3s',
    examples: ['Paste into chat', 'Paste code', 'Paste URL'],
  },
  
  store: {
    name: 'Store',
    description: 'Store data for later use',
    category: 'data',
    requiredFields: [],
    optionalFields: [],
    typicalDuration: '<1s',
    examples: ['Store ticket data', 'Save extracted text', 'Cache screenshot'],
  },
  
  retrieve: {
    name: 'Retrieve',
    description: 'Retrieve stored data',
    category: 'data',
    requiredFields: [],
    optionalFields: [],
    typicalDuration: '<1s',
    examples: ['Get stored ticket data', 'Retrieve cached text', 'Load previous result'],
  },
  
  wait: {
    name: 'Wait',
    description: 'Wait for element or condition',
    category: 'verification',
    requiredFields: ['element'],
    optionalFields: ['successCriteria'],
    typicalDuration: '1-10s',
    examples: ['Wait for page load', 'Wait for button to appear', 'Wait for response'],
  },
  
  verify: {
    name: 'Verify',
    description: 'Verify state or condition',
    category: 'verification',
    requiredFields: ['successCriteria'],
    optionalFields: [],
    typicalDuration: '1-3s',
    examples: ['Verify login success', 'Check page loaded', 'Confirm data saved'],
  },
  
  compare: {
    name: 'Compare',
    description: 'Compare multiple sources',
    category: 'verification',
    requiredFields: [],
    optionalFields: [],
    typicalDuration: '3-10s',
    examples: ['Compare ChatGPT vs Perplexity', 'Compare before/after', 'Diff two files'],
  },
  
  check: {
    name: 'Check',
    description: 'Check if condition is met',
    category: 'verification',
    requiredFields: ['successCriteria'],
    optionalFields: [],
    typicalDuration: '1-3s',
    examples: ['Check if logged in', 'Check if file exists', 'Check if button enabled'],
  },
  
  upload: {
    name: 'Upload',
    description: 'Upload file',
    category: 'file',
    requiredFields: ['target'],
    optionalFields: [],
    typicalDuration: '3-10s',
    examples: ['Upload image', 'Upload document', 'Attach file'],
  },
  
  download: {
    name: 'Download',
    description: 'Download file',
    category: 'file',
    requiredFields: ['element'],
    optionalFields: [],
    typicalDuration: '2-30s',
    examples: ['Download report', 'Save file', 'Export data'],
  },
  
  open_file: {
    name: 'Open File',
    description: 'Open file in application',
    category: 'file',
    requiredFields: ['target'],
    optionalFields: [],
    typicalDuration: '2-5s',
    examples: ['Open file in VSCode', 'Open PDF', 'Launch document'],
  },
  
  save_file: {
    name: 'Save File',
    description: 'Save file',
    category: 'file',
    requiredFields: [],
    optionalFields: ['target'],
    typicalDuration: '1-3s',
    examples: ['Save document', 'Save as', 'Export file'],
  },
  
  zoom: {
    name: 'Zoom',
    description: 'Zoom in/out on maps, images, canvas',
    category: 'advanced',
    requiredFields: [],
    optionalFields: ['target'],
    typicalDuration: '1-2s',
    examples: ['Zoom in on map', 'Zoom out', 'Reset zoom level'],
  },
  
  authenticate: {
    name: 'Authenticate',
    description: 'Handle login/auth flows',
    category: 'advanced',
    requiredFields: [],
    optionalFields: ['successCriteria'],
    typicalDuration: '5-15s',
    examples: ['Log in to account', 'Enter credentials', 'Complete OAuth'],
  },
  
  form_fill: {
    name: 'Form Fill',
    description: 'Fill out form with multiple fields',
    category: 'advanced',
    requiredFields: [],
    optionalFields: [],
    typicalDuration: '10-30s',
    examples: ['Fill registration form', 'Complete survey', 'Enter shipping info'],
  },
  
  multi_select: {
    name: 'Multi Select',
    description: 'Select multiple items',
    category: 'advanced',
    requiredFields: ['element'],
    optionalFields: [],
    typicalDuration: '3-10s',
    examples: ['Select multiple files', 'Choose multiple options', 'Bulk select items'],
  },
  
  custom: {
    name: 'Custom',
    description: 'Complex multi-action intent',
    category: 'custom',
    requiredFields: ['description'],
    optionalFields: ['successCriteria'],
    typicalDuration: 'varies',
    examples: ['Complex workflow', 'Multi-step process', 'Custom automation'],
  },
};

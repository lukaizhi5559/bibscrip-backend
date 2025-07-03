import { mouse, keyboard, screen, Key, Button } from '@nut-tree-fork/nut-js';
import { logger } from '../utils/logger';
import { Action as VisualAgentAction } from './visualAgentService';
import { LLMPlanner, ActionPlan as LLMActionPlan, PlanningContext, Action as PlannerAction } from '../planner/generatePlan';
import { UIElement } from '../agent/uiIndexerDaemon';

export interface ExecutionResult {
  success: boolean;
  executedActions: number;
  totalActions: number;
  error?: string;
  duration: number;
  timestamp: string;
  finalScreenshot?: string;
}

export interface ActionExecutionResult {
  action: VisualAgentAction;
  success: boolean;
  error?: string;
  duration: number;
  actualCoordinates?: { x: number; y: number };
  screenshot?: string; // base64 encoded screenshot
}

export interface ExecutionOptions {
  timeout?: number; // Total execution timeout in ms
  screenshotOnError?: boolean;
  screenshotOnSuccess?: boolean;
  validateAfterEachAction?: boolean;
  retryFailedActions?: boolean;
  maxRetries?: number;
}

/**
 * Desktop Automation Service
 * Executes actions using nut.js for precise desktop interaction
 */
export class DesktopAutomationService {
  private static instance: DesktopAutomationService;
  private initialized = false;
  private llmPlanner: LLMPlanner;

  constructor() {
    this.llmPlanner = new LLMPlanner();
    this.initialize();
  }

  /**
   * Initialize nut.js configuration
   */
  private async initialize(): Promise<void> {
    try {
      // Configure nut.js settings for optimal performance
      mouse.config.mouseSpeed = 1000; // pixels per second
      mouse.config.autoDelayMs = 100; // delay between actions
      keyboard.config.autoDelayMs = 50; // delay between keystrokes
      
      // Set screen confidence for image matching (if needed later)
      screen.config.confidence = 0.8;
      screen.config.autoHighlight = false; // Disable highlighting for performance
      
      this.initialized = true;
      logger.info('Desktop Automation Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Desktop Automation Service:', { error });
      this.initialized = false;
    }
  }

  /**
   * Execute a single action
   */
  async executeAction(action: VisualAgentAction): Promise<ActionExecutionResult> {
    const startTime = performance.now();
    
    try {
      logger.info('Executing action:', { type: action.type, coordinates: action.coordinates });
      
      switch (action.type) {
        case 'moveMouse':
          await this.moveMouse(action);
          break;
        case 'click':
          await this.click(action);
          break;
        case 'rightClick':
          await this.rightClick(action);
          break;
        case 'doubleClick':
          await this.doubleClick(action);
          break;
        case 'drag':
          await this.drag(action);
          break;
        case 'type':
          await this.type(action);
          break;
        case 'keyPress':
          await this.keyPress(action);
          break;
        case 'wait':
          await this.wait(action);
          break;
        case 'scroll':
          await this.scroll(action);
          break;
        case 'screenshot':
          // Screenshot is handled by VisualAgentService
          logger.info('Screenshot action - delegated to VisualAgentService');
          break;
        default:
          throw new Error(`Unsupported action type: ${action.type}`);
      }

      const duration = performance.now() - startTime;
      logger.info('Action executed successfully', { 
        type: action.type, 
        duration: `${duration.toFixed(2)}ms` 
      });

      return {
        action,
        success: true,
        duration
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      logger.error('Action execution failed:', { 
        type: action.type, 
        error: error instanceof Error ? error.message : String(error),
        duration: `${duration.toFixed(2)}ms`
      });

      return {
        action,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration
      };
    }
  }

  /**
   * Execute a high-level task using LLM planning (Natural Language → Plan → Execution)
   */
  async executeTask(
    taskDescription: string,
    uiElements: UIElement[],
    activeApp: { name: string; windowTitle: string },
    options: ExecutionOptions & { maxActions?: number; allowFallback?: boolean } = {}
  ): Promise<ExecutionResult & { actionPlan?: LLMActionPlan; planningTime?: number }> {
    const startTime = performance.now();
    const timestamp = new Date().toISOString();
    
    if (!this.initialized) {
      return {
        success: false,
        executedActions: 0,
        totalActions: 0,
        error: 'Desktop Automation Service not initialized',
        duration: 0,
        timestamp
      };
    }

    try {
      logger.info('Starting high-level task execution', {
        task: taskDescription,
        elementCount: uiElements.length,
        activeApp: activeApp.name
      });

      // Step 1: Generate action plan using LLMPlanner
      const planningContext: PlanningContext = {
        taskDescription,
        uiElements,
        activeApp,
        maxActions: options.maxActions || 10,
        allowFallback: options.allowFallback !== false
      };

      const planningStartTime = performance.now();
      const actionPlan = await this.llmPlanner.generatePlan(planningContext);
      const planningTime = performance.now() - planningStartTime;

      logger.info('Action plan generated', {
        actionCount: actionPlan.actions.length,
        confidence: actionPlan.confidence,
        planningTime: `${planningTime.toFixed(2)}ms`,
        fallbackRequired: actionPlan.fallbackRequired
      });

      // Step 2: Convert planner actions to executor actions
      const executorActions = this.convertPlannerActionsToExecutorActions(actionPlan.actions);

      // Step 3: Execute the converted actions
      const executionResult = await this.executeActionPlan(executorActions, options);

      const totalTime = performance.now() - startTime;
      
      return {
        ...executionResult,
        actionPlan,
        planningTime,
        duration: totalTime
      };

    } catch (error) {
      const duration = performance.now() - startTime;
      logger.error('High-level task execution failed:', {
        error: error instanceof Error ? error.message : error,
        task: taskDescription,
        duration: `${duration.toFixed(2)}ms`
      });

      return {
        success: false,
        executedActions: 0,
        totalActions: 0,
        error: `Task execution failed: ${error instanceof Error ? error.message : error}`,
        duration,
        timestamp
      };
    }
  }

  /**
   * Validate if a task is feasible with current UI elements
   */
  async validateTaskFeasibility(
    taskDescription: string,
    uiElements: UIElement[]
  ): Promise<{
    feasible: boolean;
    confidence: number;
    reasoning: string;
    requiredElements: string[];
  }> {
    try {
      return await this.llmPlanner.validateTaskFeasibility(taskDescription, uiElements);
    } catch (error) {
      logger.error('Task feasibility validation failed:', { error });
      return {
        feasible: false,
        confidence: 0.2,
        reasoning: `Validation failed: ${error instanceof Error ? error.message : error}`,
        requiredElements: []
      };
    }
  }

  /**
   * Convert planner actions to executor actions (handle interface differences)
   */
  private convertPlannerActionsToExecutorActions(plannerActions: PlannerAction[]): VisualAgentAction[] {
    return plannerActions.map(action => {
      const executorAction: VisualAgentAction = {
        type: this.mapActionType(action.type),
        coordinates: action.coordinates,
        text: action.text,
        key: action.key,
        duration: action.waitMs,
        direction: action.scrollDirection,
        amount: action.scrollAmount
      };

      // Handle drag action mapping
      if (action.type === 'drag' && action.dragTo) {
        executorAction.startCoordinates = action.coordinates;
        executorAction.coordinates = action.dragTo;
      }

      return executorAction;
    });
  }

  /**
   * Map action types between planner and executor interfaces
   */
  private mapActionType(plannerType: PlannerAction['type']): VisualAgentAction['type'] {
    switch (plannerType) {
      case 'key':
        return 'keyPress';
      case 'click':
      case 'doubleClick':
      case 'rightClick':
      case 'type':
      case 'scroll':
      case 'drag':
      case 'wait':
      case 'screenshot':
        return plannerType;
      default:
        logger.warn('Unknown planner action type, defaulting to screenshot:', { type: plannerType });
        return 'screenshot';
    }
  }

  /**
   * Execute complete action plan with advanced options
   */
  async executeActionPlan(
    actions: VisualAgentAction[], 
    options: ExecutionOptions = {}
  ): Promise<ExecutionResult> {
    const startTime = performance.now();
    const timestamp = new Date().toISOString();
    
    if (!this.initialized) {
      return {
        success: false,
        executedActions: 0,
        totalActions: actions.length,
        error: 'Desktop Automation Service not initialized',
        duration: 0,
        timestamp
      };
    }

    const {
      timeout = 30000, // 30 seconds default
      screenshotOnError = true,
      screenshotOnSuccess = false,
      validateAfterEachAction = false,
      retryFailedActions = true,
      maxRetries = 2
    } = options;

    logger.info('Starting action plan execution', {
      totalActions: actions.length,
      timeout,
      retryFailedActions,
      maxRetries
    });

    let executedActions = 0;
    const results: ActionExecutionResult[] = [];
    let executionError: string | undefined;

    try {
      // Set execution timeout
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('Execution timeout')), timeout);
      });

      // Execute actions with timeout
      await Promise.race([
        this.executeActionsSequentially(
          actions, 
          results, 
          { screenshotOnError, validateAfterEachAction, retryFailedActions, maxRetries }
        ),
        timeoutPromise
      ]);

      // Count results
      executedActions = results.filter(r => r.success).length;

    } catch (error) {
      executionError = error instanceof Error ? error.message : String(error);
      logger.error('Action plan execution failed:', { error: executionError });
    }

    // Capture final screenshot if requested
    let finalScreenshot: string | undefined;
    const failedActions = results.filter(r => !r.success).length;
    if (screenshotOnSuccess || (screenshotOnError && failedActions > 0)) {
      try {
        finalScreenshot = await this.captureScreenshot();
      } catch (error) {
        logger.warn('Failed to capture final screenshot:', { error });
      }
    }

    const duration = performance.now() - startTime;
    const success = executedActions === actions.length && !executionError;

    logger.info('Action plan execution completed', {
      success,
      executedActions,
      totalActions: actions.length,
      failedActions,
      duration: `${duration.toFixed(2)}ms`
    });

    return {
      success,
      executedActions,
      totalActions: actions.length,
      error: executionError,
      duration,
      timestamp,
      finalScreenshot
    };
  }

  /**
   * Execute actions sequentially with retry logic
   */
  private async executeActionsSequentially(
    actions: VisualAgentAction[],
    results: ActionExecutionResult[],
    options: {
      screenshotOnError: boolean;
      validateAfterEachAction: boolean;
      retryFailedActions: boolean;
      maxRetries: number;
    }
  ): Promise<void> {
    for (let i = 0; i < actions.length; i++) {
      const action = actions[i];
      
      logger.debug(`Executing action ${i + 1}/${actions.length}:`, { 
        type: action.type,
        coordinates: action.coordinates,
        text: action.text?.substring(0, 50)
      });

      let result = await this.executeAction(action);
      
      // Retry failed actions if enabled
      if (!result.success && options.retryFailedActions) {
        for (let retry = 1; retry <= options.maxRetries; retry++) {
          logger.warn(`Retrying action ${i + 1}, attempt ${retry}/${options.maxRetries}`);
          await this.delay(500 * retry); // Exponential backoff
          result = await this.executeAction(action);
          
          if (result.success) {
            logger.info(`Action ${i + 1} succeeded on retry ${retry}`);
            break;
          }
        }
      }

      results.push(result);

      // Stop execution if critical action fails
      if (!result.success && this.isCriticalAction(action)) {
        logger.error(`Critical action failed, stopping execution:`, { action: action.type });
        break;
      }

      // Add delay between actions
      if (i < actions.length - 1) {
        await this.delay(100); // ACTION_DELAY
      }

      // Validate state after each action if requested
      if (options.validateAfterEachAction) {
        await this.validateActionResult(action, result);
      }
    }
  }

  /**
   * Capture screenshot as base64 string
   */
  private async captureScreenshot(): Promise<string> {
    try {
      // Use type assertion to handle API differences in nut-js fork
      const screenAny = screen as any;
      const screenshot = await screenAny.grabScreen();
      return screenshot.toString('base64');
    } catch (error) {
      logger.error('Screenshot capture failed:', { error });
      throw error;
    }
  }

  /**
   * Check if action is critical (should stop execution if it fails)
   */
  private isCriticalAction(action: VisualAgentAction): boolean {
    return ['click', 'doubleClick', 'type'].includes(action.type);
  }

  /**
   * Validate action result (placeholder for future validation logic)
   */
  private async validateActionResult(action: VisualAgentAction, result: ActionExecutionResult): Promise<void> {
    if (!result.success) {
      logger.warn('Action validation failed:', { actionType: action.type, error: result.error });
    }
  }

  /**
   * Delay execution for specified milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Move mouse to coordinates
   */
  private async moveMouse(action: VisualAgentAction): Promise<void> {
    if (!action.coordinates) {
      throw new Error('Mouse move action requires coordinates');
    }
    
    await mouse.move([
      { x: action.coordinates.x, y: action.coordinates.y }
    ]);
  }

  /**
   * Click at coordinates
   */
  private async click(action: VisualAgentAction): Promise<void> {
    if (action.coordinates) {
      // Move to coordinates first, then click
      await mouse.move([
        { x: action.coordinates.x, y: action.coordinates.y }
      ]);
    }
    
    await mouse.click(Button.LEFT);
  }

  /**
   * Right click at coordinates
   */
  private async rightClick(action: VisualAgentAction): Promise<void> {
    if (action.coordinates) {
      // Move to coordinates first, then right click
      await mouse.move([
        { x: action.coordinates.x, y: action.coordinates.y }
      ]);
    }
    
    await mouse.click(Button.RIGHT);
  }

  /**
   * Double click at coordinates
   */
  private async doubleClick(action: VisualAgentAction): Promise<void> {
    if (action.coordinates) {
      // Move to coordinates first, then double click
      await mouse.move([
        { x: action.coordinates.x, y: action.coordinates.y }
      ]);
    }
    
    await mouse.doubleClick(Button.LEFT);
  }

  /**
   * Drag from one coordinate to another
   */
  private async drag(action: VisualAgentAction): Promise<void> {
    if (!action.coordinates) {
      throw new Error('Drag action requires coordinates');
    }
    
    // For drag, we need both start and end coordinates
    // If only one coordinate is provided, we assume current mouse position as start
    const currentPos = await mouse.getPosition();
    const startX = action.startCoordinates?.x ?? currentPos.x;
    const startY = action.startCoordinates?.y ?? currentPos.y;
    
    // Move to start position
    await mouse.move([{ x: startX, y: startY }]);
    
    // Press and hold
    await mouse.pressButton(Button.LEFT);
    
    // Drag to end position
    await mouse.move([{ x: action.coordinates.x, y: action.coordinates.y }]);
    
    // Release
    await mouse.releaseButton(Button.LEFT);
  }

  /**
   * Type text
   */
  private async type(action: VisualAgentAction): Promise<void> {
    if (!action.text) {
      throw new Error('Type action requires text');
    }
    
    await keyboard.type(action.text);
  }

  /**
   * Press specific key
   */
  private async keyPress(action: VisualAgentAction): Promise<void> {
    if (!action.key) {
      throw new Error('Key press action requires key');
    }
    
    const key = this.mapStringToKey(action.key);
    await keyboard.pressKey(key);
  }

  /**
   * Wait for specified duration
   */
  private async wait(action: VisualAgentAction): Promise<void> {
    const duration = action.duration || 1000; // Default 1 second
    await new Promise(resolve => setTimeout(resolve, duration));
  }

  /**
   * Scroll in specified direction
   */
  private async scroll(action: VisualAgentAction): Promise<void> {
    const amount = action.amount || 3; // Default scroll amount
    
    switch (action.direction) {
      case 'up':
        await mouse.scrollUp(amount);
        break;
      case 'down':
        await mouse.scrollDown(amount);
        break;
      case 'left':
        await mouse.scrollLeft(amount);
        break;
      case 'right':
        await mouse.scrollRight(amount);
        break;
      default:
        throw new Error(`Unsupported scroll direction: ${action.direction}`);
    }
  }

  /**
   * Map string key names to nut.js Key enum
   */
  private mapStringToKey(keyString: string): Key {
    const keyMap: Record<string, Key> = {
      'Enter': Key.Enter,
      'Return': Key.Enter,
      'Tab': Key.Tab,
      'Escape': Key.Escape,
      'Esc': Key.Escape,
      'Space': Key.Space,
      'Backspace': Key.Backspace,
      'Delete': Key.Delete,
      'ArrowUp': Key.Up,
      'ArrowDown': Key.Down,
      'ArrowLeft': Key.Left,
      'ArrowRight': Key.Right,
      'Up': Key.Up,
      'Down': Key.Down,
      'Left': Key.Left,
      'Right': Key.Right,
      'Home': Key.Home,
      'End': Key.End,
      'PageUp': Key.PageUp,
      'PageDown': Key.PageDown,
      'F1': Key.F1,
      'F2': Key.F2,
      'F3': Key.F3,
      'F4': Key.F4,
      'F5': Key.F5,
      'F6': Key.F6,
      'F7': Key.F7,
      'F8': Key.F8,
      'F9': Key.F9,
      'F10': Key.F10,
      'F11': Key.F11,
      'F12': Key.F12,
      'Cmd': Key.LeftCmd,
      'Command': Key.LeftCmd,
      'Ctrl': Key.LeftControl,
      'Control': Key.LeftControl,
      'Alt': Key.LeftAlt,
      'Option': Key.LeftAlt,
      'Shift': Key.LeftShift
    };

    const mappedKey = keyMap[keyString];
    if (!mappedKey) {
      // For single characters, try to use them directly
      if (keyString.length === 1) {
        const lowerKey = keyString.toLowerCase();
        // Use type assertion through unknown for type safety
        try {
          return lowerKey as unknown as Key;
        } catch (error) {
          logger.warn(`Failed to use key '${keyString}' directly, falling back to error`, { error });
          throw new Error(`Unsupported key: ${keyString}`);
        }
      }
      throw new Error(`Unsupported key: ${keyString}`);
    }

    return mappedKey;
  }

  /**
   * Get current mouse position
   */
  async getCurrentMousePosition(): Promise<{ x: number; y: number }> {
    try {
      const position = await mouse.getPosition();
      return { x: position.x, y: position.y };
    } catch (error) {
      logger.error('Failed to get mouse position:', { error });
      throw new Error('Failed to get mouse position');
    }
  }

  /**
   * Get screen dimensions
   */
  async getScreenDimensions(): Promise<{ width: number; height: number }> {
    try {
      // Use type assertion to handle API differences in nut-js fork
      const screenAny = screen as any;
      
      // Method 1: Try width() and height() methods
      if (typeof screenAny.width === 'function' && typeof screenAny.height === 'function') {
        const width = await screenAny.width();
        const height = await screenAny.height();
        return { width, height };
      }
      // Method 2: Try bounds() method
      else if (typeof screenAny.bounds === 'function') {
        const bounds = await screenAny.bounds();
        return { width: bounds.width, height: bounds.height };
      }
      // Method 3: Try size() method (original API)
      else if (typeof screenAny.size === 'function') {
        const size = await screenAny.size();
        return { width: size.width, height: size.height };
      }
      // Method 4: Try accessing properties directly
      else if (screenAny.width && screenAny.height) {
        return { width: screenAny.width, height: screenAny.height };
      }
      // Fallback: Use a default resolution and log warning
      else {
        logger.warn('Unable to determine screen dimensions using any known method, using fallback resolution');
        return { width: 1920, height: 1080 }; // Common fallback
      }
    } catch (error) {
      logger.error('Failed to get screen dimensions:', { error });
      // Fallback to common resolution
      logger.warn('Using fallback screen resolution: 1920x1080');
      return { width: 1920, height: 1080 };
    }
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return this.initialized;
  }

  /**
   * Emergency stop - move mouse to safe position
   */
  async emergencyStop(): Promise<void> {
    try {
      // Move mouse to top-left corner as safe position
      await mouse.move([{ x: 0, y: 0 }]);
      logger.info('Emergency stop executed - mouse moved to safe position');
    } catch (error) {
      logger.error('Emergency stop failed:', { error });
    }
  }
}

// Export singleton instance
export const desktopAutomationService = new DesktopAutomationService();

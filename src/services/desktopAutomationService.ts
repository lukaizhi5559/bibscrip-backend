import { mouse, keyboard, screen, Key, Button } from '@nut-tree-fork/nut-js';
import { logger } from '../utils/logger';
import { Action, ActionPlan } from './visualAgentService';

export interface ExecutionResult {
  success: boolean;
  executedActions: number;
  totalActions: number;
  error?: string;
  duration: number;
  timestamp: string;
}

export interface ActionExecutionResult {
  action: Action;
  success: boolean;
  error?: string;
  duration: number;
}

/**
 * Desktop Automation Service
 * Executes actions using nut.js for precise desktop interaction
 */
export class DesktopAutomationService {
  private isInitialized = false;

  constructor() {
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
      
      this.isInitialized = true;
      logger.info('Desktop Automation Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Desktop Automation Service:', { error });
      this.isInitialized = false;
    }
  }

  /**
   * Execute a single action
   */
  async executeAction(action: Action): Promise<ActionExecutionResult> {
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
   * Execute complete action plan
   */
  async executeActionPlan(actionPlan: ActionPlan): Promise<ExecutionResult> {
    const startTime = performance.now();
    const timestamp = new Date().toISOString();
    
    if (!this.isInitialized) {
      return {
        success: false,
        executedActions: 0,
        totalActions: actionPlan.actions.length,
        error: 'Desktop Automation Service not initialized',
        duration: 0,
        timestamp
      };
    }

    logger.info('Starting action plan execution', {
      totalActions: actionPlan.actions.length,
      confidence: actionPlan.confidence,
      reasoning: actionPlan.reasoning
    });

    let executedActions = 0;
    const results: ActionExecutionResult[] = [];

    try {
      for (const action of actionPlan.actions) {
        const result = await this.executeAction(action);
        results.push(result);
        
        if (result.success) {
          executedActions++;
        } else {
          // Stop execution on first failure for safety
          logger.warn('Stopping action plan execution due to failed action', {
            failedAction: action.type,
            error: result.error
          });
          break;
        }
      }

      const duration = performance.now() - startTime;
      const success = executedActions === actionPlan.actions.length;

      logger.info('Action plan execution completed', {
        success,
        executedActions,
        totalActions: actionPlan.actions.length,
        duration: `${duration.toFixed(2)}ms`
      });

      return {
        success,
        executedActions,
        totalActions: actionPlan.actions.length,
        duration,
        timestamp
      };
    } catch (error) {
      const duration = performance.now() - startTime;
      logger.error('Action plan execution failed:', { error });

      return {
        success: false,
        executedActions,
        totalActions: actionPlan.actions.length,
        error: error instanceof Error ? error.message : String(error),
        duration,
        timestamp
      };
    }
  }

  /**
   * Move mouse to coordinates
   */
  private async moveMouse(action: Action): Promise<void> {
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
  private async click(action: Action): Promise<void> {
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
  private async rightClick(action: Action): Promise<void> {
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
  private async doubleClick(action: Action): Promise<void> {
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
  private async drag(action: Action): Promise<void> {
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
  private async type(action: Action): Promise<void> {
    if (!action.text) {
      throw new Error('Type action requires text');
    }
    
    await keyboard.type(action.text);
  }

  /**
   * Press specific key
   */
  private async keyPress(action: Action): Promise<void> {
    if (!action.key) {
      throw new Error('Key press action requires key');
    }
    
    const key = this.mapStringToKey(action.key);
    await keyboard.pressKey(key);
  }

  /**
   * Wait for specified duration
   */
  private async wait(action: Action): Promise<void> {
    const duration = action.duration || 1000; // Default 1 second
    await new Promise(resolve => setTimeout(resolve, duration));
  }

  /**
   * Scroll in specified direction
   */
  private async scroll(action: Action): Promise<void> {
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
    return this.isInitialized;
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

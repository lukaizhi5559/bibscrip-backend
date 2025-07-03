import screenshot from 'screenshot-desktop';
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import { z } from 'zod';
import { logger } from '../utils/logger';
import { LLMPlanningService } from './llmPlanningService';
import { DesktopAutomationService } from './desktopAutomationService';
import { Action, ActionPlan, ScreenshotData, OCRResult } from './visualAgentService';

// Enhanced UI Element Recognition Schema
const UIElementSchema = z.object({
  type: z.enum(['button', 'menu', 'textField', 'icon', 'window', 'desktop', 'menuItem']),
  text: z.string().optional(),
  coordinates: z.object({
    x: z.number(),
    y: z.number(),
    width: z.number().optional(),
    height: z.number().optional()
  }),
  confidence: z.number().min(0).max(1),
  description: z.string()
});

const VisualStateSchema = z.object({
  screenDimensions: z.object({
    width: z.number(),
    height: z.number()
  }),
  isFullscreen: z.boolean(),
  activeApplication: z.string().optional(),
  desktopVisible: z.boolean(),
  uiElements: z.array(UIElementSchema),
  contextDescription: z.string(),
  recommendedActions: z.array(z.string())
});

const ActionResultSchema = z.object({
  success: z.boolean(),
  visualStateChanged: z.boolean(),
  expectedOutcome: z.string(),
  actualOutcome: z.string(),
  nextRecommendedAction: z.string().optional(),
  errorDescription: z.string().optional()
});

export type UIElement = z.infer<typeof UIElementSchema>;
export type VisualState = z.infer<typeof VisualStateSchema>;
export type ActionResult = z.infer<typeof ActionResultSchema>;

/**
 * Vision-First Desktop Automation Service
 * Implements real-time visual feedback loop for robust desktop automation
 */
export class VisionFirstAutomationService {
  private llmPlanningService: LLMPlanningService;
  private desktopAutomationService: DesktopAutomationService;
  private ocrWorker: any;
  private isInitialized = false;

  constructor() {
    this.llmPlanningService = new LLMPlanningService();
    this.desktopAutomationService = new DesktopAutomationService();
    this.initialize();
  }

  /**
   * Initialize OCR worker and services
   */
  private async initialize(): Promise<void> {
    try {
      this.ocrWorker = await createWorker('eng');
      this.isInitialized = true;
      logger.info('Vision-First Automation Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Vision-First Automation Service:', { error });
      this.isInitialized = false;
    }
  }

  /**
   * Capture and analyze current visual state
   */
  async analyzeCurrentVisualState(): Promise<VisualState> {
    try {
      // Capture screenshot
      const screenshotData = await this.captureScreenshot();
      
      // Perform OCR to extract text
      const ocrResult = await this.performOCR(screenshotData.buffer);
      
      // Use LLM to analyze visual state and identify UI elements
      const visualAnalysis = await this.performVisualAnalysis(screenshotData, ocrResult.text);
      
      return visualAnalysis;
    } catch (error) {
      logger.error('Failed to analyze visual state:', { error });
      throw new Error(`Visual state analysis failed: ${error}`);
    }
  }

  /**
   * Execute task with vision-first approach
   */
  async executeTaskWithVision(
    taskDescription: string,
    maxIterations: number = 10
  ): Promise<{
    success: boolean;
    iterations: number;
    finalState: VisualState;
    executionLog: string[];
  }> {
    const executionLog: string[] = [];
    let currentIteration = 0;

    try {
      executionLog.push(`Starting vision-first execution: "${taskDescription}"`);

      while (currentIteration < maxIterations) {
        currentIteration++;
        executionLog.push(`\n--- Iteration ${currentIteration} ---`);

        // Step 1: Capture screenshot and perform OCR
        const screenshotData = await this.captureScreenshot();
        const ocrResult = await this.performOCR(screenshotData.buffer);
        
        // Step 2: Analyze current visual state
        const visualState = await this.performVisualAnalysis(screenshotData, ocrResult.text);
        executionLog.push(`Visual State: ${visualState.contextDescription}`);
        executionLog.push(`Desktop Visible: ${visualState.desktopVisible}, Fullscreen: ${visualState.isFullscreen}`);
        executionLog.push(`UI Elements Found: ${visualState.uiElements.length}`);

        // Step 3: Check if task is already completed
        const taskStatus = await this.checkTaskCompletion(taskDescription, visualState);
        if (taskStatus.completed) {
          executionLog.push(`✅ Task completed successfully: ${taskStatus.reason}`);
          return {
            success: true,
            iterations: currentIteration,
            finalState: visualState,
            executionLog
          };
        }

        // Step 4: Plan next action based on current visual state with actual data
        const nextAction = await this.planNextAction(taskDescription, visualState, screenshotData, ocrResult);
        executionLog.push(`Planned Action: ${nextAction.type} at (${nextAction.coordinates?.x}, ${nextAction.coordinates?.y})`);

        // Step 4: Execute the action
        const actionResult = await this.executeActionWithVerification(nextAction);
        executionLog.push(`Action Result: ${actionResult.success ? '✅ Success' : '❌ Failed'}`);
        executionLog.push(`Outcome: ${actionResult.actualOutcome}`);

        // Step 5: Handle errors and adapt
        if (!actionResult.success) {
          executionLog.push(`⚠️ Action failed, analyzing error and adapting...`);
          const recoveryAction = await this.planErrorRecovery(nextAction, actionResult, visualState);
          if (recoveryAction) {
            executionLog.push(`Recovery Action: ${recoveryAction.type}`);
            await this.executeActionWithVerification(recoveryAction);
          }
        }

        // Wait before next iteration to allow UI to settle
        await this.wait(500);
      }

      // Max iterations reached
      const finalState = await this.analyzeCurrentVisualState();
      executionLog.push(`❌ Max iterations (${maxIterations}) reached without completion`);
      
      return {
        success: false,
        iterations: currentIteration,
        finalState,
        executionLog
      };

    } catch (error) {
      logger.error('Vision-first execution failed:', { error });
      executionLog.push(`💥 Critical Error: ${error}`);
      
      const finalState = await this.analyzeCurrentVisualState().catch(() => ({
        screenDimensions: { width: 0, height: 0 },
        isFullscreen: false,
        desktopVisible: false,
        uiElements: [],
        contextDescription: 'Error state - unable to analyze',
        recommendedActions: []
      }));

      return {
        success: false,
        iterations: currentIteration,
        finalState,
        executionLog
      };
    }
  }

  /**
   * Capture screenshot with metadata
   */
  private async captureScreenshot(): Promise<ScreenshotData> {
    const displays = await screenshot.listDisplays();
    const primaryDisplay = displays[0];
    
    const img = await screenshot({ 
      screen: primaryDisplay.id,
      format: 'png'
    });
    
    const metadata = await sharp(img).metadata();
    
    return {
      buffer: img,
      width: metadata.width || 0,
      height: metadata.height || 0,
      timestamp: new Date().toISOString(),
      format: 'png'
    };
  }

  /**
   * Perform OCR on screenshot
   */
  private async performOCR(imageBuffer: Buffer): Promise<OCRResult> {
    if (!this.isInitialized) {
      await this.initialize();
    }
    
    const { data: { text, confidence, words } } = await this.ocrWorker.recognize(imageBuffer);
    return {
      text: text.trim(),
      confidence: confidence || 0.8,
      words: words?.map((word: any) => ({
        text: word.text,
        confidence: word.confidence,
        bbox: {
          x0: word.bbox.x0,
          y0: word.bbox.y0,
          x1: word.bbox.x1,
          y1: word.bbox.y1
        }
      })) || []
    };
  }

  /**
   * Use LLM to analyze visual state and identify UI elements
   */
  private async performVisualAnalysis(
    screenshotData: ScreenshotData, 
    ocrText: string
  ): Promise<VisualState> {
    const analysisPrompt = `
You are a visual UI analysis expert. Analyze this screenshot and provide detailed information about the current visual state.

Screen Dimensions: ${screenshotData.width}x${screenshotData.height}
OCR Text Found: "${ocrText}"

Please analyze and return a JSON object with:
1. screenDimensions: {width, height}
2. isFullscreen: boolean (is any app in fullscreen mode?)
3. activeApplication: string (what app is currently active/focused?)
4. desktopVisible: boolean (can you see the desktop background?)
5. uiElements: array of UI elements you can identify with their coordinates
6. contextDescription: detailed description of what's currently on screen
7. recommendedActions: array of possible actions based on current state

Focus on identifying:
- Clickable buttons and their exact coordinates
- Menu items and context menus
- Text fields and input areas
- Windows and their titles
- Desktop icons and folders
- System UI elements (dock, menu bar, etc.)

Be precise with coordinates and confident in your analysis.
`;

    try {
      const response = await this.llmPlanningService.generateActionPlan({
        userPrompt: analysisPrompt,
        screenshot: screenshotData,
        ocrResult: { text: ocrText, confidence: 0.8, words: [] },
        clipboardContent: '',
        timestamp: new Date().toISOString()
      });

      // Parse the LLM response as VisualState
      const visualState = JSON.parse(response.actionPlan.reasoning);
      return VisualStateSchema.parse(visualState);
    } catch (error) {
      logger.error('Visual analysis failed:', { error });
      
      // Fallback visual state
      return {
        screenDimensions: { width: screenshotData.width, height: screenshotData.height },
        isFullscreen: false,
        activeApplication: 'Unknown',
        desktopVisible: true,
        uiElements: [],
        contextDescription: `Screen ${screenshotData.width}x${screenshotData.height} with OCR text: ${ocrText.substring(0, 100)}...`,
        recommendedActions: ['Take screenshot', 'Analyze UI elements']
      };
    }
  }

  /**
   * Check if the task has been completed
   */
  private async checkTaskCompletion(
    taskDescription: string, 
    visualState: VisualState
  ): Promise<{ completed: boolean; reason: string }> {
    const completionPrompt = `
Task: "${taskDescription}"
Current Visual State: ${visualState.contextDescription}
UI Elements: ${JSON.stringify(visualState.uiElements)}

Has this task been completed based on the current visual state? 
Return JSON: {"completed": boolean, "reason": "explanation"}
`;

    try {
      const response = await this.llmPlanningService.generateActionPlan({
        userPrompt: completionPrompt,
        screenshot: { buffer: Buffer.alloc(0), width: 0, height: 0, timestamp: new Date().toISOString(), format: 'png' },
        ocrResult: { text: '', confidence: 0.8, words: [] },
        clipboardContent: '',
        timestamp: new Date().toISOString()
      });

      return JSON.parse(response.actionPlan.reasoning);
    } catch (error) {
      return { completed: false, reason: 'Unable to determine completion status' };
    }
  }

  /**
   * Plan the next action based on current visual state
   */
  private async planNextAction(
    taskDescription: string, 
    visualState: VisualState,
    currentScreenshot?: ScreenshotData,
    currentOcrResult?: OCRResult
  ): Promise<Action> {
    const actionPrompt = `
Task: "${taskDescription}"
Current Visual State: ${visualState.contextDescription}
Available UI Elements: ${JSON.stringify(visualState.uiElements)}
Screen Dimensions: ${visualState.screenDimensions.width}x${visualState.screenDimensions.height}
Is Fullscreen: ${visualState.isFullscreen}
Desktop Visible: ${visualState.desktopVisible}

Based on the current visual state, what is the next single action to take to progress toward completing the task?

For mouse movement tasks:
- To move mouse to center of screen, use: {"type": "moveMouse", "coordinates": {"x": ${Math.floor(visualState.screenDimensions.width / 2)}, "y": ${Math.floor(visualState.screenDimensions.height / 2)}}}
- For clicks, use: {"type": "click", "coordinates": {"x": number, "y": number}}
- For typing, use: {"type": "type", "text": "string"}

Consider:
- Current UI elements and their exact coordinates
- Whether we're in fullscreen mode or can see desktop
- The most logical next step to accomplish the task
- Avoid system UI areas (menu bar: y < 30, dock area)

Return a single Action object with precise coordinates based on the visual analysis.
`;

    try {
      // Use actual screenshot data if available, otherwise capture new one
      let screenshotData = currentScreenshot;
      let ocrResult = currentOcrResult;
      
      if (!screenshotData) {
        screenshotData = await this.captureScreenshot();
      }
      
      if (!ocrResult) {
        ocrResult = await this.performOCR(screenshotData.buffer);
      }

      const response = await this.llmPlanningService.generateActionPlan({
        userPrompt: actionPrompt,
        screenshot: screenshotData,
        ocrResult: ocrResult,
        clipboardContent: '',
        timestamp: new Date().toISOString()
      });

      return response.actionPlan.actions[0];
    } catch (error) {
      logger.error('Action planning failed:', { error });
      
      // Fallback action based on task description
      if (taskDescription.toLowerCase().includes('mouse') && taskDescription.toLowerCase().includes('center')) {
        return {
          type: 'moveMouse',
          coordinates: {
            x: Math.floor(visualState.screenDimensions.width / 2),
            y: Math.floor(visualState.screenDimensions.height / 2)
          }
        };
      }
      
      // Default fallback - take screenshot to re-analyze
      return {
        type: 'screenshot'
      };
    }
  }

  /**
   * Execute action and verify the result
   */
  private async executeActionWithVerification(action: Action): Promise<ActionResult> {
    try {
      // Capture state before action
      const beforeState = await this.analyzeCurrentVisualState();
      
      // Execute the action
      const executionResult = await this.desktopAutomationService.executeAction(action);
      
      // Wait for UI to settle
      await this.wait(300);
      
      // Capture state after action
      const afterState = await this.analyzeCurrentVisualState();
      
      // Analyze the change
      const stateChanged = beforeState.contextDescription !== afterState.contextDescription;
      
      return {
        success: executionResult.success,
        visualStateChanged: stateChanged,
        expectedOutcome: `Action ${action.type} should modify the UI`,
        actualOutcome: stateChanged ? 'UI state changed as expected' : 'No visible change detected',
        nextRecommendedAction: afterState.recommendedActions[0]
      };
    } catch (error) {
      return {
        success: false,
        visualStateChanged: false,
        expectedOutcome: `Action ${action.type} should execute successfully`,
        actualOutcome: `Action failed: ${error}`,
        errorDescription: String(error)
      };
    }
  }

  /**
   * Plan error recovery action
   */
  private async planErrorRecovery(
    failedAction: Action,
    actionResult: ActionResult,
    visualState: VisualState
  ): Promise<Action | null> {
    // Simple recovery strategies
    if (failedAction.type === 'click' && !actionResult.visualStateChanged) {
      // Try right-click instead
      return {
        type: 'rightClick',
        coordinates: failedAction.coordinates
      };
    }
    
    if (failedAction.type === 'rightClick') {
      // Try moving to a different area and clicking
      return {
        type: 'moveMouse',
        coordinates: {
          x: (failedAction.coordinates?.x || 0) + 50,
          y: (failedAction.coordinates?.y || 0) + 50
        }
      };
    }
    
    return null;
  }

  /**
   * Wait utility
   */
  private async wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.ocrWorker) {
      await this.ocrWorker.terminate();
    }
  }
}

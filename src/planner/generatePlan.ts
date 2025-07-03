// LLM Planner - Claude Sonnet 4 powered action planning using UI index
// Generates deterministic JSON action plans for desktop automation

import { logger } from '../utils/logger';
import { UIElement } from '../agent/uiIndexerDaemon';
import { createClaudePrompt } from './promptTemplates';
import { FastLLMRouter } from '../utils/fastLLMRouter';

// Action types supported by the executor
export interface Action {
  type: 'click' | 'doubleClick' | 'rightClick' | 'type' | 'key' | 'scroll' | 'drag' | 'wait' | 'screenshot';
  coordinates?: { x: number; y: number };
  text?: string;
  key?: string;
  scrollDirection?: 'up' | 'down' | 'left' | 'right';
  scrollAmount?: number;
  dragTo?: { x: number; y: number };
  waitMs?: number;
  elementId?: number; // Reference to UI element from index
  confidence?: number; // Confidence in action accuracy (0-1)
}

export interface ActionPlan {
  actions: Action[];
  reasoning: string;
  confidence: number;
  fallbackRequired: boolean;
  estimatedDuration: number; // milliseconds
  targetApp: string;
  targetWindow: string;
}

export interface PlanningContext {
  taskDescription: string;
  uiElements: UIElement[];
  activeApp: { name: string; windowTitle: string };
  maxActions?: number;
  allowFallback?: boolean;
}

export class LLMPlanner {
  private fastLLMRouter: FastLLMRouter;
  private readonly MAX_RETRIES = 2;
  private readonly PLANNING_TIMEOUT = 8000; // 8 seconds

  constructor() {
    this.fastLLMRouter = new FastLLMRouter();
  }

  async generatePlan(context: PlanningContext): Promise<ActionPlan> {
    const startTime = Date.now();
    
    try {
      logger.info('Generating action plan with LLM', {
        task: context.taskDescription,
        elementCount: context.uiElements.length,
        activeApp: context.activeApp.name
      });

      // Create Claude Sonnet 4 prompt with UI index context
      const prompt = createClaudePrompt(context);
      
      // Get LLM response with retries
      let llmResponse: string | null = null;
      let lastError: Error | null = null;

      for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
        try {
          const response = await this.fastLLMRouter.processTextPrompt(prompt);
          
          llmResponse = response.text;
          break;
          
        } catch (error) {
          lastError = error as Error;
          logger.warn(`LLM planning attempt ${attempt} failed:`, { error: error instanceof Error ? error.message : error });
          
          if (attempt < this.MAX_RETRIES) {
            await this.delay(1000 * attempt); // Exponential backoff
          }
        }
      }

      if (!llmResponse) {
        throw new Error(`LLM planning failed after ${this.MAX_RETRIES} attempts: ${lastError?.message}`);
      }

      // Parse LLM response into ActionPlan
      const actionPlan = this.parseActionPlan(llmResponse, context);
      
      // Validate and enhance the plan
      const validatedPlan = this.validatePlan(actionPlan, context);
      
      const planningTime = Date.now() - startTime;
      logger.info('Action plan generated successfully', {
        actionCount: validatedPlan.actions.length,
        confidence: validatedPlan.confidence,
        planningTime,
        fallbackRequired: validatedPlan.fallbackRequired
      });

      return validatedPlan;
      
    } catch (error) {
      const planningTime = Date.now() - startTime;
      logger.error('Failed to generate action plan:', { 
        error: error instanceof Error ? error.message : error,
        planningTime,
        task: context.taskDescription
      });
      
      // Return fallback plan
      return this.createFallbackPlan(context, error as Error);
    }
  }

  private parseActionPlan(llmResponse: string, context: PlanningContext): ActionPlan {
    try {
      // Extract JSON from LLM response (handle markdown code blocks)
      let jsonStr = llmResponse.trim();
      
      // Remove markdown code blocks if present
      const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)\s*```/;
      const match = jsonStr.match(codeBlockRegex);
      if (match) {
        jsonStr = match[1].trim();
      }
      
      // Try to parse as JSON
      const parsed = JSON.parse(jsonStr);
      
      // Validate required fields
      if (!parsed.actions || !Array.isArray(parsed.actions)) {
        throw new Error('Invalid action plan: missing or invalid actions array');
      }
      
      // Map to ActionPlan interface
      const actionPlan: ActionPlan = {
        actions: parsed.actions.map((action: any, index: number) => this.validateAction(action, index, context)),
        reasoning: parsed.reasoning || 'No reasoning provided',
        confidence: Math.max(0, Math.min(1, parsed.confidence || 0.8)),
        fallbackRequired: parsed.fallbackRequired || false,
        estimatedDuration: parsed.estimatedDuration || (parsed.actions.length * 1000),
        targetApp: context.activeApp.name,
        targetWindow: context.activeApp.windowTitle
      };
      
      return actionPlan;
      
    } catch (error) {
      logger.error('Failed to parse LLM action plan:', { error, response: llmResponse.substring(0, 500) });
      throw new Error(`Action plan parsing failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  private validateAction(action: any, index: number, context: PlanningContext): Action {
    // Validate action type
    const validTypes = ['click', 'doubleClick', 'rightClick', 'type', 'key', 'scroll', 'drag', 'wait', 'screenshot'];
    if (!validTypes.includes(action.type)) {
      throw new Error(`Invalid action type at index ${index}: ${action.type}`);
    }

    const validatedAction: Action = {
      type: action.type,
      confidence: Math.max(0, Math.min(1, action.confidence || 0.8))
    };

    // Validate type-specific properties
    switch (action.type) {
      case 'click':
      case 'doubleClick':
      case 'rightClick':
        if (!action.coordinates || typeof action.coordinates.x !== 'number' || typeof action.coordinates.y !== 'number') {
          throw new Error(`Invalid coordinates for ${action.type} action at index ${index}`);
        }
        validatedAction.coordinates = action.coordinates;
        validatedAction.elementId = action.elementId;
        break;
        
      case 'type':
        if (!action.text || typeof action.text !== 'string') {
          throw new Error(`Invalid text for type action at index ${index}`);
        }
        validatedAction.text = action.text;
        validatedAction.coordinates = action.coordinates; // Optional click before type
        break;
        
      case 'key':
        if (!action.key || typeof action.key !== 'string') {
          throw new Error(`Invalid key for key action at index ${index}`);
        }
        validatedAction.key = action.key;
        break;
        
      case 'scroll':
        validatedAction.scrollDirection = action.scrollDirection || 'down';
        validatedAction.scrollAmount = action.scrollAmount || 3;
        validatedAction.coordinates = action.coordinates; // Optional scroll location
        break;
        
      case 'drag':
        if (!action.coordinates || !action.dragTo) {
          throw new Error(`Invalid coordinates for drag action at index ${index}`);
        }
        validatedAction.coordinates = action.coordinates;
        validatedAction.dragTo = action.dragTo;
        break;
        
      case 'wait':
        validatedAction.waitMs = Math.max(100, Math.min(10000, action.waitMs || 1000));
        break;
        
      case 'screenshot':
        // No additional validation needed
        break;
    }

    return validatedAction;
  }

  private validatePlan(plan: ActionPlan, context: PlanningContext): ActionPlan {
    // Ensure plan doesn't exceed max actions
    const maxActions = context.maxActions || 10;
    if (plan.actions.length > maxActions) {
      logger.warn(`Plan exceeds max actions (${maxActions}), truncating`);
      plan.actions = plan.actions.slice(0, maxActions);
    }

    // Enhance actions with UI element context
    plan.actions = plan.actions.map(action => this.enhanceActionWithUIContext(action, context.uiElements));

    // Calculate realistic estimated duration
    plan.estimatedDuration = this.calculateEstimatedDuration(plan.actions);

    // Adjust confidence based on UI element availability
    plan.confidence = this.calculatePlanConfidence(plan, context.uiElements);

    // Determine if fallback is required
    plan.fallbackRequired = plan.confidence < 0.7 || plan.actions.some(action => action.type === 'screenshot');

    return plan;
  }

  private enhanceActionWithUIContext(action: Action, uiElements: UIElement[]): Action {
    // If action has elementId, validate it exists and is actionable
    if (action.elementId) {
      const element = uiElements.find(el => el.id === action.elementId);
      if (element && element.isEnabled && element.isVisible) {
        // Use element's actual coordinates if not specified
        if (!action.coordinates) {
          action.coordinates = {
            x: element.x + Math.floor(element.width / 2),
            y: element.y + Math.floor(element.height / 2)
          };
        }
        action.confidence = Math.min(1, (action.confidence || 0.8) * element.confidenceScore);
      } else {
        // Element not found or not actionable, reduce confidence
        action.confidence = Math.max(0.3, (action.confidence || 0.8) * 0.5);
      }
    }

    return action;
  }

  private calculateEstimatedDuration(actions: Action[]): number {
    let totalMs = 0;
    
    for (const action of actions) {
      switch (action.type) {
        case 'click':
        case 'doubleClick':
        case 'rightClick':
          totalMs += 200; // Click duration
          break;
        case 'type':
          totalMs += (action.text?.length || 0) * 50 + 300; // Typing speed + setup
          break;
        case 'key':
          totalMs += 150; // Key press duration
          break;
        case 'scroll':
          totalMs += 300; // Scroll duration
          break;
        case 'drag':
          totalMs += 500; // Drag duration
          break;
        case 'wait':
          totalMs += action.waitMs || 1000;
          break;
        case 'screenshot':
          totalMs += 1000; // Screenshot capture time
          break;
      }
    }
    
    return totalMs;
  }

  private calculatePlanConfidence(plan: ActionPlan, uiElements: UIElement[]): number {
    if (plan.actions.length === 0) return 0;
    
    let totalConfidence = 0;
    let weightedActions = 0;
    
    for (const action of plan.actions) {
      const actionWeight = action.type === 'screenshot' ? 0.1 : 1.0; // Screenshots are low confidence
      totalConfidence += (action.confidence || 0.8) * actionWeight;
      weightedActions += actionWeight;
    }
    
    const baseConfidence = weightedActions > 0 ? totalConfidence / weightedActions : 0.5;
    
    // Boost confidence if we have good UI element coverage
    const elementsWithActions = uiElements.filter(el => 
      plan.actions.some(action => action.elementId === el.id)
    );
    const coverageBoost = Math.min(0.2, elementsWithActions.length * 0.05);
    
    return Math.min(1, baseConfidence + coverageBoost);
  }

  private createFallbackPlan(context: PlanningContext, error: Error): ActionPlan {
    logger.warn('Creating fallback plan due to LLM failure', { error: error.message });
    
    return {
      actions: [
        {
          type: 'screenshot',
          confidence: 0.5
        }
      ],
      reasoning: `Fallback plan created due to LLM planning failure: ${error.message}`,
      confidence: 0.3,
      fallbackRequired: true,
      estimatedDuration: 1000,
      targetApp: context.activeApp.name,
      targetWindow: context.activeApp.windowTitle
    };
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Public utility methods
  async validateTaskFeasibility(taskDescription: string, uiElements: UIElement[]): Promise<{
    feasible: boolean;
    confidence: number;
    reasoning: string;
    requiredElements: string[];
  }> {
    try {
      // Quick feasibility check using LLM
      const feasibilityPrompt = `
Analyze if this desktop automation task is feasible given the available UI elements:

Task: "${taskDescription}"

Available UI Elements:
${uiElements.slice(0, 20).map(el => `- ${el.elementRole}: "${el.elementLabel}" at (${el.x}, ${el.y})`).join('\n')}

Respond with JSON:
{
  "feasible": boolean,
  "confidence": number (0-1),
  "reasoning": "explanation",
  "requiredElements": ["list of required UI element types"]
}
      `;

      const response = await this.fastLLMRouter.processTextPrompt(feasibilityPrompt);

      const result = JSON.parse(response.text);
      return {
        feasible: result.feasible || false,
        confidence: Math.max(0, Math.min(1, result.confidence || 0.5)),
        reasoning: result.reasoning || 'No reasoning provided',
        requiredElements: result.requiredElements || []
      };
      
    } catch (error) {
      logger.error('Task feasibility check failed:', { error });
      return {
        feasible: false,
        confidence: 0.2,
        reasoning: `Feasibility check failed: ${error instanceof Error ? error.message : error}`,
        requiredElements: []
      };
    }
  }
}

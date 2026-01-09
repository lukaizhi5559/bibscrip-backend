/**
 * Intent Execution Engine
 * 
 * Core service for executing intent-based automation steps
 * - Uses intent-specific prompts (smaller context windows)
 * - LLM decides which actions to use from available actions
 * - Tracks action execution and results
 * - Returns step_complete with output screenshot and data
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger';
import { 
  IntentType, 
  IntentExecutionRequest, 
  IntentExecutionResult,
  ActionType,
  INTENT_AVAILABLE_ACTIONS,
  ClarificationQuestion
} from '../types/intentTypes';
import { intentPromptBuilder } from './intentPromptBuilder';

interface ActionExecutionResult {
  type: ActionType;
  timestamp: number;
  success: boolean;
  error?: string;
  metadata?: any;
}

export class IntentExecutionEngine {
  private openaiClient: OpenAI | null = null;
  private claudeClient: Anthropic | null = null;
  private geminiClient: GoogleGenerativeAI | null = null;

  constructor() {
    // Initialize LLM clients (priority: OpenAI → Claude → Gemini)
    if (process.env.OPENAI_API_KEY) {
      this.openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      logger.info('IntentExecutionEngine: OpenAI client initialized');
    }

    if (process.env.ANTHROPIC_API_KEY) {
      this.claudeClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      logger.info('IntentExecutionEngine: Claude client initialized');
    }

    if (process.env.GEMINI_API_KEY) {
      this.geminiClient = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      logger.info('IntentExecutionEngine: Gemini client initialized');
    }

    if (!this.openaiClient && !this.claudeClient && !this.geminiClient) {
      logger.warn('IntentExecutionEngine: No LLM clients available');
    }
  }

  /**
   * Execute a single intent step with retry logic and timeout
   * Returns when step is complete (all actions executed)
   */
  async executeIntent(
    request: IntentExecutionRequest,
    clarificationAnswers?: Record<string, string>
  ): Promise<IntentExecutionResult> {
    const startTime = Date.now();
    const { intentType, stepData, context } = request;

    logger.info('Executing intent step', {
      intentType,
      stepId: stepData.id,
      description: stepData.description,
    });

    // Validate intent has available actions
    const availableActions = INTENT_AVAILABLE_ACTIONS[intentType];
    if (!availableActions || availableActions.length === 0) {
      throw new Error(`No available actions defined for intent type: ${intentType}`);
    }

    const executedActions: ActionExecutionResult[] = [];
    let currentScreenshot = context.screenshot;
    let storedData = context.storedData || {};
    let isComplete = false;
    let attemptCount = 0;
    const maxAttempts = stepData.maxAttempts || 10; // Max actions per intent
    const intentTimeout = 30000; // 30 seconds max per intent
    const intentStartTime = Date.now();
    let retryCount = 0;
    const maxRetries = 3;

    try {
      // Execute actions until 'end' action or max attempts
      while (!isComplete && attemptCount < maxAttempts) {
        // Check timeout
        if (Date.now() - intentStartTime > intentTimeout) {
          throw new Error(`Intent execution timeout after ${intentTimeout}ms`);
        }

        attemptCount++;

        // Build intent-specific prompt with current screenshot and clarification answers
        let prompt = intentPromptBuilder.buildPrompt({
          ...request,
          context: {
            ...context,
            screenshot: currentScreenshot,
            storedData,
          },
        });

        // Append clarification answers if provided
        if (clarificationAnswers && Object.keys(clarificationAnswers).length > 0) {
          prompt += '\n\n## User Clarification Answers:\n';
          for (const [questionId, answer] of Object.entries(clarificationAnswers)) {
            prompt += `- ${questionId}: ${answer}\n`;
          }
        }

        // Get next action from LLM with retry logic
        let action = null;
        let llmError = null;

        for (let retry = 0; retry <= maxRetries; retry++) {
          try {
            action = await this.getNextAction(prompt, currentScreenshot, availableActions);
            
            // Check for clarification request
            if (action.type === 'clarification_needed' || action.needsClarification) {
              const questions = this.extractClarificationQuestions(action);
              if (questions.length > 0) {
                logger.info('Clarification needed', {
                  intentType,
                  stepId: stepData.id,
                  questionCount: questions.length,
                });

                return {
                  status: 'clarification_needed',
                  intentType,
                  stepId: stepData.id,
                  actions: executedActions,
                  outputScreenshot: currentScreenshot,
                  data: storedData,
                  executionTimeMs: Date.now() - startTime,
                  clarificationQuestions: questions,
                };
              }
            }

            if (action) break; // Success
          } catch (error: any) {
            llmError = error;
            retryCount++;
            logger.warn(`LLM call failed, retry ${retry + 1}/${maxRetries}`, {
              error: error.message,
              intentType,
              stepId: stepData.id,
            });
            
            if (retry < maxRetries) {
              await this.delay(1000 * (retry + 1)); // Exponential backoff
            }
          }
        }

        if (!action) {
          throw new Error(`LLM failed after ${maxRetries} retries: ${llmError?.message}`);
        }

        logger.info('Executing action', {
          intentType,
          stepId: stepData.id,
          actionType: action.type,
          attempt: attemptCount,
        });

        // Execute the action
        const actionResult = await this.executeAction(action, context, storedData);
        executedActions.push(actionResult);

        // Update state based on action result
        if (actionResult.metadata?.screenshot) {
          currentScreenshot = actionResult.metadata.screenshot;
        }

        if (actionResult.metadata?.storedData) {
          storedData = { ...storedData, ...actionResult.metadata.storedData };
        }

        // Check if step is complete
        if (action.type === 'end') {
          isComplete = true;
          logger.info('Intent step completed', {
            intentType,
            stepId: stepData.id,
            actionsExecuted: executedActions.length,
          });
        }

        // Safety check: if action failed, retry or request clarification
        if (!actionResult.success) {
          retryCount++;
          logger.warn('Action failed', {
            actionType: action.type,
            error: actionResult.error,
            retryCount,
          });

          if (retryCount >= maxRetries) {
            // After max retries, request clarification
            return {
              status: 'clarification_needed',
              intentType,
              stepId: stepData.id,
              actions: executedActions,
              outputScreenshot: currentScreenshot,
              data: storedData,
              executionTimeMs: Date.now() - startTime,
              clarificationQuestions: [
                {
                  id: 'retry_failed',
                  question: `Action '${action.type}' failed after ${maxRetries} attempts. Error: ${actionResult.error}. How should I proceed?`,
                  type: 'choice',
                  choices: ['Retry with different approach', 'Skip this step', 'Stop automation'],
                },
              ],
            };
          }
        } else {
          // Reset retry count on success
          retryCount = 0;
        }
      }

      if (!isComplete) {
        logger.warn('Intent step reached max attempts without completion', {
          intentType,
          stepId: stepData.id,
          attempts: attemptCount,
        });
      }

      const executionTimeMs = Date.now() - startTime;

      return {
        status: isComplete ? 'step_complete' : 'step_failed',
        intentType,
        stepId: stepData.id,
        actions: executedActions,
        outputScreenshot: currentScreenshot,
        data: storedData,
        executionTimeMs,
        error: isComplete ? undefined : 'Max attempts reached without completion',
      };

    } catch (error: any) {
      const executionTimeMs = Date.now() - startTime;
      logger.error('Intent execution failed', {
        intentType,
        stepId: stepData.id,
        error: error.message,
        actionsExecuted: executedActions.length,
      });

      return {
        status: 'step_failed',
        intentType,
        stepId: stepData.id,
        actions: executedActions,
        outputScreenshot: currentScreenshot,
        data: storedData,
        executionTimeMs,
        error: error.message,
      };
    }
  }

  /**
   * Get next action from LLM based on current state
   */
  private async getNextAction(
    prompt: string,
    screenshot: { base64: string; mimeType?: string },
    availableActions: ActionType[]
  ): Promise<any> {
    try {
      // Try OpenAI first (fastest for vision)
      if (this.openaiClient) {
        return await this.getActionFromOpenAI(prompt, screenshot);
      }

      // Fallback to Claude
      if (this.claudeClient) {
        return await this.getActionFromClaude(prompt, screenshot);
      }

      // Fallback to Gemini
      if (this.geminiClient) {
        return await this.getActionFromGemini(prompt, screenshot);
      }

      throw new Error('No LLM clients available');
    } catch (error: any) {
      logger.error('Failed to get next action from LLM', { error: error.message });
      throw error;
    }
  }

  /**
   * Get action from OpenAI GPT-4 Vision
   */
  private async getActionFromOpenAI(
    prompt: string,
    screenshot: { base64: string; mimeType?: string }
  ): Promise<any> {
    const response = await this.openaiClient!.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image_url',
              image_url: {
                url: `data:${screenshot.mimeType || 'image/png'};base64,${screenshot.base64}`,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
      max_tokens: 1000,
      temperature: 0.1,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      throw new Error('OpenAI returned empty response');
    }

    return this.parseActionFromResponse(content);
  }

  /**
   * Get action from Claude
   */
  private async getActionFromClaude(
    prompt: string,
    screenshot: { base64: string; mimeType?: string }
  ): Promise<any> {
    const response = await this.claudeClient!.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1000,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: (screenshot.mimeType as any) || 'image/png',
                data: screenshot.base64,
              },
            },
            {
              type: 'text',
              text: prompt,
            },
          ],
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== 'text') {
      throw new Error('Claude returned non-text response');
    }

    return this.parseActionFromResponse(content.text);
  }

  /**
   * Get action from Gemini
   */
  private async getActionFromGemini(
    prompt: string,
    screenshot: { base64: string; mimeType?: string }
  ): Promise<any> {
    const model = this.geminiClient!.getGenerativeModel({ 
      model: 'gemini-2.0-flash-exp'
    });

    const result = await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: screenshot.mimeType || 'image/png',
                data: screenshot.base64,
              },
            },
            {
              text: prompt,
            },
          ],
        },
      ],
    });

    const content = result.response.text();
    if (!content) {
      throw new Error('Gemini returned empty response');
    }

    return this.parseActionFromResponse(content);
  }

  /**
   * Extract clarification questions from LLM response
   */
  private extractClarificationQuestions(action: any): ClarificationQuestion[] {
    const questions: ClarificationQuestion[] = [];

    // Check if action has clarification questions
    if (action.questions && Array.isArray(action.questions)) {
      return action.questions.map((q: any, idx: number) => ({
        id: q.id || `q${idx + 1}`,
        question: q.question || q.text || String(q),
        type: q.type || 'text',
        choices: q.choices,
      }));
    }

    // Check if action has a single question
    if (action.question) {
      questions.push({
        id: 'q1',
        question: action.question,
        type: action.questionType || 'text',
        choices: action.choices,
      });
    }

    return questions;
  }

  /**
   * Delay helper for retry backoff
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Parse action JSON from LLM response
   */
  private parseActionFromResponse(response: string): any {
    try {
      // Try to extract JSON from response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }

      const action = JSON.parse(jsonMatch[0]);

      // Check for clarification markers in response text
      const lowerResponse = response.toLowerCase();
      if (
        lowerResponse.includes('clarification_needed') ||
        lowerResponse.includes('need clarification') ||
        lowerResponse.includes('unclear') ||
        lowerResponse.includes('which one') ||
        lowerResponse.includes('should i')
      ) {
        // Extract questions from response
        const questionMatch = response.match(/(?:question|unclear|which|should i)[:\s]+([^\n]+)/gi);
        if (questionMatch) {
          action.needsClarification = true;
          action.questions = questionMatch.map((q, idx) => ({
            id: `q${idx + 1}`,
            question: q.trim(),
            type: 'text',
          }));
        }
      }

      // Validate action has required fields
      if (!action.type && !action.needsClarification) {
        throw new Error('Action missing "type" field');
      }

      return action;
    } catch (error: any) {
      logger.error('Failed to parse action from LLM response', {
        error: error.message,
        response: response.substring(0, 500),
      });
      throw new Error(`Failed to parse action: ${error.message}`);
    }
  }

  /**
   * Execute a single action
   * NOTE: This is a placeholder - actual execution happens on frontend
   * Backend just validates and tracks actions
   */
  private async executeAction(
    action: any,
    context: any,
    storedData: Record<string, any>
  ): Promise<ActionExecutionResult> {
    const timestamp = Date.now();

    try {
      // Validate action type
      if (!this.isValidActionType(action.type)) {
        throw new Error(`Invalid action type: ${action.type}`);
      }

      // Handle special actions that backend can process
      switch (action.type) {
        case 'store':
          // Store data in context
          if (!action.key || action.value === undefined) {
            throw new Error('store action requires key and value');
          }
          storedData[action.key] = action.value;
          logger.info('Data stored', { key: action.key });
          return {
            type: action.type,
            timestamp,
            success: true,
            metadata: { storedData: { [action.key]: action.value } },
          };

        case 'retrieve':
          // Retrieve data from context
          if (!action.key) {
            throw new Error('retrieve action requires key');
          }
          const value = storedData[action.key];
          if (value === undefined) {
            throw new Error(`No data found for key: ${action.key}`);
          }
          logger.info('Data retrieved', { key: action.key });
          return {
            type: action.type,
            timestamp,
            success: true,
            metadata: { retrievedValue: value },
          };

        case 'log':
          // Log message
          const level = action.level || 'info';
          const logMessage = action.message || 'Log action';
          if (level === 'info') logger.info(logMessage, { action });
          else if (level === 'warn') logger.warn(logMessage, { action });
          else if (level === 'error') logger.error(logMessage, { action });
          else logger.info(logMessage, { action });
          return {
            type: action.type,
            timestamp,
            success: true,
          };

        case 'end':
          // End step
          logger.info('End action received', { reason: action.reason });
          return {
            type: action.type,
            timestamp,
            success: true,
            metadata: { reason: action.reason },
          };

        default:
          // For all other actions (UI interactions), return success
          // Frontend will actually execute these
          return {
            type: action.type,
            timestamp,
            success: true,
            metadata: { action },
          };
      }
    } catch (error: any) {
      logger.error('Action execution failed', {
        actionType: action.type,
        error: error.message,
      });
      return {
        type: action.type,
        timestamp,
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Check if action type is valid
   */
  private isValidActionType(type: string): boolean {
    const validTypes: ActionType[] = [
      'focusApp', 'openUrl', 'findAndClick', 'typeText', 'pressKey', 'clickAndDrag',
      'screenshot', 'ocr', 'scroll', 'zoom', 'store', 'retrieve',
      'waitForElement', 'pause', 'log', 'end'
    ];
    return validTypes.includes(type as ActionType);
  }

  /**
   * Check if action is critical (failure should stop execution)
   */
  private isCriticalAction(type: ActionType): boolean {
    // Most actions are not critical - allow retries
    // Only 'end' is critical in the sense that it signals completion
    return false;
  }
}

export const intentExecutionEngine = new IntentExecutionEngine();

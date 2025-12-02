/**
 * Automation Plan Interpreter - Frontend Skeleton
 * 
 * This is a minimal implementation to get you started.
 * Integrate this into your Thinkdrop overlay/automation service.
 * 
 * Dependencies:
 * - NutJS (@nut-tree-fork/nut-js)
 * - Screen-intel MCP (for OCR locators)
 * - Your overlay UI framework
 */

import type {
  AutomationPlan,
  AutomationStep,
  AutomationStepKind,
  AutomationQuestion,
  OcrLocator,
  PlanExecutionResult,
  StepExecutionResult,
} from '../src/types/automationPlan';

// ============================================================================
// TYPES
// ============================================================================

interface AutomationHelpers {
  nutjs: NutJSHelpers;
  screenIntel: ScreenIntelHelpers;
  overlay: OverlayHelpers;
  api: ApiHelpers;
  logger: LoggerHelpers;
  delay: (ms: number) => Promise<void>;
}

interface NutJSHelpers {
  focusApp(appName: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  movePointer(coords: { x: number; y: number }): Promise<void>;
  click(button?: 'left' | 'right', clickCount?: number): Promise<void>;
  typeText(text: string, submit?: boolean): Promise<void>;
  pressKey(key: string, modifiers?: string[]): Promise<void>;
  screenshot(): Promise<Buffer>;
}

interface ScreenIntelHelpers {
  findElement(locator: OcrLocator): Promise<{ x: number; y: number }>;
  waitForElement(locator: OcrLocator, timeoutMs: number): Promise<{ x: number; y: number }>;
  refreshOcr(screenshot: Buffer, tag?: string): Promise<void>;
  getOcrData(): Promise<any>;
}

interface OverlayHelpers {
  showQuestion(questionId: string, question: AutomationQuestion): Promise<string>;
  showProgress(step: AutomationStep, current: number, total: number): void;
  showError(message: string): void;
  showSuccess(message: string): void;
}

interface ApiHelpers {
  requestReplan(params: {
    plan: AutomationPlan;
    failedStep: AutomationStep;
    error: string;
    reason: string;
  }): Promise<{ plan: AutomationPlan }>;
}

interface LoggerHelpers {
  info(message: string, meta?: any): void;
  warn(message: string, meta?: any): void;
  error(message: string, meta?: any): void;
}

// ============================================================================
// MAIN INTERPRETER
// ============================================================================

export class AutomationInterpreter {
  private helpers: AutomationHelpers;
  private currentPlan: AutomationPlan | null = null;
  private answers: Map<string, string> = new Map();

  constructor(helpers: AutomationHelpers) {
    this.helpers = helpers;
  }

  /**
   * Execute an automation plan with retries, error handling, and replanning
   */
  async executePlan(plan: AutomationPlan): Promise<PlanExecutionResult> {
    this.currentPlan = plan;
    this.answers.clear();

    const startTime = Date.now();
    const stepResults: StepExecutionResult[] = [];

    this.helpers.logger.info('Starting automation plan execution', {
      planId: plan.planId,
      version: plan.version,
      stepCount: plan.steps.length,
    });

    // Ask proactive questions first
    if (plan.questions && plan.questions.length > 0) {
      await this.askProactiveQuestions(plan.questions);
    }

    // Execute steps
    const state = {
      stepIndex: 0,
      attempts: new Map<string, number>(),
    };

    while (state.stepIndex < plan.steps.length) {
      const step = plan.steps[state.stepIndex];

      // Check dependencies
      if (step.dependsOn && !this.allDepsSucceeded(plan, step.dependsOn, stepResults)) {
        this.helpers.logger.warn('Skipping step due to failed dependencies', {
          stepId: step.id,
          dependsOn: step.dependsOn,
        });
        step.status = 'skipped';
        stepResults.push({
          stepId: step.id,
          status: 'skipped',
          retries: 0,
          executionTimeMs: 0,
        });
        state.stepIndex++;
        continue;
      }

      // Execute step with retries
      const stepResult = await this.executeStepWithRetries(step, state, plan);
      stepResults.push(stepResult);

      // Handle step result
      if (stepResult.status === 'failed') {
        const handler = step.onError ?? { strategy: 'fail_plan' };

        switch (handler.strategy) {
          case 'skip_step':
            this.helpers.logger.warn('Skipping failed step', { stepId: step.id });
            state.stepIndex++;
            break;

          case 'goto_step':
            const targetIndex = plan.steps.findIndex(s => s.id === handler.stepId);
            if (targetIndex === -1) {
              throw new Error(`Invalid goto_step target: ${handler.stepId}`);
            }
            this.helpers.logger.info('Jumping to step', { from: step.id, to: handler.stepId });
            state.stepIndex = targetIndex;
            break;

          case 'ask_user':
            const question = plan.questions?.find(q => q.id === handler.questionId);
            if (question) {
              await this.helpers.overlay.showQuestion(handler.questionId, question);
            }
            state.stepIndex++;
            break;

          case 'replan':
            this.helpers.logger.info('Replanning due to failure', {
              stepId: step.id,
              reason: handler.reason,
            });
            const replanResult = await this.helpers.api.requestReplan({
              plan,
              failedStep: step,
              error: stepResult.error || 'Unknown error',
              reason: handler.reason,
            });
            // Recursively execute new plan
            return await this.executePlan(replanResult.plan);

          case 'fail_plan':
          default:
            this.helpers.overlay.showError(`Plan failed at step ${step.id}: ${stepResult.error}`);
            return {
              planId: plan.planId,
              status: 'failed',
              steps: stepResults,
              totalTimeMs: Date.now() - startTime,
              failedStepId: step.id,
              error: stepResult.error,
            };
        }
      } else {
        // Success - move to next step
        state.stepIndex++;
      }
    }

    // All steps completed
    const totalTimeMs = Date.now() - startTime;
    this.helpers.logger.info('Plan execution completed', {
      planId: plan.planId,
      totalTimeMs,
      stepCount: stepResults.length,
    });

    this.helpers.overlay.showSuccess('Automation completed successfully!');

    return {
      planId: plan.planId,
      status: 'completed',
      steps: stepResults,
      totalTimeMs,
    };
  }

  /**
   * Execute a single step with retry logic
   */
  private async executeStepWithRetries(
    step: AutomationStep,
    state: { attempts: Map<string, number> },
    plan: AutomationPlan
  ): Promise<StepExecutionResult> {
    const retryCfg = step.retry ?? { maxAttempts: 1, delayMs: 0 };
    const startTime = Date.now();
    let lastError: string | undefined;

    const currentAttempt = (state.attempts.get(step.id) ?? 0) + 1;
    state.attempts.set(step.id, currentAttempt);

    for (let attempt = currentAttempt; attempt <= retryCfg.maxAttempts; attempt++) {
      try {
        step.status = 'running';
        this.helpers.overlay.showProgress(step, plan.steps.indexOf(step) + 1, plan.steps.length);

        this.helpers.logger.info('Executing step', {
          stepId: step.id,
          attempt,
          maxAttempts: retryCfg.maxAttempts,
          description: step.description,
        });

        await this.executeStep(step);

        step.status = 'success';
        return {
          stepId: step.id,
          status: 'success',
          retries: attempt - 1,
          executionTimeMs: Date.now() - startTime,
        };
      } catch (error: any) {
        lastError = error.message || String(error);
        this.helpers.logger.warn('Step execution failed', {
          stepId: step.id,
          attempt,
          error: lastError,
        });

        // Retry with delay if not last attempt
        if (attempt < retryCfg.maxAttempts && retryCfg.delayMs) {
          await this.helpers.delay(retryCfg.delayMs);
        }
      }
    }

    // All retries exhausted
    step.status = 'failed';
    return {
      stepId: step.id,
      status: 'failed',
      error: lastError,
      retries: retryCfg.maxAttempts - 1,
      executionTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Execute a single step based on its kind
   */
  private async executeStep(step: AutomationStep): Promise<void> {
    const { kind } = step;

    switch (kind.type) {
      case 'focusApp':
        await this.helpers.nutjs.focusApp(kind.appName);
        break;

      case 'openUrl':
        await this.helpers.nutjs.openUrl(kind.url);
        break;

      case 'waitForElement':
        await this.helpers.screenIntel.waitForElement(kind.locator, kind.timeoutMs);
        break;

      case 'movePointer':
        if ('x' in kind.target && 'y' in kind.target) {
          await this.helpers.nutjs.movePointer(kind.target);
        } else {
          const coords = await this.helpers.screenIntel.findElement(kind.target);
          await this.helpers.nutjs.movePointer(coords);
        }
        break;

      case 'click':
        await this.helpers.nutjs.click(kind.button, kind.clickCount);
        break;

      case 'typeText':
        await this.helpers.nutjs.typeText(kind.text, kind.submit);
        break;

      case 'pressKey':
        await this.helpers.nutjs.pressKey(kind.key, kind.modifiers);
        break;

      case 'pause':
        await this.helpers.delay(kind.ms);
        break;

      case 'screenshot':
        const screenshot = await this.helpers.nutjs.screenshot();
        if (kind.analyzeWithVision) {
          await this.helpers.screenIntel.refreshOcr(screenshot, kind.tag);
        }
        break;

      case 'notifyUser':
        this.helpers.overlay.showSuccess(kind.message);
        if (kind.skillRegistered) {
          this.helpers.logger.info(`Skill registered: ${kind.skillRegistered}`);
        }
        break;

      case 'askUser':
        const question = this.currentPlan?.questions?.find(q => q.id === kind.questionId);
        if (question) {
          const answer = await this.helpers.overlay.showQuestion(kind.questionId, question);
          this.answers.set(kind.questionId, answer);
        }
        break;

      case 'log':
        this.helpers.logger[kind.level](kind.message);
        break;

      case 'end':
        this.helpers.logger.info(`Plan ended: ${kind.reason || 'completed'}`);
        break;

      default:
        throw new Error(`Unknown step type: ${(kind as any).type}`);
    }
  }

  /**
   * Ask proactive questions before execution
   */
  private async askProactiveQuestions(questions: AutomationQuestion[]): Promise<void> {
    for (const question of questions) {
      if (question.required) {
        const answer = await this.helpers.overlay.showQuestion(question.id, question);
        this.answers.set(question.id, answer);
      }
    }
  }

  /**
   * Check if all dependencies succeeded
   */
  private allDepsSucceeded(
    plan: AutomationPlan,
    dependsOn: string[],
    stepResults: StepExecutionResult[]
  ): boolean {
    return dependsOn.every(depId => {
      const result = stepResults.find(r => r.stepId === depId);
      return result && result.status === 'success';
    });
  }

  /**
   * Get answer to a question
   */
  getAnswer(questionId: string): string | undefined {
    return this.answers.get(questionId);
  }
}

// ============================================================================
// USAGE EXAMPLE
// ============================================================================

/*
// 1. Create helpers (integrate with your existing services)
const helpers: AutomationHelpers = {
  nutjs: createNutJSHelpers(),
  screenIntel: createScreenIntelHelpers(),
  overlay: createOverlayHelpers(),
  api: createApiHelpers(),
  logger: createLogger(),
  delay: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
};

// 2. Create interpreter
const interpreter = new AutomationInterpreter(helpers);

// 3. Get plan from API
const response = await fetch('/api/nutjs/plan', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-api-key': API_KEY,
  },
  body: JSON.stringify({
    command: "Generate Mickey Mouse images in ChatGPT, Grok, Perplexity",
    intent: "command_automate",
    context: {
      screenIntel: await getScreenIntel(),
      activeApp: "Google Chrome",
    },
  }),
});

const { plan } = await response.json();

// 4. Execute plan
const result = await interpreter.executePlan(plan);

console.log('Execution result:', result);
*/

// ============================================================================
// HELPER IMPLEMENTATIONS (Stubs - replace with real implementations)
// ============================================================================

function createNutJSHelpers(): NutJSHelpers {
  // TODO: Implement using @nut-tree-fork/nut-js
  return {
    async focusApp(appName: string) {
      console.log(`[NutJS] Focus app: ${appName}`);
      // Implementation: Use keyboard shortcuts to open app
    },
    async openUrl(url: string) {
      console.log(`[NutJS] Open URL: ${url}`);
      // Implementation: Cmd+L, type URL, press Enter
    },
    async movePointer(coords: { x: number; y: number }) {
      console.log(`[NutJS] Move pointer to (${coords.x}, ${coords.y})`);
      // Implementation: mouse.move(straightTo(Point(coords.x, coords.y)))
    },
    async click(button = 'left', clickCount = 1) {
      console.log(`[NutJS] Click ${button} ${clickCount}x`);
      // Implementation: mouse.click(Button.LEFT)
    },
    async typeText(text: string, submit = false) {
      console.log(`[NutJS] Type text: ${text} (submit: ${submit})`);
      // Implementation: keyboard.type(text); if (submit) keyboard.pressKey(Key.Enter)
    },
    async pressKey(key: string, modifiers = []) {
      console.log(`[NutJS] Press key: ${modifiers.join('+')}+${key}`);
      // Implementation: keyboard.pressKey(...modifiers, key)
    },
    async screenshot() {
      console.log(`[NutJS] Take screenshot`);
      // Implementation: screen.capture()
      return Buffer.from('');
    },
  };
}

function createScreenIntelHelpers(): ScreenIntelHelpers {
  // TODO: Implement using screen-intel MCP
  return {
    async findElement(locator: OcrLocator) {
      console.log(`[ScreenIntel] Find element:`, locator);
      // Implementation: Query screen-intel MCP with locator
      return { x: 100, y: 100 };
    },
    async waitForElement(locator: OcrLocator, timeoutMs: number) {
      console.log(`[ScreenIntel] Wait for element (${timeoutMs}ms):`, locator);
      // Implementation: Poll screen-intel until element found or timeout
      return { x: 100, y: 100 };
    },
    async refreshOcr(screenshot: Buffer, tag?: string) {
      console.log(`[ScreenIntel] Refresh OCR (tag: ${tag})`);
      // Implementation: Send screenshot to screen-intel MCP
    },
    async getOcrData() {
      console.log(`[ScreenIntel] Get OCR data`);
      // Implementation: Query screen-intel MCP for current OCR data
      return {};
    },
  };
}

function createOverlayHelpers(): OverlayHelpers {
  // TODO: Implement using your overlay UI framework
  return {
    async showQuestion(questionId: string, question: AutomationQuestion) {
      console.log(`[Overlay] Show question: ${question.text}`);
      // Implementation: Show overlay dialog with question
      return 'user answer';
    },
    showProgress(step: AutomationStep, current: number, total: number) {
      console.log(`[Overlay] Progress: ${current}/${total} - ${step.description}`);
      // Implementation: Update progress bar in overlay
    },
    showError(message: string) {
      console.log(`[Overlay] Error: ${message}`);
      // Implementation: Show error toast/dialog
    },
    showSuccess(message: string) {
      console.log(`[Overlay] Success: ${message}`);
      // Implementation: Show success toast/dialog
    },
  };
}

function createApiHelpers(): ApiHelpers {
  // TODO: Implement API calls
  return {
    async requestReplan(params) {
      console.log(`[API] Request replan:`, params.reason);
      // Implementation: POST /api/nutjs/plan with previousPlan + feedback
      const response = await fetch('/api/nutjs/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.API_KEY || '',
        },
        body: JSON.stringify({
          command: params.plan.goal,
          previousPlan: params.plan,
          feedback: {
            reason: 'failure',
            message: params.reason,
            stepId: params.failedStep.id,
          },
        }),
      });
      return await response.json();
    },
  };
}

function createLogger(): LoggerHelpers {
  return {
    info: (message, meta) => console.log(`[INFO] ${message}`, meta),
    warn: (message, meta) => console.warn(`[WARN] ${message}`, meta),
    error: (message, meta) => console.error(`[ERROR] ${message}`, meta),
  };
}

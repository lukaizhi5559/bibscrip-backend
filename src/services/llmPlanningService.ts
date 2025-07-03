import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';
import { VisualContext, ActionPlan, visualAgentService } from './visualAgentService';

export interface LLMProvider {
  name: string;
  supportsVision: boolean;
  maxImageSize: number; // in bytes
  maxTokens: number;
}

export interface LLMResponse {
  actionPlan: ActionPlan;
  provider: string;
  tokensUsed?: number;
  processingTime: number;
  confidence: number;
}

/**
 * LLM Planning Service
 * Integrates with various LLM providers to generate action plans from visual context
 */
export class LLMPlanningService {
  private openai: OpenAI | null = null;
  private anthropic: Anthropic | null = null;
  private isInitialized = false;

  constructor() {
    this.initialize();
  }

  /**
   * Initialize LLM clients
   */
  private initialize(): void {
    try {
      // Initialize OpenAI client
      if (process.env.OPENAI_API_KEY) {
        this.openai = new OpenAI({
          apiKey: process.env.OPENAI_API_KEY
        });
        logger.info('OpenAI client initialized');
      }

      // Initialize Anthropic client
      if (process.env.ANTHROPIC_API_KEY) {
        this.anthropic = new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY
        });
        logger.info('Anthropic client initialized');
      }

      this.isInitialized = true;
      logger.info('LLM Planning Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize LLM Planning Service:', { error });
      this.isInitialized = false;
    }
  }

  /**
   * Get available LLM providers
   */
  getAvailableProviders(): LLMProvider[] {
    const providers: LLMProvider[] = [];

    if (this.openai) {
      providers.push({
        name: 'openai-gpt4v',
        supportsVision: true,
        maxImageSize: 20 * 1024 * 1024, // 20MB
        maxTokens: 4096
      });
    }

    if (this.anthropic) {
      providers.push({
        name: 'anthropic-claude',
        supportsVision: true,
        maxImageSize: 5 * 1024 * 1024, // 5MB
        maxTokens: 4096
      });
    }

    return providers;
  }

  /**
   * Generate action plan using the best available LLM provider
   */
  async generateActionPlan(context: VisualContext, preferredProvider?: string): Promise<LLMResponse> {
    if (!this.isInitialized) {
      throw new Error('LLM Planning Service not initialized');
    }

    const startTime = performance.now();
    const providers = this.getAvailableProviders();

    if (providers.length === 0) {
      throw new Error('No LLM providers available');
    }

    // Select provider based on preference or default to first available
    let selectedProvider = providers[0];
    if (preferredProvider) {
      const preferred = providers.find(p => p.name === preferredProvider);
      if (preferred) {
        selectedProvider = preferred;
      }
    }

    logger.info('Generating action plan with LLM', {
      provider: selectedProvider.name,
      userPrompt: context.userPrompt,
      screenshotSize: context.screenshot.buffer.length
    });

    try {
      let actionPlan: ActionPlan;
      let tokensUsed: number | undefined;

      switch (selectedProvider.name) {
        case 'openai-gpt4v':
          const openaiResult = await this.generateWithOpenAI(context);
          actionPlan = openaiResult.actionPlan;
          tokensUsed = openaiResult.tokensUsed;
          break;
        case 'anthropic-claude':
          const anthropicResult = await this.generateWithAnthropic(context);
          actionPlan = anthropicResult.actionPlan;
          tokensUsed = anthropicResult.tokensUsed;
          break;
        default:
          throw new Error(`Unsupported provider: ${selectedProvider.name}`);
      }

      const processingTime = performance.now() - startTime;

      logger.info('Action plan generated successfully', {
        provider: selectedProvider.name,
        actionsCount: actionPlan.actions.length,
        confidence: actionPlan.confidence,
        processingTime: `${processingTime.toFixed(2)}ms`,
        tokensUsed
      });

      return {
        actionPlan,
        provider: selectedProvider.name,
        tokensUsed,
        processingTime,
        confidence: actionPlan.confidence
      };
    } catch (error) {
      logger.error('Failed to generate action plan:', { 
        provider: selectedProvider.name, 
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`Action plan generation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate action plan using OpenAI GPT-4V
   */
  private async generateWithOpenAI(context: VisualContext): Promise<{ actionPlan: ActionPlan; tokensUsed?: number }> {
    if (!this.openai) {
      throw new Error('OpenAI client not available');
    }

    try {
      // Convert screenshot to base64
      const base64Image = await visualAgentService.screenshotToBase64(context.screenshot.buffer);
      
      // Create the prompt
      const prompt = visualAgentService.createLLMPrompt(context);

      const response = await this.openai.chat.completions.create({
        model: 'gpt-4-vision-preview',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${base64Image}`,
                  detail: 'high'
                }
              }
            ]
          }
        ],
        max_tokens: 4096,
        temperature: 0.1 // Low temperature for consistent, precise responses
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response content from OpenAI');
      }

      // Parse JSON response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in OpenAI response');
      }

      const actionPlanData = JSON.parse(jsonMatch[0]);
      const actionPlan = visualAgentService.validateActionPlan(actionPlanData);

      return {
        actionPlan,
        tokensUsed: response.usage?.total_tokens
      };
    } catch (error) {
      logger.error('OpenAI action plan generation failed:', { error });
      throw error;
    }
  }

  /**
   * Generate action plan using Anthropic Claude
   */
  private async generateWithAnthropic(context: VisualContext): Promise<{ actionPlan: ActionPlan; tokensUsed?: number }> {
    if (!this.anthropic) {
      throw new Error('Anthropic client not available');
    }

    try {
      // Convert screenshot to base64
      const base64Image = await visualAgentService.screenshotToBase64(context.screenshot.buffer);
      
      // Create the prompt
      const prompt = visualAgentService.createLLMPrompt(context);

      const response = await this.anthropic.messages.create({
        model: 'claude-3-sonnet-20240229',
        max_tokens: 4096,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: 'image/jpeg',
                  data: base64Image
                }
              },
              {
                type: 'text',
                text: prompt
              }
            ]
          }
        ]
      });

      const content = response.content[0];
      if (content.type !== 'text') {
        throw new Error('Unexpected response type from Anthropic');
      }

      // Parse JSON response
      const jsonMatch = content.text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in Anthropic response');
      }

      const actionPlanData = JSON.parse(jsonMatch[0]);
      const actionPlan = visualAgentService.validateActionPlan(actionPlanData);

      return {
        actionPlan,
        tokensUsed: response.usage?.input_tokens + response.usage?.output_tokens
      };
    } catch (error) {
      logger.error('Anthropic action plan generation failed:', { error });
      throw error;
    }
  }

  /**
   * Generate action plan with fallback providers
   */
  async generateActionPlanWithFallback(context: VisualContext): Promise<LLMResponse> {
    const providers = this.getAvailableProviders();
    let lastError: Error | null = null;

    for (const provider of providers) {
      try {
        logger.info(`Attempting action plan generation with ${provider.name}`);
        return await this.generateActionPlan(context, provider.name);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        logger.warn(`Provider ${provider.name} failed, trying next provider:`, { error: lastError.message });
        continue;
      }
    }

    throw new Error(`All LLM providers failed. Last error: ${lastError?.message || 'Unknown error'}`);
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return this.isInitialized && this.getAvailableProviders().length > 0;
  }

  /**
   * Get service status
   */
  getStatus(): {
    initialized: boolean;
    availableProviders: string[];
    ready: boolean;
  } {
    const providers = this.getAvailableProviders();
    return {
      initialized: this.isInitialized,
      availableProviders: providers.map(p => p.name),
      ready: this.isReady()
    };
  }
}

// Export singleton instance
export const llmPlanningService = new LLMPlanningService();

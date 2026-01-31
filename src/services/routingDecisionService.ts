/**
 * Routing Decision Service
 * 
 * Uses LLM to intelligently decide whether to:
 * 1. Handle query directly (simple communication)
 * 2. Route to Worker Agent (complex tasks requiring StateGraph)
 */

import { logger } from '../utils/logger';
import OpenAI from 'openai';

const openaiClient = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

export interface RoutingDecision {
  route: 'direct' | 'worker';
  reasoning: string;
  confidence: number;
}

export class RoutingDecisionService {
  /**
   * Analyze message and decide routing
   * @param message - User message
   * @param context - Conversation context
   * @returns Routing decision
   */
  async analyzeAndRoute(message: string, context?: any): Promise<RoutingDecision> {
    if (!openaiClient) {
      logger.warn('⚠️ [ROUTING] OpenAI not configured, using fallback heuristics');
      return this.fallbackRouting(message);
    }

    try {
      const prompt = this.buildRoutingPrompt(message, context);
      
      const response = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: `You are a routing decision agent. Analyze user messages and decide whether to:
1. DIRECT: Handle directly with simple LLM response (greetings, simple questions, general knowledge, explanations)
2. WORKER: Route to Worker Agent for complex tasks (automation, memory operations, screen analysis, web search, multi-step workflows)

The Worker Agent has a StateGraph that will determine the specific intent. You only need to decide if the task is simple enough for a direct response or complex enough to need the Worker Agent.

Respond in JSON format:
{
  "route": "direct" | "worker",
  "reasoning": "brief explanation",
  "confidence": 0.0-1.0
}`
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 200
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        throw new Error('No response from LLM');
      }

      const decision = JSON.parse(content) as RoutingDecision;
      
      logger.info('🎯 [ROUTING] LLM decision', {
        route: decision.route,
        reasoning: decision.reasoning,
        confidence: decision.confidence
      });

      return decision;

    } catch (error: any) {
      logger.error('❌ [ROUTING] LLM routing failed, using fallback', {
        error: error.message
      });
      return this.fallbackRouting(message);
    }
  }

  /**
   * Build routing prompt with context
   */
  private buildRoutingPrompt(message: string, context?: any): string {
    let prompt = `User message: "${message}"\n\n`;

    if (context?.conversationHistory?.length > 0) {
      const recent = context.conversationHistory.slice(-3);
      prompt += `Recent conversation:\n`;
      recent.forEach((msg: any) => {
        prompt += `${msg.role}: ${msg.content?.substring(0, 100)}\n`;
      });
      prompt += '\n';
    }

    prompt += `Analyze this message and decide routing.`;

    return prompt;
  }

  /**
   * Fallback routing using keyword heuristics
   */
  private fallbackRouting(message: string): RoutingDecision {
    const messageLower = message.toLowerCase();

    // Keywords that indicate Worker Agent needed
    const workerKeywords = [
      // Automation
      'automate', 'go to', 'navigate to', 'click', 'open', 'search for',
      'find on', 'type in', 'fill out', 'submit',
      
      // Memory operations
      'remember', 'store', 'save this', 'recall', 'what did i',
      
      // Screen analysis
      'on my screen', 'what do you see', 'analyze this', 'look at',
      'on this page', 'in this window',
      
      // Web search
      'search the web', 'look up', 'find information about',
      'what\'s the latest', 'current', 'recent news'
    ];

    // Keywords that indicate direct response
    const directKeywords = [
      'hello', 'hi', 'hey', 'thanks', 'thank you',
      'what is', 'who is', 'how do', 'why',
      'explain', 'tell me about', 'what are'
    ];

    // Check for worker keywords
    const hasWorkerKeyword = workerKeywords.some(kw => messageLower.includes(kw));
    const hasDirectKeyword = directKeywords.some(kw => messageLower.includes(kw));

    if (hasWorkerKeyword && !hasDirectKeyword) {
      return {
        route: 'worker',
        reasoning: 'Message contains automation/memory/screen keywords',
        confidence: 0.7
      };
    }

    if (hasDirectKeyword && !hasWorkerKeyword) {
      return {
        route: 'direct',
        reasoning: 'Message is a simple question or greeting',
        confidence: 0.7
      };
    }

    // Default to direct for ambiguous cases
    return {
      route: 'direct',
      reasoning: 'Ambiguous message, defaulting to direct response',
      confidence: 0.5
    };
  }
}

export const routingDecisionService = new RoutingDecisionService();

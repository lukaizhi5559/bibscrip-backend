/**
 * Orchestration Service
 * Handles multi-agent workflow planning and coordination using LLM intelligence
 */

import { llmOrchestratorService, EnhancedLLMResponse } from './llmOrchestrator';
import { logger } from '../utils/logger';

export interface AgentAction {
  name: string;
  type: string;
  reason: string;
  execution_order: number;
  parameters?: Record<string, any>;
  inputs?: string[];
  outputs?: string[];
}

export interface TaskStep {
  step: number;
  description: string;
  agent_needed: string;
  inputs: string[];
  outputs: string[];
}

export interface Dependency {
  type: 'permission' | 'oauth' | 'api_key' | 'system_access';
  description: string;
}

export interface Risk {
  risk: string;
  mitigation: string;
  severity: 'low' | 'medium' | 'high';
}

export interface OrchestrationResult {
  status: 'success' | 'error' | 'needs_clarification';
  task_breakdown?: TaskStep[];
  agents: AgentAction[];
  next_steps: string[];
  plan_summary: string;
  data_flow?: string;
  dependencies?: Dependency[];
  risks?: Risk[];
  estimated_success_rate: number;
  execution_time_estimate?: string;
  fallback_strategies?: string[];
  clarification_questions: string[];
  issues: string[];
  llm_response?: EnhancedLLMResponse;
}

export interface IntentResult {
  intent: string;
  summary: string;
  intent_type: 'automation' | 'information' | 'analysis' | 'creation';
  required_agents: Array<{
    type: string;
    reason: string;
  }>;
  complexity: 'simple' | 'moderate' | 'complex';
  execution_approach: 'single_agent' | 'multi_agent_sequence' | 'multi_agent_parallel';
  confidence: number;
  clarification_questions: string[];
  llm_response?: EnhancedLLMResponse;
}

export interface AgentGenerationResult {
  agent: {
    name: string;
    description: string;
    code: string;
    dependencies: string[];
    capabilities: string[];
    execution_target: 'frontend' | 'backend';
    requires_database: boolean;
    database_type?: string;
    schema?: Record<string, any>;
  };
  status: 'generated' | 'error';
  confidence: number;
  test_cases?: any[];
  issues?: string[];
  llm_response?: EnhancedLLMResponse;
}

/**
 * Enhanced Orchestration Service with LLM Intelligence
 */
export class OrchestrationService {
  constructor() {
    logger.info('Orchestration Service initialized with LLM intelligence');
  }

  /**
   * Orchestrate a user request using LLM intelligence
   */
  async orchestrateRequest(userQuery: string): Promise<OrchestrationResult> {
    try {
      logger.info('Starting orchestration request', { userQuery });

      // Use LLM to analyze and plan the orchestration
      const llmResponse = await llmOrchestratorService.processOrchestration(userQuery);
      
      // Parse the LLM response
      const orchestrationPlan = this.parseOrchestrationResponse(llmResponse.text);
      
      if (!orchestrationPlan) {
        return {
          status: 'error',
          agents: [],
          next_steps: [],
          plan_summary: 'Failed to generate orchestration plan',
          estimated_success_rate: 0,
          clarification_questions: [],
          issues: ['LLM failed to generate a valid orchestration plan'],
          llm_response: llmResponse
        };
      }

      // Convert LLM plan to our orchestration result format
      const result: OrchestrationResult = {
        status: 'success',
        task_breakdown: orchestrationPlan.task_breakdown,
        agents: orchestrationPlan.agents || [],
        next_steps: this.generateNextSteps(orchestrationPlan),
        plan_summary: this.generatePlanSummary(orchestrationPlan, userQuery),
        data_flow: orchestrationPlan.data_flow,
        dependencies: orchestrationPlan.dependencies,
        risks: orchestrationPlan.risks,
        estimated_success_rate: orchestrationPlan.estimated_success_rate || 0.7,
        execution_time_estimate: orchestrationPlan.execution_time_estimate,
        fallback_strategies: orchestrationPlan.fallback_strategies,
        clarification_questions: this.generateClarificationQuestions(orchestrationPlan),
        issues: this.identifyIssues(orchestrationPlan),
        llm_response: llmResponse
      };

      logger.info('Orchestration completed successfully', {
        agentsCount: result.agents.length,
        successRate: result.estimated_success_rate,
        provider: llmResponse.provider
      });

      return result;

    } catch (error) {
      logger.error('Orchestration request failed', {
        userQuery,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        status: 'error',
        agents: [],
        next_steps: [],
        plan_summary: 'Orchestration failed due to system error',
        estimated_success_rate: 0,
        clarification_questions: [],
        issues: [`System error: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }

  /**
   * Parse user intent using LLM intelligence
   */
  async parseIntent(userQuery: string): Promise<IntentResult> {
    try {
      logger.info('Parsing user intent', { userQuery });

      // Use LLM to analyze user intent
      const llmResponse = await llmOrchestratorService.processIntent(userQuery);
      
      // Parse the LLM response
      const intentData = this.parseIntentResponse(llmResponse.text);
      
      if (!intentData) {
        return {
          intent: userQuery,
          summary: 'Failed to parse user intent',
          intent_type: 'information',
          required_agents: [],
          complexity: 'simple',
          execution_approach: 'single_agent',
          confidence: 0,
          clarification_questions: ['Could you please rephrase your request more clearly?'],
          llm_response: llmResponse
        };
      }

      const result: IntentResult = {
        intent: userQuery,
        summary: intentData.summary,
        intent_type: intentData.intent_type || 'automation',
        required_agents: intentData.required_agents || [],
        complexity: intentData.complexity || 'moderate',
        execution_approach: intentData.execution_approach || 'single_agent',
        confidence: intentData.confidence || 0.8,
        clarification_questions: this.generateIntentClarifications(intentData),
        llm_response: llmResponse
      };

      logger.info('Intent parsing completed', {
        intentType: result.intent_type,
        complexity: result.complexity,
        confidence: result.confidence,
        provider: llmResponse.provider
      });

      return result;

    } catch (error) {
      logger.error('Intent parsing failed', {
        userQuery,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        intent: userQuery,
        summary: 'Intent parsing failed',
        intent_type: 'information',
        required_agents: [],
        complexity: 'simple',
        execution_approach: 'single_agent',
        confidence: 0,
        clarification_questions: ['There was an error processing your request. Please try again.']
      };
    }
  }

  /**
   * Generate an agent using LLM intelligence
   */
  async generateAgent(description: string, requirements?: any): Promise<AgentGenerationResult> {
    try {
      logger.info('Generating agent', { description });

      // Use LLM to generate agent code
      const llmResponse = await llmOrchestratorService.processAgentGeneration(description, requirements);
      
      // Parse the LLM response
      const agentData = this.parseAgentResponse(llmResponse.text);
      
      if (!agentData) {
        return {
          agent: {
            name: 'UnknownAgent',
            description: 'Failed to generate agent',
            code: '// Agent generation failed',
            dependencies: [],
            capabilities: [],
            execution_target: 'frontend',
            requires_database: false
          },
          status: 'error',
          confidence: 0,
          issues: ['LLM failed to generate valid agent code'],
          llm_response: llmResponse
        };
      }

      const result: AgentGenerationResult = {
        agent: {
          name: agentData.name,
          description: agentData.description,
          code: agentData.code,
          dependencies: agentData.dependencies || [],
          capabilities: this.extractCapabilities(agentData),
          execution_target: agentData.execution_target || 'frontend',
          requires_database: agentData.requires_database || false,
          database_type: agentData.database_type,
          schema: agentData.schema
        },
        status: 'generated',
        confidence: this.calculateAgentConfidence(agentData),
        test_cases: this.generateTestCases(agentData),
        issues: this.validateAgentCode(agentData),
        llm_response: llmResponse
      };

      logger.info('Agent generation completed', {
        agentName: result.agent.name,
        confidence: result.confidence,
        provider: llmResponse.provider
      });

      return result;

    } catch (error) {
      logger.error('Agent generation failed', {
        description,
        error: error instanceof Error ? error.message : String(error)
      });

      return {
        agent: {
          name: 'ErrorAgent',
          description: 'Agent generation failed',
          code: '// Generation error',
          dependencies: [],
          capabilities: [],
          execution_target: 'frontend',
          requires_database: false
        },
        status: 'error',
        confidence: 0,
        issues: [`Generation error: ${error instanceof Error ? error.message : String(error)}`]
      };
    }
  }

  /**
   * Get all agents (placeholder - would integrate with database)
   */
  async getAllAgents(): Promise<any[]> {
    // TODO: Integrate with actual agent database
    logger.info('Getting all agents from database');
    return [];
  }

  /**
   * Get agent by name (placeholder - would integrate with database)
   */
  async getAgentByName(name: string): Promise<any | null> {
    // TODO: Integrate with actual agent database
    logger.info('Getting agent by name', { name });
    return null;
  }

  /**
   * Delete agent (placeholder - would integrate with database)
   */
  async deleteAgent(name: string): Promise<boolean> {
    // TODO: Integrate with actual agent database
    logger.info('Deleting agent', { name });
    return false;
  }

  /**
   * Log communication between agents (placeholder)
   */
  async logCommunication(communication: any): Promise<string> {
    // TODO: Integrate with actual communication logging
    logger.info('Logging agent communication', communication);
    return 'comm-' + Date.now();
  }

  /**
   * Get agent communications (placeholder)
   */
  async getCommunications(filters: any): Promise<any[]> {
    // TODO: Integrate with actual communication database
    logger.info('Getting agent communications', filters);
    return [];
  }

  // Private helper methods

  private parseOrchestrationResponse(response: string): any {
    try {
      // Extract JSON from LLM response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return null;
    } catch (error) {
      logger.warn('Failed to parse orchestration response', { error });
      return null;
    }
  }

  private parseIntentResponse(response: string): any {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return null;
    } catch (error) {
      logger.warn('Failed to parse intent response', { error });
      return null;
    }
  }

  private parseAgentResponse(response: string): any {
    try {
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return null;
    } catch (error) {
      logger.warn('Failed to parse agent response', { error });
      return null;
    }
  }

  private generateNextSteps(plan: any): string[] {
    if (plan.task_breakdown && Array.isArray(plan.task_breakdown)) {
      return plan.task_breakdown.map((step: any) => step.description);
    }
    return ['Execute the planned workflow'];
  }

  private generatePlanSummary(plan: any, userQuery: string): string {
    if (plan.agents && plan.agents.length > 0) {
      const agentNames = plan.agents.map((agent: any) => agent.name).join(', ');
      return `Multi-agent workflow using ${agentNames} to fulfill: "${userQuery}"`;
    }
    return `Workflow plan for: "${userQuery}"`;
  }

  private generateClarificationQuestions(plan: any): string[] {
    const questions: string[] = [];
    
    if (plan.dependencies && plan.dependencies.length > 0) {
      questions.push('Do you have the necessary permissions and access for this task?');
    }
    
    if (plan.risks && plan.risks.some((risk: any) => risk.severity === 'high')) {
      questions.push('Are you aware of the potential risks involved in this automation?');
    }
    
    return questions;
  }

  private identifyIssues(plan: any): string[] {
    const issues: string[] = [];
    
    if (!plan.agents || plan.agents.length === 0) {
      issues.push('No agents could be identified for this task');
    }
    
    if (plan.estimated_success_rate < 0.5) {
      issues.push('Low estimated success rate for this workflow');
    }
    
    return issues;
  }

  private generateIntentClarifications(intentData: any): string[] {
    const questions: string[] = [];
    
    if (intentData.confidence < 0.7) {
      questions.push('Could you provide more details about what you want to accomplish?');
    }
    
    if (intentData.complexity === 'complex') {
      questions.push('This appears to be a complex task. Would you like to break it down into smaller steps?');
    }
    
    return questions;
  }

  private extractCapabilities(agentData: any): string[] {
    const capabilities: string[] = [];
    
    if (agentData.code && agentData.code.includes('click')) {
      capabilities.push('ui-automation');
    }
    
    if (agentData.code && agentData.code.includes('api')) {
      capabilities.push('api-integration');
    }
    
    if (agentData.requires_database) {
      capabilities.push('data-processing');
    }
    
    return capabilities.length > 0 ? capabilities : ['general-automation'];
  }

  private calculateAgentConfidence(agentData: any): number {
    let confidence = 0.8; // Base confidence
    
    if (agentData.code && agentData.code.length > 100) {
      confidence += 0.1;
    }
    
    if (agentData.dependencies && agentData.dependencies.length > 0) {
      confidence += 0.05;
    }
    
    if (agentData.schema) {
      confidence += 0.05;
    }
    
    return Math.min(confidence, 1.0);
  }

  private generateTestCases(agentData: any): any[] {
    // Generate basic test cases based on agent structure
    return [
      {
        name: 'Basic execution test',
        input: {},
        expected: { success: true }
      }
    ];
  }

  private validateAgentCode(agentData: any): string[] {
    const issues: string[] = [];
    
    if (!agentData.code || agentData.code.length < 50) {
      issues.push('Generated code appears to be too short');
    }
    
    if (!agentData.name || agentData.name === 'AgentName') {
      issues.push('Agent name was not properly customized');
    }
    
    return issues;
  }
}

// Export singleton instance
export const orchestrationService = new OrchestrationService();

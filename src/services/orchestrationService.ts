/**
 * Orchestration Service
 * Handles multi-agent workflow planning and coordination using LLM intelligence
 */

import { logger } from '../utils/logger';
import { getBestLLMResponse } from '../utils/llmRouter';
import { llmOrchestratorService, EnhancedLLMResponse } from './llmOrchestrator';
import { jsonRecoveryService, JsonRecoveryResult } from './jsonRecoveryService';
import { AgentVerificationService } from './agentVerificationService';
import { AgentOrchestrationService } from './agentOrchestrationService';
import { v4 as uuidv4 } from 'uuid';

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
    id?: string;
    name: string;
    description: string;
    code: string;
    parameters: Record<string, any>;
    dependencies: string[];
    capabilities: string[];
    execution_target: 'frontend' | 'backend';
    requires_database: boolean;
    database_type?: 'sqlite' | 'duckdb';
    schema?: Record<string, any>;
  };
  status: 'generated' | 'error' | 'enriched';
  confidence: number;
  test_cases?: any[];
  issues?: string[];
  llm_response?: EnhancedLLMResponse;
  // Agent reuse optimization properties
  reused?: boolean;
  similarityScore?: number;
  matchDetails?: {
    matchedAgent?: string;
    matchType?: 'exact' | 'similar' | 'none';
    reasons?: string[];
  };
}

/**
 * Enhanced Orchestration Service with LLM Intelligence
 */
export class OrchestrationService {
  private agentVerificationService: AgentVerificationService;

  constructor() {
    logger.info('Orchestration Service initialized with LLM intelligence');
    this.agentVerificationService = new AgentVerificationService();
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
  async generateAgent(description: string, name?: string, requirements?: any): Promise<AgentGenerationResult> {
    try {
      logger.info('Generating agent', { description, name });

      // Create context with name for proper agent generation
      const context = {
        name: name || 'GeneratedAgent',
        requirements: requirements
      };

      // Use LLM to generate agent code with proper name context
      const llmResponse = await llmOrchestratorService.processAgentGeneration(description, context);
      
      // Parse the LLM response using intelligent JSON recovery
      const rawAgentData = await this.parseAgentResponse(llmResponse.text);
      
      if (!rawAgentData) {
        return {
          agent: {
            name: 'UnknownAgent',
            description: 'Failed to generate agent',
            code: '',
            parameters: {},
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

      // Validate and enhance the agent data (includes code wrapping if needed)
      const agentData = this.validateAndEnhanceAgent(rawAgentData);
      
      if (!agentData) {
        return {
          agent: {
            name: 'ValidationFailedAgent',
            description: 'Agent validation failed',
            code: '// Agent validation failed',
            parameters: {},
            dependencies: [],
            capabilities: [],
            execution_target: 'frontend',
            requires_database: false
          },
          status: 'error',
          confidence: 0,
          issues: ['Agent validation failed'],
          llm_response: llmResponse
        };
      }

      // Run agent verification and enrichment
      let finalAgentCode = agentData.code;
      let verificationIssues: string[] = [];
      let enrichmentApplied = false;
      
      try {
        // Step 1: Verify the agent code
        const verificationRequest = {
          agentCode: finalAgentCode,
          agentMetadata: {
            name: agentData.name,
            description: agentData.description,
            execution_target: agentData.execution_target,
            dependencies: agentData.dependencies
          },
          desiredBehavior: `Agent should: ${agentData.description}`,
          testCases: [{
            name: 'Basic execution test',
            params: {},
            shouldSucceed: true
          }]
        };
        
        const verificationResult = await this.agentVerificationService.verifyAgent(verificationRequest);
        
        // Step 2: If enrichment suggestions are available and auto-enrichment is enabled, apply them
        if (verificationResult.enrichmentSuggestions && verificationResult.enrichmentSuggestions.length > 0) {
          logger.info('Agent has enrichment suggestions, attempting auto-enrichment', {
            agentName: agentData.name,
            suggestionsCount: verificationResult.enrichmentSuggestions.length,
            issuesCount: verificationResult.issues.length,
            suggestions: verificationResult.enrichmentSuggestions.map((s: any) => ({
              type: s.type,
              confidence: s.confidence,
              description: s.description
            }))
          });
          
          // Apply enrichment if confidence is high enough (>= 80%)
          const highConfidenceSuggestions = verificationResult.enrichmentSuggestions
            .filter((s: any) => s.confidence >= 0.8);
          
          logger.info('Enrichment confidence analysis', {
            agentName: agentData.name,
            totalSuggestions: verificationResult.enrichmentSuggestions.length,
            highConfidenceSuggestions: highConfidenceSuggestions.length,
            hasFinalAgentCode: !!verificationResult.finalAgentCode,
            finalAgentCodeLength: verificationResult.finalAgentCode ? verificationResult.finalAgentCode.length : 0
          });
          
          if (highConfidenceSuggestions.length > 0 && verificationResult.finalAgentCode) {
            // Use the enriched code from the verification service
            finalAgentCode = verificationResult.finalAgentCode;
            enrichmentApplied = true;
            
            // Update dependencies if they were re-analyzed during enrichment
            if (verificationResult.dependencies && verificationResult.dependencies.length > 0) {
              agentData.dependencies = verificationResult.dependencies;
              logger.info('Dependencies updated from enrichment', {
                agentName: agentData.name,
                originalDeps: agentData.dependencies,
                enrichedDeps: verificationResult.dependencies
              });
            }
            
            logger.info('Auto-enrichment applied', {
              agentName: agentData.name,
              suggestionsApplied: highConfidenceSuggestions.length
            });
          } else {
            logger.info('Auto-enrichment skipped', {
              agentName: agentData.name,
              reason: highConfidenceSuggestions.length === 0 ? 'No high-confidence suggestions' : 'No final agent code available'
            });
          }
        } else {
          logger.info('No enrichment suggestions generated', {
            agentName: agentData.name,
            hasEnrichmentSuggestions: !!verificationResult.enrichmentSuggestions,
            suggestionsLength: verificationResult.enrichmentSuggestions ? verificationResult.enrichmentSuggestions.length : 0
          });
        }
        
        // Collect verification issues for reporting
        verificationIssues = verificationResult.issues.map(issue => 
          `[${issue.severity}] ${issue.description}${issue.line ? ` (Line ${issue.line})` : ''}`
        );
        
      } catch (verificationError) {
        logger.warn('Agent verification failed, proceeding without verification', {
          agentName: agentData.name,
          error: verificationError instanceof Error ? verificationError.message : String(verificationError)
        });
        verificationIssues.push('Verification service unavailable');
      }

      const result: AgentGenerationResult = {
        agent: {
          name: agentData.name,
          description: agentData.description,
          code: finalAgentCode, // Use verified/enriched code
          parameters: agentData.parameters || {}, // Include extracted parameters
          dependencies: agentData.dependencies || [],
          capabilities: this.extractCapabilities(agentData),
          execution_target: agentData.execution_target || 'frontend',
          requires_database: agentData.requires_database || false,
          database_type: agentData.database_type,
          schema: agentData.schema
        },
        status: enrichmentApplied ? 'enriched' : 'generated',
        confidence: this.calculateAgentConfidence(agentData),
        test_cases: this.generateTestCases(agentData),
        issues: [...this.validateAgentCode(agentData), ...verificationIssues],
        llm_response: llmResponse
      };

      logger.info('Agent generation completed', {
        agentName: result.agent.name,
        confidence: result.confidence,
        provider: llmResponse.provider
      });

      // Store the generated agent in the database
      try {
        const { AgentOrchestrationService } = await import('./agentOrchestrationService');
        const agentService = AgentOrchestrationService.getInstance();
        
        // Create agent object with all required fields
        const agentToStore = {
          id: uuidv4(), // Generate unique ID
          name: result.agent.name,
          description: result.agent.description,
          code: result.agent.code,
          parameters: result.agent.parameters,
          dependencies: result.agent.dependencies,
          capabilities: result.agent.capabilities,
          execution_target: result.agent.execution_target,
          requires_database: result.agent.requires_database,
          database_type: result.agent.database_type,
          version: '1.0.0',
          config: {},
          secrets: {},
          orchestrator_metadata: {
            confidence: result.confidence,
            status: result.status,
            generation_timestamp: new Date().toISOString(),
            llm_provider: result.llm_response?.provider || 'unknown'
          }
        };
        
        const storedAgent = await agentService.storeAgent(agentToStore);
        
        logger.info('Agent stored in database', {
          agentName: storedAgent.name,
          agentId: storedAgent.id,
          confidence: result.confidence
        });
        
        // Update the result with the stored agent's data
        result.agent = { ...result.agent, id: storedAgent.id };
        
      } catch (storageError) {
        logger.error('Failed to store agent in database', {
          agentName: result.agent.name,
          error: storageError instanceof Error ? storageError.message : String(storageError)
        });
        // Don't fail the generation if storage fails, just log the error
        result.issues = result.issues || [];
        result.issues.push('Agent generated successfully but failed to store in database');
      }

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
          parameters: {},
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
   * Generate multiple agents in parallel using Promise.allSettled
   * Each agent gets its own focused LLM call for better isolation and reliability
   */
  async generateAgentsBatch(agentSpecs: Array<{name: string, description: string, context?: string}>): Promise<{
    results: AgentGenerationResult[];
    successful: AgentGenerationResult[];
    failed: AgentGenerationResult[];
    summary: {
      total: number;
      successful: number;
      failed: number;
      successRate: number;
      totalLatency: number;
      averageLatency: number;
    };
  }> {
    const startTime = performance.now();
    
    try {
      logger.info('Starting parallel agent generation', { 
        agentCount: agentSpecs.length,
        agents: agentSpecs.map(spec => spec.name),
        method: 'promise_parallel'
      });

      // Generate all agents in parallel using Promise.allSettled with reuse optimization
      // Each agent checks for existing similar agents via SQL fuzzy search before generating
      const agentPromises = agentSpecs.map((spec, index) => {
        logger.info(`Starting generation with reuse check for agent ${index + 1}/${agentSpecs.length}`, { 
          name: spec.name,
          description: spec.description.substring(0, 100) + '...'
        });
        
        // Use generateAgentWithReuse for SQL-based fuzzy search optimization
        // This will check for existing similar agents before generating new ones
        return this.generateAgentWithReuse(spec.description, spec.name, spec.context);
      });

      // Wait for all agent generations to complete in parallel
      const results = await Promise.allSettled(agentPromises);
      
      // Process results and separate successful from failed
      const agentResults: AgentGenerationResult[] = [];
      const successful: AgentGenerationResult[] = [];
      const failed: AgentGenerationResult[] = [];
      
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          const agentResult = result.value;
          agentResults.push(agentResult);
          
          if (agentResult.status === 'generated') {
            logger.info(`Completed generation for agent ${index + 1}/${agentSpecs.length}`, {
              name: agentResult.agent.name,
              status: agentResult.status,
              confidence: agentResult.confidence
            });
            successful.push(agentResult);
          } else {
            logger.error(`Failed to generate agent ${index + 1}/${agentSpecs.length}`, {
              name: agentSpecs[index].name,
              error: agentResult.issues
            });
            failed.push(agentResult);
          }
        } else {
          // Promise was rejected
          const failedResult: AgentGenerationResult = {
            agent: {
              name: agentSpecs[index].name,
              description: agentSpecs[index].description,
              code: '// Promise rejection error',
              parameters: {},
              dependencies: [],
              capabilities: [],
              execution_target: 'frontend',
              requires_database: false
            },
            status: 'error',
            confidence: 0,
            issues: [`Promise rejection: ${result.reason}`]
          };

          logger.error(`Failed to generate agent ${index + 1}/${agentSpecs.length}`, {
            name: agentSpecs[index].name,
            error: result.reason
          });
          
          agentResults.push(failedResult);
          failed.push(failedResult);
        }
      });
      
      const totalLatency = performance.now() - startTime;
      const summary = {
        total: agentSpecs.length,
        successful: successful.length,
        failed: failed.length,
        successRate: successful.length / agentSpecs.length,
        totalLatency,
        averageLatency: totalLatency / agentSpecs.length
      };
      
      logger.info('Batch agent generation completed', {
        ...summary,
        successfulAgents: successful.map(r => r.agent.name),
        failedAgents: failed.map(r => r.agent.name)
      });
      
      return {
        results: agentResults,
        successful,
        failed,
        summary
      };
      
    } catch (error) {
      const totalLatency = performance.now() - startTime;
      
      logger.error('Batch agent generation failed completely', {
        error: error instanceof Error ? error.message : String(error),
        agentCount: agentSpecs.length,
        totalLatency
      });
      
      // Return all failed results
      const failedResults = agentSpecs.map(spec => ({
        agent: {
          name: spec.name,
          description: spec.description,
          code: '// Batch generation system error',
          parameters: {},
          dependencies: [],
          capabilities: [],
          execution_target: 'frontend' as const,
          requires_database: false
        },
        status: 'error' as const,
        confidence: 0,
        issues: [`Batch system error: ${error instanceof Error ? error.message : String(error)}`]
      }));
      
      return {
        results: failedResults,
        successful: [],
        failed: failedResults,
        summary: {
          total: agentSpecs.length,
          successful: 0,
          failed: agentSpecs.length,
          successRate: 0,
          totalLatency,
          averageLatency: totalLatency / agentSpecs.length
        }
      };
    }
  }

  // Private helper methods

  private parseOrchestrationResponse(response: string): any {
    try {
      // Extract JSON from LLM response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          return JSON.parse(jsonMatch[0]);
        } catch (parseError) {
          // If JSON parsing fails, try to recover from truncated response
          logger.warn('JSON parsing failed, attempting recovery', { parseError });
          return this.recoverFromTruncatedResponse(jsonMatch[0]);
        }
      }
      return null;
    } catch (error) {
      logger.warn('Failed to parse orchestration response', { error });
      return null;
    }
  }

  /**
   * Attempt to recover useful information from truncated JSON response
   */
  private recoverFromTruncatedResponse(truncatedJson: string): any {
    try {
      // Try to extract agents array even if JSON is incomplete
      const agentsMatch = truncatedJson.match(/"agents"\s*:\s*\[([\s\S]*?)\]/m);
      const taskBreakdownMatch = truncatedJson.match(/"task_breakdown"\s*:\s*\[([\s\S]*?)\]/m);
      
      if (agentsMatch || taskBreakdownMatch) {
        const recovered: any = {};
        
        // Try to parse agents array
        if (agentsMatch) {
          try {
            const agentsJson = `[${agentsMatch[1]}]`;
            recovered.agents = JSON.parse(agentsJson);
          } catch (e) {
            // If agents array is also truncated, extract individual agent objects
            const agentObjects = this.extractAgentObjects(agentsMatch[1]);
            if (agentObjects.length > 0) {
              recovered.agents = agentObjects;
            }
          }
        }
        
        // Try to parse task breakdown
        if (taskBreakdownMatch) {
          try {
            const taskJson = `[${taskBreakdownMatch[1]}]`;
            recovered.task_breakdown = JSON.parse(taskJson);
          } catch (e) {
            logger.warn('Could not parse task_breakdown from truncated response');
          }
        }
        
        if (recovered.agents && recovered.agents.length > 0) {
          logger.info(`Recovered ${recovered.agents.length} agents from truncated response`);
          return recovered;
        }
      }
      
      return null;
    } catch (error) {
      logger.error('Failed to recover from truncated response', { error });
      return null;
    }
  }

  /**
   * Extract individual agent objects from truncated agents array string
   */
  private extractAgentObjects(agentsString: string): any[] {
    const agents: any[] = [];
    
    try {
      // Look for individual agent objects using regex
      const agentMatches = agentsString.match(/\{[^{}]*"name"[^{}]*\}/g);
      
      if (agentMatches) {
        for (const agentMatch of agentMatches) {
          try {
            const agent = JSON.parse(agentMatch);
            if (agent.name) {
              agents.push(agent);
            }
          } catch (e) {
            // Skip malformed agent objects
            continue;
          }
        }
      }
    } catch (error) {
      logger.warn('Failed to extract agent objects', { error });
    }
    
    return agents;
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

  private async parseAgentResponse(response: string): Promise<any> {
    try {
      // Log the raw response for debugging
      logger.info('Raw LLM response for agent generation', { 
        responseLength: response.length,
        responsePreview: response.substring(0, 200) + '...'
      });

      // Use intelligent JSON recovery service
      const recoveryResult = await jsonRecoveryService.recoverJson(
        response,
        `{
          "name": "string",
          "description": "string", 
          "code": "string (complete TypeScript code)",
          "dependencies": ["array", "of", "strings"],
          "execution_target": "frontend|backend",
          "requires_database": boolean,
          "version": "string",
          "config": {},
          "secrets": {},
          "orchestrator_metadata": {}
        }`
      );

      if (recoveryResult.success && recoveryResult.parsedData) {
        logger.info('JSON recovery successful', {
          method: recoveryResult.recoveryMethod,
          confidence: recoveryResult.confidence
        });
        
        return this.validateAndEnhanceAgent(recoveryResult.parsedData);
      } else {
        logger.error('JSON recovery failed', {
          method: recoveryResult.recoveryMethod,
          error: recoveryResult.originalError,
          responsePreview: response.substring(0, 500)
        });
        return null;
      }
      
    } catch (error) {
      logger.error('Unexpected error in parseAgentResponse', {
        error: (error as Error).message,
        stack: (error as Error).stack
      });
      return null;
    }
  }

  /**
   * Extract balanced JSON from response using brace counting
   */
  private extractBalancedJson(text: string): string | null {
    const firstBrace = text.indexOf('{');
    if (firstBrace === -1) return null;
    
    let braceCount = 0;
    let inString = false;
    let escaped = false;
    
    for (let i = firstBrace; i < text.length; i++) {
      const char = text[i];
      
      if (escaped) {
        escaped = false;
        continue;
      }
      
      if (char === '\\') {
        escaped = true;
        continue;
      }
      
      if (char === '"' && !escaped) {
        inString = !inString;
        continue;
      }
      
      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            return text.substring(firstBrace, i + 1);
          }
        }
      }
    }
    
    return null;
  }

  /**
   * Attempt to parse JSON with progressive error recovery
   */
  private attemptJsonParse(jsonStr: string): any {
    // First attempt: direct parsing
    try {
      const parsed = JSON.parse(jsonStr);
      logger.info('Direct JSON parse successful');
      return parsed;
    } catch (error) {
      logger.debug('Direct JSON parse failed, attempting recovery', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    // Second attempt: fix common issues
    let fixedJson = jsonStr;
    
    try {
      // Remove trailing commas
      fixedJson = fixedJson.replace(/,\s*([}\]])/g, '$1');
      
      // Fix unclosed strings at end
      if (fixedJson.match(/"[^"]*$/)) {
        fixedJson += '"';
      }
      
      // Fix missing closing braces/brackets
      const openBraces = (fixedJson.match(/\{/g) || []).length;
      const closeBraces = (fixedJson.match(/\}/g) || []).length;
      const openBrackets = (fixedJson.match(/\[/g) || []).length;
      const closeBrackets = (fixedJson.match(/\]/g) || []).length;
      
      if (openBraces > closeBraces) {
        fixedJson += '}'.repeat(openBraces - closeBraces);
      }
      if (openBrackets > closeBrackets) {
        fixedJson += ']'.repeat(openBrackets - closeBrackets);
      }
      
      // Fix common template literal issues
      fixedJson = fixedJson.replace(/`([^`]*)`/g, '"$1"'); // Convert template literals to strings
      fixedJson = fixedJson.replace(/\$\{[^}]*\}/g, '"PLACEHOLDER"'); // Replace template expressions
      
      const parsed = JSON.parse(fixedJson);
      logger.info('JSON recovery successful');
      return parsed;
    } catch (error) {
      logger.debug('JSON recovery failed', {
        error: error instanceof Error ? error.message : String(error),
        fixedJson: fixedJson.substring(0, 200)
      });
    }
    
    // Third attempt: extract key-value pairs manually
    try {
      return this.manualJsonExtraction(jsonStr);
    } catch (error) {
      logger.debug('Manual JSON extraction failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
    
    return null;
  }

  /**
   * Manual extraction of key-value pairs when JSON parsing fails
   */
  private manualJsonExtraction(text: string): any {
    const result: any = {};
    
    // Extract common agent fields using regex
    const patterns = {
      name: /["']name["']\s*:\s*["']([^"']+)["']/i,
      description: /["']description["']\s*:\s*["']([^"']+)["']/i,
      execution_target: /["']execution_target["']\s*:\s*["']([^"']+)["']/i,
      requires_database: /["']requires_database["']\s*:\s*(true|false)/i,
      version: /["']version["']\s*:\s*["']([^"']+)["']/i
    };
    
    for (const [key, pattern] of Object.entries(patterns)) {
      const match = text.match(pattern);
      if (match) {
        if (key === 'requires_database') {
          result[key] = match[1] === 'true';
        } else {
          result[key] = match[1];
        }
      }
    }
    
    // Extract code block
    const codeMatch = text.match(/["']code["']\s*:\s*["']([\s\S]*?)["'](?=\s*[,}])/i) ||
                     text.match(/["']code["']\s*:\s*`([\s\S]*?)`/i);
    if (codeMatch) {
      result.code = codeMatch[1];
    }
    
    // Extract dependencies array
    const depsMatch = text.match(/["']dependencies["']\s*:\s*\[([^\]]*?)\]/i);
    if (depsMatch) {
      result.dependencies = depsMatch[1]
        .split(',')
        .map(dep => dep.trim().replace(/["']/g, ''))
        .filter(dep => dep.length > 0);
    }
    
    logger.info('Manual JSON extraction completed', {
      extractedFields: Object.keys(result),
      hasName: !!result.name,
      hasCode: !!result.code
    });
    
    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Extract agent information from plain text when JSON parsing completely fails
   */
  private extractAgentFromText(text: string): any {
    logger.info('Attempting to extract agent from plain text');
    
    // Try to find agent name and description from common patterns
    const nameMatch = text.match(/(?:agent|name)\s*:?\s*["']?([^\n"']+)["']?/i);
    const descMatch = text.match(/(?:description|desc)\s*:?\s*["']?([^\n"']+)["']?/i);
    
    const name = nameMatch ? nameMatch[1].trim() : 'ExtractedAgent';
    const description = descMatch ? descMatch[1].trim() : 'Agent extracted from LLM response';
    
    return {
      name,
      description,
      code: this.generateFallbackCode(name, description),
      dependencies: [],
      execution_target: 'frontend',
      requires_database: false,
      version: 'v1.0.0',
      config: {},
      secrets: {},
      orchestrator_metadata: {
        chain_order: 1,
        next_agents: [],
        resources: { memory_mb: 256, network_required: true }
      }
    };
  }

  /**
   * Generate fallback code when agent code is missing or invalid
   */
  private generateFallbackCode(name: string, description: string): string {
    return `// ${name} - ${description}
// Generated fallback code due to parsing issues

export default {
  name: '${name}',
  description: '${description}',
  
  async execute(params = {}) {
    console.log('Executing ${name}...');
    console.log('Parameters:', params);
    
    try {
      // TODO: Implement actual agent logic
      
      return {
        success: true,
        result: 'Agent executed successfully (fallback mode)',
        timestamp: new Date().toISOString(),
        params
      };
    } catch (error) {
      console.error('Agent execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
    }
  }
};`;
  }

  /**
   * Check if code is already in proper agent module format
   */
  private isProperAgentModuleFormat(code: string): boolean {
  // Check for the expected agent module structure
  const hasExportDefault = code.includes('export default');
  const hasExecuteMethod = code.includes('async execute(') || code.includes('execute(');
  const hasNameProperty = code.includes('name:');
  
  return hasExportDefault && hasExecuteMethod && hasNameProperty;
}

  /**
   * Unescape code string to remove \n, \t, \', etc. and make it readable
   */
  private unescapeCode(code: string): string {
    try {
      // Handle common escape sequences
      return code
        .replace(/\\n/g, '\n')     // Convert \n to actual newlines
        .replace(/\\t/g, '\t')     // Convert \t to actual tabs
        .replace(/\\r/g, '\r')     // Convert \r to actual carriage returns
        .replace(/\\'/g, "'")      // Convert \' to actual single quotes
        .replace(/\\"/g, '"')     // Convert \" to actual double quotes
        .replace(/\\\\/g, '\\');   // Convert \\ to actual backslashes
    } catch (error) {
      logger.warn('Failed to unescape code, using original', { error: error instanceof Error ? error.message : String(error) });
      return code;
    }
  }

  /**
   * Wrap standalone code in proper agent module format
   */
  private wrapCodeInAgentModule(standaloneCode: string, name: string, description: string): string {
    // Clean up the standalone code (remove any trailing semicolons or exports)
    let cleanCode = standaloneCode.trim();
    
    // Remove any existing export statements that might conflict
    cleanCode = cleanCode.replace(/^export\s+default\s+/gm, '');
    cleanCode = cleanCode.replace(/^module\.exports\s*=\s*/gm, '');
    
    // Create the proper agent module wrapper
    return `export default {
  name: '${name}',
  description: '${description}',
  
  async execute(params, context) {
    try {
      // Original standalone code wrapped in execute method
      ${cleanCode.split('\n').map(line => '      ' + line).join('\n')}
      
      return { 
        success: true, 
        result: 'Agent executed successfully',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Agent execution error:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      };
    }
  }
};`;
}  

  /**
   * Extract parameters from agent code by analyzing both explicit parameters objects and execute function patterns
   * Enhanced version with comprehensive parsing for destructuring, defaults, and template literals
   */
  private extractParametersFromCode(code: string): Record<string, any> {
    try {
      let parameters: Record<string, any> = {};
      
      // First, look for explicit parameters object in the agent code
      // Pattern: parameters: { param1: { type: 'string', default: 'value' }, ... }
      const explicitParamsRegex = /parameters\s*:\s*\{([\s\S]*?)\}(?=\s*,|\s*\}|$)/;
      const explicitMatch = explicitParamsRegex.exec(code);
      
      if (explicitMatch) {
        try {
          // Extract the parameters object content
          const paramsContent = explicitMatch[1];
          
          // Parse parameter definitions using a more robust approach
          // Look for patterns like: paramName: { ... }
          const paramDefRegex = /([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:\s*\{([\s\S]*?)\}(?=\s*,|\s*$)/g;
          let paramMatch;
          
          while ((paramMatch = paramDefRegex.exec(paramsContent)) !== null) {
            const paramName = paramMatch[1];
            const paramDefContent = paramMatch[2];
            
            // Extract type, default, required, description from the parameter definition
            const typeMatch = paramDefContent.match(/type\s*:\s*['"]([^'"]+)['"]/);
            const defaultMatch = paramDefContent.match(/default\s*:\s*([^,}]+)/);
            const requiredMatch = paramDefContent.match(/required\s*:\s*(true|false)/);
            const descriptionMatch = paramDefContent.match(/description\s*:\s*['"]([^'"]+)['"]/);
            
            const paramInfo: any = {
              type: typeMatch ? typeMatch[1] : 'any',
              required: requiredMatch ? requiredMatch[1] === 'true' : false
            };
            
            if (defaultMatch) {
              let defaultValue = defaultMatch[1].trim();
              // Parse the default value
              if (defaultValue.startsWith("'") && defaultValue.endsWith("'")) {
                paramInfo.default = defaultValue.slice(1, -1);
              } else if (defaultValue.startsWith('"') && defaultValue.endsWith('"')) {
                paramInfo.default = defaultValue.slice(1, -1);
              } else if (defaultValue === 'true') {
                paramInfo.default = true;
              } else if (defaultValue === 'false') {
                paramInfo.default = false;
              } else if (defaultValue === '[]') {
                paramInfo.default = [];
              } else if (defaultValue === '{}') {
                paramInfo.default = {};
              } else if (!isNaN(Number(defaultValue))) {
                paramInfo.default = Number(defaultValue);
              } else {
                paramInfo.default = defaultValue;
              }
            }
            
            if (descriptionMatch) {
              paramInfo.description = descriptionMatch[1];
            }
            
            parameters[paramName] = paramInfo;
          }
        } catch (error) {
          logger.warn('Failed to parse explicit parameters object', { error: error instanceof Error ? error.message : String(error) });
        }
      }
      
      // Look for destructuring patterns in the execute function
      // Pattern 1: const { param1 = 'default', param2, param3 = 123 } = params;
      // Pattern 2: const { param1, param2, param3 } = params;
      // Pattern 3: Multi-line destructuring with complex defaults
      const destructuringRegex = /const\s*\{([\s\S]*?)\}\s*=\s*params;?/g;
      let destructuringMatch;
      
      while ((destructuringMatch = destructuringRegex.exec(code)) !== null) {
        if (destructuringMatch && destructuringMatch[1]) {
          const paramString = destructuringMatch[1];
          
          // Parse parameters with smart comma splitting to handle complex defaults
          const paramParts = this.smartSplitParameters(paramString);
          
          for (const part of paramParts) {
            if (!part) continue; // Skip empty parts
            
            // Handle different parameter formats:
            // 1. param = 'default' (with default value)
            // 2. param (without default)
            // 3. param = 123 (numeric default)
            // 4. param = true/false (boolean default)
            // 5. param = { key: value } (object default)
            // 6. param = [] (array default)
            // 7. param = `template` (template literal default)
            
            const defaultValueMatch = part.match(/^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*([\s\S]+)$/);
            if (defaultValueMatch && defaultValueMatch.length >= 3) {
              const paramName = defaultValueMatch[1];
              const defaultValue = defaultValueMatch[2].trim();
              
              // Skip if already defined in explicit parameters
              if (parameters[paramName]) continue;
              
              // Parse the default value using enhanced logic
              const { parsedDefault, inferredType } = this.parseDefaultValue(defaultValue);
              
              parameters[paramName] = {
                type: inferredType,
                default: parsedDefault,
                required: false
              };
            } else {
              // Parameter without default value - check if it's a valid parameter name
              const paramName = part.trim();
              if (paramName && /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(paramName)) {
                // Skip if already defined in explicit parameters
                if (parameters[paramName]) continue;
                
                // Look for default assignments later in the code to infer type
                // Pattern: paramName: paramName || 'default' or paramName || 'default'
                // Also handle template literals: paramName || `template_${var}`
                const defaultAssignmentRegex = new RegExp(`${paramName}\\s*:\\s*${paramName}\\s*\\|\\|\\s*([^;,\\n}]+)[;,\\n}]|${paramName}\\s*\\|\\|\\s*([^;,\\n}]+)[;,\\n}]`, 'g');
                const assignmentMatch = defaultAssignmentRegex.exec(code);
                
                if (assignmentMatch && (assignmentMatch[1] || assignmentMatch[2])) {
                  // Get the default value from either capture group
                  const defaultValue = (assignmentMatch[1] || assignmentMatch[2]).trim();
                  let parsedDefault: any;
                  
                  if (defaultValue.startsWith("'") && defaultValue.endsWith("'")) {
                    parsedDefault = defaultValue.slice(1, -1);
                  } else if (defaultValue.startsWith('"') && defaultValue.endsWith('"')) {
                    parsedDefault = defaultValue.slice(1, -1);
                  } else if (defaultValue.startsWith('`') && defaultValue.endsWith('`')) {
                    parsedDefault = defaultValue; // Keep template literal as-is
                  } else if (defaultValue === 'true') {
                    parsedDefault = true;
                  } else if (defaultValue === 'false') {
                    parsedDefault = false;
                  } else if (defaultValue === 'null') {
                    parsedDefault = null;
                  } else if (!isNaN(Number(defaultValue))) {
                    parsedDefault = Number(defaultValue);
                  } else {
                    parsedDefault = defaultValue;
                  }
                  
                  parameters[paramName] = {
                    type: typeof parsedDefault,
                    default: parsedDefault,
                    required: false
                  };
                } else {
                  // No default found, mark as required
                  parameters[paramName] = {
                    type: 'any',
                    required: true
                  };
                }
              }
            }
          }
        }
      }
      
      // Also look for individual parameter usage patterns
      // Pattern: params.paramName or params['paramName']
      const paramUsageRegex = /params\.([a-zA-Z_$][a-zA-Z0-9_$]*)|params\['([^']+)'\]/g;
      let usageMatch;
      
      while ((usageMatch = paramUsageRegex.exec(code)) !== null) {
        const paramName = usageMatch[1] || usageMatch[2];
        if (paramName && !parameters[paramName]) {
          parameters[paramName] = {
            type: 'any',
            required: false
          };
        }
      }
      
      logger.info('Extracted parameters from agent code', {
        parameterCount: Object.keys(parameters).length,
        parameters: Object.keys(parameters)
      });
      
      return parameters;
    } catch (error) {
      logger.warn('Failed to extract parameters from agent code', { error: error instanceof Error ? error.message : String(error) });
      return {};
    }
  }

  /**
   * Smart parameter splitting that handles complex default values
   * Properly splits parameters while respecting nested objects, arrays, and template literals
   */
  private smartSplitParameters(paramString: string): string[] {
    const params: string[] = [];
    let current = '';
    let depth = 0;
    let inString = false;
    let stringChar = '';
    let inTemplate = false;
    let templateDepth = 0;
    
    for (let i = 0; i < paramString.length; i++) {
      const char = paramString[i];
      const nextChar = paramString[i + 1];
      
      // Handle template literals
      if (char === '`' && !inString) {
        inTemplate = !inTemplate;
        current += char;
        continue;
      }
      
      // Handle template literal expressions ${...}
      if (inTemplate && char === '$' && nextChar === '{') {
        templateDepth++;
        current += char;
        continue;
      }
      
      if (inTemplate && char === '}' && templateDepth > 0) {
        templateDepth--;
        current += char;
        continue;
      }
      
      // Handle string literals
      if ((char === '"' || char === "'") && !inTemplate) {
        if (!inString) {
          inString = true;
          stringChar = char;
        } else if (char === stringChar && paramString[i - 1] !== '\\') {
          inString = false;
          stringChar = '';
        }
        current += char;
        continue;
      }
      
      // Skip processing if we're inside a string or template literal
      if (inString || inTemplate) {
        current += char;
        continue;
      }
      
      // Handle nested objects and arrays
      if (char === '{' || char === '[') {
        depth++;
        current += char;
        continue;
      }
      
      if (char === '}' || char === ']') {
        depth--;
        current += char;
        continue;
      }
      
      // Split on comma only if we're at the top level
      if (char === ',' && depth === 0) {
        const trimmed = current.trim();
        if (trimmed) {
          params.push(trimmed);
        }
        current = '';
        continue;
      }
      
      current += char;
    }
    
    // Add the last parameter
    const trimmed = current.trim();
    if (trimmed) {
      params.push(trimmed);
    }
    
    return params;
  }

  /**
   * Parse default values with enhanced type inference
   * Handles complex objects, arrays, template literals, and primitive types
   */
  private parseDefaultValue(defaultValue: string): { parsedDefault: any; inferredType: string } {
    const trimmed = defaultValue.trim();
    
    try {
      // Handle string literals
      if ((trimmed.startsWith("'") && trimmed.endsWith("'")) ||
          (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
        return {
          parsedDefault: trimmed.slice(1, -1),
          inferredType: 'string'
        };
      }
      
      // Handle template literals
      if (trimmed.startsWith('`') && trimmed.endsWith('`')) {
        return {
          parsedDefault: trimmed, // Keep template literal as-is for display
          inferredType: 'string'
        };
      }
      
      // Handle boolean literals
      if (trimmed === 'true') {
        return { parsedDefault: true, inferredType: 'boolean' };
      }
      if (trimmed === 'false') {
        return { parsedDefault: false, inferredType: 'boolean' };
      }
      
      // Handle null
      if (trimmed === 'null') {
        return { parsedDefault: null, inferredType: 'object' };
      }
      
      // Handle undefined
      if (trimmed === 'undefined') {
        return { parsedDefault: undefined, inferredType: 'undefined' };
      }
      
      // Handle numbers
      if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
        const num = Number(trimmed);
        if (!isNaN(num)) {
          return { parsedDefault: num, inferredType: 'number' };
        }
      }
      
      // Handle arrays
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          return { parsedDefault: parsed, inferredType: 'array' };
        } catch {
          // If JSON parsing fails, treat as complex array
          return { parsedDefault: trimmed, inferredType: 'array' };
        }
      }
      
      // Handle objects
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          return { parsedDefault: parsed, inferredType: 'object' };
        } catch {
          // If JSON parsing fails, treat as complex object
          return { parsedDefault: trimmed, inferredType: 'object' };
        }
      }
      
      // Handle function calls or complex expressions
      if (trimmed.includes('(') && trimmed.includes(')')) {
        return { parsedDefault: trimmed, inferredType: 'any' };
      }
      
      // Default: treat as string
      return { parsedDefault: trimmed, inferredType: 'string' };
      
    } catch (error) {
      // Fallback: treat as string if parsing fails
      return { parsedDefault: trimmed, inferredType: 'string' };
    }
  }

  /**
   * Validate and enhance parsed agent data
   */
  private validateAndEnhanceAgent(parsed: any): any {
    // Ensure required fields exist
    if (!parsed.name || typeof parsed.name !== 'string') {
      logger.warn('Agent missing or invalid name field');
      return null;
    }
    
    if (!parsed.description || typeof parsed.description !== 'string') {
      logger.warn('Agent missing or invalid description field');
      return null;
    }
    
    // Validate and fix code field
    if (!parsed.code || typeof parsed.code !== 'string' || parsed.code.length < 10) {
      logger.warn('Agent code is missing or too short, generating fallback', {
        hasCode: !!parsed.code,
        codeLength: parsed.code ? parsed.code.length : 0
      });
      parsed.code = this.generateFallbackCode(parsed.name, parsed.description);
    } else {
      // Unescape the code to remove \n, \t, \', etc. and make it readable
      parsed.code = this.unescapeCode(parsed.code);
      
      // Check if code is already in proper agent module format
      if (!this.isProperAgentModuleFormat(parsed.code)) {
        logger.info('Converting standalone code to proper agent module format', {
          name: parsed.name,
          originalCodeLength: parsed.code.length
        });
        parsed.code = this.wrapCodeInAgentModule(parsed.code, parsed.name, parsed.description);
      }
    }
    
    // Ensure arrays are properly formatted
    if (!Array.isArray(parsed.dependencies)) {
      parsed.dependencies = [];
    }
    
    // Extract parameters from the agent code
    if (parsed.code) {
      const extractedParams = this.extractParametersFromCode(parsed.code);
      parsed.parameters = extractedParams;
      logger.info('Extracted parameters for agent', {
        name: parsed.name,
        parameterCount: Object.keys(extractedParams).length,
        parameters: Object.keys(extractedParams)
      });
    } else {
      parsed.parameters = {};
    }
    
    // Set defaults for missing fields
    parsed.execution_target = parsed.execution_target || 'frontend';
    parsed.requires_database = Boolean(parsed.requires_database);
    parsed.version = parsed.version || 'v1.0.0';
    
    // Add enhanced fields with defaults
    parsed.config = parsed.config || {};
    parsed.secrets = parsed.secrets || {};
    parsed.orchestrator_metadata = parsed.orchestrator_metadata || {
      chain_order: 1,
      next_agents: [],
      resources: { memory_mb: 256, network_required: true }
    };
    
    logger.info('Agent validation and enhancement completed', { 
      name: parsed.name,
      hasCode: !!parsed.code,
      codeLength: parsed.code ? parsed.code.length : 0,
      dependencies: parsed.dependencies.length,
      executionTarget: parsed.execution_target
    });
    
    return parsed;
  }

  /**
   * Legacy method for backward compatibility - uses basic JSON extraction
   */
  private parseAgentResponseLegacy(response: string): any {
    logger.warn('Using legacy parseAgentResponse method - consider updating caller to use async version');
    
    try {
      // Basic JSON extraction for legacy compatibility
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      }
      return null;
    } catch (error) {
      logger.error('Legacy JSON parsing failed', {
        error: (error as Error).message,
        responsePreview: response.substring(0, 200)
      });
      return null;
    }
  }

  /**
   * Handle parsing errors with detailed logging and recovery
   */
  private handleParsingError(error: Error, context: string): null {
    logger.error(`JSON parsing error in ${context}`, {
      error: error.message,
      stack: error.stack,
      context
    });
    return null;
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

  /**
   * Mock database method - replace with actual database integration
                                                                                                                                    /**
   * Find reusable agent using efficient SQL-based fuzzy search
   * Uses AgentOrchestrationService for database-level similarity matching
   */
  async findReusableAgent(description: string, name: string): Promise<any | null> {
    try {
      logger.info('Searching for reusable agents using SQL fuzzy search', { description, name });
      
      const agentOrchestrationService = AgentOrchestrationService.getInstance();
      
      // DEBUG: First get all agents to see similarity scores
      const allSimilarAgents = await agentOrchestrationService.findSimilarAgents(
        description, 
        name, 
        0.0 // Get all agents to see their scores
      );
      
      if (allSimilarAgents) {
        logger.info('DEBUG: All agent similarity scores', {
          description,
          name,
          topAgent: {
            name: allSimilarAgents.agent.name,
            description: allSimilarAgents.agent.description,
            similarityScore: allSimilarAgents.similarityScore,
            matchDetails: allSimilarAgents.matchDetails
          }
        });
      }
      
      const similarAgent = await agentOrchestrationService.findSimilarAgents(
        description, 
        name, 
        0.15 // 15% similarity threshold - optimized for positive matching while preventing false positives
      );
      
      if (similarAgent) {
        logger.info('Found reusable agent via SQL search', {
          agentName: similarAgent.agent.name,
          overallScore: similarAgent.similarityScore,
          descriptionSimilarity: similarAgent.matchDetails.descriptionSimilarity,
          requirementsSimilarity: similarAgent.matchDetails.requirementsSimilarity,
          matchType: similarAgent.matchDetails.matchType
        });
        
        return {
          ...similarAgent.agent,
          reused: true,
          similarityScore: similarAgent.similarityScore,
          matchDetails: {
            descriptionSimilarity: similarAgent.matchDetails.descriptionSimilarity,
            requirementsSimilarity: similarAgent.matchDetails.requirementsSimilarity,
            matchType: similarAgent.matchDetails.matchType
          }
        };
      } else {
        logger.info('No suitable agent found for reuse via SQL search');
        return null;
      }
    } catch (error) {
      logger.error('Error finding reusable agent via SQL search', { error, description, name });
      return null;
    }
  }

  /**
   * Calculate text similarity using simple word overlap algorithm
   * In production, this could use more sophisticated NLP techniques
   */
  private calculateTextSimilarity(text1: string, text2: string): number {
    if (!text1 || !text2) return 0;
    
    // Normalize texts: lowercase, remove punctuation, split into words
    const normalize = (text: string) => 
      text.toLowerCase()
          .replace(/[^a-z0-9\s]/g, ' ')
          .split(/\s+/)
          .filter(word => word.length > 2); // Filter out short words
    
    const words1 = normalize(text1);
    const words2 = normalize(text2);
    
    if (words1.length === 0 || words2.length === 0) return 0;
    
    // Calculate Jaccard similarity (intersection over union)
    const set1 = new Set(words1);
    const set2 = new Set(words2);
    
    const intersection = new Set([...set1].filter(word => set2.has(word)));
    const union = new Set([...set1, ...set2]);
    
    return intersection.size / union.size;
  }

  /**
   * Enhanced generateAgent method with reuse optimization
   */
  async generateAgentWithReuse(description: string, name: string, context?: any): Promise<AgentGenerationResult> {
    try {
      logger.info('Starting agent generation with reuse optimization', { description, name });
      
      // Step 1: Check for reusable agents first
      const reusableAgent = await this.findReusableAgent(description, name);
      
      if (reusableAgent) {
        logger.info('Reusing existing agent', {
          agentName: reusableAgent.name,
          similarityScore: reusableAgent.similarityScore
        });
        
        return {
          agent: {
            name: reusableAgent.name,
            description: reusableAgent.description,
            code: reusableAgent.code,
            parameters: reusableAgent.parameters || {},
            dependencies: reusableAgent.dependencies || [],
            capabilities: this.extractCapabilities(reusableAgent),
            execution_target: reusableAgent.execution_target || 'backend',
            requires_database: reusableAgent.requires_database || false,
            database_type: reusableAgent.database_type,
            schema: reusableAgent.schema
          },
          status: 'generated',
          confidence: reusableAgent.similarityScore,
          reused: true,
          similarityScore: reusableAgent.similarityScore, // Fix: Add similarityScore for API response
          matchDetails: reusableAgent.matchDetails,
          issues: []
        };
      }
      
      // Step 2: No suitable agent found, generate new one
      logger.info('No reusable agent found, generating new agent');
      const newAgent = await this.generateAgent(description, name, context);
      
      return {
        ...newAgent,
        reused: false
      };
    } catch (error) {
      logger.error('Error in generateAgentWithReuse', { error, description, name });
      throw error;
    }
  }

  /**
   * Get all agents from database
   */
  async getAllAgents(): Promise<any[]> {
    try {
      logger.info('Getting all agents from database');
      
      // Use real database integration via AgentOrchestrationService
      const { AgentOrchestrationService } = await import('./agentOrchestrationService');
      const agentService = AgentOrchestrationService.getInstance();
      const agents = await agentService.getAllAgents();
      
      logger.info('Retrieved agents from database', { count: agents.length });
      return agents;
    } catch (error) {
      logger.error('Error getting all agents', { error });
      return [];
    }
  }

  /**
   * Get agent by name from database
   */
  async getAgentByName(name: string): Promise<any | null> {
    try {
      logger.info('Getting agent by name', { name });
      
      // Use real database integration via AgentOrchestrationService
      const { AgentOrchestrationService } = await import('./agentOrchestrationService');
      const agentService = AgentOrchestrationService.getInstance();
      const agent = await agentService.getAgent(name);
      
      if (agent) {
        logger.info('Found existing agent', { name: agent.name, id: agent.id });
        return agent;
      }
      
      logger.info('No agent found with name', { name });
      return null;
    } catch (error) {
      logger.error('Error getting agent by name', { name, error });
      return null;
    }
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
}

// Export singleton instance
export const orchestrationService = new OrchestrationService();

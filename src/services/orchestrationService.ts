/**
 * Orchestration Service
 * Handles multi-agent workflow planning and coordination using LLM intelligence
 */

import { logger } from '../utils/logger';
import { getBestLLMResponse } from '../utils/llmRouter';
import { llmOrchestratorService, EnhancedLLMResponse } from './llmOrchestrator';
import { jsonRecoveryService, JsonRecoveryResult } from './jsonRecoveryService';
import { AgentVerificationService } from './agentVerificationService';

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
  status: 'generated' | 'error' | 'enriched';
  confidence: number;
  test_cases?: any[];
  issues?: string[];
  llm_response?: EnhancedLLMResponse;
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
  async generateAgent(description: string, requirements?: any): Promise<AgentGenerationResult> {
    try {
      logger.info('Generating agent', { description });

      // Use LLM to generate agent code
      const llmResponse = await llmOrchestratorService.processAgentGeneration(description, requirements);
      
      // Parse the LLM response using intelligent JSON recovery
      const rawAgentData = await this.parseAgentResponse(llmResponse.text);
      
      if (!rawAgentData) {
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

      // Validate and enhance the agent data (includes code wrapping if needed)
      const agentData = this.validateAndEnhanceAgent(rawAgentData);
      
      if (!agentData) {
        return {
          agent: {
            name: 'ValidationFailedAgent',
            description: 'Agent validation failed',
            code: '// Agent validation failed',
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

      // Generate all agents in parallel using Promise.allSettled
      // Return promises directly for true parallelism - let Promise.allSettled handle everything
      const agentPromises = agentSpecs.map((spec, index) => {
        logger.info(`Starting generation for agent ${index + 1}/${agentSpecs.length}`, { 
          name: spec.name,
          description: spec.description.substring(0, 100) + '...'
        });
        
        // Use focused context for each agent to avoid confusion
        const focusedDescription = `${spec.description}. Focus specifically on: ${spec.description}`;
        
        // Return the promise directly - Promise.allSettled will handle success/failure
        return this.generateAgent(focusedDescription, spec.context);
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
      // This is a fallback implementation
      
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
}

// Export singleton instance
export const orchestrationService = new OrchestrationService();

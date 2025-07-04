import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { llmPlanningService } from './llmPlanningService';
import { getBestLLMResponse } from '../utils/llmRouter';
import { logger } from '../utils/logger';

/**
 * Agent memory context for contextual execution and conversation history
 */
export interface AgentMemoryContext {
  userId: string;
  sessionId: string;
  conversationHistory: Array<{
    role: 'user' | 'agent' | 'system';
    content: string;
    timestamp: Date;
  }>;
  entityMemory: Record<string, any>; // e.g., "parent_name": "John", "preferred_method": "telegram"
  lastExecutionTime: string;
  customContext: Record<string, any>;
  // Execution state tracking
  executionState?: {
    currentStep?: number;
    totalSteps?: number;
    status: 'idle' | 'running' | 'completed' | 'failed';
    lastError?: string;
  };
}

export interface Agent {
  id?: string;
  name: string;
  description: string;
  parameters: Record<string, any>;
  dependencies: string[];
  execution_target: 'frontend' | 'backend';
  requires_database: boolean;
  database_type?: 'sqlite' | 'duckdb';
  code: string;
  created_at?: Date;
  updated_at?: Date;
  version: string;
  // New fields for enhanced agent orchestration
  config: AgentConfig;
  secrets: AgentSecrets;
  orchestrator_metadata: OrchestratorMetadata;
  // Phase 1: Add memory context for contextual execution
  memory?: AgentMemoryContext;
}

/**
 * Agent configuration for runtime behavior
 */
export interface AgentConfig {
  // Voice and communication settings
  voice?: {
    provider: 'elevenlabs' | 'openai' | 'azure';
    voice_id?: string;
    language: string;
    speed?: number;
  };
  // Platform-specific settings
  platforms?: {
    telegram?: {
      chat_id?: string;
      parse_mode?: 'HTML' | 'Markdown';
    };
    email?: {
      smtp_server?: string;
      port?: number;
    };
  };
  // Execution preferences
  execution?: {
    timeout_ms?: number;
    retry_count?: number;
    parallel?: boolean;
  };
  // Custom configuration
  [key: string]: any;
}

/**
 * Agent secrets and API keys (should be encrypted)
 * Phase 1: Enhanced with structured credential types for different services
 */
export interface AgentSecrets {
  // Legacy API tokens (backward compatibility)
  telegram_bot_token?: string;
  openai_api_key?: string;
  elevenlabs_api_key?: string;
  oauth_tokens?: Record<string, string>;
  
  // Phase 1: Structured service credentials
  telegram?: {
    botToken: string;
    chatId?: string;
    parseMode?: 'HTML' | 'Markdown';
    webhookUrl?: string;
  };
  twilio?: {
    accountSid: string;
    authToken: string;
    phoneNumber: string;
    webhookUrl?: string;
  };
  email?: {
    smtpServer: string;
    port: number;
    username: string;
    password: string;
    fromAddress: string;
  };
  openai?: {
    apiKey: string;
    organizationId?: string;
    model?: string;
  };
  elevenlabs?: {
    apiKey: string;
    voiceId?: string;
  };
  google?: {
    apiKey?: string;
    clientId?: string;
    clientSecret?: string;
    refreshToken?: string;
  };
  microsoft?: {
    clientId?: string;
    clientSecret?: string;
    tenantId?: string;
    accessToken?: string;
  };
  
  // Custom secrets (maintains flexibility)
  [key: string]: any;
}

/**
 * Orchestrator metadata for multi-agent workflows
 * Phase 1: Enhanced with improved MCP configuration
 */
export interface OrchestratorMetadata {
  // Workflow chain information
  chain_order?: number;
  next_agents?: string[];
  previous_agents?: string[];
  // Conditional execution
  conditions?: {
    success_action?: string;
    failure_action?: string;
    timeout_action?: string;
  };
  // Resource requirements
  resources?: {
    memory_mb?: number;
    cpu_cores?: number;
    network_required?: boolean;
  };
  // Phase 1: Enhanced MCP protocol settings
  mcp?: {
    // Agent identity and role
    persona?: string;           // e.g., "CallAgent", "EmailAgent", "TaskAgent"
    system?: string;            // e.g., "Thinkdrop MCP", "Personal Assistant"
    
    // Context management
    contextKeys?: string[];     // e.g., ["parent_name", "call_message", "preferred_method"]
    instructions?: string;      // Custom per-agent routing/execution hints
    priority?: number;          // Execution priority (1-10, higher = more important)
    
    // Communication protocol
    protocol_version?: string;  // MCP protocol version
    message_format?: 'json' | 'xml';
    encryption?: boolean;
    
    // Agent communication preferences
    communication?: {
      timeout_ms?: number;
      retry_count?: number;
      async_mode?: boolean;
    };
  };
  // Custom metadata
  [key: string]: any;
}

export interface AgentCommunication {
  id?: string;
  from_agent: string;
  to_agent: string;
  data: Record<string, any>;
  created_at?: Date;
}

export interface UserIntent {
  intent: string;
  entities: any[];
  confidence: number;
  clarification_questions: string[];
}

export interface AgentCodeGenResult {
  code: string;
  dependencies: string[];
  executionTarget: string;
  databaseRequirements: string[];
}

export interface AgentOrchestrationResult {
  status: 'created' | 'exists' | 'clarification_needed' | 'error';
  agent?: Agent;
  next_steps?: Array<{ agent: string; reason: string }>;
  plan_summary?: string;
  issues?: string[];
  estimated_success_rate?: number;
  clarification_questions?: string[];
}

export class AgentOrchestrationService {
  private static instance: AgentOrchestrationService;
  private pool: Pool;
  private llmService: any; // Using llmPlanningService and llmRouter

  private constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
    });
    this.llmService = {
      generateAgentCode: this.generateAgentCodeViaLLM.bind(this),
      parseIntent: this.parseIntentViaLLM.bind(this)
    };
  }

  public static getInstance(): AgentOrchestrationService {
    if (!AgentOrchestrationService.instance) {
      AgentOrchestrationService.instance = new AgentOrchestrationService();
    }
    return AgentOrchestrationService.instance;
  }

  /**
   * Parse user intent and determine required agents
   */
  async parseUserIntent(userInput: string): Promise<UserIntent> {
    const prompt = `
Analyze this user request and determine what agents are needed:

User Request: "${userInput}"

Return a JSON response with:
{
  "task": "clear description of what user wants",
  "confidence": 0.0-1.0,
  "required_agents": ["AgentName1", "AgentName2"],
  "clarification_needed": boolean,
  "clarification_questions": ["question1", "question2"],
  "estimated_complexity": "low|medium|high",
  "estimated_success_rate": 0.0-1.0
}

Common agent patterns:
- OpenAppAgent: Opens applications
- FileManagerAgent: File operations
- WebBrowserAgent: Browser automation
- EmailAgent: Email operations
- SystemSettingsAgent: System configuration
- DataExtractionAgent: Extract data from apps/files
- NotificationAgent: Send notifications
- SchedulerAgent: Schedule tasks

If the request is vague, set clarification_needed=true and provide specific questions.
`;

    try {
      const response = await this.llmService.parseUserIntent(userInput);

      return {
        intent: response.intent,
        confidence: response.confidence,
        entities: response.parameters.agents || [],
        clarification_questions: response.clarificationQuestions || []
      };
    } catch (error) {
      logger.error('Error parsing user intent:', error as Error);
      return {
        intent: userInput,
        entities: [],
        confidence: 0.8,
        clarification_questions: []
      };
    }
  }

  /**
   * Check if agent exists in database
   */
  async getAgent(name: string): Promise<Agent | null> {
    try {
      const result = await this.pool.query(
        'SELECT * FROM agents WHERE name = $1',
        [name]
      );
      
      if (result.rowCount && result.rowCount > 0) {
        return result.rows[0] as Agent;
      }

      return null;
    } catch (error) {
      logger.error(`Error getting agent ${name}:`, error as Error);
      return null;
    }
  }

  /**
   * Generate new agent code using LLM
   */
  async generateAgent(agentName: string, description: string, userContext: string): Promise<Agent> {
    const prompt = `
Generate a TypeScript agent for Thinkdrop AI desktop automation:

Agent Name: ${agentName}
Description: ${description}
User Context: ${userContext}

Requirements:
1. Export default object with name, description, parameters, and execute function
2. Use @nut-tree/nut-js for desktop automation when needed
3. Include proper error handling and logging
4. Return structured results
5. Be specific about required dependencies
6. Indicate if backend database is needed

Return JSON with:
{
  "name": "${agentName}",
  "description": "detailed description",
  "parameters": {"param1": "type", "param2": "type"},
  "dependencies": ["@nut-tree/nut-js", "other-deps"],
  "execution_target": "frontend|backend",
  "requires_database": boolean,
  "database_type": "sqlite|duckdb|null",
  "code": "complete TypeScript module code",
  "version": "v1"
}

Example agent structure:
\`\`\`typescript
export default {
  name: '${agentName}',
  description: 'Agent description',
  parameters: {
    appName: 'string',
    timeout: 'number'
  },
  execute: async (params: any) => {
    try {
      // Agent logic here
      return { success: true, result: 'completed' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
\`\`\`

Focus on practical, working code that integrates with existing Thinkdrop infrastructure.
`;

    try {
      const response = await this.llmService.generateAgentCode(agentName, description, []);

      const agentData = {
        name: agentName,
        description: description,
        parameters: {},
        code: response.code,
        dependencies: response.dependencies,
        execution_target: response.executionTarget,
        database_requirements: response.databaseRequirements || [],
        requires_database: (response.databaseRequirements || []).length > 0,
        version: '1.0.0'
      };
      
      // Validate required fields
      if (!agentData.name || !agentData.code) {
        throw new Error('Generated agent missing required fields');
      }

      // Create agent with all required fields
      const agent: Agent = {
        ...agentData,
        id: uuidv4(),
        created_at: new Date(),
        updated_at: new Date(),
        // Provide default values for new required fields
        config: {},
        secrets: {},
        orchestrator_metadata: {},
      };
      
      return agent;
    } catch (error) {
      logger.error(`Error generating agent ${agentName}:`, error as Error);
      throw new Error(`Failed to generate agent: ${(error as Error).message}`);
    }
  }

  /**
   * Store agent in database
   */
  async storeAgent(agent: Agent): Promise<Agent> {
    try {
      const result = await this.pool.query(`
        INSERT INTO agents (
          id, name, description, parameters, dependencies, 
          execution_target, requires_database, database_type, 
          code, version, config, secrets, orchestrator_metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (name) DO UPDATE SET
          description = EXCLUDED.description,
          parameters = EXCLUDED.parameters,
          dependencies = EXCLUDED.dependencies,
          execution_target = EXCLUDED.execution_target,
          requires_database = EXCLUDED.requires_database,
          database_type = EXCLUDED.database_type,
          code = EXCLUDED.code,
          version = EXCLUDED.version,
          config = EXCLUDED.config,
          secrets = EXCLUDED.secrets,
          orchestrator_metadata = EXCLUDED.orchestrator_metadata,
          updated_at = NOW()
        RETURNING *
      `, [
        agent.id || uuidv4(),
        agent.name,
        agent.description,
        JSON.stringify(agent.parameters),
        agent.dependencies,
        agent.execution_target,
        agent.requires_database,
        agent.database_type,
        agent.code,
        agent.version,
        JSON.stringify(agent.config),
        JSON.stringify(agent.secrets),
        JSON.stringify(agent.orchestrator_metadata)
      ]);

      return result.rows[0] as Agent;
    } catch (error) {
      logger.error(`Error storing agent ${agent.name}:`, error as Error);
      throw new Error(`Failed to store agent: ${(error as Error).message}`);
    }
  }

  /**
   * Get all agents
   */
  async getAllAgents(): Promise<Agent[]> {
    try {
      const result = await this.pool.query('SELECT * FROM agents ORDER BY created_at DESC');
      return result.rows as Agent[];
    } catch (error) {
      logger.error('Error getting all agents:', error as Error);
      return [];
    }
  }

  /**
   * Log agent communication for structured data passing
   */
  async logAgentCommunication(from: string, to: string, data: Record<string, any>): Promise<void> {
    try {
      await this.pool.query(`
        INSERT INTO agent_communications (from_agent, to_agent, data)
        VALUES ($1, $2, $3)
      `, [from, to, JSON.stringify(data)]);
    } catch (error) {
      logger.error('Error logging agent communication:', error as Error);
    }
  }

  /**
   * Generate agent code via LLM
   */
  private async generateAgentCodeViaLLM(name: string, description: string, dependencies: string[]): Promise<AgentCodeGenResult> {
    try {
      const prompt = `Generate TypeScript code for an agent named "${name}" with description: "${description}". Dependencies: ${dependencies.join(', ')}. Return JSON with: code, dependencies, executionTarget, databaseRequirements.`;
      
      const response = await getBestLLMResponse(prompt);
      
      // Parse the LLM response to extract agent code
      const result: AgentCodeGenResult = {
        code: response || `// Generated agent: ${name}\nconsole.log('${description}');`,
        dependencies: dependencies,
        executionTarget: 'node',
        databaseRequirements: []
      };
      
      return result;
    } catch (error) {
      logger.error('Error generating agent code via LLM:', error as Error);
      throw new Error(`Failed to generate agent code: ${(error as Error).message}`);
    }
  }

  /**
   * Parse user intent via LLM
   */
  private async parseIntentViaLLM(request: string): Promise<UserIntent> {
    try {
      const prompt = `Parse this user request and extract intent: "${request}". Return JSON with: intent, entities, confidence, clarificationQuestions.`;
      
      const response = await getBestLLMResponse(prompt);
      
      // Parse the LLM response to extract intent
      const result: UserIntent = {
        intent: 'general_request',
        entities: [],
        confidence: 0.8,
        clarification_questions: []
      };
      
      return result;
    } catch (error) {
      logger.error('Error parsing intent via LLM:', error as Error);
      throw new Error(`Failed to parse intent: ${(error as Error).message}`);
    }
  }

  /**
   * Get agent communications
   */
  async getAgentCommunications(agentName?: string): Promise<AgentCommunication[]> {
    try {
      let query = 'SELECT * FROM agent_communications';
      let params: any[] = [];

      if (agentName) {
        query += ' WHERE from_agent = $1 OR to_agent = $1';
        params = [agentName];
      }

      query += ' ORDER BY created_at DESC LIMIT 100';

      const result = await this.pool.query(query, params);
      return result.rows as AgentCommunication[];
    } catch (error) {
      logger.error('Error getting agent communications:', error as Error);
      return [];
    }
  }

  /**
   * Main orchestration method - handles user request end-to-end
   */
  async orchestrateRequest(userInput: string): Promise<AgentOrchestrationResult> {
    try {
      // Parse user intent
      const intent = await this.parseUserIntent(userInput);

      // Check if clarification is needed
      if (intent.clarification_questions.length > 0) {
        return {
          status: 'clarification_needed',
          clarification_questions: intent.clarification_questions,
          estimated_success_rate: 0.5,
        };
      }

      // Process required agents
      const results: AgentOrchestrationResult[] = [];
      const nextSteps: Array<{ agent: string; reason: string }> = [];

      for (const agentName of intent.entities) {
        // Check if agent exists
        let agent = await this.getAgent(agentName);

        if (!agent) {
          // Generate new agent
          agent = await this.generateAgent(agentName, intent.intent, userInput);
          agent = await this.storeAgent(agent);

          results.push({
            status: 'created',
            agent,
          });
        } else {
          results.push({
            status: 'exists',
            agent,
          });
        }

        // Determine next steps based on agent requirements
        if (agent.requires_database) {
          nextSteps.push({
            agent: `${agentName}DatabaseSetup`,
            reason: `${agentName} requires ${agent.database_type} database setup`,
          });
        }

        if (agent.execution_target === 'backend') {
          nextSteps.push({
            agent: `${agentName}BackendService`,
            reason: `${agentName} requires backend service deployment`,
          });
        }
      }

      // Return primary result (first agent created/found)
      const primaryResult = results[0];
      if (primaryResult) {
        return {
          ...primaryResult,
          next_steps: nextSteps,
          plan_summary: `Orchestrated ${intent.entities.length} agents for: ${intent.intent}`,
          estimated_success_rate: 0.8,
        };
      }

      return {
        status: 'error',
        issues: ['No agents could be processed'],
        estimated_success_rate: 0,
      };

    } catch (error) {
      logger.error('Error orchestrating request:', error as Error);
      return {
        status: 'error',
        issues: [(error as Error).message],
        estimated_success_rate: 0,
      };
    }
  }

  /**
   * Delete agent
   */
  async deleteAgent(name: string): Promise<boolean> {
    try {
      const result = await this.pool.query('DELETE FROM agents WHERE name = $1', [name]);
      return result.rowCount ? result.rowCount > 0 : false;
    } catch (error) {
      logger.error(`Error deleting agent ${name}:`, error as Error);
      return false;
    }
  }
}

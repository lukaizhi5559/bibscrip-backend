/**
 * Prompt Builder Service
 * Centralized prompt templates and builder logic for all LLM tasks
 */

export interface PromptOptions {
  userQuery: string;
  context?: any;
  metadata?: Record<string, any>;
}

export interface AgentFormat {
  name: string;
  description: string;
  schema: Record<string, any>;
  dependencies: string[];
  execution_target: 'frontend' | 'backend';
  requires_database: boolean;
  database_type?: 'sqlite' | 'duckdb' | 'postgresql';
  code: string;
}

export const AGENT_FORMAT_TEMPLATE: AgentFormat = {
  name: 'AgentName',
  description: 'Description of task',
  schema: {
    type: 'object',
    properties: {
      // Input parameters schema
    },
    required: []
  },
  dependencies: ['npm-module'],
  execution_target: 'frontend',
  requires_database: false,
  database_type: undefined,
  code: `
export default {
  name: 'AgentName',
  description: 'Description of task',
  schema: { /* input params schema */ },
  dependencies: ["npm-module"],
  execution_target: "frontend",
  requires_database: false,
  async execute(params, context) {
    // Agent implementation
    return { success: true, result: 'Task completed' };
  }
}
  `.trim()
};

/**
 * Build prompts for different LLM tasks
 */
export function buildPrompt(task: 'intent' | 'generate_agent' | 'orchestrate' | 'ask', options: PromptOptions): string {
  const { userQuery, context, metadata } = options;

  switch (task) {
    case 'intent':
      return buildIntentPrompt(userQuery, context);
    
    case 'generate_agent':
      return buildGenerateAgentPrompt(userQuery, context);
    
    case 'orchestrate':
      return buildOrchestratePrompt(userQuery, context);
    
    case 'ask':
      return buildAskPrompt(userQuery, context);
    
    default:
      throw new Error(`Unknown prompt task: ${task}`);
  }
}

/**
 * Intent Classification Prompt
 */
function buildIntentPrompt(userQuery: string, context?: any): string {
  return `
You are an intelligent agent classifier for Thinkdrop AI. Analyze the user's request and determine what type of automation or assistance they need.

User Request: "${userQuery}"

Instructions:
1. Describe the user's goal in a single sentence
2. Identify which types of agents would be needed
3. Classify the complexity level (simple, moderate, complex)
4. Suggest the execution approach

Respond in this JSON format:
{
  "summary": "Brief description of the user's goal",
  "intent_type": "automation" | "information" | "analysis" | "creation",
  "required_agents": [
    {
      "type": "agent_type",
      "reason": "why this agent is needed"
    }
  ],
  "complexity": "simple" | "moderate" | "complex",
  "execution_approach": "single_agent" | "multi_agent_sequence" | "multi_agent_parallel",
  "confidence": 0.95
}
  `.trim();
}

/**
 * Agent Generation Prompt
 */
function buildGenerateAgentPrompt(userQuery: string, context?: any): string {
  const agentFormatString = JSON.stringify(AGENT_FORMAT_TEMPLATE, null, 2);
  
  return `
You are an expert agent developer for Thinkdrop AI. Create a modular, reusable agent based on the user's requirements.

User Request: "${userQuery}"

Requirements:
- Use the exact agent format structure provided below
- Write clean, executable TypeScript code
- Include all necessary dependencies
- Choose appropriate execution_target (frontend for UI automation, backend for API/data processing)
- Implement a robust execute() method
- Handle errors gracefully
- Include proper TypeScript types

Agent Format Structure:
${agentFormatString}

Instructions:
1. Analyze the user's request to understand the specific task
2. Determine the appropriate agent name (PascalCase, descriptive)
3. List all required npm dependencies
4. Choose execution target based on the task type
5. Write the complete agent implementation
6. Ensure the code is production-ready

Respond with a valid JSON object matching the agent format exactly.
  `.trim();
}

/**
 * Orchestration Planning Prompt
 */
function buildOrchestratePrompt(userQuery: string, context?: any): string {
  return `
You are a multi-agent orchestration planner for Thinkdrop AI. Plan how multiple agents should work together to fulfill the user's request.

User Request: "${userQuery}"

Instructions:
1. Break down the task into logical steps
2. Identify which agents are needed for each step
3. Define the data flow between agents
4. Identify potential risks and dependencies
5. Estimate success probability
6. Suggest fallback strategies

Respond in this JSON format:
{
  "task_breakdown": [
    {
      "step": 1,
      "description": "What needs to be done",
      "agent_needed": "AgentType",
      "inputs": ["required inputs"],
      "outputs": ["expected outputs"]
    }
  ],
  "agents": [
    {
      "name": "AgentName",
      "type": "agent_type",
      "reason": "why this agent is needed",
      "execution_order": 1
    }
  ],
  "data_flow": "Agent1 → Agent2 → Agent3",
  "dependencies": [
    {
      "type": "permission" | "oauth" | "api_key" | "system_access",
      "description": "what is required"
    }
  ],
  "risks": [
    {
      "risk": "potential issue",
      "mitigation": "how to handle it",
      "severity": "low" | "medium" | "high"
    }
  ],
  "estimated_success_rate": 0.85,
  "execution_time_estimate": "2-5 minutes",
  "fallback_strategies": ["alternative approaches if primary fails"]
}
  `.trim();
}

/**
 * Bible/Ask Prompt (Enhanced from existing /ask functionality)
 */
function buildAskPrompt(userQuery: string, context?: any): string {
  const { verses, ragSources, preferredTranslation } = context || {};
  
  let prompt = `
You are a knowledgeable Bible study assistant and theological expert. Provide thoughtful, accurate, and helpful responses to questions about the Bible, theology, Christian faith, and related topics.

User Question: "${userQuery}"
  `.trim();

  // Add Bible verses if available
  if (verses && verses.length > 0) {
    prompt += `\n\nRelevant Bible Verses:\n`;
    verses.forEach((verse: any) => {
      prompt += `- ${verse.reference} (${verse.translationName}): "${verse.text}"\n`;
    });
  }

  // Add RAG context if available
  if (ragSources && ragSources.length > 0) {
    prompt += `\n\nRelevant Context Sources:\n`;
    ragSources.forEach((source: any, index: number) => {
      prompt += `${index + 1}. ${source.source} (Score: ${source.score}): ${source.reference}\n`;
    });
  }

  prompt += `\n\nInstructions:
- Provide a comprehensive, thoughtful response
- Reference relevant Bible verses when appropriate
- Use ${preferredTranslation || 'ESV'} translation when citing verses
- Be respectful of different theological perspectives
- If the question is unclear, ask for clarification
- Ground your response in biblical truth and sound theology
- Use clear, accessible language

Response:`;

  return prompt;
}

/**
 * Get prompt metadata for logging and debugging
 */
export function getPromptMetadata(task: string, userQuery: string): Record<string, any> {
  return {
    task_type: task,
    query_length: userQuery.length,
    timestamp: new Date().toISOString(),
    prompt_version: '1.0'
  };
}

/**
 * Validate prompt options
 */
export function validatePromptOptions(task: string, options: PromptOptions): void {
  if (!options.userQuery || typeof options.userQuery !== 'string') {
    throw new Error('userQuery is required and must be a string');
  }

  if (options.userQuery.trim().length === 0) {
    throw new Error('userQuery cannot be empty');
  }

  if (options.userQuery.length > 10000) {
    throw new Error('userQuery is too long (max 10000 characters)');
  }
}

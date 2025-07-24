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
  bootstrap: string;
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
  bootstrap: `async bootstrap(config, context) {
    // Handle own DB setup, no more main.cjs DB code
    this.db = await this.initializeDuckDB(config.dbPath);
  }
  `.trim(),
  code: `
  async execute(input: any, context: any) {
    // Agent implementation
    return { success: true, result: 'Task completed' };
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
  const requirements = Array.isArray(context?.requirements) ? context.requirements : (context?.requirements ? [context.requirements] : []);
  const name = context?.name || 'GeneratedAgent';
  
  return `You are an expert agent developer. Create a TypeScript agent based on these requirements.

User Request: "${userQuery}"
Agent Name: ${name}
Requirements: ${requirements.join(', ')}

Analyze the user request and determine what services, APIs, or platforms are needed. Then generate appropriate secrets, config, and dependencies.

SPECIAL INSTRUCTIONS FOR STARTUP/AUTOMATION TASKS:
- If the request involves "startup", "boot", "automatically when computer starts", create code that sets up OS-specific startup automation
- For macOS: Use launchctl and plist files, or Login Items
- For Windows: Use startup folder, registry, or Task Scheduler
- For Linux: Use systemd, cron @reboot, or autostart files
- Include OS detection and appropriate implementation for each platform
- Don't just open the application once - set up persistent startup automation

EXECUTION TARGET RULES:
- ALWAYS use "execution_target": "frontend" for personal automation, desktop tasks, file management, startup automation, and user-specific workflows
- Only use "execution_target": "backend" for server-side APIs, database operations, or multi-user shared services
- For this request, use "frontend" unless it's explicitly a server/API service

CRITICAL JSON FORMATTING RULES:
- You MUST return valid JSON - no syntax errors allowed
- In the "code" field, you MUST properly escape all quotes and backslashes
- Use double quotes for JSON strings, escape internal double quotes as \\" 
- Use \\\\n for newlines in code strings
- Use \\\\\\\\ for literal backslashes in code
- Test your JSON mentally before responding

Respond with ONLY a valid JSON object in this exact format:
{
  "name": "${name}",
  "description": "Brief description of what this agent does",
  "code": "export default {\\n  name: '${name}',\\n  description: 'Agent description',\\n  async execute(params, context) {\\n    try {\\n      // Implementation here\\n      console.log('Executing ${name}...');\\n      return { success: true, result: 'Task completed' };\\n    } catch (error) {\\n      return { success: false, error: error.message };\\n    }\\n  }\\n};",
  "dependencies": ["axios"],
  "execution_target": "frontend",
  "requires_database": false,
  "config": {},
  "secrets": {},
  "orchestrator_metadata": {
    "chain_order": 1,
    "next_agents": [],
    "resources": { "memory_mb": 256, "network_required": true }
  }
}

IMPORTANT GUIDELINES:
- EXECUTION TARGET: Use "frontend" for ALL personal automation, desktop tasks, file operations, startup automation, and user-specific workflows. Only use "backend" for server APIs or multi-user services.
- JSON VALIDATION: Your response must be parseable by JSON.parse() - no exceptions!
- CODE ESCAPING: All quotes, backslashes, and newlines in the code field must be properly escaped
- Only include secrets that are actually needed for the specific task
- Use descriptive secret names that match the service (e.g., "github_token", "stripe_secret_key")
- Config should contain settings relevant to the agent's functionality
- Dependencies should only include packages actually used in the code
- Make the code implementation functional and specific to the user's request

Return ONLY the JSON object, no markdown code blocks or other text.`;
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
 * Ask Prompt (Fitted for Thinkdrop AI - General Purpose Assistant)
 */
function buildAskPrompt(userQuery: string, context?: any): string {
  const { ragSources, knowledgeBase, userPreferences, responseLength = 'medium' } = context || {};
  
  let prompt = `
You are Thinkdrop AI, an intelligent, helpful, and discerning assistant. You answer with clarity, humility, and wisdom — grounded in Biblical worldview and traditional values.

You are capable of researching, analyzing, problem-solving, and explaining complex topics across technology, philosophy, culture, personal productivity, business, theology, and everyday life. You are careful to respect truth, reason, and integrity in all responses.

User Question: "${userQuery}"
  `.trim();

  // Add RAG context if available
  if (ragSources && ragSources.length > 0) {
    prompt += `\n\nRelevant Context Sources:\n`;
    ragSources.forEach((source: any, index: number) => {
      prompt += `${index + 1}. ${source.source} (Score: ${source.score}): ${source.reference}\n`;
    });
  }

  // Add knowledge base context if available
  if (knowledgeBase && knowledgeBase.length > 0) {
    prompt += `\n\nRelevant Knowledge Base:\n`;
    knowledgeBase.forEach((item: any, index: number) => {
      prompt += `${index + 1}. ${item.title}: ${item.summary}\n`;
    });
  }

  // Add response length guidance based on context
  let lengthGuidance = '';
  switch (responseLength) {
    case 'short':
      lengthGuidance = '- Keep your response concise and to the point (1-2 paragraphs max)\n- Focus on the most essential information\n';
      break;
    case 'medium':
      lengthGuidance = '- Provide a balanced response (2-4 paragraphs)\n- Include key details without being overly verbose\n';
      break;
    case 'long':
      lengthGuidance = '- Provide a comprehensive, detailed response\n- Include thorough explanations and examples\n';
      break;
  }

  prompt += `\n\nInstructions:
${lengthGuidance}- Use clear, accessible language
- Be accurate and factual
- If the question is unclear, ask for clarification
- Provide actionable insights when appropriate
- Consider multiple perspectives when relevant
- Structure your response logically

Response:`;

  return prompt;
}

/* ARCHIVED: Bible/Ask Prompt (Enhanced from existing /ask functionality)
 * Commented out for future use if Bible functionality is needed
 *
function buildBibleAskPrompt(userQuery: string, context?: any): string {
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
*/

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

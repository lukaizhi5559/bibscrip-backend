import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildRetrievePrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a RETRIEVE intent. Your goal: ${stepData.description}

DATA KEY: ${stepData.query || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Data retrieved successfully'}

=== AVAILABLE ACTIONS ===
1. retrieve - Retrieve stored data by key
2. screenshot - Capture state
3. end - Signal completion

=== STORED DATA ===
${context.storedData ? JSON.stringify(context.storedData, null, 2) : 'No stored data available'}

=== DECISION TREE ===

This is a simple intent - retrieve the data and complete.

1. Retrieve the data
   → retrieve with key
   → screenshot (optional)
   → end

=== OUTPUT FORMAT ===
{
  "type": "retrieve|screenshot|end",
  "key": "string (key to retrieve)",
  "reasoning": "brief explanation"
}

Example:
{
  "type": "retrieve",
  "key": "jira_ticket_id",
  "reasoning": "Retrieving ticket ID stored from previous capture step"
}

Execute the next action now.`;
}

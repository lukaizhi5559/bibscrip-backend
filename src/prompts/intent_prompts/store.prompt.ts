import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildStorePrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a STORE intent. Your goal: ${stepData.description}

DATA TO STORE: ${stepData.query || 'From context'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Data stored successfully'}

=== AVAILABLE ACTIONS ===
1. store - Store data with a key
2. screenshot - Capture state
3. end - Signal completion

=== DECISION TREE ===

This is a simple intent - just store the data and complete.

1. Store the data
   → store with key and value
   → screenshot (optional)
   → end

=== STORAGE KEYS ===
Use descriptive, snake_case keys:
- "user_input"
- "api_response"
- "extracted_data"
- "previous_state"

=== OUTPUT FORMAT ===
{
  "type": "store|screenshot|end",
  "key": "string (descriptive key)",
  "value": any (data to store),
  "reasoning": "brief explanation"
}

Example:
{
  "type": "store",
  "key": "user_selection",
  "value": "Option A",
  "reasoning": "Storing user's menu selection for later use"
}

Execute the next action now.`;
}

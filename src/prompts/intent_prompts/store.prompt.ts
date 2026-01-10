import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildStorePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
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


${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s) in this step:

${actionHistory.map((action: any, idx: number) => `${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
   ${action.metadata?.reasoning ? `- Your reasoning: ${action.metadata.reasoning}` : ''}
`).join('')}
=== SELF-CORRECTION INSTRUCTIONS ===

**CRITICAL: Learn from previous attempts!**

1. **Analyze Failures** - If an action failed, WHY? Wrong element? Wrong timing? Wrong action type?
2. **Adjust Your Approach** - Be more specific, add waits, try different actions
3. **Avoid Repeating Mistakes** - DO NOT repeat failed actions with same parameters
4. **Progressive Refinement** - Each attempt should be smarter than the last
5. **When to Give Up** - After 3 identical failures → try different approach; After 5 total failures → end with explanation

**Remember: You are in an iterative loop. Use feedback from previous attempts to improve!**
` : ''}


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

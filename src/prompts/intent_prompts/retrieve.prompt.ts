import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildRetrievePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
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

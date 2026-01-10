import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildExtractPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing an EXTRACT intent. Your goal: ${stepData.description}

ELEMENT TO EXTRACT: ${stepData.element || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Data extracted and stored'}

=== AVAILABLE ACTIONS ===
1. screenshot - Capture current state
2. ocr - Extract text from screenshot
3. store - Store extracted data
4. findAndClick - Click to reveal data if needed
5. end - Signal completion

=== DECISION TREE ===

1. Is target data visible?
   NO → findAndClick to reveal → waitForElement → Continue
   YES → Continue to step 2

2. Extract the data
   → screenshot (capture current state)
   → ocr (extract text from screenshot)
   → store (save extracted data with key)
   → end

=== TYPICAL FLOW ===
1. screenshot - Capture screen with target data
2. ocr - Extract all text
3. store - Save specific data (e.g., ticket ID, error message)
4. end

=== STORAGE KEYS ===
Use descriptive keys like:
- "ticket_id" for Jira ticket numbers
- "error_message" for error text
- "table_data" for table contents
- "form_values" for form data


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
  "type": "screenshot|ocr|store|findAndClick|end",
  "key": "string (for store)",
  "value": "any (for store)",
  "region": { "x": number, "y": number, "width": number, "height": number } (optional for ocr),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

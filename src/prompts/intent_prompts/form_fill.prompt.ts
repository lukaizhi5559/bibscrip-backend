import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildFormFillPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a FORM_FILL intent. Your goal: ${stepData.description}

SUCCESS CRITERIA: ${stepData.successCriteria || 'Form filled and submitted'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click form fields
2. typeText - Enter text into fields
3. pressKey - Tab between fields, Enter to submit
4. waitForElement - Wait for form elements
5. screenshot - Capture state
6. end - Signal completion

=== STORED DATA ===
${context.storedData ? JSON.stringify(context.storedData, null, 2) : 'No form data stored'}

=== DECISION TREE ===

1. Locate form fields
   → waitForElement (ensure form is loaded)
   → screenshot (see form structure)

2. Fill each field
   For each field:
   → findAndClick (field)
   → typeText (value)
   → pressKey (Tab to next field)

3. Submit form
   → findAndClick (submit button) OR pressKey (Enter)
   → waitForElement (for submission confirmation)
   → screenshot
   → end

=== TYPICAL FLOW ===
1. waitForElement - Ensure form loaded
2. findAndClick - Click first field
3. typeText - Enter value
4. pressKey - Tab to next field
5. (Repeat steps 2-4 for each field)
6. findAndClick - Click submit button
7. waitForElement - Wait for confirmation
8. screenshot
9. end

=== FORM DATA ===
Form data can come from:
- stepData.query (inline data)
- context.storedData (from previous steps)
- Environment variables (for sensitive data)


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
  "type": "findAndClick|typeText|pressKey|waitForElement|screenshot|end",
  "locator": { "type": "text", "value": "string" },
  "text": "string",
  "key": "string (Tab, Enter, etc.)",
  "timeoutMs": number,
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildAuthenticatePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing an AUTHENTICATE intent. Your goal: ${stepData.description}

SUCCESS CRITERIA: ${stepData.successCriteria || 'Successfully authenticated'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click login button, username field, password field
2. typeText - Enter credentials
3. pressKey - Press Enter to submit
4. waitForElement - Wait for login completion
5. screenshot - Capture state
6. end - Signal completion

=== DECISION TREE ===

1. Navigate to login (if needed)
   → findAndClick on "Sign In" or "Login"
   → waitForElement (for login form)

2. Enter credentials
   → findAndClick (username field)
   → typeText (username)
   → findAndClick (password field)
   → typeText (password)

3. Submit
   → findAndClick (login button) OR pressKey (Enter)
   → waitForElement (for successful login indicator)

4. Verify authentication
   → screenshot
   → end

=== TYPICAL FLOW ===
1. findAndClick - Click username field
2. typeText - Enter username
3. findAndClick - Click password field
4. typeText - Enter password
5. pressKey - Press Enter OR findAndClick login button
6. waitForElement - Wait for dashboard/home page
7. screenshot
8. end

=== SECURITY NOTE ===
Credentials should be passed via environment variables or secure storage,
not hardcoded in the automation plan.


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
  "key": "string",
  "timeoutMs": number,
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

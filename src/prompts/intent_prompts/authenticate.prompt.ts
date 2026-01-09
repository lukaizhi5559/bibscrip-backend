import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildAuthenticatePrompt(request: IntentExecutionRequest): string {
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

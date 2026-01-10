/**
 * Navigate Intent Prompt
 * Purpose: Navigate to URL or focus application
 * Available Actions: focusApp, openUrl, waitForElement, screenshot, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildNavigatePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  const os = context.os || 'darwin';
  
  return `You are executing a NAVIGATE intent. Your goal: ${stepData.description}

=== CURRENT STATE (INPUT SCREENSHOT) ===
Analyze the screenshot to understand:
- What app/page is currently active?
- Are we already at the target destination?
- What needs to happen to reach the target?

=== TARGET ===
${stepData.target || 'Not specified - determine from description'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'Target destination visible and loaded'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. focusApp: { "type": "focusApp", "appName": "Real App Name" }
   - Use REAL app names from screenshot Dock/taskbar
   - Examples: "Google Chrome", "Safari", "Warp", "Windsurf"
   - NEVER use generic names like "Browser App"

2. openUrl: { "type": "openUrl", "url": "https://example.com" }
   - Navigate to URL in active browser
   - Only use if URL navigation needed

3. waitForElement: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 5000 }
   - Wait for page/element to load

4. screenshot: { "type": "screenshot" }
   - Take screenshot to verify state

5. end: { "type": "end", "reason": "Navigation complete: [summary]" }
   - Signal step completion

=== DECISION TREE ===

IF already at target destination:
  → screenshot → end

IF target is URL AND current app is browser:
  → openUrl → waitForElement → screenshot → end

IF target is URL AND current app is NOT browser:
  → focusApp (browser) → openUrl → waitForElement → screenshot → end

IF target is desktop app:
  → focusApp → waitForElement → screenshot → end

=== CONTEXT ===
- OS: ${os}
- Active App: ${context.activeApp || 'Unknown'}
- Active URL: ${context.activeUrl || 'None'}
- Max Attempts: ${stepData.maxAttempts || 10}



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

1. **Analyze Failures**
   - If an action failed, WHY did it fail?
   - Was the element description too vague?
   - Was the timing wrong (element not loaded)?
   - Did you use the wrong action type?

2. **Adjust Your Approach**
   - If findAndClick failed → Try waitForElement first or be more specific
   - If element description was vague → Add more visual details
   - If timing was wrong → Add pause before retry
   - If action type was wrong → Choose different action

3. **Avoid Repeating Mistakes**
   - DO NOT repeat the same failed action with identical parameters
   - DO NOT keep trying if you've failed 3+ times → End with clear explanation
   - DO NOT ignore error messages → Use them to adjust

4. **Progressive Refinement**
   - Each attempt should be smarter than the last
   - Use information from previous screenshots
   - Adjust based on what you learned

5. **When to Give Up**
   - After 3 identical failures → Try different approach
   - After 5 total failures → End with explanation
   - If element truly doesn't exist → End immediately

**Remember: You are in an iterative loop. Each action you return will be executed, and you'll see the result in the next iteration. Use this feedback to improve!**
` : ''}

Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "• What I see: [current state]\n• Goal: [what needs to happen]\n• Action: [chosen action]\n• Expected: [expected result]",
  ...action-specific fields
}

Analyze the screenshot and return your next action:`;
}

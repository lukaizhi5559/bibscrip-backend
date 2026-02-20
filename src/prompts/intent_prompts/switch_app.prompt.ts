import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildSwitchAppPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a SWITCH_APP intent. Your goal: ${stepData.description}

TARGET APPLICATION: ${stepData.target || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Application is focused and visible'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions:
1. focusApp - Focus/switch to an application by name
2. waitForElement - Wait for UI element to appear
3. screenshot - Capture current state
4. end - Signal step completion

=== CURRENT STATE ===
Active App: ${context.activeApp || 'Unknown'}
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Is target app FRONTMOST and FOCUSED (not just visible)?
   - Check screenshot: Is the target app's UI taking up most of the screen?
   - Is the target app's window in the foreground with focus indicators?
   - Can you see the target app's main interface ready for input?
   
   YES (app is frontmost) → screenshot → end
   NO (app not frontmost or just visible in background) → Continue to step 2

2. Focus the target application
   → focusApp with target app name
   → waitForElement (brief wait for app to focus)
   → screenshot (verify app is NOW frontmost)
   → end

=== CRITICAL RULES ===
- **FRONTMOST vs VISIBLE**: An app visible in a tab/window is NOT the same as being frontmost and focused
- **Example**: If ChatGPT is visible in a Chrome tab but Amazon is the active page, ChatGPT is NOT frontmost
- Use exact application names (e.g., "Google Chrome", "Warp", "Windsurf")
- ONLY use 'end' action when the target app's UI is FRONTMOST and ready for input
- NEVER use 'end' action for failures - the system will handle max attempts
- Keep trying different approaches until you succeed or reach max attempts
- If target is a website (like ChatGPT), verify the correct page is active, not just the browser


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
5. **Keep Trying** - Try different variations of the app name, check if it's a website vs desktop app
6. **NEVER give up** - The system will ask the user for help if max attempts is reached

**Remember: You are in an iterative loop. Use feedback from previous attempts to improve!**
` : ''}


=== OUTPUT FORMAT ===
Return ONLY valid JSON with this structure:
{
  "type": "focusApp|waitForElement|screenshot|end",
  "appName": "string (for focusApp)",
  "timeoutMs": number (for waitForElement),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

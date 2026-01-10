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

1. Is target app already active?
   YES → screenshot → end
   NO → Continue to step 2

2. Focus the target application
   → focusApp with target app name
   → waitForElement (brief wait for app to focus)
   → screenshot (verify app is focused)
   → end

=== CRITICAL RULES ===
- Use exact application names (e.g., "Google Chrome", "Warp", "Windsurf")
- Always end with screenshot → end
- If app doesn't exist, still call end (don't loop forever)


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
Return ONLY valid JSON with this structure:
{
  "type": "focusApp|waitForElement|screenshot|end",
  "appName": "string (for focusApp)",
  "timeoutMs": number (for waitForElement),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

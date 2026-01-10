import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildCloseAppPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a CLOSE_APP intent. Your goal: ${stepData.description}

TARGET: ${stepData.target || 'Current application/tab'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Application or tab is closed'}

=== AVAILABLE ACTIONS ===
1. pressKey - Press keyboard shortcut (Cmd+W for tab, Cmd+Q for app)
2. findAndClick - Click close button
3. pause - Brief wait after closing
4. screenshot - Capture state
5. end - Signal completion

=== CURRENT STATE ===
Active App: ${context.activeApp || 'Unknown'}
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Determine what to close
   - Close tab: Cmd+W (darwin) or Ctrl+W (win32)
   - Close window: Cmd+W (darwin) or Alt+F4 (win32)
   - Quit app: Cmd+Q (darwin) or Alt+F4 (win32)

2. Execute close action
   → pressKey with appropriate shortcut
   → pause (500ms)
   → screenshot
   → end

=== KEYBOARD SHORTCUTS ===
macOS:
- Close tab/window: Cmd+W
- Quit app: Cmd+Q

Windows/Linux:
- Close window: Alt+F4
- Close tab: Ctrl+W


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
  "type": "pressKey|findAndClick|pause|screenshot|end",
  "key": "string (for pressKey)",
  "modifiers": ["string"] (for pressKey),
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

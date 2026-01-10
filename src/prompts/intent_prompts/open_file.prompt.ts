import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildOpenFilePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing an OPEN_FILE intent. Your goal: ${stepData.description}

FILE PATH: ${stepData.target || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'File opened in application'}

=== AVAILABLE ACTIONS ===
1. focusApp - Focus application to open file in
2. pressKey - Use Cmd+O (darwin) or Ctrl+O (win32) for Open dialog
3. typeText - Type file path
4. waitForElement - Wait for file to open
5. screenshot - Capture state
6. end - Signal completion

=== CURRENT STATE ===
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Focus target application
   → focusApp (if specific app needed)

2. Open file dialog
   → pressKey (Cmd+O or Ctrl+O)
   → waitForElement (for open dialog)

3. Select file
   → typeText (file path)
   → pressKey (Enter)

4. Wait for file to open
   → waitForElement
   → screenshot
   → end

=== KEYBOARD SHORTCUTS ===
macOS: Cmd+O
Windows/Linux: Ctrl+O


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
  "type": "focusApp|pressKey|typeText|waitForElement|screenshot|end",
  "appName": "string (for focusApp)",
  "key": "string",
  "modifiers": ["string"],
  "text": "string (file path)",
  "timeoutMs": number,
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

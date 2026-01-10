import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildSaveFilePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a SAVE_FILE intent. Your goal: ${stepData.description}

SAVE PATH: ${stepData.target || 'Default location'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'File saved successfully'}

=== AVAILABLE ACTIONS ===
1. pressKey - Use Cmd+S (darwin) or Ctrl+S (win32)
2. typeText - Type save path if needed
3. waitForElement - Wait for save dialog/completion
4. screenshot - Capture state
5. end - Signal completion

=== CURRENT STATE ===
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Trigger save
   → pressKey (Cmd+S or Ctrl+S)
   → waitForElement (for save dialog if appears)

2. Specify path (if needed)
   → typeText (save path)
   → pressKey (Enter)

3. Wait for save completion
   → pause (500ms)
   → screenshot
   → end

=== KEYBOARD SHORTCUTS ===
macOS: Cmd+S
Windows/Linux: Ctrl+S

=== TYPICAL FLOW ===
1. pressKey - Cmd+S or Ctrl+S
2. pause (500ms for save)
3. screenshot
4. end


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
  "type": "pressKey|typeText|waitForElement|screenshot|end",
  "key": "string",
  "modifiers": ["string"],
  "text": "string (save path)",
  "timeoutMs": number,
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

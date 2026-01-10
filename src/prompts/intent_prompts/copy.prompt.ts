import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildCopyPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a COPY intent. Your goal: ${stepData.description}

ELEMENT TO COPY: ${stepData.element || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Content copied to clipboard'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click/select the element to copy
2. pressKey - Use Cmd+C (darwin) or Ctrl+C (win32)
3. pause - Wait for copy to complete
4. screenshot - Capture state
5. end - Signal completion

=== CURRENT STATE ===
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Select the content to copy
   → findAndClick on element (to focus/select)
   → pause (200ms)

2. Copy to clipboard
   → pressKey with Cmd+C (darwin) or Ctrl+C (win32)
   → pause (200ms for clipboard)
   → screenshot
   → end

=== KEYBOARD SHORTCUTS ===
macOS: Cmd+C
Windows/Linux: Ctrl+C

=== TYPICAL FLOW ===
1. findAndClick - Select/focus element
2. pause (200ms)
3. pressKey - Cmd+C or Ctrl+C
4. pause (200ms)
5. screenshot
6. end


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
  "type": "findAndClick|pressKey|pause|screenshot|end",
  "locator": { "type": "text", "value": "string" } (for findAndClick),
  "key": "c",
  "modifiers": ["cmd"] or ["ctrl"],
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

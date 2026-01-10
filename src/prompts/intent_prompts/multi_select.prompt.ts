import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildMultiSelectPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a MULTI_SELECT intent. Your goal: ${stepData.description}

ELEMENTS: ${stepData.element || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Multiple items selected'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click items to select
2. pressKey - Hold Cmd (darwin) or Ctrl (win32) for multi-select
3. waitForElement - Wait for items to be ready
4. screenshot - Capture state
5. end - Signal completion

=== CURRENT STATE ===
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Prepare for multi-select
   → waitForElement (ensure items are visible)

2. Select first item
   → findAndClick (first item)

3. Select additional items
   For each additional item:
   → pressKey (hold Cmd or Ctrl)
   → findAndClick (item)

4. Complete
   → screenshot
   → end

=== MULTI-SELECT PATTERNS ===

**Click + Modifier:**
- macOS: Hold Cmd while clicking
- Windows/Linux: Hold Ctrl while clicking

**Range Select:**
- Click first item
- Hold Shift
- Click last item

=== TYPICAL FLOW ===
1. findAndClick - Click first item
2. pressKey - Hold Cmd/Ctrl
3. findAndClick - Click second item (while holding modifier)
4. findAndClick - Click third item (while holding modifier)
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
  "type": "findAndClick|pressKey|waitForElement|screenshot|end",
  "locator": { "type": "text", "value": "string" },
  "key": "string",
  "modifiers": ["cmd"] or ["ctrl"],
  "timeoutMs": number,
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

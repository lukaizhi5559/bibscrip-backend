import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildDownloadPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a DOWNLOAD intent. Your goal: ${stepData.description}

ELEMENT: ${stepData.element || 'Download button'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Download started'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click download button/link
2. waitForElement - Wait for download to start
3. pause - Wait for download dialog
4. screenshot - Capture state
5. end - Signal completion

=== DECISION TREE ===

1. Initiate download
   → findAndClick on download button/link
   → pause (1000ms for download to start)

2. Verify download started
   → screenshot (check for download indicator)
   → end

=== TYPICAL FLOW ===
1. findAndClick - Click download button
2. pause (1000ms)
3. screenshot - Verify download started
4. end

Note: Actual file download happens in browser/OS, we just trigger it.


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
  "type": "findAndClick|waitForElement|pause|screenshot|end",
  "locator": { "type": "text", "value": "string" },
  "timeoutMs": number,
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildVerifyPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a VERIFY intent. Your goal: ${stepData.description}

SUCCESS CRITERIA: ${stepData.successCriteria || 'Condition verified'}

=== AVAILABLE ACTIONS ===
1. screenshot - Capture current state
2. ocr - Extract text to verify content
3. waitForElement - Wait for element to verify presence
4. end - Signal completion

=== DECISION TREE ===

1. Capture current state
   → screenshot

2. Verify the condition
   → ocr (if text verification needed)
   → Check against success criteria

3. Complete
   → end

=== VERIFICATION TYPES ===
- Element presence: Use waitForElement
- Text content: Use screenshot + ocr
- Visual state: Use screenshot
- Page loaded: Check for key elements


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
  "type": "screenshot|ocr|waitForElement|end",
  "timeoutMs": number (for waitForElement),
  "reasoning": "brief explanation of verification"
}

Execute the next action now.`;
}

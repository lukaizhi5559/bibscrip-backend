import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildCheckPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a CHECK intent. Your goal: ${stepData.description}

CONDITION: ${stepData.successCriteria || 'Not specified'}

=== AVAILABLE ACTIONS ===
1. screenshot - Capture state
2. ocr - Extract text to check
3. waitForElement - Check element presence
4. end - Signal completion

=== DECISION TREE ===

1. Check the condition
   → screenshot (capture current state)
   → ocr (if checking text) OR waitForElement (if checking presence)

2. Evaluate condition
   → Determine if condition is met
   → end (with result)

=== CHECK TYPES ===
- Element exists: waitForElement
- Text contains: screenshot + ocr
- Button enabled: screenshot + ocr
- Page state: screenshot


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
  "reasoning": "condition check result"
}

Execute the next action now.`;
}

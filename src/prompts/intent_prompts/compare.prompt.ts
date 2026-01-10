import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildComparePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a COMPARE intent. Your goal: ${stepData.description}

SUCCESS CRITERIA: ${stepData.successCriteria || 'Comparison completed'}

=== AVAILABLE ACTIONS ===
1. screenshot - Capture states to compare
2. ocr - Extract text for comparison
3. store - Store comparison results
4. retrieve - Get previously stored data
5. end - Signal completion

=== STORED DATA ===
${context.storedData ? JSON.stringify(context.storedData, null, 2) : 'No stored data'}

=== DECISION TREE ===

1. Gather data to compare
   → retrieve (get previous data if needed)
   → screenshot (capture current state)
   → ocr (extract current text)

2. Perform comparison
   → Compare retrieved vs current data
   → store (save comparison results)

3. Complete
   → end

=== TYPICAL FLOW ===
1. retrieve - Get data from first source
2. screenshot - Capture second source
3. ocr - Extract text from second source
4. store - Save comparison results
5. end


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
  "type": "screenshot|ocr|store|retrieve|end",
  "key": "string (for store/retrieve)",
  "value": any (for store),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

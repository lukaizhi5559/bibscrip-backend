/**
 * Shared Action History Template for All Intent Prompts
 * Phase 3: Iterative LLM Refinement
 */

export function buildActionHistorySection(actionHistory?: any[]): string {
  if (!actionHistory || actionHistory.length === 0) {
    return '';
  }

  return `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s) in this step:

${actionHistory.map((action: any, idx: number) => `${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
   ${action.metadata?.reasoning ? `- Your reasoning: ${action.metadata.reasoning}` : ''}
`).join('')}
=== SELF-CORRECTION INSTRUCTIONS ===

**CRITICAL: Learn from previous attempts!**

1. **Analyze Failures**
   - If an action failed, WHY did it fail?
   - Was the element description too vague?
   - Was the timing wrong (element not loaded)?
   - Did you use the wrong action type?

2. **Adjust Your Approach**
   - If findAndClick failed → Try waitForElement first or be more specific
   - If element description was vague → Add more visual details (color, position, context)
   - If timing was wrong → Add pause before retry
   - If action type was wrong → Choose different action

3. **Avoid Repeating Mistakes**
   - DO NOT repeat the same failed action with identical parameters
   - DO NOT ignore error messages → Use them to adjust your strategy
   - Try different element descriptions, selectors, or action types

4. **Progressive Refinement**
   - Each attempt should be smarter than the last
   - Use information from previous screenshots
   - Adjust element descriptions based on what you learned
   - Try alternative approaches if one method isn't working

5. **NEVER Give Up**
   - ONLY use 'end' action when the task is successfully completed
   - NEVER use 'end' action for failures
   - Keep trying different approaches - the system will ask the user for help if max attempts is reached
   - After repeated failures, try completely different strategies (different selectors, different action sequences, etc.)

**Remember: You are in an iterative loop. Each action you return will be executed, and you'll see the result in the next iteration. Use this feedback to improve!**
`;
}

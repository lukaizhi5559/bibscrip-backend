import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildSelectPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a SELECT intent. Your goal: ${stepData.description}

ELEMENT: ${stepData.element || 'Not specified'}
OPTION: ${stepData.query || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Option is selected'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click dropdown/menu to open, then click option
2. waitForElement - Wait for dropdown/options to appear
3. pause - Brief wait between actions
4. screenshot - Capture state
5. end - Signal completion

=== DECISION TREE ===

1. Is dropdown already open?
   NO → findAndClick on dropdown element → waitForElement → Continue
   YES → Continue to step 2

2. Find and click the target option
   → findAndClick on option text/element
   → pause (300ms for selection to register)
   → screenshot
   → end

=== TYPICAL FLOW ===
1. findAndClick (dropdown) - Open the dropdown
2. waitForElement (options visible)
3. findAndClick (specific option) - Select the option
4. pause (300ms)
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
  "type": "findAndClick|waitForElement|pause|screenshot|end",
  "locator": { "type": "text", "value": "string" } (for findAndClick),
  "timeoutMs": number (for waitForElement),
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

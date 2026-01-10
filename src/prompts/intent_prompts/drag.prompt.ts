import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildDragPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a DRAG intent. Your goal: ${stepData.description}

SOURCE ELEMENT: ${stepData.element || 'Not specified'}
TARGET LOCATION: ${stepData.target || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Element moved to target location'}

=== AVAILABLE ACTIONS ===
1. clickAndDrag - Drag from source to target
2. waitForElement - Wait for elements to be ready
3. pause - Wait after drag completes
4. screenshot - Capture state
5. end - Signal completion

=== DECISION TREE ===

1. Ensure source and target are visible
   → waitForElement (if needed)
   → screenshot (verify elements present)

2. Execute drag operation
   → clickAndDrag from source to target
   → pause (500ms for UI to update)
   → screenshot (verify drag completed)
   → end

=== CRITICAL RULES ===
- clickAndDrag requires both fromLocator and toLocator
- Use natural language descriptions for locators
- Always pause after drag to let UI settle


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
  "type": "clickAndDrag|waitForElement|pause|screenshot|end",
  "fromLocator": { "type": "text", "value": "string" },
  "toLocator": { "type": "text", "value": "string" },
  "timeoutMs": number (for waitForElement),
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildCustomPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a CUSTOM intent. Your goal: ${stepData.description}

SUCCESS CRITERIA: ${stepData.successCriteria || 'Custom goal achieved'}
NOTES: ${stepData.notes || 'None'}

=== AVAILABLE ACTIONS ===
You have access to ALL actions:
1. focusApp - Focus application
2. openUrl - Open URL
3. findAndClick - Click elements
4. typeText - Type text
5. pressKey - Press keyboard keys
6. clickAndDrag - Drag and drop
7. scroll - Scroll page
8. zoom - Zoom in/out
9. screenshot - Capture state
10. ocr - Extract text
11. store - Store data
12. retrieve - Retrieve data
13. waitForElement - Wait for elements
14. pause - Wait/delay
15. log - Log messages
16. end - Signal completion

=== STORED DATA ===
${context.storedData ? JSON.stringify(context.storedData, null, 2) : 'No stored data'}

=== DECISION TREE ===

Custom intents are flexible - analyze the goal and break it down into steps.

1. Understand the goal
   → What needs to be accomplished?
   → What actions are required?

2. Execute actions sequentially
   → Use appropriate actions for each sub-task
   → Verify progress with screenshots
   → Store intermediate results if needed

3. Complete
   → Verify success criteria met
   → screenshot
   → end

=== APPROACH ===

Break complex goals into simple actions:
- Navigation → focusApp, openUrl
- Data entry → findAndClick, typeText
- Data extraction → screenshot, ocr, store
- Verification → waitForElement, screenshot
- Completion → end


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
  "type": "focusApp|openUrl|findAndClick|typeText|pressKey|clickAndDrag|scroll|zoom|screenshot|ocr|store|retrieve|waitForElement|pause|log|end",
  // Include relevant parameters for the chosen action
  "reasoning": "detailed explanation of action choice"
}

Execute the next action now.`;
}

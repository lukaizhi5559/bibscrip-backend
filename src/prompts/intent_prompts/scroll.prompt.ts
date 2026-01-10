import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildScrollPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a SCROLL intent. Your goal: ${stepData.description}

DIRECTION: ${stepData.query || 'down'}
TARGET: ${stepData.target || 'Main content area'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Page scrolled'}

=== AVAILABLE ACTIONS ===
1. scroll - Scroll in specified direction
2. pause - Wait after scrolling
3. screenshot - Capture state
4. end - Signal completion

=== DECISION TREE ===

1. Determine scroll parameters
   - Direction: up, down, left, right
   - Amount: pixels to scroll (default 300)

2. Execute scroll
   → scroll with direction and amount
   → pause (300ms for content to load)
   → screenshot
   → end

=== SCROLL AMOUNTS ===
- Small scroll: 100-200 pixels
- Medium scroll: 300-500 pixels
- Large scroll: 800-1000 pixels
- Page scroll: Use multiple scrolls if needed


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
  "type": "scroll|pause|screenshot|end",
  "direction": "up|down|left|right",
  "amount": number (pixels),
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

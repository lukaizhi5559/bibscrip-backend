import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildZoomPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a ZOOM intent. Your goal: ${stepData.description}

DIRECTION: ${stepData.query || 'in'}
TARGET: ${stepData.target || 'Current view'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Zoom level changed'}

=== AVAILABLE ACTIONS ===
1. zoom - Zoom in or out
2. pause - Wait for zoom to complete
3. screenshot - Capture state
4. end - Signal completion

=== DECISION TREE ===

1. Execute zoom
   → zoom with direction (in/out) and optional level
   → pause (300ms for zoom animation)
   → screenshot
   → end

=== ZOOM PARAMETERS ===
- Direction: "in" or "out"
- Level: Optional zoom level (e.g., 1.5x, 2x)

=== TYPICAL FLOW ===
1. zoom - Zoom in or out
2. pause (300ms)
3. screenshot
4. end


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
  "type": "zoom|pause|screenshot|end",
  "zoomDirection": "in|out",
  "zoomLevel": number (optional, e.g., 1.5),
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

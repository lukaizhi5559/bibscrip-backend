import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildScrollPrompt(request: IntentExecutionRequest): string {
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

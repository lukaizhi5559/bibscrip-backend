import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildCheckPrompt(request: IntentExecutionRequest): string {
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

=== OUTPUT FORMAT ===
{
  "type": "screenshot|ocr|waitForElement|end",
  "timeoutMs": number (for waitForElement),
  "reasoning": "condition check result"
}

Execute the next action now.`;
}

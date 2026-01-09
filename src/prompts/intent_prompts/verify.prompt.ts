import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildVerifyPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a VERIFY intent. Your goal: ${stepData.description}

SUCCESS CRITERIA: ${stepData.successCriteria || 'Condition verified'}

=== AVAILABLE ACTIONS ===
1. screenshot - Capture current state
2. ocr - Extract text to verify content
3. waitForElement - Wait for element to verify presence
4. end - Signal completion

=== DECISION TREE ===

1. Capture current state
   → screenshot

2. Verify the condition
   → ocr (if text verification needed)
   → Check against success criteria

3. Complete
   → end

=== VERIFICATION TYPES ===
- Element presence: Use waitForElement
- Text content: Use screenshot + ocr
- Visual state: Use screenshot
- Page loaded: Check for key elements

=== OUTPUT FORMAT ===
{
  "type": "screenshot|ocr|waitForElement|end",
  "timeoutMs": number (for waitForElement),
  "reasoning": "brief explanation of verification"
}

Execute the next action now.`;
}

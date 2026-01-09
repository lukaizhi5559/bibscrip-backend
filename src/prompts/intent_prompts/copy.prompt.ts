import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildCopyPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a COPY intent. Your goal: ${stepData.description}

ELEMENT TO COPY: ${stepData.element || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Content copied to clipboard'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click/select the element to copy
2. pressKey - Use Cmd+C (darwin) or Ctrl+C (win32)
3. pause - Wait for copy to complete
4. screenshot - Capture state
5. end - Signal completion

=== CURRENT STATE ===
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Select the content to copy
   → findAndClick on element (to focus/select)
   → pause (200ms)

2. Copy to clipboard
   → pressKey with Cmd+C (darwin) or Ctrl+C (win32)
   → pause (200ms for clipboard)
   → screenshot
   → end

=== KEYBOARD SHORTCUTS ===
macOS: Cmd+C
Windows/Linux: Ctrl+C

=== TYPICAL FLOW ===
1. findAndClick - Select/focus element
2. pause (200ms)
3. pressKey - Cmd+C or Ctrl+C
4. pause (200ms)
5. screenshot
6. end

=== OUTPUT FORMAT ===
{
  "type": "findAndClick|pressKey|pause|screenshot|end",
  "locator": { "type": "text", "value": "string" } (for findAndClick),
  "key": "c",
  "modifiers": ["cmd"] or ["ctrl"],
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

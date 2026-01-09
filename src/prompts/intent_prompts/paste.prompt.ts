import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildPastePrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a PASTE intent. Your goal: ${stepData.description}

TARGET ELEMENT: ${stepData.element || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Content pasted successfully'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click target field to focus
2. pressKey - Use Cmd+V (darwin) or Ctrl+V (win32)
3. pause - Wait for paste to complete
4. screenshot - Capture state
5. end - Signal completion

=== CURRENT STATE ===
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Focus the target field
   → findAndClick on target element
   → pause (200ms for focus)

2. Paste from clipboard
   → pressKey with Cmd+V (darwin) or Ctrl+V (win32)
   → pause (300ms for paste to complete)
   → screenshot
   → end

=== KEYBOARD SHORTCUTS ===
macOS: Cmd+V
Windows/Linux: Ctrl+V

=== TYPICAL FLOW ===
1. findAndClick - Focus target field
2. pause (200ms)
3. pressKey - Cmd+V or Ctrl+V
4. pause (300ms)
5. screenshot
6. end

=== OUTPUT FORMAT ===
{
  "type": "findAndClick|pressKey|pause|screenshot|end",
  "locator": { "type": "text", "value": "string" } (for findAndClick),
  "key": "v",
  "modifiers": ["cmd"] or ["ctrl"],
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

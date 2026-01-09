import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildSaveFilePrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a SAVE_FILE intent. Your goal: ${stepData.description}

SAVE PATH: ${stepData.target || 'Default location'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'File saved successfully'}

=== AVAILABLE ACTIONS ===
1. pressKey - Use Cmd+S (darwin) or Ctrl+S (win32)
2. typeText - Type save path if needed
3. waitForElement - Wait for save dialog/completion
4. screenshot - Capture state
5. end - Signal completion

=== CURRENT STATE ===
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Trigger save
   → pressKey (Cmd+S or Ctrl+S)
   → waitForElement (for save dialog if appears)

2. Specify path (if needed)
   → typeText (save path)
   → pressKey (Enter)

3. Wait for save completion
   → pause (500ms)
   → screenshot
   → end

=== KEYBOARD SHORTCUTS ===
macOS: Cmd+S
Windows/Linux: Ctrl+S

=== TYPICAL FLOW ===
1. pressKey - Cmd+S or Ctrl+S
2. pause (500ms for save)
3. screenshot
4. end

=== OUTPUT FORMAT ===
{
  "type": "pressKey|typeText|waitForElement|screenshot|end",
  "key": "string",
  "modifiers": ["string"],
  "text": "string (save path)",
  "timeoutMs": number,
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

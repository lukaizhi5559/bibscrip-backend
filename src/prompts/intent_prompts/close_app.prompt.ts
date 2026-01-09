import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildCloseAppPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a CLOSE_APP intent. Your goal: ${stepData.description}

TARGET: ${stepData.target || 'Current application/tab'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Application or tab is closed'}

=== AVAILABLE ACTIONS ===
1. pressKey - Press keyboard shortcut (Cmd+W for tab, Cmd+Q for app)
2. findAndClick - Click close button
3. pause - Brief wait after closing
4. screenshot - Capture state
5. end - Signal completion

=== CURRENT STATE ===
Active App: ${context.activeApp || 'Unknown'}
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Determine what to close
   - Close tab: Cmd+W (darwin) or Ctrl+W (win32)
   - Close window: Cmd+W (darwin) or Alt+F4 (win32)
   - Quit app: Cmd+Q (darwin) or Alt+F4 (win32)

2. Execute close action
   → pressKey with appropriate shortcut
   → pause (500ms)
   → screenshot
   → end

=== KEYBOARD SHORTCUTS ===
macOS:
- Close tab/window: Cmd+W
- Quit app: Cmd+Q

Windows/Linux:
- Close window: Alt+F4
- Close tab: Ctrl+W

=== OUTPUT FORMAT ===
{
  "type": "pressKey|findAndClick|pause|screenshot|end",
  "key": "string (for pressKey)",
  "modifiers": ["string"] (for pressKey),
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

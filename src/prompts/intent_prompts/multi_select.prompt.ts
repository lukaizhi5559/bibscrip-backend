import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildMultiSelectPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a MULTI_SELECT intent. Your goal: ${stepData.description}

ELEMENTS: ${stepData.element || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Multiple items selected'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click items to select
2. pressKey - Hold Cmd (darwin) or Ctrl (win32) for multi-select
3. waitForElement - Wait for items to be ready
4. screenshot - Capture state
5. end - Signal completion

=== CURRENT STATE ===
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Prepare for multi-select
   → waitForElement (ensure items are visible)

2. Select first item
   → findAndClick (first item)

3. Select additional items
   For each additional item:
   → pressKey (hold Cmd or Ctrl)
   → findAndClick (item)

4. Complete
   → screenshot
   → end

=== MULTI-SELECT PATTERNS ===

**Click + Modifier:**
- macOS: Hold Cmd while clicking
- Windows/Linux: Hold Ctrl while clicking

**Range Select:**
- Click first item
- Hold Shift
- Click last item

=== TYPICAL FLOW ===
1. findAndClick - Click first item
2. pressKey - Hold Cmd/Ctrl
3. findAndClick - Click second item (while holding modifier)
4. findAndClick - Click third item (while holding modifier)
5. screenshot
6. end

=== OUTPUT FORMAT ===
{
  "type": "findAndClick|pressKey|waitForElement|screenshot|end",
  "locator": { "type": "text", "value": "string" },
  "key": "string",
  "modifiers": ["cmd"] or ["ctrl"],
  "timeoutMs": number,
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

/**
 * Type Text Intent Prompt
 * Purpose: Type text into field
 * Available Actions: findAndClick, typeText, pressKey, waitForElement, screenshot, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildTypeTextPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  const os = context.os || 'darwin';
  const cmdKey = os === 'darwin' ? 'Cmd' : 'Ctrl';
  
  return `You are executing a TYPE_TEXT intent. Your goal: ${stepData.description}

=== CURRENT STATE (INPUT SCREENSHOT) ===
Analyze the screenshot to understand:
- Is the target input field visible?
- Is the field already focused (cursor visible)?
- What text needs to be entered?

=== TEXT TO TYPE ===
${stepData.query || 'Not specified - check description'}

=== TARGET FIELD ===
${stepData.element || 'Input field (determine from context)'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'Text entered successfully in field'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. findAndClick: { "type": "findAndClick", "locator": { "strategy": "vision", "description": "input field description" }, "timeoutMs": 5000 }
   - Click to focus input field
   - Use natural language description

2. typeText: { "type": "typeText", "text": "text to type", "submit": false }
   - Type literal text into focused field
   - Set submit: true to press Enter after typing
   - ONLY for literal text, NOT for shortcuts

3. pressKey: { "type": "pressKey", "key": "Enter", "modifiers": ["${cmdKey}"] }
   - Press keyboard shortcuts or special keys
   - Examples: Enter, Tab, Escape
   - Modifiers: "${cmdKey}", "Shift", "Alt"

4. waitForElement: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 5000 }
   - Wait for field to appear or become ready

5. screenshot: { "type": "screenshot" }
   - Verify text was entered

6. end: { "type": "end", "reason": "Text entry complete: [summary]" }
   - Signal step completion

=== DECISION TREE ===

IF field NOT visible:
  → waitForElement → findAndClick → typeText → screenshot → end

IF field visible but NOT focused:
  → findAndClick → typeText → screenshot → end

IF field already focused:
  → typeText → screenshot → end

IF need to submit after typing:
  → typeText (submit: true) → screenshot → end
  OR
  → typeText → pressKey (Enter) → screenshot → end

=== CRITICAL RULES ===

1. **typeText vs pressKey**
   - typeText: Literal text ONLY ("Hello world", "user@example.com")
   - pressKey: Shortcuts and special keys (${cmdKey}+A, Enter, Tab)
   - WRONG: { "type": "typeText", "text": "${cmdKey}+A" } → Types "C-m-d-+-A"
   - CORRECT: { "type": "pressKey", "key": "A", "modifiers": ["${cmdKey}"] } → Selects all

2. **Field Focus**
   - Always click field first unless already focused
   - Look for cursor blinking in field

3. **Verification**
   - Take screenshot after typing to verify success

=== TYPICAL FLOWS ===

**Flow 1: Simple text entry**
1. findAndClick (focus field)
2. typeText (enter text)
3. screenshot (verify)
4. end

**Flow 2: Text entry with submit**
1. findAndClick (focus field)
2. typeText (text, submit: true)
3. screenshot (verify)
4. end

**Flow 3: Paste from stored data**
1. findAndClick (focus field)
2. pressKey (${cmdKey}+V to paste)
3. screenshot (verify)
4. end

=== CONTEXT ===
- OS: ${os}
- Active App: ${context.activeApp || 'Unknown'}
- Max Attempts: ${stepData.maxAttempts || 10}
- Stored Data: ${context.storedData ? Object.keys(context.storedData).join(', ') : 'None'}

${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s):

${actionHistory.map((action: any, idx: number) => `${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
   ${action.metadata?.reasoning ? `- Your reasoning: ${action.metadata.reasoning}` : ''}
`).join('')}
=== SELF-CORRECTION INSTRUCTIONS ===

**CRITICAL: Learn from previous attempts!**

1. **Analyze Failures**
   - If findAndClick failed, is the field description accurate?
   - If typeText failed, was the field focused?
   - If text didn't appear, did you use typeText vs pressKey correctly?

2. **Adjust Your Approach**
   - If field not focused → Click field first
   - If typeText failed → Verify field is ready, try again
   - If wrong action type → Use typeText for literal text, pressKey for shortcuts

3. **Avoid Repeating Mistakes**
   - DO NOT repeat failed actions with same parameters
   - DO NOT confuse typeText (literal) with pressKey (shortcuts)
   - After 3+ failures → End with clear explanation

4. **Progressive Refinement**
   - Each attempt should be smarter
   - Verify field focus before typing
   - Check screenshot to confirm text entry

5. **When to Give Up**
   - After 3 identical failures → Try different approach
   - After 5 total failures → End with explanation
   - If field doesn't exist → End immediately

**Remember: You are in an iterative loop. Use feedback from previous attempts to improve!**
` : ''}
=== OUTPUT FORMAT ===
Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "• What I see: [current state]\n• Goal: [text to enter]\n• Action: [chosen action]\n• Expected: [expected result]",
  ...action-specific fields
}

Analyze the screenshot and return your next action:`;
}

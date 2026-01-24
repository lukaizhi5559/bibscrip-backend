/**
 * Type Text Intent Prompt
 * Purpose: Type text into field
 * Available Actions: findAndClick, typeText, pressKey, waitForElement, screenshot, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';
import { getCompleteSelectorDocs } from './_shared_selector_docs';

export function buildTypeTextPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  const os = context.os || 'darwin';
  const cmdKey = os === 'darwin' ? 'Cmd' : 'Ctrl';
  const useMultiDriver = process.env.USE_MULTI_DRIVER === 'true';
  
  // Get appropriate selector documentation based on target type
  const selectorDocs = getCompleteSelectorDocs({
    activeApp: context.activeApp,
    activeUrl: context.activeUrl,
    os: context.os || 'darwin',
    useMultiDriver
  });
  
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

${selectorDocs}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. findAndClick: Click text field to focus it
   ${useMultiDriver ? `
   **Multi-driver format (preferred):**
   { "type": "findAndClick", "selector": { "css": "input[name='email']", "role": "textbox" }, "timeoutMs": 5000 }
   
   **Legacy format (still supported):**
   { "type": "findAndClick", "locator": { "strategy": "vision", "description": "text field" }, "timeoutMs": 5000 }
   ` : `
   { "type": "findAndClick", "locator": { "strategy": "vision", "description": "text field" }, "timeoutMs": 5000 }
   `}

2. typeText: Type text into field
   ${useMultiDriver ? `
   **With selector (targets specific field - RECOMMENDED):**
   { "type": "typeText", "selector": { "css": "input[name='email']", "role": "textbox" }, "text": "value", "submit": false }
   
   **Without selector (types into focused field):**
   { "type": "typeText", "text": "value", "submit": false }
   
   **Note:** Using selector is more reliable than relying on focus state
   ` : `
   { "type": "typeText", "text": "text to type", "submit": false }
   `}
   - Set submit: true to press Enter after typing
   - Set submit: false to just type without submitting

3. pressKey: { "type": "pressKey", "key": "Enter", "modifiers": ["${cmdKey}"] }
   - Press keyboard shortcuts or special keys
   - Examples: Enter, Tab, Escape
   - Modifiers: "${cmdKey}", "Shift", "Alt"

4. waitForElement: Wait for text field to appear
   ${useMultiDriver ? `
   { "type": "waitForElement", "selector": { "css": "...", "text": "..." }, "timeoutMs": 5000 }
   ` : `
   { "type": "waitForElement", "locator": { "strategy": "vision", "description": "..." }, "timeoutMs": 5000 }
   `}

5. screenshot: { "type": "screenshot" }
   - Verify text was entered

6. end: { "type": "end", "reason": "Text entry complete: [summary]" }
   - Signal step completion

=== DECISION TREE ===

**DEFAULT ASSUMPTION: Input field is already focused and ready for typing**

IF field NOT visible:
  → waitForElement → typeText → screenshot → end

IF field visible AND clearly NOT focused (e.g., another element is active):
  → findAndClick → typeText → screenshot → end

IF field visible (default case):
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

2. **Field Focus - IMPORTANT**
   - **ASSUME field is already focused** unless you see clear evidence otherwise
   - Only use findAndClick if you see another element is active or field is clearly unfocused
   - DO NOT click "just to be safe" - this wastes actions and time
   - Evidence of unfocused field: cursor in different location, another input highlighted

3. **Verification**
   - Take screenshot after typing to verify success

=== TYPICAL FLOWS ===

**Flow 1: Simple text entry (MOST COMMON)**
1. typeText (enter text)
2. screenshot (verify)
3. end

**Flow 2: Text entry with submit**
1. typeText (text, submit: true)
2. screenshot (verify)
3. end

**Flow 3: Field needs focus first (RARE)**
1. findAndClick (only if clearly unfocused)
2. typeText (enter text)
3. screenshot (verify)
4. end

**Flow 4: Paste from stored data**
1. pressKey (${cmdKey}+V to paste)
2. screenshot (verify)
3. end

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

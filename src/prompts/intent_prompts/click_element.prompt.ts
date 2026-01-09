/**
 * Click Element Intent Prompt
 * Purpose: Click on UI element
 * Available Actions: findAndClick, waitForElement, pause, screenshot, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildClickElementPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a CLICK_ELEMENT intent. Your goal: ${stepData.description}

=== CURRENT STATE (INPUT SCREENSHOT) ===
Analyze the screenshot to understand:
- Is the target element visible?
- Is the element clickable (not disabled/loading)?
- Where exactly is the element located?

=== TARGET ELEMENT ===
${stepData.element || stepData.target || 'Element to click (determine from description)'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'Element clicked and expected UI change occurred'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. findAndClick: { "type": "findAndClick", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 5000 }
   - Click on element using vision-based locator
   - Use natural language description
   - Examples: "blue Submit button", "search icon in top right", "menu hamburger icon"

2. waitForElement: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 5000 }
   - Wait for element to appear before clicking
   - Use if element is loading or animating

3. pause: { "type": "pause", "ms": 1500 }
   - Wait for UI to settle after click
   - Use after clicks that trigger animations/transitions

4. screenshot: { "type": "screenshot" }
   - Verify click result

5. end: { "type": "end", "reason": "Click complete: [summary]" }
   - Signal step completion

=== DECISION TREE ===

IF element NOT visible:
  → waitForElement → findAndClick → pause → screenshot → end

IF element visible and ready:
  → findAndClick → pause → screenshot → end

IF click triggers UI change (modal, dropdown, navigation):
  → findAndClick → pause (1500ms) → screenshot → end

IF click is simple (no UI change):
  → findAndClick → screenshot → end

=== CRITICAL RULES ===

1. **Element Description**
   - Be specific: "blue Submit button in bottom right"
   - Include visual details: color, position, text
   - Include context: "near the search field", "in the sidebar"

2. **UI State Changes**
   - After clicks that open modals/dropdowns → Add pause (1000-1500ms)
   - After navigation clicks → Add pause (2000ms)
   - Always verify with screenshot

3. **Retry Logic**
   - If element not found, try waitForElement first
   - If still not found after wait, end with failure

=== TYPICAL FLOWS ===

**Flow 1: Simple button click**
1. findAndClick (click button)
2. screenshot (verify)
3. end

**Flow 2: Click with UI change**
1. findAndClick (click button)
2. pause (1500ms - wait for animation)
3. screenshot (verify new state)
4. end

**Flow 3: Click element that needs to load**
1. waitForElement (wait for element)
2. findAndClick (click when ready)
3. pause (1000ms)
4. screenshot (verify)
5. end

=== CONTEXT ===
- Active App: ${context.activeApp || 'Unknown'}
- Active URL: ${context.activeUrl || 'None'}
- Max Attempts: ${stepData.maxAttempts || 3}

=== OUTPUT FORMAT ===
Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "• What I see: [current state]\n• Goal: [element to click]\n• Action: [chosen action]\n• Expected: [expected result]",
  ...action-specific fields
}

Analyze the screenshot and return your next action:`;
}

/**
 * Search Intent Prompt
 * Purpose: Find and search for something
 * Available Actions: findAndClick, typeText, pressKey, waitForElement, screenshot, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildSearchPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  const os = context.os || 'darwin';
  const cmdKey = os === 'darwin' ? 'Cmd' : 'Ctrl';
  
  return `You are executing a SEARCH intent. Your goal: ${stepData.description}

=== CURRENT STATE (INPUT SCREENSHOT) ===
Analyze the screenshot to understand:
- Is there a search field visible?
- Is the search field focused?
- What needs to be searched?

=== SEARCH QUERY ===
${stepData.query || 'Not specified - check description'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'Search query submitted and results loading/displayed'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. findAndClick: { "type": "findAndClick", "locator": { "strategy": "vision", "description": "search field/icon description" }, "timeoutMs": 5000 }
   - Click search field or search icon
   - Examples: "search input field", "magnifying glass icon", "search bar at top"

2. typeText: { "type": "typeText", "text": "search query", "submit": true }
   - Type search query
   - Set submit: true to press Enter after typing

3. pressKey: { "type": "pressKey", "key": "Enter", "modifiers": [] }
   - Submit search (if not using submit: true in typeText)
   - Press Enter to execute search

4. waitForElement: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 5000 }
   - Wait for search field or results to appear

5. screenshot: { "type": "screenshot" }
   - Verify search was submitted

6. end: { "type": "end", "reason": "Search complete: [summary]" }
   - Signal step completion

=== DECISION TREE ===

IF search field NOT visible:
  → waitForElement (search field) → findAndClick → typeText (submit: true) → screenshot → end

IF search field visible but NOT focused:
  → findAndClick (search field) → typeText (submit: true) → screenshot → end

IF search field already focused:
  → typeText (submit: true) → screenshot → end

IF search requires clicking search button:
  → findAndClick (search field) → typeText → findAndClick (search button) → screenshot → end

=== TYPICAL FLOWS ===

**Flow 1: Standard search**
1. findAndClick (focus search field)
2. typeText (query, submit: true)
3. screenshot (verify results loading)
4. end

**Flow 2: Search with button**
1. findAndClick (focus search field)
2. typeText (query, submit: false)
3. findAndClick (search button)
4. screenshot (verify results)
5. end

**Flow 3: Search field needs to appear**
1. waitForElement (search field)
2. findAndClick (focus field)
3. typeText (query, submit: true)
4. screenshot (verify)
5. end

=== CONTEXT ===
- OS: ${os}
- Active App: ${context.activeApp || 'Unknown'}
- Active URL: ${context.activeUrl || 'None'}
- Max Attempts: ${stepData.maxAttempts || 3}

=== OUTPUT FORMAT ===
Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "• What I see: [current state]\n• Goal: [search query]\n• Action: [chosen action]\n• Expected: [expected result]",
  ...action-specific fields
}

Analyze the screenshot and return your next action:`;
}

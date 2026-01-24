/**
 * Search Intent Prompt
 * Purpose: Find and search for something
 * Available Actions: findAndClick, typeText, pressKey, waitForElement, screenshot, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';
import { getCompleteSelectorDocs } from './_shared_selector_docs';

export function buildSearchPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
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

${selectorDocs}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. findAndClick: Click search field or search icon
   ${useMultiDriver ? `
   **Multi-driver format (preferred):**
   { "type": "findAndClick", "selector": { "css": "input[name='search']", "role": "searchbox" }, "timeoutMs": 5000 }
   
   **Legacy format (still supported):**
   { "type": "findAndClick", "locator": { "strategy": "vision", "description": "search field" }, "timeoutMs": 5000 }
   ` : `
   { "type": "findAndClick", "locator": { "strategy": "vision", "description": "search field/icon" }, "timeoutMs": 5000 }
   `}

2. typeText: Type search query
   ${useMultiDriver ? `
   **With selector (targets specific field):**
   { "type": "typeText", "selector": { "css": "input[name='search']", "role": "searchbox" }, "text": "query", "submit": true }
   
   **Without selector (types into focused field):**
   { "type": "typeText", "text": "query", "submit": true }
   ` : `
   { "type": "typeText", "text": "search query", "submit": true }
   `}

3. pressKey: { "type": "pressKey", "key": "Enter", "modifiers": [] }
   - Submit search (if not using submit: true in typeText)

4. waitForElement: Wait for search field or results
   ${useMultiDriver ? `
   { "type": "waitForElement", "selector": { "css": "...", "text": "..." }, "timeoutMs": 5000 }
   ` : `
   { "type": "waitForElement", "locator": { "strategy": "vision", "description": "..." }, "timeoutMs": 5000 }
   `}

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
- Max Attempts: ${stepData.maxAttempts || 10}



${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s) in this step:

${actionHistory.map((action: any, idx: number) => `${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
   ${action.metadata?.reasoning ? `- Your reasoning: ${action.metadata.reasoning}` : ''}
`).join('')}
=== SELF-CORRECTION INSTRUCTIONS ===

**CRITICAL: Learn from previous attempts!**

1. **Analyze Failures**
   - If an action failed, WHY did it fail?
   - Was the element description too vague?
   - Was the timing wrong (element not loaded)?
   - Did you use the wrong action type?

2. **Adjust Your Approach**
   - If findAndClick failed → Try waitForElement first or be more specific
   - If element description was vague → Add more visual details
   - If timing was wrong → Add pause before retry
   - If action type was wrong → Choose different action

3. **Avoid Repeating Mistakes**
   - DO NOT repeat the same failed action with identical parameters
   - DO NOT keep trying if you've failed 3+ times → End with clear explanation
   - DO NOT ignore error messages → Use them to adjust

4. **Progressive Refinement**
   - Each attempt should be smarter than the last
   - Use information from previous screenshots
   - Adjust based on what you learned

5. **When to Give Up**
   - After 3 identical failures → Try different approach
   - After 5 total failures → End with explanation
   - If element truly doesn't exist → End immediately

**Remember: You are in an iterative loop. Each action you return will be executed, and you'll see the result in the next iteration. Use this feedback to improve!**
` : ''}

Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "• What I see: [current state]\n• Goal: [search query]\n• Action: [chosen action]\n• Expected: [expected result]",
  ...action-specific fields
}

Analyze the screenshot and return your next action:`;
}

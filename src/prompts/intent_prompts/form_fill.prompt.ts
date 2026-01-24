import { IntentExecutionRequest } from '../../types/intentTypes';
import { getCompleteSelectorDocs } from './_shared_selector_docs';

export function buildFormFillPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  const useMultiDriver = process.env.USE_MULTI_DRIVER === 'true';
  
  // Get appropriate selector documentation based on target type
  const selectorDocs = getCompleteSelectorDocs({
    activeApp: context.activeApp,
    activeUrl: context.activeUrl,
    os: context.os || 'darwin',
    useMultiDriver
  });
  
  return `You are executing a FORM_FILL intent. Your goal: ${stepData.description}

SUCCESS CRITERIA: ${stepData.successCriteria || 'Form filled and submitted'}

${selectorDocs}

=== AVAILABLE ACTIONS ===

1. findAndClick: Click form fields
   ${useMultiDriver ? `
   **Multi-driver format (preferred):**
   { "type": "findAndClick", "selector": { "css": "input[name='email']", "role": "textbox" }, "timeoutMs": 5000 }
   
   **Legacy format (still supported):**
   { "type": "findAndClick", "locator": { "strategy": "vision", "description": "email field" }, "timeoutMs": 5000 }
   ` : `
   { "type": "findAndClick", "locator": { "strategy": "vision", "description": "form field" }, "timeoutMs": 5000 }
   `}

2. typeText: Enter text into fields
   ${useMultiDriver ? `
   **With selector (targets specific field):**
   { "type": "typeText", "selector": { "css": "input[name='email']", "role": "textbox" }, "text": "value" }
   
   **Without selector (types into focused field):**
   { "type": "typeText", "text": "value" }
   ` : `
   { "type": "typeText", "text": "value" }
   `}

3. pressKey: Tab between fields, Enter to submit
   { "type": "pressKey", "key": "Tab" }

4. waitForElement: Wait for form elements
   ${useMultiDriver ? `
   { "type": "waitForElement", "selector": { "css": "...", "text": "..." }, "timeoutMs": 5000 }
   ` : `
   { "type": "waitForElement", "locator": { "strategy": "vision", "description": "..." }, "timeoutMs": 5000 }
   `}

5. screenshot: Capture state
   { "type": "screenshot" }

6. end: Signal completion
   { "type": "end", "reason": "Form filled: [summary]" }

=== STORED DATA ===
${context.storedData ? JSON.stringify(context.storedData, null, 2) : 'No form data stored'}

=== DECISION TREE ===

1. Locate form fields
   → waitForElement (ensure form is loaded)
   → screenshot (see form structure)

2. Fill each field
   For each field:
   → findAndClick (field)
   → typeText (value)
   → pressKey (Tab to next field)

3. Submit form
   → findAndClick (submit button) OR pressKey (Enter)
   → waitForElement (for submission confirmation)
   → screenshot
   → end

=== TYPICAL FLOW ===
1. waitForElement - Ensure form loaded
2. findAndClick - Click first field
3. typeText - Enter value
4. pressKey - Tab to next field
5. (Repeat steps 2-4 for each field)
6. findAndClick - Click submit button
7. waitForElement - Wait for confirmation
8. screenshot
9. end

=== FORM DATA ===
Form data can come from:
- stepData.query (inline data)
- context.storedData (from previous steps)
- Environment variables (for sensitive data)


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

1. **Analyze Failures** - If an action failed, WHY? Wrong element? Wrong timing? Wrong action type?
2. **Adjust Your Approach** - Be more specific, add waits, try different actions
3. **Avoid Repeating Mistakes** - DO NOT repeat failed actions with same parameters
4. **Progressive Refinement** - Each attempt should be smarter than the last
5. **When to Give Up** - After 3 identical failures → try different approach; After 5 total failures → end with explanation

**Remember: You are in an iterative loop. Use feedback from previous attempts to improve!**
` : ''}


=== OUTPUT FORMAT ===
{
  "type": "findAndClick|typeText|pressKey|waitForElement|screenshot|end",
  "locator": { "type": "text", "value": "string" },
  "text": "string",
  "key": "string (Tab, Enter, etc.)",
  "timeoutMs": number,
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

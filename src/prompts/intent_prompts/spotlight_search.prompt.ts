/**
 * Spotlight Search Intent Prompt
 * Purpose: Use Spotlight (macOS) or Windows Search to find and open files/apps
 * Available Actions: pressKey, typeText, waitForElement, screenshot, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildSpotlightSearchPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  const os = context.os || 'darwin';
  const isMac = os === 'darwin';
  
  return `You are executing a SPOTLIGHT_SEARCH intent. Your goal: ${stepData.description}

=== SEARCH QUERY ===
${stepData.query || stepData.target || 'Not specified'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'File or app opened successfully'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. pressKey: { "type": "pressKey", "key": "string", "modifiers": ["Cmd"|"Ctrl"|"Shift"|"Alt"] }
   - Open Spotlight: Cmd+Space (macOS) or Win key (Windows)
   - Submit: Enter
   - Navigate: ArrowDown, ArrowUp

2. typeText: { "type": "typeText", "text": "search query", "submit": false }
   - Type the search query into Spotlight

3. pause: { "type": "pause", "ms": 500 }
   - REQUIRED after typing to let Spotlight results load
   - Wait specified milliseconds before next action

4. findAndClick: { "type": "findAndClick", "elementDescription": "description of element to click" }
   - Use OmniParser to find and click UI elements
   - Example: "Open button next to test.txt.rtf file"

5. end: { "type": "end", "reason": "success or error message" }
   - Signal step completion

=== DECISION TREE ===

**NEW APPROACH: Use OmniParser for Reliable Element Detection**

**Flow: Open File with OmniParser - 4-5 ACTIONS**

1. **Open Spotlight**
   - pressKey (${isMac ? 'Cmd+Space' : 'Win'})
   - Screenshot comes back automatically

2. **Type the filename**
   - typeText ("${stepData.query || stepData.target}")
   - Screenshot comes back automatically

3. **CRITICAL: Execute pause action**
   - YOU MUST execute: pause (ms: 500)
   - This is a REQUIRED action, not optional
   - Spotlight needs time to display search results
   - Screenshot comes back automatically after pause
   - DO NOT skip this step - it prevents clicking the search input instead of results

4. **Verify results loaded**
   - Check the screenshot: Do you see search results?
   - If NO results (only "Search the Web" visible) → end with error: "File not found"
   - If results visible → proceed to next step

5. **Use OmniParser to find and click the file result**
   - findAndClick ("${stepData.query || stepData.target}")
   - CRITICAL: Use ONLY the filename, not "file in Documents section"
   - This will use OmniParser to detect and click the file result item
   - OmniParser will match the exact filename (e.g., "test.txt rtf")
   - OmniParser will skip web search results (Google Chrome, Safari)
   - OmniParser will skip section headers (Suggestions, Photos from Apps)
   - OmniParser will skip menu bar items (File, Edit, View)
   - After clicking, the file result becomes highlighted with blue background
   - Screenshot comes back automatically

6. **Press Enter to open the file**
   - pressKey (Enter)
   - Screenshot comes back automatically

7. **MANDATORY: Verify the file opened**
   - Check the screenshot: Do you see the file open in an application window?
   - Look for: TextEdit, Preview, Pages, or other app window with the filename in title bar
   - If YES → end (success: "File opened in [app name]")
   - If NO (still on desktop or Spotlight visible) → end (error: "File did not open - try open_file intent instead")

**Why This Works:**
- OmniParser can detect file result items with metadata (size, type, modified date)
- It provides exact coordinates, eliminating vision interpretation errors
- It can distinguish between different results based on element descriptions
- Much more reliable than trying to navigate with ArrowDown/ArrowUp
- Clicking the file result highlights it (blue background), then Enter opens it

**Element Descriptions for findAndClick:**
- "[filename]" - Use ONLY the exact filename (e.g., "test.txt.rtf")
- DO NOT add "file in Documents section" or other descriptive text
- OmniParser will extract and match the filename exactly

**Fallback Strategy:**
- If findAndClick fails: end with error "File not found in Spotlight - use open_file intent instead"
- If file doesn't open after Enter: end with error "File did not open - use open_file intent instead"

=== PLATFORM-SPECIFIC SHORTCUTS ===

**macOS (Spotlight):**
- Open: Cmd+Space
- Submit: Enter
- Cancel: Escape

**Windows (Search):**
- Open: Win key
- Submit: Enter
- Cancel: Escape

=== CONTEXT ===
- OS: ${os}
- Search Method: ${isMac ? 'Spotlight (Cmd+Space)' : 'Windows Search (Win key)'}
- Query: ${stepData.query || stepData.target || 'Not specified'}
- Max Attempts: ${stepData.maxAttempts || 10}

${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s):

${actionHistory.map((action: any, idx: number) => `${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
   ${action.metadata?.reasoning ? `- Your reasoning: ${action.metadata.reasoning}` : ''}
`).join('')}

**Self-Correction:**
- If findAndClick failed: Try a different element description
- If Spotlight didn't open: Try Cmd+Space again
- If no results: File may not exist - end with error
` : ''}

=== OUTPUT FORMAT ===
Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "Why this action?",
  ...action-specific fields
}

**CRITICAL REMINDERS:**
- Use OmniParser (findAndClick) to detect and click the "Open" button
- This eliminates vision interpretation errors
- Much more reliable than manual navigation
- Should complete in 4-5 actions total
`;
}

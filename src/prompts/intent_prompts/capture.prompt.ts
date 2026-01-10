/**
 * Capture Intent Prompt
 * Purpose: Screenshot + OCR + store data
 * Available Actions: screenshot, ocr, store, waitForElement, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildCapturePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a CAPTURE intent. Your goal: ${stepData.description}

=== CURRENT STATE (INPUT SCREENSHOT) ===
Analyze the screenshot to understand:
- Is the target data visible on screen?
- Is the page/element fully loaded?
- What data needs to be captured?

=== CAPTURE TARGET ===
${stepData.element || stepData.target || 'Capture current screen state'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'Data captured and stored successfully'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. screenshot: { "type": "screenshot", "tag": "capture_data" }
   - Take screenshot of current state
   - Use tag to identify purpose

2. ocr: { "type": "ocr" }
   - Extract text from screenshot using OCR
   - Returns structured text data

3. store: { "type": "store", "key": "data_key", "value": "data_value" }
   - Store extracted data for later use
   - Key should be descriptive (e.g., "jira_ticket_data", "error_message")

4. waitForElement: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 5000 }
   - Wait for element to appear before capturing

5. end: { "type": "end", "reason": "Capture complete: [summary]" }
   - Signal step completion

=== DECISION TREE ===

IF target data NOT visible:
  → waitForElement → screenshot → ocr → store → end

IF target data visible:
  → screenshot → ocr → store → end

IF already have screenshot:
  → ocr → store → end

IF already have OCR data:
  → store → end

=== TYPICAL FLOW ===
1. screenshot (capture current state)
2. ocr (extract text if needed)
3. store (save data with descriptive key)
4. end (signal completion)

=== CONTEXT ===
- Active App: ${context.activeApp || 'Unknown'}
- Active URL: ${context.activeUrl || 'None'}
- Max Attempts: ${stepData.maxAttempts || 10}
- Previous Data: ${context.storedData ? Object.keys(context.storedData).join(', ') : 'None'}



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
  "reasoning": "• What I see: [current state]\n• Goal: [what to capture]\n• Action: [chosen action]\n• Expected: [expected result]",
  ...action-specific fields
}

Analyze the screenshot and return your next action:`;
}

/**
 * Capture Intent Prompt
 * Purpose: Screenshot + OCR + store data
 * Available Actions: screenshot, ocr, store, waitForElement, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildCapturePrompt(request: IntentExecutionRequest): string {
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
- Max Attempts: ${stepData.maxAttempts || 3}
- Previous Data: ${context.storedData ? Object.keys(context.storedData).join(', ') : 'None'}

=== OUTPUT FORMAT ===
Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "• What I see: [current state]\n• Goal: [what to capture]\n• Action: [chosen action]\n• Expected: [expected result]",
  ...action-specific fields
}

Analyze the screenshot and return your next action:`;
}

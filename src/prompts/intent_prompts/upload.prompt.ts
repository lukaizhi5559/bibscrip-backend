import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildUploadPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing an UPLOAD intent. Your goal: ${stepData.description}

FILE PATH: ${stepData.target || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'File uploaded successfully'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click upload button/area
2. typeText - Type file path in dialog
3. pressKey - Press Enter to confirm
4. waitForElement - Wait for upload completion
5. screenshot - Capture state
6. end - Signal completion

=== DECISION TREE ===

1. Open file picker
   → findAndClick on upload button
   → waitForElement (for file dialog)

2. Select file
   → typeText with file path
   → pressKey (Enter to confirm)

3. Wait for upload
   → waitForElement (for upload completion indicator)
   → screenshot
   → end

=== TYPICAL FLOW ===
1. findAndClick - Click "Upload" or "Choose File" button
2. waitForElement - Wait for file dialog
3. typeText - Enter file path
4. pressKey - Press Enter
5. waitForElement - Wait for upload to complete
6. screenshot
7. end

=== OUTPUT FORMAT ===
{
  "type": "findAndClick|typeText|pressKey|waitForElement|screenshot|end",
  "locator": { "type": "text", "value": "string" },
  "text": "string (file path)",
  "key": "string",
  "timeoutMs": number,
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

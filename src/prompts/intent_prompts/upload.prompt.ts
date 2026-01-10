import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildUploadPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
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
  "text": "string (file path)",
  "key": "string",
  "timeoutMs": number,
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

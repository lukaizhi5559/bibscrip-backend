import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildDownloadPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a DOWNLOAD intent. Your goal: ${stepData.description}

ELEMENT: ${stepData.element || 'Download button'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Download started'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click download button/link
2. waitForElement - Wait for download to start
3. pause - Wait for download dialog
4. screenshot - Capture state
5. end - Signal completion

=== DECISION TREE ===

1. Initiate download
   → findAndClick on download button/link
   → pause (1000ms for download to start)

2. Verify download started
   → screenshot (check for download indicator)
   → end

=== TYPICAL FLOW ===
1. findAndClick - Click download button
2. pause (1000ms)
3. screenshot - Verify download started
4. end

Note: Actual file download happens in browser/OS, we just trigger it.

=== OUTPUT FORMAT ===
{
  "type": "findAndClick|waitForElement|pause|screenshot|end",
  "locator": { "type": "text", "value": "string" },
  "timeoutMs": number,
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildSelectPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a SELECT intent. Your goal: ${stepData.description}

ELEMENT: ${stepData.element || 'Not specified'}
OPTION: ${stepData.query || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Option is selected'}

=== AVAILABLE ACTIONS ===
1. findAndClick - Click dropdown/menu to open, then click option
2. waitForElement - Wait for dropdown/options to appear
3. pause - Brief wait between actions
4. screenshot - Capture state
5. end - Signal completion

=== DECISION TREE ===

1. Is dropdown already open?
   NO → findAndClick on dropdown element → waitForElement → Continue
   YES → Continue to step 2

2. Find and click the target option
   → findAndClick on option text/element
   → pause (300ms for selection to register)
   → screenshot
   → end

=== TYPICAL FLOW ===
1. findAndClick (dropdown) - Open the dropdown
2. waitForElement (options visible)
3. findAndClick (specific option) - Select the option
4. pause (300ms)
5. screenshot
6. end

=== OUTPUT FORMAT ===
{
  "type": "findAndClick|waitForElement|pause|screenshot|end",
  "locator": { "type": "text", "value": "string" } (for findAndClick),
  "timeoutMs": number (for waitForElement),
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

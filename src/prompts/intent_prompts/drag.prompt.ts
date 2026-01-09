import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildDragPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a DRAG intent. Your goal: ${stepData.description}

SOURCE ELEMENT: ${stepData.element || 'Not specified'}
TARGET LOCATION: ${stepData.target || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Element moved to target location'}

=== AVAILABLE ACTIONS ===
1. clickAndDrag - Drag from source to target
2. waitForElement - Wait for elements to be ready
3. pause - Wait after drag completes
4. screenshot - Capture state
5. end - Signal completion

=== DECISION TREE ===

1. Ensure source and target are visible
   → waitForElement (if needed)
   → screenshot (verify elements present)

2. Execute drag operation
   → clickAndDrag from source to target
   → pause (500ms for UI to update)
   → screenshot (verify drag completed)
   → end

=== CRITICAL RULES ===
- clickAndDrag requires both fromLocator and toLocator
- Use natural language descriptions for locators
- Always pause after drag to let UI settle

=== OUTPUT FORMAT ===
{
  "type": "clickAndDrag|waitForElement|pause|screenshot|end",
  "fromLocator": { "type": "text", "value": "string" },
  "toLocator": { "type": "text", "value": "string" },
  "timeoutMs": number (for waitForElement),
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

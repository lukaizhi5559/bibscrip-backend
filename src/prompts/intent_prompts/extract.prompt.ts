import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildExtractPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing an EXTRACT intent. Your goal: ${stepData.description}

ELEMENT TO EXTRACT: ${stepData.element || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Data extracted and stored'}

=== AVAILABLE ACTIONS ===
1. screenshot - Capture current state
2. ocr - Extract text from screenshot
3. store - Store extracted data
4. findAndClick - Click to reveal data if needed
5. end - Signal completion

=== DECISION TREE ===

1. Is target data visible?
   NO → findAndClick to reveal → waitForElement → Continue
   YES → Continue to step 2

2. Extract the data
   → screenshot (capture current state)
   → ocr (extract text from screenshot)
   → store (save extracted data with key)
   → end

=== TYPICAL FLOW ===
1. screenshot - Capture screen with target data
2. ocr - Extract all text
3. store - Save specific data (e.g., ticket ID, error message)
4. end

=== STORAGE KEYS ===
Use descriptive keys like:
- "ticket_id" for Jira ticket numbers
- "error_message" for error text
- "table_data" for table contents
- "form_values" for form data

=== OUTPUT FORMAT ===
{
  "type": "screenshot|ocr|store|findAndClick|end",
  "key": "string (for store)",
  "value": "any (for store)",
  "region": { "x": number, "y": number, "width": number, "height": number } (optional for ocr),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

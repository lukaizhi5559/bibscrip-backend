import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildComparePrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a COMPARE intent. Your goal: ${stepData.description}

SUCCESS CRITERIA: ${stepData.successCriteria || 'Comparison completed'}

=== AVAILABLE ACTIONS ===
1. screenshot - Capture states to compare
2. ocr - Extract text for comparison
3. store - Store comparison results
4. retrieve - Get previously stored data
5. end - Signal completion

=== STORED DATA ===
${context.storedData ? JSON.stringify(context.storedData, null, 2) : 'No stored data'}

=== DECISION TREE ===

1. Gather data to compare
   → retrieve (get previous data if needed)
   → screenshot (capture current state)
   → ocr (extract current text)

2. Perform comparison
   → Compare retrieved vs current data
   → store (save comparison results)

3. Complete
   → end

=== TYPICAL FLOW ===
1. retrieve - Get data from first source
2. screenshot - Capture second source
3. ocr - Extract text from second source
4. store - Save comparison results
5. end

=== OUTPUT FORMAT ===
{
  "type": "screenshot|ocr|store|retrieve|end",
  "key": "string (for store/retrieve)",
  "value": any (for store),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

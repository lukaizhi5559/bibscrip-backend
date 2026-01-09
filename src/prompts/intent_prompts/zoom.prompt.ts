import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildZoomPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a ZOOM intent. Your goal: ${stepData.description}

DIRECTION: ${stepData.query || 'in'}
TARGET: ${stepData.target || 'Current view'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Zoom level changed'}

=== AVAILABLE ACTIONS ===
1. zoom - Zoom in or out
2. pause - Wait for zoom to complete
3. screenshot - Capture state
4. end - Signal completion

=== DECISION TREE ===

1. Execute zoom
   → zoom with direction (in/out) and optional level
   → pause (300ms for zoom animation)
   → screenshot
   → end

=== ZOOM PARAMETERS ===
- Direction: "in" or "out"
- Level: Optional zoom level (e.g., 1.5x, 2x)

=== TYPICAL FLOW ===
1. zoom - Zoom in or out
2. pause (300ms)
3. screenshot
4. end

=== OUTPUT FORMAT ===
{
  "type": "zoom|pause|screenshot|end",
  "zoomDirection": "in|out",
  "zoomLevel": number (optional, e.g., 1.5),
  "ms": number (for pause),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

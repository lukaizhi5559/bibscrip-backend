import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildSwitchAppPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a SWITCH_APP intent. Your goal: ${stepData.description}

TARGET APPLICATION: ${stepData.target || 'Not specified'}
SUCCESS CRITERIA: ${stepData.successCriteria || 'Application is focused and visible'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions:
1. focusApp - Focus/switch to an application by name
2. waitForElement - Wait for UI element to appear
3. screenshot - Capture current state
4. end - Signal step completion

=== CURRENT STATE ===
Active App: ${context.activeApp || 'Unknown'}
OS: ${context.os || 'darwin'}

=== DECISION TREE ===

1. Is target app already active?
   YES → screenshot → end
   NO → Continue to step 2

2. Focus the target application
   → focusApp with target app name
   → waitForElement (brief wait for app to focus)
   → screenshot (verify app is focused)
   → end

=== CRITICAL RULES ===
- Use exact application names (e.g., "Google Chrome", "Warp", "Windsurf")
- Always end with screenshot → end
- If app doesn't exist, still call end (don't loop forever)

=== OUTPUT FORMAT ===
Return ONLY valid JSON with this structure:
{
  "type": "focusApp|waitForElement|screenshot|end",
  "appName": "string (for focusApp)",
  "timeoutMs": number (for waitForElement),
  "reasoning": "brief explanation"
}

Execute the next action now.`;
}

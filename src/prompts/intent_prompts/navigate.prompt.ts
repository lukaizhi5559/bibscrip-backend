/**
 * Navigate Intent Prompt
 * Purpose: Navigate to URL or focus application
 * Available Actions: focusApp, openUrl, waitForElement, screenshot, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildNavigatePrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  const os = context.os || 'darwin';
  
  return `You are executing a NAVIGATE intent. Your goal: ${stepData.description}

=== CURRENT STATE (INPUT SCREENSHOT) ===
Analyze the screenshot to understand:
- What app/page is currently active?
- Are we already at the target destination?
- What needs to happen to reach the target?

=== TARGET ===
${stepData.target || 'Not specified - determine from description'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'Target destination visible and loaded'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. focusApp: { "type": "focusApp", "appName": "Real App Name" }
   - Use REAL app names from screenshot Dock/taskbar
   - Examples: "Google Chrome", "Safari", "Warp", "Windsurf"
   - NEVER use generic names like "Browser App"

2. openUrl: { "type": "openUrl", "url": "https://example.com" }
   - Navigate to URL in active browser
   - Only use if URL navigation needed

3. waitForElement: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 5000 }
   - Wait for page/element to load

4. screenshot: { "type": "screenshot" }
   - Take screenshot to verify state

5. end: { "type": "end", "reason": "Navigation complete: [summary]" }
   - Signal step completion

=== DECISION TREE ===

IF already at target destination:
  → screenshot → end

IF target is URL AND current app is browser:
  → openUrl → waitForElement → screenshot → end

IF target is URL AND current app is NOT browser:
  → focusApp (browser) → openUrl → waitForElement → screenshot → end

IF target is desktop app:
  → focusApp → waitForElement → screenshot → end

=== CONTEXT ===
- OS: ${os}
- Active App: ${context.activeApp || 'Unknown'}
- Active URL: ${context.activeUrl || 'None'}
- Max Attempts: ${stepData.maxAttempts || 3}

=== OUTPUT FORMAT ===
Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "• What I see: [current state]\n• Goal: [what needs to happen]\n• Action: [chosen action]\n• Expected: [expected result]",
  ...action-specific fields
}

Analyze the screenshot and return your next action:`;
}

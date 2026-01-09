/**
 * Wait Intent Prompt
 * Purpose: Wait for element or condition
 * Available Actions: waitForElement, pause, screenshot, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildWaitPrompt(request: IntentExecutionRequest): string {
  const { stepData, context } = request;
  
  return `You are executing a WAIT intent. Your goal: ${stepData.description}

=== CURRENT STATE (INPUT SCREENSHOT) ===
Analyze the screenshot to understand:
- Is the target element/condition already present?
- What are we waiting for?
- Is the page/app still loading?

=== WAITING FOR ===
${stepData.element || stepData.target || 'Element/condition (determine from description)'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'Element visible or condition met'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. waitForElement: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 10000 }
   - Wait for specific element to appear
   - Use natural language description
   - Timeout in milliseconds (default: 10000)

2. pause: { "type": "pause", "ms": 2000 }
   - Wait fixed duration
   - Use when waiting for animations, page loads, or processing

3. screenshot: { "type": "screenshot" }
   - Verify element appeared or condition met

4. end: { "type": "end", "reason": "Wait complete: [summary]" }
   - Signal step completion

=== DECISION TREE ===

IF waiting for specific element:
  → waitForElement → screenshot → end

IF waiting for page load (no specific element):
  → pause (3000ms) → screenshot → end

IF element already visible:
  → screenshot → end

IF waiting for animation/transition:
  → pause (1500ms) → screenshot → end

=== TYPICAL FLOWS ===

**Flow 1: Wait for element**
1. waitForElement (target element, 10s timeout)
2. screenshot (verify appeared)
3. end

**Flow 2: Wait for page load**
1. pause (3000ms)
2. screenshot (verify loaded)
3. end

**Flow 3: Element already present**
1. screenshot (verify)
2. end

=== CONTEXT ===
- Active App: ${context.activeApp || 'Unknown'}
- Active URL: ${context.activeUrl || 'None'}
- Max Attempts: ${stepData.maxAttempts || 3}

=== OUTPUT FORMAT ===
Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "• What I see: [current state]\n• Goal: [what to wait for]\n• Action: [chosen action]\n• Expected: [expected result]",
  ...action-specific fields
}

Analyze the screenshot and return your next action:`;
}

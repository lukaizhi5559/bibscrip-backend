// Prompt Templates - Claude Sonnet 4 optimized prompts for UI-indexed desktop automation
// Generates context-aware prompts using UI element index

import { PlanningContext } from './generatePlan';
import { UIElement } from '../agent/uiIndexerDaemon';

export function createClaudePrompt(context: PlanningContext): string {
  const { taskDescription, uiElements, activeApp, maxActions = 10, allowFallback = true } = context;
  
  return `You are ThinkDrop AI's desktop automation planner. Your task is to generate a precise, deterministic action plan using the provided UI element index.

## TASK
${taskDescription}

## CURRENT CONTEXT
- Active Application: ${activeApp.name}
- Window Title: ${activeApp.windowTitle}
- Available UI Elements: ${uiElements.length}
- Max Actions Allowed: ${maxActions}

## UI ELEMENT INDEX
${formatUIElements(uiElements)}

## ACTION TYPES SUPPORTED
- **click**: Click at coordinates {x, y}
- **doubleClick**: Double-click at coordinates {x, y}  
- **rightClick**: Right-click at coordinates {x, y}
- **type**: Type text (optionally click first)
- **key**: Press keyboard key (Enter, Tab, Escape, etc.)
- **scroll**: Scroll in direction with amount
- **drag**: Drag from coordinates to coordinates
- **wait**: Wait for specified milliseconds
- **screenshot**: Capture screenshot (fallback only)

## PLANNING RULES
1. **USE UI INDEX FIRST**: Always prefer UI elements from the index over guessing coordinates
2. **BE PRECISE**: Use exact coordinates from UI elements when available
3. **BE EFFICIENT**: Minimize actions while achieving the goal
4. **BE DETERMINISTIC**: Same task should produce same action sequence
5. **VALIDATE ELEMENTS**: Only use enabled and visible UI elements
6. **PROVIDE REASONING**: Explain your action choices
7. **ESTIMATE CONFIDENCE**: Rate each action's likelihood of success (0-1)
8. **FALLBACK AWARENESS**: Use screenshot only if UI index is insufficient

## RESPONSE FORMAT
Respond with valid JSON only:

\`\`\`json
{
  "actions": [
    {
      "type": "click",
      "coordinates": {"x": 100, "y": 200},
      "elementId": 123,
      "confidence": 0.95
    },
    {
      "type": "type", 
      "text": "hello world",
      "confidence": 0.90
    }
  ],
  "reasoning": "Detailed explanation of the action plan and why these specific actions were chosen",
  "confidence": 0.92,
  "fallbackRequired": false,
  "estimatedDuration": 2500
}
\`\`\`

## EXAMPLES

**Task**: "Click the Save button"
**Available Elements**: Button "Save" at (150, 300)
**Response**:
\`\`\`json
{
  "actions": [
    {
      "type": "click",
      "coordinates": {"x": 150, "y": 300},
      "elementId": 45,
      "confidence": 0.95
    }
  ],
  "reasoning": "Found Save button in UI index at coordinates (150, 300). Direct click action with high confidence.",
  "confidence": 0.95,
  "fallbackRequired": false,
  "estimatedDuration": 200
}
\`\`\`

**Task**: "Type 'hello world' in the text input"
**Available Elements**: Input field "Search" at (200, 150)
**Response**:
\`\`\`json
{
  "actions": [
    {
      "type": "click",
      "coordinates": {"x": 200, "y": 150},
      "elementId": 12,
      "confidence": 0.90
    },
    {
      "type": "type",
      "text": "hello world",
      "confidence": 0.95
    }
  ],
  "reasoning": "First click on the input field to focus it, then type the requested text. Two-step approach ensures reliable text entry.",
  "confidence": 0.92,
  "fallbackRequired": false,
  "estimatedDuration": 1200
}
\`\`\`

Now generate the action plan for the given task using the UI element index.`;
}

export function createFeasibilityPrompt(taskDescription: string, uiElements: UIElement[]): string {
  return `Analyze the feasibility of this desktop automation task:

## TASK
${taskDescription}

## AVAILABLE UI ELEMENTS
${formatUIElements(uiElements.slice(0, 20))}

## ANALYSIS REQUIRED
Determine if the task can be completed with the available UI elements.

## RESPONSE FORMAT
Respond with valid JSON only:

\`\`\`json
{
  "feasible": true,
  "confidence": 0.85,
  "reasoning": "The task can be completed because...",
  "requiredElements": ["button", "input", "dropdown"],
  "missingElements": ["submit button"],
  "alternativeApproach": "If direct approach fails, could try..."
}
\`\`\`

Analyze now:`;
}

export function createContextEnhancementPrompt(
  taskDescription: string, 
  uiElements: UIElement[], 
  previousAttempts?: string[]
): string {
  return `Enhance the context for this desktop automation task:

## TASK
${taskDescription}

## CURRENT UI STATE
${formatUIElements(uiElements)}

${previousAttempts && previousAttempts.length > 0 ? `
## PREVIOUS ATTEMPTS
${previousAttempts.map((attempt, i) => `${i + 1}. ${attempt}`).join('\n')}
` : ''}

## ENHANCEMENT NEEDED
Provide additional context, identify potential issues, and suggest improvements.

## RESPONSE FORMAT
\`\`\`json
{
  "enhancedTask": "More specific task description",
  "identifiedIssues": ["potential problem 1", "potential problem 2"],
  "recommendations": ["suggestion 1", "suggestion 2"],
  "alternativeStrategies": ["strategy 1", "strategy 2"],
  "confidence": 0.80
}
\`\`\`

Enhance now:`;
}

export function createErrorRecoveryPrompt(
  originalTask: string,
  failedAction: any,
  errorMessage: string,
  currentUIElements: UIElement[]
): string {
  return `Generate a recovery plan for a failed desktop automation action:

## ORIGINAL TASK
${originalTask}

## FAILED ACTION
\`\`\`json
${JSON.stringify(failedAction, null, 2)}
\`\`\`

## ERROR MESSAGE
${errorMessage}

## CURRENT UI STATE
${formatUIElements(currentUIElements)}

## RECOVERY STRATEGY NEEDED
Generate alternative actions to recover from this failure and continue toward the original goal.

## RESPONSE FORMAT
\`\`\`json
{
  "recoveryActions": [
    {
      "type": "screenshot",
      "confidence": 0.8
    },
    {
      "type": "click",
      "coordinates": {"x": 100, "y": 200},
      "confidence": 0.7
    }
  ],
  "reasoning": "Recovery strategy explanation",
  "confidence": 0.75,
  "shouldRetryOriginal": false,
  "estimatedDuration": 1500
}
\`\`\`

Generate recovery plan:`;
}

// Helper function to format UI elements for prompts
function formatUIElements(elements: UIElement[]): string {
  if (elements.length === 0) {
    return "No UI elements available in current index.";
  }

  const grouped = groupElementsByRole(elements);
  let formatted = "";

  for (const [role, roleElements] of Object.entries(grouped)) {
    formatted += `\n### ${role.toUpperCase()} ELEMENTS\n`;
    
    roleElements.slice(0, 10).forEach((element, index) => {
      const status = element.isEnabled && element.isVisible ? "✓" : "✗";
      const confidence = Math.round(element.confidenceScore * 100);
      
      formatted += `${index + 1}. [ID:${element.id}] "${element.elementLabel}" `;
      formatted += `at (${element.x}, ${element.y}) ${element.width}×${element.height} `;
      formatted += `${status} ${confidence}%\n`;
      
      if (element.elementValue) {
        formatted += `   Value: "${element.elementValue}"\n`;
      }
      if (element.accessibilityId) {
        formatted += `   AccessibilityID: ${element.accessibilityId}\n`;
      }
    });
    
    if (roleElements.length > 10) {
      formatted += `   ... and ${roleElements.length - 10} more ${role} elements\n`;
    }
  }

  return formatted;
}

function groupElementsByRole(elements: UIElement[]): { [role: string]: UIElement[] } {
  const grouped: { [role: string]: UIElement[] } = {};
  
  for (const element of elements) {
    if (!grouped[element.elementRole]) {
      grouped[element.elementRole] = [];
    }
    grouped[element.elementRole].push(element);
  }
  
  // Sort each group by confidence score (highest first)
  for (const role in grouped) {
    grouped[role].sort((a, b) => b.confidenceScore - a.confidenceScore);
  }
  
  return grouped;
}

// Specialized prompts for common automation patterns
export function createTypingTaskPrompt(
  text: string, 
  targetApp: string, 
  inputElements: UIElement[]
): string {
  return `Generate a typing action plan for entering text into an application.

## TASK
Type "${text}" in ${targetApp}

## AVAILABLE INPUT ELEMENTS
${formatUIElements(inputElements)}

## TYPING STRATEGY
1. Identify the most appropriate input field
2. Click to focus the field
3. Clear existing content if needed
4. Type the new text
5. Confirm entry if required

Generate the action plan following the standard JSON format.`;
}

export function createNavigationPrompt(
  destination: string,
  targetApp: string,
  navigationElements: UIElement[]
): string {
  return `Generate a navigation action plan for moving within an application.

## TASK
Navigate to "${destination}" in ${targetApp}

## AVAILABLE NAVIGATION ELEMENTS
${formatUIElements(navigationElements)}

## NAVIGATION STRATEGY
1. Identify navigation elements (menus, buttons, links)
2. Plan the shortest path to destination
3. Handle any intermediate dialogs or confirmations
4. Verify arrival at destination

Generate the action plan following the standard JSON format.`;
}

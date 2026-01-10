/**
 * Delete Folder Intent Prompt
 * Purpose: Delete directory
 * Available Actions: deleteDirectory, fileExists, screenshot, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildDeleteFolderPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a DELETE_FOLDER intent. Your goal: ${stepData.description}

=== TARGET ===
${stepData.target || 'Path (determine from description)'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'Operation completed successfully'}

=== AVAILABLE ACTIONS ===
deleteDirectory, fileExists, screenshot, end

=== CRITICAL RULES ===
Can delete recursively. Check directory exists first.

${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s):

${actionHistory.map((action: any, idx: number) => `${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
`).join('')}
=== SELF-CORRECTION INSTRUCTIONS ===

**Learn from failures!** Analyze errors, adjust paths, try different approach.
` : ''}

=== OUTPUT FORMAT ===
{
  "type": "actionType",
  "reasoning": "brief explanation",
  ...action-specific fields
}

Execute the next action now.`;
}

/**
 * Write File Intent Prompt
 * Purpose: Write content to file
 * Available Actions: writeFile, fileExists, createDirectory, screenshot, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildWriteFilePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a WRITE_FILE intent. Your goal: ${stepData.description}

=== FILE TO WRITE ===
Path: ${stepData.target || 'File path (determine from description)'}
Content: ${stepData.query || 'Content to write (from stored data or description)'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'File written successfully'}

=== AVAILABLE ACTIONS ===
1. createDirectory: { "type": "createDirectory", "path": "/absolute/path/to/dir" }
2. fileExists: { "type": "fileExists", "path": "/absolute/path/to/file" }
3. writeFile: { "type": "writeFile", "path": "/absolute/path/to/file", "content": "text", "encoding": "utf8" }
4. screenshot: { "type": "screenshot" }
5. end: { "type": "end", "reason": "File written: [summary]" }

=== DECISION TREE ===

IF parent directory doesn't exist:
  → createDirectory → writeFile → end

IF file already exists:
  → writeFile (overwrites) → end

IF new file:
  → writeFile → end

=== CRITICAL RULES ===

1. **File Paths** - Always use absolute paths
2. **Encoding** - "utf8" for text, "base64" for binary
3. **Parent Directory** - Create if needed
4. **Overwrite** - writeFile overwrites existing files

${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s):

${actionHistory.map((action: any, idx: number) => `${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
`).join('')}
=== SELF-CORRECTION INSTRUCTIONS ===

**Learn from failures!** If writeFile failed, check path. If directory missing, create it first.
` : ''}

=== OUTPUT FORMAT ===
{
  "type": "actionType",
  "reasoning": "brief explanation",
  ...action-specific fields
}

Execute the next action now.`;
}

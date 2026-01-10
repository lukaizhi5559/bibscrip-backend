/**
 * Read File Intent Prompt
 * Purpose: Read file contents from disk
 * Available Actions: readFile, fileExists, screenshot, store, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildReadFilePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a READ_FILE intent. Your goal: ${stepData.description}

=== FILE TO READ ===
${stepData.target || 'File path (determine from description)'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'File read successfully and content stored'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. fileExists: { "type": "fileExists", "path": "/absolute/path/to/file" }
   - Check if file exists before reading
   - Returns true/false

2. readFile: { "type": "readFile", "path": "/absolute/path/to/file", "encoding": "utf8" }
   - Read file contents
   - encoding: "utf8" for text files, "base64" for binary files
   - Returns file content and size

3. store: { "type": "store", "key": "file_content", "value": "content" }
   - Store file content for later use
   - Use descriptive keys

4. screenshot: { "type": "screenshot" }
   - Capture state (optional)

5. end: { "type": "end", "reason": "File read complete: [summary]" }
   - Signal step completion

=== DECISION TREE ===

IF file path is absolute:
  → fileExists → readFile → store → end

IF file path is relative:
  → Determine absolute path → fileExists → readFile → store → end

IF file doesn't exist:
  → fileExists (returns false) → end with error

=== CRITICAL RULES ===

1. **File Paths**
   - Always use absolute paths: /Users/username/file.txt
   - Expand ~ to home directory
   - Handle relative paths by converting to absolute

2. **Encoding**
   - Text files (.txt, .json, .md, .csv): encoding: "utf8"
   - Binary files (.png, .pdf, .zip): encoding: "base64"

3. **Error Handling**
   - Check file exists before reading
   - If file doesn't exist, end with clear error message
   - If permission denied, end with error

4. **Storage**
   - Always store file content with descriptive key
   - Store file metadata (size, path) if useful

=== TYPICAL FLOWS ===

**Flow 1: Read text file**
1. fileExists (check file)
2. readFile (read content)
3. store (save content)
4. end

**Flow 2: File doesn't exist**
1. fileExists (returns false)
2. end (with error message)

${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s) in this step:

${actionHistory.map((action: any, idx: number) => `${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
   ${action.metadata?.reasoning ? `- Your reasoning: ${action.metadata.reasoning}` : ''}
`).join('')}
=== SELF-CORRECTION INSTRUCTIONS ===

**CRITICAL: Learn from previous attempts!**

1. **Analyze Failures** - If readFile failed, check the path. If fileExists failed, verify absolute path.
2. **Adjust Your Approach** - Use absolute paths, check file exists first, verify encoding type.
3. **Avoid Repeating Mistakes** - DO NOT repeat failed actions with same parameters.
4. **Progressive Refinement** - Each attempt should be smarter than the last.
5. **When to Give Up** - After 3 failures → end with explanation.

**Remember: You are in an iterative loop. Use feedback from previous attempts to improve!**
` : ''}

=== OUTPUT FORMAT ===
Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "• What I need: [file to read]\n• Action: [chosen action]\n• Expected: [expected result]",
  ...action-specific fields
}

Execute the next action now.`;
}

/**
 * Generate and Type Intent Prompt
 * Purpose: Generate content via LLM, then type it into field
 * Available Actions: findAndClick, typeText, pressKey, waitForElement, screenshot, store, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildGenerateAndTypePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  const os = context.os || 'darwin';
  const cmdKey = os === 'darwin' ? 'Cmd' : 'Ctrl';
  
  return `You are executing a GENERATE_AND_TYPE intent. Your goal: ${stepData.description}

=== CURRENT STATE (INPUT SCREENSHOT) ===
Analyze the screenshot to understand:
- What application/website is active?
- Is there an input field visible?
- What type of content is expected (email, document, form field, etc.)?
- What context clues help determine what to generate?

=== GENERATION TASK ===
${stepData.query || stepData.description}

=== CONTENT REQUIREMENTS ===
${stepData.generationPrompt || 'Generate appropriate content based on the context and user request'}

Format: ${stepData.format || 'plain text'}
Max Length: ${stepData.maxLength || 'reasonable length based on context'}

=== TARGET FIELD ===
${stepData.element || 'Input field (determine from screenshot)'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'Content generated and typed successfully into field'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. findAndClick: { "type": "findAndClick", "locator": { "strategy": "vision", "description": "input field description" }, "timeoutMs": 5000 }
   - Click to focus input field
   - Use natural language description

2. typeText: { "type": "typeText", "text": "generated content here", "submit": false }
   - Type the generated content into focused field
   - Set submit: true to press Enter after typing
   - IMPORTANT: You must generate the content inline in the "text" field

3. pressKey: { "type": "pressKey", "key": "Enter", "modifiers": ["${cmdKey}"] }
   - Press keyboard shortcuts or special keys
   - Examples: Enter, Tab, Escape

4. waitForElement: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 5000 }
   - Wait for field to appear or become ready

5. screenshot: { "type": "screenshot" }
   - Verify content was typed successfully

6. store: { "type": "store", "key": "generated_content", "value": "content here" }
   - Store generated content for later use or reference
   - Useful for multi-step generation

7. end: { "type": "end", "reason": "Content generated and typed: [summary]" }
   - Signal step completion

=== DECISION TREE ===

**Flow 1: Generate and Type (Most Common)**
1. Analyze screenshot to understand context
2. Generate appropriate content based on request
3. findAndClick (if field not focused)
4. typeText (with generated content)
5. screenshot (verify)
6. end

**Flow 2: Store Then Type**
1. Generate content
2. store (save generated content)
3. findAndClick (focus field)
4. typeText (use stored content)
5. screenshot (verify)
6. end

**Flow 3: Field Already Focused**
1. Generate content
2. typeText (directly, skip click)
3. screenshot (verify)
4. end

=== CONTENT GENERATION GUIDELINES ===

**CRITICAL: You must generate the content yourself based on the request!**

1. **Understand the Context**
   - What application is this? (email client, document editor, form, chat, etc.)
   - What type of content is expected?
   - What tone/style is appropriate?

2. **Generate Appropriate Content**
   - For resume: Professional format with sections (Summary, Experience, Education, Skills)
   - For email: Proper greeting, body, closing
   - For form field: Concise, relevant information
   - For document: Well-structured with paragraphs
   - For chat/message: Conversational, appropriate length

3. **Content Quality**
   - Be specific and detailed (not generic)
   - Use proper formatting (line breaks, punctuation)
   - Match the expected length (resume = 200-400 words, email = 50-150 words, form field = 10-50 words)
   - Use professional language unless context suggests otherwise

4. **Examples:**

   **Resume Example:**
   "Professional Summary\\n\\nExperienced software engineer with 5+ years in full-stack development...\\n\\nExperience\\n\\nSenior Software Engineer - Tech Corp (2020-Present)\\n- Led development of microservices architecture...\\n\\nEducation\\n\\nB.S. Computer Science - University Name (2018)\\n\\nSkills\\n\\nJavaScript, Python, React, Node.js, AWS, Docker"

   **Email Example:**
   "Hi [Name],\\n\\nI hope this email finds you well. I wanted to follow up on our previous conversation regarding...\\n\\nLooking forward to hearing from you.\\n\\nBest regards,\\n[Your Name]"

   **Form Field Example:**
   "Experienced professional seeking new opportunities in software development"

=== CONTEXT ===
- OS: ${os}
- Active App: ${context.activeApp || 'Unknown'}
- Active URL: ${context.activeUrl || 'N/A'}
- Max Attempts: ${stepData.maxAttempts || 10}
- Stored Data: ${context.storedData ? Object.keys(context.storedData).join(', ') : 'None'}

${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s):

${actionHistory.map((action: any, idx: number) => `${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
   ${action.metadata?.reasoning ? `- Your reasoning: ${action.metadata.reasoning}` : ''}
`).join('')}
=== SELF-CORRECTION INSTRUCTIONS ===

**CRITICAL: Learn from previous attempts!**

1. **Analyze Failures**
   - If findAndClick failed, is the field description accurate?
   - If typeText failed, was the field focused?
   - If content was rejected, was it appropriate?

2. **Adjust Your Approach**
   - If field not found → Try different description
   - If content too long → Shorten it
   - If content inappropriate → Regenerate with different tone

3. **Avoid Repeating Mistakes**
   - DO NOT repeat failed actions with same parameters
   - After 3+ failures → Try different approach or end with explanation

4. **Progressive Refinement**
   - Each attempt should be smarter
   - Adjust content based on feedback
   - Verify field focus before typing

**Remember: You are in an iterative loop. Use feedback from previous attempts to improve!**
` : ''}

=== DETERMINISTIC CONTEXT ===
${context.fieldAlreadyFocused ? '✅ Field is already focused from previous action - skip findAndClick!' : ''}
${context.previousTarget ? `Previous target: ${context.previousTarget}` : ''}

=== OUTPUT FORMAT ===
Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "Why this action? What content are you generating?",
  ...action-specific fields
}

**IMPORTANT REMINDERS:**
- Generate content inline in the typeText action
- Be specific and detailed in generated content
- Match the tone and format to the context
- Use \\n for line breaks in generated content
- Store content if you need to reference it later
`;
}

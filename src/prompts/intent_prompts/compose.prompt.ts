/**
 * Compose Intent Prompt
 * Purpose: Multi-step content creation with review and refinement
 * Available Actions: findAndClick, typeText, pressKey, waitForElement, screenshot, store, retrieve, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildComposePrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  const os = context.os || 'darwin';
  const cmdKey = os === 'darwin' ? 'Cmd' : 'Ctrl';
  
  return `You are executing a COMPOSE intent. Your goal: ${stepData.description}

=== CURRENT STATE (INPUT SCREENSHOT) ===
Analyze the screenshot to understand:
- What application/website is active?
- Is there an input field or document editor visible?
- What content is already present (if any)?
- What stage of composition are we in? (draft, review, edit, finalize)

=== COMPOSITION TASK ===
${stepData.query || stepData.description}

=== CONTENT REQUIREMENTS ===
${stepData.generationPrompt || 'Compose appropriate content based on the context and user request'}

Format: ${stepData.format || 'structured document'}
Review Steps: ${stepData.reviewSteps || 'draft → review → finalize'}
Max Length: ${stepData.maxLength || 'appropriate length for document type'}

=== TARGET FIELD/EDITOR ===
${stepData.element || 'Document editor or input field (determine from screenshot)'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'Content composed, reviewed, and finalized successfully'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. findAndClick: { "type": "findAndClick", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 5000 }
   - Click to focus editor or navigate UI
   - Use natural language description

2. typeText: { "type": "typeText", "text": "content here", "submit": false }
   - Type content into focused field/editor
   - Can be used multiple times for different sections

3. pressKey: { "type": "pressKey", "key": "Enter", "modifiers": ["${cmdKey}"] }
   - Press keyboard shortcuts or special keys
   - Examples: Enter (new line), Tab, ${cmdKey}+A (select all), ${cmdKey}+Z (undo)

4. waitForElement: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 5000 }
   - Wait for editor to be ready or UI to update

5. screenshot: { "type": "screenshot" }
   - Capture current state for review
   - Verify content was typed correctly

6. store: { "type": "store", "key": "draft_content", "value": "content here" }
   - Store draft content for later retrieval
   - Store different versions (draft_v1, draft_v2, final)

7. retrieve: { "type": "retrieve", "key": "draft_content" }
   - Retrieve previously stored content
   - Useful for comparing versions or continuing work

8. end: { "type": "end", "reason": "Composition complete: [summary]" }
   - Signal step completion

=== DECISION TREE ===

**Flow 1: Draft → Review → Finalize (Standard)**
1. Analyze context and requirements
2. Generate draft content
3. store (save draft as "draft_v1")
4. findAndClick (focus editor)
5. typeText (type draft content)
6. screenshot (review what was typed)
7. Evaluate: Does it need refinement?
   - If yes: Generate improved version, select all (${cmdKey}+A), typeText (replace)
   - If no: Proceed to finalize
8. store (save final as "final_content")
9. end

**Flow 2: Incremental Composition**
1. Generate first section
2. typeText (section 1)
3. pressKey (Enter twice for spacing)
4. Generate second section
5. typeText (section 2)
6. Continue for all sections
7. screenshot (verify)
8. end

**Flow 3: Edit Existing Content**
1. screenshot (see current content)
2. Analyze what needs to change
3. Select content (${cmdKey}+A or click and drag)
4. Generate improved version
5. typeText (replace with new content)
6. screenshot (verify)
7. end

**Flow 4: Resume from Stored Draft**
1. retrieve (get "draft_v1")
2. Continue editing from where left off
3. typeText (additional content)
4. store (save updated version)
5. end

=== COMPOSITION GUIDELINES ===

**CRITICAL: This is a multi-step creative process!**

1. **Draft Phase**
   - Generate initial content quickly
   - Focus on structure and main ideas
   - Don't worry about perfection yet
   - Store draft for reference

2. **Review Phase**
   - Take screenshot to see what was typed
   - Evaluate quality, clarity, completeness
   - Identify areas for improvement
   - Consider: tone, length, accuracy, formatting

3. **Refinement Phase**
   - Generate improved version based on review
   - Fix issues identified in review
   - Enhance clarity and quality
   - May require multiple iterations

4. **Finalization Phase**
   - Final polish and verification
   - Store final version
   - Complete the task

=== CONTENT QUALITY STANDARDS ===

**For Different Document Types:**

**Email/Letter:**
- Proper greeting and closing
- Clear subject/purpose in first paragraph
- Organized body with logical flow
- Professional or appropriate tone
- 100-300 words typically

**Document/Article:**
- Clear introduction
- Well-structured body with sections
- Logical flow between paragraphs
- Conclusion or summary
- 300-800 words typically

**Report/Proposal:**
- Executive summary or overview
- Detailed sections with headings
- Data/evidence support
- Recommendations or conclusions
- 500-1500 words typically

**Creative Writing:**
- Engaging opening
- Developed narrative or argument
- Descriptive language
- Satisfying conclusion
- Length varies by purpose

=== ITERATION STRATEGY ===

**When to Refine:**
- Content is too generic or vague
- Tone doesn't match context
- Length is inappropriate
- Structure is unclear
- Missing key information

**How to Refine:**
1. Take screenshot to see current state
2. Identify specific issues
3. Generate improved version addressing issues
4. Select all (${cmdKey}+A)
5. Replace with improved content
6. Verify improvement

**When to Stop:**
- Content meets quality standards
- All requirements satisfied
- No obvious improvements needed
- Max iterations reached (3-4 typically)

=== CONTEXT ===
- OS: ${os}
- Active App: ${context.activeApp || 'Unknown'}
- Active URL: ${context.activeUrl || 'N/A'}
- Max Attempts: ${stepData.maxAttempts || 15}
- Stored Data: ${context.storedData ? Object.keys(context.storedData).join(', ') : 'None'}

${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s):

${actionHistory.map((action: any, idx: number) => `${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
   ${action.metadata?.reasoning ? `- Your reasoning: ${action.metadata.reasoning}` : ''}
`).join('')}

=== COMPOSITION PROGRESS ===
${actionHistory.filter((a: any) => a.actionType === 'store').length > 0 ? 
  `✅ Drafts stored: ${actionHistory.filter((a: any) => a.actionType === 'store').map((a: any) => a.metadata?.key).join(', ')}` : 
  '📝 No drafts stored yet'}
${actionHistory.filter((a: any) => a.actionType === 'typeText').length > 0 ? 
  `✅ Content typed ${actionHistory.filter((a: any) => a.actionType === 'typeText').length} time(s)` : 
  '📝 No content typed yet'}

=== SELF-CORRECTION INSTRUCTIONS ===

**CRITICAL: Learn from previous attempts!**

1. **Analyze Progress**
   - What phase are we in? (draft, review, refine, finalize)
   - Has content been typed yet?
   - Have we taken screenshots to review?
   - Is stored content available?

2. **Adjust Strategy**
   - If first attempt → Generate draft
   - If content typed → Review via screenshot
   - If issues found → Generate improved version
   - If quality good → Finalize

3. **Avoid Mistakes**
   - Don't repeat same content without improvements
   - Don't skip review phase
   - Don't over-iterate (3-4 max)
   - Store important versions

**Remember: This is iterative composition. Each step should progress toward better content!**
` : ''}

=== DETERMINISTIC CONTEXT ===
${context.fieldAlreadyFocused ? '✅ Editor is already focused - skip findAndClick!' : ''}
${context.previousTarget ? `Previous target: ${context.previousTarget}` : ''}

=== OUTPUT FORMAT ===
Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "Why this action? What phase are we in? What are we generating/doing?",
  ...action-specific fields
}

**IMPORTANT REMINDERS:**
- This is a multi-step creative process
- Generate draft → Review → Refine → Finalize
- Store important versions for reference
- Take screenshots to review what was typed
- Use ${cmdKey}+A to select all when replacing content
- Quality over speed - iterate until content is good
`;
}

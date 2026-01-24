/**
 * Generate Form Intent Prompt
 * Purpose: Generate form data and fill multiple fields intelligently
 * Available Actions: findAndClick, typeText, pressKey, waitForElement, screenshot, store, end
 */

import { IntentExecutionRequest } from '../../types/intentTypes';

export function buildGenerateFormPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  const os = context.os || 'darwin';
  const cmdKey = os === 'darwin' ? 'Cmd' : 'Ctrl';
  
  return `You are executing a GENERATE_FORM intent. Your goal: ${stepData.description}

=== CURRENT STATE (INPUT SCREENSHOT) ===
Analyze the screenshot to understand:
- What form is visible?
- What fields are present? (name, email, phone, address, etc.)
- Which fields are required vs optional?
- What field is currently focused (if any)?
- Are there dropdowns, checkboxes, or radio buttons?

=== FORM FILLING TASK ===
${stepData.query || stepData.description}

=== FORM CONTEXT ===
${stepData.formContext || 'Generate appropriate data based on form fields and context'}

Form Type: ${stepData.formType || 'Determine from screenshot (registration, contact, application, etc.)'}
Fields to Fill: ${stepData.fields ? JSON.stringify(stepData.fields) : 'All visible fields'}
Submit After: ${stepData.submitAfter !== false ? 'Yes' : 'No'}

=== SUCCESS CRITERIA ===
${stepData.successCriteria || 'All required fields filled with appropriate generated data'}

=== AVAILABLE ACTIONS ===
You can ONLY use these actions for this intent:

1. findAndClick: { "type": "findAndClick", "locator": { "strategy": "vision", "description": "field/button description" }, "timeoutMs": 5000 }
   - Click to focus input field
   - Click dropdown to open options
   - Click checkbox or radio button
   - Click submit button when done

2. typeText: { "type": "typeText", "text": "generated data here", "submit": false }
   - Type generated data into focused field
   - Generate appropriate data for each field type
   - Set submit: false (we'll click submit button separately)

3. pressKey: { "type": "pressKey", "key": "Tab", "modifiers": [] }
   - Tab to next field
   - Enter to submit (if appropriate)
   - Escape to close dropdown

4. waitForElement: { "type": "waitForElement", "locator": { "strategy": "vision", "description": "element description" }, "timeoutMs": 5000 }
   - Wait for form to load
   - Wait for dropdown options to appear

5. screenshot: { "type": "screenshot" }
   - Verify field was filled
   - Check form state before submitting

6. store: { "type": "store", "key": "form_data", "value": { "field": "value" } }
   - Store generated form data for reference
   - Useful for multi-page forms

7. end: { "type": "end", "reason": "Form filled and submitted: [summary]" }
   - Signal step completion

=== DECISION TREE ===

**Flow 1: Sequential Field Filling (Most Common)**
1. Analyze screenshot to identify all fields
2. Generate appropriate data for all fields
3. store (save generated data)
4. For each field:
   a. findAndClick (focus field)
   b. typeText (enter generated data)
   c. pressKey (Tab to next field) OR findAndClick (next field)
5. screenshot (verify all fields filled)
6. findAndClick (submit button)
7. end

**Flow 2: Smart Tab Navigation**
1. Generate all form data
2. findAndClick (first field)
3. typeText (first field data)
4. pressKey (Tab)
5. typeText (second field data)
6. pressKey (Tab)
7. Continue for all fields
8. findAndClick (submit button)
9. end

**Flow 3: Dropdown/Select Fields**
1. findAndClick (dropdown field)
2. waitForElement (dropdown options visible)
3. findAndClick (appropriate option)
4. Continue with next field

**Flow 4: Multi-Page Form**
1. Fill fields on page 1
2. store (save data for reference)
3. findAndClick (Next button)
4. Fill fields on page 2
5. findAndClick (Submit button)
6. end

=== FORM DATA GENERATION GUIDELINES ===

**CRITICAL: Generate realistic, appropriate data for each field type!**

**Common Field Types:**

1. **Name Fields**
   - First Name: "John", "Sarah", "Michael", "Emily"
   - Last Name: "Smith", "Johnson", "Williams", "Brown"
   - Full Name: "John Smith", "Sarah Johnson"

2. **Email Fields**
   - Format: firstname.lastname@example.com
   - Examples: "john.smith@example.com", "sarah.j@email.com"
   - Use realistic domains: gmail.com, outlook.com, company.com

3. **Phone Fields**
   - Format: (555) 123-4567 or 555-123-4567
   - Use valid US format or local format based on context
   - Example: "(555) 234-5678"

4. **Address Fields**
   - Street: "123 Main Street", "456 Oak Avenue"
   - City: "San Francisco", "New York", "Austin"
   - State: "CA", "NY", "TX" (use abbreviations if dropdown)
   - ZIP: "94102", "10001", "78701"

5. **Date Fields**
   - Birth Date: "01/15/1990", "1990-01-15"
   - Use realistic dates based on context
   - Format: MM/DD/YYYY or YYYY-MM-DD

6. **Text Areas (Comments, Bio, etc.)**
   - Generate 1-3 sentences
   - Be specific and relevant to context
   - Example: "I am interested in learning more about your services and would like to discuss potential opportunities."

7. **Dropdowns/Selects**
   - Analyze visible options in screenshot
   - Choose most appropriate option
   - Examples: Country → "United States", Gender → "Prefer not to say"

8. **Checkboxes/Radio Buttons**
   - Terms of Service → Usually check "I agree"
   - Newsletter → Based on context (often check)
   - Required fields → Always check

9. **Password Fields**
   - Generate secure password: "SecurePass123!"
   - Include uppercase, lowercase, numbers, special chars
   - Length: 8-16 characters

10. **Company/Organization**
    - Examples: "Acme Corporation", "Tech Solutions Inc."
    - Match context (if job application, use relevant industry)

=== FIELD FILLING STRATEGY ===

**Order of Operations:**
1. Identify all visible fields in screenshot
2. Determine field types and requirements
3. Generate appropriate data for each field
4. Fill fields in logical order (top to bottom, left to right)
5. Verify each field after filling
6. Submit when all required fields complete

**Smart Navigation:**
- Use Tab key when fields are sequential
- Use findAndClick when fields are not adjacent
- Wait for dropdowns to open before selecting
- Verify field focus before typing

**Error Handling:**
- If field not found → Try different description
- If data rejected → Generate different format
- If required field missed → Go back and fill it
- If submit fails → Verify all required fields filled

=== FORM TYPE SPECIFIC GUIDANCE ===

**Registration/Signup Forms:**
- Name, Email, Password (required)
- Phone, Address (often optional)
- Terms of Service checkbox (required)
- Newsletter checkbox (optional)

**Contact Forms:**
- Name, Email (required)
- Subject, Message (required)
- Phone (optional)
- Company (optional)

**Job Application Forms:**
- Personal Info: Name, Email, Phone
- Resume Upload: May need file path
- Cover Letter: Generate 2-3 paragraphs
- Experience: Generate relevant work history
- Education: Generate degree and school

**Survey Forms:**
- Multiple choice: Select appropriate option
- Rating scales: Choose middle-to-high ratings
- Text responses: Generate thoughtful 1-2 sentence answers

=== CONTEXT ===
- OS: ${os}
- Active App: ${context.activeApp || 'Unknown'}
- Active URL: ${context.activeUrl || 'N/A'}
- Max Attempts: ${stepData.maxAttempts || 20}
- Stored Data: ${context.storedData ? Object.keys(context.storedData).join(', ') : 'None'}

${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s):

${actionHistory.map((action: any, idx: number) => `${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
   ${action.metadata?.reasoning ? `- Your reasoning: ${action.metadata.reasoning}` : ''}
`).join('')}

=== FORM FILLING PROGRESS ===
Fields filled: ${actionHistory.filter((a: any) => a.actionType === 'typeText' && a.success).length}
Clicks made: ${actionHistory.filter((a: any) => a.actionType === 'findAndClick' && a.success).length}
${actionHistory.filter((a: any) => a.actionType === 'store').length > 0 ? 
  `✅ Form data stored: ${actionHistory.filter((a: any) => a.actionType === 'store').map((a: any) => a.metadata?.key).join(', ')}` : 
  '📝 No form data stored yet'}

=== SELF-CORRECTION INSTRUCTIONS ===

**CRITICAL: Track which fields have been filled!**

1. **Analyze Progress**
   - Which fields have been successfully filled?
   - Which fields are still empty?
   - Are we ready to submit?

2. **Adjust Strategy**
   - If field failed → Try different description or data format
   - If stuck on field → Skip and come back later
   - If all fields filled → Verify and submit
   - If submit failed → Check for missed required fields

3. **Avoid Mistakes**
   - Don't fill same field twice
   - Don't skip required fields
   - Don't submit before all required fields filled
   - Don't use invalid data formats

4. **Progressive Filling**
   - Fill fields systematically (top to bottom)
   - Verify each field after filling
   - Take screenshot before submitting
   - Store data if multi-page form

**Remember: This is systematic form filling. Track progress and fill all required fields before submitting!**
` : ''}

=== DETERMINISTIC CONTEXT ===
${context.fieldAlreadyFocused ? '✅ Field is already focused - skip findAndClick!' : ''}
${context.filledFields ? `✅ Already filled: ${context.filledFields.join(', ')}` : ''}
${context.previousTarget ? `Previous target: ${context.previousTarget}` : ''}

=== OUTPUT FORMAT ===
Return ONE action as JSON:
{
  "type": "actionType",
  "reasoning": "Why this action? Which field are we filling? What data are we generating?",
  ...action-specific fields
}

**IMPORTANT REMINDERS:**
- Generate realistic, appropriate data for each field type
- Fill fields systematically (top to bottom)
- Track which fields have been filled
- Verify all required fields before submitting
- Use Tab key for sequential navigation
- Take screenshot before final submit
- Store form data for multi-page forms
`;
}

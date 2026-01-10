# Action History Template for Intent Prompts

## Template to Insert (After "=== CONTEXT ===" section)

```typescript
${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s) in this step:

${actionHistory.map((action: any, idx: number) => `
${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
   ${action.metadata?.reasoning ? `- Your reasoning: ${action.metadata.reasoning}` : ''}
`).join('')}

=== SELF-CORRECTION INSTRUCTIONS ===

**CRITICAL: Learn from previous attempts!**

1. **Analyze Failures**
   - If an action failed, WHY did it fail?
   - Was the element description too vague?
   - Was the timing wrong (element not loaded)?
   - Did you use the wrong action type?

2. **Adjust Your Approach**
   - If findAndClick failed → Try waitForElement first
   - If element description was vague → Be more specific
   - If timing was wrong → Add pause before retry
   - If action type was wrong → Choose different action

3. **Avoid Repeating Mistakes**
   - DO NOT repeat the same failed action with identical parameters
   - DO NOT keep trying if you've failed 3+ times → Request clarification
   - DO NOT ignore error messages → Use them to adjust

4. **Progressive Refinement**
   - Each attempt should be smarter than the last
   - Use information from previous screenshots
   - Adjust element descriptions based on what you learned

5. **When to Give Up**
   - After 3 identical failures → Try different approach
   - After 5 total failures → Request clarification or end with failure
   - If element truly doesn't exist → End with clear explanation

**Remember: You are in an iterative loop. Each action you return will be executed, and you'll see the result in the next iteration. Use this feedback to improve!**
` : ''}
```

## Usage in Prompt Builders

```typescript
export function buildYourIntentPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
  const { stepData, context } = request;
  
  return `You are executing a YOUR_INTENT intent. Your goal: ${stepData.description}

=== CURRENT STATE (INPUT SCREENSHOT) ===
...

=== CONTEXT ===
- Active App: ${context.activeApp || 'Unknown'}
- Max Attempts: ${stepData.maxAttempts || 10}

${actionHistory && actionHistory.length > 0 ? `
=== PREVIOUS ACTIONS IN THIS STEP ===
You have already attempted ${actionHistory.length} action(s) in this step:

${actionHistory.map((action: any, idx: number) => `
${idx + 1}. ${action.actionType}
   - Success: ${action.success}
   ${action.error ? `- Error: ${action.error}` : ''}
   ${action.metadata?.reasoning ? `- Your reasoning: ${action.metadata.reasoning}` : ''}
`).join('')}

=== SELF-CORRECTION INSTRUCTIONS ===
[Insert self-correction instructions here]
` : ''}

=== OUTPUT FORMAT ===
...
`;
}
```

## Key Points

1. **Only show if actionHistory exists and has items**
2. **Show all previous attempts with success/error status**
3. **Include LLM's own reasoning from previous attempts**
4. **Provide clear self-correction instructions**
5. **Emphasize learning from failures**
6. **Set clear limits (3-5 attempts before giving up)**

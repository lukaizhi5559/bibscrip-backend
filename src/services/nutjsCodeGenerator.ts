/**
 * Nut.js Code Generator Service
 * Specialized LLM service for generating ONLY Nut.js desktop automation code
 * Priority: Claude (fastest vision) → OpenAI GPT-4V → Grok (fallback)
 */

import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../utils/logger';
import { AutomationPlan, AutomationStep } from '../types/automationPlan';
import { AutomationGuide, GuideRequest } from '../types/automationGuide';
import { randomUUID } from 'crypto';

export interface NutjsCodeResponse {
  code: string;
  provider: 'claude' | 'openai' | 'grok';
  latencyMs: number;
  error?: string;
  usedVision?: boolean; // Indicates if screenshot was processed
}

export interface ScreenshotData {
  base64: string; // Base64 encoded image
  mimeType?: string; // e.g., 'image/png', 'image/jpeg'
}

export interface AutomationPlanResponse {
  plan: AutomationPlan;
  provider: 'claude' | 'openai' | 'grok';
  latencyMs: number;
  error?: string;
}

export interface AutomationGuideResponse {
  guide: AutomationGuide;
  provider: 'claude' | 'openai' | 'grok';
  latencyMs: number;
  error?: string;
}

export class NutjsCodeGenerator {
  private claudeClient: Anthropic | null = null;
  private openaiClient: OpenAI | null = null;
  private grokClient: OpenAI | null = null;
  private useGrok4: boolean = false;

  constructor() {
    this.useGrok4 = process.env.USE_GROK_4 === 'true';
    
    // Priority 1: Claude (fastest vision, 3-8s)
    if (process.env.ANTHROPIC_API_KEY) {
      this.claudeClient = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      logger.info('Claude client initialized (Priority 1 - fastest vision)');
    } else {
      logger.warn('ANTHROPIC_API_KEY not found - Claude unavailable');
    }

    // Priority 2: OpenAI GPT-4 Vision (fast vision, 5-10s)
    if (process.env.OPENAI_API_KEY) {
      this.openaiClient = new OpenAI({
        apiKey: process.env.OPENAI_API_KEY,
      });
      logger.info('OpenAI client initialized (Priority 2 - fast vision)');
    } else {
      logger.warn('OPENAI_API_KEY not found - OpenAI unavailable');
    }

    // Priority 3: Grok (slower vision 30s+, but good fallback)
    if (process.env.GROK_API_KEY) {
      this.grokClient = new OpenAI({
        apiKey: process.env.GROK_API_KEY,
        baseURL: 'https://api.x.ai/v1',
      });
      logger.info('Grok client initialized (Priority 3 - fallback)');
    } else {
      logger.warn('GROK_API_KEY not found - Grok unavailable');
    }
  }

  /**
   * Build the specialized prompt for Nut.js code generation
   * Enhanced with vision context when screenshot is provided
   */
  private buildNutjsPrompt(command: string, hasScreenshot: boolean = false, context?: any): string {
    // Add unique timestamp to prevent API caching
    const cacheBuster = hasScreenshot ? `\n[Request ID: ${Date.now()}-${Math.random().toString(36).substr(2, 9)}]` : '';
    
    // Add frontend instruction if provided
    const frontendInstruction = context?.instruction ? `\n\n**FRONTEND INSTRUCTION:** ${context.instruction}` : '';
    
    // Check if type-only mode is requested
    const isTypeOnlyMode = context?.responseMode === 'type-only';
    
    // Build type-only mode instructions if flag is set
    const typeOnlyInstructions = isTypeOnlyMode ? `
- **CRITICAL - TYPE ONLY MODE ENABLED**:
  * **NEVER use findAndClick() or any UI interaction functions**
  * **ONLY use keyboard.type() or typeWithNewlines() to type responses**
  * **DO NOT click, navigate, or interact with UI elements**
  * Your ONLY job is to TYPE the answer/solution into the active text field
  * This is a PROMPT-ANYWHERE request - just type the response, nothing else
` : '';
    
    const visionContext = hasScreenshot ? `
**VISION MODE:** Screenshot provided. Analyze what's on screen and generate NutJS code.${cacheBuster}
- ALWAYS return executable code (never plain text)
${typeOnlyInstructions}
- For "describe/answer/explain" commands:
  * **CRITICAL - CONTEXT AWARENESS**: Look at what's ALREADY on screen
  * **DETECT INCOMPLETE CONTENT**: Look for signs of incomplete code/text:
    - Functions without return statements
    - Comments like "// Need to complete", "// TODO", "// Rest of this"
    - Unfinished logic or calculations
    - Partial lists or numbered items
  * If user says "finish...", "cont...", "continue...", "continue", "add more", "keep going", "complete this", "finish this" → CONTINUE/COMPLETE from where content left off
  * **DO NOT restart numbering** - if screen shows "3. Item", continue with "4. Item", "5. Item"
  * **DO NOT rewrite existing code** - only add the MISSING/INCOMPLETE parts
  * **DO NOT repeat content** - only add NEW content that continues or completes the existing content
  * **CRITICAL**: Look for the LANGUAGE specified in the screenshot (e.g., "TypeScript or JavaScript", "Python", "SQL")
  * **CRITICAL**: Answer in THAT language ONLY - don't provide alternatives in other languages
  * If screenshot says "TypeScript or JavaScript" → provide TypeScript/JavaScript solution ONLY
  * If screenshot says "SQL" → provide SQL solution ONLY
  * Analyze the screenshot to understand the ACTUAL question being asked
  * **BE CONCISE**: Type ONLY the essential solution - no verbose explanations
  * **NO fluff**: Skip introductions, skip "let me explain", skip unnecessary details
  * **Get to the point**: Code + brief explanation if needed, that's it
  * **CRITICAL**: Use multi-line template literals with ACTUAL line breaks
  * **CRITICAL**: MUST include typeWithNewlines() helper function
  * **CRITICAL**: keyboard.type() does NOT handle \\n - must use Key.Enter OR Shift+Enter
  * **CRITICAL - SMART NEWLINE DETECTION**: Analyze the screenshot to determine the correct newline key:
    - **Chat apps** (ChatGPT, Grok, Gemini, Slack, Teams, Discord): Use **Shift+Enter** for newlines (Enter submits)
    - **Search boxes** (Google Search, Bing): Use **Shift+Enter** for newlines (Enter searches)
    - **Text editors** (Google Docs, Notes, Word): Use **Enter** for newlines (no submit button)
    - **Detection cues**:
      * Send button visible → Chat app → Use Shift+Enter
      * Search button/magnifying glass → Search box → Use Shift+Enter
      * "Shift+Return to add new line" hint → Use Shift+Enter
      * Formatting toolbar with send button → Chat app → Use Shift+Enter
      * Large text area, no send button → Text editor → Use Enter
  
**REQUIRED PATTERN for multi-line answers:**
\`\`\`javascript
// Helper function - ALWAYS include this
// IMPORTANT: Detects if we need Shift+Enter (chat apps) or just Enter (text editors)
async function typeWithNewlines(text, useShiftEnter = false) {
  for (const char of text) {
    if (char === '\\n') {
      if (useShiftEnter) {
        // For chat apps: Shift+Enter adds newline without submitting
        await keyboard.pressKey(Key.LeftShift);
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
        await keyboard.releaseKey(Key.LeftShift);
      } else {
        // For text editors: Enter adds newline
        await keyboard.pressKey(Key.Enter);
        await keyboard.releaseKey(Key.Enter);
      }
    } else {
      await keyboard.type(char);
    }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

// Multi-line answer (adapt to actual question - KEEP IT CONCISE)
const answer = \`[Solution/Code - direct and brief]

[Key points only if needed]

[Example only if essential]\`;

// ANALYZE SCREENSHOT to determine if it's a chat app or text editor
// Chat apps (ChatGPT, Grok, Slack, Teams): Use Shift+Enter
// Text editors (Google Docs, Notes): Use Enter only
const isChatApp = true; // Set based on screenshot analysis

// Type with appropriate newline handling
await typeWithNewlines(answer, isChatApp);
\`\`\`

**EXAMPLES - Smart Newline Detection:**

**Example 1: ChatGPT/Grok (Chat App)**
\`\`\`javascript
// Screenshot shows: ChatGPT input with send button
const isChatApp = true; // Send button visible → Chat app
await typeWithNewlines(answer, true); // Use Shift+Enter
\`\`\`

**Example 2: Slack/Teams (Chat App with Formatting)**
\`\`\`javascript
// Screenshot shows: Slack message box with "Shift+Return to add new line" hint
const isChatApp = true; // Hint visible → Chat app
await typeWithNewlines(answer, true); // Use Shift+Enter
\`\`\`

**Example 3: Google Search (Search Box)**
\`\`\`javascript
// Screenshot shows: Google search box with magnifying glass/search button
const isChatApp = true; // Search button visible → Use Shift+Enter
await typeWithNewlines(answer, true); // Use Shift+Enter to avoid triggering search
\`\`\`

**Example 4: Google Docs (Text Editor)**
\`\`\`javascript
// Screenshot shows: Large text area, no send button, document editor
const isChatApp = false; // No send button → Text editor
await typeWithNewlines(answer, false); // Use Enter only
\`\`\`

**EXAMPLE - Good (concise, respects language from screenshot):**
// If screenshot says "TypeScript or JavaScript"
const answer = \`TypeScript Solution:

function findImmediatePercentage(deliveries: Delivery[]): number {
  const firstOrders = deliveries.reduce((acc, d) => {
    if (!acc[d.customer_id] || d.order_date < acc[d.customer_id].order_date) {
      acc[d.customer_id] = d;
    }
    return acc;
  }, {});
  
  const immediate = Object.values(firstOrders).filter(
    o => o.order_date === o.customer_pref_delivery_date
  ).length;
  
  return Math.round((immediate / Object.keys(firstOrders).length) * 100 * 100) / 100;
}\`;

**EXAMPLE - Bad (wrong language):**
// Screenshot says "TypeScript" but you provide SQL - DON'T DO THIS
const answer = \`SQL Solution: SELECT * FROM...\`;

**EXAMPLES - Context Continuation/Completion (CRITICAL):**

**Example 1: List Continuation**
// Screenshot shows: "2. JWT" and "3. MFA" and user says "continue to 4"
// CORRECT:
const answer = \`4. OAuth 2.0
5. API Keys\`;
// WRONG: Starting from 2 again (already on screen!)

**Example 2: Code Completion**
// Screenshot shows incomplete function with "// Need to complete the rest"
// CORRECT - Only add missing parts:
const answer = \`  const immediateCount = Array.from(firstOrders.values()).filter(...).length;
  return Math.round((immediateCount / total) * 100 * 100) / 100;
}\`;
// WRONG: Rewriting entire function (already on screen!)

**Example 3: Sentence Completion**
// Screenshot shows: "The Pythagorean theorem states that a² + b² = ..."
// CORRECT:
const answer = \`c²\`;
// WRONG: "The Pythagorean theorem states that a² + b² = c²" (repeating!)

**Example 4: Math Problem Completion**
// Screenshot shows: "Solve for x: 2x + 5 = 15\n2x = 15 - 5\n2x = 10\n"
// CORRECT:
const answer = \`x = 10 / 2
x = 5\`;
// WRONG: Starting from "2x + 5 = 15" again (already on screen!)

**Example 5: Formula Completion**
// Screenshot shows: "Area of circle = πr²\nCircumference = ..."
// CORRECT:
const answer = \`2πr\`;
// WRONG: "Area of circle = πr²\nCircumference = 2πr" (repeating!)

**KEY PRINCIPLE: Only type what's MISSING or NEXT, never repeat what's already visible!**
${frontendInstruction}
` : '';
    return `You are a Nut.js code generation expert. Your ONLY job is to generate pure Nut.js code for desktop automation tasks.

**CRITICAL RULES - READ CAREFULLY:**
1. Return ONLY executable Nut.js code - NO explanations, NO markdown, NO comments outside the code
2. Use the official Nut.js v4.x API from https://nutjs.dev/
3. **ABSOLUTELY MUST use CommonJS require() syntax - NEVER use ES6 import statements**
4. First line MUST be: const { keyboard, Key, mouse, straightTo, Point, screen, Region, Button } = require('@nut-tree-fork/nut-js');
5. **ALWAYS import vision service**: const { findAndClick } = require('../src/services/visionSpatialService');
6. Code must be ready to run immediately with: node filename.js
7. Handle errors gracefully with try-catch blocks
8. Use async/await for all Nut.js operations
9. Wrap execution in an async IIFE: (async () => { ... })();
10. **IMPORTANT**: Always release keys immediately after pressing them before typing text
11. **OS Detection**: Check process.platform to determine OS ('darwin' = macOS, 'win32' = Windows)

**🎯 VISION-FIRST STRATEGY (CRITICAL):**
**When to use VISION AI (findAndClick):**
- ✅ **ALL web browser interactions** (Gmail, YouTube, Amazon, any website)
- ✅ **ALL desktop GUI apps** (Slack, Outlook, Discord, Notion, VS Code, etc.)
- ✅ **ANY clickable UI element** (buttons, links, input fields, menus)
- ✅ **Reason**: UI layouts change, buttons move, different screen sizes, updates

**When to use KEYBOARD SHORTCUTS:**
- ✅ **OS-level operations** (open apps: Cmd+Space, switch windows: Cmd+Tab)
- ✅ **File operations** (save: Cmd+S, open: Cmd+O, close: Cmd+W)
- ✅ **Text operations** (copy: Cmd+C, paste: Cmd+V, select all: Cmd+A)
- ✅ **Reason**: OS shortcuts are standardized and never change

**NEVER use fixed coordinates** - they break on different screens and resolutions

**CRITICAL: Operating System Differences**
The code will receive context.os parameter ('darwin' for Mac, 'win32' for Windows). Use this to determine behavior:

**macOS (darwin):**
- Open apps/files: Cmd+Space (Spotlight) → type name → Enter
- Key for shortcuts: Key.LeftSuper (Cmd key)
- Example: Cmd+Space, Cmd+N, Cmd+K, Cmd+T

**Windows (win32):**
- Open apps/files: Win key → type name → Enter (Windows Search)
- Key for shortcuts: Key.LeftSuper (Windows key)
- Example: Win+S for search, Ctrl+N, Ctrl+K, Ctrl+T
- Note: Use Key.LeftControl instead of Key.LeftSuper for app shortcuts (Ctrl+C, Ctrl+V, etc.)

**Nut.js Quick Reference:**
- Mouse: \`await mouse.move(straightTo(point(x, y)))\`, \`await mouse.leftClick()\`, \`await mouse.rightClick()\`
- Keyboard: \`await keyboard.type("text")\`, \`await keyboard.pressKey(Key.Enter)\`
- Screen: \`await screen.find(imageResource("path/to/image.png"))\`, \`await screen.waitFor(imageResource(...))\`
- Regions: \`new Region(x, y, width, height)\`
- Wait: Use \`await new Promise(resolve => setTimeout(resolve, ms))\` for delays
- Search in app: Use \`Cmd+K\` (Key.LeftSuper + Key.K) for quick search in most apps

**CRITICAL: Typing Large Text with Newlines**
When typing long text (answers, descriptions, multi-line content):
1. **CRITICAL**: keyboard.type() does NOT interpret \\n as Enter - it ignores them!
2. **MUST manually press Key.Enter** for every newline character
3. **Use this EXACT pattern for multi-line text:**

\`\`\`javascript
// Helper function to type text with proper newline handling
async function typeWithNewlines(text) {
  for (const char of text) {
    if (char === '\\n') {
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
    } else {
      await keyboard.type(char);
    }
    await new Promise(resolve => setTimeout(resolve, 30)); // Delay per character
  }
}

// Multi-line answer with \\n for line breaks
const answer = \`TypeScript Solution:

function secondHighest(employees) {
  const salaries = [...new Set(employees.map(e => e.salary))].sort((a,b) => b-a);
  return salaries[1] || null;
}



Example:
Input: [{id:1, salary:100}]
Output: null\`;

// Type with proper newline handling
await typeWithNewlines(answer);
\`\`\`

**WHY THIS IS REQUIRED:**
- keyboard.type() does NOT convert \\n to Enter key presses
- Google Docs, Word, and most apps require ACTUAL Enter key events
- Without this, all newlines are ignored and text appears compressed

**CRITICAL: Answer Formatting Rules**
When generating answers to questions (coding problems, explanations, etc.):
- **BE CONCISE AND DIRECT**: No introductions, no verbose explanations
- **NO fluff**: Skip "Looking at this question...", "I can help...", "Let me explain..."
- **Start with the solution immediately** - code first, brief notes if needed
- **Keep it short**: Only include what's essential to answer the question
- **MUST use multi-line template literals** - the template literal MUST span multiple lines in your code
- **DO NOT write the template literal on one line** - it will appear compressed
- **Each section should be on its own line** with blank lines between sections

**FORMATTING STRUCTURE (adapt content to actual question):**
\`\`\`javascript
// Helper function - ALWAYS include this for multi-line text
async function typeWithNewlines(text) {
  for (const char of text) {
    if (char === '\\n') {
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);
    } else {
      await keyboard.type(char);
    }
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}

// Multi-line template literal - notice it spans many lines
const answer = \`[Section 1 title or solution]

[Code, explanation, or details for section 1]

[Section 2 if needed]

[Code or explanation for section 2]

[Example or edge cases if relevant]\`;

// Type with proper newline handling
await typeWithNewlines(answer);
\`\`\`

**KEY POINTS:**
- ALWAYS include the typeWithNewlines() helper function
- **BE CONCISE**: Only essential information, no verbose explanations
- Replace the bracketed placeholders with your actual answer content
- Keep the multi-line format with blank lines between sections
- The helper will convert \\n to actual Enter key presses

**CONCISE ANSWER STRUCTURE:**
- Solution/Code (the actual answer)
- Brief explanation (only if absolutely necessary)
- Example (only if it adds clarity)
- Skip everything else

**IMPORTANT**: Use the forked package \`@nut-tree-fork/nut-js\` version 4.2.6+

**CRITICAL: Web Searches and Browser Queries**
When the command involves searching the web, shopping online, or visiting websites:
1. **DO NOT open Spotlight/Windows Search**
2. **Open the default browser directly** using system launcher
3. **macOS**: Open "Safari" or "Chrome" or "Firefox" via Spotlight
4. **Windows**: Open "Chrome" or "Edge" or "Firefox" via Windows Search
5. **After browser opens**: Wait 1000ms
6. **ALWAYS open new tab FIRST** - Cmd+T (Mac) or Ctrl+T (Windows)
7. **Wait 500ms for new tab to open**
8. **Then navigate**: Cmd+L/Ctrl+L to focus address bar, type URL, press Enter
9. **NEVER overwrite user's existing tabs** - always start with fresh new tab

**CRITICAL: Multi-Site Browser Workflows**
When visiting MULTIPLE websites in one command (e.g., "Go to YouTube then Gmail"):
1. **First site**: Open browser → **Cmd+T (new tab!)** → navigate to first URL
2. **Second site onwards**: **Cmd+T (new tab!)** → navigate to next URL
3. **NEVER use Cmd+L without Cmd+T first** - always open new tab before navigating
4. **Example**: YouTube → Gmail = Open browser → **Cmd+T** → YouTube → **Cmd+T** → Gmail

**Examples of web/browser queries:**
- "search for winter clothes on Amazon" → Open browser → search on Amazon
- "find restaurants near me" → Open browser → Google search
- "go to youtube.com" → Open browser → navigate to URL
- "search for JavaScript tutorials" → Open browser → Google search
- "check my email" → Open browser → go to email provider
- "go to YouTube then Gmail" → Open browser → YouTube → **Cmd+T (new tab!)** → Gmail

**Multi-Step Workflows:**
When a command requires multiple steps within an app (e.g., "open Slack, find user Chris, DM him hello"):
1. **Open the app first**
   - macOS: Cmd+Space, type app name, Enter
   - Windows: Win key, type app name, Enter
2. **Wait for app to load** (500-1000ms)
3. **Use in-app search**
   - macOS: Cmd+K or Cmd+F for most apps
   - Windows: Ctrl+K or Ctrl+F for most apps
4. **Type search query** (person name, channel name, etc.)
5. **Wait for results** (300-500ms)
6. **Navigate results** (Arrow keys: Key.Up, Key.Down)
7. **Select result** (Enter)
8. **Wait for view to load** (300-500ms)
9. **Type message/content** (keyboard.type())
10. **Send/Submit**
    - macOS: Enter or Cmd+Enter
    - Windows: Enter or Ctrl+Enter

**Slack-Specific Patterns:**
- **Open Slack search**:
  - macOS: Cmd+K (Key.LeftSuper + Key.K)
  - Windows: Ctrl+K (Key.LeftControl + Key.K)
- **Navigate to DM**: Search → type person name → Enter
- **Navigate to channel**: Search → type "#channel-name" → Enter
- **Send message**: Type message → Enter
- **New line without sending**:
  - macOS: Shift+Enter or Cmd+Enter
  - Windows: Shift+Enter or Ctrl+Enter
- **Always wait 500ms after opening search** before typing

**Outlook-Specific Patterns:**
- **New email**:
  - macOS: Cmd+N (Key.LeftSuper + Key.N)
  - Windows: Ctrl+N (Key.LeftControl + Key.N)
- **Search emails**:
  - macOS: Cmd+Option+F or Cmd+E
  - Windows: Ctrl+E or F3
- **Reply to email**:
  - macOS: Cmd+R
  - Windows: Ctrl+R
- **Reply all**:
  - macOS: Cmd+Shift+R
  - Windows: Ctrl+Shift+R
- **Forward email**:
  - macOS: Cmd+J
  - Windows: Ctrl+F
- **Send email**:
  - macOS: Cmd+Enter
  - Windows: Ctrl+Enter or Alt+S
- **To field**: Type recipient → wait 300ms → Arrow keys to select → Enter
- **Subject field**: Press Tab after adding recipient
- **Body field**: Press Tab again
- **Always wait 800ms after Cmd+N/Ctrl+N** for compose window to load

**VS Code-Specific Patterns:**
- **Quick Open (files)**:
  - macOS: Cmd+P (Key.LeftSuper + Key.P)
  - Windows: Ctrl+P (Key.LeftControl + Key.P)
- **Command Palette**:
  - macOS: Cmd+Shift+P
  - Windows: Ctrl+Shift+P
- **Search in files**:
  - macOS: Cmd+Shift+F
  - Windows: Ctrl+Shift+F
- **New file**:
  - macOS: Cmd+N
  - Windows: Ctrl+N
- **Save file**:
  - macOS: Cmd+S
  - Windows: Ctrl+S

**Discord-Specific Patterns:**
- **Quick Switcher (search)**:
  - macOS: Cmd+K (Key.LeftSuper + Key.K)
  - Windows: Ctrl+K (Key.LeftControl + Key.K)
- **Navigate to DM**: Search → type username → Enter
- **Navigate to server/channel**: Search → type server/channel name → Enter
- **Send message**: Type message → Enter
- **New line without sending**: Shift+Enter

**Microsoft Teams-Specific Patterns:**
- **Search**:
  - macOS: Cmd+E (Key.LeftSuper + Key.E)
  - Windows: Ctrl+E (Key.LeftControl + Key.E)
- **New chat**:
  - macOS: Cmd+N
  - Windows: Ctrl+N
- **Send message**:
  - macOS: Cmd+Enter
  - Windows: Ctrl+Enter
- **New line**: Shift+Enter

**Browser-Specific Patterns (Chrome, Firefox, Safari, Edge):**
- **New tab**:
  - macOS: Cmd+T
  - Windows: Ctrl+T
- **Close tab**:
  - macOS: Cmd+W
  - Windows: Ctrl+W
- **Address bar**:
  - macOS: Cmd+L
  - Windows: Ctrl+L or Alt+D
- **Search/Find in page**:
  - macOS: Cmd+F
  - Windows: Ctrl+F
- **Refresh**:
  - macOS: Cmd+R
  - Windows: Ctrl+R or F5
- **Copy URL**: Cmd+L (Mac) or Ctrl+L (Windows), then Cmd+C/Ctrl+C
- **Switch tabs**: Cmd+Option+Right/Left (Mac) or Ctrl+Tab (Windows)

**Gmail Web Interface Patterns - HYBRID APPROACH:**
- **Import vision service**: const { findAndClick } = require('../src/services/visionSpatialService')
- **Use vision AI for buttons** (Compose, Send) - they have clear labels
- **Use Tab navigation for fields** (To, Subject, Body) - they have NO labels or unreliable labels

**Gmail Compose Workflow:**
1. **Open Compose dialog**:
   - Wait 3000ms for Gmail to load
   - Use vision: await findAndClick('Compose', 'button') with 60s timeout
   - Wait 2000ms for compose dialog to render
   
2. **Fill "To" field**:
   - IMPORTANT: Gmail's "To" field has NO label - it's an empty textbox
   - After Compose opens, focus may be on dialog controls (minimize, close, etc.)
   - Press Tab key 2-3 times to ensure we reach the To input field
   - Alternative: Click in the upper area of compose dialog to focus To field
   - Wait 500ms, then type recipient email
   - Press Enter to confirm recipient (moves to next field)
   - Wait 500ms after typing
   
3. **Fill "Subject" field**:
   - Press Tab key to move to Subject field
   - Wait 300ms, then type subject
   - Wait 500ms after typing
   
4. **Fill message body**:
   - Press Tab key to move to message body
   - Wait 300ms, then type message content
   - Wait 500ms after typing
   
5. **Send email**:
   - Use vision: await findAndClick('Send', 'button') with 30s timeout
   - Alternative fallback: Use keyboard shortcut Cmd+Enter (Mac) or Ctrl+Enter (Windows)
   - Wait 1000ms to confirm send

**Why Hybrid Approach**:
- ✅ Vision AI for buttons: Compose and Send have clear, visible labels
- ✅ Tab navigation for fields: To/Subject/Body have no labels or are next to label buttons
- ✅ Faster: Tab is instant, vision takes 12-15 seconds per field
- ✅ More reliable: Tab always works, vision might fail on unlabeled fields

**Vision AI Timeout Pattern**:
- Always wrap findAndClick with Promise.race for timeout
- Use 60s timeout for Compose button (first interaction)
- Use 30s timeout for other fields (To, Subject, Body, Send)
- Check if result is false and throw error if element not found

**Why Vision-First**:
- Works regardless of Gmail UI updates or customization
- Handles different screen sizes and resolutions
- No brittle fixed coordinates that break
- Self-healing - adapts to layout changes
- More reliable than keyboard shortcuts (which can be disabled)

**🌐 WEB APPS & DESKTOP APPS - USE VISION AI:**

**Gmail (Web):**
- Use vision AI for: Compose button, To field, Subject field, Body, Send button
- Keyboard shortcuts ONLY for: Cmd+Enter to send (after filling fields)
- Wait times: 3s for Gmail to load, 2s after Compose click

**YouTube (Web):**
- Use vision AI for: Search box, video thumbnails, subscribe buttons
- Keyboard shortcuts: "/" to focus search (if already on page)
- Wait times: 2s for page load, 2s for search results

**Slack (Desktop App):**
- Use vision AI for: Channel names, user names, message buttons, emoji reactions
- Keyboard shortcuts: Cmd+K for quick switcher (OS-level), Cmd+T for threads
- Wait times: 1s for app to load, 500ms for channel switch

**Outlook (Desktop App):**
- Use vision AI for: New Email button, To field, Subject field, Body, Send button
- Keyboard shortcuts: Cmd+N for new email (OS-level), Cmd+Enter to send
- Wait times: 2s for Outlook to load, 1s for compose window

**Discord (Desktop App):**
- Use vision AI for: Server icons, channel names, user names, buttons
- Keyboard shortcuts: Cmd+K for quick switcher (OS-level)
- Wait times: 1s for server switch, 500ms for channel load

**VS Code (Desktop App):**
- Use vision AI for: File explorer items, buttons, menu items
- Keyboard shortcuts: Cmd+P for file search, Cmd+Shift+P for command palette
- Wait times: 500ms for file open, 300ms for command palette

**Notion (Desktop App):**
- Use vision AI for: Page titles, blocks, buttons, database items
- Keyboard shortcuts: Cmd+P for quick find (OS-level), "/" for slash commands
- Wait times: 1s for page load, 500ms for block creation

**General Rule for ALL Apps:**
- ✅ Use vision AI to FIND and CLICK UI elements
- ✅ Use keyboard shortcuts ONLY for OS-level operations (open, close, save, copy, paste)
- ✅ Use keyboard.type() to TYPE text after vision AI clicks the input field
- ❌ NEVER use fixed coordinates - they break on different screens

**File Explorer/Finder Patterns:**
- **New folder**:
  - macOS: Cmd+Shift+N
  - Windows: Ctrl+Shift+N
- **Search**:
  - macOS: Cmd+F
  - Windows: Ctrl+F or F3
- **Go to location**:
  - macOS: Cmd+Shift+G
  - Windows: Ctrl+L (address bar)

${visionContext}**User Command:** ${command}

**CRITICAL: Extract Values from User Command**
The examples below use placeholder values like "example@gmail.com" or "bitfarm stock" - these are TEMPLATES ONLY.
You MUST extract the actual values from the user's command above and use those in your generated code.

Examples:
- User says "email to me at john@company.com" → Use "john@company.com", NOT "example@gmail.com"
- User says "search for AI trends" → Use "AI trends", NOT "bitfarm stock"
- User says "subject line: Meeting Notes" → Use "Meeting Notes", NOT template subject
- ALWAYS use the user's actual values, NEVER use example placeholder values

**Output Format:**
Return ONLY the JavaScript code block without markdown fences. Start directly with the require statement.

**CORRECT Example for "search for winter clothes on Amazon" (Web Search):**
\`\`\`
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

(async () => {
  try {
    const isMac = process.platform === 'darwin';
    
    // Step 1: Open browser (Chrome as default)
    if (isMac) {
      // macOS: Use Spotlight
      await keyboard.pressKey(Key.LeftSuper, Key.Space);
      await keyboard.releaseKey(Key.LeftSuper, Key.Space);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("chrome");
    } else {
      // Windows: Use Windows Search
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.releaseKey(Key.LeftSuper);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("chrome");
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    // Step 2: Wait for browser to open
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Step 3: Focus address bar
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.L);
      await keyboard.releaseKey(Key.LeftSuper, Key.L);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.L);
      await keyboard.releaseKey(Key.LeftControl, Key.L);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 4: Type Amazon search URL
    await keyboard.type("amazon.com/s?k=winter+clothes");
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 5: Navigate to URL
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    console.log('Amazon search completed successfully');
  } catch (error) {
    console.error('Failed to search Amazon:', error);
    throw error;
  }
})();
\`\`\`

**CORRECT Example for "open terminal" (App Launch):**
\`\`\`
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

(async () => {
  try {
    const isMac = process.platform === 'darwin';
    
    if (isMac) {
      // macOS: Use Spotlight (Cmd+Space)
      await keyboard.pressKey(Key.LeftSuper, Key.Space);
      await keyboard.releaseKey(Key.LeftSuper, Key.Space);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("terminal");
    } else {
      // Windows: Use Windows Search (Win key)
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.releaseKey(Key.LeftSuper);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("cmd");  // Windows uses "cmd" or "powershell"
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    console.log('Terminal opened successfully');
  } catch (error) {
    console.error('Failed to open terminal:', error);
    throw error;
  }
})();
\`\`\`

**CORRECT Example for "open Slack, DM Chris saying hello" (Cross-Platform):**
\`\`\`
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

(async () => {
  try {
    const isMac = process.platform === 'darwin';
    
    // Step 1: Open Slack
    if (isMac) {
      // macOS: Spotlight
      await keyboard.pressKey(Key.LeftSuper, Key.Space);
      await keyboard.releaseKey(Key.LeftSuper, Key.Space);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("slack");
    } else {
      // Windows: Windows Search
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.releaseKey(Key.LeftSuper);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("slack");
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    // Step 2: Wait for Slack to fully load
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Step 3: Open Slack quick search
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.K);  // Cmd+K
      await keyboard.releaseKey(Key.LeftSuper, Key.K);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.K);  // Ctrl+K
      await keyboard.releaseKey(Key.LeftControl, Key.K);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 4: Search for user "Chris"
    await keyboard.type("Chris");
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 5: Select first result (usually the person)
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 6: Type message in DM
    await keyboard.type("hello");
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Step 7: Send message
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    console.log('Message sent to Chris successfully');
  } catch (error) {
    console.error('Failed to send Slack message:', error);
    throw error;
  }
})();
\`\`\`

**CORRECT Example for "open Outlook and email John saying 'Meeting at 3pm'" (Cross-Platform):**
\`\`\`
const { keyboard, Key } = require('@nut-tree-fork/nut-js');

(async () => {
  try {
    const isMac = process.platform === 'darwin';
    
    // Step 1: Open Outlook
    if (isMac) {
      // macOS: Spotlight
      await keyboard.pressKey(Key.LeftSuper, Key.Space);
      await keyboard.releaseKey(Key.LeftSuper, Key.Space);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("outlook");
    } else {
      // Windows: Windows Search
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.releaseKey(Key.LeftSuper);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("outlook");
    }
    
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    
    // Step 2: Wait for Outlook to fully load
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 3: Open new email compose window
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.N);  // Cmd+N
      await keyboard.releaseKey(Key.LeftSuper, Key.N);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.N);  // Ctrl+N
      await keyboard.releaseKey(Key.LeftControl, Key.N);
    }
    await new Promise(resolve => setTimeout(resolve, 800));
    
    // Step 4: Type recipient name in To field
    await keyboard.type("John");
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 5: Select recipient from suggestions (first result)
    await keyboard.pressKey(Key.Down);
    await keyboard.releaseKey(Key.Down);
    await new Promise(resolve => setTimeout(resolve, 200));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 6: Tab to subject field
    await keyboard.pressKey(Key.Tab);
    await keyboard.releaseKey(Key.Tab);
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Step 7: Type subject (optional, can skip to body)
    await keyboard.type("Quick Update");
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Step 8: Tab to body field
    await keyboard.pressKey(Key.Tab);
    await keyboard.releaseKey(Key.Tab);
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // Step 9: Type email body
    await keyboard.type("Meeting at 3pm");
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 10: Send email
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.Enter);  // Cmd+Enter
      await keyboard.releaseKey(Key.LeftSuper, Key.Enter);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.Enter);  // Ctrl+Enter
      await keyboard.releaseKey(Key.LeftControl, Key.Enter);
    }
    
    console.log('Email sent to John successfully');
  } catch (error) {
    console.error('Failed to send Outlook email:', error);
    throw error;
  }
})();
\`\`\`

**CORRECT Example for "Go to YouTube, search for bitfarm stock, copy link, email to me at example@gmail.com" (Web Workflow with Vision Fallback):**
**NOTE: This example uses "bitfarm stock" and "example@gmail.com" because that's what the example command asks for. YOU must use the actual values from YOUR user's command!**
\`\`\`
const { keyboard, Key, mouse, straightTo, Point, Region, Button } = require('@nut-tree-fork/nut-js');
const { findAndClick } = require('../src/services/visionSpatialService');

(async () => {
  try {
    const isMac = process.platform === 'darwin';
    
    // Step 1: Open browser
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.Space);
      await keyboard.releaseKey(Key.LeftSuper, Key.Space);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("chrome");
    } else {
      await keyboard.pressKey(Key.LeftSuper);
      await keyboard.releaseKey(Key.LeftSuper);
      await new Promise(resolve => setTimeout(resolve, 500));
      await keyboard.type("chrome");
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 1500));
    
    // Step 2: Open new tab FIRST (don't overwrite user's existing tabs!)
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.T);
      await keyboard.releaseKey(Key.LeftSuper, Key.T);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.T);
      await keyboard.releaseKey(Key.LeftControl, Key.T);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 3: Navigate to YouTube
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.L);
      await keyboard.releaseKey(Key.LeftSuper, Key.L);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.L);
      await keyboard.releaseKey(Key.LeftControl, Key.L);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.type("youtube.com");
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 4: Search on YouTube (use search box, NOT address bar!)
    await keyboard.type("/");  // Focus YouTube search box
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.type("bitfarm stock");
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Step 5: Copy current page URL (search results page)
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.L);
      await keyboard.releaseKey(Key.LeftSuper, Key.L);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.L);
      await keyboard.releaseKey(Key.LeftControl, Key.L);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.C);
      await keyboard.releaseKey(Key.LeftSuper, Key.C);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.C);
      await keyboard.releaseKey(Key.LeftControl, Key.C);
    }
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 6: Open Gmail in new tab (MUST open new tab, don't overwrite current!)
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.T);
      await keyboard.releaseKey(Key.LeftSuper, Key.T);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.T);
      await keyboard.releaseKey(Key.LeftControl, Key.T);
    }
    await new Promise(resolve => setTimeout(resolve, 500));
    await keyboard.type("mail.google.com");
    await keyboard.pressKey(Key.Enter);
    await keyboard.releaseKey(Key.Enter);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Step 7: Click Compose button - USE VISION AI with timeout
    console.log('[Gmail] Looking for Compose button...');
    
    // Add 60-second timeout to vision call (vision API can take 12-15 seconds + processing + retries)
    const composePromise = findAndClick('Compose', 'button');
    const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(false), 60000));
    const composeSuccess = await Promise.race([composePromise, timeoutPromise]);
    
    if (!composeSuccess) {
      console.error('[Gmail] Vision AI failed or timed out - check VISION_PROVIDER and API keys in .env');
      throw new Error('Could not find Gmail Compose button (vision timeout or API key missing)');
    }
    
    console.log('[Gmail] Compose button clicked, waiting for dialog...');
    await new Promise(resolve => setTimeout(resolve, 2000)); // Wait for compose dialog to render
    
    // Step 8: Focus "To" field (Gmail's To field has NO label - use Tab to focus)
    console.log('[Gmail] Focusing To field with Tab key...');
    // Tab multiple times to ensure we reach the To input field (focus might be on dialog controls)
    await keyboard.pressKey(Key.Tab);
    await keyboard.releaseKey(Key.Tab);
    await new Promise(resolve => setTimeout(resolve, 300));
    await keyboard.pressKey(Key.Tab);
    await keyboard.releaseKey(Key.Tab);
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 9: Type recipient (use actual email from user's command!)
    await keyboard.type("example@gmail.com");
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Press Enter to confirm recipient and move to Subject field
    console.log('[Gmail] Confirming recipient with Enter...');
    await keyboard.pressKey(Key.Return);
    await keyboard.releaseKey(Key.Return);
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 10: Type subject (already in Subject field after Enter)
    console.log('[Gmail] Typing subject...');
    
    // Step 11: Type subject
    await keyboard.type("Bitfarm Stock Videos");
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // Step 12: Focus message body (Tab to next field)
    console.log('[Gmail] Focusing message body with Tab key...');
    await keyboard.pressKey(Key.Tab);
    await keyboard.releaseKey(Key.Tab);
    await new Promise(resolve => setTimeout(resolve, 300));
    
    // Step 13: Type body and paste YouTube link
    await keyboard.type("Here are the search results for bitfarm stock: ");
    await new Promise(resolve => setTimeout(resolve, 200));
    if (isMac) {
      await keyboard.pressKey(Key.LeftSuper, Key.V);  // Paste
      await keyboard.releaseKey(Key.LeftSuper, Key.V);
    } else {
      await keyboard.pressKey(Key.LeftControl, Key.V);
      await keyboard.releaseKey(Key.LeftControl, Key.V);
    }
    await new Promise(resolve => setTimeout(resolve, 1500)); // Wait longer for compose dialog to fully render
    
    // Step 14: Send email using VISION AI
    console.log('[Gmail] Looking for Send button (forcing fresh screenshot)...');
    const sendPromise = findAndClick('Send', 'button');
    const sendTimeout = new Promise((resolve) => setTimeout(() => resolve(false), 30000));
    const sendSuccess = await Promise.race([sendPromise, sendTimeout]);
    
    if (!sendSuccess) {
      // Fallback to keyboard shortcut if vision fails
      console.log('[Gmail] Vision failed for Send button, using keyboard shortcut...');
      if (isMac) {
        await keyboard.pressKey(Key.LeftSuper, Key.Enter);
        await keyboard.releaseKey(Key.LeftSuper, Key.Enter);
      } else {
        await keyboard.pressKey(Key.LeftControl, Key.Enter);
        await keyboard.releaseKey(Key.LeftControl, Key.Enter);
      }
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('YouTube search results emailed successfully');
  } catch (error) {
    console.error('Failed to complete YouTube to Gmail workflow:', error);
    throw error;
  }
})();
\`\`\`

**WRONG Example (DO NOT DO THIS):**
\`\`\`
// ❌ WRONG: Keys not released before typing
await keyboard.pressKey(Key.LeftSuper);
await keyboard.type("slack");  // This types Cmd+S, Cmd+L, etc. NOT "slack"!
await keyboard.releaseKey(Key.LeftSuper);

// ❌ WRONG: No wait times between steps
await keyboard.pressKey(Key.LeftSuper, Key.K);
await keyboard.type("Chris");  // Too fast! Search box not ready yet
await keyboard.pressKey(Key.Enter);

// ❌ WRONG: Trying to navigate to channel then DM (inefficient)
await keyboard.type("#dropaprayer");  // Don't need channel if DMing a person
\`\`\`

**Additional App-Specific Examples:**

**Outlook - Send email:**
- Cmd+N → type recipient → Down → Enter → Tab → type subject → Tab → type body → Cmd+Enter

**Outlook - Reply to email:**
- Select email → Cmd+R → type reply → Cmd+Enter

**Outlook - Search emails:**
- Cmd+Option+F → type search query → Enter

**Discord - DM user:**
- Cmd+K → type username → Enter → type message → Enter

**VS Code - Open file:**
- Cmd+P → type filename → Enter

**Browser - New tab and search:**
- Cmd+T → type search query → Enter

**Finder - Search for file:**
- Cmd+Space → type "finder" → Enter → Cmd+F → type filename

**Notes/Reminders - Create note:**
- Open app → Cmd+N → type title → Tab → type content

**Calendar - Create event:**
- Open Calendar → Cmd+N → type title → Tab → set date/time → Cmd+S

Now generate the code for: ${command}`;
  }

  /**
   * Generate Nut.js code using Grok (primary)
   * Supports vision-enhanced generation with screenshot context
   */
  private async generateWithGrok(command: string, screenshot?: ScreenshotData): Promise<NutjsCodeResponse> {
    if (!this.grokClient) {
      throw new Error('Grok client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!screenshot;
    const prompt = this.buildNutjsPrompt(command, hasScreenshot);

    try {
      logger.info('Generating Nut.js code with Grok', { command, hasScreenshot });

      // Use vision model if screenshot provided, otherwise use standard model
      // grok-4 supports both text and vision (multimodal)
      // grok-2-latest is text-only but faster
      const model = hasScreenshot ? 'grok-4' : (this.useGrok4 ? 'grok-4' : 'grok-2-latest');
      logger.info(`Using Grok model: ${model}`, { useGrok4: this.useGrok4, vision: hasScreenshot });
      
      // Build message content - multimodal if screenshot provided
      // Using OpenAI-compatible format (xAI supports both OpenAI and native formats)
      const userContent: any = hasScreenshot ? [
        {
          type: 'image_url',
          image_url: {
            url: `data:${screenshot.mimeType || 'image/png'};base64,${screenshot.base64}`,
            detail: 'low', // Use 'low' for faster processing (vs 'high' or 'auto')
          },
        },
        {
          type: 'text',
          text: prompt,
        },
      ] : prompt;
      
      const response = await this.grokClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a Nut.js code generation expert. Generate ONLY executable Nut.js code without any explanations or markdown.',
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
        temperature: 0.2, // Very low for fastest generation
        max_tokens: hasScreenshot ? 1000 : 800, // Aggressive reduction for speed
        stream: false,
        top_p: 0.9, // Slightly reduce sampling space for faster generation
        // Add unique user identifier to prevent caching
        user: `nutjs_${Date.now()}`,
      });

      const code = response.choices[0]?.message?.content?.trim() || '';
      const latencyMs = Date.now() - startTime;

      // Clean up markdown code fences if present
      const cleanedCode = this.cleanCodeOutput(code);

      logger.info('Grok generated Nut.js code successfully', {
        command,
        latencyMs,
        codeLength: cleanedCode.length,
      });

      return {
        code: cleanedCode,
        provider: 'grok',
        latencyMs,
        usedVision: hasScreenshot,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Grok code generation failed', {
        command,
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate Nut.js code using Claude (fallback)
   * Supports vision-enhanced generation with screenshot context
   */
  private async generateWithClaude(command: string, screenshot?: ScreenshotData, context?: any): Promise<NutjsCodeResponse> {
    if (!this.claudeClient) {
      throw new Error('Claude client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!screenshot;
    const prompt = this.buildNutjsPrompt(command, hasScreenshot, context);

    try {
      // Log screenshot hash for debugging (use middle section to avoid PNG header)
      const screenshotHash = screenshot ? screenshot.base64.substring(100, 132) : 'none';
      const screenshotSize = screenshot ? screenshot.base64.length : 0;
      logger.info('Generating Nut.js code with Claude (fallback)', { 
        command, 
        hasScreenshot,
        screenshotHash,
        screenshotSize,
        responseMode: context?.responseMode,
        isTypeOnly: context?.responseMode === 'type-only',
        timestamp: Date.now()
      });

      // Build message content - multimodal if screenshot provided
      const messageContent: any = hasScreenshot ? [
        {
          type: 'image',
          source: {
            type: 'base64',
            media_type: screenshot.mimeType || 'image/png',
            data: screenshot.base64,
          },
        },
        {
          type: 'text',
          text: prompt,
        },
      ] : prompt;

      const response = await this.claudeClient.messages.create({
        model: 'claude-sonnet-4-20250514', // Latest Claude Sonnet 4
        max_tokens: hasScreenshot ? 1000 : 800, // Optimized for speed
        temperature: 0.2, // Lower for faster generation
        messages: [
          {
            role: 'user',
            content: messageContent,
          },
        ],
        // Add metadata to prevent caching
        metadata: {
          user_id: `nutjs_${Date.now()}`,
        },
      });

      const code = response.content[0]?.type === 'text' ? response.content[0].text.trim() : '';
      const latencyMs = Date.now() - startTime;

      // Clean up markdown code fences if present
      const cleanedCode = this.cleanCodeOutput(code);

      logger.info('Claude generated Nut.js code successfully', {
        command,
        latencyMs,
        codeLength: cleanedCode.length,
      });

      return {
        code: cleanedCode,
        provider: 'claude',
        latencyMs,
        usedVision: hasScreenshot,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Claude code generation failed', {
        command,
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate Nut.js code using OpenAI GPT-4 Vision
   */
  private async generateWithOpenAI(command: string, screenshot?: ScreenshotData): Promise<NutjsCodeResponse> {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const startTime = Date.now();
    const hasScreenshot = !!screenshot;
    const prompt = this.buildNutjsPrompt(command, hasScreenshot);

    try {
      logger.info('Generating Nut.js code with OpenAI GPT-4V', { command, hasScreenshot });

      // Use GPT-4o (supports vision) - faster and cheaper than gpt-4-turbo
      const model = 'gpt-4o'; // gpt-4o supports both text and vision
      
      // Build message content - multimodal if screenshot provided
      const userContent: any = hasScreenshot ? [
        {
          type: 'image_url',
          image_url: {
            url: `data:${screenshot.mimeType || 'image/png'};base64,${screenshot.base64}`,
            detail: 'low', // Use 'low' for faster processing
          },
        },
        {
          type: 'text',
          text: prompt,
        },
      ] : prompt;

      const response = await this.openaiClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are a Nut.js code generation expert. Generate ONLY executable Nut.js code without any explanations or markdown.',
          },
          {
            role: 'user',
            content: userContent,
          },
        ],
        temperature: 0.2,
        max_tokens: hasScreenshot ? 1000 : 800,
        // Add unique user identifier to prevent caching
        user: `nutjs_${Date.now()}`,
      });

      const code = response.choices[0]?.message?.content?.trim() || '';
      const latencyMs = Date.now() - startTime;

      // Clean up markdown code fences if present
      const cleanedCode = this.cleanCodeOutput(code);

      logger.info('OpenAI generated Nut.js code successfully', {
        command,
        latencyMs,
        codeLength: cleanedCode.length,
      });

      return {
        code: cleanedCode,
        provider: 'openai',
        latencyMs,
        usedVision: hasScreenshot,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('OpenAI code generation failed', {
        command,
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Clean up code output by removing markdown fences and extra whitespace
   */
  private cleanCodeOutput(code: string): string {
    // Remove markdown code fences
    let cleaned = code.replace(/```(?:javascript|js|typescript|ts)?\n?/g, '').replace(/```\n?/g, '');
    
    // Trim whitespace
    cleaned = cleaned.trim();
    
    return cleaned;
  }

  /**
   * Build prompt for structured automation plan generation
   */
  private buildStructuredPlanPrompt(command: string): string {
    const os = process.platform === 'darwin' ? 'darwin' : 'win32';
    
    return `You are an expert at creating structured automation plans for desktop tasks.

**USER COMMAND:** "${command}"

**YOUR TASK:** Generate a detailed, step-by-step automation plan as a JSON object.

**CRITICAL RULES:**
1. Return ONLY valid JSON - no markdown, no explanations, no code fences
2. Each step must have executable Nut.js code
3. Use CommonJS require() syntax: const { keyboard, Key } = require('@nut-tree-fork/nut-js');
4. Import vision service: const { findAndClick } = require('../src/services/visionSpatialService');
5. Use vision AI (findAndClick) for ALL GUI interactions (buttons, links, fields)
6. Use keyboard shortcuts ONLY for OS-level operations (Cmd+Space, Cmd+Tab, etc.)
7. Include verification strategy for each step
8. Provide alternative strategies (different labels, keyboard shortcuts)
9. Target OS: ${os} (darwin = macOS, win32 = Windows)
10. **DESKTOP vs WEB APP DETECTION**:
    - If user says "desktop app", "calendar app", "mail app", "native app" → Open native macOS/Windows app (Calendar, Mail, etc.)
    - If user says "gmail", "google calendar", "web", "online", or mentions a website → Use browser workflow
    - For macOS Calendar: Open Spotlight → Type "Calendar" → Press Return
    - For macOS Mail: Open Spotlight → Type "Mail" → Press Return
11. **MANDATORY BROWSER WORKFLOW**: For web-based tasks ONLY (Gmail, Amazon, Slack, Google Calendar web):
    - Step 1: Open Spotlight (Cmd+Space on Mac, Win key on Windows)
    - Step 2: Type "Chrome" or "Safari" to launch browser
    - Step 3: Press Return to open browser
    - Step 4: Wait 2000ms for browser to open
    - Step 5: Open new tab (Cmd+T/Ctrl+T)
    - Step 6: Navigate to URL (Cmd+L, type URL, press Return)
    - NEVER skip these steps - ALWAYS open browser first before any web navigation

**JSON STRUCTURE:**
{
  "steps": [
    {
      "id": 1,
      "description": "Human-readable description",
      "action": "click_button" | "fill_field" | "navigate_url" | "wait" | "press_key" | "open_app" | "focus_window",
      "target": "Element label/text to find",
      "role": "button" | "input" | "textbox" | "link" | "textarea",
      "value": "Text to type (for fill_field)",
      "url": "URL to navigate (for navigate_url)",
      "code": "EXAMPLES:
        - click_button: await findAndClick('Compose', 'button')
        - fill_field: await findAndClick('Search', 'input'); await keyboard.type('search term here');
        - press_key: await keyboard.pressKey(Key.Return); await keyboard.releaseKey(Key.Return);",
      "verification": "compose_dialog_visible" | "element_visible" | "field_filled" | "button_enabled" | "none",
      "alternativeLabel": "Alternative text to search for",
      "alternativeRole": "Alternative role to try",
      "keyboardShortcut": "await keyboard.type('c')",
      "waitAfter": 2000,
      "maxRetries": 3,
      "verificationContext": {
        "expectedText": "Text that should appear",
        "shouldSeeElement": "Element that should be visible"
      }
    }
  ],
  "maxRetriesPerStep": 3,
  "totalTimeout": 300000
}

**CRITICAL: For fill_field actions, ALWAYS include BOTH findAndClick() AND keyboard.type()!**

**EXAMPLE FOR "Send email from Gmail about AI trends":**
{
  "steps": [
    {
      "id": 1,
      "description": "Open Spotlight to launch browser",
      "action": "press_key",
      "code": "const isMac = process.platform === 'darwin'; if (isMac) { await keyboard.pressKey(Key.LeftSuper, Key.Space); await keyboard.releaseKey(Key.LeftSuper, Key.Space); } else { await keyboard.pressKey(Key.LeftWin); await keyboard.releaseKey(Key.LeftWin); }",
      "verification": "none",
      "waitAfter": 500,
      "maxRetries": 1
    },
    {
      "id": 2,
      "description": "Type Chrome to open browser",
      "action": "fill_field",
      "value": "Chrome",
      "code": "await keyboard.type('Chrome');",
      "verification": "none",
      "waitAfter": 500,
      "maxRetries": 1
    },
    {
      "id": 3,
      "description": "Press Return to launch Chrome",
      "action": "press_key",
      "code": "await keyboard.pressKey(Key.Return); await keyboard.releaseKey(Key.Return);",
      "verification": "none",
      "waitAfter": 2000,
      "maxRetries": 1
    },
    {
      "id": 4,
      "description": "Open new browser tab",
      "action": "press_key",
      "code": "const isMac = process.platform === 'darwin'; if (isMac) { await keyboard.pressKey(Key.LeftSuper, Key.T); await keyboard.releaseKey(Key.LeftSuper, Key.T); } else { await keyboard.pressKey(Key.LeftControl, Key.T); await keyboard.releaseKey(Key.LeftControl, Key.T); }",
      "verification": "none",
      "waitAfter": 1000,
      "maxRetries": 1
    },
    {
      "id": 5,
      "description": "Navigate to Gmail",
      "action": "navigate_url",
      "url": "https://mail.google.com",
      "code": "const isMac = process.platform === 'darwin'; if (isMac) { await keyboard.pressKey(Key.LeftSuper, Key.L); await keyboard.releaseKey(Key.LeftSuper, Key.L); } else { await keyboard.pressKey(Key.LeftControl, Key.L); await keyboard.releaseKey(Key.LeftControl, Key.L); } await new Promise(resolve => setTimeout(resolve, 500)); await keyboard.type('https://mail.google.com'); await keyboard.pressKey(Key.Return); await keyboard.releaseKey(Key.Return);",
      "verification": "element_visible",
      "verificationContext": {
        "shouldSeeElement": "Compose"
      },
      "waitAfter": 3000,
      "maxRetries": 2
    },
    {
      "id": 6,
      "description": "Click Compose button",
      "action": "click_button",
      "target": "Compose",
      "role": "button",
      "code": "const { findAndClick } = require('../src/services/visionSpatialService'); const composePromise = findAndClick('Compose', 'button'); const composeTimeout = new Promise((resolve) => setTimeout(() => resolve(false), 60000)); const composeSuccess = await Promise.race([composePromise, composeTimeout]); if (!composeSuccess) { const isMac = process.platform === 'darwin'; if (isMac) { await keyboard.type('g'); await new Promise(resolve => setTimeout(resolve, 200)); await keyboard.type('c'); } else { await keyboard.type('c'); } }",
      "verification": "compose_dialog_visible",
      "alternativeLabel": "New message",
      "keyboardShortcut": "await keyboard.type('c')",
      "waitAfter": 2000,
      "maxRetries": 3
    },
    {
      "id": 7,
      "description": "Focus To field and enter recipient",
      "action": "fill_field",
      "target": "To",
      "value": "EXTRACT_FROM_COMMAND",
      "code": "await keyboard.pressKey(Key.Tab); await keyboard.releaseKey(Key.Tab); await new Promise(resolve => setTimeout(resolve, 300)); await keyboard.pressKey(Key.Tab); await keyboard.releaseKey(Key.Tab); await new Promise(resolve => setTimeout(resolve, 300)); await keyboard.type('recipient@example.com'); await keyboard.pressKey(Key.Return); await keyboard.releaseKey(Key.Return);",
      "verification": "recipient_added",
      "waitAfter": 500,
      "maxRetries": 2
    },
    {
      "id": 8,
      "description": "Enter subject",
      "action": "fill_field",
      "target": "Subject",
      "value": "EXTRACT_FROM_COMMAND",
      "code": "await keyboard.type('Latest AI Trends'); await new Promise(resolve => setTimeout(resolve, 500));",
      "verification": "field_filled",
      "waitAfter": 500,
      "maxRetries": 2
    },
    {
      "id": 9,
      "description": "Enter email body",
      "action": "fill_field",
      "target": "Body",
      "value": "EXTRACT_FROM_COMMAND",
      "code": "await keyboard.pressKey(Key.Tab); await keyboard.releaseKey(Key.Tab); await new Promise(resolve => setTimeout(resolve, 300)); await keyboard.type('Here are the latest trends in AI technology...'); await new Promise(resolve => setTimeout(resolve, 500));",
      "verification": "field_filled",
      "waitAfter": 500,
      "maxRetries": 2
    },
    {
      "id": 10,
      "description": "Click Send button",
      "action": "click_button",
      "target": "Send",
      "role": "button",
      "code": "const sendPromise = findAndClick('Send', 'button'); const sendTimeout = new Promise((resolve) => setTimeout(() => resolve(false), 30000)); const sendSuccess = await Promise.race([sendPromise, sendTimeout]); if (!sendSuccess) { const isMac = process.platform === 'darwin'; if (isMac) { await keyboard.pressKey(Key.LeftSuper, Key.Return); await keyboard.releaseKey(Key.LeftSuper, Key.Return); } else { await keyboard.pressKey(Key.LeftControl, Key.Return); await keyboard.releaseKey(Key.LeftControl, Key.Return); } }",
      "verification": "email_sent",
      "keyboardShortcut": "const isMac = process.platform === 'darwin'; if (isMac) { await keyboard.pressKey(Key.LeftSuper, Key.Return); await keyboard.releaseKey(Key.LeftSuper, Key.Return); } else { await keyboard.pressKey(Key.LeftControl, Key.Return); await keyboard.releaseKey(Key.LeftControl, Key.Return); }",
      "waitAfter": 1500,
      "maxRetries": 2
    }
  ],
  "maxRetriesPerStep": 3,
  "totalTimeout": 300000
}

**IMPORTANT NOTES:**
- **CRITICAL**: EVERY browser workflow MUST start with opening a new tab (Cmd+T/Ctrl+T) as Step 1
- **NEVER** type URLs directly without opening a new tab first - this will type in the wrong field
- **CRITICAL**: For fill_field actions, code MUST include BOTH:
  1. await findAndClick('FieldName', 'input') - to focus the field
  2. await keyboard.type('value to type') - to type the text
  Example: await findAndClick('Search', 'input'); await keyboard.type('search term');
- Extract actual values from user command (recipient email, subject, body content, search terms)
- If user doesn't specify recipient, use placeholder and note in description
- Use Tab navigation for Gmail fields (To, Subject, Body) - they have no labels
- Use vision AI for buttons (Compose, Send) - they have clear labels
- Include proper waits between steps (at least 1000ms after opening new tab)
- Provide keyboard shortcuts as fallbacks for critical actions
- **GOOGLE CALENDAR**: Use keyboard shortcut 'c' to create new event (more reliable than clicking Create button)
- **GOOGLE CALENDAR**: After pressing 'c', wait 2000ms, then title field is auto-focused - just type title directly
- **GOOGLE CALENDAR**: Date field shows current date (e.g., "Nov 12, 2025") - click this INPUT field to change date
- **GOOGLE CALENDAR**: When clicking date, use findAndClick with the actual date text (e.g., "Nov 12, 2025", not "Date")
- **GOOGLE CALENDAR**: After clicking date field, type the calculated date in format "12/4/2025" or "December 4, 2025"
- **MACOS CALENDAR**: After Cmd+N, wait 1000ms, title field is auto-focused - just type title (no click needed)
- **MACOS CALENDAR**: After typing title, press Tab to move to date/time fields
- **DATE CALCULATION REQUIRED**: Parse natural language dates and calculate actual dates:
  - "next month Wednesday" → Find first Wednesday of next month (e.g., today is Nov 12, 2025 → Dec 3, 2025 is first Wed)
  - "next month on a wed" → Same as above
  - "next week" → Add 7 days to current date
  - Always output calculated date in MM/DD/YYYY format (e.g., "12/3/2025")
- **CRITICAL**: NEVER put date/time info in the title - only put the event description (e.g., "Dentist Appointment")

Now generate the JSON plan for the user's command. Return ONLY the JSON object, no other text.`;
  }

  /**
   * Generate structured automation plan with automatic fallback
   * Tries Grok first, falls back to Claude if Grok fails
   */
  async generatePlan(command: string): Promise<AutomationPlanResponse> {
    const errors: string[] = [];

    // Try Grok first
    if (this.grokClient) {
      try {
        return await this.generatePlanWithGrok(command);
      } catch (error: any) {
        errors.push(`Grok: ${error.message}`);
        logger.warn('Grok failed for plan generation, falling back to Claude', { error: error.message });
      }
    } else {
      errors.push('Grok: Client not initialized (missing GROK_API_KEY)');
    }

    // Fallback to Claude
    if (this.claudeClient) {
      try {
        return await this.generatePlanWithClaude(command);
      } catch (error: any) {
        errors.push(`Claude: ${error.message}`);
        logger.error('All providers failed for plan generation', { errors });
      }
    } else {
      errors.push('Claude: Client not initialized (missing ANTHROPIC_API_KEY)');
    }

    // All providers failed
    throw new Error(`Failed to generate automation plan. Errors: ${errors.join('; ')}`);
  }

  /**
   * Generate structured plan using Grok
   */
  private async generatePlanWithGrok(command: string): Promise<AutomationPlanResponse> {
    if (!this.grokClient) {
      throw new Error('Grok client not initialized');
    }

    const startTime = Date.now();
    const model = this.useGrok4 ? 'grok-2-1212' : 'grok-2-latest';

    try {
      logger.info('Generating automation plan with Grok', { model, command });

      const completion = await this.grokClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert automation planner. Return only valid JSON, no markdown or explanations.',
          },
          {
            role: 'user',
            content: this.buildStructuredPlanPrompt(command),
          },
        ],
        temperature: 0.3, // Lower temperature for more consistent JSON output
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = completion.choices[0]?.message?.content || '';

      // Parse JSON response
      const planData = this.parseAndValidatePlan(rawResponse, command);
      
      // Update metadata with correct provider and generation time
      planData.metadata.provider = 'grok';
      planData.metadata.generationTime = latencyMs;

      logger.info('Grok plan generation successful', { latencyMs, stepCount: planData.steps.length });

      return {
        plan: planData,
        provider: 'grok',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Grok plan generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate structured plan using Claude
   */
  private async generatePlanWithClaude(command: string): Promise<AutomationPlanResponse> {
    if (!this.claudeClient) {
      throw new Error('Claude client not initialized');
    }

    const startTime = Date.now();

    try {
      logger.info('Generating automation plan with Claude', { command });

      const message = await this.claudeClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: this.buildStructuredPlanPrompt(command),
          },
        ],
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = message.content[0]?.type === 'text' ? message.content[0].text : '';

      // Parse JSON response
      const planData = this.parseAndValidatePlan(rawResponse, command);
      
      // Update metadata with correct provider and generation time
      planData.metadata.provider = 'claude';
      planData.metadata.generationTime = latencyMs;

      logger.info('Claude plan generation successful', { latencyMs, stepCount: planData.steps.length });

      return {
        plan: planData,
        provider: 'claude',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Claude plan generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Parse and validate automation plan JSON
   */
  private parseAndValidatePlan(rawResponse: string, originalCommand: string): AutomationPlan {
    // Remove markdown code fences if present
    let cleaned = rawResponse.replace(/```(?:json)?\n?/g, '').trim();

    // Parse JSON
    let planJson: any;
    try {
      planJson = JSON.parse(cleaned);
    } catch (error) {
      throw new Error(`Failed to parse plan JSON: ${error}`);
    }

    // Validate required fields
    if (!planJson.steps || !Array.isArray(planJson.steps)) {
      throw new Error('Plan must have a "steps" array');
    }

    if (planJson.steps.length === 0) {
      throw new Error('Plan must have at least one step');
    }

    // Validate each step
    for (const step of planJson.steps) {
      if (!step.id || !step.description || !step.action || !step.code) {
        throw new Error(`Invalid step: missing required fields (id, description, action, code)`);
      }
    }

    // Build complete AutomationPlan object
    const plan: AutomationPlan = {
      planId: randomUUID(),
      originalCommand,
      steps: planJson.steps,
      maxRetriesPerStep: planJson.maxRetriesPerStep || 3,
      totalTimeout: planJson.totalTimeout || 300000,
      targetOS: process.platform === 'darwin' ? 'darwin' : 'win32',
      targetApp: this.detectTargetApp(originalCommand),
      metadata: {
        provider: 'grok', // Will be overwritten by caller
        generationTime: 0, // Will be overwritten by caller
        createdAt: new Date().toISOString(),
      },
    };

    return plan;
  }

  /**
   * Detect target application from command
   */
  private detectTargetApp(command: string): string | undefined {
    const lowerCommand = command.toLowerCase();
    
    if (lowerCommand.includes('gmail')) return 'gmail';
    if (lowerCommand.includes('outlook')) return 'outlook';
    if (lowerCommand.includes('slack')) return 'slack';
    if (lowerCommand.includes('youtube')) return 'youtube';
    if (lowerCommand.includes('discord')) return 'discord';
    if (lowerCommand.includes('notion')) return 'notion';
    if (lowerCommand.includes('vs code') || lowerCommand.includes('vscode')) return 'vscode';
    if (lowerCommand.includes('figma')) return 'figma';
    if (lowerCommand.includes('calendar')) return 'calendar';
    
    return undefined;
  }

  /**
   * Build prompt for structured automation guide generation
   */
  private buildStructuredGuidePrompt(request: GuideRequest): string {
    const os = process.platform === 'darwin' ? 'darwin' : 'win32';
    const isRecovery = !!request.context?.failedStep;
    
    return `You are an expert at creating interactive automation guides that teach users while automating tasks.

**USER COMMAND:** "${request.command}"
${isRecovery ? `\n**RECOVERY MODE:** Step ${request.context?.failedStep} failed with error: ${request.context?.error}\n` : ''}

**YOUR TASK:** Generate an educational automation guide as a JSON object with step-by-step explanations.

**CRITICAL RULES:**
1. Return ONLY valid JSON - no markdown, no explanations, no code fences
2. Each step must have executable Nut.js code AND educational explanation
3. Use CommonJS require() syntax: const { keyboard, Key } = require('@nut-tree-fork/nut-js');
4. Import vision service: const { findAndClick } = require('../src/services/visionSpatialService');
5. Include console.log() markers for frontend parsing: "[GUIDE SUMMARY]", "[GUIDE STEP 1]", etc.
6. Target OS: ${os} (darwin = macOS, win32 = Windows)
7. Detect guide keywords: "how do i", "show me how", "guide me", "teach me", "what's the way to"
8. Provide educational context - explain WHY each step is needed, not just WHAT it does
9. Include common failure recoveries (app not installed, permission denied, etc.)
10. Use vision AI (findAndClick) for ALL GUI interactions
11. Use keyboard shortcuts ONLY for OS-level operations

**GUIDE STRUCTURE:**
{
  "intro": "Educational introduction explaining what the guide will teach and why it's useful",
  "steps": [
    {
      "id": 1,
      "title": "Short step title",
      "explanation": "Detailed explanation of what this step does and why it's important",
      "code": "const { keyboard, Key } = require('@nut-tree-fork/nut-js'); await keyboard.pressKey(Key.LeftSuper, Key.Space); await keyboard.releaseKey(Key.LeftSuper, Key.Space);",
      "marker": "[GUIDE STEP 1]",
      "canFail": true,
      "expectedDuration": 2000,
      "verification": {
        "type": "element_visible",
        "expectedElement": "Spotlight search"
      },
      "commonFailure": "app_not_found",
      "waitAfter": 1000
    }
  ],
  "commonRecoveries": [
    {
      "failureType": "app_not_found",
      "title": "Install the application",
      "explanation": "The application isn't installed on your system",
      "manualInstructions": "Visit [app website] to download and install the application",
      "helpLinks": [
        {
          "title": "Download Page",
          "url": "https://example.com/download"
        }
      ]
    }
  ]
}

**MARKER FORMAT:**
- Intro: console.log("[GUIDE SUMMARY] Your intro message here");
- Steps: console.log("[GUIDE STEP 1] Your step explanation here");
- Each step's code must include its marker at the beginning

**FULL CODE GENERATION:**
After defining the JSON structure, generate the complete executable code with all markers:
- Start with: console.log("[GUIDE SUMMARY] ...");
- For each step: console.log("[GUIDE STEP N] ..."); followed by the step's code
- Include proper waits and error handling

**COMMON FAILURE TYPES:**
- "app_not_found": Application not installed
- "permission_denied": Insufficient permissions
- "timeout": Operation took too long
- "verification_failed": Expected UI element not found
- "execution_error": Code execution failed

**EXAMPLE FOR "How do I setup SSH keys":**
{
  "intro": "SSH keys provide a secure way to authenticate with remote servers without using passwords. I'll guide you through generating and configuring SSH keys on your system.",
  "steps": [
    {
      "id": 1,
      "title": "Open Terminal",
      "explanation": "To set up SSH keys, we first need to open the Terminal application. Terminal is a command-line interface where we'll run the commands to generate your SSH key pair. On macOS, Terminal is the built-in application for executing shell commands. You can find it manually by clicking on your Desktop/Finder → Go → Applications → Utilities → Terminal and double-clicking it, or simply press Cmd+Space and type 'Terminal' to open it via Spotlight.",
      "code": "const { keyboard, Key } = require('@nut-tree-fork/nut-js'); const { findAndClick } = require('../src/services/visionSpatialService'); console.log('[GUIDE STEP 1] Opening Terminal application to begin SSH key setup...'); await keyboard.pressKey(Key.LeftSuper, Key.Space); await keyboard.releaseKey(Key.LeftSuper, Key.Space); await new Promise(resolve => setTimeout(resolve, 500)); await keyboard.type('Terminal'); await keyboard.pressKey(Key.Return); await keyboard.releaseKey(Key.Return); await new Promise(resolve => setTimeout(resolve, 2000));",
      "marker": "[GUIDE STEP 1]",
      "canFail": true,
      "expectedDuration": 4000,
      "verification": {
        "type": "app_running",
        "expectedAppName": "Terminal"
      },
      "commonFailure": "app_not_found",
      "waitAfter": 1000
    },
    {
      "id": 2,
      "title": "Generate SSH Key",
      "explanation": "Now we'll generate your SSH key pair using the ssh-keygen command. This creates two files: a private key (id_rsa) that stays on your computer, and a public key (id_rsa.pub) that you'll share with servers. We're using RSA encryption with 4096 bits for strong security. To do this manually, simply type 'ssh-keygen -t rsa -b 4096 -C \"your_email@example.com\"' in Terminal and press Enter. You'll be prompted to choose a location (press Enter for default) and set a passphrase (optional but recommended for extra security).",
      "code": "console.log('[GUIDE STEP 2] Generating SSH key pair with RSA 4096-bit encryption...'); await keyboard.type('ssh-keygen -t rsa -b 4096 -C \"your_email@example.com\"'); await keyboard.pressKey(Key.Return); await keyboard.releaseKey(Key.Return); await new Promise(resolve => setTimeout(resolve, 2000));",
      "marker": "[GUIDE STEP 2]",
      "canFail": false,
      "expectedDuration": 3000,
      "verification": {
        "type": "none"
      },
      "waitAfter": 2000
    },
    {
      "id": 3,
      "title": "Accept Default Location",
      "explanation": "The system is asking where to save your SSH key. The default location (~/.ssh/id_rsa) is recommended because most tools look for keys there automatically. When you see the prompt 'Enter file in which to save the key', simply press Enter to accept the default. If you're doing this manually, you'll see this prompt in Terminal after running ssh-keygen.",
      "code": "console.log('[GUIDE STEP 3] Accepting default SSH key location (~/.ssh/id_rsa)...'); await keyboard.pressKey(Key.Return); await keyboard.releaseKey(Key.Return); await new Promise(resolve => setTimeout(resolve, 1000));",
      "marker": "[GUIDE STEP 3]",
      "canFail": false,
      "expectedDuration": 2000,
      "verification": {
        "type": "none"
      },
      "waitAfter": 1000
    },
    {
      "id": 4,
      "title": "Set Passphrase (Optional)",
      "explanation": "You're now prompted to set a passphrase for your SSH key. A passphrase adds an extra layer of security - even if someone gets your private key file, they can't use it without the passphrase. You'll see two prompts: 'Enter passphrase' and 'Enter same passphrase again'. For this guide, we'll skip the passphrase by pressing Enter twice, but in production you should type a strong passphrase and press Enter, then type it again and press Enter.",
      "code": "console.log('[GUIDE STEP 4] Skipping passphrase for demonstration (press Enter twice)...'); await keyboard.pressKey(Key.Return); await keyboard.releaseKey(Key.Return); await new Promise(resolve => setTimeout(resolve, 500)); await keyboard.pressKey(Key.Return); await keyboard.releaseKey(Key.Return); await new Promise(resolve => setTimeout(resolve, 1000));",
      "marker": "[GUIDE STEP 4]",
      "canFail": false,
      "expectedDuration": 3000,
      "verification": {
        "type": "none"
      },
      "waitAfter": 1000
    },
    {
      "id": 5,
      "title": "View Public Key",
      "explanation": "Your SSH key pair has been generated! Now we'll display your public key so you can copy it. The public key is what you'll add to GitHub, GitLab, or other services. To view it manually, type 'cat ~/.ssh/id_rsa.pub' in Terminal and press Enter. The 'cat' command displays file contents, and the tilde (~) represents your home directory. You'll see a long string starting with 'ssh-rsa' - that's your public key.",
      "code": "console.log('[GUIDE STEP 5] Displaying your public SSH key...'); await keyboard.type('cat ~/.ssh/id_rsa.pub'); await keyboard.pressKey(Key.Return); await keyboard.releaseKey(Key.Return); await new Promise(resolve => setTimeout(resolve, 2000));",
      "marker": "[GUIDE STEP 5]",
      "canFail": false,
      "expectedDuration": 3000,
      "verification": {
        "type": "none"
      },
      "waitAfter": 2000
    }
  ],
  "commonRecoveries": [
    {
      "failureType": "app_not_found",
      "title": "Install Figma",
      "explanation": "Figma is not installed on your system. You'll need to download and install it first.",
      "manualInstructions": "1. Visit figma.com/downloads\\n2. Download Figma for your operating system\\n3. Install the application\\n4. Create a free account or sign in\\n5. Try this guide again",
      "helpLinks": [
        {
          "title": "Figma Downloads",
          "url": "https://www.figma.com/downloads/"
        },
        {
          "title": "Getting Started with Figma",
          "url": "https://help.figma.com/hc/en-us/articles/360039827914"
        }
      ]
    }
  ]
}

**IMPORTANT NOTES:**
- Extract actual values from user command
- **CRITICAL: Each step's "explanation" must be BOTH instructional AND directional**
  - Start by stating what you're about to do
  - Explain WHY this step is necessary
  - Describe WHAT tool/app/command you're using
  - Explain HOW it works or what it does
  - **PROVIDE MANUAL DIRECTIONS: Tell users how to do it manually (e.g., "You can also find this by clicking Desktop/Finder → Go → Applications → Utilities")**
  - Include keyboard shortcuts, menu paths, or UI locations
  - Provide context about the technology/concept
  - Make it educational AND actionable
- Example good explanation: "To set up SSH keys, we first need to open the Terminal application. Terminal is a command-line interface where we'll run the commands to generate your SSH key pair. On macOS, Terminal is the built-in application for executing shell commands. You can also find it manually by clicking Finder → Go → Applications → Utilities → Terminal, or by searching for 'Terminal' in Spotlight (Cmd+Space)."
- Example bad explanation: "Open Terminal" (too short, not educational, no manual directions)
- Include verification strategies
- Pre-generate recovery steps for common failures
- Use proper wait times between steps
- Include helpful links in recovery steps
- Make explanations beginner-friendly with manual alternatives
- Each explanation should be 3-5 sentences minimum (including manual directions)

Now generate the JSON guide for the user's command. Return ONLY the JSON object, no other text.`;
  }

  /**
   * Generate Nut.js code from natural language command
   * Priority: Claude (3-8s) → OpenAI GPT-4V (5-10s) → Grok (30s+)
   * If vision fails, falls back to text-only generation
   */
  async generateCode(command: string, screenshot?: ScreenshotData, context?: any): Promise<NutjsCodeResponse> {
    const errors: string[] = [];
    const hasScreenshot = !!screenshot;
    
    // Extract context flags
    const responseMode = context?.responseMode;
    const instruction = context?.instruction;

    // Priority 1: Claude (fastest vision, 3-8s)
    if (this.claudeClient) {
      try {
        logger.info('Using Claude (Priority 1)', { hasScreenshot, responseMode });
        return await this.generateWithClaude(command, screenshot, context);
      } catch (error: any) {
        errors.push(`Claude: ${error.message}`);
        logger.warn('Claude failed, trying OpenAI', { error: error.message });
      }
    } else {
      errors.push('Claude: Client not initialized (missing ANTHROPIC_API_KEY)');
    }

    // Priority 2: OpenAI GPT-4 Vision (fast vision, 5-10s)
    if (this.openaiClient) {
      try {
        logger.info('Using OpenAI GPT-4V (Priority 2)', { hasScreenshot });
        return await this.generateWithOpenAI(command, screenshot);
      } catch (error: any) {
        errors.push(`OpenAI: ${error.message}`);
        logger.warn('OpenAI failed, trying Grok', { error: error.message });
      }
    } else {
      errors.push('OpenAI: Client not initialized (missing OPENAI_API_KEY)');
    }

    // Priority 3: Grok (slower vision 30s+, but good fallback)
    if (this.grokClient) {
      try {
        logger.info('Using Grok (Priority 3 - fallback)', { hasScreenshot });
        return await this.generateWithGrok(command, screenshot);
      } catch (error: any) {
        errors.push(`Grok: ${error.message}`);
        logger.warn('Grok failed', { error: error.message });
        
        // Last resort: Try without vision if we had a screenshot
        if (hasScreenshot && this.claudeClient) {
          try {
            logger.info('Last resort: Retrying Claude without vision');
            return await this.generateWithClaude(command, undefined);
          } catch (retryError: any) {
            errors.push(`Claude without vision: ${retryError.message}`);
          }
        }
      }
    } else {
      errors.push('Grok: Client not initialized (missing GROK_API_KEY)');
    }

    // All providers failed
    logger.error('All providers failed for Nut.js code generation', { errors });
    throw new Error(`Failed to generate Nut.js code. Errors: ${errors.join('; ')}`);
  }

  /**
   * Generate automation guide with automatic fallback
   * Tries Grok first, falls back to Claude if Grok fails
   */
  async generateGuide(request: GuideRequest): Promise<AutomationGuideResponse> {
    const errors: string[] = [];

    // Try Grok first
    if (this.grokClient) {
      try {
        return await this.generateGuideWithGrok(request);
      } catch (error: any) {
        errors.push(`Grok: ${error.message}`);
        logger.warn('Grok failed for guide generation, falling back to Claude', { error: error.message });
      }
    } else {
      errors.push('Grok: Client not initialized (missing GROK_API_KEY)');
    }

    // Fallback to Claude
    if (this.claudeClient) {
      try {
        return await this.generateGuideWithClaude(request);
      } catch (error: any) {
        errors.push(`Claude: ${error.message}`);
        logger.error('All providers failed for guide generation', { errors });
      }
    } else {
      errors.push('Claude: Client not initialized (missing ANTHROPIC_API_KEY)');
    }

    // All providers failed
    throw new Error(`Failed to generate automation guide. Errors: ${errors.join('; ')}`);
  }

  /**
   * Generate guide using Grok
   */
  private async generateGuideWithGrok(request: GuideRequest): Promise<AutomationGuideResponse> {
    if (!this.grokClient) {
      throw new Error('Grok client not initialized');
    }

    const startTime = Date.now();
    const model = this.useGrok4 ? 'grok-2-1212' : 'grok-2-latest';

    try {
      logger.info('Generating automation guide with Grok', { model, command: request.command });

      const completion = await this.grokClient.chat.completions.create({
        model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert automation guide creator. Return only valid JSON, no markdown or explanations.',
          },
          {
            role: 'user',
            content: this.buildStructuredGuidePrompt(request),
          },
        ],
        temperature: 0.3,
      });

      const latencyMs = Date.now() - startTime;
      const rawResponse = completion.choices[0]?.message?.content || '';

      // Parse JSON response
      const guideData = this.parseAndValidateGuide(rawResponse, request);
      
      // Update metadata
      guideData.metadata.provider = 'grok';
      guideData.metadata.generationTime = latencyMs;

      logger.info('Grok guide generation successful', { latencyMs, stepCount: guideData.steps.length });

      return {
        guide: guideData,
        provider: 'grok',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Grok guide generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Generate guide using Claude
   */
  private async generateGuideWithClaude(request: GuideRequest): Promise<AutomationGuideResponse> {
    if (!this.claudeClient) {
      throw new Error('Claude client not initialized');
    }

    const startTime = Date.now();

    try {
      logger.info('Generating automation guide with Claude', { command: request.command });

      const message = await this.claudeClient.messages.create({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 8192,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: this.buildStructuredGuidePrompt(request),
          },
        ],
      });
      const latencyMs = Date.now() - startTime;
      const rawResponse = message.content[0]?.type === 'text' ? message.content[0].text : '';

      // Parse JSON response
      const guideData = this.parseAndValidateGuide(rawResponse, request);
      
      // Update metadata
      guideData.metadata.provider = 'claude';
      guideData.metadata.generationTime = latencyMs;

      logger.info('Claude guide generation successful', { latencyMs, stepCount: guideData.steps.length });

      return {
        guide: guideData,
        provider: 'claude',
        latencyMs,
      };
    } catch (error: any) {
      const latencyMs = Date.now() - startTime;
      logger.error('Claude guide generation failed', {
        error: error.message,
        latencyMs,
      });
      throw error;
    }
  }

  /**
   * Parse and validate automation guide JSON
   */
  private parseAndValidateGuide(rawResponse: string, request: GuideRequest): AutomationGuide {
    // Remove markdown code fences if present
    let cleaned = rawResponse.replace(/```(?:json)?\n?/g, '').trim();

    // Parse JSON
    let guideJson: any;
    try {
      guideJson = JSON.parse(cleaned);
    } catch (error) {
      throw new Error(`Failed to parse guide JSON: ${error}`);
    }

    // Validate required fields
    if (!guideJson.intro || typeof guideJson.intro !== 'string') {
      throw new Error('Guide must have an "intro" string');
    }

    if (!guideJson.steps || !Array.isArray(guideJson.steps)) {
      throw new Error('Guide must have a "steps" array');
    }

    if (guideJson.steps.length === 0) {
      throw new Error('Guide must have at least one step');
    }

    // Validate each step
    for (const step of guideJson.steps) {
      if (!step.id || !step.title || !step.explanation || !step.code || !step.marker) {
        throw new Error(`Invalid step structure: ${JSON.stringify(step)}`);
      }
    }

    // Generate full executable code with markers
    const fullCode = this.generateFullGuideCode(guideJson);

    // Calculate estimated duration
    const estimatedDuration = guideJson.steps.reduce((total: number, step: any) => {
      return total + (step.expectedDuration || 2000) + (step.waitAfter || 0);
    }, 0);

    // Build complete guide
    const guide: AutomationGuide = {
      id: randomUUID(),
      command: request.command,
      intro: guideJson.intro,
      steps: guideJson.steps,
      code: fullCode,
      totalSteps: guideJson.steps.length,
      commonRecoveries: guideJson.commonRecoveries || [],
      metadata: {
        provider: 'grok', // Will be overwritten by caller
        generationTime: 0, // Will be overwritten by caller
        targetApp: this.detectTargetApp(request.command),
        targetOS: process.platform === 'darwin' ? 'darwin' : 'win32',
        estimatedDuration,
      },
    };

    return guide;
  }

  /**
   * Generate full executable code with all markers
   */
  private generateFullGuideCode(guideJson: any): string {
    let code = `// Auto-generated Guide Code\n`;
    code += `const { keyboard, Key, mouse, screen } = require('@nut-tree-fork/nut-js');\n`;
    code += `const { findAndClick } = require('../src/services/visionSpatialService');\n\n`;
    code += `(async () => {\n`;
    code += `  try {\n`;
    code += `    // Intro\n`;
    code += `    console.log("[GUIDE SUMMARY] ${guideJson.intro.replace(/"/g, '\\"')}");\n`;
    code += `    await new Promise(resolve => setTimeout(resolve, 1000));\n\n`;

    // Add each step
    for (const step of guideJson.steps) {
      code += `    // Step ${step.id}: ${step.title}\n`;
      code += `    console.log("[GUIDE STEP ${step.id}] ${step.explanation.replace(/"/g, '\\"')}");\n`;
      
      // Extract code without require statements (already at top)
      let stepCode = step.code;
      stepCode = stepCode.replace(/const\s+\{[^}]+\}\s*=\s*require\([^)]+\);\s*/g, '');
      stepCode = stepCode.replace(/console\.log\([^)]+\);\s*/g, ''); // Remove duplicate markers
      
      code += `    ${stepCode}\n`;
      
      if (step.waitAfter) {
        code += `    await new Promise(resolve => setTimeout(resolve, ${step.waitAfter}));\n`;
      }
      code += `\n`;
    }

    code += `    console.log("[GUIDE COMPLETE] Guide finished successfully!");\n`;
    code += `  } catch (error) {\n`;
    code += `    console.error('[GUIDE ERROR]', error.message);\n`;
    code += `    throw error;\n`;
    code += `  }\n`;
    code += `})();\n`;

    return code;
  }

  /**
   * Validate that the generated code is actually Nut.js code
   */
  validateNutjsCode(code: string): { valid: boolean; reason?: string } {
    // Basic validation checks
    if (!code || code.trim().length === 0) {
      return { valid: false, reason: 'Empty code generated' };
    }

    // Check for Nut.js require (CommonJS - forked version)
    const hasNutjsRequire = /require\s*\(\s*['"]@nut-tree-fork\/nut-js['"]\s*\)/.test(code);
    if (!hasNutjsRequire) {
      return { valid: false, reason: 'Missing Nut.js require statement (must use CommonJS)' };
    }

    // Check for async function or top-level await
    const hasAsyncPattern = /async\s+function|await\s+/.test(code);
    if (!hasAsyncPattern) {
      return { valid: false, reason: 'Missing async/await patterns (required for Nut.js)' };
    }

    return { valid: true };
  }
}

// Export singleton instance
export const nutjsCodeGenerator = new NutjsCodeGenerator();

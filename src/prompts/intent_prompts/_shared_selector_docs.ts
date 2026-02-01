/**
 * Shared Selector Documentation for Multi-Driver Automation
 * This module provides selector documentation that can be included in intent prompts
 */

export interface SelectorContext {
  activeApp?: string;
  activeUrl?: string;
  os?: string;
  useMultiDriver?: boolean;
}

/**
 * Get selector documentation based on target type
 */
export function getSelectorDocs(context: SelectorContext): string {
  const { activeApp = '', activeUrl = '', os = 'darwin', useMultiDriver = false } = context;
  
  // Detect target type
  const targetType = detectTargetType(activeApp, activeUrl);
  
  // If multi-driver mode is disabled, return legacy vision-only docs
  if (!useMultiDriver) {
    return getLegacyVisionDocs();
  }
  
  // Return appropriate docs based on target type
  switch (targetType) {
    case 'web':
      return getWebSelectorDocs();
    case 'desktop':
      return getDesktopSelectorDocs(os);
    default:
      return getVisionFallbackDocs();
  }
}

/**
 * Detect target type based on context
 */
function detectTargetType(activeApp: string, activeUrl: string): 'web' | 'desktop' | 'unknown' {
  const app = activeApp.toLowerCase();
  
  // Browser detection
  const browsers = ['chrome', 'firefox', 'safari', 'edge', 'brave', 'arc'];
  if (browsers.some(browser => app.includes(browser)) || activeUrl) {
    return 'web';
  }
  
  // Desktop app detection
  if (activeApp) {
    return 'desktop';
  }
  
  return 'unknown';
}

/**
 * Web selector documentation (OmniParser Vision Detection)
 */
function getWebSelectorDocs(): string {
  return `
=== WEB ELEMENT DETECTION (OmniParser) ===

**Target detected: WEB PAGE in browser**

Use OmniParser vision-based detection for reliable web automation.
OmniParser analyzes screenshots and returns precise coordinates for clicking.

**IMPORTANT: Always use "description" field for findAndClick actions**

**Selector format:**
{
  "type": "findAndClick",
  "description": "search input field in top navigation bar",
  "multiDriver": true
}

**How it works:**
1. You provide a natural language description of the element
2. OmniParser analyzes the screenshot and detects UI elements
3. Backend returns coordinates: { x: 500, y: 100 }
4. Frontend clicks at those coordinates

**Best practices for descriptions:**
- Be specific: Include element type, text, and position
- Include visual details: color, shape, icons
- Add context: "in top bar", "below title", "next to logo"
- Mention text content: "search field with placeholder 'Search'"

**Examples:**

// Click search input field
{
  "type": "findAndClick",
  "description": "search input field in top navigation bar",
  "multiDriver": true
}

// Click submit button
{
  "type": "findAndClick",
  "description": "blue Submit button at bottom of form",
  "multiDriver": true
}

// Click link by text
{
  "type": "findAndClick",
  "description": "Learn More link in main content area",
  "multiDriver": true
}

// Click icon button
{
  "type": "findAndClick",
  "description": "shopping cart icon in top right corner",
  "multiDriver": true
}

**For typing into fields:**
1. First click the field using findAndClick with description
2. Then use typeText to enter text

Example sequence:
{
  "type": "findAndClick",
  "description": "email input field",
  "multiDriver": true
}
{
  "type": "typeText",
  "text": "user@example.com"
}
`;
}

/**
 * Desktop selector documentation (OmniParser Vision Detection)
 */
function getDesktopSelectorDocs(os: string): string {
  return `
=== DESKTOP ELEMENT DETECTION (OmniParser) ===

**Target detected: NATIVE DESKTOP APP**

Use OmniParser vision-based detection for reliable desktop automation.
OmniParser analyzes screenshots and returns precise coordinates for clicking.

**IMPORTANT: Always use "description" field for findAndClick actions**

**Selector format:**
{
  "type": "findAndClick",
  "description": "Send button at bottom right of message window",
  "multiDriver": true
}

**How it works:**
1. You provide a natural language description of the element
2. OmniParser analyzes the screenshot and detects UI elements
3. Backend returns coordinates: { x: 500, y: 100 }
4. Frontend clicks at those coordinates

**Best practices for descriptions:**
- Be specific: Include element type, text, and position
- Include visual details: color, shape, icons
- Add context: "in sidebar", "at bottom", "next to username"
- Mention text content: "Send button", "Message input field"

**Examples:**

// Click Send button
{
  "type": "findAndClick",
  "description": "Send button at bottom right of message window",
  "multiDriver": true
}

// Click into message field
{
  "type": "findAndClick",
  "description": "message input field at bottom of chat window",
  "multiDriver": true
}

// Click menu item
{
  "type": "findAndClick",
  "description": "New Message menu item in File menu",
  "multiDriver": true
}

// Click toolbar icon
{
  "type": "findAndClick",
  "description": "attachment icon in message toolbar",
  "multiDriver": true
}

**For typing into fields:**
1. First click the field using findAndClick with description
2. Then use typeText to enter text

Example sequence:
{
  "type": "findAndClick",
  "description": "message input field",
  "multiDriver": true
}
{
  "type": "typeText",
  "text": "Hello, world!"
}
`;
}

/**
 * Vision fallback documentation
 */
function getVisionFallbackDocs(): string {
  return `
=== VISION FALLBACK ===

**Target detected: UNKNOWN or CANVAS/GAME**

Use vision-based descriptions when structured selectors are not available:

**Selector format:**
{
  "type": "findAndClick",
  "selector": {
    "description": "blue Send button in bottom right corner"
  }
}

**Best practices:**
- Be specific: Include color, position, text
- Add context: "near the search field", "in the sidebar"
- Include visual details: "blue button", "magnifying glass icon"

**Examples:**

// Click button in canvas
{
  "type": "findAndClick",
  "selector": {
    "description": "blue circular play button in center of canvas"
  }
}

// Click game element
{
  "type": "findAndClick",
  "selector": {
    "description": "red enemy character in top left corner"
  }
}
`;
}

/**
 * Legacy vision-only documentation (backward compatibility)
 */
function getLegacyVisionDocs(): string {
  return `
=== VISION-BASED LOCATORS (Legacy Mode) ===

**Mode: LEGACY (Vision-only)**

Use vision-based locators with natural language descriptions:

**Locator format:**
{
  "type": "findAndClick",
  "locator": {
    "strategy": "vision",
    "description": "blue Submit button in bottom right"
  }
}

**Best practices:**
- Be specific with visual details
- Include position: "in top right", "near search field"
- Include appearance: color, shape, text
- Include context: "in the sidebar", "below the title"

**Examples:**

{
  "type": "findAndClick",
  "locator": {
    "strategy": "vision",
    "description": "blue Submit button"
  }
}

{
  "type": "typeText",
  "text": "search query"
}
`;
}

/**
 * Get complete selector documentation with decision tree
 */
export function getCompleteSelectorDocs(context: SelectorContext): string {
  const selectorDocs = getSelectorDocs(context);
  
  if (!context.useMultiDriver) {
    return selectorDocs;
  }
  
  return `${selectorDocs}

=== SELECTOR DECISION TREE ===

**ALWAYS use OmniParser vision detection for findAndClick actions**

1. **For ALL targets (Web, Desktop, Unknown):**
   - Use "description" field with natural language
   - Set "multiDriver": true
   - OmniParser will detect elements and return coordinates

2. **Action format:**
{
  "type": "findAndClick",
  "description": "specific element description with position",
  "multiDriver": true
}

3. **Description best practices:**
   - Include element type: "button", "input field", "link", "icon"
   - Include text content: "Send button", "search field"
   - Include position: "in top bar", "at bottom right", "next to logo"
   - Include visual details: "blue button", "magnifying glass icon"

4. **Examples by target type:**

**Web page (browser):**
{
  "type": "findAndClick",
  "description": "search input field in top navigation bar",
  "multiDriver": true
}

**Desktop app:**
{
  "type": "findAndClick",
  "description": "Send button at bottom right of message window",
  "multiDriver": true
}

**Unknown/Canvas:**
{
  "type": "findAndClick",
  "description": "blue circular play button in center of canvas",
  "multiDriver": true
}

5. **For typing into fields:**
   - First click the field with findAndClick
   - Then use typeText (no selector needed)

=== MIGRATION NOTES ===

**OLD format (deprecated - DO NOT USE):**
{
  "type": "findAndClick",
  "selector": { "css": "#id", "role": "button" }
}

**NEW format (required):**
{
  "type": "findAndClick",
  "description": "element description",
  "multiDriver": true
}

**CRITICAL: Always use "description" field, never use "selector" field for findAndClick.**
`;
}

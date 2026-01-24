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
 * Web selector documentation (Playwright/CDP)
 */
function getWebSelectorDocs(): string {
  return `
=== WEB SELECTORS (Playwright/CDP) ===

**Target detected: WEB PAGE in browser**

Use semantic selectors for reliable web automation:

**Available selector strategies:**

1. **CSS Selector** (preferred)
   - Fast, reliable, widely supported
   - Examples: "button.submit", "input[name='email']", "#login-btn"
   
2. **Text Content**
   - Match by visible text
   - Examples: "Submit", "Sign In", "Search"
   
3. **ARIA Role**
   - Semantic HTML roles
   - Examples: "button", "searchbox", "textbox", "link"
   
4. **XPath** (when CSS insufficient)
   - More powerful but slower
   - Examples: "//button[contains(text(), 'Submit')]"
   
5. **Test ID**
   - data-testid attributes (most stable)
   - Examples: "submit-btn", "email-input"

**Selector format:**
{
  "type": "findAndClick",
  "selector": {
    "css": "button.submit",
    "text": "Submit",
    "role": "button"
  }
}

**Best practices:**
- Combine selectors for reliability: css + text or role + text
- Prefer CSS for elements with classes/IDs
- Use text for buttons with unique labels
- Use role for semantic elements

**Examples:**

// Click submit button
{
  "type": "findAndClick",
  "selector": {
    "css": "button[type='submit']",
    "text": "Submit"
  }
}

// Type into search field
{
  "type": "typeText",
  "selector": {
    "css": "input[name='search']",
    "role": "searchbox"
  },
  "text": "query"
}

// Click link by text
{
  "type": "findAndClick",
  "selector": {
    "role": "link",
    "text": "Learn More"
  }
}
`;
}

/**
 * Desktop selector documentation (Accessibility APIs)
 */
function getDesktopSelectorDocs(os: string): string {
  const isMac = os === 'darwin';
  
  if (isMac) {
    return `
=== DESKTOP SELECTORS (macOS Accessibility API) ===

**Target detected: NATIVE DESKTOP APP (macOS)**

Use Accessibility API selectors for reliable desktop automation:

**Available selector strategies:**

1. **AX Role + Title** (preferred)
   - axRole: Element type (AXButton, AXTextField, etc.)
   - axTitle: Element label/name
   
**Common AX Roles:**
- AXButton - Buttons
- AXTextField - Text input fields
- AXStaticText - Labels, text content
- AXMenuItem - Menu items
- AXWindow - Windows
- AXScrollArea - Scrollable areas

**Selector format:**
{
  "type": "findAndClick",
  "selector": {
    "axRole": "AXButton",
    "axTitle": "Send"
  }
}

**Examples:**

// Click Send button
{
  "type": "findAndClick",
  "selector": {
    "axRole": "AXButton",
    "axTitle": "Send"
  }
}

// Type into message field
{
  "type": "typeText",
  "selector": {
    "axRole": "AXTextField",
    "axTitle": "Message"
  },
  "text": "Hello"
}

// Click menu item
{
  "type": "findAndClick",
  "selector": {
    "axRole": "AXMenuItem",
    "axTitle": "New Message"
  }
}
`;
  } else {
    return `
=== DESKTOP SELECTORS (Windows UIAutomation API) ===

**Target detected: NATIVE DESKTOP APP (Windows)**

Use UIAutomation API selectors for reliable desktop automation:

**Available selector strategies:**

1. **UIA Type + Name** (preferred)
   - uiaType: Control type (Button, Edit, etc.)
   - uiaName: Element name/label
   
**Common UIA Types:**
- Button - Buttons
- Edit - Text input fields
- Text - Labels, text content
- MenuItem - Menu items
- Window - Windows
- List - Lists, tables

**Selector format:**
{
  "type": "findAndClick",
  "selector": {
    "uiaType": "Button",
    "uiaName": "Send"
  }
}

**Examples:**

// Click Send button
{
  "type": "findAndClick",
  "selector": {
    "uiaType": "Button",
    "uiaName": "Send"
  }
}

// Type into message field
{
  "type": "typeText",
  "selector": {
    "uiaType": "Edit",
    "uiaName": "Message"
  },
  "text": "Hello"
}

// Click menu item
{
  "type": "findAndClick",
  "selector": {
    "uiaType": "MenuItem",
    "uiaName": "New Message"
  }
}
`;
  }
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

1. **Check target type:**
   - Browser (Chrome, Safari, etc.) → Use WEB SELECTORS
   - Desktop app (Slack, Outlook, etc.) → Use DESKTOP SELECTORS
   - Unknown/Canvas → Use VISION FALLBACK

2. **For WEB targets:**
   - Prefer: CSS + text or role + text combinations
   - Use CSS for elements with classes/IDs
   - Use text for unique button labels
   - Use role for semantic elements

3. **For DESKTOP targets:**
   - macOS: Use axRole + axTitle
   - Windows: Use uiaType + uiaName
   - Combine role/type with title/name for reliability

4. **For UNKNOWN targets:**
   - Use vision description with specific visual details
   - Include color, position, context

5. **Fallback strategy:**
   - If structured selector fails → Try alternative selector
   - If all structured selectors fail → Fall back to vision
   - If vision fails → End with clear error

=== MIGRATION NOTES ===

**Legacy format (still supported):**
{
  "type": "findAndClick",
  "locator": { "strategy": "vision", "description": "..." }
}

**New format (preferred when USE_MULTI_DRIVER=true):**
{
  "type": "findAndClick",
  "selector": { "css": "...", "text": "..." }
}

Both formats are supported for backward compatibility.
`;
}

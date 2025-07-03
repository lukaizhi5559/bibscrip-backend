// UI Indexer Daemon - Persistent background service for mapping actionable UI elements
// Supports macOS (AXObserver), Windows (UIAutomationClient), Linux (xdotool)

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { ElementStore } from './elementStore';
import { RedisSync } from './redisSync';

// UI Element interface matching PostgreSQL schema
export interface UIElement {
  id?: number;
  appName: string;
  windowTitle: string;
  elementRole: string; // button, input, dropdown, link, etc.
  elementLabel: string;
  elementValue?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  accessibilityId?: string;
  className?: string;
  automationId?: string;
  isEnabled: boolean;
  isVisible: boolean;
  confidenceScore: number;
  lastSeen: Date;
}

// Platform-specific UI scanning interface
interface PlatformScanner {
  scanActiveWindows(): Promise<UIElement[]>;
  getActiveApplication(): Promise<{ name: string; windowTitle: string }>;
  initialize(): Promise<void>;
  cleanup(): Promise<void>;
}

// macOS Scanner using Accessibility API
class MacOSScanner implements PlatformScanner {
  private axObserver: any = null;

  async initialize(): Promise<void> {
    try {
      // Check if accessibility permissions are granted
      const { execSync } = require('child_process');
      const result = execSync('osascript -e "tell application \\"System Events\\" to get name of every process"', { encoding: 'utf8' });
      logger.info('macOS Accessibility API initialized successfully');
    } catch (error) {
      logger.error('macOS Accessibility permissions required:', { error });
      throw new Error('Accessibility permissions required for UI indexing');
    }
  }

  async getActiveApplication(): Promise<{ name: string; windowTitle: string }> {
    try {
      const { execSync } = require('child_process');
      
      // Get active application name
      const appScript = `
        tell application "System Events"
          set frontApp to name of first application process whose frontmost is true
          return frontApp
        end tell
      `;
      const appName = execSync(`osascript -e '${appScript}'`, { encoding: 'utf8' }).trim();
      
      // Get active window title
      const windowScript = `
        tell application "System Events"
          tell process "${appName}"
            try
              set windowTitle to name of front window
              return windowTitle
            on error
              return ""
            end try
          end tell
        end tell
      `;
      const windowTitle = execSync(`osascript -e '${windowScript}'`, { encoding: 'utf8' }).trim();
      
      return { name: appName, windowTitle };
    } catch (error) {
      logger.error('Failed to get active application:', { error });
      return { name: 'Unknown', windowTitle: 'Unknown' };
    }
  }

  async scanActiveWindows(): Promise<UIElement[]> {
    const elements: UIElement[] = [];
    
    try {
      // Get the active application
      const activeApp = await this.getActiveApplication();
      if (!activeApp || activeApp.name === 'Unknown') {
        logger.warn('No active application found');
        return elements;
      }
      
      logger.info(`Scanning UI elements for: ${activeApp.name} - ${activeApp.windowTitle}`);
      
      // Enhanced AppleScript with better element detection and error handling
      const uiScript = `
        tell application "System Events"
          tell process "${activeApp.name}"
            try
              set frontWindow to front window
              set resultString to ""
              
              -- Process all UI elements in the front window with enhanced detection
              try
                set windowElements to UI elements of frontWindow
                repeat with windowElement in windowElements
                  try
                    set elementRole to "unknown"
                    set elementTitle to ""
                    set elementValue to ""
                    set elementDescription to ""
                    set elementPos to {0, 0}
                    set elementSz to {10, 10}
                    set isEnabled to true
                    set isVisible to true
                    set elementHelp to ""
                    
                    -- Safely get all available properties
                    try
                      set elementRole to role of windowElement
                    end try
                    try
                      set elementTitle to title of windowElement
                    end try
                    try
                      set elementValue to value of windowElement as string
                    end try
                    try
                      set elementDescription to description of windowElement
                    end try
                    try
                      set elementPos to position of windowElement
                    end try
                    try
                      set elementSz to size of windowElement
                    end try
                    try
                      set isEnabled to enabled of windowElement
                    end try
                    try
                      set isVisible to (position of windowElement is not missing value)
                    end try
                    try
                      set elementHelp to help of windowElement
                    end try
                    
                    -- Combine all text content for better element identification
                    set combinedText to elementTitle & "|" & elementValue & "|" & elementDescription & "|" & elementHelp
                    
                    -- Format as structured string with enhanced data
                    set elementData to "ELEMENT:" & elementRole & ":" & combinedText & ":" & (item 1 of elementPos) & "," & (item 2 of elementPos) & ":" & (item 1 of elementSz) & "," & (item 2 of elementSz) & ":" & isEnabled & ":" & isVisible
                    set resultString to resultString & elementData & "\n"
                    
                    -- Process some child elements for container types
                    if elementRole contains "group" or elementRole contains "scroll" or elementRole contains "tab" or elementRole contains "outline" or elementRole contains "table" or elementRole contains "toolbar" then
                      try
                        set childElements to UI elements of windowElement
                        set childCount to count of childElements
                        if childCount > 0 then
                          repeat with i from 1 to childCount
                            if i > 10 then exit repeat -- Limit to first 10 children to avoid overwhelming output
                            try
                              set childElement to item i of childElements
                              set childRole to role of childElement
                              set childTitle to ""
                              set childValue to ""
                              -- Recursively process child elements for better discovery
                              try
                                set childElements to UI elements of childElement
                                repeat with childElement in childElements
                                  try
                                    set childRole to "unknown"
                                    set childTitle to ""
                                    set childValue to ""
                                    set childDescription to ""
                                    set childHelp to ""
                                    set childPos to {0, 0}
                                    set childSz to {10, 10}
                                    set childEnabled to true
                                    set childVisible to true
                                    
                                    -- Get all child properties safely
                                    try
                                      set childRole to role of childElement
                                    end try
                                    try
                                      set childTitle to title of childElement
                                    end try
                                    try
                                      set childValue to value of childElement as string
                                    end try
                                    try
                                      set childDescription to description of childElement
                                    end try
                                    try
                                      set childHelp to help of childElement
                                    end try
                                    try
                                      set childPos to position of childElement
                                    end try
                                    try
                                      set childSz to size of childElement
                                    end try
                                    try
                                      set childEnabled to enabled of childElement
                                    end try
                                    try
                                      set childVisible to (position of childElement is not missing value)
                                    end try
                                    
                                    -- Combine child text content
                                    set childCombinedText to childTitle & "|" & childValue & "|" & childDescription & "|" & childHelp
                                    
                                    set childData to "ELEMENT:" & childRole & ":" & childCombinedText & ":" & (item 1 of childPos) & "," & (item 2 of childPos) & ":" & (item 1 of childSz) & "," & (item 2 of childSz) & ":" & childEnabled & ":" & childVisible
                                    set resultString to resultString & childData & "\n"
                                    
                                    -- Process grandchildren for deeper discovery
                                    try
                                      set grandchildElements to UI elements of childElement
                                      repeat with grandchild in grandchildElements
                                        try
                                          set gcRole to "unknown"
                                          set gcTitle to ""
                                          set gcValue to ""
                                          set gcDescription to ""
                                          set gcPos to {0, 0}
                                          set gcSz to {10, 10}
                                          
                                          try
                                            set gcRole to role of grandchild
                                          end try
                                          try
                                            set gcTitle to title of grandchild
                                          end try
                                          try
                                            set gcValue to value of grandchild as string
                                          end try
                                          try
                                            set gcDescription to description of grandchild
                                          end try
                                          try
                                            set gcPos to position of grandchild
                                          end try
                                          try
                                            set gcSz to size of grandchild
                                          end try
                                          
                                          set gcCombinedText to gcTitle & "|" & gcValue & "|" & gcDescription & "|"
                                          set gcData to "ELEMENT:" & gcRole & ":" & gcCombinedText & ":" & (item 1 of gcPos) & "," & (item 2 of gcPos) & ":" & (item 1 of gcSz) & "," & (item 2 of gcSz) & ":true:true"
                                          set resultString to resultString & gcData & "\n"
                                        end try
                                      end repeat
                                    end try
                                  end try
                                end repeat
                              end try
                            end try
                          end repeat
                        end if
                      on error
                        -- No child elements or error accessing them
                      end try
                    end if
                    
                  on error
                    -- Skip problematic elements
                  end try
                end repeat
              end try
              
              return resultString
              
            on error windowError
              return "ERROR: " & windowError
            end try
          end tell
        end tell
      `;
      
      const { execSync } = require('child_process');
      logger.debug('Executing AppleScript for UI scanning...');
      
      const result = execSync(`osascript -e '${uiScript}'`, { 
        encoding: 'utf8',
        timeout: 15000, // 15 second timeout
        maxBuffer: 2 * 1024 * 1024 // 2MB buffer
      });
      
      logger.debug(`AppleScript result length: ${result.length} characters`);
      
      // Parse AppleScript result
      if (result.startsWith('ERROR:')) {
        logger.error('AppleScript execution error:', { error: result });
        return elements;
      }
      
      if (!result.trim()) {
        logger.warn('AppleScript returned empty result');
        return elements;
      }
      
      const lines = result.split('\n').filter((line: string) => line.trim() && line.startsWith('ELEMENT:'));
      logger.debug(`Processing ${lines.length} UI element lines`);
      
      for (const line of lines) {
        try {
          // Parse enhanced format: ELEMENT:role:combinedText:x,y:width,height:enabled:visible
          const parts = line.substring(8).split(':'); // Remove 'ELEMENT:' prefix
          if (parts.length >= 7) {
            const [role, combinedText, positionStr, sizeStr, enabledStr, visibleStr] = parts;
            
            // Parse combined text: title|value|description|help
            const textParts = combinedText.split('|');
            const title = textParts[0] || '';
            const value = textParts[1] || '';
            const description = textParts[2] || '';
            const help = textParts[3] || '';
            
            // Parse coordinates
            let x = 0, y = 0, width = 10, height = 10;
            try {
              const [xStr, yStr] = positionStr.split(',');
              const [widthStr, heightStr] = sizeStr.split(',');
              
              x = parseInt(xStr) || 0;
              y = parseInt(yStr) || 0;
              width = parseInt(widthStr) || 10;
              height = parseInt(heightStr) || 10;
            } catch (parseError) {
              logger.debug('Failed to parse coordinates:', { parseError: (parseError as Error).message, line: line.substring(0, 100) });
              continue;
            }
            
            // Skip elements with invalid coordinates
            if (x < 0 || y < 0 || width <= 0 || height <= 0) {
              continue;
            }
            
            // Create enhanced UIElement with comprehensive text data
            const bestLabel = title || description || help || value || 'unlabeled';
            const element: UIElement = {
              appName: activeApp.name,
              windowTitle: activeApp.windowTitle,
              elementRole: role || 'unknown',
              elementLabel: bestLabel,
              elementValue: value || description || help || '',
              x,
              y,
              width,
              height,
              accessibilityId: `${activeApp.name}_${role}_${x}_${y}`,
              className: this.mapRoleToClassName(role),
              automationId: `${role}_${bestLabel.substring(0, 20)}_${elements.length}`,
              isEnabled: enabledStr === 'true',
              isVisible: visibleStr === 'true',
              confidenceScore: this.calculateConfidenceScore(role, bestLabel, value || description),
              lastSeen: new Date()
            };
            
            // Debug: Log all found elements before filtering
            logger.debug(`Found UI element: role="${role}", title="${title}", value="${value}", size=${width}x${height}, visible=${visibleStr}`);
            
            // Only include relevant interactive elements
            if (this.isRelevantElement(element)) {
              elements.push(element);
              logger.debug(`✅ Added UI element: ${role} "${title}" at (${x},${y})`);
            } else {
              logger.debug(`❌ Filtered out UI element: ${role} "${title}" (not relevant)`);
            }
          }
        } catch (error) {
          logger.debug('Failed to parse UI element line:', { error: (error as Error).message, line: line.substring(0, 100) });
        }
      }
      
      logger.info(`Successfully scanned ${elements.length} relevant UI elements from ${activeApp.name}`);
      
    } catch (error) {
      const err = error as Error;
      logger.error('Failed to scan active windows:', { error: err.message, stack: err.stack });
    }
    
    return elements;
  }

  private mapRoleToClassName(role: string): string {
    const roleMap: { [key: string]: string } = {
      'button': 'NSButton',
      'text field': 'NSTextField',
      'static text': 'NSTextField',
      'image': 'NSImageView',
      'menu': 'NSMenu',
      'menu item': 'NSMenuItem',
      'window': 'NSWindow',
      'group': 'NSView',
      'scroll area': 'NSScrollView',
      'table': 'NSTableView',
      'outline': 'NSOutlineView',
      'tab group': 'NSTabView',
      'checkbox': 'NSButton',
      'radio button': 'NSButton',
      'slider': 'NSSlider',
      'progress indicator': 'NSProgressIndicator',
      'text area': 'NSTextView',
      'combo box': 'NSComboBox',
      'pop up button': 'NSPopUpButton',
      'toolbar': 'NSToolbar',
      'split group': 'NSSplitView'
    };
    
    return roleMap[role.toLowerCase()] || 'NSView';
  }

  private calculateConfidenceScore(role: string, title: string, value: string): number {
    let score = 0.5; // Base score
    
    // Higher confidence for interactive elements
    const interactiveRoles = ['button', 'text field', 'checkbox', 'radio button', 'menu item', 'combo box'];
    if (interactiveRoles.includes(role.toLowerCase())) {
      score += 0.3;
    }
    
    // Higher confidence if element has a title/label
    if (title && title.trim().length > 0) {
      score += 0.2;
    }
    
    // Higher confidence if element has a value
    if (value && value.trim().length > 0) {
      score += 0.1;
    }
    
    // Cap at 1.0
    return Math.min(score, 1.0);
  }

  private isRelevantElement(element: UIElement): boolean {
    // Skip elements that are too small (likely decorative) - but be more lenient
    if (element.width < 5 || element.height < 5) {
      return false;
    }
    
    // Skip invisible elements
    if (!element.isVisible) {
      return false;
    }
    
    // MUCH MORE INCLUSIVE: Include all potentially interactive elements
    const interactiveRoles = [
      'button', 'text field', 'checkbox', 'radio button', 'menu item', 
      'combo box', 'slider', 'tab', 'link', 'pop up button',
      // Add common macOS accessibility roles
      'AXButton', 'AXTextField', 'AXCheckBox', 'AXRadioButton', 'AXMenuItem',
      'AXComboBox', 'AXSlider', 'AXTab', 'AXLink', 'AXPopUpButton',
      'AXTextArea', 'AXSearchField', 'AXSecureTextField', 'AXTable', 'AXOutline',
      'AXList', 'AXScrollBar', 'AXSplitter', 'AXToolbar', 'AXTabGroup'
    ];
    
    const roleToCheck = element.elementRole.toLowerCase();
    if (interactiveRoles.some(role => roleToCheck.includes(role.toLowerCase()))) {
      return true;
    }
    
    // Include informative elements - be more lenient about content requirements
    const informativeRoles = [
      'static text', 'image', 'heading', 'text', 'label',
      'AXStaticText', 'AXImage', 'AXHeading', 'AXText', 'AXLabel'
    ];
    if (informativeRoles.some(role => roleToCheck.includes(role.toLowerCase()))) {
      // Accept elements with any content or reasonable size
      if (element.elementLabel.length > 0 || 
          (element.elementValue && element.elementValue.length > 0) ||
          (element.width > 20 && element.height > 10)) {
        return true;
      }
    }
    
    // Include containers - be more inclusive
    const containerRoles = [
      'group', 'window', 'dialog', 'sheet', 'scroll area', 'split group',
      'AXGroup', 'AXWindow', 'AXDialog', 'AXSheet', 'AXScrollArea', 'AXSplitGroup',
      'AXApplication', 'AXWebArea', 'AXGenericElement'
    ];
    if (containerRoles.some(role => roleToCheck.includes(role.toLowerCase()))) {
      // Accept containers with reasonable size, even without labels
      if (element.width > 50 && element.height > 20) {
        return true;
      }
    }
    
    // Catch-all: include any element with meaningful content or decent size
    if ((element.elementLabel && element.elementLabel.length > 2) ||
        (element.elementValue && element.elementValue.length > 2) ||
        (element.width > 100 && element.height > 30)) {
      return true;
    }
    
    return false;
  }

  async cleanup(): Promise<void> {
    if (this.axObserver) {
      // Cleanup AX observer
      this.axObserver = null;
    }
  }
}

// Windows Scanner (placeholder - would use UIAutomationClient)
class WindowsScanner implements PlatformScanner {
  async initialize(): Promise<void> {
    logger.info('Windows UI scanner initialized (placeholder)');
  }

  async getActiveApplication(): Promise<{ name: string; windowTitle: string }> {
    return { name: 'Windows App', windowTitle: 'Windows Window' };
  }

  async scanActiveWindows(): Promise<UIElement[]> {
    // Placeholder - would use Windows UIAutomationClient
    return [];
  }

  async cleanup(): Promise<void> {
    // Cleanup Windows UI automation
  }
}

// Linux Scanner (placeholder - would use xdotool/accessibility)
class LinuxScanner implements PlatformScanner {
  async initialize(): Promise<void> {
    logger.info('Linux UI scanner initialized (placeholder)');
  }

  async getActiveApplication(): Promise<{ name: string; windowTitle: string }> {
    return { name: 'Linux App', windowTitle: 'Linux Window' };
  }

  async scanActiveWindows(): Promise<UIElement[]> {
    // Placeholder - would use xdotool or accessibility APIs
    return [];
  }

  async cleanup(): Promise<void> {
    // Cleanup Linux accessibility
  }
}

// Main UI Indexer Daemon
export class UIIndexerDaemon extends EventEmitter {
  private scanner: PlatformScanner;
  private elementStore: ElementStore;
  private redisSync: RedisSync;
  private scanInterval: NodeJS.Timeout | null = null;
  private isRunning = false;
  private readonly SCAN_INTERVAL_MS = 3000; // 3 seconds

  constructor() {
    super();
    
    // Initialize platform-specific scanner
    const platform = process.platform;
    switch (platform) {
      case 'darwin':
        this.scanner = new MacOSScanner();
        break;
      case 'win32':
        this.scanner = new WindowsScanner();
        break;
      case 'linux':
        this.scanner = new LinuxScanner();
        break;
      default:
        throw new Error(`Unsupported platform: ${platform}`);
    }
    
    this.elementStore = new ElementStore();
    this.redisSync = new RedisSync();
  }

  async initialize(): Promise<void> {
    try {
      logger.info('Initializing UI Indexer Daemon...');
      
      await this.scanner.initialize();
      await this.elementStore.initialize();
      await this.redisSync.initialize();
      
      logger.info('UI Indexer Daemon initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize UI Indexer Daemon:', { error });
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('UI Indexer Daemon is already running');
      return;
    }

    try {
      await this.initialize();
      
      this.isRunning = true;
      logger.info('Starting UI Indexer Daemon...');
      
      // Initial scan
      await this.performScan();
      
      // Set up periodic scanning
      this.scanInterval = setInterval(async () => {
        try {
          await this.performScan();
        } catch (error) {
          logger.error('Scan interval error:', { error });
        }
      }, this.SCAN_INTERVAL_MS);
      
      // Set up window focus change detection (platform-specific)
      this.setupFocusChangeDetection();
      
      logger.info(`UI Indexer Daemon started (scanning every ${this.SCAN_INTERVAL_MS}ms)`);
      this.emit('started');
      
    } catch (error) {
      logger.error('Failed to start UI Indexer Daemon:', { error });
      this.isRunning = false;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping UI Indexer Daemon...');
    
    this.isRunning = false;
    
    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }
    
    await this.scanner.cleanup();
    
    logger.info('UI Indexer Daemon stopped');
    this.emit('stopped');
  }

  private async performScan(): Promise<void> {
    try {
      const startTime = Date.now();
      
      // Scan UI elements
      const elements = await this.scanner.scanActiveWindows();
      
      if (elements.length > 0) {
        // Store in PostgreSQL
        await this.elementStore.storeElements(elements);
        
        // Sync to Redis cache
        await this.redisSync.syncElements(elements);
        
        const scanTime = Date.now() - startTime;
        logger.debug(`UI scan completed: ${elements.length} elements in ${scanTime}ms`);
        
        this.emit('scan-completed', { elementCount: elements.length, scanTime });
      }
      
    } catch (error) {
      logger.error('UI scan failed:', { error });
      this.emit('scan-error', error);
    }
  }

  private setupFocusChangeDetection(): void {
    // Platform-specific focus change detection
    // This would trigger immediate scans when windows change focus
    // Implementation depends on platform capabilities
    
    logger.info('Focus change detection setup (placeholder)');
  }

  // Public API methods
  async getUIIndex(appName?: string, windowTitle?: string): Promise<UIElement[]> {
    return await this.elementStore.getElements(appName, windowTitle);
  }

  async findElementsByRole(role: string, appName?: string): Promise<UIElement[]> {
    return await this.elementStore.getElementsByRole(role, appName);
  }

  async findElementsByLabel(label: string, appName?: string): Promise<UIElement[]> {
    return await this.elementStore.getElementsByLabel(label, appName);
  }

  getStatus(): { isRunning: boolean; scanInterval: number; platform: string } {
    return {
      isRunning: this.isRunning,
      scanInterval: this.SCAN_INTERVAL_MS,
      platform: process.platform
    };
  }

  // Public method to get current active application via scanner
  async getCurrentActiveApplication(): Promise<{ name: string; windowTitle: string }> {
    if (!this.isRunning) {
      logger.warn('UI Indexer Daemon is not running');
      return { name: 'Unknown', windowTitle: 'Unknown' };
    }
    
    try {
      return await this.scanner.getActiveApplication();
    } catch (error) {
      logger.error('Failed to get current active application:', { error });
      return { name: 'Unknown', windowTitle: 'Unknown' };
    }
  }

  // Public method to trigger on-demand scanning of the current active application
  async scanCurrentApplication(): Promise<{ elements: any[]; appName: string; windowTitle: string } | null> {
    if (!this.isRunning) {
      logger.warn('UI Indexer Daemon is not running');
      return null;
    }
    
    try {
      logger.info('Triggering on-demand scan of current active application...');
      
      // Get current active application
      const activeApp = await this.scanner.getActiveApplication();
      if (!activeApp || activeApp.name === 'Unknown') {
        logger.warn('No active application found for scanning');
        return null;
      }
      
      logger.info(`Scanning UI elements for: ${activeApp.name} - ${activeApp.windowTitle}`);
      
      // Scan UI elements for the current application
      const elements = await this.scanner.scanActiveWindows();
      
      if (elements && elements.length > 0) {
        logger.info(`Found ${elements.length} UI elements, storing in database...`);
        
        // Convert raw elements to UIElement format
        const uiElements: UIElement[] = elements.map((element: any) => ({
          appName: activeApp.name,
          windowTitle: activeApp.windowTitle,
          elementRole: element.role || element.type || 'unknown',
          elementLabel: element.title || element.name || element.description || '',
          elementValue: element.value || '',
          x: element.position?.x || element.x || 0,
          y: element.position?.y || element.y || 0,
          width: element.size?.width || element.width || 0,
          height: element.size?.height || element.height || 0,
          accessibilityId: element.AXIdentifier || element.accessibilityIdentifier || '',
          className: element.AXRole || element.className || '',
          automationId: element.AXDescription || element.automationId || '',
          isEnabled: element.AXEnabled !== false && element.enabled !== false,
          isVisible: element.AXVisible !== false && element.visible !== false,
          confidenceScore: 1.0,
          lastSeen: new Date()
        }));
        
        // Store elements in database
        await this.elementStore.storeElements(uiElements);
        
        // Update cache
        await this.redisSync.syncElements(uiElements);
        
        logger.info(`Successfully stored ${elements.length} UI elements for ${activeApp.name}`);
        
        return {
          elements,
          appName: activeApp.name,
          windowTitle: activeApp.windowTitle
        };
      } else {
        logger.warn(`No UI elements found for ${activeApp.name}`);
        
        // Create a record to indicate we've scanned this app (even though it's empty)
        // This prevents repeated scanning and provides an audit trail
        const emptyRecord: UIElement = {
          appName: activeApp.name,
          windowTitle: activeApp.windowTitle,
          elementRole: 'scan_marker',
          elementLabel: 'No accessible UI elements found',
          elementValue: '',
          x: 0,
          y: 0,
          width: 0,
          height: 0,
          accessibilityId: '',
          className: 'empty_scan',
          automationId: `scan_${Date.now()}`,
          isEnabled: false,
          isVisible: false,
          confidenceScore: 1.0,
          lastSeen: new Date()
        };
        
        // Store the empty scan record
        await this.elementStore.storeElements([emptyRecord]);
        
        // Update cache to reflect the scan attempt
        await this.redisSync.syncElements([emptyRecord]);
        
        logger.info(`Stored empty scan record for ${activeApp.name} to prevent repeated scanning`);
        
        return {
          elements: [],
          appName: activeApp.name,
          windowTitle: activeApp.windowTitle
        };
      }
    } catch (error) {
      logger.error('Failed to scan current application:', { error });
      return null;
    }
  }
}

// Singleton instance
export const uiIndexerDaemon = new UIIndexerDaemon();

/**
 * Action History Analyzer
 * 
 * Provides deterministic checks based on action history to optimize intent execution.
 * Reduces unnecessary actions by analyzing what has already been done.
 */

import { IntentType, ActionType } from '../types/intentTypes';
import { logger } from '../utils/logger';

export interface ActionHistoryItem {
  actionType: ActionType;
  success: boolean;
  timestamp: number;
  error?: string;
  metadata?: {
    reasoning?: string;
    targetType?: string;
    targetDescription?: string;
    elementType?: string;
    fieldName?: string;
    [key: string]: any;
  };
}

export interface DeterministicCheckResult {
  shouldSkipAction: boolean;
  skipReason?: string;
  suggestedAction?: ActionType;
  suggestedReason?: string;
  contextData?: Record<string, any>;
}

export class ActionHistoryAnalyzer {
  /**
   * Main entry point: Check if an action should be skipped based on history
   */
  static shouldSkipAction(
    intentType: IntentType,
    actionHistory: ActionHistoryItem[],
    context: any
  ): DeterministicCheckResult {
    if (!actionHistory || actionHistory.length === 0) {
      return { shouldSkipAction: false };
    }

    const lastAction = actionHistory[actionHistory.length - 1];
    const lastTwoActions = actionHistory.slice(-2);
    const lastThreeActions = actionHistory.slice(-3);

    // Route to intent-specific analyzers
    switch (intentType) {
      case 'type_text':
        return this.analyzeTypeText(lastAction, lastTwoActions, context);
      
      case 'search':
        return this.analyzeSearch(lastAction, lastTwoActions, context);
      
      case 'paste':
        return this.analyzePaste(lastAction, context);
      
      case 'copy':
        return this.analyzeCopy(lastAction, lastTwoActions, context);
      
      case 'select':
        return this.analyzeSelect(lastAction, lastTwoActions, context);
      
      case 'upload':
        return this.analyzeUpload(lastAction, lastTwoActions, context);
      
      case 'form_fill':
        return this.analyzeFormFill(actionHistory, context);
      
      case 'authenticate':
        return this.analyzeAuthenticate(lastAction, actionHistory, context);
      
      case 'click_element':
        return this.analyzeClickElement(lastThreeActions, context);
      
      case 'drag':
        return this.analyzeDrag(lastAction, context);
      
      default:
        return { shouldSkipAction: false };
    }
  }

  /**
   * type_text: Skip findAndClick if field already focused
   */
  private static analyzeTypeText(
    lastAction: ActionHistoryItem,
    lastTwoActions: ActionHistoryItem[],
    context: any
  ): DeterministicCheckResult {
    // Check if last action was successful findAndClick on an input field
    if (
      lastAction.actionType === 'findAndClick' &&
      lastAction.success === true &&
      this.isInputElement(lastAction)
    ) {
      logger.info('🎯 [DETERMINISTIC] type_text: Field already focused from previous findAndClick', {
        lastAction: lastAction.actionType,
        targetType: lastAction.metadata?.targetType,
      });

      return {
        shouldSkipAction: true,
        skipReason: 'Field already focused from previous findAndClick',
        suggestedAction: 'typeText',
        suggestedReason: 'Go directly to typing since field is focused',
        contextData: {
          fieldAlreadyFocused: true,
          previousTarget: lastAction.metadata?.targetDescription,
        },
      };
    }

    // Check if typeText failed - might need to click field first
    if (
      lastAction.actionType === 'typeText' &&
      lastAction.success === false
    ) {
      logger.info('🎯 [DETERMINISTIC] type_text: Previous typeText failed, suggest clicking field', {
        lastAction: lastAction.actionType,
        error: lastAction.error,
      });

      return {
        shouldSkipAction: false,
        suggestedAction: 'findAndClick',
        suggestedReason: 'Previous typeText failed, field may not be focused',
        contextData: {
          needsFieldFocus: true,
        },
      };
    }

    return { shouldSkipAction: false };
  }

  /**
   * search: Skip findAndClick if search box already focused
   */
  private static analyzeSearch(
    lastAction: ActionHistoryItem,
    lastTwoActions: ActionHistoryItem[],
    context: any
  ): DeterministicCheckResult {
    // Same logic as type_text for search boxes
    if (
      lastAction.actionType === 'findAndClick' &&
      lastAction.success === true &&
      this.isSearchElement(lastAction)
    ) {
      logger.info('🎯 [DETERMINISTIC] search: Search box already focused', {
        lastAction: lastAction.actionType,
      });

      return {
        shouldSkipAction: true,
        skipReason: 'Search box already focused from previous findAndClick',
        suggestedAction: 'typeText',
        suggestedReason: 'Go directly to typing search query',
        contextData: {
          searchBoxFocused: true,
        },
      };
    }

    // If typeText succeeded, next action should be submit (Enter key)
    if (
      lastAction.actionType === 'typeText' &&
      lastAction.success === true
    ) {
      logger.info('🎯 [DETERMINISTIC] search: Query typed, suggest submit', {
        lastAction: lastAction.actionType,
      });

      return {
        shouldSkipAction: false,
        suggestedAction: 'pressKey',
        suggestedReason: 'Query typed, submit with Enter key',
        contextData: {
          readyToSubmit: true,
        },
      };
    }

    return { shouldSkipAction: false };
  }

  /**
   * paste: Skip findAndClick if field already focused
   */
  private static analyzePaste(
    lastAction: ActionHistoryItem,
    context: any
  ): DeterministicCheckResult {
    if (
      lastAction.actionType === 'findAndClick' &&
      lastAction.success === true &&
      this.isInputElement(lastAction)
    ) {
      logger.info('🎯 [DETERMINISTIC] paste: Field already focused', {
        lastAction: lastAction.actionType,
      });

      return {
        shouldSkipAction: true,
        skipReason: 'Field already focused from previous findAndClick',
        suggestedAction: 'pressKey',
        suggestedReason: 'Go directly to Cmd+V paste',
        contextData: {
          fieldAlreadyFocused: true,
        },
      };
    }

    return { shouldSkipAction: false };
  }

  /**
   * copy: Skip findAndClick if element already selected
   */
  private static analyzeCopy(
    lastAction: ActionHistoryItem,
    lastTwoActions: ActionHistoryItem[],
    context: any
  ): DeterministicCheckResult {
    // If last action was findAndClick on text element, go to Cmd+C
    if (
      lastAction.actionType === 'findAndClick' &&
      lastAction.success === true &&
      this.isTextElement(lastAction)
    ) {
      logger.info('🎯 [DETERMINISTIC] copy: Text element selected', {
        lastAction: lastAction.actionType,
      });

      return {
        shouldSkipAction: true,
        skipReason: 'Text element already selected',
        suggestedAction: 'pressKey',
        suggestedReason: 'Go directly to Cmd+C copy',
        contextData: {
          elementSelected: true,
        },
      };
    }

    // If last action was pressKey (Cmd+A), text is selected
    if (
      lastAction.actionType === 'pressKey' &&
      lastAction.success === true &&
      lastAction.metadata?.key === 'A'
    ) {
      logger.info('🎯 [DETERMINISTIC] copy: Text selected with Cmd+A', {
        lastAction: lastAction.actionType,
      });

      return {
        shouldSkipAction: false,
        suggestedAction: 'pressKey',
        suggestedReason: 'Text selected, copy with Cmd+C',
        contextData: {
          textSelected: true,
        },
      };
    }

    return { shouldSkipAction: false };
  }

  /**
   * select: Deterministic dropdown/menu selection flow
   */
  private static analyzeSelect(
    lastAction: ActionHistoryItem,
    lastTwoActions: ActionHistoryItem[],
    context: any
  ): DeterministicCheckResult {
    // If last action was findAndClick on dropdown, menu is now open
    if (
      lastAction.actionType === 'findAndClick' &&
      lastAction.success === true &&
      this.isDropdownElement(lastAction)
    ) {
      logger.info('🎯 [DETERMINISTIC] select: Dropdown opened', {
        lastAction: lastAction.actionType,
      });

      return {
        shouldSkipAction: false,
        suggestedAction: 'findAndClick',
        suggestedReason: 'Dropdown open, find and click option',
        contextData: {
          dropdownOpen: true,
        },
      };
    }

    // If last action was findAndClick on option, selection complete
    if (
      lastTwoActions.length === 2 &&
      lastTwoActions[0].actionType === 'findAndClick' &&
      lastTwoActions[1].actionType === 'findAndClick' &&
      lastTwoActions[1].success === true
    ) {
      logger.info('🎯 [DETERMINISTIC] select: Option selected', {
        actions: lastTwoActions.map(a => a.actionType),
      });

      return {
        shouldSkipAction: false,
        suggestedAction: 'screenshot',
        suggestedReason: 'Selection complete, verify result',
        contextData: {
          selectionComplete: true,
        },
      };
    }

    return { shouldSkipAction: false };
  }

  /**
   * upload: Deterministic file upload flow
   */
  private static analyzeUpload(
    lastAction: ActionHistoryItem,
    lastTwoActions: ActionHistoryItem[],
    context: any
  ): DeterministicCheckResult {
    // If last action was findAndClick on upload button, file dialog is open
    if (
      lastAction.actionType === 'findAndClick' &&
      lastAction.success === true &&
      this.isUploadButton(lastAction)
    ) {
      logger.info('🎯 [DETERMINISTIC] upload: File dialog opened', {
        lastAction: lastAction.actionType,
      });

      return {
        shouldSkipAction: false,
        suggestedAction: 'typeText',
        suggestedReason: 'File dialog open, type file path',
        contextData: {
          fileDialogOpen: true,
        },
      };
    }

    // If last action was typeText (file path), press Enter to confirm
    if (
      lastAction.actionType === 'typeText' &&
      lastAction.success === true &&
      lastTwoActions[0]?.actionType === 'findAndClick'
    ) {
      logger.info('🎯 [DETERMINISTIC] upload: File path typed', {
        lastAction: lastAction.actionType,
      });

      return {
        shouldSkipAction: false,
        suggestedAction: 'pressKey',
        suggestedReason: 'File path typed, press Enter to confirm',
        contextData: {
          readyToConfirm: true,
        },
      };
    }

    return { shouldSkipAction: false };
  }

  /**
   * form_fill: Track filled fields, skip redundant clicks
   */
  private static analyzeFormFill(
    actionHistory: ActionHistoryItem[],
    context: any
  ): DeterministicCheckResult {
    // Track which fields have been filled
    const filledFields = new Set<string>();
    
    for (const action of actionHistory) {
      if (
        action.actionType === 'typeText' &&
        action.success === true &&
        action.metadata?.fieldName
      ) {
        filledFields.add(action.metadata.fieldName);
      }
    }

    if (filledFields.size > 0) {
      logger.info('🎯 [DETERMINISTIC] form_fill: Tracking filled fields', {
        filledFields: Array.from(filledFields),
      });

      return {
        shouldSkipAction: false,
        contextData: {
          filledFields: Array.from(filledFields),
          totalFieldsFilled: filledFields.size,
        },
      };
    }

    return { shouldSkipAction: false };
  }

  /**
   * authenticate: Sequential login flow (username → password → submit)
   */
  private static analyzeAuthenticate(
    lastAction: ActionHistoryItem,
    actionHistory: ActionHistoryItem[],
    context: any
  ): DeterministicCheckResult {
    // Check if username field was just filled
    const usernameTyped = actionHistory.some(
      a => a.actionType === 'typeText' && 
           a.success === true && 
           a.metadata?.fieldName?.toLowerCase().includes('username')
    );

    // Check if password field was just filled
    const passwordTyped = actionHistory.some(
      a => a.actionType === 'typeText' && 
           a.success === true && 
           a.metadata?.fieldName?.toLowerCase().includes('password')
    );

    if (usernameTyped && !passwordTyped) {
      logger.info('🎯 [DETERMINISTIC] authenticate: Username filled, move to password', {
        lastAction: lastAction.actionType,
      });

      return {
        shouldSkipAction: false,
        suggestedAction: 'findAndClick',
        suggestedReason: 'Username filled, click password field',
        contextData: {
          authStep: 'password',
        },
      };
    }

    if (usernameTyped && passwordTyped) {
      logger.info('🎯 [DETERMINISTIC] authenticate: Credentials filled, submit', {
        lastAction: lastAction.actionType,
      });

      return {
        shouldSkipAction: false,
        suggestedAction: 'findAndClick',
        suggestedReason: 'Credentials filled, click submit button',
        contextData: {
          authStep: 'submit',
        },
      };
    }

    return { shouldSkipAction: false };
  }

  /**
   * click_element: Prevent retry loops
   */
  private static analyzeClickElement(
    lastThreeActions: ActionHistoryItem[],
    context: any
  ): DeterministicCheckResult {
    // Check if same element clicked 3 times
    if (lastThreeActions.length === 3) {
      const allSameClick = lastThreeActions.every(
        a => a.actionType === 'findAndClick' &&
             a.metadata?.targetDescription === lastThreeActions[0].metadata?.targetDescription
      );

      if (allSameClick) {
        logger.warn('🎯 [DETERMINISTIC] click_element: Same element clicked 3 times', {
          target: lastThreeActions[0].metadata?.targetDescription,
        });

        return {
          shouldSkipAction: true,
          skipReason: 'Same element clicked 3 times - element not responding',
          suggestedAction: 'end',
          suggestedReason: 'Element not responding after 3 attempts',
          contextData: {
            retryLoopDetected: true,
          },
        };
      }
    }

    return { shouldSkipAction: false };
  }

  /**
   * drag: Multi-step drag flow
   */
  private static analyzeDrag(
    lastAction: ActionHistoryItem,
    context: any
  ): DeterministicCheckResult {
    // If last action was findAndClick on source, ready to drag
    if (
      lastAction.actionType === 'findAndClick' &&
      lastAction.success === true
    ) {
      logger.info('🎯 [DETERMINISTIC] drag: Source selected, ready to drag', {
        lastAction: lastAction.actionType,
      });

      return {
        shouldSkipAction: false,
        suggestedAction: 'clickAndDrag',
        suggestedReason: 'Source selected, perform drag to target',
        contextData: {
          sourceSelected: true,
        },
      };
    }

    return { shouldSkipAction: false };
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private static isInputElement(action: ActionHistoryItem): boolean {
    const targetType = action.metadata?.targetType?.toLowerCase() || '';
    const targetDesc = action.metadata?.targetDescription?.toLowerCase() || '';
    const elementType = action.metadata?.elementType?.toLowerCase() || '';
    
    return (
      targetType.includes('input') ||
      targetType.includes('field') ||
      targetType.includes('textbox') ||
      targetDesc.includes('input') ||
      targetDesc.includes('field') ||
      targetDesc.includes('textbox') ||
      elementType.includes('input')
    );
  }

  private static isSearchElement(action: ActionHistoryItem): boolean {
    const targetDesc = action.metadata?.targetDescription?.toLowerCase() || '';
    
    return (
      targetDesc.includes('search') ||
      targetDesc.includes('query') ||
      targetDesc.includes('find')
    );
  }

  private static isTextElement(action: ActionHistoryItem): boolean {
    const targetType = action.metadata?.targetType?.toLowerCase() || '';
    
    return (
      targetType.includes('text') ||
      targetType.includes('paragraph') ||
      targetType.includes('label')
    );
  }

  private static isDropdownElement(action: ActionHistoryItem): boolean {
    const targetDesc = action.metadata?.targetDescription?.toLowerCase() || '';
    
    return (
      targetDesc.includes('dropdown') ||
      targetDesc.includes('select') ||
      targetDesc.includes('menu')
    );
  }

  private static isUploadButton(action: ActionHistoryItem): boolean {
    const targetDesc = action.metadata?.targetDescription?.toLowerCase() || '';
    
    return (
      targetDesc.includes('upload') ||
      targetDesc.includes('choose file') ||
      targetDesc.includes('attach')
    );
  }
}

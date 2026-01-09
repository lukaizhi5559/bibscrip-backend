/**
 * Intent Prompt Builder Service
 * 
 * Builds action-specific prompts for each intent type
 * Uses separate prompt files for maintainability
 * Only includes relevant actions in LLM context (smaller context windows)
 */

import { IntentType, IntentExecutionRequest } from '../types/intentTypes';
import { buildNavigatePrompt } from '../prompts/intent_prompts/navigate.prompt';
import { buildCapturePrompt } from '../prompts/intent_prompts/capture.prompt';
import { buildTypeTextPrompt } from '../prompts/intent_prompts/type_text.prompt';
import { buildClickElementPrompt } from '../prompts/intent_prompts/click_element.prompt';
import { buildSearchPrompt } from '../prompts/intent_prompts/search.prompt';
import { buildWaitPrompt } from '../prompts/intent_prompts/wait.prompt';
import { buildSwitchAppPrompt } from '../prompts/intent_prompts/switch_app.prompt';
import { buildCloseAppPrompt } from '../prompts/intent_prompts/close_app.prompt';
import { buildSelectPrompt } from '../prompts/intent_prompts/select.prompt';
import { buildDragPrompt } from '../prompts/intent_prompts/drag.prompt';
import { buildScrollPrompt } from '../prompts/intent_prompts/scroll.prompt';
import { buildExtractPrompt } from '../prompts/intent_prompts/extract.prompt';
import { buildCopyPrompt } from '../prompts/intent_prompts/copy.prompt';
import { buildPastePrompt } from '../prompts/intent_prompts/paste.prompt';
import { buildStorePrompt } from '../prompts/intent_prompts/store.prompt';
import { buildRetrievePrompt } from '../prompts/intent_prompts/retrieve.prompt';
import { buildVerifyPrompt } from '../prompts/intent_prompts/verify.prompt';
import { buildComparePrompt } from '../prompts/intent_prompts/compare.prompt';
import { buildCheckPrompt } from '../prompts/intent_prompts/check.prompt';
import { buildUploadPrompt } from '../prompts/intent_prompts/upload.prompt';
import { buildDownloadPrompt } from '../prompts/intent_prompts/download.prompt';
import { buildOpenFilePrompt } from '../prompts/intent_prompts/open_file.prompt';
import { buildSaveFilePrompt } from '../prompts/intent_prompts/save_file.prompt';
import { buildZoomPrompt } from '../prompts/intent_prompts/zoom.prompt';
import { buildAuthenticatePrompt } from '../prompts/intent_prompts/authenticate.prompt';
import { buildFormFillPrompt } from '../prompts/intent_prompts/form_fill.prompt';
import { buildMultiSelectPrompt } from '../prompts/intent_prompts/multi_select.prompt';
import { buildCustomPrompt } from '../prompts/intent_prompts/custom.prompt';

export class IntentPromptBuilder {
  /**
   * Build intent-specific prompt
   * Routes to appropriate prompt builder based on intent type
   */
  buildPrompt(request: IntentExecutionRequest): string {
    const { intentType } = request;

    switch (intentType) {
      case 'navigate':
        return buildNavigatePrompt(request);
      
      case 'capture':
        return buildCapturePrompt(request);
      
      case 'type_text':
        return buildTypeTextPrompt(request);
      
      case 'click_element':
        return buildClickElementPrompt(request);
      
      case 'search':
        return buildSearchPrompt(request);
      
      case 'wait':
        return buildWaitPrompt(request);
      
      case 'switch_app':
        return buildSwitchAppPrompt(request);
      
      case 'close_app':
        return buildCloseAppPrompt(request);
      
      case 'select':
        return buildSelectPrompt(request);
      
      case 'drag':
        return buildDragPrompt(request);
      
      case 'scroll':
        return buildScrollPrompt(request);
      
      case 'extract':
        return buildExtractPrompt(request);
      
      case 'copy':
        return buildCopyPrompt(request);
      
      case 'paste':
        return buildPastePrompt(request);
      
      case 'store':
        return buildStorePrompt(request);
      
      case 'retrieve':
        return buildRetrievePrompt(request);
      
      case 'verify':
        return buildVerifyPrompt(request);
      
      case 'compare':
        return buildComparePrompt(request);
      
      case 'check':
        return buildCheckPrompt(request);
      
      case 'upload':
        return buildUploadPrompt(request);
      
      case 'download':
        return buildDownloadPrompt(request);
      
      case 'open_file':
        return buildOpenFilePrompt(request);
      
      case 'save_file':
        return buildSaveFilePrompt(request);
      
      case 'zoom':
        return buildZoomPrompt(request);
      
      case 'authenticate':
        return buildAuthenticatePrompt(request);
      
      case 'form_fill':
        return buildFormFillPrompt(request);
      
      case 'multi_select':
        return buildMultiSelectPrompt(request);
      
      case 'custom':
        return buildCustomPrompt(request);
      
      default:
        throw new Error(`Unknown intent type: ${intentType}`);
    }
  }
}

export const intentPromptBuilder = new IntentPromptBuilder();

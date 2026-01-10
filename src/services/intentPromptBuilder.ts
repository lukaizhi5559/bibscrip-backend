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
// File Operations (Phase 4)
import { buildReadFilePrompt } from '../prompts/intent_prompts/read_file.prompt';
import { buildWriteFilePrompt } from '../prompts/intent_prompts/write_file.prompt';
import { buildCopyFilePrompt } from '../prompts/intent_prompts/copy_file.prompt';
import { buildMoveFilePrompt } from '../prompts/intent_prompts/move_file.prompt';
import { buildDeleteFilePrompt } from '../prompts/intent_prompts/delete_file.prompt';
import { buildListFilesPrompt } from '../prompts/intent_prompts/list_files.prompt';
import { buildSearchFilesPrompt } from '../prompts/intent_prompts/search_files.prompt';
import { buildCreateFolderPrompt } from '../prompts/intent_prompts/create_folder.prompt';
import { buildDeleteFolderPrompt } from '../prompts/intent_prompts/delete_folder.prompt';
import { buildFileInfoPrompt } from '../prompts/intent_prompts/file_info.prompt';
import { buildModifyPermissionsPrompt } from '../prompts/intent_prompts/modify_permissions.prompt';
import { buildCompressPrompt } from '../prompts/intent_prompts/compress.prompt';
import { buildDecompressPrompt } from '../prompts/intent_prompts/decompress.prompt';

export class IntentPromptBuilder {
  /**
   * Build intent-specific prompt
   * Routes to appropriate prompt builder based on intent type
   * @param request - Intent execution request
   * @param actionHistory - Previous actions in this step (for iterative refinement)
   */
  buildPrompt(request: IntentExecutionRequest, actionHistory?: any[]): string {
    const { intentType } = request;

    switch (intentType) {
      case 'navigate':
        return buildNavigatePrompt(request, actionHistory);
      
      case 'capture':
        return buildCapturePrompt(request, actionHistory);
      
      case 'type_text':
        return buildTypeTextPrompt(request, actionHistory);
      
      case 'click_element':
        return buildClickElementPrompt(request, actionHistory);
      
      case 'search':
        return buildSearchPrompt(request, actionHistory);
      
      case 'wait':
        return buildWaitPrompt(request, actionHistory);
      
      case 'switch_app':
        return buildSwitchAppPrompt(request, actionHistory);
      
      case 'close_app':
        return buildCloseAppPrompt(request, actionHistory);
      
      case 'select':
        return buildSelectPrompt(request, actionHistory);
      
      case 'drag':
        return buildDragPrompt(request, actionHistory);
      
      case 'scroll':
        return buildScrollPrompt(request, actionHistory);
      
      case 'extract':
        return buildExtractPrompt(request, actionHistory);
      
      case 'copy':
        return buildCopyPrompt(request, actionHistory);
      
      case 'paste':
        return buildPastePrompt(request, actionHistory);
      
      case 'store':
        return buildStorePrompt(request, actionHistory);
      
      case 'retrieve':
        return buildRetrievePrompt(request, actionHistory);
      
      case 'verify':
        return buildVerifyPrompt(request, actionHistory);
      
      case 'compare':
        return buildComparePrompt(request, actionHistory);
      
      case 'check':
        return buildCheckPrompt(request, actionHistory);
      
      case 'upload':
        return buildUploadPrompt(request, actionHistory);
      
      case 'download':
        return buildDownloadPrompt(request, actionHistory);
      
      case 'open_file':
        return buildOpenFilePrompt(request, actionHistory);
      
      case 'save_file':
        return buildSaveFilePrompt(request, actionHistory);
      
      case 'zoom':
        return buildZoomPrompt(request, actionHistory);
      
      case 'authenticate':
        return buildAuthenticatePrompt(request, actionHistory);
      
      case 'form_fill':
        return buildFormFillPrompt(request, actionHistory);
      
      case 'multi_select':
        return buildMultiSelectPrompt(request, actionHistory);
      
      case 'custom':
        return buildCustomPrompt(request, actionHistory);
      
      // File Operations (Phase 4)
      case 'read_file':
        return buildReadFilePrompt(request, actionHistory);
      
      case 'write_file':
        return buildWriteFilePrompt(request, actionHistory);
      
      case 'copy_file':
        return buildCopyFilePrompt(request, actionHistory);
      
      case 'move_file':
        return buildMoveFilePrompt(request, actionHistory);
      
      case 'delete_file':
        return buildDeleteFilePrompt(request, actionHistory);
      
      case 'list_files':
        return buildListFilesPrompt(request, actionHistory);
      
      case 'search_files':
        return buildSearchFilesPrompt(request, actionHistory);
      
      case 'create_folder':
        return buildCreateFolderPrompt(request, actionHistory);
      
      case 'delete_folder':
        return buildDeleteFolderPrompt(request, actionHistory);
      
      case 'file_info':
        return buildFileInfoPrompt(request, actionHistory);
      
      case 'modify_permissions':
        return buildModifyPermissionsPrompt(request, actionHistory);
      
      case 'compress':
        return buildCompressPrompt(request, actionHistory);
      
      case 'decompress':
        return buildDecompressPrompt(request, actionHistory);
      
      default:
        throw new Error(`Unknown intent type: ${intentType}`);
    }
  }
}

export const intentPromptBuilder = new IntentPromptBuilder();

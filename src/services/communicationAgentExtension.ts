/**
 * Communication Agent Extension
 * 
 * Simplified forwarder for Worker Agent messages:
 * 1. Forward Worker Agent progress updates to frontend
 * 2. Forward Worker Agent completion messages
 * 3. Handle Worker Agent errors
 * 
 * Note: All LLM requests now route directly to Worker Agent via IPC.
 * This backend component only handles Worker Agent → Frontend communication.
 */

import { logger } from '../utils/logger';
import WebSocket from 'ws';
import { StreamingMessage, StreamingMessageType } from '../types/streaming';

export class CommunicationAgentExtension {
  private ws: WebSocket;
  private sessionId: string;

  constructor(ws: WebSocket, sessionId: string, userId?: string, clientId?: string) {
    this.ws = ws;
    this.sessionId = sessionId;
  }

  /**
   * Handle incoming message - simplified to only handle Worker Agent messages
   * All LLM requests now route directly to Worker Agent via IPC in frontend
   */
  async handleMessageWithRouting(message: StreamingMessage): Promise<void> {
    const { type } = message;

    // Handle Worker Agent progress updates
    if (type === 'worker_progress' as any) {
      await this.handleWorkerProgress(message);
      return;
    }

    if (type === 'worker_completed' as any) {
      await this.handleWorkerCompleted(message);
      return;
    }

    if (type === 'worker_error' as any) {
      await this.handleWorkerError(message);
      return;
    }

    // Handle Worker Agent status polling (frontend checking worker status)
    if (type === 'worker_status_poll' as any) {
      await this.handleWorkerStatusPoll(message);
      return;
    }

    // Log unknown message types for debugging
    logger.warn('⚠️ [COMM_AGENT] Unknown message type received', {
      type,
      sessionId: this.sessionId
    });
  }


  /**
   * Handle Worker Agent progress updates
   */
  private async handleWorkerProgress(message: any): Promise<void> {
    const { sessionId, data } = message;
    const progress = data;

    logger.info('📊 [COMM_AGENT] Worker progress update', {
      sessionId,
      nodeName: progress.nodeName,
      status: progress.status,
      stepDescription: progress.stepDescription
    });

    // Stream step-level progress to user
    if (progress.stepDescription) {
      this.sendToClient({
        id: `${sessionId}_progress_${Date.now()}`,
        type: StreamingMessageType.LLM_STREAM_CHUNK,
        payload: `\n\n${progress.stepDescription}\n`,
        timestamp: Date.now(),
        metadata: {
          source: 'worker_agent',
          nodeName: progress.nodeName,
          status: progress.status
        }
      });
    }

    // Stream action-level progress if available
    if (progress.actionDescription) {
      this.sendToClient({
        id: `${sessionId}_action_${Date.now()}`,
        type: StreamingMessageType.LLM_STREAM_CHUNK,
        payload: `  → ${progress.actionDescription}\n`,
        timestamp: Date.now(),
        metadata: {
          source: 'worker_agent',
          nodeName: progress.nodeName,
          status: 'action'
        }
      });
    }
  }

  /**
   * Handle Worker Agent completion
   */
  private async handleWorkerCompleted(message: any): Promise<void> {
    const { sessionId, data } = message;
    const result = data;

    logger.info('✅ [COMM_AGENT] Worker completed', {
      sessionId,
      success: result.success,
      elapsedMs: result.elapsedMs
    });

    // Send final result to user
    if (result.response) {
      this.sendToClient({
        id: `${sessionId}_result`,
        type: StreamingMessageType.LLM_STREAM_CHUNK,
        payload: `\n\n${result.response}`,
        timestamp: Date.now(),
        metadata: {
          source: 'worker_agent',
          completed: true
        }
      });
    }

    // Send completion signal
    this.sendToClient({
      id: `${sessionId}_complete`,
      type: StreamingMessageType.LLM_STREAM_END,
      payload: {
        fullText: result.response,
        completed: true,
        elapsedMs: result.elapsedMs,
        source: 'worker_agent'
      },
      timestamp: Date.now()
    });
  }

  /**
   * Handle Worker Agent errors
   */
  private async handleWorkerError(message: any): Promise<void> {
    const { sessionId, error } = message;

    logger.error('❌ [COMM_AGENT] Worker error', {
      sessionId,
      error
    });

    this.sendError(sessionId, `Worker Agent error: ${error}`);
  }

  /**
   * Handle Worker Agent status polling from frontend
   * Frontend sends these to check if worker is still running
   * We just acknowledge them without sending error messages
   */
  private async handleWorkerStatusPoll(message: any): Promise<void> {
    const { sessionId, data } = message;

    logger.info('📊 [COMM_AGENT] Worker status poll received', {
      sessionId,
      status: data?.status,
      message: data?.message
    });

    // Simply acknowledge the poll - no need to send anything back
    // The frontend is just checking if the worker is still running
    // Worker progress updates are sent separately via worker_progress messages
  }

  /**
   * Send message to client
   */
  private sendToClient(message: any): void {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error to client
   */
  private sendError(requestId: string, error: string): void {
    this.sendToClient({
      id: `${requestId}_error`,
      type: StreamingMessageType.ERROR,
      payload: { error },
      timestamp: Date.now()
    });
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    // No resources to clean up
  }
}

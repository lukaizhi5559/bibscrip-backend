/**
 * Intent-Based WebSocket Handler
 * 
 * New WebSocket server for intent-driven automation
 * - Receives intent execution requests from frontend
 * - Uses IntentExecutionEngine for step execution
 * - Returns step_complete with output screenshot and data
 * - Smaller, focused architecture vs old computerUseWebSocket
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';
import { logger } from '../utils/logger';
import { intentExecutionEngine } from '../services/intentExecutionEngine';
import { IntentExecutionRequest, IntentType } from '../types/intentTypes';

interface IntentWebSocketMessage {
  type: 'execute_intent' | 'ping';
  requestId?: string;
  data?: IntentExecutionRequest;
}

interface IntentWebSocketResponse {
  type: 'intent_result' | 'error' | 'pong';
  requestId?: string;
  data?: any;
  error?: string;
}

export class IntentWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();

  initialize(server: Server) {
    this.wss = new WebSocketServer({ 
      server, 
      path: '/intent-use'
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    logger.info('Intent WebSocket server initialized at ws://localhost:4000/intent-use');
  }

  private handleConnection(ws: WebSocket) {
    this.clients.add(ws);
    logger.info('Intent WebSocket client connected', { 
      totalClients: this.clients.size 
    });

    // Send welcome message
    this.sendMessage(ws, {
      type: 'pong',
      data: { message: 'Connected to intent execution server' }
    });

    ws.on('message', async (data: Buffer) => {
      try {
        const message: IntentWebSocketMessage = JSON.parse(data.toString());
        await this.handleMessage(ws, message);
      } catch (error: any) {
        logger.error('Failed to process intent WebSocket message', { 
          error: error.message 
        });
        this.sendMessage(ws, {
          type: 'error',
          error: `Failed to process message: ${error.message}`
        });
      }
    });

    ws.on('close', () => {
      this.clients.delete(ws);
      logger.info('Intent WebSocket client disconnected', { 
        totalClients: this.clients.size 
      });
    });

    ws.on('error', (error) => {
      logger.error('Intent WebSocket error', { error: error.message });
      this.clients.delete(ws);
    });
  }

  private async handleMessage(ws: WebSocket, message: IntentWebSocketMessage) {
    const { type, requestId, data } = message;

    switch (type) {
      case 'ping':
        this.sendMessage(ws, { type: 'pong', requestId });
        break;

      case 'execute_intent':
        if (!data) {
          this.sendMessage(ws, {
            type: 'error',
            requestId,
            error: 'Missing intent execution data'
          });
          return;
        }

        await this.executeIntent(ws, data, requestId);
        break;

      default:
        this.sendMessage(ws, {
          type: 'error',
          requestId,
          error: `Unknown message type: ${type}`
        });
    }
  }

  private async executeIntent(
    ws: WebSocket,
    request: IntentExecutionRequest,
    requestId?: string
  ) {
    try {
      logger.info('Executing intent via WebSocket', {
        intentType: request.intentType,
        stepId: request.stepData.id,
        requestId
      });

      // Validate request
      this.validateIntentRequest(request);

      // Execute intent using IntentExecutionEngine
      const result = await intentExecutionEngine.executeIntent(request);

      // Send result back to client
      this.sendMessage(ws, {
        type: 'intent_result',
        requestId,
        data: result
      });

      logger.info('Intent execution completed', {
        intentType: request.intentType,
        stepId: request.stepData.id,
        status: result.status,
        actionsExecuted: result.actions.length,
        executionTimeMs: result.executionTimeMs
      });

    } catch (error: any) {
      logger.error('Intent execution failed', {
        intentType: request.intentType,
        stepId: request.stepData?.id,
        error: error.message,
        requestId
      });

      this.sendMessage(ws, {
        type: 'error',
        requestId,
        error: error.message
      });
    }
  }

  private validateIntentRequest(request: IntentExecutionRequest) {
    if (!request.intentType) {
      throw new Error('Missing intentType');
    }

    if (!request.stepData) {
      throw new Error('Missing stepData');
    }

    if (!request.stepData.id) {
      throw new Error('Missing stepData.id');
    }

    if (!request.stepData.description) {
      throw new Error('Missing stepData.description');
    }

    if (!request.context) {
      throw new Error('Missing context');
    }

    if (!request.context.screenshot) {
      throw new Error('Missing context.screenshot');
    }

    if (!request.context.screenshot.base64) {
      throw new Error('Missing context.screenshot.base64');
    }

    // Validate intent type
    const validIntents: IntentType[] = [
      'navigate', 'switch_app', 'close_app', 'click_element', 'type_text', 'search',
      'select', 'drag', 'scroll', 'capture', 'extract', 'copy', 'paste', 'store',
      'retrieve', 'wait', 'verify', 'compare', 'check', 'upload', 'download',
      'open_file', 'save_file', 'zoom', 'authenticate', 'form_fill', 'multi_select', 'custom'
    ];

    if (!validIntents.includes(request.intentType)) {
      throw new Error(`Invalid intent type: ${request.intentType}`);
    }
  }

  private sendMessage(ws: WebSocket, message: IntentWebSocketResponse) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  close() {
    if (this.wss) {
      this.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.close();
        }
      });
      this.wss.close();
      logger.info('Intent WebSocket server closed');
    }
  }
}

export const intentWebSocketServer = new IntentWebSocketServer();

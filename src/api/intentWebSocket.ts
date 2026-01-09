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

interface IntentSession {
  sessionId: string;
  isPaused: boolean;
  currentStep: number;
  ws: WebSocket;
  createdAt: number;
  pendingClarification?: {
    stepId: string;
    request: IntentExecutionRequest;
    requestId?: string;
  };
}

interface IntentWebSocketMessage {
  type: 'execute_intent' | 'pause' | 'resume' | 'stop' | 'clarification_answer' | 'ping';
  sessionId?: string;
  requestId?: string;
  stepId?: string;
  data?: IntentExecutionRequest;
  answers?: Record<string, string>;
}

interface IntentWebSocketResponse {
  type: 'intent_result' | 'clarification_needed' | 'paused' | 'resumed' | 'stopped' | 'error' | 'pong';
  requestId?: string;
  sessionId?: string;
  stepId?: string;
  data?: any;
  questions?: any[];
  error?: string;
}

export class IntentWebSocketServer {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocket> = new Set();
  private sessions: Map<string, IntentSession> = new Map();

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

        await this.executeIntent(ws, data, requestId, message.sessionId);
        break;

      case 'pause':
        this.handlePause(ws, message.sessionId, requestId);
        break;

      case 'resume':
        this.handleResume(ws, message.sessionId, requestId);
        break;

      case 'stop':
        this.handleStop(ws, message.sessionId, requestId);
        break;

      case 'clarification_answer':
        await this.handleClarificationAnswer(ws, message, requestId);
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
    requestId?: string,
    sessionId?: string
  ) {
    try {
      logger.info('Executing intent via WebSocket', {
        intentType: request.intentType,
        stepId: request.stepData.id,
        requestId
      });

      // Validate request
      this.validateIntentRequest(request);

      // Create or update session
      if (sessionId) {
        const session = this.sessions.get(sessionId);
        if (session && session.isPaused) {
          logger.info('Session is paused, queuing intent execution', { sessionId });
          this.sendMessage(ws, {
            type: 'error',
            requestId,
            sessionId,
            error: 'Session is paused. Resume to continue.'
          });
          return;
        }

        // Update or create session
        this.sessions.set(sessionId, {
          sessionId,
          isPaused: false,
          currentStep: (session?.currentStep || 0) + 1,
          ws,
          createdAt: session?.createdAt || Date.now()
        });
      }

      // Execute intent using IntentExecutionEngine
      const result = await intentExecutionEngine.executeIntent(request);

      // Check if clarification is needed
      if (result.status === 'clarification_needed') {
        // Store pending clarification in session
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          if (session) {
            session.pendingClarification = {
              stepId: request.stepData.id,
              request,
              requestId,
            };
          }
        }

        // Send clarification request to frontend
        this.sendMessage(ws, {
          type: 'clarification_needed',
          requestId,
          sessionId,
          stepId: request.stepData.id,
          questions: result.clarificationQuestions,
          data: {
            actionsExecuted: result.actions.length,
            executionTimeMs: result.executionTimeMs,
          },
        });

        logger.info('Clarification requested', {
          intentType: request.intentType,
          stepId: request.stepData.id,
          questionCount: result.clarificationQuestions?.length || 0,
        });

        return;
      }

      // Send result back to client
      this.sendMessage(ws, {
        type: 'intent_result',
        requestId,
        sessionId,
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

  private handlePause(ws: WebSocket, sessionId?: string, requestId?: string) {
    if (!sessionId) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        error: 'Missing sessionId for pause'
      });
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        sessionId,
        error: 'Session not found'
      });
      return;
    }

    session.isPaused = true;
    logger.info('Session paused', { sessionId });

    this.sendMessage(ws, {
      type: 'paused',
      requestId,
      sessionId,
      data: { currentStep: session.currentStep }
    });
  }

  private handleResume(ws: WebSocket, sessionId?: string, requestId?: string) {
    if (!sessionId) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        error: 'Missing sessionId for resume'
      });
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        sessionId,
        error: 'Session not found'
      });
      return;
    }

    session.isPaused = false;
    logger.info('Session resumed', { sessionId });

    this.sendMessage(ws, {
      type: 'resumed',
      requestId,
      sessionId,
      data: { currentStep: session.currentStep }
    });
  }

  private handleStop(ws: WebSocket, sessionId?: string, requestId?: string) {
    if (!sessionId) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        error: 'Missing sessionId for stop'
      });
      return;
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      this.sessions.delete(sessionId);
      logger.info('Session stopped and removed', { sessionId });
    }

    this.sendMessage(ws, {
      type: 'stopped',
      requestId,
      sessionId,
      data: { message: 'Session stopped successfully' }
    });
  }

  private async handleClarificationAnswer(
    ws: WebSocket,
    message: IntentWebSocketMessage,
    requestId?: string
  ) {
    const { sessionId, stepId, answers } = message;

    if (!sessionId) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        error: 'Missing sessionId for clarification answer'
      });
      return;
    }

    if (!stepId) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        sessionId,
        error: 'Missing stepId for clarification answer'
      });
      return;
    }

    if (!answers) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        sessionId,
        error: 'Missing answers for clarification'
      });
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        sessionId,
        error: 'Session not found'
      });
      return;
    }

    if (!session.pendingClarification || session.pendingClarification.stepId !== stepId) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        sessionId,
        error: 'No pending clarification for this step'
      });
      return;
    }

    logger.info('Clarification answers received', {
      sessionId,
      stepId,
      answerCount: Object.keys(answers).length,
    });

    // Re-execute intent with clarification answers
    try {
      const { request } = session.pendingClarification;
      const result = await intentExecutionEngine.executeIntent(request, answers);

      // Clear pending clarification
      session.pendingClarification = undefined;

      // Check if more clarification is needed
      if (result.status === 'clarification_needed') {
        session.pendingClarification = {
          stepId: request.stepData.id,
          request,
          requestId,
        };

        this.sendMessage(ws, {
          type: 'clarification_needed',
          requestId,
          sessionId,
          stepId: request.stepData.id,
          questions: result.clarificationQuestions,
          data: {
            actionsExecuted: result.actions.length,
            executionTimeMs: result.executionTimeMs,
          },
        });

        logger.info('Additional clarification requested', {
          intentType: request.intentType,
          stepId: request.stepData.id,
          questionCount: result.clarificationQuestions?.length || 0,
        });

        return;
      }

      // Send result back to client
      this.sendMessage(ws, {
        type: 'intent_result',
        requestId,
        sessionId,
        data: result,
      });

      logger.info('Intent execution completed after clarification', {
        intentType: request.intentType,
        stepId: request.stepData.id,
        status: result.status,
        actionsExecuted: result.actions.length,
        executionTimeMs: result.executionTimeMs,
      });
    } catch (error: any) {
      logger.error('Intent execution failed after clarification', {
        sessionId,
        stepId,
        error: error.message,
      });

      this.sendMessage(ws, {
        type: 'error',
        requestId,
        sessionId,
        error: error.message,
      });
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

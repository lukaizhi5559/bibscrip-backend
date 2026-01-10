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
  // Streaming execution state
  currentExecution?: {
    stepId: string;
    intentType: IntentType;
    request: IntentExecutionRequest;
    requestId?: string;
    actionHistory: any[];
    startTime: number;
  };
}

interface IntentWebSocketMessage {
  type: 'execute_intent' | 'action_complete' | 'pause' | 'resume' | 'stop' | 'clarification_answer' | 'ping';
  sessionId?: string;
  requestId?: string;
  stepId?: string;
  data?: IntentExecutionRequest;
  answers?: Record<string, string>;
  // For action_complete
  actionResult?: {
    actionType: string;
    success: boolean;
    error?: string;
    metadata?: any;
  };
  screenshot?: {
    base64: string;
    mimeType: string;
  };
}

interface IntentWebSocketResponse {
  type: 'execute_action' | 'intent_complete' | 'clarification_needed' | 'paused' | 'resumed' | 'stopped' | 'error' | 'pong';
  requestId?: string;
  sessionId?: string;
  stepId?: string;
  data?: any;
  questions?: any[];
  error?: string;
  // For execute_action
  action?: {
    type: string;
    coordinates?: { x: number; y: number };
    fromCoordinates?: { x: number; y: number };
    toCoordinates?: { x: number; y: number };
    text?: string;
    key?: string;
    ms?: number;
    reasoning?: string;
    confidence?: number;
    detectionMethod?: string;
    [key: string]: any;
  };
  // For intent_complete
  result?: any;
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

      case 'action_complete':
        await this.handleActionComplete(ws, message, requestId);
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
      logger.info('Starting streaming intent execution', {
        intentType: request.intentType,
        stepId: request.stepData.id,
        requestId,
        sessionId
      });

      // Validate request
      this.validateIntentRequest(request);

      // Create or update session with streaming execution state
      if (!sessionId) {
        sessionId = `session-${Date.now()}`;
      }

      const session = this.sessions.get(sessionId);
      if (session && session.isPaused) {
        logger.info('Session is paused', { sessionId });
        this.sendMessage(ws, {
          type: 'error',
          requestId,
          sessionId,
          error: 'Session is paused. Resume to continue.'
        });
        return;
      }

      // Initialize streaming execution state
      this.sessions.set(sessionId, {
        sessionId,
        isPaused: false,
        currentStep: (session?.currentStep || 0) + 1,
        ws,
        createdAt: session?.createdAt || Date.now(),
        currentExecution: {
          stepId: request.stepData.id,
          intentType: request.intentType,
          request,
          requestId,
          actionHistory: [],
          startTime: Date.now()
        }
      });

      logger.info('Session initialized for streaming execution', {
        sessionId,
        stepId: request.stepData.id
      });

      // Get first action from IntentExecutionEngine
      await this.executeNextAction(ws, sessionId, request);

    } catch (error: any) {
      logger.error('Intent execution failed', {
        intentType: request.intentType,
        stepId: request.stepData.id,
        error: error.message,
      });

      this.sendMessage(ws, {
        type: 'error',
        requestId,
        sessionId,
        error: error.message,
      });

      // Clean up session execution state
      if (sessionId) {
        const session = this.sessions.get(sessionId);
        if (session) {
          session.currentExecution = undefined;
        }
      }
    }
  }

  /**
   * Execute next action in streaming mode
   */
  private async executeNextAction(
    ws: WebSocket,
    sessionId: string,
    request: IntentExecutionRequest
  ) {
    const session = this.sessions.get(sessionId);
    if (!session || !session.currentExecution) {
      logger.error('No active execution for session', { sessionId });
      return;
    }

    try {
      const { actionHistory, requestId } = session.currentExecution;

      // Get next action from engine (passing action history for context)
      const result = await intentExecutionEngine.getNextActionStreaming(
        request,
        actionHistory
      );

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

      // Check if step is complete
      if (result.status === 'step_complete') {
        logger.info('Intent execution complete', {
          sessionId,
          stepId: request.stepData.id,
          totalActions: actionHistory.length,
          executionTimeMs: Date.now() - session.currentExecution.startTime
        });

        // Send completion message
        this.sendMessage(ws, {
          type: 'intent_complete',
          requestId,
          sessionId,
          stepId: request.stepData.id,
          result: {
            status: 'step_complete',
            intentType: request.intentType,
            stepId: request.stepData.id,
            actions: actionHistory,
            outputScreenshot: result.outputScreenshot,
            data: result.data,
            executionTimeMs: Date.now() - session.currentExecution.startTime
          }
        });

        // Clean up execution state
        session.currentExecution = undefined;
        return;
      }

      // Check if step failed
      if (result.status === 'step_failed') {
        logger.error('Intent execution failed', {
          sessionId,
          stepId: request.stepData.id,
          error: result.error
        });

        this.sendMessage(ws, {
          type: 'error',
          requestId,
          sessionId,
          error: result.error || 'Intent execution failed'
        });

        // Clean up execution state
        session.currentExecution = undefined;
        return;
      }

      // Send action to frontend for execution
      if (result.action) {
        logger.info('Sending action to frontend', {
          sessionId,
          actionType: result.action.type,
          actionNumber: actionHistory.length + 1
        });

        this.sendMessage(ws, {
          type: 'execute_action',
          requestId,
          sessionId,
          stepId: request.stepData.id,
          action: result.action
        });
      }

    } catch (error: any) {
      logger.error('Failed to execute next action', {
        sessionId,
        stepId: request.stepData?.id,
        error: error.message
      });

      this.sendMessage(ws, {
        type: 'error',
        requestId: session.currentExecution?.requestId,
        sessionId,
        error: error.message
      });

      // Clean up execution state
      session.currentExecution = undefined;
    }
  }

  /**
   * Handle action completion from frontend
   */
  private async handleActionComplete(
    ws: WebSocket,
    message: IntentWebSocketMessage,
    requestId?: string
  ) {
    const { sessionId, stepId, actionResult, screenshot } = message;

    if (!sessionId) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        error: 'Missing sessionId for action_complete'
      });
      return;
    }

    const session = this.sessions.get(sessionId);
    if (!session || !session.currentExecution) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        sessionId,
        error: 'No active execution for this session'
      });
      return;
    }

    if (session.currentExecution.stepId !== stepId) {
      this.sendMessage(ws, {
        type: 'error',
        requestId,
        sessionId,
        error: 'Step ID mismatch'
      });
      return;
    }

    logger.info('Action completed by frontend', {
      sessionId,
      stepId,
      actionType: actionResult?.actionType,
      success: actionResult?.success,
      actionNumber: session.currentExecution.actionHistory.length + 1
    });

    // Add action result to history
    if (actionResult) {
      session.currentExecution.actionHistory.push({
        ...actionResult,
        timestamp: Date.now()
      });
    }

    // Update request with new screenshot
    if (screenshot) {
      session.currentExecution.request.context.screenshot = screenshot;
    }

    // Execute next action
    await this.executeNextAction(ws, sessionId, session.currentExecution.request);
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

      // Send completion result back to client
      this.sendMessage(ws, {
        type: 'intent_complete',
        requestId,
        sessionId,
        stepId: request.stepData.id,
        result: result,
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

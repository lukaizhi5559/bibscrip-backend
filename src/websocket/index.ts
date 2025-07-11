/**
* WebSocket server for real-time streaming
 * Integrates with existing REST API architecture without disruption
 */

import WebSocket from 'ws';
import http from 'http';
import { URL } from 'url';
import { StreamingHandler } from './streamingHandler';
import { StreamingMessage } from '../types/streaming';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';

interface WebSocketSession {
  handler: StreamingHandler;
  lastHeartbeat: number;
  authenticated: boolean;
}

export class StreamingWebSocketServer {
  private wss: WebSocket.Server;
  private sessions: Map<WebSocket, WebSocketSession> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(server: http.Server) {
    this.wss = new WebSocket.Server({
      server,
      path: '/ws/stream',
      verifyClient: this.verifyClient.bind(this)
    });

    this.setupEventHandlers();
    this.startHeartbeat();
  }

  /**
   * Verify client connection
   */
  private verifyClient(info: { origin: string; secure: boolean; req: http.IncomingMessage }): boolean {
    try {
      const url = new URL(info.req.url || '', `http://${info.req.headers.host}`);
      const apiKey = url.searchParams.get('apiKey');
      
      // Basic validation - more thorough auth happens in connection handler
      return !!apiKey;
    } catch (error) {
      logger.error('WebSocket client verification failed:', error as any);
      return false;
    }
  }

  /**
   * Setup WebSocket event handlers
   */
  private setupEventHandlers(): void {
    this.wss.on('connection', this.handleConnection.bind(this));
    
    this.wss.on('error', (error) => {
      logger.error('WebSocket server error:', error);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      this.shutdown();
    });

    process.on('SIGINT', () => {
      this.shutdown();
    });
  }

  /**
   * Handle new WebSocket connection
   */
  private async handleConnection(ws: WebSocket, req: http.IncomingMessage): Promise<void> {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.info(`New WebSocket connection: ${connectionId}`);

    try {
      // Parse connection parameters
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const apiKey = url.searchParams.get('apiKey');
      const userId = url.searchParams.get('userId') ?? undefined;
      const clientId = url.searchParams.get('clientId') || connectionId;

      if (!apiKey) {
        ws.close(1008, 'API key required');
        return;
      }

      // Authenticate the connection
      const isAuthenticated = await this.authenticateConnection(apiKey, userId ?? undefined);
      if (!isAuthenticated) {
        ws.close(1008, 'Authentication failed');
        return;
      }

      // Create session handler
      const handler = new StreamingHandler(ws, connectionId, userId, clientId);
      const session: WebSocketSession = {
        handler,
        lastHeartbeat: Date.now(),
        authenticated: true
      };

      this.sessions.set(ws, session);

      // Setup message handling
      ws.on('message', async (data: WebSocket.Data) => {
        try {
          const rawMessage = data.toString();
          logger.info(`📨 WebSocket Message Received [${connectionId}]:`, {
            rawData: rawMessage,
            size: rawMessage.length,
            timestamp: new Date().toISOString()
          });
          
          const message: StreamingMessage = JSON.parse(rawMessage);
          logger.info(`🔍 Parsed WebSocket Message [${connectionId}]:`, {
            type: message.type,
            id: message.id,
            hasPayload: !!message.payload,
            payloadKeys: message.payload ? Object.keys(message.payload) : [],
            metadata: message.metadata
          });
          
          await session.handler.handleMessage(message);
          session.lastHeartbeat = Date.now();
        } catch (error) {
          logger.error('Error processing WebSocket message:', {
            error: error as any,
            rawData: data.toString(),
            connectionId
          });
          this.sendError(ws, 'Invalid message format');
        }
      });

      // Handle connection close
      ws.on('close', (code: number, reason: string) => {
        logger.info(`WebSocket connection closed: ${connectionId} (${code}: ${reason})`);
        this.cleanupSession(ws);
      });

      // Handle connection error
      ws.on('error', (error: Error) => {
        logger.error(`WebSocket connection error: ${connectionId}`, error as any);
        this.cleanupSession(ws);
      });

      // Send welcome message
      this.sendMessage(ws, {
        id: `welcome_${Date.now()}`,
        type: 'connection_status' as any,
        payload: {
          connected: true,
          sessionId: connectionId,
          userId,
          clientId,
          capabilities: {
            streaming: true,
            voice: true,
            interruption: true,
            providers: ['claude', 'openai', 'grok', 'gemini', 'mistral', 'deepseek', 'lambda']
          }
        },
        timestamp: Date.now(),
        metadata: {
          source: 'local_llm',
          sessionId: connectionId,
          userId,
          clientId
        }
      });

    } catch (error) {
      logger.error(`Error setting up WebSocket connection: ${connectionId}`, error as any);
      ws.close(1011, 'Internal server error during connection setup');
    }
  }

  /**
   * Authenticate WebSocket connection
   */
  private async authenticateConnection(apiKey: string, userId?: string): Promise<boolean> {
    try {
      // Create mock request object for authentication middleware
      const mockReq = {
        headers: {
          'x-api-key': apiKey
        }
      } as any;

      const mockRes = {} as any;

      // Use existing authentication middleware
      return new Promise((resolve) => {
        authenticate(mockReq, mockRes, (error?: any) => {
          resolve(!error);
        });
      });
    } catch (error) {
      logger.error('WebSocket authentication error:', error as any);
      return false;
    }
  }

  /**
   * Send message to WebSocket client
   */
  private sendMessage(ws: WebSocket, message: StreamingMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /**
   * Send error message to WebSocket client
   */
  private sendError(ws: WebSocket, message: string, code: string = 'WEBSOCKET_ERROR'): void {
    this.sendMessage(ws, {
      id: `error_${Date.now()}`,
      type: 'error' as any,
      payload: {
        code,
        message,
        recoverable: true
      },
      timestamp: Date.now(),
      metadata: {
        source: 'local_llm'
      }
    });
  }

  /**
   * Clean up session resources
   */
  private cleanupSession(ws: WebSocket): void {
    const session = this.sessions.get(ws);
    if (session) {
      session.handler.cleanup();
      this.sessions.delete(ws);
    }
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = 60000; // 60 seconds

      for (const [ws, session] of this.sessions) {
        if (now - session.lastHeartbeat > timeout) {
          logger.warn('WebSocket session timed out, closing connection');
          ws.close(1000, 'Session timeout');
          this.cleanupSession(ws);
        } else if (ws.readyState === WebSocket.OPEN) {
          // Send heartbeat
          this.sendMessage(ws, {
            id: `heartbeat_${Date.now()}`,
            type: 'heartbeat' as any,
            payload: {
              timestamp: now,
              activeConnections: this.sessions.size
            },
            timestamp: now,
            metadata: {
              source: 'local_llm'
            }
          });
        }
      }
    }, 30000); // Check every 30 seconds
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: StreamingMessage, excludeWs?: WebSocket): void {
    for (const [ws, session] of this.sessions) {
      if (ws !== excludeWs && ws.readyState === WebSocket.OPEN && session.authenticated) {
        this.sendMessage(ws, message);
      }
    }
  }

  /**
   * Get connection statistics
   */
  getStats(): {
    totalConnections: number;
    authenticatedConnections: number;
    activeStreams: number;
  } {
    let authenticatedCount = 0;
    let activeStreams = 0;

    for (const [ws, session] of this.sessions) {
      if (session.authenticated) {
        authenticatedCount++;
      }
      // You could add stream counting logic here
    }

    return {
      totalConnections: this.sessions.size,
      authenticatedConnections: authenticatedCount,
      activeStreams
    };
  }

  /**
   * Graceful shutdown
   */
  shutdown(): void {
    logger.info('Shutting down WebSocket server...');

    // Clear heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all connections
    for (const [ws, session] of this.sessions) {
      session.handler.cleanup();
      ws.close(1001, 'Server shutting down');
    }

    this.sessions.clear();

    // Close WebSocket server
    this.wss.close(() => {
      logger.info('WebSocket server closed');
    });
  }
}

// Export function to setup WebSocket server
export function setupStreamingWebSocket(server: http.Server): StreamingWebSocketServer {
  return new StreamingWebSocketServer(server);
}

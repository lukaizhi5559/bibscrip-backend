/**
 * Socket.IO Streaming Server
 * Replaces the problematic WebSocket (ws library) implementation
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';
import { logger } from '../utils/logger';
import { CommunicationAgentExtension } from '../services/communicationAgentExtension';
import { StreamingMessage } from '../types/streaming';
import { SocketIOAdapter } from './socketAdapter';

interface SocketSession {
  handler: CommunicationAgentExtension;
  lastHeartbeat: number;
  authenticated: boolean;
  connectionId: string;
  userId?: string;
  clientId: string;
  recentMessages: Map<string, number>; // message hash -> timestamp
}

export class SocketIOStreamingServer {
  private io: SocketIOServer;
  private sessions: Map<string, SocketSession> = new Map();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(server: HttpServer) {
    this.io = new SocketIOServer(server, {
      path: '/socket.io',
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      },
      transports: ['websocket', 'polling']
    });

    this.setupEventHandlers();
    this.startHeartbeat();
    
    logger.info('✅ [SOCKET.IO] Streaming server initialized on /socket.io');
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      this.shutdown();
    });

    process.on('SIGINT', () => {
      this.shutdown();
    });
  }

  private async handleConnection(socket: Socket): Promise<void> {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    logger.info(`✅ [SOCKET.IO] New connection: ${connectionId}`, {
      socketId: socket.id,
      transport: socket.conn.transport.name
    });

    try {
      // Parse connection parameters from handshake query
      const { apiKey, userId, clientId } = socket.handshake.query;
      const userIdStr = userId as string | undefined;
      const clientIdStr = (clientId as string) || connectionId;

      // In development, allow connections without API key from localhost
      const isDevelopment = process.env.NODE_ENV !== 'production';
      const isLocalhost = socket.handshake.headers.host?.includes('localhost') || 
                         socket.handshake.headers.host?.includes('127.0.0.1');
      
      let isAuthenticated = false;
      
      if (apiKey) {
        // TODO: Authenticate the connection if API key is provided
        isAuthenticated = true;
        logger.info(`🔐 [SOCKET.IO] API key provided for ${connectionId}`);
      } else if (isDevelopment && isLocalhost) {
        // Allow unauthenticated connections in development from localhost
        logger.info(`🔓 [SOCKET.IO] Allowing unauthenticated local development connection: ${connectionId}`);
        isAuthenticated = true;
      } else {
        socket.emit('error', { message: 'API key required' });
        socket.disconnect(true);
        return;
      }

      // Wrap Socket.IO socket with adapter to make it compatible with StreamingHandler
      const wsAdapter = new SocketIOAdapter(socket);
      
      // Create session handler with Communication Agent Extension
      const handler = new CommunicationAgentExtension(wsAdapter as any, connectionId, userIdStr, clientIdStr);
      const session: SocketSession = {
        handler,
        lastHeartbeat: Date.now(),
        authenticated: true,
        connectionId,
        userId: userIdStr,
        clientId: clientIdStr,
        recentMessages: new Map()
      };

      this.sessions.set(socket.id, session);

      // Setup message handling
      socket.on('message', async (data: any) => {
        try {
          logger.info(`📨 [SOCKET.IO] Raw message received [${connectionId}]:`, {
            dataType: typeof data,
            hasType: !!data?.type,
            hasPayload: !!data?.payload,
            hasMessage: !!data?.message,
            keys: Object.keys(data || {}),
            fullData: JSON.stringify(data).substring(0, 200)
          });
          
          const message: StreamingMessage = data;
          
          // Validate message structure
          if (!message.type) {
            logger.error(`❌ [SOCKET.IO] Invalid message - missing type [${connectionId}]`, {
              receivedData: data
            });
            socket.emit('error', { message: 'Invalid message format - missing type' });
            return;
          }
          
          // Create message hash for deduplication (based on type and payload content)
          const messageHash = `${message.type}_${JSON.stringify(message.payload)}`;
          const now = Date.now();
          const DEDUP_WINDOW_MS = 2000; // 2 second window
          
          // Check if this is a duplicate message within the deduplication window
          const lastSeen = session.recentMessages.get(messageHash);
          if (lastSeen && (now - lastSeen) < DEDUP_WINDOW_MS) {
            logger.warn(`🔄 [SOCKET.IO] Duplicate message ignored [${connectionId}]:`, {
              type: message.type,
              id: message.id,
              timeSinceLastSeen: now - lastSeen
            });
            return; // Ignore duplicate
          }
          
          // Update recent messages map
          session.recentMessages.set(messageHash, now);
          
          // Clean up old entries (older than dedup window)
          for (const [hash, timestamp] of session.recentMessages.entries()) {
            if (now - timestamp > DEDUP_WINDOW_MS) {
              session.recentMessages.delete(hash);
            }
          }
          
          logger.info(`📨 [SOCKET.IO] Processing message [${connectionId}]:`, {
            type: message.type,
            id: message.id,
            hasPayload: !!message.payload
          });
          
          await session.handler.handleMessageWithRouting(message);
          session.lastHeartbeat = Date.now();
        } catch (error) {
          logger.error(`❌ [SOCKET.IO] Error processing message [${connectionId}]:`, {
            error: error instanceof Error ? error.message : String(error)
          });
          socket.emit('error', { message: 'Invalid message format' });
        }
      });

      // Handle heartbeat responses from frontend
      socket.on('heartbeat_response', () => {
        session.lastHeartbeat = Date.now();
        logger.info(`💓 [SOCKET.IO] Heartbeat received from ${connectionId}`);
      });

      // Handle disconnection
      socket.on('disconnect', (reason: string) => {
        logger.info(`🔌 [SOCKET.IO] Connection closed: ${connectionId}`, { reason });
        this.cleanupSession(socket.id);
      });

      // Handle errors
      socket.on('error', (error: Error) => {
        logger.error(`❌ [SOCKET.IO] Connection error: ${connectionId}`, error);
        this.cleanupSession(socket.id);
      });

      // Send welcome message
      socket.emit('connection_status', {
        id: `welcome_${Date.now()}`,
        type: 'connection_status',
        payload: {
          connected: true,
          sessionId: connectionId,
          userId: userIdStr,
          clientId: clientIdStr,
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
          userId: userIdStr,
          clientId: clientIdStr
        }
      });

      logger.info(`📤 [SOCKET.IO] Welcome message sent to ${connectionId}`);

    } catch (error) {
      logger.error(`❌ [SOCKET.IO] Error setting up connection: ${connectionId}`, {
        error: error instanceof Error ? error.message : String(error)
      });
      socket.disconnect(true);
    }
  }

  private cleanupSession(socketId: string): void {
    const session = this.sessions.get(socketId);
    if (session) {
      session.handler.cleanup();
      this.sessions.delete(socketId);
    }
  }

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const timeout = 300000; // 5 minutes (increased from 60 seconds)

      for (const [socketId, session] of this.sessions) {
        if (now - session.lastHeartbeat > timeout) {
          logger.warn(`⏱️ [SOCKET.IO] Session timed out: ${session.connectionId}`);
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket) {
            socket.disconnect(true);
          }
          this.cleanupSession(socketId);
        } else {
          // Send heartbeat
          const socket = this.io.sockets.sockets.get(socketId);
          if (socket && socket.connected) {
            socket.emit('heartbeat', {
              id: `heartbeat_${Date.now()}`,
              type: 'heartbeat',
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
      }
    }, 30000); // Check every 30 seconds
  }

  shutdown(): void {
    logger.info('🛑 [SOCKET.IO] Shutting down server...');

    // Clear heartbeat interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Close all connections
    for (const [socketId, session] of this.sessions) {
      session.handler.cleanup();
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.disconnect(true);
      }
    }

    this.sessions.clear();
    this.io.close();
    
    logger.info('✅ [SOCKET.IO] Server closed');
  }

  getStats(): {
    totalConnections: number;
    authenticatedConnections: number;
  } {
    return {
      totalConnections: this.sessions.size,
      authenticatedConnections: Array.from(this.sessions.values()).filter(s => s.authenticated).length
    };
  }

  /**
   * Get Socket.IO server instance for external integrations
   */
  getIO(): SocketIOServer {
    return this.io;
  }
}

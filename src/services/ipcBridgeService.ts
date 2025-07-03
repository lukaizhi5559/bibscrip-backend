import { EventEmitter } from 'events';
import { WebSocket, WebSocketServer, RawData } from 'ws';
import { logger } from '../utils/logger';
import { ActionPlan, VisualContext } from './visualAgentService';
import { ExecutionResult } from './desktopAutomationService';

export interface IPCMessage {
  id: string;
  type: 'request' | 'response' | 'event';
  action: string;
  payload: any;
  timestamp: string;
  clientId?: string;
}

export interface IPCResponse {
  id: string;
  success: boolean;
  data?: any;
  error?: string;
  timestamp: string;
}

export interface ConnectedClient {
  id: string;
  ws: WebSocket;
  type: 'electron' | 'web' | 'mobile';
  connectedAt: string;
  lastActivity: string;
  metadata?: {
    userAgent?: string;
    version?: string;
    platform?: string;
  };
}

// Client info without WebSocket for API responses
export interface ClientInfo {
  id: string;
  type: 'electron' | 'web' | 'mobile';
  connectedAt: string;
  lastActivity: string;
  metadata?: {
    userAgent?: string;
    version?: string;
    platform?: string;
  };
}

/**
 * Electron IPC Bridge Service
 * Handles real-time communication between backend and Electron frontend
 * Supports WebSocket connections for bidirectional communication
 */
export class IPCBridgeService extends EventEmitter {
  private wss: WebSocketServer | null = null;
  private clients: Map<string, ConnectedClient> = new Map();
  private messageQueue: Map<string, IPCMessage[]> = new Map();
  private isRunning = false;
  private port: number;
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(port: number = 8081) {
    super();
    this.port = port;
  }

  /**
   * Start the IPC bridge WebSocket server
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      logger.warn('IPC Bridge Service already running');
      return;
    }

    try {
      this.wss = new WebSocketServer({ 
        port: this.port,
        perMessageDeflate: false // Disable compression for better performance
      });

      this.wss.on('connection', this.handleConnection.bind(this));
      this.wss.on('error', (error) => {
        logger.error('WebSocket server error:', { error });
      });

      // Start heartbeat to keep connections alive
      this.startHeartbeat();

      this.isRunning = true;
      logger.info(`IPC Bridge Service started on port ${this.port}`);
    } catch (error) {
      logger.error('Failed to start IPC Bridge Service:', { error });
      throw new Error('IPC Bridge Service startup failed');
    }
  }

  /**
   * Stop the IPC bridge service
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    try {
      // Stop heartbeat
      if (this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = null;
      }

      // Close all client connections
      for (const [clientId, client] of this.clients) {
        client.ws.close(1000, 'Server shutting down');
      }
      this.clients.clear();

      // Close WebSocket server
      if (this.wss) {
        this.wss.close();
        this.wss = null;
      }

      this.isRunning = false;
      logger.info('IPC Bridge Service stopped');
    } catch (error) {
      logger.error('Error stopping IPC Bridge Service:', { error });
    }
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket, request: any): void {
    const clientId = this.generateClientId();
    const userAgent = request.headers['user-agent'] || 'unknown';
    
    const client: ConnectedClient = {
      id: clientId,
      ws,
      type: this.detectClientType(userAgent),
      connectedAt: new Date().toISOString(),
      lastActivity: new Date().toISOString(),
      metadata: {
        userAgent,
        platform: request.headers['sec-websocket-protocol'] || 'unknown'
      }
    };

    this.clients.set(clientId, client);
    this.messageQueue.set(clientId, []);

    logger.info('New IPC client connected', {
      clientId,
      type: client.type,
      userAgent: client.metadata?.userAgent
    });

    // Set up message handlers
    ws.on('message', (data) => this.handleMessage(clientId, data));
    ws.on('close', (code, reason) => this.handleDisconnection(clientId, code, reason));
    ws.on('error', (error) => this.handleError(clientId, error));
    ws.on('pong', () => this.updateClientActivity(clientId));

    // Send welcome message
    this.sendToClient(clientId, {
      id: this.generateMessageId(),
      type: 'event',
      action: 'connected',
      payload: {
        clientId,
        serverTime: new Date().toISOString(),
        capabilities: [
          'visual-agent',
          'desktop-automation',
          'bibliography-sync',
          'real-time-updates'
        ]
      },
      timestamp: new Date().toISOString()
    });

    this.emit('clientConnected', client);
  }

  /**
   * Handle incoming message from client
   */
  private handleMessage(clientId: string, data: RawData): void {
    try {
      // Convert RawData to string safely
      let messageString: string;
      
      if (Buffer.isBuffer(data)) {
        messageString = data.toString('utf8');
      } else if (data instanceof ArrayBuffer) {
        messageString = Buffer.from(data).toString('utf8');
      } else if (Array.isArray(data)) {
        // Handle Buffer[] or ArrayBuffer[]
        const buffers = data.map(item => 
          Buffer.isBuffer(item) ? item : Buffer.from(item)
        );
        messageString = Buffer.concat(buffers).toString('utf8');
      } else {
        // Fallback for any other type
        messageString = String(data);
      }
      
      const message: IPCMessage = JSON.parse(messageString);
      message.clientId = clientId;
      
      this.updateClientActivity(clientId);
      
      logger.info('Received IPC message', {
        clientId,
        messageId: message.id,
        action: message.action,
        type: message.type
      });

      // Handle different message types
      switch (message.type) {
        case 'request':
          this.handleRequest(clientId, message);
          break;
        case 'response':
          this.handleResponse(clientId, message);
          break;
        case 'event':
          this.handleEvent(clientId, message);
          break;
        default:
          logger.warn('Unknown message type:', { type: message.type, clientId });
      }

      this.emit('messageReceived', message);
    } catch (error) {
      logger.error('Failed to parse IPC message:', { error, clientId });
      this.sendError(clientId, 'Invalid message format');
    }
  }

  /**
   * Handle client request
   */
  private async handleRequest(clientId: string, message: IPCMessage): Promise<void> {
    try {
      let responseData: any = null;

      switch (message.action) {
        case 'ping':
          responseData = { pong: true, serverTime: new Date().toISOString() };
          break;
        case 'getStatus':
          responseData = this.getServiceStatus();
          break;
        case 'getClients':
          responseData = this.getConnectedClients();
          break;
        default:
          // Emit request for other services to handle
          this.emit('request', message);
          return; // Don't send response here, let the handler do it
      }

      this.sendResponse(clientId, message.id, true, responseData);
    } catch (error) {
      logger.error('Error handling IPC request:', { error, action: message.action, clientId });
      this.sendResponse(clientId, message.id, false, null, error instanceof Error ? error.message : 'Request failed');
    }
  }

  /**
   * Handle client response
   */
  private handleResponse(clientId: string, message: IPCMessage): void {
    this.emit('response', message);
  }

  /**
   * Handle client event
   */
  private handleEvent(clientId: string, message: IPCMessage): void {
    this.emit('event', message);
  }

  /**
   * Handle client disconnection
   */
  private handleDisconnection(clientId: string, code: number, reason: Buffer): void {
    const client = this.clients.get(clientId);
    if (client) {
      logger.info('IPC client disconnected', {
        clientId,
        type: client.type,
        code,
        reason: reason.toString(),
        duration: Date.now() - new Date(client.connectedAt).getTime()
      });

      this.clients.delete(clientId);
      this.messageQueue.delete(clientId);
      this.emit('clientDisconnected', client);
    }
  }

  /**
   * Handle client error
   */
  private handleError(clientId: string, error: Error): void {
    logger.error('IPC client error:', { error, clientId });
    this.emit('clientError', { clientId, error });
  }

  /**
   * Send message to specific client
   */
  sendToClient(clientId: string, message: IPCMessage): boolean {
    const client = this.clients.get(clientId);
    if (!client || client.ws.readyState !== WebSocket.OPEN) {
      logger.warn('Cannot send message to client - not connected:', { clientId });
      return false;
    }

    try {
      client.ws.send(JSON.stringify(message));
      this.updateClientActivity(clientId);
      return true;
    } catch (error) {
      logger.error('Failed to send message to client:', { error, clientId });
      return false;
    }
  }

  /**
   * Send response to client
   */
  sendResponse(clientId: string, requestId: string, success: boolean, data?: any, error?: string): boolean {
    const response: IPCResponse = {
      id: requestId,
      success,
      data,
      error,
      timestamp: new Date().toISOString()
    };

    const message: IPCMessage = {
      id: this.generateMessageId(),
      type: 'response',
      action: 'response',
      payload: response,
      timestamp: new Date().toISOString()
    };

    return this.sendToClient(clientId, message);
  }

  /**
   * Send error to client
   */
  sendError(clientId: string, error: string): boolean {
    const message: IPCMessage = {
      id: this.generateMessageId(),
      type: 'event',
      action: 'error',
      payload: { error },
      timestamp: new Date().toISOString()
    };

    return this.sendToClient(clientId, message);
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message: IPCMessage, excludeClientId?: string): number {
    let sentCount = 0;
    
    for (const [clientId, client] of this.clients) {
      if (excludeClientId && clientId === excludeClientId) {
        continue;
      }
      
      if (this.sendToClient(clientId, message)) {
        sentCount++;
      }
    }

    return sentCount;
  }

  /**
   * Broadcast to specific client types
   */
  broadcastToType(message: IPCMessage, clientType: 'electron' | 'web' | 'mobile'): number {
    let sentCount = 0;
    
    for (const [clientId, client] of this.clients) {
      if (client.type === clientType) {
        if (this.sendToClient(clientId, message)) {
          sentCount++;
        }
      }
    }

    return sentCount;
  }

  /**
   * Get connected clients info
   */
  getConnectedClients(): ClientInfo[] {
    return Array.from(this.clients.values()).map(client => ({
      id: client.id,
      type: client.type,
      connectedAt: client.connectedAt,
      lastActivity: client.lastActivity,
      metadata: client.metadata
    }));
  }

  /**
   * Get service status
   */
  getServiceStatus(): any {
    return {
      running: this.isRunning,
      port: this.port,
      connectedClients: this.clients.size,
      uptime: this.isRunning ? Date.now() - (this.heartbeatInterval ? 0 : Date.now()) : 0,
      messageQueueSize: Array.from(this.messageQueue.values()).reduce((sum, queue) => sum + queue.length, 0)
    };
  }

  /**
   * Start heartbeat to keep connections alive
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      for (const [clientId, client] of this.clients) {
        if (client.ws.readyState === WebSocket.OPEN) {
          try {
            client.ws.ping();
          } catch (error) {
            logger.error('Failed to ping client:', { error, clientId });
            this.handleDisconnection(clientId, 1006, Buffer.from('Ping failed'));
          }
        }
      }
    }, 30000); // Ping every 30 seconds
  }

  /**
   * Update client activity timestamp
   */
  private updateClientActivity(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastActivity = new Date().toISOString();
    }
  }

  /**
   * Generate unique client ID
   */
  private generateClientId(): string {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Detect client type from user agent
   */
  private detectClientType(userAgent: string): 'electron' | 'web' | 'mobile' {
    if (userAgent.includes('Electron')) {
      return 'electron';
    } else if (userAgent.includes('Mobile') || userAgent.includes('Android') || userAgent.includes('iPhone')) {
      return 'mobile';
    } else {
      return 'web';
    }
  }

  /**
   * Check if service is running
   */
  isReady(): boolean {
    return this.isRunning && this.wss !== null;
  }
}

// Export singleton instance
export const ipcBridgeService = new IPCBridgeService();

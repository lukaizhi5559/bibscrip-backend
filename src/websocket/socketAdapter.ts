/**
 * WebSocket Adapter for Socket.IO
 * 
 * Adapts Socket.IO socket to behave like native WebSocket
 * so existing StreamingHandler code works without modification
 */

import { Socket } from 'socket.io';
import WebSocket from 'ws';
import { logger } from '../utils/logger';

export class SocketIOAdapter {
  private socket: Socket;
  public readyState: number;

  constructor(socket: Socket) {
    this.socket = socket;
    // Map Socket.IO connected state to WebSocket OPEN state
    this.readyState = socket.connected ? WebSocket.OPEN : WebSocket.CLOSED;

    // Update readyState when socket connects/disconnects
    socket.on('connect', () => {
      this.readyState = WebSocket.OPEN;
    });

    socket.on('disconnect', () => {
      this.readyState = WebSocket.CLOSED;
    });
  }

  /**
   * Send data - adapts ws.send() to socket.emit()
   */
  send(data: string): void {
    if (this.socket.connected) {
      try {
        const message = JSON.parse(data);
        
        logger.info('📡 [SOCKET_ADAPTER] Emitting message to frontend', {
          type: message.type,
          id: message.id,
          socketId: this.socket.id,
          connected: this.socket.connected
        });
        
        // Emit on the 'message' event channel
        this.socket.emit('message', message);
      } catch (error) {
        logger.warn('⚠️ [SOCKET_ADAPTER] Failed to parse message, sending as string', {
          error: error instanceof Error ? error.message : String(error)
        });
        // If parsing fails, send as raw string
        this.socket.emit('message', data);
      }
    } else {
      logger.error('❌ [SOCKET_ADAPTER] Cannot send - socket not connected', {
        socketId: this.socket.id,
        readyState: this.readyState
      });
    }
  }

  /**
   * Add event listener - adapts ws.on() to socket.on()
   */
  on(event: string, handler: (...args: any[]) => void): void {
    this.socket.on(event, handler);
  }

  /**
   * Remove event listener
   */
  off(event: string, handler: (...args: any[]) => void): void {
    this.socket.off(event, handler);
  }

  /**
   * Close connection
   */
  close(code?: number, reason?: string): void {
    this.socket.disconnect(true);
  }

  /**
   * Get the underlying Socket.IO socket
   */
  getSocket(): Socket {
    return this.socket;
  }
}

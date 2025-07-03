import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { ipcBridgeService, IPCMessage } from './ipcBridgeService';

export interface SyncData {
  id: string;
  type: 'bibliography' | 'context' | 'visual-agent' | 'user-preference';
  action: 'create' | 'update' | 'delete' | 'sync';
  data: any;
  timestamp: string;
  version: number;
  clientId?: string;
  checksum?: string;
}

export interface ConflictResolution {
  conflictId: string;
  resolution: 'server-wins' | 'client-wins' | 'merge' | 'manual';
  mergedData?: any;
  timestamp: string;
}

export interface SyncState {
  lastSyncTime: string;
  pendingChanges: SyncData[];
  conflictCount: number;
  syncInProgress: boolean;
}

/**
 * Real-time Sync Service
 * Handles data synchronization between backend and frontend clients
 * Supports conflict resolution and offline mode
 */
export class SyncService extends EventEmitter {
  private syncStates: Map<string, SyncState> = new Map();
  private pendingConflicts: Map<string, SyncData[]> = new Map();
  private syncQueue: Map<string, SyncData[]> = new Map();
  private isInitialized = false;
  private syncInterval: NodeJS.Timeout | null = null;

  constructor() {
    super();
    this.initialize();
  }

  /**
   * Initialize sync service
   */
  private async initialize(): Promise<void> {
    try {
      // Set up IPC bridge event handlers
      ipcBridgeService.on('clientConnected', this.handleClientConnected.bind(this));
      ipcBridgeService.on('clientDisconnected', this.handleClientDisconnected.bind(this));
      ipcBridgeService.on('messageReceived', this.handleIPCMessage.bind(this));

      // Start periodic sync
      this.startPeriodicSync();

      this.isInitialized = true;
      logger.info('Sync Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Sync Service:', { error });
      this.isInitialized = false;
    }
  }

  /**
   * Handle new client connection
   */
  private handleClientConnected(client: any): void {
    const clientId = client.id;
    
    // Initialize sync state for new client
    this.syncStates.set(clientId, {
      lastSyncTime: new Date().toISOString(),
      pendingChanges: [],
      conflictCount: 0,
      syncInProgress: false
    });

    this.syncQueue.set(clientId, []);

    logger.info('Client sync state initialized', { clientId });

    // Send initial sync data
    this.sendInitialSync(clientId);
  }

  /**
   * Handle client disconnection
   */
  private handleClientDisconnected(client: any): void {
    const clientId = client.id;
    
    // Clean up client sync data
    this.syncStates.delete(clientId);
    this.syncQueue.delete(clientId);
    this.pendingConflicts.delete(clientId);

    logger.info('Client sync state cleaned up', { clientId });
  }

  /**
   * Handle IPC message for sync operations
   */
  private handleIPCMessage(message: IPCMessage): void {
    if (!message.clientId) return;

    switch (message.action) {
      case 'sync-request':
        this.handleSyncRequest(message.clientId, message.payload);
        break;
      case 'sync-data':
        this.handleSyncData(message.clientId, message.payload);
        break;
      case 'resolve-conflict':
        this.handleConflictResolution(message.clientId, message.payload);
        break;
      case 'get-sync-state':
        this.sendSyncState(message.clientId);
        break;
    }
  }

  /**
   * Handle sync request from client
   */
  private async handleSyncRequest(clientId: string, payload: any): Promise<void> {
    try {
      const { lastSyncTime, types } = payload;
      
      logger.info('Processing sync request', { clientId, lastSyncTime, types });

      // Get changes since last sync
      const changes = await this.getChangesSince(lastSyncTime, types);
      
      // Send changes to client
      const syncMessage: IPCMessage = {
        id: this.generateMessageId(),
        type: 'event',
        action: 'sync-response',
        payload: {
          changes,
          serverTime: new Date().toISOString(),
          hasMore: false
        },
        timestamp: new Date().toISOString()
      };

      ipcBridgeService.sendToClient(clientId, syncMessage);
      
      // Update sync state
      const syncState = this.syncStates.get(clientId);
      if (syncState) {
        syncState.lastSyncTime = new Date().toISOString();
      }

    } catch (error) {
      logger.error('Failed to handle sync request:', { error, clientId });
      this.sendSyncError(clientId, 'Sync request failed');
    }
  }

  /**
   * Handle incoming sync data from client
   */
  private async handleSyncData(clientId: string, syncData: SyncData): Promise<void> {
    try {
      logger.info('Processing sync data from client', { 
        clientId, 
        type: syncData.type, 
        action: syncData.action,
        id: syncData.id 
      });

      // Check for conflicts
      const conflict = await this.detectConflict(syncData);
      
      if (conflict) {
        await this.handleConflict(clientId, syncData, conflict);
        return;
      }

      // Apply changes
      await this.applySyncData(syncData);
      
      // Broadcast changes to other clients
      await this.broadcastChange(syncData, clientId);
      
      // Send confirmation to client
      const confirmMessage: IPCMessage = {
        id: this.generateMessageId(),
        type: 'event',
        action: 'sync-confirmed',
        payload: {
          id: syncData.id,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };

      ipcBridgeService.sendToClient(clientId, confirmMessage);

    } catch (error) {
      logger.error('Failed to handle sync data:', { error, clientId, syncData });
      this.sendSyncError(clientId, 'Failed to process sync data');
    }
  }

  /**
   * Handle conflict resolution
   */
  private async handleConflictResolution(clientId: string, resolution: ConflictResolution): Promise<void> {
    try {
      logger.info('Processing conflict resolution', { 
        clientId, 
        conflictId: resolution.conflictId,
        resolution: resolution.resolution 
      });

      const conflicts = this.pendingConflicts.get(clientId) || [];
      const conflictIndex = conflicts.findIndex(c => c.id === resolution.conflictId);
      
      if (conflictIndex === -1) {
        throw new Error('Conflict not found');
      }

      const conflictData = conflicts[conflictIndex];
      
      // Apply resolution
      let resolvedData: SyncData;
      
      switch (resolution.resolution) {
        case 'server-wins':
          // Keep server version, discard client changes
          const serverVersion = await this.getServerVersion(conflictData.id, conflictData.type);
          if (!serverVersion) {
            throw new Error('Server version not found for conflict resolution');
          }
          resolvedData = serverVersion;
          break;
        case 'client-wins':
          // Apply client changes
          resolvedData = conflictData;
          break;
        case 'merge':
          // Use merged data from resolution
          resolvedData = {
            ...conflictData,
            data: resolution.mergedData,
            timestamp: new Date().toISOString()
          };
          break;
        default:
          throw new Error(`Unsupported resolution type: ${resolution.resolution}`);
      }

      // Apply resolved data
      await this.applySyncData(resolvedData);
      
      // Remove from conflicts
      conflicts.splice(conflictIndex, 1);
      this.pendingConflicts.set(clientId, conflicts);
      
      // Update sync state
      const syncState = this.syncStates.get(clientId);
      if (syncState) {
        syncState.conflictCount = conflicts.length;
      }

      // Broadcast resolution to other clients
      await this.broadcastChange(resolvedData, clientId);

      logger.info('Conflict resolved successfully', { 
        clientId, 
        conflictId: resolution.conflictId 
      });

    } catch (error) {
      logger.error('Failed to resolve conflict:', { error, clientId, resolution });
      this.sendSyncError(clientId, 'Failed to resolve conflict');
    }
  }

  /**
   * Send initial sync data to newly connected client
   */
  private async sendInitialSync(clientId: string): Promise<void> {
    try {
      // Get all current data for initial sync
      const initialData = await this.getInitialSyncData();
      
      const syncMessage: IPCMessage = {
        id: this.generateMessageId(),
        type: 'event',
        action: 'initial-sync',
        payload: {
          data: initialData,
          serverTime: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };

      ipcBridgeService.sendToClient(clientId, syncMessage);
      
      logger.info('Initial sync sent to client', { clientId, dataCount: initialData.length });
    } catch (error) {
      logger.error('Failed to send initial sync:', { error, clientId });
    }
  }

  /**
   * Send sync state to client
   */
  private sendSyncState(clientId: string): void {
    const syncState = this.syncStates.get(clientId);
    
    const stateMessage: IPCMessage = {
      id: this.generateMessageId(),
      type: 'event',
      action: 'sync-state',
      payload: syncState || {
        lastSyncTime: new Date().toISOString(),
        pendingChanges: [],
        conflictCount: 0,
        syncInProgress: false
      },
      timestamp: new Date().toISOString()
    };

    ipcBridgeService.sendToClient(clientId, stateMessage);
  }

  /**
   * Send sync error to client
   */
  private sendSyncError(clientId: string, error: string): void {
    const errorMessage: IPCMessage = {
      id: this.generateMessageId(),
      type: 'event',
      action: 'sync-error',
      payload: { error },
      timestamp: new Date().toISOString()
    };

    ipcBridgeService.sendToClient(clientId, errorMessage);
  }

  /**
   * Detect conflicts in sync data
   */
  private async detectConflict(syncData: SyncData): Promise<SyncData | null> {
    try {
      // Get current server version
      const serverData = await this.getServerVersion(syncData.id, syncData.type);
      
      if (!serverData) {
        return null; // No conflict if data doesn't exist on server
      }

      // Check if versions conflict
      if (serverData.version !== syncData.version - 1) {
        return serverData; // Conflict detected
      }

      return null; // No conflict
    } catch (error) {
      logger.error('Error detecting conflict:', { error, syncData });
      return null;
    }
  }

  /**
   * Handle conflict between client and server data
   */
  private async handleConflict(clientId: string, clientData: SyncData, serverData: SyncData): Promise<void> {
    // Add to pending conflicts
    const conflicts = this.pendingConflicts.get(clientId) || [];
    conflicts.push(clientData);
    this.pendingConflicts.set(clientId, conflicts);

    // Update sync state
    const syncState = this.syncStates.get(clientId);
    if (syncState) {
      syncState.conflictCount = conflicts.length;
    }

    // Send conflict notification to client
    const conflictMessage: IPCMessage = {
      id: this.generateMessageId(),
      type: 'event',
      action: 'sync-conflict',
      payload: {
        conflictId: clientData.id,
        clientData,
        serverData,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    };

    ipcBridgeService.sendToClient(clientId, conflictMessage);
    
    logger.info('Conflict detected and sent to client', { 
      clientId, 
      conflictId: clientData.id 
    });
  }

  /**
   * Apply sync data to server
   */
  private async applySyncData(syncData: SyncData): Promise<void> {
    // This would integrate with your actual data storage
    // For now, we'll emit an event for other services to handle
    this.emit('syncDataReceived', syncData);
    
    logger.info('Sync data applied', { 
      type: syncData.type, 
      action: syncData.action, 
      id: syncData.id 
    });
  }

  /**
   * Broadcast change to other clients
   */
  private async broadcastChange(syncData: SyncData, excludeClientId: string): Promise<void> {
    const broadcastMessage: IPCMessage = {
      id: this.generateMessageId(),
      type: 'event',
      action: 'data-changed',
      payload: syncData,
      timestamp: new Date().toISOString()
    };

    const sentCount = ipcBridgeService.broadcast(broadcastMessage, excludeClientId);
    
    logger.info('Change broadcasted to clients', { 
      sentCount, 
      type: syncData.type, 
      excludeClientId 
    });
  }

  /**
   * Get changes since specified time
   */
  private async getChangesSince(lastSyncTime: string, types?: string[]): Promise<SyncData[]> {
    // This would query your actual data storage
    // For now, return empty array
    return [];
  }

  /**
   * Get initial sync data for new clients
   */
  private async getInitialSyncData(): Promise<SyncData[]> {
    // This would get all current data for initial sync
    // For now, return empty array
    return [];
  }

  /**
   * Get server version of data
   */
  private async getServerVersion(id: string, type: string): Promise<SyncData | null> {
    // This would query your actual data storage
    // For now, return null
    return null;
  }

  /**
   * Start periodic sync check
   */
  private startPeriodicSync(): void {
    this.syncInterval = setInterval(() => {
      this.performPeriodicSync();
    }, 30000); // Every 30 seconds
  }

  /**
   * Perform periodic sync operations
   */
  private async performPeriodicSync(): Promise<void> {
    try {
      // Check for pending changes and conflicts
      for (const [clientId, syncState] of this.syncStates) {
        if (syncState.pendingChanges.length > 0) {
          logger.info('Processing pending changes for client', { 
            clientId, 
            pendingCount: syncState.pendingChanges.length 
          });
          
          // Process pending changes
          // This would be implemented based on your specific needs
        }
      }
    } catch (error) {
      logger.error('Error in periodic sync:', { error });
    }
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Check if service is ready
   */
  isReady(): boolean {
    return this.isInitialized && ipcBridgeService.isReady();
  }

  /**
   * Get sync statistics
   */
  getSyncStats(): any {
    return {
      connectedClients: this.syncStates.size,
      totalPendingChanges: Array.from(this.syncStates.values())
        .reduce((sum, state) => sum + state.pendingChanges.length, 0),
      totalConflicts: Array.from(this.pendingConflicts.values())
        .reduce((sum, conflicts) => sum + conflicts.length, 0),
      syncInProgress: Array.from(this.syncStates.values())
        .some(state => state.syncInProgress)
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
    }

    this.syncStates.clear();
    this.syncQueue.clear();
    this.pendingConflicts.clear();
    
    logger.info('Sync Service cleaned up');
  }
}

// Export singleton instance
export const syncService = new SyncService();

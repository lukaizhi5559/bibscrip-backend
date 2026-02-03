/**
 * OmniParser Warm-up Service
 * Keeps Replicate model warm by sending periodic requests
 * Prevents cold boots by ensuring model is called at least every 10 minutes
 */

import Replicate from 'replicate';
import { logger }  from '../utils/logger';
import type { Server as SocketIOServer } from 'socket.io';

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const WARMUP_INTERVAL_MS = 3 * 60 * 1000; // 3 minutes - more aggressive to prevent cold boots
const WARMUP_ENABLED = process.env.OMNIPARSER_WARMUP_ENABLED === 'true';
const HEARTBEAT_INTERVAL_MS = 10 * 1000; // 10 seconds - broadcast status to frontend

// Use Replicate's own playground screenshot - guaranteed to work with their API
// This is a real website screenshot with many detectable UI elements
const WARMUP_TEST_IMAGE = 'https://replicate.delivery/pbxt/MWb5PhmtW9qcXtvG1G9DQMo2TmBtsVK3DS1dETfEl78YNLZL/replicate-website.png';

let warmupInterval: NodeJS.Timeout | null = null;
let heartbeatInterval: NodeJS.Timeout | null = null;
let lastWarmupTime: number = 0;
let warmupCount: number = 0;

export class OmniParserWarmupService {
  private replicateClient: Replicate | null = null;
  private socketIO: SocketIOServer | null = null;

  constructor() {
    if (REPLICATE_API_TOKEN && WARMUP_ENABLED) {
      this.replicateClient = new Replicate({
        auth: REPLICATE_API_TOKEN,
      });
      logger.info('🔥 [WARMUP] OmniParser warmup service initialized', {
        intervalMinutes: WARMUP_INTERVAL_MS / 60000,
        heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_MS / 1000,
        enabled: true,
      });
    } else {
      logger.info('🔥 [WARMUP] OmniParser warmup service disabled', {
        enabled: false,
        reason: !REPLICATE_API_TOKEN ? 'no_api_token' : 'not_enabled',
      });
    }
  }

  /**
   * Set Socket.IO server for broadcasting warmup status
   */
  setSocketIO(io: SocketIOServer): void {
    this.socketIO = io;
    logger.info('🔥 [WARMUP] Socket.IO server connected for status broadcasting');
  }

  /**
   * Start the warmup service
   * Sends a lightweight request every 5 minutes to keep model warm
   */
  start(): void {
    if (!this.replicateClient || !WARMUP_ENABLED) {
      logger.warn('🔥 [WARMUP] Cannot start - service not initialized or disabled');
      return;
    }

    // Do initial warmup immediately
    this.warmup().catch((error) => {
      logger.error('🔥 [WARMUP] Initial warmup failed', { error: error.message });
    });

    // Schedule periodic warmups
    warmupInterval = setInterval(() => {
      this.warmup().catch((error) => {
        logger.error('🔥 [WARMUP] Scheduled warmup failed', { error: error.message });
      });
    }, WARMUP_INTERVAL_MS);

    // Schedule heartbeat broadcasts for frontend status indicator
    heartbeatInterval = setInterval(() => {
      this.broadcastStatus();
    }, HEARTBEAT_INTERVAL_MS);

    logger.info('🔥 [WARMUP] Warmup service started', {
      intervalMs: WARMUP_INTERVAL_MS,
      intervalMinutes: WARMUP_INTERVAL_MS / 60000,
      heartbeatIntervalMs: HEARTBEAT_INTERVAL_MS,
      heartbeatIntervalSeconds: HEARTBEAT_INTERVAL_MS / 1000,
    });
  }

  /**
   * Stop the warmup service
   */
  stop(): void {
    if (warmupInterval) {
      clearInterval(warmupInterval);
      warmupInterval = null;
    }
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      heartbeatInterval = null;
    }
    logger.info('🔥 [WARMUP] Warmup service stopped', {
      totalWarmups: warmupCount,
    });
  }

  /**
   * Broadcast warmup status to all connected Socket.IO clients
   * Frontend can use this to show green/red indicator
   */
  private broadcastStatus(): void {
    if (!this.socketIO) {
      return; // No Socket.IO server connected
    }

    const isWarm = this.isWarm();
    const stats = this.getStats();

    const status = {
      isWarm,
      enabled: WARMUP_ENABLED,
      lastWarmupTime,
      timeSinceLastWarmupSeconds: stats.timeSinceLastWarmup,
      warmupCount,
      nextWarmupInSeconds: isWarm ? 300 - (stats.timeSinceLastWarmup || 0) : 0,
    };

    // Broadcast to all connected clients
    this.socketIO.emit('omniparser_status', status);
  }

  /**
   * Perform a single warmup request
   * Uses Replicate's own playground screenshot with many detectable UI elements
   * Cost depends on image size but should be similar to regular OmniParser calls
   */
  private async warmup(): Promise<void> {
    if (!this.replicateClient) {
      return;
    }

    const startTime = Date.now();
    warmupCount++;

    try {
      logger.info('🔥 [WARMUP] Sending warmup request', {
        warmupNumber: warmupCount,
        timeSinceLastWarmup: lastWarmupTime ? (startTime - lastWarmupTime) / 1000 : 0,
      });

      const output = await this.replicateClient.run(
        'microsoft/omniparser-v2:49cf3d41b8d3aca1360514e83be4c97131ce8f0d99abfc365526d8384caa88df',
        {
          input: {
            image: WARMUP_TEST_IMAGE,
            box_threshold: 0.05,
            iou_threshold: 0.1,
          },
        }
      );

      const latency = Date.now() - startTime;
      lastWarmupTime = Date.now();

      logger.info('✅ [WARMUP] Warmup successful - FULL RESPONSE', {
        warmupNumber: warmupCount,
        latencyMs: latency,
        latencySeconds: (latency / 1000).toFixed(2),
        isColdBoot: latency > 60000, // >60s indicates cold boot
        fullResponse: JSON.stringify(output, null, 2),
      });

      // Alert if we got a cold boot (means warmup interval is too long)
      if (latency > 60000) {
        logger.warn('⚠️ [WARMUP] Cold boot detected during warmup', {
          latencySeconds: (latency / 1000).toFixed(2),
          recommendation: 'Consider reducing WARMUP_INTERVAL_MS',
        });
      }

      // Broadcast status immediately after warmup completes
      this.broadcastStatus();
    } catch (error: any) {
      logger.error('❌ [WARMUP] Warmup request failed - FULL ERROR', {
        warmupNumber: warmupCount,
        error: error.message,
        errorStack: error.stack,
        errorDetails: JSON.stringify(error, null, 2),
      });
    }
  }

  /**
   * Get warmup statistics
   */
  getStats() {
    return {
      enabled: WARMUP_ENABLED,
      warmupCount,
      lastWarmupTime,
      timeSinceLastWarmup: lastWarmupTime ? (Date.now() - lastWarmupTime) / 1000 : null,
      intervalMinutes: WARMUP_INTERVAL_MS / 60000,
    };
  }

  /**
   * Check if OmniParser is warm and ready for use
   * Returns true if warmup was recent (within 5 minutes)
   * Replicate models go cold after ~10 minutes of inactivity
   */
  isWarm(): boolean {
    if (!WARMUP_ENABLED || !this.replicateClient) {
      return false; // If warmup disabled, assume cold
    }

    if (!lastWarmupTime) {
      return false; // Never warmed up
    }

    const timeSinceWarmup = (Date.now() - lastWarmupTime) / 1000; // seconds
    const isWarm = timeSinceWarmup < 180; // 3 minutes (tighter window for reliability)

    return isWarm;
  }

  /**
   * Trigger an immediate warmup if needed
   * Returns promise that resolves when warmup completes
   */
  async ensureWarm(): Promise<{ wasWarm: boolean; latencyMs?: number }> {
    if (this.isWarm()) {
      return { wasWarm: true };
    }

    // Trigger warmup
    const startTime = Date.now();
    await this.warmup();
    const latencyMs = Date.now() - startTime;

    return { wasWarm: false, latencyMs };
  }
}

// Export singleton instance
export const omniParserWarmup = new OmniParserWarmupService();

/**
 * OmniParser Warm-up Service
 * Keeps Replicate model warm by sending periodic requests
 * Prevents cold boots by ensuring model is called at least every 10 minutes
 */

import Replicate from 'replicate';
import { logger }  from '../utils/logger';

const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const WARMUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes - Replicate goes cold in <10min
const WARMUP_ENABLED = process.env.OMNIPARSER_WARMUP_ENABLED === 'true';

// Use Replicate's own playground screenshot - guaranteed to work with their API
// This is a real website screenshot with many detectable UI elements
const WARMUP_TEST_IMAGE = 'https://replicate.delivery/pbxt/MWb5PhmtW9qcXtvG1G9DQMo2TmBtsVK3DS1dETfEl78YNLZL/replicate-website.png';

let warmupInterval: NodeJS.Timeout | null = null;
let lastWarmupTime: number = 0;
let warmupCount: number = 0;

export class OmniParserWarmupService {
  private replicateClient: Replicate | null = null;

  constructor() {
    if (REPLICATE_API_TOKEN && WARMUP_ENABLED) {
      this.replicateClient = new Replicate({
        auth: REPLICATE_API_TOKEN,
      });
      logger.info('🔥 [WARMUP] OmniParser warmup service initialized', {
        intervalMinutes: WARMUP_INTERVAL_MS / 60000,
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

    logger.info('🔥 [WARMUP] Warmup service started', {
      intervalMs: WARMUP_INTERVAL_MS,
      intervalMinutes: WARMUP_INTERVAL_MS / 60000,
    });
  }

  /**
   * Stop the warmup service
   */
  stop(): void {
    if (warmupInterval) {
      clearInterval(warmupInterval);
      warmupInterval = null;
      logger.info('🔥 [WARMUP] Warmup service stopped', {
        totalWarmups: warmupCount,
      });
    }
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
}

// Export singleton instance
export const omniParserWarmup = new OmniParserWarmupService();

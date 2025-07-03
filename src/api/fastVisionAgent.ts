// Fast Vision Agent API - Optimized for sub-5-second desktop automation
import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { fastVisionAutomation } from '../services/fastVisionAutomationService';
import { fastLLMRouter } from '../utils/fastLLMRouter';
import { logger } from '../utils/logger';

const router = Router();

// Request schemas for fast execution
const FastExecuteTaskSchema = z.object({
  taskDescription: z.string().min(1).max(500),
  maxIterations: z.number().min(1).max(3).default(2), // Optimized for speed
  timeout: z.number().min(1000).max(15000).default(8000) // 8 second default, allowing for real-world execution
});

const FastAnalyzeStateSchema = z.object({
  includeScreenshot: z.boolean().default(false),
  includeOCR: z.boolean().default(false)
});

/**
 * @swagger
 * /api/fast-vision-agent/execute-task:
 *   post:
 *     summary: Execute desktop automation task with maximum speed optimization
 *     description: Executes a natural language task using vision-first automation optimized for sub-5-second execution
 *     tags: [Fast Vision Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - taskDescription
 *             properties:
 *               taskDescription:
 *                 type: string
 *                 description: Natural language description of the task to execute
 *                 example: "Move the mouse cursor to the center of the screen"
 *               maxIterations:
 *                 type: number
 *                 minimum: 1
 *                 maximum: 5
 *                 default: 3
 *                 description: Maximum number of iterations (reduced for speed)
 *               timeout:
 *                 type: number
 *                 minimum: 1000
 *                 maximum: 10000
 *                 default: 5000
 *                 description: Maximum execution timeout in milliseconds
 *     responses:
 *       200:
 *         description: Task execution completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 iterations:
 *                   type: number
 *                 executionTime:
 *                   type: number
 *                   description: Total execution time in milliseconds
 *                 executionLog:
 *                   type: array
 *                   items:
 *                     type: string
 *                 performance:
 *                   type: object
 *                   properties:
 *                     avgIterationTime:
 *                       type: number
 *                     cacheHits:
 *                       type: number
 *                     llmLatency:
 *                       type: number
 *       400:
 *         description: Invalid request parameters
 *       401:
 *         description: Authentication required
 *       408:
 *         description: Request timeout
 *       500:
 *         description: Internal server error
 */
router.post('/execute-task', authenticate, async (req, res) => {
  const startTime = performance.now();
  
  try {
    const { taskDescription, maxIterations, timeout } = FastExecuteTaskSchema.parse(req.body);
    
    logger.info('Fast vision agent task execution started', {
      task: taskDescription,
      maxIterations,
      timeout,
      user: req.user?.id
    });

    // Set up timeout for the entire operation
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Task execution timeout')), timeout);
    });

    // Execute task with timeout
    const executionPromise = fastVisionAutomation.executeTaskFast(taskDescription, maxIterations);
    
    const result = await Promise.race([executionPromise, timeoutPromise]) as any;
    
    const totalTime = performance.now() - startTime;
    
    // Calculate performance metrics
    const avgIterationTime = result.executionTime / result.iterations;
    const performance_metrics = {
      totalTime,
      avgIterationTime,
      executionTime: result.executionTime,
      efficiency: result.success ? 'optimal' : 'needs-improvement'
    };

    logger.info('Fast vision agent task completed', {
      success: result.success,
      iterations: result.iterations,
      totalTime,
      avgIterationTime,
      task: taskDescription
    });

    res.json({
      success: result.success,
      iterations: result.iterations,
      executionTime: result.executionTime,
      executionLog: result.executionLog,
      performance: performance_metrics,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const totalTime = performance.now() - startTime;
    
    logger.error('Fast vision agent task failed', {
      error: error instanceof Error ? error.message : String(error),
      totalTime,
      task: req.body?.taskDescription
    });

    if (error instanceof Error && error.message === 'Task execution timeout') {
      res.status(408).json({
        success: false,
        error: 'Task execution timeout',
        executionTime: totalTime,
        message: 'Task execution exceeded the maximum allowed time'
      });
    } else {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        executionTime: totalTime
      });
    }
  }
});

/**
 * @swagger
 * /api/fast-vision-agent/health:
 *   get:
 *     summary: Fast health check for vision agent services
 *     description: Performs a rapid health check of all vision agent components
 *     tags: [Fast Vision Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Health check completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 healthy:
 *                   type: boolean
 *                 latency:
 *                   type: number
 *                   description: Health check latency in milliseconds
 *                 services:
 *                   type: object
 *                   properties:
 *                     screenshot:
 *                       type: boolean
 *                     ocr:
 *                       type: boolean
 *                     llm:
 *                       type: boolean
 *                     automation:
 *                       type: boolean
 *                 performance:
 *                   type: object
 *                   properties:
 *                     status:
 *                       type: string
 *                       enum: [optimal, good, degraded, critical]
 *                     recommendedMaxIterations:
 *                       type: number
 */
router.get('/health', authenticate, async (req, res) => {
  try {
    const healthResult = await fastVisionAutomation.healthCheck();
    const llmHealth = await fastLLMRouter.healthCheck();
    
    const overallHealthy = healthResult.healthy && llmHealth.healthy;
    const totalLatency = healthResult.latency + llmHealth.latency;
    
    // Determine performance status based on latency
    let performanceStatus = 'optimal';
    let recommendedMaxIterations = 5;
    
    if (totalLatency > 3000) {
      performanceStatus = 'critical';
      recommendedMaxIterations = 2;
    } else if (totalLatency > 2000) {
      performanceStatus = 'degraded';
      recommendedMaxIterations = 3;
    } else if (totalLatency > 1000) {
      performanceStatus = 'good';
      recommendedMaxIterations = 4;
    }

    logger.info('Fast vision agent health check', {
      healthy: overallHealthy,
      latency: totalLatency,
      performanceStatus
    });

    res.json({
      healthy: overallHealthy,
      latency: totalLatency,
      services: {
        ...healthResult.services,
        llm: llmHealth.healthy
      },
      performance: {
        status: performanceStatus,
        recommendedMaxIterations,
        latencyBreakdown: {
          vision: healthResult.latency,
          llm: llmHealth.latency
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Fast vision agent health check failed', { error });
    
    res.status(500).json({
      healthy: false,
      error: error instanceof Error ? error.message : 'Health check failed',
      services: {
        screenshot: false,
        ocr: false,
        llm: false,
        automation: false
      }
    });
  }
});

/**
 * @swagger
 * /api/fast-vision-agent/benchmark:
 *   post:
 *     summary: Performance benchmark for fast vision agent
 *     description: Runs a series of benchmark tests to measure performance
 *     tags: [Fast Vision Agent]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Benchmark completed
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 benchmarkResults:
 *                   type: object
 *                   properties:
 *                     screenshotLatency:
 *                       type: number
 *                     llmLatency:
 *                       type: number
 *                     totalLatency:
 *                       type: number
 *                     cachePerformance:
 *                       type: object
 *                 recommendations:
 *                   type: array
 *                   items:
 *                     type: string
 */
router.post('/benchmark', authenticate, async (req, res) => {
  const startTime = performance.now();
  
  try {
    logger.info('Starting fast vision agent benchmark');
    
    // Benchmark 1: Screenshot capture
    const screenshotStart = performance.now();
    const healthCheck = await fastVisionAutomation.healthCheck();
    const screenshotLatency = performance.now() - screenshotStart;
    
    // Benchmark 2: LLM response
    const llmStart = performance.now();
    const llmResponse = await fastLLMRouter.processTextPrompt('Benchmark test: respond with "OK"');
    const llmLatency = performance.now() - llmStart;
    
    // Benchmark 3: Cache performance
    const cacheStart = performance.now();
    const cachedResponse = await fastLLMRouter.processTextPrompt('Benchmark test: respond with "OK"');
    const cacheLatency = performance.now() - cacheStart;
    
    const totalLatency = performance.now() - startTime;
    
    // Generate recommendations
    const recommendations: string[] = [];
    
    if (screenshotLatency > 1000) {
      recommendations.push('Screenshot capture is slow - consider reducing image resolution');
    }
    
    if (llmLatency > 3000) {
      recommendations.push('LLM response is slow - consider using faster models or reducing token limits');
    }
    
    if (cacheLatency > llmLatency * 0.1) {
      recommendations.push('Cache performance is suboptimal - check Redis configuration');
    }
    
    if (totalLatency < 2000) {
      recommendations.push('Performance is optimal for real-time desktop automation');
    } else if (totalLatency < 5000) {
      recommendations.push('Performance is acceptable but could be improved');
    } else {
      recommendations.push('Performance needs significant optimization for real-time use');
    }

    const benchmarkResults = {
      screenshotLatency,
      llmLatency,
      cacheLatency,
      totalLatency,
      cachePerformance: {
        hitRatio: cacheLatency < llmLatency * 0.1 ? 'excellent' : 'needs-improvement',
        speedup: Math.round(llmLatency / cacheLatency * 100) / 100
      }
    };

    logger.info('Fast vision agent benchmark completed', benchmarkResults);

    res.json({
      benchmarkResults,
      recommendations,
      performanceGrade: totalLatency < 2000 ? 'A' : totalLatency < 5000 ? 'B' : 'C',
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    logger.error('Fast vision agent benchmark failed', { error });
    
    res.status(500).json({
      error: error instanceof Error ? error.message : 'Benchmark failed',
      benchmarkResults: null,
      recommendations: ['Benchmark failed - check service health']
    });
  }
});

export default router;

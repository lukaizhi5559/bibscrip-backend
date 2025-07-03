import { Router } from 'express';
import asyncHandler from 'express-async-handler';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { ipcBridgeService, IPCMessage } from '../services/ipcBridgeService';
import { syncService } from '../services/syncService';
import { visualAgentService } from '../services/visualAgentService';
import { desktopAutomationService } from '../services/desktopAutomationService';
import { llmPlanningService } from '../services/llmPlanningService';
import { logger } from '../utils/logger';

const router = Router();

// Validation schemas
const StartServicesSchema = z.object({
  services: z.array(z.enum(['ipc', 'sync', 'visual-agent'])).optional().default(['ipc', 'sync', 'visual-agent']),
  ipcPort: z.number().optional().default(8081)
});

const IPCMessageSchema = z.object({
  clientId: z.string(),
  type: z.enum(['request', 'response', 'event']),
  action: z.string(),
  payload: z.any(),
  id: z.string().optional()
});

const BroadcastSchema = z.object({
  type: z.enum(['request', 'response', 'event']),
  action: z.string(),
  payload: z.any(),
  excludeClientId: z.string().optional(),
  clientType: z.enum(['electron', 'web', 'mobile']).optional()
});

/**
 * @swagger
 * /api/integration/services/start:
 *   post:
 *     summary: Start integration services (IPC Bridge, Sync Service)
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               services:
 *                 type: array
 *                 items:
 *                   type: string
 *                   enum: [ipc, sync, visual-agent]
 *                 default: [ipc, sync, visual-agent]
 *               ipcPort:
 *                 type: number
 *                 default: 8081
 *     responses:
 *       200:
 *         description: Services started successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 services:
 *                   type: object
 *                   properties:
 *                     ipc:
 *                       type: object
 *                       properties:
 *                         running:
 *                           type: boolean
 *                         port:
 *                           type: number
 *                     sync:
 *                       type: object
 *                       properties:
 *                         running:
 *                           type: boolean
 *                     visualAgent:
 *                       type: object
 *                       properties:
 *                         ready:
 *                           type: boolean
 */
router.post('/services/start', authenticate, asyncHandler(async (req, res) => {
  try {
    const validatedData = StartServicesSchema.parse(req.body);
    const { services, ipcPort } = validatedData;
    
    const results: any = {};
    
    // Start IPC Bridge Service
    if (services.includes('ipc')) {
      if (!ipcBridgeService.isReady()) {
        await ipcBridgeService.start();
      }
      results.ipc = {
        running: ipcBridgeService.isReady(),
        port: ipcPort,
        status: ipcBridgeService.getServiceStatus()
      };
    }
    
    // Sync Service starts automatically when IPC is ready
    if (services.includes('sync')) {
      results.sync = {
        running: syncService.isReady(),
        stats: syncService.getSyncStats()
      };
    }
    
    // Visual Agent Service
    if (services.includes('visual-agent')) {
      results.visualAgent = {
        ready: visualAgentService.isReady(),
        desktopAutomation: desktopAutomationService.isReady(),
        llmPlanning: llmPlanningService.isReady()
      };
    }
    
    logger.info('Integration services started', { services, results });
    
    res.json({
      success: true,
      services: results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to start integration services:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to start services'
    });
  }
}));

/**
 * @swagger
 * /api/integration/services/stop:
 *   post:
 *     summary: Stop integration services
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Services stopped successfully
 */
router.post('/services/stop', authenticate, asyncHandler(async (req, res) => {
  try {
    await ipcBridgeService.stop();
    await syncService.cleanup();
    
    logger.info('Integration services stopped');
    
    res.json({
      success: true,
      message: 'Integration services stopped',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to stop integration services:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to stop services'
    });
  }
}));

/**
 * @swagger
 * /api/integration/services/status:
 *   get:
 *     summary: Get status of all integration services
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Service status retrieved successfully
 */
router.get('/services/status', authenticate, asyncHandler(async (req, res) => {
  try {
    const status = {
      ipc: {
        ready: ipcBridgeService.isReady(),
        ...ipcBridgeService.getServiceStatus()
      },
      sync: {
        ready: syncService.isReady(),
        ...syncService.getSyncStats()
      },
      visualAgent: {
        ready: visualAgentService.isReady(),
        desktopAutomation: desktopAutomationService.isReady(),
        llmPlanning: llmPlanningService.isReady()
      },
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      status
    });
  } catch (error) {
    logger.error('Failed to get service status:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get status'
    });
  }
}));

/**
 * @swagger
 * /api/integration/ipc/clients:
 *   get:
 *     summary: Get connected IPC clients
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     responses:
 *       200:
 *         description: Connected clients retrieved successfully
 */
router.get('/ipc/clients', authenticate, asyncHandler(async (req, res) => {
  try {
    const clients = ipcBridgeService.getConnectedClients();
    
    res.json({
      success: true,
      clients,
      count: clients.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to get IPC clients:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to get clients'
    });
  }
}));

/**
 * @swagger
 * /api/integration/ipc/send:
 *   post:
 *     summary: Send message to specific IPC client
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [clientId, type, action, payload]
 *             properties:
 *               clientId:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [request, response, event]
 *               action:
 *                 type: string
 *               payload:
 *                 type: object
 *               id:
 *                 type: string
 *     responses:
 *       200:
 *         description: Message sent successfully
 */
router.post('/ipc/send', authenticate, asyncHandler(async (req, res) => {
  try {
    const validatedData = IPCMessageSchema.parse(req.body);
    const { clientId, type, action, payload, id } = validatedData;
    
    const message: IPCMessage = {
      id: id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      action,
      payload,
      timestamp: new Date().toISOString()
    };
    
    const sent = ipcBridgeService.sendToClient(clientId, message);
    
    if (sent) {
      res.json({
        success: true,
        message: 'Message sent successfully',
        messageId: message.id,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to send message - client not connected'
      });
    }
  } catch (error) {
    logger.error('Failed to send IPC message:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to send message'
    });
  }
}));

/**
 * @swagger
 * /api/integration/ipc/broadcast:
 *   post:
 *     summary: Broadcast message to all or specific type of IPC clients
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [type, action, payload]
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [request, response, event]
 *               action:
 *                 type: string
 *               payload:
 *                 type: object
 *               excludeClientId:
 *                 type: string
 *               clientType:
 *                 type: string
 *                 enum: [electron, web, mobile]
 *     responses:
 *       200:
 *         description: Message broadcasted successfully
 */
router.post('/ipc/broadcast', authenticate, asyncHandler(async (req, res) => {
  try {
    const validatedData = BroadcastSchema.parse(req.body);
    const { type, action, payload, excludeClientId, clientType } = validatedData;
    
    const message: IPCMessage = {
      id: `broadcast_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      action,
      payload,
      timestamp: new Date().toISOString()
    };
    
    let sentCount: number;
    
    if (clientType) {
      sentCount = ipcBridgeService.broadcastToType(message, clientType);
    } else {
      sentCount = ipcBridgeService.broadcast(message, excludeClientId);
    }
    
    res.json({
      success: true,
      message: 'Message broadcasted successfully',
      sentCount,
      messageId: message.id,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    logger.error('Failed to broadcast IPC message:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to broadcast message'
    });
  }
}));

/**
 * @swagger
 * /api/integration/visual-agent/workflow:
 *   post:
 *     summary: Execute complete visual agent workflow with IPC integration
 *     tags: [Integration]
 *     security:
 *       - bearerAuth: []
 *       - apiKeyAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [prompt]
 *             properties:
 *               prompt:
 *                 type: string
 *               dryRun:
 *                 type: boolean
 *                 default: false
 *               broadcastUpdates:
 *                 type: boolean
 *                 default: true
 *               clientId:
 *                 type: string
 *                 description: Specific client to send updates to
 *     responses:
 *       200:
 *         description: Workflow executed successfully
 */
router.post('/visual-agent/workflow', authenticate, asyncHandler(async (req, res) => {
  try {
    const { prompt, dryRun = false, broadcastUpdates = true, clientId } = req.body;
    
    if (!prompt) {
      res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
      return;
    }
    
    // Send workflow started event
    if (broadcastUpdates) {
      const startMessage: IPCMessage = {
        id: `workflow_start_${Date.now()}`,
        type: 'event',
        action: 'visual-agent-workflow-started',
        payload: {
          prompt,
          dryRun,
          timestamp: new Date().toISOString()
        },
        timestamp: new Date().toISOString()
      };
      
      if (clientId) {
        ipcBridgeService.sendToClient(clientId, startMessage);
      } else {
        ipcBridgeService.broadcast(startMessage);
      }
    }
    
    // Step 1: Capture and analyze screen
    const analysisMessage: IPCMessage = {
      id: `workflow_analysis_${Date.now()}`,
      type: 'event',
      action: 'visual-agent-step',
      payload: {
        step: 'analysis',
        status: 'in-progress',
        message: 'Capturing and analyzing screen...'
      },
      timestamp: new Date().toISOString()
    };
    
    if (broadcastUpdates) {
      if (clientId) {
        ipcBridgeService.sendToClient(clientId, analysisMessage);
      } else {
        ipcBridgeService.broadcast(analysisMessage);
      }
    }
    
    const visualContext = await visualAgentService.createVisualContext(prompt);
    
    // Step 2: Generate action plan
    const planningMessage: IPCMessage = {
      id: `workflow_planning_${Date.now()}`,
      type: 'event',
      action: 'visual-agent-step',
      payload: {
        step: 'planning',
        status: 'in-progress',
        message: 'Generating action plan...'
      },
      timestamp: new Date().toISOString()
    };
    
    if (broadcastUpdates) {
      if (clientId) {
        ipcBridgeService.sendToClient(clientId, planningMessage);
      } else {
        ipcBridgeService.broadcast(planningMessage);
      }
    }
    
    const llmResponse = await llmPlanningService.generateActionPlan(visualContext);
    
    // Step 3: Execute action plan (if not dry run)
    let executionResult = null;
    
    if (!dryRun) {
      const executionMessage: IPCMessage = {
        id: `workflow_execution_${Date.now()}`,
        type: 'event',
        action: 'visual-agent-step',
        payload: {
          step: 'execution',
          status: 'in-progress',
          message: 'Executing action plan...'
        },
        timestamp: new Date().toISOString()
      };
      
      if (broadcastUpdates) {
        if (clientId) {
          ipcBridgeService.sendToClient(clientId, executionMessage);
        } else {
          ipcBridgeService.broadcast(executionMessage);
        }
      }
      
      executionResult = await desktopAutomationService.executeActionPlan(llmResponse.actionPlan.actions);
    }
    
    // Send workflow completed event
    const completedMessage: IPCMessage = {
      id: `workflow_completed_${Date.now()}`,
      type: 'event',
      action: 'visual-agent-workflow-completed',
      payload: {
        prompt,
        dryRun,
        visualContext,
        actionPlan: llmResponse.actionPlan,
        executionResult,
        tokensUsed: llmResponse.tokensUsed,
        processingTime: llmResponse.processingTime,
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    };
    
    if (broadcastUpdates) {
      if (clientId) {
        ipcBridgeService.sendToClient(clientId, completedMessage);
      } else {
        ipcBridgeService.broadcast(completedMessage);
      }
    }
    
    res.json({
      success: true,
      workflow: {
        prompt,
        dryRun,
        visualContext,
        actionPlan: llmResponse.actionPlan,
        executionResult,
        tokensUsed: llmResponse.tokensUsed,
        processingTime: llmResponse.processingTime
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Visual agent workflow failed:', { error });
    
    // Send error event
    const errorMessage: IPCMessage = {
      id: `workflow_error_${Date.now()}`,
      type: 'event',
      action: 'visual-agent-workflow-error',
      payload: {
        error: error instanceof Error ? error.message : 'Workflow failed',
        timestamp: new Date().toISOString()
      },
      timestamp: new Date().toISOString()
    };
    
    if (req.body.broadcastUpdates !== false) {
      if (req.body.clientId) {
        ipcBridgeService.sendToClient(req.body.clientId, errorMessage);
      } else {
        ipcBridgeService.broadcast(errorMessage);
      }
    }
    
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Workflow execution failed'
    });
  }
}));

export default router;

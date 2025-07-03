// UI-Indexed Intelligent Agent API Routes
// Main API endpoints for the new UI-indexed desktop automation system

import express from 'express';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';
import { uiIndexerDaemon, UIElement } from '../agent/uiIndexerDaemon';
import { ElementStore } from '../agent/elementStore';
import { RedisSync } from '../agent/redisSync';
import { LLMPlanner } from '../planner/generatePlan';
import { desktopAutomationService } from '../services/desktopAutomationService';

const router = express.Router();

// Initialize services
const elementStore = new ElementStore();
const redisSync = new RedisSync();
const llmPlanner = new LLMPlanner();
// Use the consolidated desktop automation service
// const actionExecutor = desktopAutomationService; // Will be used in route handlers

// Health check endpoint
router.get('/health', authenticate, async (req, res) => {
  try {
    const daemonStatus = uiIndexerDaemon.getStatus();
    const redisHealth = await redisSync.healthCheck();
    const executorTest = await desktopAutomationService.isReady() ? { success: true } : { success: false, error: 'Service not ready' };
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        uiIndexerDaemon: {
          running: daemonStatus.isRunning,
          platform: daemonStatus.platform,
          scanInterval: daemonStatus.scanInterval
        },
        redis: redisHealth,
        actionExecutor: executorTest,
        elementStore: { status: 'healthy' } // Assume healthy if no errors
      }
    };

    // Determine overall health
    const allHealthy = daemonStatus.isRunning && 
                      redisHealth.status === 'healthy' && 
                      executorTest.success;
    
    if (!allHealthy) {
      health.status = 'degraded';
    }

    res.json(health);
    
  } catch (error) {
    logger.error('Health check failed:', { error });
    res.status(500).json({
      status: 'unhealthy',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Start UI indexer daemon
router.post('/daemon/start', authenticate, async (req, res) => {
  try {
    await uiIndexerDaemon.start();
    
    res.json({
      success: true,
      message: 'UI Indexer Daemon started successfully',
      status: uiIndexerDaemon.getStatus()
    });
    
  } catch (error) {
    logger.error('Failed to start UI Indexer Daemon:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Stop UI indexer daemon
router.post('/daemon/stop', authenticate, async (req, res) => {
  try {
    await uiIndexerDaemon.stop();
    
    res.json({
      success: true,
      message: 'UI Indexer Daemon stopped successfully'
    });
    
  } catch (error) {
    logger.error('Failed to stop UI Indexer Daemon:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get current UI index
router.get('/ui-index', authenticate, async (req, res) => {
  try {
    const { appName, windowTitle } = req.query;
    
    // Try Redis cache first
    let elements = await redisSync.getElementsFromCache(
      appName as string || '', 
      windowTitle as string
    );
    
    // Fallback to PostgreSQL
    if (!elements) {
      elements = await elementStore.getElements(
        appName as string, 
        windowTitle as string
      );
    }
    
    const activeApps = await redisSync.getActiveApps();
    
    res.json({
      success: true,
      elements: elements || [],
      elementCount: elements?.length || 0,
      activeApplications: activeApps,
      source: elements ? 'cache' : 'database'
    });
    
  } catch (error) {
    logger.error('Failed to get UI index:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Search UI elements
router.get('/ui-index/search', authenticate, async (req, res): Promise<void> => {
  try {
    const { q: searchTerm, app: appName, role, label } = req.query;
    
    if (!searchTerm && !role && !label) {
      res.status(400).json({
        success: false,
        error: 'Search term, role, or label is required'
      });
      return;
    }
    
    let elements: UIElement[] = [];
    
    if (searchTerm) {
      // General search
      elements = await redisSync.searchElementsInCache(
        searchTerm as string, 
        appName as string
      );
      
      // Fallback to database search
      if (elements.length === 0) {
        elements = await elementStore.searchElements(
          searchTerm as string,
          appName as string
        );
      }
    } else if (role) {
      // Role-based search
      elements = await redisSync.getElementsByRoleFromCache(
        role as string,
        appName as string
      );
      
      // Fallback to database
      if (elements.length === 0) {
        elements = await elementStore.getElementsByRole(
          role as string,
          appName as string
        );
      }
    } else if (label) {
      // Label-based search
      elements = await elementStore.getElementsByLabel(
        label as string,
        appName as string
      );
    }
    
    res.json({
      success: true,
      elements,
      elementCount: elements.length,
      searchTerm: searchTerm || role || label
    });
    
  } catch (error) {
    logger.error('UI index search failed:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Execute task using UI-indexed approach
router.post('/execute-task', authenticate, async (req, res): Promise<void> => {
  try {
    const { 
      taskDescription, 
      maxActions = 10, 
      timeout = 30000,
      screenshotOnError = true,
      screenshotOnSuccess = false,
      validateAfterEachAction = false,
      retryFailedActions = true
    } = req.body;
    
    if (!taskDescription) {
      res.status(400).json({
        success: false,
        error: 'Task description is required'
      });
      return;
    }
    
    const startTime = Date.now();
    
    // Step 1: Get current UI elements and active app
    // Get the current active application directly from the daemon's scanner
    const currentApp = await uiIndexerDaemon.getCurrentActiveApplication();
    const activeApp = { 
      appName: currentApp.name, 
      windowTitle: currentApp.windowTitle 
    };
    
    let uiElements = await redisSync.getElementsFromCache(activeApp.appName, activeApp.windowTitle);
    if (!uiElements) {
      uiElements = await elementStore.getElements(activeApp.appName, activeApp.windowTitle);
    }
    
    // Check if we have scan marker records (indicating app was scanned but has no accessible elements)
    const hasScanMarker = uiElements && uiElements.some(element => element.elementRole === 'scan_marker');
    
    // Filter out scan markers for actual UI automation (we only want real UI elements)
    const realUIElements = uiElements ? uiElements.filter(element => element.elementRole !== 'scan_marker') : [];
    
    // If no real UI elements found and no recent scan marker, trigger a fresh scan
    if (realUIElements.length === 0 && !hasScanMarker) {
      logger.info(`No UI elements found for ${activeApp.appName}. Triggering fresh scan...`);
      
      try {
        // Force a scan of the current active application
        const scanResult = await uiIndexerDaemon.scanCurrentApplication();
        
        if (scanResult && scanResult.elements && scanResult.elements.length > 0) {
          logger.info(`Fresh scan found ${scanResult.elements.length} UI elements for ${activeApp.appName}`);
          // Use the fresh scan results
          const freshUIElements = scanResult.elements.filter(element => element.elementRole !== 'scan_marker');
          if (freshUIElements.length > 0) {
            uiElements = freshUIElements;
          }
        } else {
          logger.warn(`Fresh scan found no UI elements for ${activeApp.appName}`);
        }
      } catch (scanError) {
        logger.error('Failed to trigger fresh scan:', { error: scanError });
      }
    }
    
    // If still no real UI elements after fresh scan, return error
    if (realUIElements.length === 0 && (!uiElements || uiElements.filter(element => element.elementRole !== 'scan_marker').length === 0)) {
      res.status(400).json({
        success: false,
        error: `No UI elements found for ${activeApp.appName} (${activeApp.windowTitle}). The application may not have accessible UI elements or may require accessibility permissions.`,
        activeApp,
        freshScanAttempted: true
      });
      return;
    }
    
    // Use real UI elements for automation (filter out scan markers)
    const automationElements = uiElements ? uiElements.filter(element => element.elementRole !== 'scan_marker') : [];
    
    // Step 2: Generate action plan using LLM
    logger.info('Generating action plan with LLM planner');
    const planningContext = {
      taskDescription,
      uiElements: automationElements,
      activeApp: {
        name: activeApp.appName,
        windowTitle: activeApp.windowTitle
      },
      maxActions,
      allowFallback: true
    };
    
    const actionPlan = await llmPlanner.generatePlan(planningContext);
    
    if (actionPlan.fallbackRequired) {
      logger.warn('Action plan requires fallback - UI index may be insufficient');
    }
    
    // Step 3: Execute action plan
    logger.info('Executing action plan');
    const executionOptions = {
      timeout,
      screenshotOnError,
      screenshotOnSuccess,
      validateAfterEachAction,
      retryFailedActions,
      maxRetries: 2
    };
    
    // Map action types and add missing properties for consolidated service compatibility
    const mappedActions = actionPlan.actions.map(action => ({
      ...action,
      type: action.type === 'key' ? 'keyPress' : action.type as any // Map 'key' to 'keyPress'
    }));
    
    const actionPlanWithOutcome = {
      ...actionPlan,
      actions: mappedActions,
      expectedOutcome: `Execute ${actionPlan.actions.length} actions for ${actionPlan.targetApp}`
    };
    
    const executionResult = await desktopAutomationService.executeActionPlan(actionPlanWithOutcome.actions, executionOptions);
    
    const totalTime = Date.now() - startTime;
    
    // Step 4: Return comprehensive result
    const response = {
      success: executionResult.success,
      taskDescription,
      activeApp,
      uiElementCount: uiElements.length,
      actionPlan: {
        actions: actionPlan.actions,
        reasoning: actionPlan.reasoning,
        confidence: actionPlan.confidence,
        estimatedDuration: actionPlan.estimatedDuration,
        fallbackRequired: actionPlan.fallbackRequired
      },
      execution: {
        success: executionResult.success,
        completedActions: executionResult.executedActions,
        failedActions: executionResult.totalActions - executionResult.executedActions,
        totalExecutionTime: executionResult.duration,
        actionResults: [] // Note: consolidated service doesn't expose individual action results
      },
      performance: {
        totalLatency: totalTime,
        planningTime: totalTime - executionResult.duration,
        executionTime: executionResult.duration,
        grade: totalTime < 2000 ? 'A' : totalTime < 5000 ? 'B' : 'C'
      },
      finalScreenshot: executionResult.finalScreenshot
    };
    
    logger.info('Task execution completed', {
      success: response.success,
      totalTime,
      completedActions: executionResult.executedActions,
      failedActions: executionResult.totalActions - executionResult.executedActions
    });
    
    res.json(response);
    
  } catch (error) {
    logger.error('Task execution failed:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    });
  }
});

// Validate task feasibility
router.post('/validate-task', authenticate, async (req, res): Promise<void> => {
  try {
    const { taskDescription, appName } = req.body;
    
    if (!taskDescription) {
      res.status(400).json({
        success: false,
        error: 'Task description is required'
      });
      return;
    }
    
    // Get UI elements for the specified app or current active app
    let uiElements: any[] = [];
    if (appName) {
      const cachedElements = await redisSync.getElementsFromCache(appName, '');
      uiElements = cachedElements || [];
      if (uiElements.length === 0) {
        const storedElements = await elementStore.getElements(appName);
        uiElements = storedElements || [];
      }
    } else {
      const activeApps = await redisSync.getActiveApps();
      if (activeApps.length > 0) {
        const activeApp = activeApps[0];
        const cachedElements = await redisSync.getElementsFromCache(activeApp.appName, activeApp.windowTitle);
        uiElements = cachedElements || [];
        if (uiElements.length === 0) {
          const storedElements = await elementStore.getElements(activeApp.appName, activeApp.windowTitle);
          uiElements = storedElements || [];
        }
      }
    }
    
    // Validate feasibility using LLM
    const feasibility = await llmPlanner.validateTaskFeasibility(taskDescription, uiElements || []);
    
    res.json({
      success: true,
      taskDescription,
      feasibility,
      uiElementCount: uiElements?.length || 0,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    logger.error('Task validation failed:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Clear UI index cache
router.get('/ui-index/elements/:appName', authenticate, async (req, res) => {
  try {
    const { appName, windowTitle } = req.query;
    
    if (appName) {
      await redisSync.clearAppCache(appName as string, windowTitle as string);
    } else {
      await redisSync.clearAllCache();
    }
    
    res.json({
      success: true,
      message: 'UI index cache cleared successfully'
    });
    
  } catch (error) {
    logger.error('Failed to clear UI index cache:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Get active applications
router.get('/active-apps', authenticate, async (req, res) => {
  try {
    // Get current active application directly from the daemon's scanner
    const currentApp = await uiIndexerDaemon.getCurrentActiveApplication();
    const activeApps = currentApp.name !== 'Unknown' ? 
      [{ appName: currentApp.name, windowTitle: currentApp.windowTitle }] : [];
    
    res.json({
      success: true,
      activeApplications: activeApps,
      count: activeApps.length
    });
    
  } catch (error) {
    logger.error('Failed to get active applications:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

// Cleanup stale UI elements
router.get('/debug', authenticate, async (req, res) => {
  try {
    const deletedCount = await elementStore.cleanupStaleElements();
    
    res.json({
      success: true,
      message: `Cleaned up ${deletedCount} stale UI elements`,
      deletedCount
    });
    
  } catch (error) {
    logger.error('Cleanup failed:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;

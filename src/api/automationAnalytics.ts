// Automation Analytics API Routes
// Provides session management, performance analytics, and debugging support

import express from 'express';
import { authenticate } from '../middleware/auth';
import { logger } from '../utils/logger';
import { automationLogger } from '../services/automationLogger';

const router = express.Router();

/**
 * @swagger
 * /api/automation-analytics/sessions:
 *   get:
 *     summary: Get automation sessions with filtering and pagination
 *     tags: [Automation Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, running, completed, failed]
 *         description: Filter by session status
 *       - in: query
 *         name: appName
 *         schema:
 *           type: string
 *         description: Filter by application name
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *         description: Number of sessions to return
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *         description: Number of sessions to skip
 *     responses:
 *       200:
 *         description: List of automation sessions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 sessions:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/AutomationSession'
 *                 totalCount:
 *                   type: integer
 *                 hasMore:
 *                   type: boolean
 */
router.get('/sessions', authenticate, async (req, res) => {
  try {
    const { 
      status, 
      appName, 
      limit = 50, 
      offset = 0 
    } = req.query;

    // Build query dynamically based on filters
    let query = `
      SELECT * FROM automation_sessions 
      WHERE 1=1
    `;
    const values: any[] = [];
    let paramIndex = 1;

    if (status) {
      query += ` AND status = $${paramIndex++}`;
      values.push(status);
    }

    if (appName) {
      query += ` AND app_name ILIKE $${paramIndex++}`;
      values.push(`%${appName}%`);
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    values.push(parseInt(limit as string), parseInt(offset as string));

    // Get sessions
    const pool = require('../config/postgres').default;
    const result = await pool.query(query, values);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total FROM automation_sessions 
      WHERE 1=1
    `;
    const countValues: any[] = [];
    let countParamIndex = 1;

    if (status) {
      countQuery += ` AND status = $${countParamIndex++}`;
      countValues.push(status);
    }

    if (appName) {
      countQuery += ` AND app_name ILIKE $${countParamIndex++}`;
      countValues.push(`%${appName}%`);
    }

    const countResult = await pool.query(countQuery, countValues);
    const totalCount = parseInt(countResult.rows[0].total);

    const sessions = result.rows.map((row: any) => ({
      id: row.id,
      sessionId: row.session_id,
      taskDescription: row.task_description,
      appName: row.app_name,
      windowTitle: row.window_title,
      status: row.status,
      actionsPlanned: row.actions_planned,
      actionsCompleted: row.actions_completed,
      success: row.success,
      errorMessage: row.error_message,
      executionTimeMs: row.execution_time_ms,
      createdAt: row.created_at,
      completedAt: row.completed_at
    }));

    res.json({
      success: true,
      sessions,
      totalCount,
      hasMore: (parseInt(offset as string) + parseInt(limit as string)) < totalCount,
      pagination: {
        limit: parseInt(limit as string),
        offset: parseInt(offset as string),
        totalCount
      }
    });

  } catch (error) {
    logger.error('Failed to get automation sessions:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/automation-analytics/sessions/{sessionId}:
 *   get:
 *     summary: Get detailed session information with actions
 *     tags: [Automation Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *         description: Session ID
 *     responses:
 *       200:
 *         description: Detailed session information
 *       404:
 *         description: Session not found
 */
router.get('/sessions/:sessionId', authenticate, async (req, res) => {
  try {
    const { sessionId } = req.params;

    const session = await automationLogger.getSession(sessionId);
    if (!session) {
      res.status(404).json({
        success: false,
        error: 'Session not found'
      });
      return;
    }

    const actions = await automationLogger.getSessionActions(sessionId);

    res.json({
      success: true,
      session,
      actions,
      actionCount: actions.length
    });

  } catch (error) {
    logger.error('Failed to get session details:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/automation-analytics/metrics:
 *   get:
 *     summary: Get automation performance metrics and analytics
 *     tags: [Automation Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 7
 *         description: Number of days to analyze
 *     responses:
 *       200:
 *         description: Performance metrics and analytics
 */
router.get('/metrics', authenticate, async (req, res) => {
  try {
    const { days = 7 } = req.query;
    
    const metrics = await automationLogger.getMetrics(parseInt(days as string));

    res.json({
      success: true,
      metrics,
      period: {
        days: parseInt(days as string),
        from: new Date(Date.now() - (parseInt(days as string) * 24 * 60 * 60 * 1000)).toISOString(),
        to: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error('Failed to get automation metrics:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/automation-analytics/health:
 *   get:
 *     summary: Get automation system health and recent activity
 *     tags: [Automation Analytics]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: System health information
 */
router.get('/health', authenticate, async (req, res) => {
  try {
    // Get recent metrics (last 24 hours)
    const recentMetrics = await automationLogger.getMetrics(1);
    
    // Determine system health based on recent activity
    const isHealthy = recentMetrics.totalSessions === 0 || recentMetrics.successRate >= 0.8;
    const status = isHealthy ? 'healthy' : 'degraded';

    res.json({
      success: true,
      status,
      timestamp: new Date().toISOString(),
      recentActivity: {
        last24Hours: recentMetrics,
        healthScore: recentMetrics.successRate,
        isHealthy
      },
      recommendations: isHealthy ? [] : [
        'Review failed sessions for common error patterns',
        'Check UI element indexing accuracy',
        'Verify application accessibility permissions'
      ]
    });

  } catch (error) {
    logger.error('Failed to get automation health:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/automation-analytics/cleanup:
 *   post:
 *     summary: Clean up old automation data
 *     tags: [Automation Analytics]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               daysToKeep:
 *                 type: integer
 *                 default: 30
 *                 description: Number of days of data to keep
 *     responses:
 *       200:
 *         description: Cleanup completed successfully
 */
router.post('/cleanup', authenticate, async (req, res) => {
  try {
    const { daysToKeep = 30 } = req.body;

    const result = await automationLogger.cleanup(daysToKeep);

    res.json({
      success: true,
      message: 'Automation data cleanup completed',
      result,
      daysToKeep
    });

  } catch (error) {
    logger.error('Failed to cleanup automation data:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * @swagger
 * /api/automation-analytics/export:
 *   get:
 *     summary: Export automation data for analysis
 *     tags: [Automation Analytics]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: format
 *         schema:
 *           type: string
 *           enum: [json, csv]
 *           default: json
 *         description: Export format
 *       - in: query
 *         name: days
 *         schema:
 *           type: integer
 *           default: 7
 *         description: Number of days to export
 *     responses:
 *       200:
 *         description: Exported automation data
 */
router.get('/export', authenticate, async (req, res) => {
  try {
    const { format = 'json', days = 7 } = req.query;
    
    const metrics = await automationLogger.getMetrics(parseInt(days as string));
    
    if (format === 'csv') {
      // Convert to CSV format
      const csvHeaders = 'Session ID,Task Description,App Name,Status,Success,Execution Time (ms),Created At\n';
      const csvRows = metrics.recentSessions.map(session => 
        `"${session.sessionId}","${session.taskDescription}","${session.appName}","${session.status}",${session.success},${session.executionTimeMs},"${session.createdAt}"`
      ).join('\n');
      
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="automation-data-${days}days.csv"`);
      res.send(csvHeaders + csvRows);
    } else {
      // JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="automation-data-${days}days.json"`);
      res.json({
        exportInfo: {
          format,
          days: parseInt(days as string),
          exportedAt: new Date().toISOString()
        },
        metrics
      });
    }

  } catch (error) {
    logger.error('Failed to export automation data:', { error });
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

export default router;

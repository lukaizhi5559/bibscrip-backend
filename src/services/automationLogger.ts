// Automation Logger Service - Session and Action Logging for UI-Indexed Agent
// Provides complete audit trail, performance analytics, and debugging support

import pool from '../config/postgres';
import { logger } from '../utils/logger';
import { v4 as uuidv4 } from 'uuid';

export interface AutomationSession {
  id?: number;
  sessionId: string;
  taskDescription: string;
  appName?: string;
  windowTitle?: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  actionsPlanned: number;
  actionsCompleted: number;
  success: boolean;
  errorMessage?: string;
  executionTimeMs?: number;
  createdAt?: Date;
  completedAt?: Date;
}

export interface ActionLog {
  id?: number;
  sessionId: string;
  actionType: string;
  actionData?: any;
  coordinates?: { x: number; y: number };
  success: boolean;
  errorMessage?: string;
  executionTimeMs?: number;
  screenshotPath?: string;
  createdAt?: Date;
}

export interface SessionMetrics {
  totalSessions: number;
  successRate: number;
  averageExecutionTime: number;
  mostCommonActions: Array<{ actionType: string; count: number }>;
  recentSessions: AutomationSession[];
}

export class AutomationLogger {
  private static instance: AutomationLogger;

  public static getInstance(): AutomationLogger {
    if (!AutomationLogger.instance) {
      AutomationLogger.instance = new AutomationLogger();
    }
    return AutomationLogger.instance;
  }

  /**
   * Create a new automation session
   */
  async createSession(
    taskDescription: string,
    appName?: string,
    windowTitle?: string,
    actionsPlanned: number = 0
  ): Promise<string> {
    const sessionId = uuidv4();
    
    try {
      const query = `
        INSERT INTO automation_sessions (
          session_id, task_description, app_name, window_title, 
          status, actions_planned, actions_completed, success
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING session_id
      `;
      
      const values = [
        sessionId,
        taskDescription,
        appName,
        windowTitle,
        'pending',
        actionsPlanned,
        0,
        false
      ];
      
      const result = await pool.query(query, values);
      
      logger.info('Automation session created', {
        sessionId,
        taskDescription,
        appName,
        windowTitle,
        actionsPlanned
      });
      
      return result.rows[0].session_id;
    } catch (error) {
      logger.error('Failed to create automation session', { error, sessionId, taskDescription });
      throw error;
    }
  }

  /**
   * Update session status and progress
   */
  async updateSession(
    sessionId: string,
    updates: Partial<Pick<AutomationSession, 'status' | 'actionsCompleted' | 'success' | 'errorMessage' | 'executionTimeMs'>>
  ): Promise<void> {
    try {
      const setParts: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.status !== undefined) {
        setParts.push(`status = $${paramIndex++}`);
        values.push(updates.status);
      }
      
      if (updates.actionsCompleted !== undefined) {
        setParts.push(`actions_completed = $${paramIndex++}`);
        values.push(updates.actionsCompleted);
      }
      
      if (updates.success !== undefined) {
        setParts.push(`success = $${paramIndex++}`);
        values.push(updates.success);
      }
      
      if (updates.errorMessage !== undefined) {
        setParts.push(`error_message = $${paramIndex++}`);
        values.push(updates.errorMessage);
      }
      
      if (updates.executionTimeMs !== undefined) {
        setParts.push(`execution_time_ms = $${paramIndex++}`);
        values.push(updates.executionTimeMs);
      }

      if (setParts.length === 0) {
        return; // No updates to make
      }

      values.push(sessionId);
      
      const query = `
        UPDATE automation_sessions 
        SET ${setParts.join(', ')}
        WHERE session_id = $${paramIndex}
      `;
      
      await pool.query(query, values);
      
      logger.debug('Automation session updated', { sessionId, updates });
    } catch (error) {
      logger.error('Failed to update automation session', { error, sessionId, updates });
      throw error;
    }
  }

  /**
   * Log an individual action
   */
  async logAction(
    sessionId: string,
    actionType: string,
    success: boolean,
    executionTimeMs: number,
    actionData?: any,
    coordinates?: { x: number; y: number },
    errorMessage?: string,
    screenshotPath?: string
  ): Promise<void> {
    try {
      const query = `
        INSERT INTO action_logs (
          session_id, action_type, action_data, coordinates, 
          success, error_message, execution_time_ms, screenshot_path
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `;
      
      const values = [
        sessionId,
        actionType,
        actionData ? JSON.stringify(actionData) : null,
        coordinates ? JSON.stringify(coordinates) : null,
        success,
        errorMessage,
        executionTimeMs,
        screenshotPath
      ];
      
      await pool.query(query, values);
      
      logger.debug('Action logged', {
        sessionId,
        actionType,
        success,
        executionTimeMs,
        coordinates
      });
    } catch (error) {
      logger.error('Failed to log action', { 
        error, 
        sessionId, 
        actionType, 
        success 
      });
      // Don't throw - logging failures shouldn't break automation
    }
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<AutomationSession | null> {
    try {
      const query = `
        SELECT * FROM automation_sessions 
        WHERE session_id = $1
      `;
      
      const result = await pool.query(query, [sessionId]);
      
      if (result.rows.length === 0) {
        return null;
      }
      
      const row = result.rows[0];
      return {
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
      };
    } catch (error) {
      logger.error('Failed to get session', { error, sessionId });
      return null;
    }
  }

  /**
   * Get actions for a session
   */
  async getSessionActions(sessionId: string): Promise<ActionLog[]> {
    try {
      const query = `
        SELECT * FROM action_logs 
        WHERE session_id = $1 
        ORDER BY created_at ASC
      `;
      
      const result = await pool.query(query, [sessionId]);
      
      return result.rows.map(row => ({
        id: row.id,
        sessionId: row.session_id,
        actionType: row.action_type,
        actionData: row.action_data ? JSON.parse(row.action_data) : null,
        coordinates: row.coordinates ? JSON.parse(row.coordinates) : null,
        success: row.success,
        errorMessage: row.error_message,
        executionTimeMs: row.execution_time_ms,
        screenshotPath: row.screenshot_path,
        createdAt: row.created_at
      }));
    } catch (error) {
      logger.error('Failed to get session actions', { error, sessionId });
      return [];
    }
  }

  /**
   * Get performance metrics and analytics
   */
  async getMetrics(days: number = 7): Promise<SessionMetrics> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - days);
      
      // Get session metrics
      const sessionQuery = `
        SELECT 
          COUNT(*) as total_sessions,
          AVG(CASE WHEN success THEN 1.0 ELSE 0.0 END) as success_rate,
          AVG(execution_time_ms) as avg_execution_time
        FROM automation_sessions 
        WHERE created_at >= $1
      `;
      
      const sessionResult = await pool.query(sessionQuery, [cutoffDate]);
      const sessionMetrics = sessionResult.rows[0];
      
      // Get most common actions
      const actionQuery = `
        SELECT 
          action_type,
          COUNT(*) as count
        FROM action_logs al
        JOIN automation_sessions s ON al.session_id = s.session_id
        WHERE s.created_at >= $1
        GROUP BY action_type
        ORDER BY count DESC
        LIMIT 10
      `;
      
      const actionResult = await pool.query(actionQuery, [cutoffDate]);
      
      // Get recent sessions
      const recentQuery = `
        SELECT * FROM automation_sessions 
        WHERE created_at >= $1
        ORDER BY created_at DESC
        LIMIT 10
      `;
      
      const recentResult = await pool.query(recentQuery, [cutoffDate]);
      
      return {
        totalSessions: parseInt(sessionMetrics.total_sessions) || 0,
        successRate: parseFloat(sessionMetrics.success_rate) || 0,
        averageExecutionTime: parseFloat(sessionMetrics.avg_execution_time) || 0,
        mostCommonActions: actionResult.rows.map(row => ({
          actionType: row.action_type,
          count: parseInt(row.count)
        })),
        recentSessions: recentResult.rows.map(row => ({
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
        }))
      };
    } catch (error) {
      logger.error('Failed to get automation metrics', { error });
      return {
        totalSessions: 0,
        successRate: 0,
        averageExecutionTime: 0,
        mostCommonActions: [],
        recentSessions: []
      };
    }
  }

  /**
   * Clean up old sessions and actions (called by cleanup job)
   */
  async cleanup(daysToKeep: number = 30): Promise<{ sessionsDeleted: number; actionsDeleted: number }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
      
      // Delete old action logs first (foreign key constraint)
      const actionQuery = `
        DELETE FROM action_logs 
        WHERE session_id IN (
          SELECT session_id FROM automation_sessions 
          WHERE created_at < $1
        )
      `;
      
      const actionResult = await pool.query(actionQuery, [cutoffDate]);
      
      // Delete old sessions
      const sessionQuery = `
        DELETE FROM automation_sessions 
        WHERE created_at < $1
      `;
      
      const sessionResult = await pool.query(sessionQuery, [cutoffDate]);
      
      const result = {
        sessionsDeleted: sessionResult.rowCount || 0,
        actionsDeleted: actionResult.rowCount || 0
      };
      
      logger.info('Automation data cleanup completed', result);
      
      return result;
    } catch (error) {
      logger.error('Failed to cleanup automation data', { error });
      throw error;
    }
  }
}

export const automationLogger = AutomationLogger.getInstance();

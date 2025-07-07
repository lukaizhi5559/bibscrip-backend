/**
 * OrchestrationPersistenceService
 * Phase 1: Foundation & Persistence Layer
 * Handles all database operations for Thinkdrop AI Drops Orchestration System
 */

import { Pool, PoolClient } from 'pg';
import {
  OrchestrationWorkflow,
  WorkflowExecutionLog,
  WorkflowTemplate,
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  WorkflowListResponse,
  WorkflowError,
  WorkflowValidationError
} from '../types/orchestrationWorkflow';

export class OrchestrationPersistenceService {
  private pool: Pool;

  constructor(pool: Pool) {
    this.pool = pool;
  }

  // ==================== WORKFLOW CRUD OPERATIONS ====================

  /**
   * Create a new orchestration workflow
   */
  async createWorkflow(userId: string, request: CreateWorkflowRequest): Promise<OrchestrationWorkflow> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');

      const query = `
        INSERT INTO orchestration_workflows (
          user_id, name, description, task_breakdown, agents, data_flow,
          dependencies, risks, estimated_success_rate, execution_time_estimate
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;

      const values = [
        userId,
        request.name,
        request.description || null,
        JSON.stringify(request.task_breakdown),
        JSON.stringify(request.agents),
        request.data_flow || null,
        JSON.stringify(request.dependencies || []),
        JSON.stringify(request.risks || []),
        request.estimated_success_rate || null,
        request.execution_time_estimate || null
      ];

      const result = await client.query(query, values);
      await client.query('COMMIT');

      return this.mapRowToWorkflow(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new WorkflowError(
        `Failed to create workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'CREATE_ERROR'
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get workflow by ID
   */
  async getWorkflowById(workflowId: string, userId: string): Promise<OrchestrationWorkflow | null> {
    const query = `
      SELECT * FROM orchestration_workflows 
      WHERE id = $1 AND user_id = $2
    `;

    try {
      const result = await this.pool.query(query, [workflowId, userId]);
      return result.rows.length > 0 ? this.mapRowToWorkflow(result.rows[0]) : null;
    } catch (error) {
      throw new WorkflowError(
        `Failed to get workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'GET_ERROR',
        workflowId
      );
    }
  }

  /**
   * List workflows for a user with pagination
   */
  async listWorkflows(
    userId: string,
    page: number = 1,
    limit: number = 20,
    status?: string
  ): Promise<WorkflowListResponse> {
    const offset = (page - 1) * limit;
    
    let whereClause = 'WHERE user_id = $1';
    const queryParams: any[] = [userId];
    
    if (status) {
      whereClause += ' AND status = $2';
      queryParams.push(status);
    }

    const countQuery = `SELECT COUNT(*) FROM orchestration_workflows ${whereClause}`;
    const dataQuery = `
      SELECT * FROM orchestration_workflows 
      ${whereClause}
      ORDER BY created_at DESC 
      LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
    `;

    try {
      const [countResult, dataResult] = await Promise.all([
        this.pool.query(countQuery, queryParams),
        this.pool.query(dataQuery, [...queryParams, limit, offset])
      ]);

      const total = parseInt(countResult.rows[0].count);
      const workflows = dataResult.rows.map(row => this.mapRowToWorkflow(row));

      return {
        workflows,
        total,
        page,
        limit
      };
    } catch (error) {
      throw new WorkflowError(
        `Failed to list workflows: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LIST_ERROR'
      );
    }
  }

  /**
   * Update workflow
   */
  async updateWorkflow(
    workflowId: string,
    userId: string,
    updates: UpdateWorkflowRequest
  ): Promise<OrchestrationWorkflow> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      // Build dynamic update query
      const updateFields: string[] = [];
      const values: any[] = [];
      let paramIndex = 1;

      if (updates.name !== undefined) {
        updateFields.push(`name = $${paramIndex++}`);
        values.push(updates.name);
      }
      if (updates.description !== undefined) {
        updateFields.push(`description = $${paramIndex++}`);
        values.push(updates.description);
      }
      if (updates.status !== undefined) {
        updateFields.push(`status = $${paramIndex++}`);
        values.push(updates.status);
      }
      if (updates.task_breakdown !== undefined) {
        updateFields.push(`task_breakdown = $${paramIndex++}`);
        values.push(JSON.stringify(updates.task_breakdown));
      }
      if (updates.agents !== undefined) {
        updateFields.push(`agents = $${paramIndex++}`);
        values.push(JSON.stringify(updates.agents));
      }
      if (updates.data_flow !== undefined) {
        updateFields.push(`data_flow = $${paramIndex++}`);
        values.push(updates.data_flow);
      }
      if (updates.custom_task_breakdown !== undefined) {
        updateFields.push(`custom_task_breakdown = $${paramIndex++}`);
        values.push(JSON.stringify(updates.custom_task_breakdown));
      }
      if (updates.external_agents !== undefined) {
        updateFields.push(`external_agents = $${paramIndex++}`);
        values.push(JSON.stringify(updates.external_agents));
      }
      if (updates.execution_context !== undefined) {
        updateFields.push(`execution_context = $${paramIndex++}`);
        values.push(JSON.stringify(updates.execution_context));
      }
      if (updates.results !== undefined) {
        updateFields.push(`results = $${paramIndex++}`);
        values.push(JSON.stringify(updates.results));
      }

      if (updateFields.length === 0) {
        throw new WorkflowValidationError('No valid fields to update', workflowId);
      }

      // Always update the updated_at timestamp
      updateFields.push(`updated_at = NOW()`);

      const query = `
        UPDATE orchestration_workflows 
        SET ${updateFields.join(', ')}
        WHERE id = $${paramIndex++} AND user_id = $${paramIndex++}
        RETURNING *
      `;

      values.push(workflowId, userId);

      const result = await client.query(query, values);
      
      if (result.rows.length === 0) {
        throw new WorkflowError('Workflow not found or access denied', 'NOT_FOUND', workflowId);
      }

      await client.query('COMMIT');
      return this.mapRowToWorkflow(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof WorkflowError) {
        throw error;
      }
      throw new WorkflowError(
        `Failed to update workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'UPDATE_ERROR',
        workflowId
      );
    } finally {
      client.release();
    }
  }

  /**
   * Delete workflow
   */
  async deleteWorkflow(workflowId: string, userId: string): Promise<boolean> {
    const client = await this.pool.connect();

    try {
      await client.query('BEGIN');

      const query = `
        DELETE FROM orchestration_workflows 
        WHERE id = $1 AND user_id = $2
      `;

      const result = await client.query(query, [workflowId, userId]);
      await client.query('COMMIT');

      return (result.rowCount ?? 0) > 0;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new WorkflowError(
        `Failed to delete workflow: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'DELETE_ERROR',
        workflowId
      );
    } finally {
      client.release();
    }
  }

  // ==================== EXECUTION LOGS ====================

  /**
   * Create execution log entry
   */
  async createExecutionLog(log: Omit<WorkflowExecutionLog, 'id' | 'created_at'>): Promise<WorkflowExecutionLog> {
    const client = await this.pool.connect();
    
    try {
      await client.query('BEGIN');
      
      const query = `
        INSERT INTO orchestration_execution_logs (
          workflow_id, step_number, agent_name, status, 
          input_data, output_data, error_message, execution_time_ms
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `;

      const values = [
        log.workflow_id,
        log.step_number,
        log.agent_name,
        log.status,
        JSON.stringify(log.input_data),
        JSON.stringify(log.output_data),
        log.error_message || null,
        log.execution_time_ms || null
      ];

      console.log(`[DEBUG] Creating execution log for workflow_id: ${log.workflow_id}`);
      console.log(`[DEBUG] Log data:`, { 
        workflow_id: log.workflow_id, 
        step_number: log.step_number, 
        agent_name: log.agent_name, 
        status: log.status 
      });
      
      const result = await client.query(query, values);
      await client.query('COMMIT');
      
      console.log(`[DEBUG] Log created and committed successfully, returned row:`, result.rows[0]);
      
      return this.mapRowToExecutionLog(result.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error(`[DEBUG] Error creating execution log, rolled back:`, error);
      throw new WorkflowError(
        `Failed to create execution log: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LOG_ERROR',
        log.workflow_id,
        log.step_number
      );
    } finally {
      client.release();
    }
  }

  /**
   * Get execution logs for workflow
   */
  async getExecutionLogs(workflowId: string): Promise<WorkflowExecutionLog[]> {
    const query = `
      SELECT * FROM orchestration_execution_logs 
      WHERE workflow_id = $1 
      ORDER BY step_number ASC, started_at ASC
    `;

    try {
      console.log(`[DEBUG] Getting execution logs for workflow_id: ${workflowId}`);
      const result = await this.pool.query(query, [workflowId]);
      console.log(`[DEBUG] Query result: ${result.rows.length} rows found`);
      if (result.rows.length > 0) {
        console.log(`[DEBUG] First row:`, result.rows[0]);
      }
      
      // Also check if there are any logs in the table at all
      const countQuery = 'SELECT COUNT(*) as total FROM orchestration_execution_logs';
      const countResult = await this.pool.query(countQuery);
      console.log(`[DEBUG] Total logs in table: ${countResult.rows[0].total}`);
      
      return result.rows.map(row => this.mapRowToExecutionLog(row));
    } catch (error) {
      console.error(`[DEBUG] Error in getExecutionLogs:`, error);
      throw new WorkflowError(
        `Failed to get execution logs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'LOG_ERROR',
        workflowId
      );
    }
  }

  // ==================== WORKFLOW TEMPLATES ====================

  /**
   * Create workflow template
   */
  async createTemplate(template: Omit<WorkflowTemplate, 'id' | 'created_at' | 'updated_at'>): Promise<WorkflowTemplate> {
    const query = `
      INSERT INTO orchestration_workflow_templates (
        name, description, category, template_data, is_public, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const values = [
      template.name,
      template.description || null,
      template.category || null,
      JSON.stringify(template.template_data),
      template.is_public,
      template.created_by || null
    ];

    try {
      const result = await this.pool.query(query, values);
      return this.mapRowToTemplate(result.rows[0]);
    } catch (error) {
      throw new WorkflowError(
        `Failed to create template: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TEMPLATE_ERROR'
      );
    }
  }

  /**
   * List workflow templates
   */
  async listTemplates(category?: string, publicOnly: boolean = true): Promise<WorkflowTemplate[]> {
    let query = 'SELECT * FROM orchestration_workflow_templates';
    const conditions: string[] = [];
    const values: any[] = [];

    if (publicOnly) {
      conditions.push('is_public = true');
    }

    if (category) {
      conditions.push(`category = $${values.length + 1}`);
      values.push(category);
    }

    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }

    query += ' ORDER BY usage_count DESC, created_at DESC';

    try {
      const result = await this.pool.query(query, values);
      return result.rows.map(row => this.mapRowToTemplate(row));
    } catch (error) {
      throw new WorkflowError(
        `Failed to list templates: ${error instanceof Error ? error.message : 'Unknown error'}`,
        'TEMPLATE_ERROR'
      );
    }
  }

  // ==================== HELPER METHODS ====================

  private mapRowToWorkflow(row: any): OrchestrationWorkflow {
    return {
      id: row.id,
      user_id: row.user_id,
      name: row.name,
      description: row.description,
      status: row.status,
      task_breakdown: row.task_breakdown || [],
      agents: row.agents || [],
      data_flow: row.data_flow,
      custom_task_breakdown: row.custom_task_breakdown || [],
      external_agents: row.external_agents || [],
      current_step: row.current_step,
      execution_context: row.execution_context || {},
      results: row.results || {},
      estimated_success_rate: row.estimated_success_rate,
      execution_time_estimate: row.execution_time_estimate,
      dependencies: row.dependencies || [],
      risks: row.risks || [],
      fallback_strategies: row.fallback_strategies || [],
      created_at: row.created_at,
      updated_at: row.updated_at,
      last_executed_at: row.last_executed_at
    };
  }

  private mapRowToExecutionLog(row: any): WorkflowExecutionLog {
    return {
      id: row.id,
      workflow_id: row.workflow_id,
      step_number: row.step_number,
      agent_name: row.agent_name,
      status: row.status,
      input_data: row.input_data || {},
      output_data: row.output_data || {},
      error_message: row.error_message,
      execution_time_ms: row.execution_time_ms,
      created_at: row.started_at // Use started_at from database schema
    };
  }

  private mapRowToTemplate(row: any): WorkflowTemplate {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      category: row.category,
      template_data: row.template_data || {},
      usage_count: row.usage_count,
      is_public: row.is_public,
      created_by: row.created_by,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}

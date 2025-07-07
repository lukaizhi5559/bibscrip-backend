/**
 * Orchestration Workflows API Routes
 * Phase 1: Foundation & Persistence Layer
 * REST API endpoints for Thinkdrop AI Drops Orchestration System
 */

import { Router, Request, Response } from 'express';
import { Pool } from 'pg';
import { OrchestrationPersistenceService } from '../services/orchestrationPersistenceService';
import { WorkflowValidationService } from '../services/workflowValidationService';
import {
  CreateWorkflowRequest,
  UpdateWorkflowRequest,
  WorkflowError,
  WorkflowValidationError
} from '../types/orchestrationWorkflow';

export function createOrchestrationWorkflowRoutes(pool: Pool): Router {
  const router = Router();
  const persistenceService = new OrchestrationPersistenceService(pool);
  const validationService = new WorkflowValidationService();

  // Middleware to extract user ID from request
  const extractUserId = (req: Request, res: Response, next: Function) => {
    // TODO: Replace with actual auth middleware
    const userId = req.headers['x-user-id'] as string || req.body.user_id;
    if (!userId) {
      res.status(401).json({ 
        error: 'Unauthorized',
        code: 'MISSING_USER_ID'
      });
      return;
    }
    req.userId = userId;
    next();
  };

  // ==================== WORKFLOW CRUD OPERATIONS ====================

  /**
   * POST /api/orchestration/workflows
   * Create a new orchestration workflow
   */
  router.post('/workflows', extractUserId, async (req: Request, res: Response) => {
    try {
      const createRequest: CreateWorkflowRequest = req.body;

      // Validate request
      const validation = validationService.validateCreateRequest(createRequest);
      if (!validation.isValid) {
        res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: validation.errors,
          warnings: validation.warnings
        });
        return;
      }

      // Create workflow
      const workflow = await persistenceService.createWorkflow(req.userId, createRequest);

      res.status(201).json({
        success: true,
        data: workflow
      });
    } catch (error) {
      console.error('Error creating workflow:', error);
      
      if (error instanceof WorkflowValidationError) {
        res.status(400).json({
          error: error.message,
          code: 'WORKFLOW_VALIDATION_ERROR'
        });
        return;
      }

      if (error instanceof WorkflowError) {
        res.status(500).json({
          error: error.message,
          code: 'INTERNAL_ERROR'
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  /**
   * GET /api/orchestration/workflows
   * List all workflows for the authenticated user
   */
  router.get('/workflows', extractUserId, async (req: Request, res: Response) => {
    try {
      const { status, limit = 50, offset = 0 } = req.query;
      
      const page = Math.floor(parseInt(offset as string) / parseInt(limit as string)) + 1;
      const workflows = await persistenceService.listWorkflows(
        req.userId,
        page,
        parseInt(limit as string),
        status as string
      );

      res.json({
        success: true,
        data: workflows,
        pagination: {
          limit: parseInt(limit as string),
          offset: parseInt(offset as string)
        }
      });
    } catch (error) {
      console.error('Error listing workflows:', error);
      
      if (error instanceof WorkflowError) {
        res.status(500).json({
          error: error.message,
          code: error.code
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  /**
   * GET /api/orchestration/workflows/:id
   * Get a specific workflow by ID
   */
  router.get('/workflows/:id', extractUserId, async (req: Request, res: Response) => {
    try {
      const workflowId = req.params.id;
      const workflow = await persistenceService.getWorkflowById(workflowId, req.userId);

      if (!workflow) {
        res.status(404).json({
          error: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND'
        });
        return;
      }

      res.json({
        success: true,
        data: workflow
      });
    } catch (error) {
      console.error('Error getting workflow:', error);
      
      if (error instanceof WorkflowError) {
        res.status(500).json({
          error: error.message,
          code: 'INTERNAL_ERROR'
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  /**
   * PUT /api/orchestration/workflows/:id
   * Update an existing workflow
   */
  router.put('/workflows/:id', extractUserId, async (req: Request, res: Response) => {
    try {
      const workflowId = req.params.id;
      const updateRequest: UpdateWorkflowRequest = req.body;

      // Validate request
      const validation = validationService.validateUpdateRequest(updateRequest);
      if (!validation.isValid) {
        res.status(400).json({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: validation.errors,
          warnings: validation.warnings
        });
        return;
      }

      // Update workflow
      const workflow = await persistenceService.updateWorkflow(workflowId, req.userId, updateRequest);

      res.json({
        success: true,
        data: workflow
      });
    } catch (error) {
      console.error('Error updating workflow:', error);
      
      if (error instanceof WorkflowValidationError) {
        res.status(400).json({
          error: error.message,
          code: 'WORKFLOW_VALIDATION_ERROR'
        });
        return;
      }

      if (error instanceof WorkflowError) {
        const statusCode = error.code === 'NOT_FOUND' ? 404 : 500;
        res.status(statusCode).json({
          error: error.message,
          code: error.code,
          workflow_id: error.workflow_id
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  /**
   * DELETE /api/orchestration/workflows/:id
   * Delete a workflow
   */
  router.delete('/workflows/:id', extractUserId, async (req: Request, res: Response) => {
    try {
      const workflowId = req.params.id;
      const deleted = await persistenceService.deleteWorkflow(workflowId, req.userId);

      if (!deleted) {
        res.status(404).json({
          error: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND'
        });
        return;
      }

      res.json({
        success: true,
        message: 'Workflow deleted successfully'
      });
    } catch (error) {
      console.error('Error deleting workflow:', error);
      
      if (error instanceof WorkflowError) {
        res.status(500).json({
          error: error.message,
          code: error.code,
          workflow_id: error.workflow_id
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  // ==================== EXECUTION LOGS ====================

  /**
   * GET /api/orchestration/workflows/:id/logs
   * Get execution logs for a workflow
   */
  router.get('/workflows/:id/logs', extractUserId, async (req: Request, res: Response) => {
    try {
      const workflowId = req.params.id;

      // Verify workflow exists and user has access
      const workflow = await persistenceService.getWorkflowById(workflowId, req.userId);
      if (!workflow) {
        res.status(404).json({
          error: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND'
        });
        return;
      }

      const logs = await persistenceService.getExecutionLogs(workflowId);

      res.json({
        success: true,
        data: logs
      });
    } catch (error) {
      console.error('Error fetching execution logs:', error);
      
      if (error instanceof WorkflowError) {
        res.status(500).json({
          error: error.message,
          code: 'INTERNAL_ERROR'
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  /**
   * POST /api/orchestration/workflows/:id/logs
   * Add execution log entry
   */
  router.post('/workflows/:id/logs', extractUserId, async (req: Request, res: Response) => {
    try {
      const workflowId = req.params.id;
      const logEntry = req.body;

      // Verify workflow exists and user has access
      const workflow = await persistenceService.getWorkflowById(workflowId, req.userId);
      if (!workflow) {
        res.status(404).json({
          error: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND'
        });
        return;
      }

      // Create execution log using persistence service
      const log = await persistenceService.createExecutionLog({
        workflow_id: workflowId,
        step_number: logEntry.step_number,
        agent_name: logEntry.agent_name,
        status: logEntry.status,
        input_data: logEntry.input_data || {},
        output_data: logEntry.output_data || {},
        error_message: logEntry.error_message || null,
        execution_time_ms: logEntry.execution_time_ms || null
      });

      res.status(201).json({
        success: true,
        data: log
      });
    } catch (error) {
      console.error('Error adding execution log:', error);
      
      if (error instanceof WorkflowError) {
        res.status(500).json({
          error: error.message,
          code: 'INTERNAL_ERROR'
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  // ==================== WORKFLOW EXECUTION ====================

  /**
   * POST /api/orchestration/workflows/:id/execute
   * Execute a workflow
   */
  router.post('/workflows/:id/execute', extractUserId, async (req: Request, res: Response) => {
    try {
      const workflowId = req.params.id;
      const { step_number, input_data } = req.body;

      // Verify workflow exists and user has access
      const workflow = await persistenceService.getWorkflowById(workflowId, req.userId);
      if (!workflow) {
        res.status(404).json({
          error: 'Workflow not found',
          code: 'WORKFLOW_NOT_FOUND'
        });
        return;
      }

      // TODO: Implement actual workflow execution logic
      // For now, return a placeholder response
      res.json({
        success: true,
        message: 'Workflow execution initiated',
        workflow_id: workflowId,
        step_number: step_number || 1,
        status: 'pending'
      });
    } catch (error) {
      console.error('Error executing workflow:', error);
      
      if (error instanceof WorkflowError) {
        res.status(500).json({
          error: error.message,
          code: 'INTERNAL_ERROR'
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
    }
  });

  // ==================== WORKFLOW TEMPLATES ====================

  /**
   * POST /api/orchestration/templates
   * Create a workflow template from an existing workflow
   */
  router.post('/templates', extractUserId, async (req: Request, res: Response) => {
    try {
      const { workflow_id, name, description, category, is_public } = req.body;

      if (!workflow_id || !name) {
        res.status(400).json({
          error: 'workflow_id and name are required',
          code: 'VALIDATION_ERROR'
        });
        return;
      }

      // Get the source workflow
      const sourceWorkflow = await persistenceService.getWorkflowById(workflow_id, req.userId);
      if (!sourceWorkflow) {
        res.status(404).json({
          error: 'Source workflow not found',
          code: 'NOT_FOUND',
          workflow_id: workflow_id
        });
        return;
      }

      // Create template data (remove user-specific and execution-specific fields)
      const templateData = {
        name: sourceWorkflow.name,
        description: sourceWorkflow.description,
        task_breakdown: sourceWorkflow.task_breakdown,
        agents: sourceWorkflow.agents,
        data_flow: sourceWorkflow.data_flow,
        dependencies: sourceWorkflow.dependencies,
        risks: sourceWorkflow.risks,
        estimated_success_rate: sourceWorkflow.estimated_success_rate,
        execution_time_estimate: sourceWorkflow.execution_time_estimate
      };

      const template = await persistenceService.createTemplate({
        name,
        description,
        category,
        template_data: templateData,
        usage_count: 0,
        is_public: is_public || false,
        created_by: req.userId
      });

      res.status(201).json({
        success: true,
        data: template
      });
      return;
    } catch (error) {
      console.error('Error creating template:', error);
      
      if (error instanceof WorkflowError) {
        res.status(500).json({
          error: error.message,
          code: error.code
        });
        return;
      }

      res.status(500).json({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR'
      });
      return;
    }
  });

  // ==================== HEALTH CHECK ====================

  /**
   * GET /api/orchestration/health
   * Health check endpoint
   */
  router.get('/health', async (req: Request, res: Response) => {
    try {
      // Test database connection
      await pool.query('SELECT 1');
      
      res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'orchestration-workflows'
      });
      return;
    } catch (error) {
      console.error('Health check failed:', error);
      res.status(503).json({
        success: false,
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        service: 'orchestration-workflows',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  return router;
}

// Extend Express Request interface to include userId
declare global {
  namespace Express {
    interface Request {
      userId: string;
    }
  }
}

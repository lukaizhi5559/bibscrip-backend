/**
 * TypeScript interfaces for Thinkdrop AI Drops Orchestration System
 * Phase 1: Foundation & Persistence Layer
 */

export interface OrchestrationWorkflow {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  status: WorkflowStatus;
  
  // Core workflow definition
  task_breakdown: TaskBreakdownStep[];
  agents: WorkflowAgent[];
  data_flow?: string;
  
  // Dynamic extensions (Phase 3)
  custom_task_breakdown: CustomTask[];
  external_agents: ExternalAgent[];
  
  // Execution state
  current_step: number;
  execution_context: Record<string, any>;
  results: Record<string, any>;
  
  // Metadata
  estimated_success_rate?: number;
  execution_time_estimate?: string;
  dependencies: WorkflowDependency[];
  risks: WorkflowRisk[];
  fallback_strategies: string[];
  
  // Timestamps
  created_at: Date;
  updated_at: Date;
  last_executed_at?: Date;
}

export type WorkflowStatus = 'draft' | 'running' | 'paused' | 'completed' | 'failed';

export interface TaskBreakdownStep {
  step: number;
  description: string;
  agent_needed: string;
  inputs: string[];
  outputs: string[];
  dependencies?: string[];
  estimated_duration?: string;
}

export interface WorkflowAgent {
  name: string;
  type: string;
  reason: string;
  execution_order: number;
  capabilities?: string[];
  parameters?: Record<string, any>;
  config?: Record<string, any>;
}

export interface CustomTask {
  id: string;
  description: string;
  agent_name: string;
  insertion_point: number;
  created_at: Date;
}

export interface ExternalAgent {
  name: string;
  type: string;
  reason: string;
  execution_order?: number;
  source: 'user_injected' | 'system_suggested';
  added_at: Date;
}

export interface WorkflowDependency {
  type: 'oauth' | 'api_key' | 'system_access' | 'permission' | 'service';
  description: string;
  required: boolean;
  status?: 'satisfied' | 'pending' | 'failed';
}

export interface WorkflowRisk {
  risk: string;
  mitigation: string;
  severity: 'low' | 'medium' | 'high';
  probability?: number;
}

export interface WorkflowExecutionLog {
  id: string;
  workflow_id: string;
  step_number: number;
  agent_name: string;
  status: ExecutionStatus;
  input_data: Record<string, any>;
  output_data: Record<string, any>;
  error_message?: string;
  execution_time_ms?: number;
  created_at: Date;
}

export type ExecutionStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped';

export interface WorkflowTemplate {
  id: string;
  name: string;
  description?: string;
  category?: string;
  template_data: Partial<OrchestrationWorkflow>;
  usage_count: number;
  is_public: boolean;
  created_by?: string;
  created_at: Date;
  updated_at: Date;
}

// Request/Response DTOs
export interface CreateWorkflowRequest {
  name: string;
  description?: string;
  task_breakdown: TaskBreakdownStep[];
  agents: WorkflowAgent[];
  data_flow?: string;
  dependencies?: WorkflowDependency[];
  risks?: WorkflowRisk[];
  estimated_success_rate?: number;
  execution_time_estimate?: string;
}

export interface UpdateWorkflowRequest {
  name?: string;
  description?: string;
  status?: WorkflowStatus;
  task_breakdown?: TaskBreakdownStep[];
  agents?: WorkflowAgent[];
  data_flow?: string;
  custom_task_breakdown?: CustomTask[];
  external_agents?: ExternalAgent[];
  execution_context?: Record<string, any>;
  results?: Record<string, any>;
}

export interface WorkflowListResponse {
  workflows: OrchestrationWorkflow[];
  total: number;
  page: number;
  limit: number;
}

export interface WorkflowExecutionRequest {
  workflow_id: string;
  start_from_step?: number;
  execution_options?: {
    auto_approve?: boolean;
    timeout_ms?: number;
    parallel_execution?: boolean;
  };
}

export interface WorkflowExecutionResponse {
  execution_id: string;
  status: ExecutionStatus;
  current_step: number;
  total_steps: number;
  estimated_completion?: Date;
  logs: WorkflowExecutionLog[];
}

// Utility types for Phase 2 (Interactive Control)
export interface WorkflowCommand {
  type: 'execute' | 'pause' | 'resume' | 'stop' | 'step' | 'inject_agent' | 'modify';
  workflow_id: string;
  parameters?: Record<string, any>;
  user_prompt?: string;
}

export interface WorkflowCommandResponse {
  success: boolean;
  message: string;
  workflow_state?: Partial<OrchestrationWorkflow>;
  next_actions?: string[];
}

// Error types
export class WorkflowError extends Error {
  constructor(
    message: string,
    public code: string,
    public workflow_id?: string,
    public step_number?: number
  ) {
    super(message);
    this.name = 'WorkflowError';
  }
}

export class WorkflowValidationError extends WorkflowError {
  constructor(message: string, workflow_id?: string) {
    super(message, 'VALIDATION_ERROR', workflow_id);
    this.name = 'WorkflowValidationError';
  }
}

export class WorkflowExecutionError extends WorkflowError {
  constructor(message: string, workflow_id: string, step_number?: number) {
    super(message, 'EXECUTION_ERROR', workflow_id, step_number);
    this.name = 'WorkflowExecutionError';
  }
}

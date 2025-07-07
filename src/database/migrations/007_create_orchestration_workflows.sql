-- Migration: Create Orchestration Workflows Tables
-- Date: 2025-01-07
-- Purpose: Phase 1 - Foundation & Persistence Layer for Thinkdrop AI Drops

-- Main orchestration workflows table
CREATE TABLE orchestration_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  status VARCHAR(20) DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed', 'failed')),
  
  -- Core workflow definition
  task_breakdown JSONB NOT NULL DEFAULT '[]',
  agents JSONB NOT NULL DEFAULT '[]',
  data_flow TEXT,
  
  -- Dynamic extensions (Phase 3)
  custom_task_breakdown JSONB DEFAULT '[]',
  external_agents JSONB DEFAULT '[]',
  
  -- Execution state
  current_step INTEGER DEFAULT 0,
  execution_context JSONB DEFAULT '{}',
  results JSONB DEFAULT '{}',
  
  -- Metadata
  estimated_success_rate DECIMAL(3,2),
  execution_time_estimate VARCHAR(50),
  dependencies JSONB DEFAULT '[]',
  risks JSONB DEFAULT '[]',
  fallback_strategies JSONB DEFAULT '[]',
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_executed_at TIMESTAMP WITH TIME ZONE,
  
  -- Indexes for performance
  CONSTRAINT valid_success_rate CHECK (estimated_success_rate >= 0 AND estimated_success_rate <= 1)
);

-- Execution logs table for tracking workflow runs
CREATE TABLE orchestration_execution_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id UUID REFERENCES orchestration_workflows(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL,
  agent_name VARCHAR(255),
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed', 'skipped')),
  
  -- Execution details
  input_data JSONB DEFAULT '{}',
  output_data JSONB DEFAULT '{}',
  error_message TEXT,
  execution_time_ms INTEGER,
  
  -- Timestamps
  started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  completed_at TIMESTAMP WITH TIME ZONE
);

-- Workflow templates table for reusable patterns
CREATE TABLE orchestration_workflow_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL,
  description TEXT,
  category VARCHAR(100),
  
  -- Template data (sanitized workflow structure)
  template_data JSONB NOT NULL,
  
  -- Usage tracking
  usage_count INTEGER DEFAULT 0,
  is_public BOOLEAN DEFAULT false,
  
  -- Ownership
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  
  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes for performance optimization
CREATE INDEX idx_orchestration_workflows_user_id ON orchestration_workflows(user_id);
CREATE INDEX idx_orchestration_workflows_status ON orchestration_workflows(status);
CREATE INDEX idx_orchestration_workflows_created_at ON orchestration_workflows(created_at);
CREATE INDEX idx_orchestration_workflows_updated_at ON orchestration_workflows(updated_at);

-- Create indexes for execution logs table
CREATE INDEX idx_execution_logs_workflow_id ON orchestration_execution_logs(workflow_id);
CREATE INDEX idx_execution_logs_status ON orchestration_execution_logs(status);
CREATE INDEX idx_execution_logs_started_at ON orchestration_execution_logs(started_at);

-- Create indexes for workflow templates table
CREATE INDEX idx_workflow_templates_category ON orchestration_workflow_templates(category);
CREATE INDEX idx_workflow_templates_public ON orchestration_workflow_templates(is_public);
CREATE INDEX idx_workflow_templates_created_by ON orchestration_workflow_templates(created_by);

-- Create updated_at trigger for orchestration_workflows
CREATE OR REPLACE FUNCTION update_orchestration_workflows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_orchestration_workflows_updated_at
  BEFORE UPDATE ON orchestration_workflows
  FOR EACH ROW
  EXECUTE FUNCTION update_orchestration_workflows_updated_at();

-- Create updated_at trigger for workflow templates
CREATE OR REPLACE FUNCTION update_workflow_templates_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_workflow_templates_updated_at
  BEFORE UPDATE ON orchestration_workflow_templates
  FOR EACH ROW
  EXECUTE FUNCTION update_workflow_templates_updated_at();

-- Comments for documentation
COMMENT ON TABLE orchestration_workflows IS 'Main table for storing Thinkdrop AI Drops orchestration workflows';
COMMENT ON TABLE orchestration_execution_logs IS 'Execution logs for tracking workflow step-by-step progress';
COMMENT ON TABLE orchestration_workflow_templates IS 'Reusable workflow templates for common automation patterns';

COMMENT ON COLUMN orchestration_workflows.task_breakdown IS 'Array of task steps in the workflow';
COMMENT ON COLUMN orchestration_workflows.agents IS 'Array of agent definitions for the workflow';
COMMENT ON COLUMN orchestration_workflows.custom_task_breakdown IS 'User-modified task breakdown for dynamic workflows';
COMMENT ON COLUMN orchestration_workflows.external_agents IS 'Runtime-injected agents not in original plan';
COMMENT ON COLUMN orchestration_workflows.execution_context IS 'Current execution state and variables';
COMMENT ON COLUMN orchestration_workflows.results IS 'Accumulated results from completed steps';

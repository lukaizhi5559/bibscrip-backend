-- Add agent configuration, secrets, and orchestrator metadata support
-- This enables complex multi-agent workflows with secure credential management

-- Add new columns to agents table
ALTER TABLE agents ADD COLUMN IF NOT EXISTS config JSONB DEFAULT '{}'::jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS secrets JSONB DEFAULT '{}'::jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS orchestrator_metadata JSONB DEFAULT '{}'::jsonb;

-- Add comments for documentation
COMMENT ON COLUMN agents.config IS 'Static/default configuration (e.g., voice settings, language preferences, API endpoints)';
COMMENT ON COLUMN agents.secrets IS 'Encrypted secrets and API keys (e.g., telegram_bot_token, openai_key) - should be encrypted at rest';
COMMENT ON COLUMN agents.orchestrator_metadata IS 'MCP orchestration data (e.g., execution order, target agents, workflow chains)';

-- Create indexes for efficient querying of config and metadata
CREATE INDEX IF NOT EXISTS idx_agents_config_gin ON agents USING gin(config);
CREATE INDEX IF NOT EXISTS idx_agents_orchestrator_metadata_gin ON agents USING gin(orchestrator_metadata);

-- Create agent_secrets table for enhanced security (optional alternative to JSONB column)
CREATE TABLE IF NOT EXISTS agent_secrets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    secret_key TEXT NOT NULL,
    secret_value_encrypted TEXT NOT NULL, -- Should be encrypted using application-level encryption
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    expires_at TIMESTAMP, -- Optional expiration for rotating secrets
    UNIQUE(agent_id, secret_key)
);

-- Indexes for agent_secrets
CREATE INDEX IF NOT EXISTS idx_agent_secrets_agent_id ON agent_secrets(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_secrets_key ON agent_secrets(secret_key);
CREATE INDEX IF NOT EXISTS idx_agent_secrets_expires_at ON agent_secrets(expires_at);

-- Function to update agent_secrets updated_at timestamp
CREATE OR REPLACE FUNCTION update_agent_secrets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for agent_secrets
DROP TRIGGER IF EXISTS update_agent_secrets_updated_at ON agent_secrets;
CREATE TRIGGER update_agent_secrets_updated_at
    BEFORE UPDATE ON agent_secrets
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_secrets_updated_at();

-- Create agent_workflows table for complex multi-agent orchestration
CREATE TABLE IF NOT EXISTS agent_workflows (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    workflow_definition JSONB NOT NULL, -- Defines the complete workflow chain
    created_by TEXT, -- User or system that created the workflow
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    is_active BOOLEAN DEFAULT TRUE
);

-- Indexes for agent_workflows
CREATE INDEX IF NOT EXISTS idx_agent_workflows_name ON agent_workflows(name);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_active ON agent_workflows(is_active);
CREATE INDEX IF NOT EXISTS idx_agent_workflows_definition_gin ON agent_workflows USING gin(workflow_definition);

-- Function to update agent_workflows updated_at timestamp
CREATE OR REPLACE FUNCTION update_agent_workflows_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for agent_workflows
DROP TRIGGER IF EXISTS update_agent_workflows_updated_at ON agent_workflows;
CREATE TRIGGER update_agent_workflows_updated_at
    BEFORE UPDATE ON agent_workflows
    FOR EACH ROW
    EXECUTE FUNCTION update_agent_workflows_updated_at();

-- Create workflow_executions table to track workflow runs
CREATE TABLE IF NOT EXISTS workflow_executions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workflow_id UUID NOT NULL REFERENCES agent_workflows(id) ON DELETE CASCADE,
    execution_status TEXT CHECK (execution_status IN ('pending', 'running', 'completed', 'failed', 'cancelled')) DEFAULT 'pending',
    input_data JSONB,
    output_data JSONB,
    error_details JSONB,
    started_at TIMESTAMP DEFAULT NOW(),
    completed_at TIMESTAMP,
    execution_log JSONB DEFAULT '[]'::jsonb -- Array of execution steps and their results
);

-- Indexes for workflow_executions
CREATE INDEX IF NOT EXISTS idx_workflow_executions_workflow_id ON workflow_executions(workflow_id);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_status ON workflow_executions(execution_status);
CREATE INDEX IF NOT EXISTS idx_workflow_executions_started_at ON workflow_executions(started_at);

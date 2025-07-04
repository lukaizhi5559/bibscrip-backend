-- Agents table for LLM-Oriented Backend Brain
-- Stores agent metadata, code, dependencies, and execution requirements

CREATE TABLE IF NOT EXISTS agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT,
    parameters JSONB,
    dependencies TEXT[],
    execution_target TEXT CHECK (execution_target IN ('frontend', 'backend')) NOT NULL DEFAULT 'frontend',
    requires_database BOOLEAN DEFAULT FALSE,
    database_type TEXT CHECK (database_type IN ('sqlite', 'duckdb')),
    code TEXT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    version TEXT DEFAULT 'v1'
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_agents_name ON agents(name);
CREATE INDEX IF NOT EXISTS idx_agents_execution_target ON agents(execution_target);
CREATE INDEX IF NOT EXISTS idx_agents_requires_database ON agents(requires_database);
CREATE INDEX IF NOT EXISTS idx_agents_created_at ON agents(created_at);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_agents_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_agents_updated_at ON agents;
CREATE TRIGGER update_agents_updated_at
    BEFORE UPDATE ON agents
    FOR EACH ROW
    EXECUTE FUNCTION update_agents_updated_at();

-- Agent communication logs table for structured data passing
CREATE TABLE IF NOT EXISTS agent_communications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    from_agent TEXT NOT NULL,
    to_agent TEXT NOT NULL,
    data JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_communications_from ON agent_communications(from_agent);
CREATE INDEX IF NOT EXISTS idx_agent_communications_to ON agent_communications(to_agent);
CREATE INDEX IF NOT EXISTS idx_agent_communications_created_at ON agent_communications(created_at);

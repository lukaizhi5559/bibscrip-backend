-- Action Logs table for UI-Indexed Intelligent Agent
-- Detailed logging of individual automation actions within sessions

CREATE TABLE IF NOT EXISTS action_logs (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) REFERENCES automation_sessions(session_id) ON DELETE CASCADE,
    action_type VARCHAR(50) NOT NULL,
    action_data JSONB,
    coordinates JSONB,
    success BOOLEAN DEFAULT false,
    error_message TEXT,
    execution_time_ms INTEGER,
    screenshot_path VARCHAR(500),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_action_logs_session ON action_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_action_logs_type ON action_logs(action_type);
CREATE INDEX IF NOT EXISTS idx_action_logs_success ON action_logs(success);
CREATE INDEX IF NOT EXISTS idx_action_logs_created ON action_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_action_logs_session_created ON action_logs(session_id, created_at);

-- Function to clean up old action logs (older than 7 days)
CREATE OR REPLACE FUNCTION cleanup_old_action_logs()
RETURNS void AS $$
BEGIN
    DELETE FROM action_logs 
    WHERE created_at < NOW() - INTERVAL '7 days';
END;
$$ language 'plpgsql';

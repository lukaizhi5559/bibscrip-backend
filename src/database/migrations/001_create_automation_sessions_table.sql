-- Automation Sessions table for UI-Indexed Intelligent Agent
-- Tracks automation task sessions and their execution status

CREATE TABLE IF NOT EXISTS automation_sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    task_description TEXT NOT NULL,
    app_name VARCHAR(255),
    window_title VARCHAR(500),
    status VARCHAR(50) DEFAULT 'pending',
    actions_planned INTEGER DEFAULT 0,
    actions_completed INTEGER DEFAULT 0,
    success BOOLEAN DEFAULT false,
    error_message TEXT,
    execution_time_ms INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    completed_at TIMESTAMP
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_automation_sessions_status ON automation_sessions(status);
CREATE INDEX IF NOT EXISTS idx_automation_sessions_created ON automation_sessions(created_at);
CREATE INDEX IF NOT EXISTS idx_automation_sessions_session_id ON automation_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_automation_sessions_app ON automation_sessions(app_name);

-- Function to update completed_at timestamp when status changes to completed
CREATE OR REPLACE FUNCTION update_automation_session_completed_at()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('completed', 'failed') AND OLD.status NOT IN ('completed', 'failed') THEN
        NEW.completed_at = CURRENT_TIMESTAMP;
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update completed_at
DROP TRIGGER IF EXISTS update_automation_session_completed_at ON automation_sessions;
CREATE TRIGGER update_automation_session_completed_at
    BEFORE UPDATE ON automation_sessions
    FOR EACH ROW
    EXECUTE FUNCTION update_automation_session_completed_at();

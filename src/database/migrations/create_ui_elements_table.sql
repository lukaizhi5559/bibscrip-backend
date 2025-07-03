-- UI Elements table for UI-Indexed Intelligent Agent
-- Stores actionable UI elements across user applications

CREATE TABLE IF NOT EXISTS ui_elements (
    id SERIAL PRIMARY KEY,
    app_name VARCHAR(255) NOT NULL,
    window_title VARCHAR(500),
    element_role VARCHAR(100) NOT NULL, -- button, input, dropdown, link, etc.
    element_label VARCHAR(500),
    element_value TEXT,
    x INTEGER NOT NULL,
    y INTEGER NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    accessibility_id VARCHAR(255),
    class_name VARCHAR(255),
    automation_id VARCHAR(255),
    is_enabled BOOLEAN DEFAULT true,
    is_visible BOOLEAN DEFAULT true,
    confidence_score FLOAT DEFAULT 1.0,
    last_seen TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast querying
CREATE INDEX IF NOT EXISTS idx_ui_elements_app_window ON ui_elements(app_name, window_title);
CREATE INDEX IF NOT EXISTS idx_ui_elements_role_label ON ui_elements(element_role, element_label);
CREATE INDEX IF NOT EXISTS idx_ui_elements_geometry ON ui_elements(x, y, width, height);
CREATE INDEX IF NOT EXISTS idx_ui_elements_last_seen ON ui_elements(last_seen);
CREATE INDEX IF NOT EXISTS idx_ui_elements_enabled_visible ON ui_elements(is_enabled, is_visible);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ui_elements_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_ui_elements_updated_at ON ui_elements;
CREATE TRIGGER update_ui_elements_updated_at
    BEFORE UPDATE ON ui_elements
    FOR EACH ROW
    EXECUTE FUNCTION update_ui_elements_updated_at();

-- Clean up old entries (older than 1 hour)
CREATE OR REPLACE FUNCTION cleanup_stale_ui_elements()
RETURNS void AS $$
BEGIN
    DELETE FROM ui_elements 
    WHERE last_seen < NOW() - INTERVAL '1 hour';
END;
$$ language 'plpgsql';

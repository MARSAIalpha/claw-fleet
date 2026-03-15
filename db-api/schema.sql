-- 小龙虾舰队共享数据库 Schema
-- 在 Mac Mini 2 上执行: psql clawfleet < schema.sql

-- 启用扩展
CREATE EXTENSION IF NOT EXISTS vector;

-- ═══════════════════════════════════════
-- 任务记录
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS tasks (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  assigned_to VARCHAR(50),
  created_by VARCHAR(50),
  status VARCHAR(20) DEFAULT 'pending',
  priority INT DEFAULT 0,
  result TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_assigned ON tasks(assigned_to);

-- ═══════════════════════════════════════
-- 跨 Agent 资产共享
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS assets (
  id SERIAL PRIMARY KEY,
  asset_type VARCHAR(50) NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  file_path TEXT NOT NULL,
  file_size BIGINT,
  mime_type VARCHAR(100),
  metadata JSONB DEFAULT '{}',
  created_by VARCHAR(50) NOT NULL,
  status VARCHAR(20) DEFAULT 'ready',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assets_type ON assets(asset_type);
CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
CREATE INDEX IF NOT EXISTS idx_assets_created_by ON assets(created_by);

-- ═══════════════════════════════════════
-- 知识库（文档 + 向量）
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS knowledge (
  id SERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  source VARCHAR(500),
  category VARCHAR(50),
  tags TEXT[] DEFAULT '{}',
  embedding vector(1536),
  created_by VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_category ON knowledge(category);
CREATE INDEX IF NOT EXISTS idx_knowledge_embedding ON knowledge USING ivfflat (embedding vector_cosine_ops);

-- ═══════════════════════════════════════
-- Agent 日志
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_logs (
  id SERIAL PRIMARY KEY,
  agent_id VARCHAR(50) NOT NULL,
  action VARCHAR(100),
  detail JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_logs_agent ON agent_logs(agent_id);
CREATE INDEX IF NOT EXISTS idx_logs_created ON agent_logs(created_at);

-- ═══════════════════════════════════════
-- 指标统计
-- ═══════════════════════════════════════
CREATE TABLE IF NOT EXISTS metrics (
  id SERIAL PRIMARY KEY,
  agent_id VARCHAR(50),
  metric_name VARCHAR(100),
  metric_value NUMERIC,
  tags JSONB DEFAULT '{}',
  recorded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_metrics_agent ON metrics(agent_id);
CREATE INDEX IF NOT EXISTS idx_metrics_name ON metrics(metric_name);
CREATE INDEX IF NOT EXISTS idx_metrics_recorded ON metrics(recorded_at);

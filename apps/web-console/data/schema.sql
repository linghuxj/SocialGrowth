-- ==============================================================================
-- SocialGrowth 早期演示数据库 Schema（历史实现快照，未按 design-v1 迁移）
-- B-01 目标持久化规格：docs/engineering/data-model.md
-- 本文件含旧文件级锁及状态，不得作为符合 G-02/G-03/G-04a 的生产建库或迁移脚本。
-- 使用 TEXT[]/JSONB 等 PostgreSQL 类型，不宣称 SQLite 兼容；应用当前读取本地 JSON。
-- 保留用于旧演示数据追溯；对应实现任务需同步 SQL、TS 类型、JSON 及迁移验证。
-- ==============================================================================

-- 1. 物理真机设备表 (100% 纯物理真机，严禁模拟器)
CREATE TABLE IF NOT EXISTS devices (
    device_id VARCHAR(32) PRIMARY KEY,
    model VARCHAR(64) NOT NULL DEFAULT 'Samsung Galaxy S23 (SM-S911U1)',
    serial_number VARCHAR(64) NOT NULL UNIQUE,
    carrier VARCHAR(64) NOT NULL DEFAULT 'T-Mobile US 5G',
    location VARCHAR(128) NOT NULL,
    battery_level INTEGER NOT NULL CHECK (battery_level BETWEEN 0 AND 100),
    temperature_c NUMERIC(4, 1) NOT NULL,
    network_latency_ms INTEGER NOT NULL,
    health_status VARCHAR(16) NOT NULL CHECK (health_status IN ('healthy', 'warning', 'critical')),
    assigned_fb_account_id VARCHAR(32) NOT NULL,
    assigned_yt_account_id VARCHAR(32) NOT NULL,
    last_heartbeat_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 2. 账号资产表 (1:1 设备专属强绑定)
CREATE TABLE IF NOT EXISTS accounts (
    account_id VARCHAR(32) PRIMARY KEY,
    platform VARCHAR(16) NOT NULL CHECK (platform IN ('facebook', 'youtube', 'instagram')),
    name VARCHAR(128) NOT NULL,
    handle VARCHAR(128) NOT NULL,
    bound_device_id VARCHAR(32) NOT NULL,
    followers_count INTEGER NOT NULL DEFAULT 0,
    stage VARCHAR(32) NOT NULL CHECK (stage IN ('cold_start', 'active_operation', 'restricted', 'replaced')),
    auto_pilot_enabled BOOLEAN NOT NULL DEFAULT false,
    published_count INTEGER NOT NULL DEFAULT 0,
    total_views INTEGER NOT NULL DEFAULT 0,
    is_cold_spare BOOLEAN NOT NULL DEFAULT false,
    last_active_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. 切片素材资产表 (系统级 Exclusive Lock 排他独占分发)
CREATE TABLE IF NOT EXISTS slice_metadata (
    slice_id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(256) NOT NULL,
    drama_title VARCHAR(128) NOT NULL,
    episode_num INTEGER NOT NULL,
    duration_seconds INTEGER NOT NULL,
    aspect_ratio VARCHAR(8) NOT NULL DEFAULT '9:16',
    tags TEXT[] NOT NULL DEFAULT '{}',
    allocation_status VARCHAR(32) NOT NULL CHECK (allocation_status IN ('unallocated', 'assigned_locked', 'published')),
    exclusive_account_id VARCHAR(32),
    locked_at TIMESTAMP WITH TIME ZONE,
    published_at TIMESTAMP WITH TIME ZONE,
    sha256_checksum VARCHAR(64) NOT NULL,
    video_storage_key VARCHAR(256) NOT NULL,
    cover_image_key VARCHAR(256) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. 经验与平台规则表
CREATE TABLE IF NOT EXISTS strategy_rules (
    rule_id VARCHAR(32) PRIMARY KEY,
    version VARCHAR(16) NOT NULL,
    title VARCHAR(128) NOT NULL,
    nature VARCHAR(16) NOT NULL CHECK (nature IN ('constraint', 'heuristic')),
    target_platforms TEXT[] NOT NULL,
    applicable_stage VARCHAR(32) NOT NULL,
    trigger_condition TEXT NOT NULL,
    action_instruction TEXT NOT NULL,
    status VARCHAR(32) NOT NULL CHECK (status IN ('verified_effective', 'verifying', 'unverified', 'deprecated')),
    conflict_check_passed BOOLEAN NOT NULL DEFAULT true,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 5. 待审策略任务队列 (单人审核流)
CREATE TABLE IF NOT EXISTS strategy_reviews (
    review_id VARCHAR(64) PRIMARY KEY,
    account_id VARCHAR(32) NOT NULL,
    account_name VARCHAR(128) NOT NULL,
    platform VARCHAR(16) NOT NULL,
    post_time TIMESTAMP WITH TIME ZONE NOT NULL,
    clip_title VARCHAR(256) NOT NULL,
    copywriting TEXT NOT NULL,
    shortlink_type VARCHAR(32) NOT NULL,
    referenced_rule_ids TEXT[] NOT NULL,
    ai_reasoning TEXT NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 6. 导流短链表 (三层数据流记录)
CREATE TABLE IF NOT EXISTS shortlinks (
    link_id VARCHAR(64) PRIMARY KEY,
    slug VARCHAR(32) NOT NULL UNIQUE,
    full_short_url VARCHAR(256) NOT NULL,
    destination_url TEXT NOT NULL,
    platform VARCHAR(16) NOT NULL,
    account_id VARCHAR(32) NOT NULL,
    raw_clicks INTEGER NOT NULL DEFAULT 0,
    filtered_clicks INTEGER NOT NULL DEFAULT 0,
    successful_redirects INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(16) NOT NULL CHECK (status IN ('active', 'rotated', 'paused')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 7. 防封跳转域名池
CREATE TABLE IF NOT EXISTS domain_pool (
    domain VARCHAR(128) PRIMARY KEY,
    role VARCHAR(16) NOT NULL CHECK (role IN ('primary', 'standby', 'quarantined')),
    health_score INTEGER NOT NULL CHECK (health_score BETWEEN 0 AND 100),
    intercept_rate NUMERIC(5, 4) NOT NULL DEFAULT 0.0,
    status VARCHAR(16) NOT NULL CHECK (status IN ('healthy', 'warning', 'blocked')),
    last_checked_at TIMESTAMP WITH TIME ZONE NOT NULL
);

-- 8. 风控与异常追溯台账
CREATE TABLE IF NOT EXISTS anomaly_records (
    anomaly_id VARCHAR(32) PRIMARY KEY,
    device_id VARCHAR(32) NOT NULL,
    account_id VARCHAR(32) NOT NULL,
    platform VARCHAR(16) NOT NULL,
    type VARCHAR(32) NOT NULL CHECK (type IN ('account_restriction', 'algorithmic_throttle', 'traffic_drop', 'task_timeout')),
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('high', 'medium', 'low')),
    detected_at TIMESTAMP WITH TIME ZONE NOT NULL,
    details TEXT NOT NULL,
    resolution_status VARCHAR(32) NOT NULL CHECK (resolution_status IN ('auto_healed', 'pending_hitl', 'resolved')),
    resolution_action TEXT
);

-- 9. 冷备换号工单流水线
CREATE TABLE IF NOT EXISTS replacement_orders (
    order_id VARCHAR(32) PRIMARY KEY,
    device_id VARCHAR(32) NOT NULL,
    failed_account_id VARCHAR(32) NOT NULL,
    new_account_id VARCHAR(32) NOT NULL,
    platform VARCHAR(16) NOT NULL,
    triggered_at TIMESTAMP WITH TIME ZONE NOT NULL,
    steps_json JSONB NOT NULL,
    is_complete BOOLEAN NOT NULL DEFAULT false
);

-- 10. HITL 2FA 人机协同接管记录
CREATE TABLE IF NOT EXISTS hitl_2fa_events (
    event_id VARCHAR(32) PRIMARY KEY,
    device_id VARCHAR(32) NOT NULL,
    account_id VARCHAR(32) NOT NULL,
    platform VARCHAR(16) NOT NULL,
    requested_at TIMESTAMP WITH TIME ZONE NOT NULL,
    code_received VARCHAR(16),
    status VARCHAR(32) NOT NULL CHECK (status IN ('waiting_operator', 'verified', 'expired'))
);

-- 11. A/B 策略实验表
CREATE TABLE IF NOT EXISTS ab_experiments (
    experiment_id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    hypothesis TEXT NOT NULL,
    status VARCHAR(16) NOT NULL CHECK (status IN ('running', 'promoted', 'rolled_back')),
    start_date DATE NOT NULL,
    observation_days INTEGER NOT NULL,
    baseline_group JSONB NOT NULL,
    experiment_group JSONB NOT NULL,
    score_lift_percent NUMERIC(5, 2) NOT NULL,
    dual_track_source JSONB NOT NULL,
    conclusion TEXT NOT NULL
);

-- ==============================================================================
-- design-v1：FL-01 客户授权、内容身份与发布事实
-- 这些表替代旧 accounts/slice_metadata 中混合的客户、归属与发布语义。
-- 旧表保留为演示快照；迁移时不得从 failed/completed/unallocated 推断发布事实。
-- ==============================================================================

CREATE TABLE IF NOT EXISTS projects (
    project_id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(256) NOT NULL,
    client_id VARCHAR(64),
    primary_goal TEXT,
    audience TEXT,
    owner_id VARCHAR(64),
    starts_at TIMESTAMP WITH TIME ZONE,
    ends_at TIMESTAMP WITH TIME ZONE,
    status VARCHAR(16) NOT NULL CHECK (status IN ('draft', 'active', 'exited')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (ends_at IS NULL OR starts_at IS NULL OR ends_at > starts_at)
);

CREATE TABLE IF NOT EXISTS account_service_relations (
    relation_id VARCHAR(64) PRIMARY KEY,
    account_id VARCHAR(64) NOT NULL,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(project_id),
    client_id VARCHAR(64) NOT NULL,
    owner_party_id VARCHAR(64) NOT NULL,
    authorizer_party_id VARCHAR(64) NOT NULL,
    authorization_ref TEXT NOT NULL,
    allowed_actions JSONB NOT NULL,
    allowed_data JSONB NOT NULL,
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_until TIMESTAMP WITH TIME ZONE,
    shared_approval_ref TEXT,
    revoked_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (valid_until IS NULL OR valid_until > valid_from)
);

CREATE INDEX IF NOT EXISTS idx_account_service_relations_active
    ON account_service_relations (account_id, valid_from, valid_until)
    WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS content_identities (
    content_identity_id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(256) NOT NULL,
    source_ref TEXT NOT NULL,
    story_summary TEXT NOT NULL,
    allocation_status VARCHAR(24) NOT NULL
        CHECK (allocation_status IN ('unallocated', 'reserved', 'assigned_locked')),
    assigned_account_id VARCHAR(64),
    allocation_version INTEGER NOT NULL DEFAULT 0 CHECK (allocation_version >= 0),
    first_published_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (
        (allocation_status = 'unallocated' AND assigned_account_id IS NULL)
        OR (allocation_status <> 'unallocated' AND assigned_account_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS slice_assets (
    slice_id VARCHAR(64) PRIMARY KEY,
    content_identity_id VARCHAR(64) NOT NULL REFERENCES content_identities(content_identity_id),
    language VARCHAR(32) NOT NULL,
    variant VARCHAR(16) NOT NULL CHECK (variant IN ('subtitle', 'voiceover', 'cover', 'master')),
    file_ref TEXT NOT NULL,
    sha256 CHAR(64) NOT NULL,
    rights_ref TEXT NOT NULL,
    rights_valid_until TIMESTAMP WITH TIME ZONE,
    destination_fit VARCHAR(24) NOT NULL
        CHECK (destination_fit IN ('eligible', 'ineligible', 'pending_review')),
    overlap_review JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (content_identity_id, slice_id)
);

CREATE TABLE IF NOT EXISTS publication_attempts (
    attempt_id VARCHAR(64) PRIMARY KEY,
    content_identity_id VARCHAR(64) NOT NULL REFERENCES content_identities(content_identity_id),
    slice_id VARCHAR(64) NOT NULL REFERENCES slice_assets(slice_id),
    account_id VARCHAR(64) NOT NULL,
    publish_status VARCHAR(32) NOT NULL CHECK (
        publish_status IN ('not_submitted', 'in_progress', 'unknown', 'confirmed_not_published', 'published')
    ),
    evidence_refs JSONB NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_publication_attempts_identity_status
    ON publication_attempts (content_identity_id, publish_status);

CREATE TABLE IF NOT EXISTS audit_log (
    log_id VARCHAR(64) PRIMARY KEY,
    occurred_at TIMESTAMP WITH TIME ZONE NOT NULL,
    correlation_id VARCHAR(64) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    action VARCHAR(128) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    result VARCHAR(16) NOT NULL CHECK (result IN ('accepted', 'rejected')),
    reason_code VARCHAR(64) NOT NULL,
    facts JSONB NOT NULL,
    evidence_refs JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_log_correlation ON audit_log (correlation_id, occurred_at);

CREATE TABLE IF NOT EXISTS destination_entries (
    destination_entry_id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(project_id),
    account_id VARCHAR(64) NOT NULL,
    scope VARCHAR(16) NOT NULL CHECK (scope IN ('content', 'channel')),
    scope_id VARCHAR(64) NOT NULL,
    maintenance_permission_ref TEXT NOT NULL,
    shared_attribution BOOLEAN NOT NULL DEFAULT FALSE,
    exit_policy VARCHAR(16) NOT NULL CHECK (exit_policy IN ('continue', 'disable')),
    active_version_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS destination_versions (
    destination_version_id VARCHAR(64) PRIMARY KEY,
    destination_entry_id VARCHAR(64) NOT NULL REFERENCES destination_entries(destination_entry_id),
    url TEXT NOT NULL,
    health VARCHAR(32) NOT NULL CHECK (health IN ('available', 'service_failure', 'destination_invalid', 'platform_restricted')),
    is_active BOOLEAN NOT NULL,
    change_reason TEXT NOT NULL,
    supersedes_version_id VARCHAR(64) REFERENCES destination_versions(destination_version_id),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS destination_events (
    destination_event_id VARCHAR(64) PRIMARY KEY,
    destination_entry_id VARCHAR(64) NOT NULL REFERENCES destination_entries(destination_entry_id),
    destination_version_id VARCHAR(64) NOT NULL REFERENCES destination_versions(destination_version_id),
    event_type VARCHAR(32) NOT NULL CHECK (event_type IN ('raw_visit', 'filtered_click', 'redirect_response')),
    observed_at TIMESTAMP WITH TIME ZONE NOT NULL,
    response_status INTEGER,
    reason_code VARCHAR(64) NOT NULL,
    correlation_id VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_rules (
    strategy_rule_id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(project_id),
    version INTEGER NOT NULL,
    category VARCHAR(32) NOT NULL,
    statement TEXT NOT NULL,
    source_ref TEXT NOT NULL,
    status VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS strategy_drafts (
    strategy_draft_id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(project_id),
    version INTEGER NOT NULL,
    rule_ids JSONB NOT NULL,
    content_identity_id VARCHAR(64) NOT NULL REFERENCES content_identities(content_identity_id),
    account_id VARCHAR(64) NOT NULL,
    destination_version_id VARCHAR(64) NOT NULL REFERENCES destination_versions(destination_version_id),
    rationale TEXT NOT NULL,
    assumptions JSONB NOT NULL,
    evidence_refs JSONB NOT NULL,
    output_mode VARCHAR(16) NOT NULL CHECK (output_mode IN ('controlled', 'provider')),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS execution_approvals (
    approval_id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(project_id),
    strategy_draft_id VARCHAR(64) NOT NULL REFERENCES strategy_drafts(strategy_draft_id),
    strategy_version INTEGER NOT NULL,
    content_identity_id VARCHAR(64) NOT NULL REFERENCES content_identities(content_identity_id),
    account_id VARCHAR(64) NOT NULL,
    destination_version_id VARCHAR(64) NOT NULL REFERENCES destination_versions(destination_version_id),
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    cost_limit NUMERIC,
    valid_from TIMESTAMP WITH TIME ZONE NOT NULL,
    valid_until TIMESTAMP WITH TIME ZONE NOT NULL,
    stop_conditions JSONB NOT NULL,
    observation_conditions JSONB NOT NULL,
    status VARCHAR(16) NOT NULL,
    invalidation_reason TEXT,
    approved_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS publication_schedules (
    schedule_id VARCHAR(64) PRIMARY KEY,
    approval_id VARCHAR(64) NOT NULL REFERENCES execution_approvals(approval_id),
    business_timezone VARCHAR(64) NOT NULL,
    scheduled_for TIMESTAMP WITH TIME ZONE NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(16) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS metric_observations (
    observation_id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(project_id),
    strategy_version INTEGER NOT NULL,
    approval_id VARCHAR(64) NOT NULL REFERENCES execution_approvals(approval_id),
    metric_key VARCHAR(128) NOT NULL,
    value NUMERIC,
    availability VARCHAR(24) NOT NULL CHECK (availability IN ('observed_value', 'observed_zero', 'missing', 'delayed', 'unauthorized')),
    source TEXT NOT NULL,
    unit VARCHAR(64) NOT NULL,
    scope TEXT NOT NULL,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL,
    window_end TIMESTAMP WITH TIME ZONE NOT NULL,
    comparison_role VARCHAR(16) NOT NULL CHECK (comparison_role IN ('baseline', 'current')),
    controlled_data BOOLEAN NOT NULL,
    captured_at TIMESTAMP WITH TIME ZONE NOT NULL,
    CHECK ((availability = 'observed_zero' AND value = 0) OR (availability = 'observed_value' AND value IS NOT NULL) OR (availability NOT IN ('observed_zero', 'observed_value') AND value IS NULL))
);

CREATE TABLE IF NOT EXISTS basic_reviews (
    review_id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) NOT NULL REFERENCES projects(project_id),
    approval_id VARCHAR(64) NOT NULL REFERENCES execution_approvals(approval_id),
    strategy_version INTEGER NOT NULL,
    primary_goal_snapshot TEXT NOT NULL,
    primary_metric_key VARCHAR(128) NOT NULL,
    outcome VARCHAR(32) NOT NULL,
    facts JSONB NOT NULL,
    limitations JSONB NOT NULL,
    source_changed BOOLEAN NOT NULL,
    controlled_data BOOLEAN NOT NULL,
    ai_analysis TEXT NOT NULL,
    confirmed_by VARCHAR(64),
    next_action VARCHAR(32),
    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
    confirmed_at TIMESTAMP WITH TIME ZONE
);

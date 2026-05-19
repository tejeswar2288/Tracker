-- ================================================================
--  WWW TASK TRACKER — Complete PostgreSQL Schema
--  Includes: Core tables + Role normalization + Views + Triggers
--  Run in pgAdmin Query Tool (F5)
-- ================================================================


-- ============================================================
-- STEP 1: ENUM TYPES
-- ============================================================

CREATE TYPE user_role     AS ENUM ('admin', 'manager', 'doer');
CREATE TYPE task_status   AS ENUM ('pending','inprogress','review','deferred','blocked','done');
CREATE TYPE task_priority AS ENUM ('high', 'medium', 'low');


-- ============================================================
-- STEP 2: CORE TABLES
-- ============================================================

-- 2.1 Users — Identity only. Role is derived from role subset tables.
CREATE TABLE users (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name          VARCHAR(150) NOT NULL,
    email         VARCHAR(255) UNIQUE,
    password_hash VARCHAR(255),
    role          user_role    NOT NULL DEFAULT 'doer',   -- kept for backward compat
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at    TIMESTAMPTZ,
    CONSTRAINT uq_users_name UNIQUE (name)
);
COMMENT ON TABLE users IS '1NF: All attributes atomic. Each user appears exactly once.';

-- 2.2 Projects
CREATE TABLE projects (
    id          UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name        VARCHAR(255) NOT NULL,
    description TEXT,
    color_index INTEGER      NOT NULL DEFAULT 0,
    created_by  UUID         REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    deleted_at  TIMESTAMPTZ
);
COMMENT ON TABLE projects IS '2NF: name and description depend only on id (PK).';

-- 2.3 Tasks
CREATE TABLE tasks (
    id             UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id     UUID          NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    activity       VARCHAR(500)  NOT NULL,
    action_steps   TEXT,
    priority       task_priority NOT NULL DEFAULT 'medium',
    status         task_status   NOT NULL DEFAULT 'pending',
    deadline       DATE,
    support_needed TEXT,
    created_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    deleted_at     TIMESTAMPTZ
);
COMMENT ON TABLE tasks IS '3NF: No transitive dependencies. project_id is FK to projects.';


-- ============================================================
-- STEP 3: JUNCTION TABLES
-- ============================================================

-- 3.1 Project Managers — which user manages which project
CREATE TABLE project_managers (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID        NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users(id)    ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_project_manager UNIQUE (project_id, user_id)
);
COMMENT ON TABLE project_managers IS 'Junction: M-to-M between projects and manager users.';

-- 3.2 Task Assignees — which user is assigned to which task (doer)
CREATE TABLE task_assignees (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID        NOT NULL REFERENCES tasks(id)  ON DELETE CASCADE,
    user_id    UUID        NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_task_assignee UNIQUE (task_id, user_id)
);
COMMENT ON TABLE task_assignees IS 'Junction: M-to-M between tasks and doer users.';


-- ============================================================
-- STEP 4: ROLE SUBSET TABLES (Normalization)
-- ============================================================

-- 4.1 Admins — subset of users with admin privileges
CREATE TABLE admins (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_admins_user UNIQUE (user_id)
);
COMMENT ON TABLE admins IS 'Subset table: each admin user appears exactly once.';

-- 4.2 User Managers — auto-populated when a user creates a project
CREATE TABLE user_managers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_by UUID        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_user_managers_user UNIQUE (user_id)
);
COMMENT ON TABLE user_managers IS 'Subset table: populated by trigger when user creates a project.';

-- 4.3 User Doers — auto-populated when a user is assigned to a task
CREATE TABLE user_doers (
    id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_doers_user UNIQUE (user_id)
);
COMMENT ON TABLE user_doers IS 'Subset table: populated by trigger when user is assigned a task.';


-- ============================================================
-- STEP 5: AUDIT / HISTORY TABLES
-- ============================================================

-- 5.1 Task History — status and priority change log
CREATE TABLE task_history (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id     UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    field       VARCHAR(50) NOT NULL,   -- 'status' or 'priority' or 'deadline'
    old_value   VARCHAR(100),
    new_value   VARCHAR(100),
    reason      TEXT,
    changed_by  UUID        REFERENCES users(id) ON DELETE SET NULL,
    changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE task_history IS 'Audit log for task field changes.';

-- 5.2 Comments — threaded comments on tasks
CREATE TABLE comments (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    task_id    UUID        NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    author_id  UUID        REFERENCES users(id) ON DELETE SET NULL,
    body       TEXT        NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE comments IS 'Comments attached to tasks.';


-- 5.3 Role Capabilities -- editable RBAC permissions used by the app
CREATE TABLE role_capabilities (
    role              user_role PRIMARY KEY,
    view_all_projects BOOLEAN   NOT NULL DEFAULT false,
    create_projects   BOOLEAN   NOT NULL DEFAULT false,
    edit_own_projects BOOLEAN   NOT NULL DEFAULT false,
    view_own_projects BOOLEAN   NOT NULL DEFAULT false,
    assign_tasks      BOOLEAN   NOT NULL DEFAULT false,
    add_comments      BOOLEAN   NOT NULL DEFAULT false,
    delete_projects   BOOLEAN   NOT NULL DEFAULT false,
    delete_tasks      BOOLEAN   NOT NULL DEFAULT false
);
COMMENT ON TABLE role_capabilities IS 'Editable role-based permissions for admin, manager, and doer users.';

INSERT INTO role_capabilities (
    role,
    view_all_projects,
    create_projects,
    edit_own_projects,
    view_own_projects,
    assign_tasks,
    add_comments,
    delete_projects,
    delete_tasks
) VALUES
('admin',   true,  true,  true,  true,  true,  true, true,  true),
('manager', false, true,  true,  true,  true,  true, false, false),
('doer',    false, false, false, false, false, true, false, false);


-- ============================================================
-- STEP 6: TRIGGERS
-- ============================================================

-- 6.1 When a project is created → register creator as manager
CREATE OR REPLACE FUNCTION fn_register_manager_on_project_create()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.created_by IS NOT NULL THEN
        -- Add to user_managers subset table
        INSERT INTO user_managers (user_id)
        VALUES (NEW.created_by)
        ON CONFLICT (user_id) DO NOTHING;

        -- Sync users.role column for backward compatibility
        UPDATE users SET role = 'manager', updated_at = NOW()
        WHERE id = NEW.created_by AND role = 'doer';

        -- Add to project_managers junction table
        INSERT INTO project_managers (project_id, user_id)
        VALUES (NEW.id, NEW.created_by)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_register_manager_on_project_create
    AFTER INSERT ON projects
    FOR EACH ROW EXECUTE FUNCTION fn_register_manager_on_project_create();

-- 6.2 When a task assignee is added → register user as doer
-- 6.2 When a user is assigned as project manager -> register user as manager
CREATE OR REPLACE FUNCTION fn_register_manager_on_project_manager_assign()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO user_managers (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;

    UPDATE users SET role = 'manager', updated_at = NOW()
    WHERE id = NEW.user_id AND role = 'doer';

    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_register_manager_on_project_manager_assign
    AFTER INSERT ON project_managers
    FOR EACH ROW EXECUTE FUNCTION fn_register_manager_on_project_manager_assign();

-- 6.3 When a task assignee is added -> register user as doer
CREATE OR REPLACE FUNCTION fn_register_doer_on_task_assign()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    INSERT INTO user_doers (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_register_doer_on_task_assign
    AFTER INSERT ON task_assignees
    FOR EACH ROW EXECUTE FUNCTION fn_register_doer_on_task_assign();


-- ============================================================
-- STEP 7: VIEWS
-- ============================================================

-- 7.1 Person Activity View — one row per project managed or task assigned
CREATE OR REPLACE VIEW vw_person_activity AS

SELECT
    u.name                  AS user_name,
    'PM'                    AS role_name,
    p.name                  AS project_name,
    'Manages this project'  AS task_name,
    'Active'                AS status,
    NULL::DATE              AS deadline,
    NULL::task_priority     AS priority
FROM project_managers pm
JOIN users    u ON u.id = pm.user_id
JOIN projects p ON p.id = pm.project_id
WHERE p.deleted_at IS NULL

UNION ALL

SELECT
    u.name          AS user_name,
    'Doer'          AS role_name,
    p.name          AS project_name,
    t.activity      AS task_name,
    t.status::TEXT  AS status,
    t.deadline,
    t.priority
FROM task_assignees ta
JOIN users    u ON u.id  = ta.user_id
JOIN tasks    t ON t.id  = ta.task_id
JOIN projects p ON p.id  = t.project_id
WHERE t.deleted_at IS NULL

ORDER BY user_name, role_name DESC, project_name, deadline NULLS LAST;

-- 7.2 Person Profile Summary View
CREATE OR REPLACE VIEW vw_person_profile AS
SELECT
    u.name AS person_name,
    CASE WHEN a.user_id IS NOT NULL THEN 'Admin'           ELSE NULL END AS admin_role,
    CASE WHEN m.user_id IS NOT NULL THEN 'Project Manager' ELSE NULL END AS manager_role,
    CASE WHEN d.user_id IS NOT NULL THEN 'Task Doer'       ELSE NULL END AS doer_role,
    (
        SELECT STRING_AGG(p.name, ' | ' ORDER BY p.name)
        FROM project_managers pm JOIN projects p ON p.id = pm.project_id
        WHERE pm.user_id = u.id
    ) AS manages_projects,
    (SELECT COUNT(*) FROM project_managers pm WHERE pm.user_id = u.id)            AS projects_managed,
    (SELECT COUNT(*) FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
     WHERE ta.user_id = u.id AND t.deleted_at IS NULL)                            AS total_tasks,
    (SELECT COUNT(*) FROM task_assignees ta JOIN tasks t ON t.id = ta.task_id
     WHERE ta.user_id = u.id AND t.status = 'done' AND t.deleted_at IS NULL)      AS completed_tasks
FROM users u
LEFT JOIN admins        a ON a.user_id = u.id
LEFT JOIN user_managers m ON m.user_id = u.id
LEFT JOIN user_doers    d ON d.user_id = u.id
WHERE u.deleted_at IS NULL;


-- ============================================================
-- STEP 8: VERIFY
-- ============================================================

SELECT tablename FROM pg_tables   WHERE schemaname = 'public' ORDER BY tablename;
SELECT viewname  FROM pg_views    WHERE schemaname = 'public' ORDER BY viewname;
SELECT tgname    FROM pg_trigger  WHERE tgname LIKE 'trg_%'   ORDER BY tgname;

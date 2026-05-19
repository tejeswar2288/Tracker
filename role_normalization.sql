-- ================================================================
--  ROLE NORMALIZATION MIGRATION
--  Run in pgAdmin Query Tool (F5)
--  Adds separate role tables following 1NF, 2NF, 3NF
-- ================================================================

-- ----------------------------------------------------------------
-- STEP 1: CREATE ROLE SUBSET TABLES
-- ----------------------------------------------------------------

-- Admins table (1NF: atomic, 2NF: no partial deps, 3NF: no transitive deps)
CREATE TABLE IF NOT EXISTS admins (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by UUID        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_admins_user UNIQUE (user_id)
);
COMMENT ON TABLE admins IS 'Subset of users with admin privileges. Each user appears at most once.';

-- Managers table (tracks who is a project manager, separate from WHICH project)
CREATE TABLE IF NOT EXISTS user_managers (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    promoted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    promoted_by UUID        REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT uq_user_managers_user UNIQUE (user_id)
);
COMMENT ON TABLE user_managers IS 'Subset of users who manage at least one project. Populated by trigger when a project is created.';

-- Doers table (tracks who is assigned to tasks)
CREATE TABLE IF NOT EXISTS user_doers (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    first_assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_user_doers_user UNIQUE (user_id)
);
COMMENT ON TABLE user_doers IS 'Subset of users who are assigned to at least one task. Populated by trigger when task_assignees row is inserted.';

-- ----------------------------------------------------------------
-- STEP 2: MIGRATE EXISTING DATA
-- ----------------------------------------------------------------

-- Populate admins from existing role column
INSERT INTO admins (user_id)
SELECT id FROM users
WHERE role = 'admin' AND deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- Populate user_managers from project_managers junction table
INSERT INTO user_managers (user_id)
SELECT DISTINCT user_id FROM project_managers
ON CONFLICT (user_id) DO NOTHING;

-- Also add any user whose role column is already 'manager'
INSERT INTO user_managers (user_id)
SELECT id FROM users
WHERE role = 'manager' AND deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- Populate user_doers from task_assignees junction table
INSERT INTO user_doers (user_id)
SELECT DISTINCT user_id FROM task_assignees
ON CONFLICT (user_id) DO NOTHING;

-- Also add all existing 'doer' role users
INSERT INTO user_doers (user_id)
SELECT id FROM users
WHERE deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- ----------------------------------------------------------------
-- STEP 3: TRIGGER — Register manager when project is created
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_register_manager_on_project_create()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.created_by IS NOT NULL THEN
        -- Add to user_managers subset table
        INSERT INTO user_managers (user_id)
        VALUES (NEW.created_by)
        ON CONFLICT (user_id) DO NOTHING;

        -- Keep users.role in sync for backward compatibility
        UPDATE users
        SET role = 'manager', updated_at = NOW()
        WHERE id = NEW.created_by AND role = 'doer';

        -- Add to project_managers junction table
        INSERT INTO project_managers (project_id, user_id)
        VALUES (NEW.id, NEW.created_by)
        ON CONFLICT DO NOTHING;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_register_manager_on_project_create ON projects;
CREATE TRIGGER trg_register_manager_on_project_create
    AFTER INSERT ON projects
    FOR EACH ROW EXECUTE FUNCTION fn_register_manager_on_project_create();

-- ----------------------------------------------------------------
-- STEP 4: TRIGGER — Register doer when task is assigned
-- ----------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_register_doer_on_task_assign()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Add to user_doers subset table
    INSERT INTO user_doers (user_id)
    VALUES (NEW.user_id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_register_doer_on_task_assign ON task_assignees;
CREATE TRIGGER trg_register_doer_on_task_assign
    AFTER INSERT ON task_assignees
    FOR EACH ROW EXECUTE FUNCTION fn_register_doer_on_task_assign();

-- ----------------------------------------------------------------
-- STEP 5: VERIFY — Check the results
-- ----------------------------------------------------------------

SELECT 'admins'        AS table_name, COUNT(*) AS rows FROM admins
UNION ALL
SELECT 'user_managers' AS table_name, COUNT(*) AS rows FROM user_managers
UNION ALL
SELECT 'user_doers'    AS table_name, COUNT(*) AS rows FROM user_doers;

-- Show users with BOTH manager and doer roles (the dual-role users)
SELECT
    u.name,
    CASE WHEN a.user_id IS NOT NULL THEN 'YES' ELSE 'NO' END AS is_admin,
    CASE WHEN m.user_id IS NOT NULL THEN 'YES' ELSE 'NO' END AS is_manager,
    CASE WHEN d.user_id IS NOT NULL THEN 'YES' ELSE 'NO' END AS is_doer
FROM users u
LEFT JOIN admins       a ON a.user_id = u.id
LEFT JOIN user_managers m ON m.user_id = u.id
LEFT JOIN user_doers    d ON d.user_id = u.id
WHERE u.deleted_at IS NULL
ORDER BY
    CASE WHEN a.user_id IS NOT NULL THEN 0
         WHEN m.user_id IS NOT NULL THEN 1
         ELSE 2 END,
    u.name;

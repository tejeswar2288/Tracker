-- ================================================================
--  PERSON FULL ACTIVITY PROFILE
--  Replace 'Samantha' with any name to query that person
-- ================================================================

SELECT
    -- Identity
    u.name                                      AS person_name,

    -- Roles (both if applicable)
    CASE
        WHEN a.user_id IS NOT NULL THEN 'Admin'
        ELSE NULL
    END                                         AS admin_role,

    CASE
        WHEN m.user_id IS NOT NULL THEN 'Project Manager'
        ELSE NULL
    END                                         AS manager_role,

    CASE
        WHEN d.user_id IS NOT NULL THEN 'Task Doer'
        ELSE NULL
    END                                         AS doer_role,

    -- Projects this person manages
    (
        SELECT STRING_AGG(p.name, ' | ' ORDER BY p.name)
        FROM project_managers pm
        JOIN projects p ON p.id = pm.project_id
        WHERE pm.user_id = u.id
    )                                           AS manages_projects,

    -- Tasks assigned to this person (as doer)
    (
        SELECT STRING_AGG(
            t.activity || ' [' || p2.name || '] (' || t.status || ')',
            ' | ' ORDER BY t.deadline NULLS LAST
        )
        FROM task_assignees ta
        JOIN tasks    t  ON t.id  = ta.task_id
        JOIN projects p2 ON p2.id = t.project_id
        WHERE ta.user_id = u.id AND t.deleted_at IS NULL
    )                                           AS assigned_tasks,

    -- Count summary
    (
        SELECT COUNT(*) FROM project_managers pm WHERE pm.user_id = u.id
    )                                           AS projects_managed_count,

    (
        SELECT COUNT(*) FROM task_assignees ta
        JOIN tasks t ON t.id = ta.task_id
        WHERE ta.user_id = u.id AND t.deleted_at IS NULL
    )                                           AS tasks_assigned_count,

    (
        SELECT COUNT(*) FROM task_assignees ta
        JOIN tasks t ON t.id = ta.task_id
        WHERE ta.user_id = u.id AND t.status = 'done' AND t.deleted_at IS NULL
    )                                           AS tasks_completed_count

FROM users u
LEFT JOIN admins        a ON a.user_id = u.id
LEFT JOIN user_managers m ON m.user_id = u.id
LEFT JOIN user_doers    d ON d.user_id = u.id

WHERE u.name = 'Samantha'   -- Change this name
  AND u.deleted_at IS NULL;

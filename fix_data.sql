-- ================================================================
--  DATA FIX SCRIPT — Correct project managers & task assignees
--  Based on original seedIfEmpty() data from plant_task_tracker.html
--  Run in pgAdmin Query Tool (F5)
-- ================================================================

DO $$
DECLARE
    p1 UUID;  -- Plant Operations — MOM Jaipur
    p2 UUID;  -- HORECA Impact Center
BEGIN

-- ────────────────────────────────────────────────────────────────
-- STEP 1: Fix Project Managers
-- ────────────────────────────────────────────────────────────────

SELECT id INTO p1 FROM projects WHERE name = 'Plant Operations — MOM Jaipur' AND deleted_at IS NULL LIMIT 1;
SELECT id INTO p2 FROM projects WHERE name = 'HORECA Impact Center' AND deleted_at IS NULL LIMIT 1;

IF p1 IS NULL THEN RAISE EXCEPTION 'Project "Plant Operations — MOM Jaipur" not found'; END IF;
IF p2 IS NULL THEN RAISE EXCEPTION 'Project "HORECA Impact Center" not found'; END IF;

-- Clear wrong managers (Admin only) and set correct ones
DELETE FROM project_managers WHERE project_id = p1;
DELETE FROM project_managers WHERE project_id = p2;

INSERT INTO project_managers (project_id, user_id)
SELECT p1, id FROM users WHERE name IN ('RG','Mainak Pal','MV Narayanamurthy') AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

INSERT INTO project_managers (project_id, user_id)
SELECT p2, id FROM users WHERE name IN ('Samantha','Vikas','Hemant') AND deleted_at IS NULL
ON CONFLICT DO NOTHING;

RAISE NOTICE 'Project managers fixed';

-- ────────────────────────────────────────────────────────────────
-- STEP 2: Populate task_assignees for Plant Operations tasks
-- ────────────────────────────────────────────────────────────────

-- Each row: task activity name → assignee names
WITH assignments(act, who) AS (VALUES
  ('Strengthen Safety Practices',                        ARRAY['RG','PPJ','KS','SC']),
  ('Sharing Safety Incident Reports',                    ARRAY['RG']),
  ('Safety CAPA Sharing Across Units',                   ARRAY['RG']),
  ('Chemical Consumption Benchmarking',                  ARRAY['Disha Kanodia','MCG']),
  ('Standardisation of Yield Calculation',               ARRAY['Disha Kanodia']),
  ('FFA % Increase in Palm & Soya',                      ARRAY['MCG','SD']),
  ('Spent Acid Oil for Acid Oil Generation',             ARRAY['RM','NR','MCG']),
  ('Giveaway Loss Benchmarking — Packing',               ARRAY['SM']),
  ('Lab Testing Equipment Automation',                   ARRAY['SD','SM','MCG','AS']),
  ('BOPP Tape & Label Roll Diameter Maximisation',       ARRAY['Disha Kanodia','SM','SSB','KD']),
  ('Standardisation of Capacity Utilisation',            ARRAY['Disha Kanodia','SM','MCG','AS']),
  ('Standardisation of Packing Line Parameters',         ARRAY['Disha Kanodia','SM','SSB']),
  ('FRP Fan Replacement (Aluminium to FRP)',             ARRAY['RM','SVS','NR']),
  ('Steam Trap & Steam Leakage',                         ARRAY['DG','NR']),
  ('Standardisation Across Factories (HR/SCM/Finance/QC)', ARRAY['SC','AS','PG','KS','AKS']),
  ('Skilled Manpower Recruitment',                       ARRAY['SC','KB']),
  ('Chemical Benchmarking — KP',                        ARRAY['Laxminarayana']),
  ('Standardisation of Neutralisation Parameter',        ARRAY['RKV']),
  ('Standardisation of Capacity Utilisation — KP',      ARRAY['MV Narayanamurthy']),
  ('Lab Testing Automation — KP',                        ARRAY['Mainak Pal','MV Narayanamurthy']),
  ('Packing WH Roofsheet Replacement — KP',             ARRAY['MV Narayanamurthy']),
  ('ZLD Plant Implementation — KP',                     ARRAY['MV Narayanamurthy']),
  ('Safety CAPA Sharing — Kandla',                      ARRAY['Mainak Pal']),
  ('Chemical Benchmarking — Kandla',                    ARRAY['Niraj Mishra']),
  ('Lab Testing Automation — Kandla',                   ARRAY['Mainak Pal','Niraj Mishra']),
  ('KPI Circulation for 2nd Layer — Kandla',            ARRAY['All Functional Heads']),
  ('Giveaway Loss Benchmarking — Jaipur',               ARRAY['SSB']),
  ('Lab Testing Automation — Jaipur',                   ARRAY['SSB','QA In-charge']),
  ('Manpower Deputation to Jaipur',                     ARRAY['All Unit Heads']),
  ('Camera Installation at Sampling Area',              ARRAY['Mahendra Tiwari']),
  ('Kolhu Automation Steps',                             ARRAY['Mahendra Tiwari']),
  ('Rotating Table for Spice Packing',                  ARRAY['SSB'])
)
INSERT INTO task_assignees (task_id, user_id)
SELECT t.id, u.id
FROM assignments a
JOIN tasks t ON t.activity = a.act AND t.project_id = p1 AND t.deleted_at IS NULL
JOIN users u ON u.name = ANY(a.who) AND u.deleted_at IS NULL
ON CONFLICT DO NOTHING;

RAISE NOTICE 'Plant Operations task assignees populated';

-- ────────────────────────────────────────────────────────────────
-- STEP 3: Populate task_assignees for HORECA tasks
-- ────────────────────────────────────────────────────────────────

WITH assignments(act, who) AS (VALUES
  ('Channel Connect — Data Capabilities',                ARRAY['Samantha','Palash']),
  ('Account Mapping by Food Category',                   ARRAY['Hemant','Palash']),
  ('Quarterly Target & Financial Reporting',             ARRAY['Samantha']),
  ('Selection & Appointment of 45 DBs',                 ARRAY['Samantha','Hemant','Palash']),
  ('Terms & Conditions / SOPs — Pricing & Quality',     ARRAY['Vikas','Samantha','Saurabh']),
  ('Current Buyers SOB — Cross-sell & Upsell',          ARRAY['Shubhi','Palash']),
  ('NPD Roadmap Tracker',                               ARRAY['Jayantji','Vikas']),
  ('Connect Samantha with Key Institutional Accounts',  ARRAY['Adityaji','Jayantji'])
)
INSERT INTO task_assignees (task_id, user_id)
SELECT t.id, u.id
FROM assignments a
JOIN tasks t ON t.activity = a.act AND t.project_id = p2 AND t.deleted_at IS NULL
JOIN users u ON u.name = ANY(a.who) AND u.deleted_at IS NULL
ON CONFLICT DO NOTHING;

RAISE NOTICE 'HORECA task assignees populated';

-- ────────────────────────────────────────────────────────────────
-- STEP 4: Backfill role tables from actual data
-- ────────────────────────────────────────────────────────────────

-- Managers: everyone in project_managers
INSERT INTO user_managers (user_id)
SELECT DISTINCT user_id FROM project_managers
ON CONFLICT (user_id) DO NOTHING;

-- Doers: everyone assigned to a task
INSERT INTO user_doers (user_id)
SELECT DISTINCT user_id FROM task_assignees
ON CONFLICT (user_id) DO NOTHING;

-- Admins table
INSERT INTO admins (user_id)
SELECT id FROM users WHERE role = 'admin' AND deleted_at IS NULL
ON CONFLICT (user_id) DO NOTHING;

-- Fix users.role column for managers
UPDATE users SET role = 'manager', updated_at = NOW()
WHERE id IN (SELECT DISTINCT user_id FROM project_managers)
AND role = 'doer';

RAISE NOTICE 'Role tables backfilled';

END $$;

-- ────────────────────────────────────────────────────────────────
-- VERIFY
-- ────────────────────────────────────────────────────────────────

-- Project managers
SELECT u.name, p.name AS project
FROM project_managers pm
JOIN users u ON u.id = pm.user_id
JOIN projects p ON p.id = pm.project_id
ORDER BY p.name, u.name;

-- Task assignee counts per project
SELECT p.name AS project, COUNT(DISTINCT ta.task_id) AS tasks_with_assignees,
       COUNT(ta.id) AS total_assignee_rows
FROM task_assignees ta
JOIN tasks t ON t.id = ta.task_id
JOIN projects p ON p.id = t.project_id
GROUP BY p.name;

-- Role table counts
SELECT 'user_managers' AS tbl, COUNT(*) FROM user_managers
UNION ALL SELECT 'user_doers', COUNT(*) FROM user_doers
UNION ALL SELECT 'admins', COUNT(*) FROM admins;

-- User roles
SELECT name, role FROM users WHERE deleted_at IS NULL ORDER BY role, name;

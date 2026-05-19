# WWW Task Tracker — Complete Functional Analysis v2 (Updated)

> **Purpose**: This document dissects every feature, entity, relationship, and business rule — including **three new requirements** — so you can design a robust, normalized database schema.

> **What changed from v1:**
> 1. **Outlook SSO Login** — replaces the name-dropdown; users authenticate via Microsoft/Outlook identity
> 2. **Login Audit Table** — tracks who logged in, how many times, and when
> 3. **Project Priority** — a numeric priority column (values: `1`, `2`, `3`) added to Projects

---

## 1. Application Overview

**Name**: WWW Task Tracker ("Who does What by When")

**Core Purpose**: A project-and-task management tool that tracks action items arising from meetings (MOMs). It answers three questions for every action item:
- **Who** is responsible (SPOC)?
- **What** needs to be done (action steps)?
- **When** is the deadline?

**Architecture in Prototype**: Single-page HTML app using `localStorage`. The production system will use a relational database (PostgreSQL) with a backend API and Microsoft Outlook SSO for authentication.

---

## 2. Core Entities

### 2.1 Users (NEW — Replaces free-text names)

The prototype has **no Users table** — people are just name strings. In production, every person must be a registered user authenticated via **Outlook SSO (Microsoft Entra ID / Azure AD)**.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID / SERIAL | Yes | Internal primary key |
| `microsoft_id` | String (unique) | Yes | Microsoft/Azure AD object ID (from SSO token) |
| `email` | String (unique) | Yes | Outlook email address |
| `display_name` | String | Yes | Full name from Microsoft profile |
| `avatar_url` | String | No | Profile picture URL from Microsoft Graph |
| `role` | Enum | Yes | `admin`, `manager`, or `doer` (default: `doer`) |
| `is_active` | Boolean | Yes | Soft-disable account without deleting (default: `true`) |
| `created_at` | Timestamp | Auto | When the user record was first created |
| `updated_at` | Timestamp | Auto | Last profile update |

**Key behaviors:**
- User records are **auto-created on first SSO login** (just-in-time provisioning)
- `microsoft_id` and `email` come from the OAuth2/OIDC token claims
- Role defaults to `doer`; an Admin must promote users to `manager` or `admin`
- Role is now **stored**, not computed (unlike the prototype which derives it dynamically)
- A user can still be assigned as a manager on specific projects via the `project_managers` junction table
- `is_active = false` blocks login without deleting history

---

### 2.2 Login Audit Log (NEW)

Every successful SSO login creates a record in this table. This answers: **who logged in, how many times, and when.**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID / SERIAL | Yes | Primary key |
| `user_id` | FK to Users | Yes | Who logged in |
| `login_at` | Timestamp | Yes | Exact date-time of the login event |
| `ip_address` | String | No | Client IP address at login |
| `user_agent` | String | No | Browser/device user-agent string |
| `session_duration_mins` | Integer | No | Duration of session (populated on logout/timeout) |
| `logout_at` | Timestamp | No | When the session ended (null if still active) |

**Key behaviors:**
- A new row is **inserted on every login** — never updated or deleted
- `login_at` is set server-side (not client-provided) for accuracy
- To find **how many times** a user has logged in: `SELECT COUNT(*) FROM login_audit WHERE user_id = ?`
- To find **when** they last logged in: `SELECT MAX(login_at) FROM login_audit WHERE user_id = ?`
- `session_duration_mins` and `logout_at` are updated when the user explicitly logs out or the session expires
- This table grows append-only — consider partitioning or archiving after a retention period

**Derived / queryable metrics from this table:**

| Metric | Query Pattern |
|--------|---------------|
| Total logins by user | `COUNT(*) GROUP BY user_id` |
| Last login time | `MAX(login_at) WHERE user_id = ?` |
| Active sessions | `WHERE logout_at IS NULL AND login_at > NOW() - INTERVAL '24h'` |
| Login frequency | `COUNT(*) WHERE login_at BETWEEN ? AND ? GROUP BY user_id` |
| Users who never logged in | `Users LEFT JOIN login_audit WHERE login_audit.id IS NULL` |

---

### 2.3 Projects

A **Project** is the top-level grouping container.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID / SERIAL | Yes | Unique identifier |
| `name` | String | Yes | Project name |
| `description` | String | No | Brief description of the project scope |
| `priority` | Integer (1-3) | Yes | NEW: `1` = High, `2` = Medium, `3` = Low |
| `color_index` | Integer | Auto | Index into a color palette (0-7) for UI |
| `created_by` | FK to Users | Auto | User who created the project |
| `created_at` | Timestamp | Auto | When the project was created |
| `updated_at` | Timestamp | Auto | Last modification time |

**Priority values explained (NEW):**

| Value | Label | Meaning |
|-------|-------|---------|
| `1` | High / P1 | Critical — needs immediate attention, top of dashboard |
| `2` | Medium / P2 | Standard — normal workflow priority |
| `3` | Low / P3 | Low urgency — backlog or informational |

**Key behaviors:**
- A project **must** have at least one manager (via `project_managers` junction)
- Priority defaults to `2` (Medium) if not specified
- Projects are **sorted by priority** on the dashboard — P1 first
- Only **Admin** can create or delete projects
- Admin and project managers can **edit** a project (including priority)
- Deleting a project **cascades** all child data

---

### 2.4 Project Managers (Junction Table)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `project_id` | FK to Projects | Yes | The project |
| `user_id` | FK to Users | Yes | The manager |
| `assigned_at` | Timestamp | Auto | When assigned |

**Composite PK**: `(project_id, user_id)` — Many-to-many relationship.

---

### 2.5 Tasks

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID / SERIAL | Yes | Unique identifier |
| `project_id` | FK to Projects | Yes | Parent project |
| `activity` | String | Yes | Task/activity name (the "What" headline) |
| `action_steps` | Text | No | Detailed action steps (multi-line) |
| `deadline` | Date | No | Target completion date ("When") |
| `status` | Enum | Yes | One of 6 statuses (default: `pending`) |
| `support` | String | No | Support/approvals needed |
| `created_by` | FK to Users | Auto | Who created the task |
| `created_at` | Timestamp | Auto | Creation time |
| `updated_at` | Timestamp | Auto | Last update |

**Status Enum**: `pending(0)`, `inprogress(1)`, `review(2)`, `deferred(3)`, `blocked(4)`, `done(5)`

---

### 2.6 Task Assignees (Junction Table)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `task_id` | FK to Tasks | Yes | The task |
| `user_id` | FK to Users | Yes | The assigned person (SPOC) |
| `assigned_at` | Timestamp | Auto | When assigned |

**Composite PK**: `(task_id, user_id)` — A task can have multiple SPOCs.

---

### 2.7 Comments

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID / SERIAL | Yes | Primary key |
| `task_id` | FK to Tasks | Yes | Which task |
| `user_id` | FK to Users | Yes | Who wrote it |
| `content` | Text | Yes | Comment text |
| `created_at` | Timestamp | Auto | When posted |
| `updated_at` | Timestamp | Auto | Last edit |

Upgraded from single overwritten string to **threaded comments**.

---

### 2.8 Status History / Audit Log

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID / SERIAL | Yes | Primary key |
| `task_id` | FK to Tasks | Yes | Which task changed |
| `changed_by` | FK to Users | Yes | Who made the change |
| `from_status` | Enum | Yes | Previous status |
| `to_status` | Enum | Yes | New status |
| `new_deadline` | Date | No | New deadline (if changed) |
| `reason` | Text | No | Reason for the change |
| `changed_at` | Timestamp | Auto | When it happened |

**Append-only** — never edited or deleted.

---

### 2.9 Notifications (NEW)

In-app notifications (bell icon with unread count). A notification is generated automatically by the backend when certain events occur.

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | UUID / SERIAL | Yes | Primary key |
| `user_id` | FK to Users | Yes | Who receives this notification |
| `type` | Enum | Yes | Event type (see table below) |
| `title` | String | Yes | Short display text (e.g. "You were assigned a new task") |
| `message` | Text | No | Optional longer description |
| `reference_type` | String | No | Entity type: `task`, `project`, or `comment` |
| `reference_id` | UUID | No | ID of the related task/project/comment (for linking) |
| `is_read` | Boolean | Yes | Read/unread state (default: `false`) |
| `created_at` | Timestamp | Auto | When the notification was generated |

**Notification type enum values:**

| Type | Triggered When | Sent To |
|------|---------------|--------|
| `task_assigned` | A task is assigned to a user | The assigned user(s) |
| `task_unassigned` | A user is removed from a task | The removed user |
| `status_changed` | Task status is changed | All assignees of that task + project managers |
| `comment_added` | A new comment is posted on a task | All assignees of that task |
| `deadline_approaching` | Task deadline is within 3 days | All assignees of that task |
| `deadline_overdue` | Task deadline has passed | All assignees + project managers |
| `project_created` | A new project is created | The assigned managers |
| `priority_changed` | Project priority is changed | All managers of that project |

**Key behaviors:**
- Notifications are **created by the backend** — not by the user
- Users can **mark as read** (single or bulk "mark all read")
- Notifications are **never deleted** — only marked as read
- The UI shows a bell icon with unread count in the header
- Clicking a notification navigates to the relevant task/project

---

## 3. Authentication Flow (NEW — Outlook SSO)

**SSO Sequence:**
1. User clicks "Sign in with Outlook"
2. App backend redirects to Microsoft OAuth2 /authorize
3. Microsoft shows login page (email + password + MFA)
4. User authenticates with Microsoft
5. Microsoft sends authorization code callback to app
6. App exchanges code for tokens (POST /token)
7. App receives ID token + Access token (claims: oid, email, name)
8. App upserts user in Users table (microsoft_id, email, display_name)
9. App inserts row into login_audit (user_id, login_at, ip_address, user_agent)
10. App sets session cookie/JWT and redirects to dashboard

**Key rules:**
- No password stored locally — all auth delegated to Microsoft
- First login auto-creates user with `role = doer`
- Admin must promote users to higher roles
- Every login writes to `login_audit`
- Logout updates `logout_at` and `session_duration_mins`

---

## 4. Role and Permission Model

### 4.1 Roles are now STORED (not computed)

| Role | How Assigned |
|------|-------------|
| `admin` | Set manually by another admin |
| `manager` | Set in Users table + added to `project_managers` |
| `doer` | Default for all new users |

### 4.2 Permission Matrix

| Action | Admin | Manager (own) | Manager (other) | Doer |
|--------|-------|---------------|-----------------|------|
| View all projects | Yes | No (only own) | No | No |
| Create project | Yes | No | No | No |
| Edit project + priority | Yes | Yes | No | No |
| Delete project | Yes | No | No | No |
| Create tasks | Yes | Yes (own) | No | No |
| Edit tasks | Yes | Yes (own) | No | No |
| Delete tasks | Yes only | No | No | No |
| Change task status | Yes | Yes (own) | No | Yes (own tasks) |
| Edit comments | Yes | Yes (own) | No | Yes (own tasks) |
| Edit deadline inline | Yes | Yes (deferred) | No | No |
| View login audit | Yes | No | No | No |
| Manage user roles | Yes | No | No | No |

---

## 5. UI Views

### 5.1 Login Screen (NEW — Outlook SSO)
- Single "Sign in with Outlook" button (replaces name-dropdown)
- Redirects to Microsoft login, returns with session
- First login: auto-creates user; return login: straight to dashboard

### 5.2 Tab Navigation
| Tab | Visible To | Default For |
|-----|-----------|-------------|
| My Tasks | Everyone | Doers |
| Manage Projects | Admin + Managers | Admin + Managers |

### 5.3 Doer View ("My Tasks")
- Tasks grouped by project, with priority badge (P1/P2/P3)
- Progress bar, stats bar, editable status + comments

### 5.4 Manager View ("Manage Projects")
- Project cards **sorted by priority (P1 first)**
- Each card shows priority badge, manager tags, progress
- Drill-down to task table with filters and sorting

### 5.5 Admin: Login Audit View (NEW)
- Table of all login events: User, Email, Login Time, IP, Session Duration
- Summary stats: Total Users, Active Today, Logins This Week

---

## 6. Workflows

### 6.1 Status Change
1. User changes status → reason modal appears
2. If deferred: new deadline field shown
3. History entry created in `status_history`
4. Task status updated and persisted

### 6.2 Deadline Classification
| Class | Condition | Visual |
|-------|-----------|--------|
| overdue | deadline < TODAY | Red |
| due-soon | 0-7 days left | Orange |
| on-track | 8-21 days left | Green |
| far-out | >21 days left | Gray |
| no-deadline | Not set | Muted |

### 6.3 Project Priority Sorting (NEW)
- Dashboard sorts P1 → P2 → P3
- Within same priority: by overdue count or creation date
- Badge colors: P1=Red, P2=Amber, P3=Green

---

## 7. Computed Metrics (not stored)

| Metric | Scope | Formula |
|--------|-------|---------|
| Total Tasks | Per project/user | `count(tasks)` |
| Overdue | Per project/user | `count(WHERE status != done AND deadline < TODAY)` |
| Due This Week | Per project/user | `count(WHERE status != done AND 0 <= daysLeft <= 7)` |
| In Progress | Per user | `count(WHERE status IN (pending, inprogress))` |
| Completed | Per project/user | `count(WHERE status = done)` |
| Progress % | Per project | `round(done/total * 100)` |
| Login Count (NEW) | Per user | `count(login_audit WHERE user_id = ?)` |
| Last Login (NEW) | Per user | `max(login_at) WHERE user_id = ?` |

---

## 8. Data Type Mapping (Prototype to Database)

| Prototype | Database |
|-----------|----------|
| `id` (base-36 string) | UUID or BIGSERIAL |
| `createdAt` (epoch ms) | `TIMESTAMP WITH TIME ZONE` |
| `status` (string) | ENUM type or lookup table |
| `deadline` (date string) | `DATE` |
| `managers` (string array) | Junction table `project_managers` |
| `who` (delimited string) | Junction table `task_assignees` |
| `history` (embedded array) | Separate `status_history` table |
| `comments` (single string) | Separate `comments` table |
| No auth | Outlook SSO + `users` table (NEW) |
| No login tracking | `login_audit` table (NEW) |
| No priority | Integer `priority` on projects (NEW) |

---

## 9. All Data Flows

| Action | Writes To | Reads From |
|--------|-----------|------------|
| SSO Login (NEW) | `users` (upsert), `login_audit` (insert) | Microsoft token |
| Logout (NEW) | `login_audit` (update) | Session |
| Create Project | `projects`, `project_managers` | — |
| Edit Project | `projects` | `projects` |
| Delete Project | cascade all child tables | `projects` |
| Create Task | `tasks`, `task_assignees` | `projects` |
| Edit Task | `tasks`, `task_assignees` | `tasks` |
| Delete Task | cascade all child tables | `tasks` |
| Change Status | `status_history` (insert), `tasks` (update), `notifications` (insert) | `tasks`, `task_assignees` |
| Save Comment | `comments` (insert), `notifications` (insert) | `tasks`, `task_assignees` |
| Inline Deadline Edit | `status_history` (insert), `tasks` (update) | `tasks` |
| Assign Task | `task_assignees` (insert), `notifications` (insert) | `tasks` |
| View Login Audit (NEW) | — | `login_audit`, `users` |
| Mark Notification Read | `notifications` (update) | `notifications` |
| Render Stats | — | `tasks` (aggregation) |

---

## 10. Summary of All Tables (9 Total)

| # | Table | Type | Row Growth | Purpose |
|---|-------|------|-----------|---------|
| 1 | `users` | Master | Slow | Identity and role store (SSO) |
| 2 | `login_audit` | Log (NEW) | Fast | Login tracking and analytics |
| 3 | `projects` | Master | Slow | Project definitions + priority |
| 4 | `project_managers` | Junction | Slow | Who manages which project |
| 5 | `tasks` | Transactional | Medium | Core action items |
| 6 | `task_assignees` | Junction | Medium | Who is assigned to which task |
| 7 | `status_history` | Log | Medium-Fast | Audit trail for status changes |
| 8 | `comments` | Transactional | Medium | Threaded comments on tasks |
| 9 | `notifications` | Transactional (NEW) | Fast | In-app notification bell + unread tracking |

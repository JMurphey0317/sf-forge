# SF Forge v7.2


## v6.0.0 — New Modules

### ⇄ Permission Lens
Inspired by SF PermLens — a full permission management suite built directly into SF Forge:

- **Permission Diff**: Compare any two Profiles or Permission Sets side-by-side across Object Permissions (CRUD/ViewAll/ModifyAll), System Permissions, Apex Class Access, and Visualforce Page Access. Color-coded differences, "diff only" filter, full-text search, and export to CSV or JSON.
- **Permission Copy**: Copy selected permission categories (Object Permissions, Apex Access, VF Access) from any source Profile/Permission Set into a destination Permission Set. Optional object name filter for targeted copies.
- **User Access Management**: Load all permission sets from a source user and bulk-assign them to multiple target users. Or search for specific permission sets and assign them directly — with real-time progress tracking and duplicate detection.

### 📋 Org Change Tracker
Inspired by SF Release Tracker — a full SetupAuditTrail viewer:

- **Type-filtered audit log**: Every setup change classified by type (Apex, Flow, Field, Object, Permission, Profile, User, Security, Other) with color-coded chips.
- **Date range**: Today, Last 7 Days, Last 30 Days, Last 90 Days, Last 180 Days.
- **Filters**: By username, free-text search across action/detail, and type chip toggles.
- **Summary bar**: Total changes, unique users, and change type count at a glance.
- **CSV Export**: Full audit trail download for compliance or release documentation.

---

> **After installing: refresh every open Salesforce tab.**

Dark Fenrir Forge — Salesforce productivity toolkit for Chrome.

## v5.0.0 — All 16 Enhancements + Bug Fix

### Bug Fix
- **Syntax error on line 931** (`copyExceptionSummary`): `text.split('\n')` was being tokenized incorrectly by some Chrome extension packagers. Fixed by using a `NL` constant (`const NL = '\n'`) defined at module scope, and referencing it throughout all split/join calls.

### Security
1. **CSP added to manifest.json** — `script-src 'self'; object-src 'self'` on all extension pages.
2. **Host permissions scoped** — `host_permissions` now uses `/services/*` paths where possible.

### UX
3. **Keyboard shortcuts** — `Ctrl+Enter` runs the active view's primary action (SOQL query, REST send, Apex execute, etc.). `Alt+1–9` switches nav tabs instantly.
4. **SOQL history + saved queries** — Last 20 queries per org stored in `chrome.storage.local`. History dropdown in Inspector. Named "Save as" for reusable queries.
5. **SOQL result column sorting** — Click any column header to sort ascending/descending. Sortable locally after query.
6. **Toast improvements** — Error toasts include a "Copy error" button. Destructive actions (org delete) show an "Undo" button for 2.8s.
7. **Org color tag in active org lock bar** — The colored left-border and dot reflect the org's color tag (red = prod, amber = sandbox, green = dev, etc.).
8. **Workspace SOQL templates** — Named queries attached to an org workspace. "Run" button navigates to Inspector and pre-fills the query.

### API / Reliability
9. **Session auto-refresh alarm** — Chrome alarm fires every 90 minutes to validate stored sessions; marks stale ones as `needsRefresh` so the next connect silently re-authenticates.
10. **API version bumped to v66.0** — `DEFAULT_API_VERSION` updated across all modules. Connect Org vault cards show and allow editing the per-org API version.
11. **Rate-limit retry** — `bridgeFetch` and `directSalesforceFetch` retry on HTTP 429/503 with exponential back-off (1s, 2s, 4s, up to 3 retries).

### New Features
12. **Metadata Studio: Edit & Save** — "Edit & Save" button opens an inline editor for Apex/Trigger source. "Save to Org" PATCHes the body via Tooling API and shows compile errors inline.
13. **Org Diff: field-level compare** — "Field-level Diff" button compares field arrays between two orgs for a specific object. Shows added, removed, and type/length-changed fields.
14. **Agentforce Inspector** — New nav section. Queries `BotDefinition`, `BotVersion`, and `BotCustomAction`/`GenAiPlugin` via Tooling API. Inspect Einstein Copilot/Agentforce agents, versions, topics, and actions.
15. **Permission Inspector: FLS grid** — "Compare FLS" button queries `FieldPermissions` for all matched permission sets and renders a Read/Edit matrix per field.

### Code Quality
16. **NL constant** — All `split('\n')` and `join('\n')` calls use `const NL = '\n'` to prevent minifier tokenization issues that caused the v4.0.3 bug.

## Install / Update

1. Go to `chrome://extensions`
2. Enable **Developer mode**
3. Remove the previous SF Forge version
4. Click **Load unpacked** → select the `sf-forge-v5` folder
5. **Refresh all open Salesforce tabs**
6. Open SF Forge → click **Detect Orgs**

## Keyboard Shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Enter` | Run active view primary action (SOQL, REST, Apex) |
| `Alt+1` | Dashboard |
| `Alt+2` | Connect Org |
| `Alt+3` | Inspector |
| `Alt+4` | REST Explorer |
| `Alt+5` | Metadata Studio |
| `Alt+6` | Debug Logs |
| `Alt+7` | Flow Analyzer |
| `Alt+8` | LWC Lens |
| `Alt+9` | Bulk Field Creator |

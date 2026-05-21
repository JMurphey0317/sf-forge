# SF Forge Changelog

All notable changes to SF Forge are documented here.

---

## v5.1.1 — 2026-05-21

### Added
- **GitHub Releases auto-update checker** — SF Forge polls your GitHub repo every 6 hours and on every browser startup. A purple banner appears when a new version is available with one-click download.
- **Update Settings panel** in Theme Engine — configure your GitHub owner/repo, trigger manual checks, and view release notes inline.
- `update-checker.js` module — isolated semver comparison, GitHub API polling, dismissal state, and repo config storage.
- `DOWNLOAD_URL` and `CHECK_FOR_UPDATES` message handlers in the service worker.

---

## v5.1.0 — 2026-05-21

### Added
- **Apex Test Runner** — run tests per-class from Metadata Studio. Per-method pass/fail/skip table with timing, stack traces, and coverage percentage via Tooling API `/runTestsSynchronous`.
- **Open in Setup** — deep-link buttons on every Metadata Studio result row for ApexClass, ApexTrigger, LWC, Flow, PermissionSet, and Profile.
- **LWC Lens: Source Peek** — fetch any LWC bundle by DeveloperName and browse its source files (JS/HTML/CSS/meta) in tabbed panels.
- **Bulk Field Creator: Lookup & Picklist config** — "Related Object", "Relationship Name", and "Picklist Values" columns. Fields enabled/disabled based on selected type. Correct `referenceTo` and `valueSet` payloads.
- **SOQL Visual Query Builder** — point-and-click query builder with object picker, field checkboxes, WHERE/ORDER/LIMIT controls. Writes built SOQL to the runner textarea.
- **SOQL Record Detail Panel** — click any result row to see a full key/value detail drawer with an "Open in Salesforce" link.
- **API Limits Dashboard** — live progress bars per org limit, colour-coded green/amber/red, 10-point sparklines, 60-second auto-refresh, CSV export.
- **Apex Job Monitor** — `AsyncApexJob` and `CronTrigger` monitor with abort controls and 30-second auto-refresh.
- **Flow Version History & Activation** — view all versions of a flow and activate any non-active version via Tooling API PATCH.
- **Trace Flag Manager** — create, view, and delete Apex debug trace flags. Creates `DebugLevel` first (correct two-step Tooling API pattern).
- **Security Health Scan** — 7-point org security checklist: guest users, password policy, Modify All Data profiles/permission sets, View All Data, API access, named credentials. Pass/warn/fail with remediation guidance.

### Navigation
- New nav entries under "Operate & Secure": API Limits, Apex Job Monitor, Trace Flag Manager, Security Health Scan.

---

## v5.0.4 — 2026-05-21

### Fixed
- **Debug Logs** — `NOT_FOUND: Body` error when viewing logs. `ApexLog` body now fetched as `text/plain` bypassing the JSON layer, using `Authorization: Bearer` for stored sessions.
- **Flow Analyzer** — `INVALID_TYPE: sObject type 'FlowDefinitionView' is not supported` fallback now uses `Flow` object with correct fields (`Definition.Label` removed — doesn't exist).
- **Bulk Field Creator** — objects now auto-load from connected org on view render. Loading indicator added. Dropdown sorted alphabetically.

---

## v5.0.3 — 2026-05-21

### Fixed
- **"Not connected" badge** — topbar badge now syncs on every `render()` call, not only inside `connect()`.
- **Metadata Studio table overflow** — columns capped at 8, `table-layout:fixed`, cell truncation at 60 chars with full-value tooltips.
- **Flow Analyzer** — `FlowDefinitionView` is Tooling-only; fallback query corrected (`Definition.Label` removed).
- **Debug Logs** — bridge now returns raw text for non-JSON `Content-Type` responses.

---

## v5.0.2 — 2026-05-21

### Fixed
- **SOAP login** — `INVALID_OPERATION: The SOAP Login operation is not available in the API version specified (66.0)`. SOAP login now uses hardcoded `v59.0`; REST/Tooling API stays on `v66.0`.

---

## v5.0.1 — 2026-05-21

### Fixed
- **`HTTP undefined` error** — session bridge now guards `res` before accessing `.status`; always returns a defined `errorLabel`.
- **Credentials not stored** — `saveStoredLoginProfile` called with correct two-argument signature (profile, options).
- **Session shown as connected when expired** — dashboard now computes `sessionValid` from `api.org.apiAvailable` separately.
- **Session Recovery panel** — new Dashboard panel with "Extract SID from Open Tab" (reads `sid` cookie) and "Paste SID Manually" paths.

---

## v5.0.0 — 2026-05-21

### Major release — 16 enhancements over v4.0.3

- CSP added to manifest (`script-src 'self'; object-src 'self'`)
- Host permissions scoped to `/services/*`
- Keyboard shortcuts (`Ctrl+Enter` run action, `Alt+1–9` nav switch)
- SOQL history (20 per org) + named saved queries
- SOQL result column sorting
- Toast "Copy error" and "Undo" buttons
- Org color tag reflected in active org lock bar
- Workspace SOQL templates with "Run in Inspector"
- Alarm-based session auto-refresh (90 min)
- API version bumped to v66.0 with per-org override
- Rate-limit retry (exponential back-off on 429/503)
- Metadata Studio: inline Edit & Save via Tooling API PATCH
- Org Diff: field-level comparison
- Agentforce Inspector (BotDefinition, BotVersion, actions)
- Permission Inspector FLS grid (FieldPermissions matrix)
- `NL` constant fixes minifier tokenization bug from v4.0.3

---

## v4.0.3 — Prior release

- Dashboard, Connect Org, Inspector, REST Explorer, Metadata Studio, Debug Logs, Flow Analyzer, LWC Lens, Bulk Field Creator, Permission Inspector, Org Diff, Deployment Assistant, Agentforce Inspector, Saved Workspace, Theme Engine.

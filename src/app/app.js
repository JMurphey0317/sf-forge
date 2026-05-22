/**
 * SF Forge App v7.0.0
 *
 * v7 NEW MODULES — Admin-focused enhancements:
 *  1. Record Edit & Data Loader  — inline field edit + bulk update from SOQL results
 *  4. Automation Health Dashboard — Flows, Scheduled Apex, Process Builders, Workflow Rules in one view
 *  5. User License & Login History — inactive user audit, license reclamation, login failure tracker
 *  9. "Who Broke It?" Quick Filter — pre-built panic-button audit trail for recent critical changes
 * 11. Field Usage Analyzer        — cross-reference a field against Flows, Apex, Validation Rules, Reports
 * 12. Sandbox Refresh Tracker     — SandboxInfo list with last refresh date and type
 *
 * v6 NEW MODULES (inspired by SF Release Tracker + SF PermLens):
 *  A. Org Change Tracker  — SetupAuditTrail viewer with type/user/date filters, diff highlighting, CSV export
 *  B. Permission Lens     — Full side-by-side permission diff (Object, FLS, System, Apex, VF, Tabs),
 *                           permission copy between perm sets, bulk user access management
 *
 * Enhancement summary (all 16 v5 recommendations remain):
 *
 * SECURITY
 *  1. Credential encryption: vault entries encrypted via AES-GCM + PBKDF2 passphrase on first save
 *  2. CSP added to manifest.json (script-src 'self'; object-src 'self')
 *  3. host_permissions scoped to /services/* in manifest.json
 *
 * UX
 *  4. Keyboard shortcuts: Ctrl+Enter = run active view action; Alt+1-9 = nav switch
 *  5. SOQL history (last 20 per org) + named saved queries + result column sort
 *  6. Toast: error detail copy button; action undo for destructive ops
 *  7. Org color tag shown as colored left-border in active org lock bar
 *  8. Workspace: per-object SOQL templates with "Run in Inspector" shortcut
 *
 * API / RELIABILITY
 *  9. Alarm-based session auto-refresh every 90 min (in service-worker.js)
 * 10. API version bumped to v66.0; per-org version override in Connect Org vault
 * 11. Rate-limit retry: exponential back-off on 429/503 in request()
 *
 * NEW FEATURES
 * 12. Metadata Studio: inline Edit & Save Apex/Trigger body via Tooling API
 * 13. Org Diff: field-level comparison with added/removed/changed field counts
 * 14. Agentforce / Einstein Copilot inspector (BotDefinition, BotVersion, BotAction)
 * 15. Permission Inspector: field-level security (FLS) grid per object
 *
 * CODE QUALITY
 * 16. app.js modularised — each view function is self-contained with lazy data
 *
 * BUG FIX
 *  - copyExceptionSummary syntax error (line 931 in v4): text.split('\n') now uses
 *    a template-literal-safe escaped newline constant — no more split-across-line
 *    tokenization issues in packed builds.
 */

import { SalesforceApi, downloadJson, toCsv, detectAndEnrichOrgs, safeLike } from './modules/salesforce-api.js';
import {
  readProfiles, updateOrgProfile, mergeOrgIntoProfiles,
  recheckSessionHealth, salesforceSoapLogin, saveStoredLoginProfile,
  readCredentialProfiles, refreshStoredLoginProfile, recheckStoredSessionHealth
} from './modules/org-manager.js';
import { getUpdateState, dismissUpdate, saveRepoConfig, getRepoConfig, checkForUpdates } from './modules/update-checker.js';

// ── Navigation definition ─────────────────────────────────────────────────────
const navItems = [
  ['dashboard',  'Dashboard',              'Org health and shortcuts'],
  ['connect',    'Connect Org',            'Production/Sandbox login vault'],
  ['inspector',  'Inspector',              'Objects, fields, SOQL'],
  ['dataloader', 'Data Loader',            'Edit records in place, bulk update from SOQL'],
  ['rest',       'REST Explorer',          'API requests'],
  ['metadata',   'Metadata Studio',        'Apex/LWC/Aura/Flows'],
  ['logs',       'Debug Logs',             'Readable debug logs'],
  ['flow',       'Flow Analyzer',          'Flow metadata breakdown'],
  ['lens',       'LWC Lens',               'Component overlay'],
  ['bulk',       'Bulk Field Creator',     'Create fields from CSV or grid'],
  ['permissions','Permission Inspector',   'Compare profile and permission set access'],
  ['permlens',   'Permission Lens',        'Diff, copy, and bulk-assign permissions (v6)'],
  ['changetracker','Org Change Tracker',   'SetupAuditTrail — who changed what and when'],
  ['whobrokeit', 'Who Broke It?',          'Panic-button audit for recent critical changes'],
  ['orgdiff',    'Org Diff',              'Compare metadata between orgs'],
  ['deploy',     'Deployment Assistant',   'Package.xml and deployment preview'],
  ['agents',     'Agentforce Inspector',   'Bots, topics, and actions'],
  ['limits',     'API Limits',              'Org limits and usage trends'],
  ['jobs',       'Apex Job Monitor',        'Scheduled and batch Apex jobs'],
  ['automation', 'Automation Health',       'Flows, scheduled jobs, workflows in one view'],
  ['traceflags', 'Trace Flag Manager',      'Set debug log trace flags'],
  ['security',   'Security Health Scan',    'Org security checklist'],
  ['userlicenses','User & License Audit',   'Inactive users, license usage, login history'],
  ['fieldusage', 'Field Usage Analyzer',   'Where is this field used? Flows, Apex, rules'],
  ['sandboxes',  'Sandbox Tracker',         'Sandbox list, refresh dates, org types'],
  ['workspace',  'Saved Workspace',        'Favorites and recent work by org'],
  ['themes',     'Theme Engine',           'Dark Fenrir theme and layout settings']
];

// ── App state ─────────────────────────────────────────────────────────────────
let api      = null;
let active   = 'dashboard';
let orgs     = [];
let profiles = { favorites: {}, aliases: {}, colorTags: {}, recent: [], activeOrgKey: null };
let themeSettings = { theme: 'dark-fenrir', accent: '#8b5cf6', density: 'comfortable', scale: 'standard' };

// Global SOQL history store (per org key)
let soqlHistory = {}; // { [orgKey]: [{name, soql}] }

const $    = s => document.querySelector(s);
const view = () => $('#view');
const NL   = '\n'; // prevent split('\n') from being tokenized across lines in minifiers

// ── Theme engine ──────────────────────────────────────────────────────────────
const THEME_PRESETS = {
  'dark-fenrir':            { label:'Dark Fenrir Default',      bg:'#061121', panel:'#0b1830', panel2:'#111f3b', text:'#f8fafc', muted:'#a7b1c5', accent:'#8b5cf6', accent2:'#a78bfa', glow:'rgba(139,92,246,.35)' },
  'cyber-blue':             { label:'Cyber Blue',               bg:'#04111f', panel:'#071f35', panel2:'#0b2b4d', text:'#eff6ff', muted:'#9cc8e8', accent:'#0ea5e9', accent2:'#38bdf8', glow:'rgba(56,189,248,.38)' },
  'ember-forge':            { label:'Ember Forge',              bg:'#170b06', panel:'#26110a', panel2:'#3a1b0f', text:'#fff7ed', muted:'#fdba74', accent:'#f97316', accent2:'#fbbf24', glow:'rgba(249,115,22,.32)' },
  'midnight-neon':          { label:'Midnight Neon',            bg:'#050816', panel:'#0d1028', panel2:'#151940', text:'#f5f3ff', muted:'#c4b5fd', accent:'#d946ef', accent2:'#22d3ee', glow:'rgba(217,70,239,.34)' },
  'salesforce-classic-dark':{ label:'Salesforce Classic Dark',  bg:'#071923', panel:'#0d2b3d', panel2:'#123d57', text:'#f0f9ff', muted:'#bae6fd', accent:'#00a1e0', accent2:'#7dd3fc', glow:'rgba(0,161,224,.30)' },
  'oled-black':             { label:'OLED Black',               bg:'#000000', panel:'#050505', panel2:'#101010', text:'#ffffff', muted:'#a3a3a3', accent:'#7c3aed', accent2:'#c084fc', glow:'rgba(124,58,237,.30)' }
};
async function loadThemeSettings() {
  const { sfForgeTheme = {} } = await chrome.storage.local.get('sfForgeTheme');
  themeSettings = { ...themeSettings, ...sfForgeTheme };
  applyTheme();
}
function applyTheme() {
  const preset = THEME_PRESETS[themeSettings.theme] || THEME_PRESETS['dark-fenrir'];
  const root   = document.documentElement;
  const accent = themeSettings.accent || preset.accent;
  root.style.setProperty('--bg',          preset.bg);
  root.style.setProperty('--panel',       preset.panel);
  root.style.setProperty('--panel2',      preset.panel2);
  root.style.setProperty('--text',        preset.text);
  root.style.setProperty('--muted',       preset.muted);
  root.style.setProperty('--purple',      accent);
  root.style.setProperty('--purple2',     preset.accent2);
  root.style.setProperty('--cyan',        preset.accent2);
  root.style.setProperty('--theme-glow',  preset.glow);
  document.body.dataset.theme   = themeSettings.theme;
  document.body.dataset.density = themeSettings.density || 'comfortable';
  document.body.dataset.scale   = themeSettings.scale   || 'standard';
}
async function saveThemeSettings(next) {
  themeSettings = { ...themeSettings, ...next };
  await chrome.storage.local.set({ sfForgeTheme: themeSettings });
  applyTheme();
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function toast(msg, duration = 2800, opts = {}) {
  const t = $('#toast');
  t.textContent = msg;
  if (opts.copyText) {
    const btn = document.createElement('button');
    btn.className = 'toast-copy-btn';
    btn.textContent = 'Copy error';
    btn.onclick = () => navigator.clipboard.writeText(opts.copyText).then(() => { btn.textContent = 'Copied!'; });
    t.appendChild(btn);
  }
  if (opts.undoFn) {
    const btn = document.createElement('button');
    btn.className = 'toast-copy-btn';
    btn.textContent = 'Undo';
    btn.onclick = () => { opts.undoFn(); t.classList.remove('show'); };
    t.appendChild(btn);
  }
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), duration);
}

function setHeader(title, help) {
  $('#pageTitle').textContent = title;
  $('#pageHelp').textContent  = help;
  renderActiveOrgLock();
}

function activeOrgLabel() {
  const o = api?.org;
  return o ? (o.alias || o.orgName || o.username || o.hostname || api.orgUrl || 'Connected org') : 'No active org';
}

// Enhancement #7: color tag reflected in active org lock bar
function renderActiveOrgLock() {
  let el = $('#activeOrgLock');
  if (!el) {
    el = document.createElement('div');
    el.id = 'activeOrgLock';
    const topbar = document.querySelector('.topbar');
    if (topbar) topbar.insertAdjacentElement('afterend', el);
  }
  const org = api?.org;
  const colorTag = org?.colorTag || 'purple';
  const colorMap = { red:'#ef4444', amber:'#f59e0b', green:'#22c55e', blue:'#3b82f6', purple:'#8b5cf6' };
  const dotColor = colorMap[colorTag] || colorMap.purple;
  el.className = `active-org-lock ${org ? 'connected' : 'disconnected'}`;
  el.style.borderLeft = org ? `3px solid ${dotColor}` : '';
  el.innerHTML = org
    ? `<span class="lock-dot" style="background:${dotColor}"></span><b>Active Org:</b> ${escapeHtml(activeOrgLabel())} <span class="muted">${escapeHtml(org.type || '')} • all tools target this org only</span>`
    : `<span class="lock-dot"></span><b>No active org selected.</b> Use Connect Org or Use Org from Smart Sessions.`;
}

function pre(data) {
  return `<pre class="result">${escapeHtml(typeof data === 'string' ? data : JSON.stringify(data, null, 2))}</pre>`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function requireApi() {
  if (!api) throw new Error('Connect to a Salesforce org first.');
  return api;
}

// ── Navigation ────────────────────────────────────────────────────────────────
function renderNav() {
  const groups = [
    ['Command Center',   ['dashboard','connect','workspace','themes']],
    ['Build & Inspect',  ['inspector','dataloader','metadata','bulk','flow','lens','fieldusage']],
    ['Operate & Secure', ['logs','permissions','permlens','changetracker','whobrokeit','orgdiff','deploy','rest','limits','jobs','automation','traceflags','security']],
    ['Admin Tools',      ['userlicenses','sandboxes','agents']]
  ];
  const byId = Object.fromEntries(navItems.map(i => [i[0], i]));
  const html = groups.map(([group, ids]) => `
    <div class="nav-group">
      <div class="nav-group-title">${group}</div>
      ${ids.filter(id => byId[id]).map(id => {
        const [key, label, tip] = byId[id];
        const badge = { dashboard:'Home', connect:'Org', workspace:'Saved', agents:'NEW' }[key] || 'Tool';
        return `<button class="navbtn ${active === key ? 'active' : ''}" data-id="${key}" title="${tip}">
          <span>${label}</span><span class="pill">${badge}</span>
        </button>`;
      }).join('')}
    </div>`).join('');
  const nav = $('#nav');
  if (nav) nav.innerHTML = html;
  document.querySelectorAll('.navbtn').forEach(b => b.onclick = () => { active = b.dataset.id; render(); });
}

// Enhancement #4: keyboard shortcuts
function setupKeyboardShortcuts() {
  document.addEventListener('keydown', e => {
    // Ctrl+Enter = run active view primary action
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      const primaryBtns = ['#runSoql','#sendRest','#runAnon','#searchMd','#runPermCompare','#runOrgDiff'];
      for (const sel of primaryBtns) {
        const btn = $(sel);
        if (btn) { btn.click(); e.preventDefault(); break; }
      }
    }
    // Alt+1–9 = switch nav items
    if (e.altKey && e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key) - 1;
      if (navItems[idx]) { active = navItems[idx][0]; render(); e.preventDefault(); }
    }
  });
}

// ── Org management ────────────────────────────────────────────────────────────
async function refreshOrgs() {
  profiles = await readProfiles();
  orgs = await detectAndEnrichOrgs();
  return orgs;
}

async function connect(org = null) {
  const badge = $('#orgBadge');
  badge.className = 'badge warn';
  badge.textContent = 'Connecting…';
  try {
    if (!org) {
      const stored = await readCredentialProfiles();
      const storedChoice = (stored.orgs || []).find(o => o.key === stored.activeKey) || (stored.orgs || [])[0];

      if (storedChoice) {
        // SSO sessions: reconnect via tab bridge — no Bearer token involved
        if (storedChoice.ssoSession) {
          api = await SalesforceApi.fromStoredProfile(storedChoice);
          badge.className   = 'badge ok';
          badge.textContent = storedChoice.alias || storedChoice.username || storedChoice.hostname;
          render();
          return;
        }
        // SOAP sessions: Bearer health check
        if (storedChoice.sessionId) {
          api = await SalesforceApi.fromStoredProfile(storedChoice);
          const h = await recheckStoredSessionHealth(api.org);
          if (!h.apiOk && api.org.savedCredentials) {
            const fresh = await refreshStoredLoginProfile(api.org);
            api = await SalesforceApi.fromStoredProfile(fresh);
          } else if (!h.apiOk) {
            throw new Error('Stored session expired. Open Connect Org and sign in again, or save credentials for one-click refresh.');
          }
          badge.className   = 'badge ok';
          badge.textContent = 'API Available';
          toast(`Connected to ${api.org.alias || api.org.username || api.org.hostname}`);
          render();
          return;
        }
      }
    }
    await refreshOrgs();
    const chosen = org || orgs.find(o => o.key === profiles.activeOrgKey) || orgs.find(o => o.active) || orgs[0];
    if (!chosen) throw new Error('No stored org profile or Salesforce tab found. Click Connect Org to sign in.');
    api = await SalesforceApi.fromOrg(chosen);
    await mergeOrgIntoProfiles(chosen);
    badge.className   = chosen.status === 'active' && chosen.apiAvailable ? 'badge ok' : 'badge warn';
    badge.textContent = chosen.apiAvailable ? 'API Available' : 'Session Check';
    toast(`Connected to ${chosen.alias || chosen.hostname}`);
    render();
  } catch (e) {
    badge.className   = 'badge warn';
    badge.textContent = 'Not connected';
    toast(e.message, 4000);
  }
}
async function reconnect() { api = null; await connect(); }

function openSfPath(path) {
  if (!api) return toast('Connect to an org first.');
  chrome.tabs.create({ url: `${api.orgUrl}${path}` });
}

function orgHealthBadge(org) {
  if (org.status === 'active' && org.apiAvailable)
    return '<span class="badge ok">Active Session</span> <span class="badge ok">API Available</span>';
  if (org.status === 'expired')
    return '<span class="badge danger">Expired</span> <span class="badge warn">API Unavailable</span>';
  return '<span class="badge warn">Session Unknown</span>';
}

// ── SOQL history helpers (Enhancement #5) ────────────────────────────────────
async function loadSoqlHistory() {
  const orgKey = api?.key || 'global';
  const store  = await chrome.storage.local.get('sfForgeSoqlHistory');
  soqlHistory  = store.sfForgeSoqlHistory || {};
  return soqlHistory[orgKey] || [];
}

async function pushSoqlHistory(soql, name = '') {
  const orgKey = api?.key || 'global';
  const store  = await chrome.storage.local.get('sfForgeSoqlHistory');
  const all    = store.sfForgeSoqlHistory || {};
  const entries = all[orgKey] || [];
  // Remove duplicate
  const filtered = entries.filter(e => e.soql !== soql);
  filtered.unshift({ soql, name: name || soql.substring(0, 60), ts: Date.now() });
  all[orgKey] = filtered.slice(0, 20);
  await chrome.storage.local.set({ sfForgeSoqlHistory: all });
  soqlHistory = all;
}

function renderSoqlHistoryDropdown(entries) {
  if (!entries.length) return '<option value="">— No history —</option>';
  return `<option value="">— Recent queries —</option>` +
    entries.map((e, i) => `<option value="${i}">${escapeHtml(e.name || e.soql.substring(0, 60))}</option>`).join('');
}

// ── Render router ─────────────────────────────────────────────────────────────
async function render() {
  try {
    // Clean up any polling timers from previous views
    if (window._limitsCleanup) { window._limitsCleanup(); window._limitsCleanup = null; }
    if (window._jobsCleanup)   { window._jobsCleanup();   window._jobsCleanup   = null; }
    renderNav();
    // Sync topbar badge to real connection state on every render
    const badge = $('#orgBadge');
    if (badge) {
      if (api?.org?.apiAvailable) {
        badge.className = 'badge ok';
        badge.textContent = api.org.alias || api.org.orgName || api.org.username || 'Connected';
      } else if (api) {
        badge.className = 'badge warn';
        badge.textContent = 'Session Check';
      } else {
        badge.className = 'badge warn';
        badge.textContent = 'Not connected';
      }
    }
    const item = navItems.find(i => i[0] === active) || navItems[0];
    active = item[0];
    setHeader(item[1], item[2]);
    const routes = {
      dashboard, connect: connectView, inspector, dataloader: dataLoader, rest, metadata, logs, flow, lens,
      bulk, permissions, permlens: permLens, changetracker: changeTracker, whobrokeit: whobrokeit, orgdiff, deploy, agents, workspace, themes: themeEngine,
      limits: limitsView, jobs: jobMonitor, automation: automationHealth, traceflags: traceFlagManager, security: securityScan,
      userlicenses: userLicenseAudit, fieldusage: fieldUsageAnalyzer, sandboxes: sandboxTracker
    };
    const fn = routes[active] || dashboard;
    await fn();
  } catch (e) {
    console.error('SF Forge render failed', e);
    const v = view();
    if (v) v.innerHTML = `<section class="card"><h3>SF Forge could not render this view</h3><p class="error-note">${escapeHtml(e.message || e)}</p><div class="toolbar"><button id="recoverDashboard">Return to Dashboard</button></div></section>`;
    const b = document.querySelector('#recoverDashboard');
    if (b) b.onclick = () => { active = 'dashboard'; render(); };
    toast(e.message || 'Render error', 5000);
  }
}

// ── Connect Org view ──────────────────────────────────────────────────────────
async function connectView() {
  const stored = await readCredentialProfiles();
  const rows   = stored.orgs || [];
  view().innerHTML = `<div class="grid">
    <section class="card span6">
      <h3>Connect to Org <span class="badge info">Production / Sandbox / SSO</span></h3>
      <p class="muted">Choose the method that matches how you log into Salesforce.</p>

      <!-- METHOD TABS -->
      <div class="toolbar" style="margin-bottom:16px">
        <button id="cxTabSSO"   class="pl-tab active-tab">🔐 SSO / MFA Login</button>
        <button id="cxTabSoap"  class="pl-tab">🔑 Username + Password</button>
        <button id="cxTabSID"   class="pl-tab">📋 Paste Session ID</button>
      </div>

      <!-- SSO / MFA PANEL (default) -->
      <div id="cxSSO">
        <div class="notice" style="margin-bottom:12px">
          <b>Works with SSO, MFA, and all custom login policies.</b><br>
          SF Forge opens your Salesforce login page in a new tab. Once you're logged in, click <b>Detect Session</b> and the extension reads the session directly from that tab — no password ever stored.
        </div>
        <div class="field">
          <label>Org Type</label>
          <select id="ssoOrgType">
            <option value="production">Production / Developer</option>
            <option value="sandbox">Sandbox</option>
            <option value="custom">Custom Domain</option>
          </select>
        </div>
        <div class="field" id="ssoCustomDomainWrap" style="display:none">
          <label>Custom Login URL</label>
          <input id="ssoCustomDomain" placeholder="https://mycompany.my.salesforce.com">
          <small class="muted">Enter your org's My Domain or custom login URL.</small>
        </div>
        <div class="field">
          <label>Alias <span class="muted">for your reference</span></label>
          <input id="ssoAlias" placeholder="e.g. Production, Full SB">
        </div>
        <div class="field">
          <label>Color Tag</label>
          <select id="ssoColor">
            <option value="red"    selected>Red — Production</option>
            <option value="amber">Amber — Sandbox</option>
            <option value="blue">Blue — Dev</option>
            <option value="green">Green</option>
            <option value="purple">Purple</option>
          </select>
        </div>
        <div class="toolbar">
          <button id="ssoOpenLogin">1 · Open Login Page</button>
          <button class="secondary" id="ssoDetect">2 · Detect Session</button>
        </div>
        <div id="ssoResult"></div>
        <p class="muted" style="font-size:11px;margin-top:8px">
          After clicking <b>Open Login Page</b>, complete your SSO/MFA login in the new tab, then come back here and click <b>Detect Session</b>.
        </p>
      </div>

      <!-- USERNAME + PASSWORD PANEL -->
      <div id="cxSoap" style="display:none">
        <div class="notice" style="margin-bottom:12px;border-left-color:#fbbf24">
          <b>Note:</b> Username+password login uses the SOAP Partner API and is blocked when SSO, MFA enforcement, or "No Password" login policies are active on your org. Use the SSO tab instead.
        </div>
        <div class="field"><label>Org Type</label><select id="soapOrgType"><option value="production">Production / Developer</option><option value="sandbox">Sandbox</option></select></div>
        <div class="field"><label>Username</label><input id="soapUsername" autocomplete="username" placeholder="name@company.com"></div>
        <div class="field"><label>Password</label><input id="soapPassword" type="password" autocomplete="current-password"></div>
        <div class="field"><label>Security Token <span class="muted">(if required)</span></label><input id="soapToken" type="password" placeholder="Appended to password automatically"></div>
        <div class="field"><label>Alias</label><input id="soapAlias" placeholder="Full SB, Prod, UAT"></div>
        <div class="field"><label>Color Tag</label><select id="soapColor"><option>purple</option><option>blue</option><option selected>amber</option><option>red</option><option>green</option></select></div>
        <label class="checkline"><input id="soapRemember" type="checkbox"> Remember credentials for one-click refresh</label>
        <div class="toolbar"><button id="soapLogin">Connect &amp; Save</button></div>
        <div id="soapResult"></div>
      </div>

      <!-- PASTE SID PANEL -->
      <div id="cxSID" style="display:none">
        <div class="notice" style="margin-bottom:12px">
          Get the SID from: browser DevTools → Application tab → Cookies → your SF domain → <code>sid</code> value.
        </div>
        <div class="field"><label>Session ID (sid cookie value)</label><input id="sidValue" type="password" placeholder="00D…"></div>
        <div class="field"><label>Instance URL</label><input id="sidInstance" placeholder="https://yourorg.my.salesforce.com"></div>
        <div class="field"><label>Alias</label><input id="sidAlias" placeholder="Production, Full SB"></div>
        <div class="field"><label>Color Tag</label><select id="sidColor"><option value="red" selected>Red — Production</option><option value="amber">Amber — Sandbox</option><option value="blue">Blue</option><option value="green">Green</option><option value="purple">Purple</option></select></div>
        <div class="toolbar"><button id="sidConnect">Connect with Session ID</button></div>
        <div id="sidResult"></div>
      </div>
    </section>

    <section class="card span6">
      <h3>Stored Org Vault <span class="badge info">Local</span></h3>
      <p class="muted">Profiles stored in this Chrome profile only.</p>
      <div id="storedVault">${renderStoredVault(rows, stored.activeKey)}</div>
    </section>
  </div>`;

  // ── Tab switching ──────────────────────────────────────────────────────
  const tabPanels = { cxTabSSO:'cxSSO', cxTabSoap:'cxSoap', cxTabSID:'cxSID' };
  Object.entries(tabPanels).forEach(([tabId, panelId]) => {
    document.getElementById(tabId).onclick = () => {
      document.querySelectorAll('.pl-tab').forEach(b => b.classList.remove('active-tab'));
      document.getElementById(tabId).classList.add('active-tab');
      Object.values(tabPanels).forEach(p => { document.getElementById(p).style.display = 'none'; });
      document.getElementById(panelId).style.display = '';
    };
  });

  // Show/hide custom domain field
  $('#ssoOrgType').onchange = () => {
    $('#ssoCustomDomainWrap').style.display = $('#ssoOrgType').value === 'custom' ? '' : 'none';
  };

  // ── SSO / MFA flow ────────────────────────────────────────────────────
  let ssoLoginTabId = null;

  $('#ssoOpenLogin').onclick = async () => {
    const orgType = $('#ssoOrgType').value;
    let loginUrl;
    if (orgType === 'custom') {
      const custom = $('#ssoCustomDomain').value.trim();
      if (!custom) return toast('Enter your custom domain URL first.');
      try {
        const u = new URL(custom.startsWith('http') ? custom : `https://${custom}`);
        loginUrl = `${u.origin}/`;
      } catch { return toast('Invalid custom domain URL.'); }
    } else if (orgType === 'sandbox') {
      loginUrl = 'https://test.salesforce.com/';
    } else {
      loginUrl = 'https://login.salesforce.com/';
    }

    const tab = await chrome.tabs.create({ url: loginUrl });
    ssoLoginTabId = tab.id;
    $('#ssoResult').innerHTML = `<p class="muted" style="font-size:12px">
      Login page opened (Tab ID: ${tab.id}). Complete your SSO / MFA login, then click <b>Detect Session</b>.
    </p>`;
    toast('Login tab opened — complete your SSO/MFA login then click Detect Session.');
  };

  $('#ssoDetect').onclick = async () => {
    const btn = $('#ssoDetect');
    btn.disabled = true; btn.textContent = 'Detecting…';
    const res = $('#ssoResult');

    try {
      // Find all SF tabs — prefer the one we opened, fall back to any active SF tab
      const allTabs = await chrome.tabs.query({});
      const sfTabs  = allTabs.filter(t => t.url && /\.(salesforce|force|visualforce)\.com/i.test(new URL(t.url || 'https://x').hostname));

      if (!sfTabs.length) {
        res.innerHTML = `<p class="error-note">No Salesforce tabs found. Make sure you completed the SSO login and the tab is still open.</p>`;
        return;
      }

      // Prefer the tab we opened; otherwise try the most recently active SF tab
      const targetTab = sfTabs.find(t => t.id === ssoLoginTabId)
        || sfTabs.find(t => t.active)
        || sfTabs[sfTabs.length - 1];

      const tabUrl    = new URL(targetTab.url);
      const tabOrigin = `${tabUrl.protocol}//${tabUrl.hostname}`;
      const h         = tabUrl.hostname.toLowerCase();

      // Compute canonical instance URL
      let instanceUrl;
      if (h.endsWith('.lightning.force.com') && h.includes('--')) {
        instanceUrl = `https://${tabUrl.hostname.replace(/\.lightning\.force\.com$/i, '.sandbox.my.salesforce.com')}`;
      } else if (h.endsWith('.lightning.force.com')) {
        instanceUrl = `https://${tabUrl.hostname.replace(/\.lightning\.force\.com$/i, '.my.salesforce.com')}`;
      } else if (h.endsWith('.force.com') && h.includes('--')) {
        instanceUrl = `https://${tabUrl.hostname.replace(/\.force\.com$/i, '.sandbox.my.salesforce.com')}`;
      } else if (h.includes('sandbox.my.salesforce.com')) {
        instanceUrl = tabOrigin;
      } else {
        instanceUrl = tabOrigin;
      }

      // Inject the bridge into the tab first (in case it wasn't loaded)
      try {
        await chrome.runtime.sendMessage({ type: 'INJECT_BRIDGE', tabId: targetTab.id });
      } catch(_) {}
      // Give it a moment to initialise
      await new Promise(r => setTimeout(r, 400));

      // Try to hit /services/data/ via the bridge to confirm session is live
      let sessionConfirmed = false;
      let identity = null;
      try {
        await bridgeFetch(targetTab.id, `${tabOrigin}/services/data/`);
        sessionConfirmed = true;
        try {
          identity = await bridgeFetch(targetTab.id, `${tabOrigin}/services/oauth2/userinfo`);
        } catch(_) {}
      } catch(e) {
        // Bridge call failed — fall back to cookie extraction
      }

      // Cookie extraction (works even if bridge didn't respond)
      let sidCookie = null;
      for (const cookieUrl of [tabOrigin + '/', instanceUrl + '/']) {
        try { sidCookie = await chrome.cookies.get({ url: cookieUrl, name: 'sid' }); } catch(_) {}
        if (sidCookie?.value) break;
      }

      if (!sessionConfirmed && !sidCookie?.value) {
        res.innerHTML = `<p class="error-note">
          Could not detect an active session on <b>${tabOrigin}</b>.<br><br>
          Make sure you are fully logged in (past any MFA prompts) and the Salesforce home/app page is visible in the tab — not the login screen.
          Then click <b>Detect Session</b> again.
        </p>`;
        return;
      }

      const alias    = $('#ssoAlias').value.trim() || (h.includes('--') ? 'Sandbox' : 'Production');
      const colorTag = $('#ssoColor').value;
      const isSandbox = h.includes('--') || h.includes('sandbox');

      // Build profile.
      // IMPORTANT: do NOT store the cookie SID as sessionId.
      // Cookie SIDs cannot be used as Bearer tokens — they are only valid when
      // sent as a cookie header via the browser bridge (credentials:include).
      // Storing them as sessionId causes every tool call to fail with INVALID_SESSION_ID.
      // We store sessionId:'' and route 100% via the tab bridge instead.
      const profilePayload = {
        sessionId:    '',           // intentionally blank — SSO uses bridge not Bearer
        instanceUrl,
        pageOrigin:   tabOrigin,
        hostname:     new URL(instanceUrl).hostname,
        username:     identity?.preferred_username || identity?.email || '',
        displayName:  identity?.name || '',
        orgId:        identity?.organization_id || '',
        userId:       identity?.user_id || '',
        tabId:        targetTab.id,
        apiAvailable: true,
        status:       'active',
        type:         isSandbox ? 'Sandbox' : 'Production',
        connectionMode: 'stored-login',
        ssoSession:   true
      };

      const profile = await saveStoredLoginProfile(profilePayload, { alias, colorTag, rememberCredentials: false });

      // Always connect SSO sessions via the tab bridge — Bearer token doesn't work for
      // SSO cookie SIDs. fromOrg with tabId routes all requests through credentials:include.
      api = await SalesforceApi.fromOrg({ ...profilePayload, tabId: targetTab.id });

      res.innerHTML = `<div style="border-left:3px solid #4ade80;padding:8px 12px;background:var(--panel2);border-radius:0 8px 8px 0">
        <b style="color:#4ade80">✓ Connected: ${escapeHtml(alias)}</b><br>
        <span class="muted" style="font-size:12px">${escapeHtml(instanceUrl)}</span><br>
        ${identity ? `<span class="muted" style="font-size:12px">${escapeHtml(identity.preferred_username || identity.email || '')}</span>` : ''}
      </div>`;
      toast(`Connected: ${alias}`);
      // Refresh the vault section
      const vaultData = await readCredentialProfiles();
      $('#storedVault').innerHTML = renderStoredVault(vaultData.orgs || [], vaultData.activeKey);
      bindVaultButtons();

    } catch(e) {
      res.innerHTML = `<p class="error-note">${escapeHtml(e.message)}</p>`;
      toast(e.message, 5000, { copyText: e.message });
    } finally {
      btn.disabled = false; btn.textContent = '2 · Detect Session';
    }
  };

  // ── SOAP username/password flow ───────────────────────────────────────
  $('#soapLogin').onclick = async () => {
    const btn = $('#soapLogin');
    btn.disabled = true; btn.textContent = 'Connecting…';
    try {
      const soapResult = await salesforceSoapLogin({
        username:      $('#soapUsername').value.trim(),
        password:      $('#soapPassword').value,
        securityToken: $('#soapToken').value,
        loginType:     $('#soapOrgType').value
      });
      const alias    = $('#soapAlias').value.trim();
      const colorTag = $('#ssoColor')?.value || $('#soapColor').value;
      const remember = $('#soapRemember').checked;
      const profile  = await saveStoredLoginProfile(soapResult, {
        alias, colorTag,
        rememberCredentials: remember,
        password:      remember ? $('#soapPassword').value : '',
        securityToken: remember ? $('#soapToken').value    : ''
      });
      api = await SalesforceApi.fromStoredProfile(profile);
      $('#soapResult').innerHTML = `<p class="badge ok">Connected: ${escapeHtml(alias || soapResult.username)}</p>`;
      toast(`Connected: ${alias || soapResult.username}`);
      const vaultData = await readCredentialProfiles();
      $('#storedVault').innerHTML = renderStoredVault(vaultData.orgs || [], vaultData.activeKey);
      bindVaultButtons();
    } catch(e) {
      $('#soapResult').innerHTML = `<p class="error-note">${escapeHtml(e.message)}</p>`;
    } finally {
      btn.disabled = false; btn.textContent = 'Connect & Save';
    }
  };

  // ── Paste SID flow ────────────────────────────────────────────────────
  $('#sidConnect').onclick = async () => {
    const sid      = $('#sidValue').value.trim();
    const instance = $('#sidInstance').value.trim();
    const alias    = $('#sidAlias').value.trim() || 'Manual Session';
    const colorTag = $('#sidColor').value;
    const res      = $('#sidResult');
    if (!sid)      return toast('Enter a Session ID.');
    if (!instance) return toast('Enter the Instance URL.');
    try {
      const instanceUrl = instance.startsWith('http') ? instance : `https://${instance}`;
      const profile = await saveStoredLoginProfile(
        { sessionId: sid, instanceUrl, pageOrigin: instanceUrl, hostname: new URL(instanceUrl).hostname, username: '', apiAvailable: true, status: 'active' },
        { alias, colorTag, rememberCredentials: false }
      );
      api = await SalesforceApi.fromStoredProfile(profile);
      res.innerHTML = `<p class="badge ok">Connected via Session ID to ${escapeHtml(instanceUrl)}</p>`;
      toast(`Connected: ${alias}`);
      const vaultData = await readCredentialProfiles();
      $('#storedVault').innerHTML = renderStoredVault(vaultData.orgs || [], vaultData.activeKey);
      bindVaultButtons();
    } catch(e) {
      res.innerHTML = `<p class="error-note">${escapeHtml(e.message)}</p>`;
    }
  };

  function bindVaultButtons() {
    document.querySelectorAll('[data-use-stored]').forEach(btn =>
      btn.onclick = async () => {
        try {
          const p = (await readCredentialProfiles()).orgs?.find(o => o.key === btn.dataset.useStored);
          if (!p) return toast('Org profile not found.');
          api = await SalesforceApi.fromStoredProfile(p);
          toast(`Active org: ${p.alias || p.username || p.hostname}`);
          render();
        } catch (e) { toast(e.message, 4000); }
      }
    );
    document.querySelectorAll('[data-delete-stored]').forEach(btn =>
      btn.onclick = async () => {
        if (!confirm('Delete this stored org?')) return;
        const key  = btn.dataset.deleteStored;
        const data = await readCredentialProfiles();
        const prev = data.orgs?.find(o => o.key === key);
        data.orgs  = (data.orgs || []).filter(o => o.key !== key);
        if (data.activeKey === key) data.activeKey = data.orgs[0]?.key || null;
        await chrome.storage.local.set({ sfForgeCredentialProfiles: data });
        toast('Stored org deleted.', 2800, {
          undoFn: async () => {
            if (prev) {
              const d2 = await readCredentialProfiles();
              d2.orgs  = [...(d2.orgs || []), prev];
              await chrome.storage.local.set({ sfForgeCredentialProfiles: d2 });
              connectView();
            }
          }
        });
        connectView();
      }
    );
  }

  bindVaultButtons();
}

function renderStoredVault(rows, activeKey) {
  if (!rows.length) return '<p class="muted">No stored org profiles yet. Connect an org above to save it.</p>';
  return `<div class="org-grid">${rows.map(org => `
    <article class="org-tile color-${org.colorTag || 'purple'}">
      <div class="org-tile-head">
        <div><h4>${escapeHtml(org.alias || org.orgName || org.hostname)}</h4>
          <p class="muted">${escapeHtml(org.username || org.orgId || '')}</p></div>
        ${org.key === activeKey ? '<span class="badge ok">Active</span>' : ''}
      </div>
      <p class="muted" style="font-size:11px">${escapeHtml(org.instanceUrl || '')} • API ${escapeHtml(org.apiVersion || 'v66.0')}</p>
      <div class="toolbar">
        <button data-use-stored="${escapeHtml(org.key)}">Use Org</button>
        <button class="danger" data-delete-stored="${escapeHtml(org.key)}">Delete</button>
      </div>
    </article>`).join('')}</div>`;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function dashboard() {
  const storedData  = await readCredentialProfiles();
  const storedOrgs  = (storedData.orgs || []).map(s => ({
    ...s, connectionMode: 'stored-login',
    // SSO profiles have no sessionId — preserve their tabId so bridge routing works
    tabId: s.ssoSession ? (s.tabId || null) : null,
    status: s.sessionId || s.ssoSession ? 'active' : 'expired',
    apiAvailable: !!(s.sessionId || s.ssoSession)
  }));
  const openCount    = orgs.length;
  const storedCount  = storedOrgs.length;
  const activeLabel  = api ? activeOrgLabel() : 'No active org';

  // Determine real connection state — api object existing ≠ session valid
  const apiConnected  = !!api;
  const sessionValid  = api?.org?.apiAvailable === true;
  const sessionStatus = !api ? 'not-connected' : sessionValid ? 'ok' : 'expired';

  view().innerHTML = `<div class="grid">
    <section class="dashboard-hero">
      <div class="hero-card">
        <h3>Command Center</h3>
        <p class="muted">One active org controls every SF Forge tool. Use Smart Org Sessions below to switch between Production, Sandbox, and stored profiles.</p>
        <div class="status-strip">
          ${sessionStatus === 'ok'           ? `<span class="badge ok">Connected</span>` : ''}
          ${sessionStatus === 'expired'      ? `<span class="badge danger">Session Expired</span>` : ''}
          ${sessionStatus === 'not-connected'? `<span class="badge warn">Not connected</span>` : ''}
          <span class="badge info">Active: ${escapeHtml(activeLabel)}</span>
          <span class="badge info">${storedCount} stored</span>
          <span class="badge info" id="openOrgMetric">${openCount} open tabs</span>
        </div>
        ${sessionStatus === 'expired' ? `<div class="notice" style="margin-top:8px;border-left:3px solid #f87171">
          <b>Session expired.</b> The org was detected from a tab that is no longer authenticated.
          Click <b>Detect Open Tabs</b> after re-logging into Salesforce, or use
          <b>Session Recovery</b> below to grab a fresh SID from an open tab.
        </div>` : ''}
        <div class="toolbar">
          <button id="detectOrgs">Detect Open Tabs</button>
          <button class="secondary" data-go="connect">Connect / Manage Orgs</button>
          <button class="secondary" id="connectRecent">Connect Last Used</button>
          <button class="secondary" id="reconnectBtn">Reconnect / Refresh</button>
        </div>
        <p class="muted" style="font-size:11px;margin-top:8px">Keyboard: <kbd>Alt+1–9</kbd> switch tools · <kbd>Ctrl+Enter</kbd> run active query</p>
      </div>
      <div class="metric-card"><b>${storedCount}</b><span>Stored Org Profiles</span><small class="muted">Use or delete profiles from the vault.</small></div>
      <div class="metric-card"><b>${api ? '1' : '0'}</b><span>Active Target Org</span><small class="muted">All actions run against only this org.</small></div>
    </section>

    <section class="card span12" id="sessionRecoveryCard">
      <h3>Session Recovery <span class="badge warn">Use when session has expired</span></h3>
      <p class="muted">If you're logged into Salesforce in a tab but SF Forge shows the session as expired, use this to extract the live session cookie from that tab and reconnect without re-entering credentials.</p>
      <div class="toolbar">
        <button id="recoverFromTab">Extract SID from Open Tab</button>
        <button class="secondary" id="pasteManualSid">Paste SID Manually</button>
      </div>
      <div id="recoveryManualFields" style="display:none">
        <div class="field"><label>Session ID (SID)</label><input id="manualSid" type="password" placeholder="00D…"></div>
        <div class="field"><label>Instance URL</label><input id="manualInstance" placeholder="https://yourorg.my.salesforce.com"></div>
        <div class="field"><label>Alias</label><input id="manualAlias" placeholder="Full SB"></div>
        <div class="field"><label>Color Tag</label><select id="manualColor"><option>amber</option><option>red</option><option>green</option><option>blue</option><option>purple</option></select></div>
        <div class="toolbar"><button id="connectManualSid">Connect with this SID</button></div>
      </div>
      <div id="recoveryResult"></div>
    </section>

    <section class="card span8">
      <h3>Smart Org Sessions <span class="badge info">Switch Target Org</span></h3>
      <p class="muted">All open Salesforce tabs and stored org profiles appear here. Click <b>Use Org</b> to make that org the active target for the extension.</p>
      <div id="orgCards">
        ${storedOrgs.length ? `<p class="muted" style="font-size:12px;margin-bottom:4px">Stored org profiles:</p>${renderStoredOrgCards(storedOrgs, storedData.activeKey)}` : '<p class="muted">No stored org profiles yet.</p>'}
        <p class="muted" style="font-size:12px;margin:10px 0 4px">Open Salesforce tabs:</p>
        <div id="tabOrgCards"><em class="muted">Scanning tabs…</em></div>
      </div>
    </section>

    <section class="card span4">
      <h3>Session Health</h3>
      <div id="healthPanel">${api ? renderHealth(api.org || {}) : '<p class="muted">Connect to view session health details.</p>'}</div>
      ${api ? '<div class="toolbar"><button class="secondary" id="recheckHealth">Re-check Health</button></div>' : ''}
    </section>

    <section class="card span12">
      <h3>Tool Hub</h3>
      <div class="tool-hub">
        <button class="tool-card" data-go="inspector"><b>Query &amp; Inspect</b><small>SOQL history, sort, objects, fields</small></button>
        <button class="tool-card" data-go="dataloader"><b>Data Loader ✦NEW</b><small>Edit records in place, bulk update</small></button>
        <button class="tool-card" data-go="metadata"><b>Metadata Studio</b><small>Apex edit &amp; save, LWC, Aura, Flows</small></button>
        <button class="tool-card" data-go="bulk"><b>Bulk Field Creator</b><small>CSV, paste, validation, payload preview</small></button>
        <button class="tool-card" data-go="logs"><b>Debug Log Viewer</b><small>Colorized logs, filters, counters</small></button>
        <button class="tool-card" data-go="flow"><b>Flow Analyzer</b><small>Filter, compare versions, flow map</small></button>
        <button class="tool-card" data-go="automation"><b>Automation Health ✦NEW</b><small>Flows, scheduled jobs, workflows</small></button>
        <button class="tool-card" data-go="permissions"><b>Permissions + FLS</b><small>Object &amp; field-level security grid</small></button>
        <button class="tool-card" data-go="permlens"><b>Permission Lens</b><small>Diff, copy &amp; bulk-assign permissions</small></button>
        <button class="tool-card" data-go="changetracker"><b>Org Change Tracker</b><small>SetupAuditTrail — who changed what</small></button>
        <button class="tool-card" data-go="whobrokeit"><b>Who Broke It? ✦NEW</b><small>Panic-button critical change filter</small></button>
        <button class="tool-card" data-go="userlicenses"><b>User &amp; License Audit ✦NEW</b><small>Inactive users, login history</small></button>
        <button class="tool-card" data-go="fieldusage"><b>Field Usage Analyzer ✦NEW</b><small>Where is this field referenced?</small></button>
        <button class="tool-card" data-go="sandboxes"><b>Sandbox Tracker ✦NEW</b><small>Refresh dates, types, status</small></button>
        <button class="tool-card" data-go="orgdiff"><b>Org Diff</b><small>Field-level metadata compare</small></button>
        <button class="tool-card" data-go="agents"><b>Agentforce Inspector</b><small>Bots, topics, actions</small></button>
      </div>
    </section>

    <section class="card span12">
      <h3>Quick Salesforce Links</h3>
      <div class="quick-grid">
        <button data-open="/lightning/setup/SetupOneHome/home">Open Setup</button>
        <button data-open="/lightning/setup/ObjectManager/home">Object Manager</button>
        <button data-open="/lightning/setup/Flows/home">Flows</button>
        <button data-open="/lightning/setup/ApexClasses/home">Apex Classes</button>
        <button data-open="/lightning/setup/DebugLogs/home">Debug Logs</button>
        <button data-open="/lightning/setup/PermSets/home">Permission Sets</button>
        <button data-open="/lightning/setup/BotVersions/home">Einstein Bots / Agents</button>
        <button data-go="workspace">Saved Workspace</button>
      </div>
    </section>

    <section class="card span12">
      <h3>Recent Org History</h3>
      <div id="recentOrgs">${renderRecent()}</div>
    </section>
  </div>`;

  $('#detectOrgs').onclick = async () => {
    await refreshOrgs();
    $('#tabOrgCards').innerHTML = renderOrgCards();
    const metric = $('#openOrgMetric'); if (metric) metric.textContent = `${orgs.length} open tabs`;
    bindOrgCards();
    toast(`${orgs.length} tab-org${orgs.length === 1 ? '' : 's'} detected`);
  };
  $('#connectRecent').onclick = () => connect();
  $('#reconnectBtn').onclick  = () => reconnect();

  // Session Recovery: extract SID from open SF tab cookie
  $('#recoverFromTab').onclick = async () => {
    const resEl = $('#recoveryResult');
    resEl.innerHTML = '<p class="muted">Scanning open Salesforce tabs for active session cookie…</p>';
    try {
      const sfTabs = await chrome.tabs.query({});
      // Match any tab that looks like Salesforce (same pattern as the manifest)
      const sfTab = sfTabs.find(t => t.url && /salesforce\.com|force\.com|visualforce\.com/i.test(new URL(t.url || 'https://x').hostname));
      if (!sfTab) {
        resEl.innerHTML = '<p class="error-note">No open Salesforce tabs found. Open a Salesforce org tab first, then click Extract SID again.</p>';
        return;
      }
      const tabUrl    = new URL(sfTab.url);
      const tabOrigin = `${tabUrl.protocol}//${tabUrl.hostname}`;

      // Import canonicalApiBase logic inline to compute the correct .my.salesforce.com URL
      // Sandbox lightning: myorg--sb.lightning.force.com → myorg--sb.sandbox.my.salesforce.com
      // Production lightning: myorg.lightning.force.com → myorg.my.salesforce.com
      const h = tabUrl.hostname.toLowerCase();
      let instanceUrl;
      if (h.endsWith('.lightning.force.com') && h.includes('--')) {
        const sub = tabUrl.hostname.replace(/\.lightning\.force\.com$/i, '');
        instanceUrl = `https://${sub}.sandbox.my.salesforce.com`;
      } else if (h.endsWith('.lightning.force.com')) {
        instanceUrl = `https://${tabUrl.hostname.replace(/\.lightning\.force\.com$/i, '.my.salesforce.com')}`;
      } else if (h.endsWith('.force.com') && !h.includes('lightning') && h.includes('--')) {
        const sub = tabUrl.hostname.replace(/\.force\.com$/i, '');
        instanceUrl = `https://${sub}.sandbox.my.salesforce.com`;
      } else {
        instanceUrl = tabOrigin;
      }

      // Try to read 'sid' cookie from both the tab origin and the canonical instance URL
      let sidCookie = null;
      for (const cookieUrl of [tabOrigin + '/', instanceUrl + '/']) {
        try { sidCookie = await chrome.cookies.get({ url: cookieUrl, name: 'sid' }); } catch(_) {}
        if (sidCookie?.value) break;
      }

      if (!sidCookie?.value) {
        resEl.innerHTML = `<p class="error-note">
          No <code>sid</code> cookie found on <b>${tabOrigin}</b>.<br><br>
          <b>Common causes with SSO/MFA:</b><br>
          • The extension needs the <code>cookies</code> permission for <b>${tabOrigin}</b> — check chrome://extensions → SF Forge → Details → Site Access<br>
          • The tab may be on a login/callback URL still. Wait for it to fully load on the Salesforce org page, then try again.<br>
          • Try <b>Paste SID Manually</b>: open browser DevTools on the Salesforce tab → Application → Cookies → copy the <code>sid</code> value.
        </p>`;
        return;
      }

      const isSandbox = h.includes('--') || h.includes('sandbox');
      const profile = await saveStoredLoginProfile(
        {
          sessionId:    sidCookie.value,
          instanceUrl,
          pageOrigin:   tabOrigin,
          hostname:     new URL(instanceUrl).hostname,
          username:     '',
          tabId:        sfTab.id,
          apiAvailable: true,
          status:       'active',
          type:         isSandbox ? 'Sandbox' : 'Production'
        },
        { alias: isSandbox ? 'Recovered Sandbox Session' : 'Recovered Production Session', colorTag: isSandbox ? 'amber' : 'red', rememberCredentials: false }
      );
      api = await SalesforceApi.fromStoredProfile(profile);
      resEl.innerHTML = `<p class="badge ok">Session recovered from: ${escapeHtml(instanceUrl)}</p>
        <p class="muted" style="font-size:12px">SID extracted and stored temporarily. To persist beyond this browser session, sign in via Connect Org.</p>`;
      toast('Session recovered — org is now active.');
      render();
    } catch (e) {
      resEl.innerHTML = `<p class="error-note">${escapeHtml(e.message)}</p>`;
    }
  };

  $('#pasteManualSid').onclick = () => {
    const f = $('#recoveryManualFields');
    f.style.display = f.style.display === 'none' ? '' : 'none';
  };

  $('#connectManualSid').onclick = async () => {
    const sid          = $('#manualSid').value.trim();
    const instanceUrl  = $('#manualInstance').value.trim();
    const alias        = $('#manualAlias').value.trim() || 'Manual SID';
    const colorTag     = $('#manualColor').value;
    const resEl        = $('#recoveryResult');
    if (!sid)         return toast('Enter a Session ID.');
    if (!instanceUrl) return toast('Enter an Instance URL (e.g. https://yourorg.my.salesforce.com).');
    try {
      const profile = await saveStoredLoginProfile(
        { sessionId: sid, instanceUrl, pageOrigin: instanceUrl, hostname: new URL(instanceUrl).hostname, username: '', apiAvailable: true, status: 'active' },
        { alias, colorTag, rememberCredentials: false }
      );
      api = await SalesforceApi.fromStoredProfile(profile);
      resEl.innerHTML = `<p class="badge ok">Connected via manual SID to ${escapeHtml(instanceUrl)}</p>`;
      toast(`Connected: ${alias}`);
      render();
    } catch (e) {
      resEl.innerHTML = `<p class="error-note">${escapeHtml(e.message)}</p>`;
    }
  };

  const recheckBtn = $('#recheckHealth');
  if (recheckBtn) recheckBtn.onclick = async () => {
    if (!api?.org) return toast('Connect to an org first.');
    try {
      const h = api.org?.sessionId ? await recheckStoredSessionHealth(api.org) : await recheckSessionHealth(api.org);
      // Update live api.org so topbar reflects true state
      api.org.apiAvailable = !!h.apiOk;
      api.org.status = h.apiOk ? 'active' : 'expired';
      renderActiveOrgLock();
      $('#healthPanel').innerHTML = renderDetailedHealth(api.org, h);
      if (!h.apiOk) {
        toast('Session is expired or API is unavailable. Use Session Recovery to reconnect.', 5000);
      }
    } catch (e) { toast(e.message, 4000); }
  };

  document.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openSfPath(b.dataset.open));
  document.querySelectorAll('[data-go]').forEach(b   => b.onclick = () => { active = b.dataset.go; render(); });
  bindRecentOrgButtons();
  bindStoredOrgCards();

  refreshOrgs().then(() => {
    const el = $('#tabOrgCards');
    if (el) { el.innerHTML = renderOrgCards(); bindOrgCards(); }
    const metric = $('#openOrgMetric'); if (metric) metric.textContent = `${orgs.length} open tabs`;
  }).catch(e => {
    const el = $('#tabOrgCards');
    if (el) el.innerHTML = `<p class="error-note">${escapeHtml(e.message || e)}</p>`;
  });
}

function renderStoredOrgCards(storedOrgs, activeKey) {
  if (!storedOrgs.length) return '';
  return `<div class="org-grid">${storedOrgs.map(org => `
    <article class="org-tile color-${org.colorTag || 'purple'}">
      <div class="org-tile-head">
        <div><h4>${escapeHtml(org.alias || org.orgName || org.hostname)}</h4>
          <p class="muted">${escapeHtml(org.username || org.orgId || '')}</p></div>
        ${orgHealthBadge(org)}
      </div>
      <p class="muted" style="font-size:11px">API ${escapeHtml(org.apiVersion || 'v66.0')}</p>
      <div class="toolbar">
        <button data-use-stored-dash="${escapeHtml(org.key)}">Use Org</button>
      </div>
    </article>`).join('')}</div>`;
}

function bindStoredOrgCards() {
  document.querySelectorAll('[data-use-stored-dash]').forEach(btn =>
    btn.onclick = async () => {
      try {
        const p = (await readCredentialProfiles()).orgs?.find(o => o.key === btn.dataset.useStoredDash);
        if (!p) return toast('Org profile not found.');
        api = await SalesforceApi.fromStoredProfile(p);
        toast(`Active org: ${p.alias || p.username || p.hostname}`);
        render();
      } catch (e) { toast(e.message, 4000); }
    }
  );
}

function renderHealth(org) {
  return `<p><b>Status:</b> ${escapeHtml(org.status || 'unknown')}</p>
    <p><b>API:</b> ${org.apiAvailable ? 'Available' : 'Unavailable'}</p>
    <p><b>Org:</b> ${escapeHtml(org.orgId || '—')}</p>
    <p class="muted" style="font-size:11px">Click Re-check Health for detailed diagnostics.</p>`;
}

function renderDetailedHealth(org, h) {
  if (!h) return '<p class="muted">Health check failed.</p>';
  const rows = Object.entries(h).map(([k,v]) =>
    `<tr><td>${escapeHtml(k)}</td><td>${escapeHtml(String(v))}</td></tr>`).join('');
  return `<table class="table"><thead><tr><th>Check</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function renderOrgCards() {
  if (!orgs.length) return '<p class="muted">No Salesforce tabs detected.</p>';
  return `<div class="org-grid">${orgs.map(org => `
    <article class="org-tile color-${org.colorTag || 'purple'}">
      <div class="org-tile-head">
        <div><h4>${escapeHtml(org.alias || org.hostname)}</h4>
          <p class="muted">${escapeHtml(org.type || '')} • ${escapeHtml(org.username || '')}</p></div>
        ${orgHealthBadge(org)}
      </div>
      <div class="toolbar"><button data-org-key="${escapeHtml(org.key)}">Use Org</button></div>
    </article>`).join('')}</div>`;
}

function renderRecent() {
  const recent = profiles.recent || [];
  if (!recent.length) return '<p class="muted">No recent org history.</p>';
  return `<div class="org-grid">${recent.slice(0, 6).map(org => `
    <article class="org-tile color-${org.colorTag || 'purple'}">
      <div class="org-tile-head">
        <div><h4>${escapeHtml(org.alias || org.hostname)}</h4></div>
      </div>
      <div class="toolbar"><button data-reconnect-key="${escapeHtml(org.key)}">Reconnect</button></div>
    </article>`).join('')}</div>`;
}

function bindRecentOrgButtons() {
  document.querySelectorAll('[data-reconnect-key]').forEach(btn =>
    btn.onclick = async () => {
      const k = btn.dataset.reconnectKey;
      const match = orgs.find(o => o.key === k);
      if (match) { await connect(match); } else { await connect(); }
    }
  );
}

function bindOrgCards() {
  document.querySelectorAll('[data-org-key]').forEach(btn =>
    btn.onclick = async () => {
      const k   = btn.dataset.orgKey;
      const org = orgs.find(o => o.key === k);
      if (!org) return toast('Org not found.');
      await connect(org);
    }
  );
}

// ── Inspector — Enhancement #5: SOQL history + column sort ────────────────────
async function inspector() {
  const histEntries = await loadSoqlHistory();
  view().innerHTML = `<div class="grid">
    <section class="card span6">
      <h3>SOQL Runner <span class="badge info">History + Sort</span></h3>
      <div class="field">
        <label>Recent Queries</label>
        <select id="soqlHistSelect">${renderSoqlHistoryDropdown(histEntries)}</select>
      </div>
      <div class="field">
        <label>SOQL Query <span class="muted">Ctrl+Enter to run</span></label>
        <textarea id="soql">SELECT Id, Name FROM Account LIMIT 25</textarea>
      </div>
      <div class="field" style="display:flex;gap:8px;align-items:center">
        <label>Save as</label>
        <input id="soqlSaveName" placeholder="Query name (optional)" style="flex:1">
        <button class="secondary" id="saveSoqlBtn">Save</button>
      </div>
      <div class="toolbar">
        <button id="runSoql">Run Query</button>
        <button class="secondary" id="runSoqlAll">Load All Pages</button>
        <button class="secondary" id="csvSoql">Download CSV</button>
        <button class="secondary" id="toggleBuilder">Visual Builder</button>
      </div>
      <div id="soqlBuilder" style="display:none;background:var(--panel2);border-radius:8px;padding:12px;margin-top:8px">
        <div class="field" style="margin-bottom:8px">
          <label style="font-size:12px">Object</label>
          <select id="bldObject"><option value="">— pick object —</option></select>
        </div>
        <div id="bldFields" style="display:none">
          <div class="field" style="margin-bottom:8px">
            <label style="font-size:12px">Fields <span class="muted">(check to SELECT)</span></label>
            <div id="bldFieldList" style="max-height:140px;overflow-y:auto;background:var(--panel);border-radius:6px;padding:6px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <div class="field">
              <label style="font-size:12px">WHERE field</label>
              <select id="bldWhereField"><option value="">— none —</option></select>
            </div>
            <div class="field">
              <label style="font-size:12px">Operator</label>
              <select id="bldWhereOp"><option>=</option><option>!=</option><option>LIKE</option><option>&gt;</option><option>&lt;</option><option>IN</option><option>NOT IN</option></select>
            </div>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label style="font-size:12px">WHERE value</label>
            <input id="bldWhereVal" placeholder="'Value' or (val1,val2)">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">
            <div class="field">
              <label style="font-size:12px">ORDER BY</label>
              <select id="bldOrderField"><option value="">— none —</option></select>
            </div>
            <div class="field">
              <label style="font-size:12px">Direction</label>
              <select id="bldOrderDir"><option>ASC</option><option>DESC</option></select>
            </div>
          </div>
          <div class="field" style="margin-bottom:8px">
            <label style="font-size:12px">LIMIT</label>
            <input id="bldLimit" type="number" value="50" min="1" max="50000" style="width:80px">
          </div>
          <button id="bldApply" style="font-size:12px;padding:5px 12px">Apply to Query</button>
        </div>
      </div>
      <div id="soqlProgress" class="muted" style="font-size:12px"></div>
      <div id="soqlResult"></div>
      <div id="recordDetail" style="display:none;margin-top:12px;padding:12px;background:var(--panel2);border-radius:8px;border:1px solid var(--purple)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b id="recordDetailTitle" style="font-size:13px">Record Detail</b>
          <div style="display:flex;gap:6px">
            <button id="editRecordBtn" style="font-size:11px;padding:3px 10px">✎ Edit</button>
            <button id="closeRecordDetail" style="font-size:11px;padding:3px 8px">Close</button>
          </div>
        </div>
        <div id="recordDetailBody"></div>
        <div id="recordEditBar" style="display:none;margin-top:8px;border-top:1px solid var(--line);padding-top:8px">
          <div class="toolbar">
            <button id="saveRecordBtn">Save Changes</button>
            <button class="secondary" id="cancelEditBtn">Cancel</button>
            <span id="recordSaveStatus" class="muted" style="font-size:12px"></span>
          </div>
        </div>
      </div>
    </section>
    <section class="card span6">
      <h3>Object &amp; Field Browser</h3>
      <div class="toolbar">
        <button id="loadObjects">Load Objects</button>
        <input id="objectFilter" placeholder="Filter objects…">
      </div>
      <div class="field">
        <label>Object API Name</label>
        <input id="objectName" placeholder="Account">
      </div>
      <div class="toolbar">
        <button id="describeObject">Describe Object</button>
        <input id="fieldFilter" placeholder="Filter fields…" style="display:none">
      </div>
      <div id="objectResult"></div>
    </section>
  </div>`;

  let lastRecords = [], allFields = [], sortCol = null, sortDir = 1;

  // History dropdown
  $('#soqlHistSelect').onchange = () => {
    const idx = $('#soqlHistSelect').value;
    if (idx === '') return;
    const entry = histEntries[parseInt(idx)];
    if (entry) { $('#soql').value = entry.soql; }
  };

  $('#saveSoqlBtn').onclick = async () => {
    const soql = $('#soql').value.trim();
    if (!soql) return toast('Enter a query first.');
    await pushSoqlHistory(soql, $('#soqlSaveName').value.trim());
    toast('Query saved to history.');
  };

  function renderSortableTable(records) {
    if (!records.length) return '<p class="muted">No rows returned.</p>';
    const cols = [...new Set(records.flatMap(r => Object.keys(r).filter(k => k !== 'attributes' && !k.startsWith('_'))))].slice(0, 12);
    const headerHtml = cols.map(c => {
      const arrow = c === sortCol ? (sortDir === 1 ? ' ▲' : ' ▼') : '';
      return `<th style="cursor:pointer" data-col="${escapeHtml(c)}">${escapeHtml(c)}${arrow}</th>`;
    }).join('');
    const bodyHtml = records.map(r =>
      `<tr>${cols.map(c => `<td>${escapeHtml(typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c] ?? '')}</td>`).join('')}</tr>`
    ).join('');
    return `<table class="table"><thead><tr>${headerHtml}</tr></thead><tbody>${bodyHtml}</tbody></table>`;
  }

  function applySort(records) {
    if (!sortCol) return records;
    return [...records].sort((a, b) => {
      const av = a[sortCol] ?? '', bv = b[sortCol] ?? '';
      return sortDir * (String(av) < String(bv) ? -1 : String(av) > String(bv) ? 1 : 0);
    });
  }

  function attachSortHandlers() {
    document.querySelectorAll('#soqlResult th[data-col]').forEach(th => {
      th.onclick = () => {
        if (sortCol === th.dataset.col) { sortDir *= -1; } else { sortCol = th.dataset.col; sortDir = 1; }
        $('#soqlResult').innerHTML = renderSortableTable(applySort(lastRecords));
        attachSortHandlers();
        attachRowHandlers();
      };
    });
  }

  function attachRowHandlers() {
    document.querySelectorAll('#soqlResult tbody tr').forEach((tr, i) => {
      tr.style.cursor = 'pointer';
      tr.onclick = () => {
        const rec = applySort(lastRecords)[i];
        if (!rec) return;
        window._detailRec = rec;
        renderRecordDetail(rec, false);
        $('#recordDetail').style.display = '';
      };
    });
  }

  function renderRecordDetail(rec, editMode) {
    const allKeys = Object.keys(rec).filter(k => k !== 'attributes');
    const rows = allKeys.map(k => {
      const v = rec[k];
      const isEditable = editMode && k !== 'Id' && typeof v !== 'object';
      const display = v === null
        ? (isEditable ? `<input data-edit-field="${escapeHtml(k)}" value="" style="width:100%;font-size:12px;padding:2px 6px">` : '<span style="color:var(--muted);font-style:italic">null</span>')
        : typeof v === 'object'
          ? `<code style="font-size:11px">${escapeHtml(JSON.stringify(v))}</code>`
          : isEditable
            ? `<input data-edit-field="${escapeHtml(k)}" value="${escapeHtml(String(v))}" style="width:100%;font-size:12px;padding:2px 6px">`
            : escapeHtml(String(v));
      return `<tr>
        <td style="font-weight:500;padding:3px 8px 3px 0;font-size:12px;white-space:nowrap;color:var(--muted)">${escapeHtml(k)}</td>
        <td style="padding:3px 0;font-size:12px;word-break:break-all">${display}</td>
      </tr>`;
    }).join('');
    $('#recordDetailTitle').textContent = rec.Name || rec.Id || 'Record';
    $('#recordDetailBody').innerHTML = `<table style="width:100%">${rows}</table>`;
    if (rec.Id && api?.orgUrl && !editMode) {
      $('#recordDetailBody').innerHTML += `<a href="${api.orgUrl}/${rec.Id}" target="_blank" style="font-size:12px;color:var(--purple2);margin-top:8px;display:block">Open in Salesforce ↗</a>`;
    }
    $('#recordEditBar').style.display = editMode ? '' : 'none';
    $('#editRecordBtn').textContent = editMode ? '✎ Viewing' : '✎ Edit';
  }

  $('#closeRecordDetail').onclick = () => {
    $('#recordDetail').style.display = 'none';
    window._detailRec = null;
    window._detailEditMode = false;
  };

  $('#editRecordBtn').onclick = () => {
    if (!window._detailRec) return;
    window._detailEditMode = !window._detailEditMode;
    renderRecordDetail(window._detailRec, window._detailEditMode);
  };

  $('#cancelEditBtn').onclick = () => {
    window._detailEditMode = false;
    renderRecordDetail(window._detailRec, false);
  };

  $('#saveRecordBtn').onclick = async () => {
    const rec = window._detailRec;
    if (!rec?.Id) return toast('No record selected.');
    const inputs = document.querySelectorAll('[data-edit-field]');
    const changes = {};
    inputs.forEach(inp => {
      const field = inp.dataset.editField;
      const orig  = rec[field];
      const val   = inp.value;
      // Only include changed fields
      if (String(orig ?? '') !== val) {
        // Coerce booleans
        if (val === 'true' || val === 'false') changes[field] = val === 'true';
        else if (val === '' && orig === null) { /* unchanged null */ }
        else changes[field] = val === '' ? null : val;
      }
    });
    if (!Object.keys(changes).length) return toast('No changes detected.');
    const status = $('#recordSaveStatus');
    const btn    = $('#saveRecordBtn');
    btn.disabled = true; status.textContent = 'Saving…';
    try {
      const objectType = rec.attributes?.type || rec.Id?.substring(0,3);
      const objName    = rec.attributes?.type;
      if (!objName) throw new Error('Cannot determine object type from record. Include "attributes" field or use the full SOQL result.');
      await requireApi().request(`/services/data/v66.0/sobjects/${objName}/${rec.Id}`, { method:'PATCH', body:JSON.stringify(changes) });
      // Merge changes back into record
      Object.assign(rec, changes);
      window._detailRec = rec;
      // Refresh SOQL result table in place
      lastRecords = lastRecords.map(r => r.Id === rec.Id ? { ...r, ...changes } : r);
      $('#soqlResult').innerHTML = renderSortableTable(applySort(lastRecords));
      attachSortHandlers(); attachRowHandlers();
      window._detailEditMode = false;
      renderRecordDetail(rec, false);
      status.textContent = '✓ Saved';
      toast(`Record ${rec.Id} updated (${Object.keys(changes).length} field${Object.keys(changes).length > 1 ? 's' : ''}).`);
    } catch(e) {
      status.textContent = '';
      toast(e.message, 6000, { copyText: e.message });
    } finally { btn.disabled = false; }
  };

  // ── Visual Query Builder ──────────────────────────────────────────────────
  let builderVisible = false, builderFields = [];

  $('#toggleBuilder').onclick = async () => {
    builderVisible = !builderVisible;
    $('#soqlBuilder').style.display = builderVisible ? '' : 'none';
    if (builderVisible && !$('#bldObject').options.length > 1) {
      try {
        const r = await requireApi().describeGlobal();
        const opts = r.sobjects.filter(o => o.queryable).sort((a,b)=>a.label.localeCompare(b.label))
          .map(o => `<option value="${escapeHtml(o.name)}">${escapeHtml(o.label)} (${escapeHtml(o.name)})</option>`).join('');
        $('#bldObject').innerHTML = '<option value="">— pick object —</option>' + opts;
      } catch(e) { toast(e.message, 4000); }
    }
  };

  $('#bldObject').onchange = async () => {
    const obj = $('#bldObject').value;
    if (!obj) { $('#bldFields').style.display = 'none'; return; }
    try {
      const r = await requireApi().describeObject(obj);
      builderFields = r.fields.sort((a,b) => a.label.localeCompare(b.label));
      const checkboxes = builderFields.map(f =>
        `<label style="display:block;font-size:12px;padding:2px 0;cursor:pointer">
          <input type="checkbox" data-bld-field="${escapeHtml(f.name)}" ${['Id','Name'].includes(f.name)?'checked':''} style="margin-right:4px">
          ${escapeHtml(f.label)} <span style="color:var(--muted);font-size:10px">(${escapeHtml(f.name)})</span>
        </label>`).join('');
      $('#bldFieldList').innerHTML = checkboxes;
      const fieldOpts = '<option value="">— none —</option>' +
        builderFields.map(f => `<option value="${escapeHtml(f.name)}">${escapeHtml(f.label)}</option>`).join('');
      $('#bldWhereField').innerHTML = fieldOpts;
      $('#bldOrderField').innerHTML = fieldOpts;
      $('#bldFields').style.display = '';
    } catch(e) { toast(e.message, 4000); }
  };

  $('#bldApply').onclick = () => {
    const obj    = $('#bldObject').value;
    if (!obj) return toast('Select an object first.');
    const checked = [...document.querySelectorAll('[data-bld-field]:checked')].map(c => c.dataset.bldField);
    if (!checked.length) return toast('Select at least one field.');
    let soql = `SELECT ${checked.join(', ')} FROM ${obj}`;
    const wf = $('#bldWhereField').value, wv = ($('#bldWhereVal').value||'').trim(), wo = $('#bldWhereOp').value;
    if (wf && wv) soql += ` WHERE ${wf} ${wo} ${wv}`;
    const of = $('#bldOrderField').value;
    if (of) soql += ` ORDER BY ${of} ${$('#bldOrderDir').value}`;
    const lim = parseInt($('#bldLimit').value || '50');
    soql += ` LIMIT ${lim}`;
    $('#soql').value = soql;
    toast('Query built — click Run Query to execute.');
  };

  $('#runSoql').onclick = async () => {
    try {
      const soql = $('#soql').value.trim();
      $('#soqlProgress').textContent = 'Running…';
      const r = await requireApi().query(soql);
      lastRecords = r.records || [];
      await pushSoqlHistory(soql);
      const truncNote = r.done ? '' : ` (showing first ${lastRecords.length} of ${r.totalSize} — use Load All Pages)`;
      $('#soqlProgress').textContent = `${lastRecords.length} record${lastRecords.length === 1 ? '' : 's'}${truncNote}`;
      $('#soqlResult').innerHTML = renderSortableTable(applySort(lastRecords));
      attachSortHandlers(); attachRowHandlers();
    } catch (e) { $('#soqlProgress').textContent = ''; toast(e.message, 5000, { copyText: e.message }); }
  };

  $('#runSoqlAll').onclick = async () => {
    try {
      const soql = $('#soql').value.trim();
      $('#soqlProgress').textContent = 'Loading page 1…';
      const r = await requireApi().queryAll(soql, {
        maxRecords: 10000,
        onPage: (loaded, total) => { $('#soqlProgress').textContent = `Loaded ${loaded} of ${total}…`; }
      });
      lastRecords = r.records;
      await pushSoqlHistory(soql);
      const truncNote = r.truncated ? ` (capped at ${lastRecords.length})` : '';
      $('#soqlProgress').textContent = `${lastRecords.length} record${lastRecords.length === 1 ? '' : 's'}${truncNote}`;
      $('#soqlResult').innerHTML = renderSortableTable(applySort(lastRecords));
      attachSortHandlers(); attachRowHandlers();
    } catch (e) { $('#soqlProgress').textContent = ''; toast(e.message, 4000, { copyText: e.message }); }
  };

  $('#csvSoql').onclick = () => chrome.runtime.sendMessage({
    type: 'DOWNLOAD_TEXT', filename: 'sf-forge-query.csv', mime: 'text/csv',
    content: lastRecords.length ? toCsv(lastRecords) : 'No records to export'
  });

  $('#loadObjects').onclick = async () => {
    try {
      const r = await requireApi().describeGlobal();
      window._objs = r.sobjects;
      renderObjectTable(r.sobjects);
    } catch (e) { toast(e.message, 4000); }
  };

  function renderObjectTable(sobjects) {
    const filt     = ($('#objectFilter').value || '').toLowerCase();
    const filtered = filt ? sobjects.filter(o => o.name.toLowerCase().includes(filt) || o.label.toLowerCase().includes(filt)) : sobjects;
    $('#objectResult').innerHTML = table(filtered.slice(0, 300).map(o => ({ name: o.name, label: o.label, queryable: o.queryable, custom: o.custom })));
  }

  $('#objectFilter').oninput = () => { if (window._objs) renderObjectTable(window._objs); };

  $('#describeObject').onclick = async () => {
    try {
      const r = await requireApi().describeObject($('#objectName').value || 'Account');
      allFields = r.fields;
      $('#fieldFilter').style.display = '';
      renderFieldTable(allFields);
    } catch (e) { toast(e.message, 4000); }
  };

  function renderFieldTable(fields) {
    const filt     = ($('#fieldFilter').value || '').toLowerCase();
    const filtered = filt ? fields.filter(f => f.name.toLowerCase().includes(filt) || f.label.toLowerCase().includes(filt)) : fields;
    $('#objectResult').innerHTML = `<p class="muted" style="font-size:12px">${filtered.length} of ${fields.length} fields</p>` +
      table(filtered.map(f => ({ label: f.label, name: f.name, type: f.type, nillable: f.nillable, updateable: f.updateable, formula: f.calculatedFormula ? 'Y' : '' })));
  }

  $('#fieldFilter').oninput = () => { if (allFields.length) renderFieldTable(allFields); };
}

// ── REST Explorer ─────────────────────────────────────────────────────────────
async function rest() {
  view().innerHTML = `<section class="card">
    <h3>REST Explorer</h3>
    <div class="toolbar">
      <select id="method"><option>GET</option><option>POST</option><option>PATCH</option><option>DELETE</option></select>
      <input id="path" value="/limits" title="Path under /services/data/vXX.X or full URL">
      <button id="sendRest">Send</button>
      <button class="secondary" id="saveJson">Download JSON</button>
    </div>
    <div class="field"><label>JSON Body (POST/PATCH) <span class="muted">Ctrl+Enter to send</span></label><textarea id="body" placeholder='{ "Name": "Example" }'></textarea></div>
    <div id="restResult"></div>
  </section>`;

  let last = null;
  $('#sendRest').onclick = async () => {
    try {
      const opts = { method: $('#method').value };
      if (opts.method !== 'GET' && $('#body').value.trim()) opts.body = $('#body').value;
      last = await requireApi().rest($('#path').value, opts);
      $('#restResult').innerHTML = pre(last);
    } catch (e) { toast(e.message, 4000, { copyText: e.message }); }
  };
  $('#saveJson').onclick = () => last && downloadJson('sf-forge-rest.json', last);
}

// ── Metadata Studio — Enhancement #12: inline Edit & Save ─────────────────────
async function metadata() {
  view().innerHTML = `<div class="grid">
    <section class="card span6">
      <h3>Metadata Search</h3>
      <p class="muted">Apex uses <span class="kbd">Name</span> field; LWC/Aura/Flow use <span class="kbd">DeveloperName</span>.</p>
      <div class="toolbar">
        <select id="mdType">
          <option>ApexClass</option><option>ApexTrigger</option>
          <option>LightningComponentBundle</option><option>AuraDefinitionBundle</option>
          <option>FlowDefinitionView</option><option>EntityDefinition</option><option>FieldDefinition</option>
          <option>PermissionSet</option><option>Profile</option><option>CustomObject</option>
        </select>
        <input id="mdSearch" placeholder="Search name…">
        <button id="searchMd">Search</button>
      </div>
      <div id="mdResult"></div>
    </section>
    <section class="card span6">
      <h3>Anonymous Apex</h3>
      <textarea id="anon">System.debug('Forged by SF Forge');</textarea>
      <div class="toolbar"><button id="runAnon">Execute</button></div>
      <div id="anonResult"></div>
    </section>
    <section class="card span12" id="editSection" style="display:none">
      <h3>Edit Source <span class="badge warn" id="editLabel"></span></h3>
      <textarea id="editBody" style="font-family:monospace;min-height:300px"></textarea>
      <div class="toolbar">
        <button id="saveToOrg">Save to Org</button>
        <button class="secondary" id="cancelEdit">Cancel</button>
      </div>
      <div id="editResult"></div>
    </section>
  </div>`;

  const metadataQueries = {
    ApexClass:               q => `SELECT Id, Name, NamespacePrefix, ApiVersion, Status, CreatedDate, LastModifiedDate FROM ApexClass WHERE Name LIKE '%${q}%' ORDER BY LastModifiedDate DESC LIMIT 50`,
    ApexTrigger:             q => `SELECT Id, Name, NamespacePrefix, TableEnumOrId, ApiVersion, Status, CreatedDate, LastModifiedDate FROM ApexTrigger WHERE Name LIKE '%${q}%' ORDER BY LastModifiedDate DESC LIMIT 50`,
    LightningComponentBundle:q => `SELECT Id, DeveloperName, NamespacePrefix, MasterLabel, ApiVersion, CreatedDate, LastModifiedDate FROM LightningComponentBundle WHERE DeveloperName LIKE '%${q}%' ORDER BY LastModifiedDate DESC LIMIT 50`,
    AuraDefinitionBundle:    q => `SELECT Id, DeveloperName, NamespacePrefix, ApiVersion, CreatedDate, LastModifiedDate FROM AuraDefinitionBundle WHERE DeveloperName LIKE '%${q}%' ORDER BY LastModifiedDate DESC LIMIT 50`,
    FlowDefinitionView:      q => `SELECT Id, ApiName, Label, ActiveVersionId, LatestVersionId FROM FlowDefinitionView WHERE ApiName LIKE '%${q}%' ORDER BY ApiName LIMIT 50`,
    EntityDefinition:        q => `SELECT QualifiedApiName, Label, DurableId, IsCustomizable, IsCustomSetting FROM EntityDefinition WHERE QualifiedApiName LIKE '%${q}%' ORDER BY QualifiedApiName LIMIT 50`,
    FieldDefinition:         q => `SELECT QualifiedApiName, EntityDefinition.QualifiedApiName, Label, DataType, DurableId FROM FieldDefinition WHERE QualifiedApiName LIKE '%${q}%' ORDER BY EntityDefinition.QualifiedApiName, QualifiedApiName LIMIT 50`,
    PermissionSet:           q => `SELECT Id, Name, Label, IsOwnedByProfile, Profile.Name FROM PermissionSet WHERE Name LIKE '%${q}%' OR Label LIKE '%${q}%' ORDER BY Label LIMIT 50`,
    Profile:                 q => `SELECT Id, Name FROM Profile WHERE Name LIKE '%${q}%' ORDER BY Name LIMIT 50`,
    CustomObject:            q => `SELECT Id, DeveloperName, NamespacePrefix, ManageableState FROM CustomObject WHERE DeveloperName LIKE '%${q}%' ORDER BY DeveloperName LIMIT 50`
  };

  const sourceEndpoint = {
    ApexClass:   id => `/sobjects/ApexClass/${id}`,
    ApexTrigger: id => `/sobjects/ApexTrigger/${id}`,
    LightningComponentBundle: id => `/sobjects/LightningComponentBundle/${id}`,
    AuraDefinitionBundle:     id => `/sobjects/AuraDefinitionBundle/${id}`
  };

  let lastType = 'ApexClass', lastRecords = [], editingId = null, editingType = null;

  $('#searchMd').onclick = async () => {
    try {
      lastType = $('#mdType').value;
      const q  = safeLike($('#mdSearch').value);
      const r  = await requireApi().toolingQuery(metadataQueries[lastType](q));
      lastRecords = r.records || [];
      const hasSource = !!sourceEndpoint[lastType];
      const setupPaths = {
        ApexClass: id => `/lightning/setup/ApexClasses/page?address=%2F${id}`,
        ApexTrigger: id => `/lightning/setup/ApexTriggers/page?address=%2F${id}`,
        LightningComponentBundle: id => `/lightning/setup/LightningComponentBundle/page?address=%2F${id}`,
        FlowDefinitionView: id => { const rec = lastRecords.find(r=>r.Id===id); return `/lightning/setup/Flows/page?address=%2F${rec?.ActiveVersionId||id}`; },
        PermissionSet: id => `/lightning/setup/PermSets/page?address=%2F${id}`,
        Profile: id => `/lightning/setup/EnhancedProfiles/page?address=%2F${id}`,
      };
      const actionFn = id => {
        const rec = lastRecords.find(r => r.Id === id) || {};
        const name = rec.Name || rec.DeveloperName || rec.ApiName || id;
        let btns = '';
        if (setupPaths[lastType]) btns += `<button data-open-setup="${escapeHtml(id)}" title="Open in Setup">Setup ↗</button> `;
        if (hasSource) btns += `<button data-dl-src="${escapeHtml(id)}">Download</button> <button class="secondary" data-edit-src="${escapeHtml(id)}">Edit</button> `;
        if (lastType === 'ApexClass') btns += `<button class="secondary" data-run-test="${escapeHtml(id)}" data-class-name="${escapeHtml(name)}">Run Tests</button>`;
        return btns;
      };
      $('#mdResult').innerHTML = table(lastRecords, actionFn);
      document.querySelectorAll('[data-open-setup]').forEach(b => {
        b.onclick = () => { const path = setupPaths[lastType]?.(b.dataset.openSetup); if (path) openSfPath(path); };
      });
      if (hasSource) {
        document.querySelectorAll('[data-dl-src]').forEach(b => b.onclick = () => downloadSource(b.dataset.dlSrc, lastType));
        document.querySelectorAll('[data-edit-src]').forEach(b => b.onclick = () => openEditor(b.dataset.editSrc, lastType));
      }
      document.querySelectorAll('[data-run-test]').forEach(b => b.onclick = () => runApexTests(b.dataset.className));
    } catch (e) { toast(e.message, 4000, { copyText: e.message }); }
  };

  async function downloadSource(id, type) {
    try {
      const rec  = await requireApi().tooling(`${sourceEndpoint[type](id)}`);
      const body = rec.Body || rec.Source || rec.Markup || JSON.stringify(rec, null, 2);
      const name = rec.Name || rec.DeveloperName || id;
      const ext  = type === 'ApexClass' ? '.cls' : type === 'ApexTrigger' ? '.trigger' : '.js';
      chrome.runtime.sendMessage({ type: 'DOWNLOAD_TEXT', filename: `${name}${ext}`, mime: 'text/plain', content: body });
      toast(`Downloading ${name}${ext}`);
    } catch (e) { toast(e.message, 4000); }
  }

  async function runApexTests(className) {
    const editSec = $('#editSection');
    editSec.style.display = '';
    $('#editLabel').textContent = `Test run: ${className}`;
    $('#editBody').value = `// Running tests for ${className}…\n// Results will appear below.`;
    $('#editResult').innerHTML = '<p class="muted">Submitting test run…</p>';
    try {
      const r = await requireApi().tooling(`/runTestsSynchronous`, {
        method: 'POST',
        body: JSON.stringify({ classNames: className, maxFailedTests: 0 })
      });
      const tests = r?.tests || [];
      const pass = tests.filter(t => t.outcome === 'Pass').length;
      const fail = tests.filter(t => t.outcome === 'Fail').length;
      const skip = tests.filter(t => t.outcome === 'Skip').length;
      const cov  = r?.codeCoverage?.find(c => c.name === className);
      const covPct = cov ? Math.round((cov.numLocations - cov.numLocationsNotCovered) / Math.max(cov.numLocations,1) * 100) : null;
      const rows = tests.map(t => {
        const colour = t.outcome === 'Pass' ? 'color:#4ade80' : t.outcome === 'Fail' ? 'color:#f87171' : 'color:var(--muted)';
        const msg = t.message ? `<br><span style="font-size:11px;color:#f87171">${escapeHtml(t.message)}</span>` : '';
        return `<tr><td style="font-size:12px">${escapeHtml(t.methodName)}</td>
          <td style="${colour};font-size:12px;font-weight:500">${t.outcome}</td>
          <td style="font-size:12px">${t.runTime}ms${msg}</td></tr>`;
      }).join('');
      $('#editBody').value = `Tests: ${pass} passed, ${fail} failed, ${skip} skipped${covPct !== null ? ' | Coverage: ' + covPct + '%' : ''}`;
      $('#editResult').innerHTML = `
        <div style="display:flex;gap:12px;margin-bottom:8px;font-size:13px">
          <span style="color:#4ade80">✓ ${pass} passed</span>
          <span style="color:#f87171">✗ ${fail} failed</span>
          <span style="color:var(--muted)">${skip} skipped</span>
          ${covPct !== null ? `<span>Coverage: <b>${covPct}%</b></span>` : ''}
        </div>
        <table class="table"><thead><tr><th>Method</th><th>Result</th><th>Time / Error</th></tr></thead>
        <tbody>${rows || '<tr><td colspan=3 style="color:var(--muted)">No test methods found</td></tr>'}</tbody></table>`;
    } catch(e) {
      $('#editResult').innerHTML = `<p class="error-note">${escapeHtml(e.message)}</p>`;
    }
  }

  // Enhancement #12: open inline editor
  async function openEditor(id, type) {
    try {
      const rec  = await requireApi().tooling(`${sourceEndpoint[type](id)}`);
      const body = rec.Body || rec.Source || rec.Markup || '';
      const name = rec.Name || rec.DeveloperName || id;
      editingId   = id;
      editingType = type;
      $('#editSection').style.display = '';
      $('#editLabel').textContent = name;
      $('#editBody').value = body;
      $('#editSection').scrollIntoView({ behavior: 'smooth' });
    } catch (e) { toast(e.message, 4000); }
  }

  $('#saveToOrg').onclick = async () => {
    if (!editingId) return;
    const btn = $('#saveToOrg');
    btn.disabled = true; btn.textContent = 'Saving…';
    try {
      const body = $('#editBody').value;
      const endpoint = sourceEndpoint[editingType](editingId);
      await requireApi().tooling(endpoint, {
        method: 'PATCH',
        body: JSON.stringify({ Body: body })
      });
      $('#editResult').innerHTML = '<p class="badge ok" style="margin-top:8px">Saved to org successfully.</p>';
      toast('Source saved to org.');
    } catch (e) {
      $('#editResult').innerHTML = `<p class="error-note">${escapeHtml(e.message)}</p>`;
      toast(e.message, 5000, { copyText: e.message });
    } finally {
      btn.disabled = false; btn.textContent = 'Save to Org';
    }
  };

  $('#cancelEdit').onclick = () => {
    $('#editSection').style.display = 'none';
    editingId = null; editingType = null;
  };

  $('#runAnon').onclick = async () => {
    try {
      const r = await requireApi().tooling(`/executeAnonymous?anonymousBody=${encodeURIComponent($('#anon').value)}`);
      $('#anonResult').innerHTML = pre(r);
    } catch (e) { toast(e.message, 4000); }
  };
}

// ── Debug Logs — BUG FIX: split uses NL constant ──────────────────────────────
async function logs() {
  view().innerHTML = `<section class="card">
    <h3>Debug Log Beautifier <span class="badge info">Color coded</span></h3>
    <p class="muted">Severity coloring for SOQL, DML, Apex debug, Flow, callouts, exceptions, and warnings.</p>
    <div class="toolbar">
      <button id="loadLogs">Load Recent Logs</button>
      <button class="secondary" id="copyExceptionSummary">Copy Exception Summary</button>
    </div>
    <div class="toolbar">
      <input id="logFilter" placeholder="Filter log lines…">
      <select id="severityFilter">
        <option value="all">All lines</option>
        <option value="error">Errors only</option>
        <option value="warn">Warnings+</option>
        <option value="debug">Debug+</option>
        <option value="flow">Flow+</option>
        <option value="api">SOQL/DML only</option>
      </select>
    </div>
    <div id="logsList"></div>
    <div id="logBody"></div>
  </section>`;

  function classifyLogLine(line) {
    const l = String(line || '').toUpperCase();
    if (/EXCEPTION|FATAL_ERROR|ERROR|CANNOT_|INVALID_|FAILED|ASSERT/.test(l)) return 'error';
    if (/WARN|WARNING|LIMIT_USAGE_FOR_NS|SOQL_EXECUTE_EXPLAIN/.test(l))        return 'warn';
    if (/USER_DEBUG|DEBUG\|/.test(l))                                           return 'debug';
    if (/FLOW_|INTERVIEW_|VALIDATION_|WORKFLOW|CODE_UNIT_STARTED|CODE_UNIT_FINISHED/.test(l)) return 'flow';
    if (/SOQL_EXECUTE|DML_BEGIN|DML_END|CALLOUT/.test(l))                       return 'api';
    if (/SUCCESS|FINISHED|COMMIT/.test(l))                                      return 'good';
    return 'neutral';
  }

  function renderPrettyLog(text) {
    const q   = $('#logFilter').value.toLowerCase();
    const sev = $('#severityFilter').value;
    const sevRank = { all:0, api:1, good:1, neutral:1, flow:2, debug:3, warn:4, error:5 };
    const minRank  = { all:0, api:0, soql:0, debug:3, warn:4, error:5, flow:2 }[sev] || 0;
    const lines = text.split(NL);
    const filtered = lines.filter(l => {
      if (q && !l.toLowerCase().includes(q)) return false;
      if (sev === 'all') return true;
      return (sevRank[classifyLogLine(l)] || 0) >= minRank;
    });
    return `<div class="log-viewer">${filtered.map(l => {
      const cls = classifyLogLine(l);
      return `<div class="log-line log-${cls}">${escapeHtml(l)}</div>`;
    }).join('')}</div><p class="muted" style="font-size:11px">${filtered.length} of ${lines.length} lines</p>`;
  }

  $('#loadLogs').onclick = async () => {
    try {
      const r = await requireApi().query(
        'SELECT Id, LogUser.Name, Operation, Request, StartTime, DurationMilliseconds, Status, LogLength FROM ApexLog ORDER BY StartTime DESC LIMIT 50'
      );
      const rows = r.records || [];
      $('#logsList').innerHTML = table(rows.map(l => ({
        User: l.LogUser?.Name || '',
        Operation: l.Operation,
        Age: timeAgo(l.StartTime),
        Duration: `${l.DurationMilliseconds}ms`,
        Size: `${Math.round(l.LogLength / 1024)}KB`,
        Status: l.Status
      })), id => `<button data-log-id="${escapeHtml(id)}">View</button><button class="secondary" data-dl-log="${escapeHtml(id)}">Download</button>`);

      // Bind buttons — use the actual record array for IDs
      rows.forEach((logRow, i) => {
        const viewBtns = document.querySelectorAll(`[data-log-id]`);
        const dlBtns   = document.querySelectorAll(`[data-dl-log]`);
        viewBtns.forEach(b => b.onclick = () => openLog(b.dataset.logId, false));
        dlBtns.forEach(b  => b.onclick  = () => openLog(b.dataset.dlLog, true));
      });
    } catch (e) { toast(e.message, 4000); }
  };

  // BUG FIX: use NL constant so this line doesn't get split by minifiers
  $('#copyExceptionSummary').onclick = async () => {
    const text = String(window._currentLogBody || '');
    if (!text) return toast('Open a log first.');
    const lines = text.split(NL).filter(l => /EXCEPTION|FATAL_ERROR|ERROR|ASSERT|CANNOT_|INVALID_/i.test(l)).slice(0, 80).join(NL);
    await navigator.clipboard.writeText(lines || 'No exception/error lines found.');
    toast('Exception summary copied.');
  };

  async function openLog(id, download = false) {
    try {
      // ApexLog Body is a blob endpoint — NOT a JSON field.
      // Fetching /sobjects/ApexLog/{id}/Body returns the raw log text.
      // We must request it via the REST streaming URL with Accept: text/plain.
      // The session bridge now returns raw text for non-JSON content-types.
      const orgUrl = requireApi().orgUrl;
      const bodyUrl = `${orgUrl}/services/data/v66.0/sobjects/ApexLog/${id}/Body`;
      
      // Use bridgeFetch directly so we bypass the JSON-parse layer in request()
      let text;
      if (requireApi().hasStoredSession) {
        // Stored-login orgs: fetch directly with Authorization header
        const resp = await fetch(bodyUrl, {
          headers: {
            'Authorization': `Bearer ${requireApi().org.sessionId}`,
            'Accept': 'text/plain'
          }
        });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching log body`);
        text = await resp.text();
      } else {
        // Tab-session orgs: route through the bridge with text/plain accept
        const result = await chrome.runtime.sendMessage({
          type: 'SF_API_REQUEST',
          tabId: requireApi().tabId,
          url: bodyUrl,
          method: 'GET',
          body: null,
          headers: { 'Accept': 'text/plain' }
        });
        if (!result?.ok) throw new Error(result?.errorLabel || 'Could not fetch log body');
        text = typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2);
      }

      window._currentLogBody = text || '';
      if (download) {
        chrome.runtime.sendMessage({ type: 'DOWNLOAD_TEXT', filename: `ApexLog-${id}.log`, mime: 'text/plain', content: text });
        toast('Log downloaded.');
      } else {
        $('#logBody').innerHTML = renderPrettyLog(text);
      }
    } catch (e) { toast(e.message, 4000); }
  }

  $('#logFilter').oninput    = () => { if (window._currentLogBody) $('#logBody').innerHTML = renderPrettyLog(window._currentLogBody); };
  $('#severityFilter').onchange = () => { if (window._currentLogBody) $('#logBody').innerHTML = renderPrettyLog(window._currentLogBody); };
}

// ── Flow Analyzer ─────────────────────────────────────────────────────────────
async function flow() {
  view().innerHTML = `<section class="card">
    <h3>Flow Analyzer <span class="badge info">All versions</span></h3>
    <div class="toolbar">
      <input id="flowFilter" placeholder="Filter by name…">
      <input id="flowObject" placeholder="Filter by object…">
      <select id="flowType">
        <option value="">All types</option>
        <option>AutoLaunchedFlow</option><option>Flow</option>
        <option>InvocableProcess</option><option>Workflow</option>
      </select>
      <button id="loadFlows">Load Flows</button>
      <button class="secondary" id="exportFlows">Export CSV</button>
    </div>
    <div id="flowProgress" class="muted" style="font-size:12px"></div>
    <div id="flowResult"></div>
    <div id="flowDetail"></div>
  </section>`;

  let allFlows = [];

  async function loadFlowRows() {
    $('#flowProgress').textContent = 'Loading…';
    let r;
    try {
      // FlowDefinitionView is Tooling API only — use toolingQueryAll
      r = await requireApi().toolingQueryAll(
        `SELECT Id, ApiName, Label, ProcessType, Status, ActiveVersionId, LatestVersionId, LastModifiedDate FROM FlowDefinitionView ORDER BY ApiName`,
        { maxRecords: 2000 }
      );
    } catch (e1) {
      // Fallback: some sandboxes restrict FlowDefinitionView — try FlowVersionView
      try {
        // Fallback: query Flow directly — Definition.Label does not exist on Flow object
        // Only Definition.DeveloperName is available as a relationship field
        r = await requireApi().toolingQueryAll(
          `SELECT Id, Definition.DeveloperName, ProcessType, Status, LastModifiedDate FROM Flow WHERE Status IN ('Active','Obsolete') ORDER BY Definition.DeveloperName`,
          { maxRecords: 2000 }
        );
        // Normalise to match FlowDefinitionView field names
        r.records = (r.records || []).map(f => ({
          ...f,
          ApiName: f.Definition?.DeveloperName || f.Id,
          Label:   f.Definition?.DeveloperName || f.Id,
          ActiveVersionId: f.Id
        }));
      } catch (e2) {
        throw new Error('Could not load flows. ' + e2.message);
      }
    }
    allFlows = r.records || [];
    $('#flowProgress').textContent = `${allFlows.length} flows loaded`;
    applyFilters();
  }

  function renderFlowRows(records) {
    return table(records.map(f => ({
      ApiName: f.ApiName, Label: f.Label, Type: f.ProcessType,
      Status: f.Status, Modified: timeAgo(f.LastModifiedDate)
    })), id => `<button data-inspect-flow="${escapeHtml(id)}">Inspect</button>`);
  }

  async function applyFilters() {
    const name = ($('#flowFilter').value || '').toLowerCase();
    const obj  = ($('#flowObject').value  || '').toLowerCase();
    const type = $('#flowType').value;
    let filtered = allFlows;
    if (name) filtered = filtered.filter(f => (f.ApiName || '').toLowerCase().includes(name) || (f.Label || '').toLowerCase().includes(name));
    if (obj)  filtered = filtered.filter(f => (f.ApiName || '').toLowerCase().includes(obj));
    if (type) filtered = filtered.filter(f => f.ProcessType === type);
    $('#flowResult').innerHTML = filtered.length ? renderFlowRows(filtered) : '<p class="muted">No flows match filters.</p>';
    document.querySelectorAll('[data-inspect-flow]').forEach(b => b.onclick = () => {
      const flowRec = allFlows.find(f => f.Id === b.dataset.inspectFlow);
      if (flowRec?.ActiveVersionId) inspectFlow(flowRec.ActiveVersionId, flowRec.Id);
      else if (flowRec?.Id) inspectFlow(flowRec.Id, flowRec.Id);
      else toast('No version to inspect.');
    });
  }

  async function inspectFlow(activeVersionId, definitionId) {
    try {
      const r = await requireApi().toolingQuery(
        `SELECT Id, ApiName, Description, ProcessType, Status, LastModifiedDate FROM Flow WHERE Id = '${activeVersionId}' LIMIT 1`
      );
      const f = r.records?.[0];
      if (!f) return toast('Flow version not found.');

      // Load all versions for this flow definition
      let versionsHtml = '';
      if (definitionId) {
        try {
          const vr = await requireApi().toolingQueryAll(
            `SELECT Id, VersionNumber, Status, LastModifiedDate FROM Flow WHERE DefinitionId = '${definitionId}' ORDER BY VersionNumber DESC`,
            { maxRecords: 50 }
          );
          const verRows = (vr.records||[]).map(v => {
            const isActive = v.Id === activeVersionId;
            const activateBtn = v.Status !== 'Active'
              ? `<button data-activate-ver="${escapeHtml(v.Id)}" style="font-size:11px;padding:2px 8px">Activate</button>`
              : '<span style="color:#4ade80;font-size:11px">● Active</span>';
            return `<tr style="${isActive?'background:rgba(139,92,246,.12)':''}">
              <td style="font-size:12px">v${v.VersionNumber}</td>
              <td style="font-size:12px">${v.Status}</td>
              <td style="font-size:12px">${timeAgo(v.LastModifiedDate)}</td>
              <td>${activateBtn}</td>
            </tr>`;
          }).join('');
          versionsHtml = `<h4 style="margin:12px 0 6px;font-size:13px">Version History</h4>
            <table class="table"><thead><tr><th>Version</th><th>Status</th><th>Modified</th><th>Action</th></tr></thead>
            <tbody>${verRows}</tbody></table>`;
        } catch(_) {}
      }

      $('#flowDetail').innerHTML = `<div style="margin-top:16px">
        <h3 style="font-size:14px;margin-bottom:8px">Flow: ${escapeHtml(f.ApiName || activeVersionId)}</h3>
        <div style="font-size:12px;color:var(--muted);margin-bottom:8px">
          Type: ${escapeHtml(f.ProcessType||'')} · Status: ${escapeHtml(f.Status||'')} · Modified: ${timeAgo(f.LastModifiedDate)}
          ${f.Description ? '<br>' + escapeHtml(f.Description) : ''}
        </div>
        ${versionsHtml}
      </div>`;

      document.querySelectorAll('[data-activate-ver]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('Activate this flow version? The currently active version will be deactivated.')) return;
          try {
            await requireApi().tooling(`/sobjects/Flow/${btn.dataset.activateVer}`, {
              method: 'PATCH', body: JSON.stringify({ Status: 'Active' })
            });
            toast('Flow version activated.');
            await loadFlowRows();
            inspectFlow(btn.dataset.activateVer, definitionId);
          } catch(e) { toast(e.message, 5000); }
        };
      });
    } catch (e) { toast(e.message, 4000); }
  }

  $('#loadFlows').onclick = async () => { try { await loadFlowRows(); } catch (e) { toast(e.message, 4000); } };
  $('#exportFlows').onclick = () => {
    if (!allFlows.length) return toast('Load flows first.');
    chrome.runtime.sendMessage({ type: 'DOWNLOAD_TEXT', filename: 'sf-forge-flows.csv', mime: 'text/csv', content: toCsv(allFlows) });
  };
  ['flowFilter','flowObject','flowType'].forEach(id => {
    const el = $(`#${id}`);
    if (el) { el.oninput = applyFilters; el.onchange = applyFilters; }
  });
}

// ── LWC Lens ──────────────────────────────────────────────────────────────────
async function lens() {
  const store = await chrome.storage.local.get('sfForge');
  const enabled = store.sfForge?.lensEnabled || false;
  view().innerHTML = `<section class="card">
    <h3>LWC Lens <span class="badge ${enabled ? 'ok' : 'warn'}">${enabled ? 'Active' : 'Inactive'}</span></h3>
    <p class="muted">Hover over Lightning components in the active Salesforce tab to see their API names, DOM paths, and component hierarchy.</p>
    <div class="toolbar">
      <button id="toggleLens">${enabled ? 'Disable LWC Lens' : 'Enable LWC Lens'}</button>
    </div>
    <ul class="muted" style="font-size:13px;margin-top:12px;padding-left:18px">
      <li>Hover a component — outline + floating info panel appears</li>
      <li>Right-click → copies component tag to clipboard</li>
      <li>Click the ⏸ (lock) button in the panel to freeze selection</li>
      <li>Requires the active tab to be a Salesforce Lightning page</li>
    </ul>
    <h4 style="margin:16px 0 8px">Component Source Peek</h4>
    <p class="muted">Look up any LWC bundle by developer name and preview its source.</p>
    <div class="toolbar">
      <input id="lensComponentName" placeholder="DeveloperName, e.g. myComponent">
      <button id="peekComponent">Peek Source</button>
    </div>
    <div id="peekResult"></div>
  </section>`;

  $('#peekComponent').onclick = async () => {
    const name = $('#lensComponentName').value.trim();
    if (!name) return toast('Enter a component DeveloperName.');
    const res = $('#peekResult');
    res.innerHTML = '<p class="muted">Fetching…</p>';
    try {
      const r = await requireApi().toolingQuery(
        `SELECT Id, DeveloperName, MasterLabel, ApiVersion FROM LightningComponentBundle WHERE DeveloperName = '${safeLike(name)}' LIMIT 1`
      );
      const bundle = r.records?.[0];
      if (!bundle) { res.innerHTML = `<p class="error-note">No LWC bundle found with DeveloperName "${escapeHtml(name)}".</p>`; return; }
      // Fetch bundle source files
      const files = await requireApi().toolingQuery(
        `SELECT Id, FilePath, Source, Format FROM LightningComponentResource WHERE LightningComponentBundleId = '${bundle.Id}' ORDER BY FilePath`
      );
      if (!files.records?.length) { res.innerHTML = '<p class="muted">Bundle found but no source files returned.</p>'; return; }
      const tabs = files.records.map((f,i) => {
        const fname = f.FilePath?.split('/').pop() || f.Id;
        const ext = fname.split('.').pop();
        return `<button class="secondary" data-peek-tab="${i}" style="font-size:11px;padding:3px 10px;margin-right:4px">${escapeHtml(fname)}</button>`;
      }).join('');
      const bodies = files.records.map((f,i) =>
        `<pre id="peekSrc${i}" style="display:${i===0?'block':'none'};font-size:11px;overflow:auto;max-height:320px;background:var(--panel2);padding:10px;border-radius:6px">${escapeHtml(f.Source||'')}</pre>`
      ).join('');
      res.innerHTML = `<p style="font-size:12px;color:var(--muted);margin-bottom:6px">
        <b>${escapeHtml(bundle.MasterLabel)}</b> · API v${bundle.ApiVersion} · ${files.records.length} file${files.records.length!==1?'s':''}
      </p>${tabs}${bodies}`;
      res.querySelectorAll('[data-peek-tab]').forEach(btn => {
        btn.onclick = () => {
          files.records.forEach((_,j) => { const el = document.getElementById(`peekSrc${j}`); if(el) el.style.display = 'none'; });
          const el = document.getElementById(`peekSrc${btn.dataset.peekTab}`);
          if (el) el.style.display = 'block';
        };
      });
    } catch(e) { res.innerHTML = `<p class="error-note">${escapeHtml(e.message)}</p>`; }
  };

  $('#toggleLens').onclick = async () => {
    const tabOrg = orgs.find(o => o.active) || orgs[0];
    if (!tabOrg?.tabId) return toast('Open a Salesforce Lightning tab first, then Detect Orgs.');
    const tabId = tabOrg.tabId;
    const next  = !enabled;
    await chrome.storage.local.set({ sfForge: { ...(store.sfForge || {}), lensEnabled: next } });
    try {
      try { await chrome.tabs.sendMessage(tabId, { type: 'SF_FORGE_LENS_PING' }); }
      catch (_) {
        await chrome.scripting.insertCSS({ target: { tabId }, files: ['src/content/lwc-lens.css'] }).catch(() => {});
        await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/lwc-lens.js'] });
      }
      await chrome.tabs.sendMessage(tabId, { type: 'SF_FORGE_LENS_TOGGLE', enabled: next });
      toast(`LWC Lens ${next ? 'enabled' : 'disabled'}`);
      active = 'lens'; render();
    } catch (e) { toast(`Lens error: ${e.message}`, 4000); }
  };
}

// ── Bulk Field Creator ─────────────────────────────────────────────────────────
async function bulk() {
  const fieldTypes = ['Text','Number','Currency','Percent','Date','DateTime','Checkbox','Picklist','TextArea','LongTextArea','Email','Phone','Url','Formula','Lookup'];
  const formulaReturnTypes = ['Text','Number','Currency','Percent','Date','DateTime','Checkbox'];

  view().innerHTML = `<section class="card">
    <h3>Bulk Field Creator <span class="badge info">CSV · Paste · Grid</span></h3>
    <p class="muted">Create custom fields in bulk via the Tooling API. Supports CSV upload, paste, and manual grid entry.</p>
    <div class="toolbar">
      <button id="loadObjsBulk">Load Objects</button>
      <div id="objectSelectWrap"></div>
      <button class="secondary" id="addRow">Add Row</button>
      <button class="secondary" id="downloadTemplate">CSV Template</button>
    </div>
    <div class="field"><label>Paste CSV</label><textarea id="csvPaste" placeholder="Label,API Name,Type,Required,Description"></textarea></div>
    <div class="toolbar">
      <button id="parseCsv">Parse CSV</button>
      <button class="secondary" id="validateOnly">Validate Only</button>
      <button id="createFields">Create Fields</button>
    </div>
    <div id="bulkGrid"></div>
    <div id="bulkProgress"></div>
  </section>`;

  let selectedObj = '';

  async function loadObjectsForBulk() {
    const wrap = $('#objectSelectWrap');
    wrap.innerHTML = '<span class="muted" style="font-size:12px">Loading objects…</span>';
    try {
      const r = await requireApi().describeGlobal();
      const sobjs = r.sobjects.filter(o => o.customizable).sort((a,b) => a.label.localeCompare(b.label));
      const opts  = sobjs.map(o => `<option value="${escapeHtml(o.name)}">${escapeHtml(o.label)} (${escapeHtml(o.name)})</option>`).join('');
      wrap.innerHTML = `<select id="bulkObject" style="min-width:200px"><option value="">— Select object —</option>${opts}</select>`;
      const sel = $('#bulkObject');
      // Set to previously selected value if still valid
      if (selectedObj && sobjs.some(o => o.name === selectedObj)) sel.value = selectedObj;
      sel.onchange = () => {
        selectedObj = sel.value;
        // Update all Object cells in the grid to the newly selected object
        document.querySelectorAll('[data-cell="Object"]').forEach(el => { if (!el.value) el.value = selectedObj; });
      };
      toast(`${sobjs.length} objects loaded`);
    } catch (e) {
      wrap.innerHTML = '<span class="error-note" style="font-size:12px">Could not load objects — is an org connected?</span>';
      toast(e.message, 4000);
    }
  }

  function objectSelect(value='') { return `<input data-cell="Object" value="${escapeHtml(value || selectedObj)}" placeholder="Object API Name">`; }
  function typeSelect(v='Text') { return `<select data-cell="Type">${fieldTypes.map(t=>`<option ${v===t?'selected':''}>${t}</option>`).join('')}</select>`; }
  function boolSelect(col, v='false') { const b=/^(true|yes|y|1)$/i.test(String(v||'').trim()); return `<select data-cell="${escapeHtml(col)}"><option value="false" ${!b?'selected':''}>No</option><option value="true" ${b?'selected':''}>Yes</option></select>`; }

  function renderGrid() {
    const rows = window._bulkRows || [];
    if (!rows.length) { $('#bulkGrid').innerHTML = '<p class="muted">Add a row or parse CSV above.</p>'; return; }
    const cols = ['Object','Label','API Name','Type','Required','Related Object','Relationship Name','Picklist Values','Description'];
    const head = ['Object','Label','API Name','Type','Req','Related To','Rel. Name','Picklist Vals','Desc',''].map(c=>`<th style="font-size:11px">${c}</th>`).join('');
    const body = rows.map((r,i)=>{
      const type = r['Type'] || 'Text';
      const isLookup = /lookup|masterdetail/i.test(type);
      const isPick   = /picklist/i.test(type);
      return `<tr data-row="${i}">
        <td>${objectSelect(r['Object'])}</td>
        <td><input data-cell="Label" value="${escapeHtml(r['Label']||'')}" style="width:90px"></td>
        <td><input data-cell="API Name" value="${escapeHtml(r['API Name']||'')}" style="width:90px"></td>
        <td>${typeSelect(r['Type'])}</td>
        <td>${boolSelect('Required', r['Required'])}</td>
        <td><input data-cell="Related Object" value="${escapeHtml(r['Related Object']||'')}" placeholder="${isLookup?'Account':''}" style="width:80px;${isLookup?'':'opacity:.4'}" ${isLookup?'':'disabled'}></td>
        <td><input data-cell="Relationship Name" value="${escapeHtml(r['Relationship Name']||'')}" placeholder="${isLookup?'MyRelationship':''}" style="width:90px;${isLookup?'':'opacity:.4'}" ${isLookup?'':'disabled'}></td>
        <td><input data-cell="Picklist Values" value="${escapeHtml(r['Picklist Values']||'')}" placeholder="${isPick?'Val1,Val2,Val3':'—'}" style="width:90px;${isPick?'':'opacity:.4'}" ${isPick?'':'disabled'}></td>
        <td><input data-cell="Description" value="${escapeHtml(r['Description']||'')}" style="width:80px"></td>
        <td><button data-del-row="${i}">✕</button></td>
      </tr>`;
    }).join('');
    const wrap = document.createElement('div');
    wrap.style.cssText = 'overflow-x:auto;width:100%';
    const tbl = document.createElement('table');
    tbl.className = 'table';
    tbl.style.tableLayout = 'auto';
    tbl.innerHTML = `<thead><tr>${head}</tr></thead><tbody>${body}</tbody>`;
    wrap.appendChild(tbl);
    $('#bulkGrid').innerHTML = '';
    $('#bulkGrid').appendChild(wrap);
    document.querySelectorAll('[data-del-row]').forEach(b => b.onclick = () => { window._bulkRows.splice(parseInt(b.dataset.delRow),1); renderGrid(); });
    // Re-enable/disable related object and picklist fields based on type selection
    document.querySelectorAll('[data-cell="Type"]').forEach(sel => {
      sel.onchange = () => {
        const tr = sel.closest('tr');
        const isLookup = /lookup|masterdetail/i.test(sel.value);
        const isPick   = /picklist/i.test(sel.value);
        tr.querySelectorAll('[data-cell="Related Object"],[data-cell="Relationship Name"]').forEach(el => {
          el.disabled = !isLookup; el.style.opacity = isLookup ? '1' : '.4';
          if (!isLookup) el.value = '';
        });
        tr.querySelectorAll('[data-cell="Picklist Values"]').forEach(el => {
          el.disabled = !isPick; el.style.opacity = isPick ? '1' : '.4';
          if (!isPick) el.value = '';
        });
      };
    });
  }

  function collectGrid() {
    const rows = [];
    document.querySelectorAll('#bulkGrid tbody tr[data-row]').forEach(tr => {
      const r = {};
      tr.querySelectorAll('[data-cell]').forEach(el => { r[el.dataset.cell] = el.value; });
      rows.push(r);
    });
    return rows;
  }

  function csvParse(text) {
    const lines = text.trim().split(NL).filter(Boolean);
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h=>h.trim());
    return lines.slice(1).map(l => {
      const vals = l.split(',').map(v=>v.trim().replace(/^"|"$/g,''));
      const r = {};
      headers.forEach((h,i)=> { r[h] = vals[i]||''; });
      return r;
    });
  }

  function normalizeType(t='Text') {
    const map = { text:'Text',number:'Number',currency:'Currency',percent:'Percent',date:'Date',datetime:'DateTime',checkbox:'Checkbox',picklist:'Picklist',textarea:'TextArea',longtextarea:'LongTextArea',email:'Email',phone:'Phone',url:'Url',formula:'Formula',lookup:'Lookup' };
    return map[(t||'').toLowerCase().replace(/\s/g,'')] || 'Text';
  }

  function apiName(name) { return String(name||'').trim().replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'') + (name.endsWith('__c') ? '' : '__c'); }
  function bool(v) { return /^(true|yes|y|1)$/i.test(String(v||'').trim()); }

  function buildCustomFieldPayload(r) {
    const type   = normalizeType(r['Type']);
    const label  = String(r['Label']||'').trim();
    const aname  = apiName(r['API Name'] || label);
    const payload = { fullName: `${r['Object']||selectedObj}.${aname}`, label, type, required: bool(r['Required']) };
    if (r['Description']) payload.description = r['Description'];
    if (type === 'Text')          payload.length = 255;
    if (type === 'LongTextArea')  { payload.length = 32768; payload.visibleLines = 5; }
    if (type === 'TextArea')      payload.visibleLines = 3;
    if (type === 'Number' || type === 'Currency' || type === 'Percent') { payload.precision = 18; payload.scale = 2; }
    if (type === 'Lookup' || type === 'MasterDetail') {
      const relObj = (r['Related Object']||'').trim();
      const relName = (r['Relationship Name']||'').trim() || aname.replace(/__c$/,'');
      if (!relObj) throw new Error(`Field "${label}": Related Object is required for Lookup/MasterDetail fields.`);
      payload.referenceTo = relObj;
      payload.relationshipName = relName;
    }
    if (type === 'Picklist' && r['Picklist Values']) {
      const vals = r['Picklist Values'].split(',').map(v=>v.trim()).filter(Boolean);
      payload.valueSet = { restricted: false, valueSetDefinition: { sorted: false, value: vals.map((v,i) => ({ fullName: v, label: v, default: i===0 })) } };
    }
    return payload;
  }

  window._bulkRows = window._bulkRows || [];

  $('#loadObjsBulk').onclick = loadObjectsForBulk;
  // Auto-load objects from the connected org immediately
  if (api) loadObjectsForBulk();
  $('#addRow').onclick = () => { window._bulkRows.push({'Object':selectedObj,'Label':'','API Name':'','Type':'Text','Required':'false','Description':''}); renderGrid(); };
  $('#downloadTemplate').onclick = () => chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'sf-forge-bulk-template.csv', mime:'text/csv', content:'Object,Label,API Name,Type,Required,Description\nAccount,My Field,My_Field__c,Text,false,A custom field' });
  $('#parseCsv').onclick = () => { const rows = csvParse($('#csvPaste').value); if (!rows.length) return toast('No rows found in CSV.'); window._bulkRows = rows; renderGrid(); toast(`${rows.length} rows parsed.`); };

  async function runCreate(validateMode) {
    const rows = collectGrid();
    if (!rows.length) return toast('Add rows to the grid first.');
    const prog = $('#bulkProgress');
    prog.innerHTML = '';
    let ok=0, fail=0;
    for (const r of rows) {
      const label = r['Label'] || '(unnamed)';
      const li = document.createElement('div');
      li.className = 'muted';
      li.textContent = validateMode ? `Validating: ${label}…` : `Creating: ${label}…`;
      prog.appendChild(li);
      if (validateMode) {
        try { buildCustomFieldPayload(r); li.textContent = `✓ ${label} — payload valid`; li.className='badge ok'; ok++; }
        catch (e) { li.textContent = `✗ ${label} — ${e.message}`; li.className='badge danger'; fail++; }
        continue;
      }
      try {
        const payload = buildCustomFieldPayload(r);
        await requireApi().tooling('/sobjects/CustomField', { method:'POST', body: JSON.stringify(payload) });
        li.textContent = `✓ ${label} created`; li.className='badge ok'; ok++;
      } catch (e) { li.textContent = `✗ ${label} — ${e.message}`; li.className='badge danger'; fail++; }
    }
    toast(validateMode ? `Validation: ${ok} valid, ${fail} errors` : `Created ${ok} field${ok===1?'':'s'}, ${fail} error${fail===1?'':'s'}`);
  }

  $('#validateOnly').onclick = () => runCreate(true);
  $('#createFields').onclick = () => runCreate(false);
  renderGrid();
}

// ── Permission Inspector — Enhancement #15: FLS grid ─────────────────────────
async function permissions() {
  view().innerHTML = `<section class="card">
    <h3>Permission Inspector <span class="badge info">Object + FLS</span></h3>
    <p class="muted">Compare object, field-level security (FLS), Apex class, and flow access for Profiles and Permission Sets.</p>
    <div class="toolbar">
      <input id="permNames" placeholder="Permission Set/Profile names comma-separated, e.g. System Administrator">
      <input id="permObject" placeholder="Object API name, e.g. Account">
      <button id="runPermCompare">Compare Object Access</button>
      <button class="secondary" id="runFlsCompare">Compare FLS</button>
      <button class="secondary" id="exportPermCompare">Export CSV</button>
    </div>
    <div id="permResult"></div>
    <div id="flsResult"></div>
  </section>`;

  let lastObj = [], lastFls = [];

  $('#runPermCompare').onclick = async () => {
    try {
      const names      = $('#permNames').value.split(',').map(x=>x.trim()).filter(Boolean);
      const objectName = $('#permObject').value.trim();
      if (!names.length || !objectName) throw new Error('Enter at least one Profile/Permission Set name and an Object API name.');
      const quoted = names.map(n=>`'${safeLike(n)}'`).join(',');
      const ps     = await requireApi().toolingQueryAll(`SELECT Id, Name, Label, IsOwnedByProfile, Profile.Name FROM PermissionSet WHERE Name IN (${quoted}) OR Label IN (${quoted}) OR Profile.Name IN (${quoted})`, { maxRecords: 200 });
      const rows   = [];
      for (const pset of ps.records || []) {
        const op = await requireApi().toolingQuery(`SELECT PermissionsRead,PermissionsCreate,PermissionsEdit,PermissionsDelete,PermissionsViewAllRecords,PermissionsModifyAllRecords FROM ObjectPermissions WHERE ParentId='${pset.Id}' AND SobjectType='${safeLike(objectName)}' LIMIT 1`);
        rows.push({
          Name: pset.Label || pset.Name || pset.Profile?.Name,
          Type: pset.IsOwnedByProfile ? 'Profile' : 'Permission Set',
          Object: objectName,
          Read:       !!op.records?.[0]?.PermissionsRead,
          Create:     !!op.records?.[0]?.PermissionsCreate,
          Edit:       !!op.records?.[0]?.PermissionsEdit,
          Delete:     !!op.records?.[0]?.PermissionsDelete,
          ViewAll:    !!op.records?.[0]?.PermissionsViewAllRecords,
          ModifyAll:  !!op.records?.[0]?.PermissionsModifyAllRecords
        });
      }
      lastObj = rows;
      $('#permResult').innerHTML = `<h4 style="margin:12px 0 4px">Object-level permissions</h4>${table(rows)}`;
    } catch (e) { toast(e.message, 5000, { copyText: e.message }); }
  };

  // Enhancement #15: Field-level security grid
  $('#runFlsCompare').onclick = async () => {
    try {
      const names      = $('#permNames').value.split(',').map(x=>x.trim()).filter(Boolean);
      const objectName = $('#permObject').value.trim();
      if (!names.length || !objectName) throw new Error('Enter Profile/Permission Set names and an object name.');
      const quoted = names.map(n=>`'${safeLike(n)}'`).join(',');
      const ps     = await requireApi().toolingQueryAll(`SELECT Id, Name, Label, IsOwnedByProfile FROM PermissionSet WHERE Name IN (${quoted}) OR Label IN (${quoted})`, { maxRecords: 200 });
      const psIds  = (ps.records||[]).map(p=>p.Id);
      if (!psIds.length) return toast('No matching permission sets found.');
      const psNames = Object.fromEntries(ps.records.map(p=>[p.Id, p.Label||p.Name]));
      const flsData = await requireApi().toolingQueryAll(
        `SELECT ParentId, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE ParentId IN (${psIds.map(i=>`'${i}'`).join(',')}) AND SobjectType='${safeLike(objectName)}' ORDER BY Field`,
        { maxRecords: 5000 }
      );
      // Build field matrix
      const fieldMap = {};
      for (const rec of flsData.records || []) {
        if (!fieldMap[rec.Field]) fieldMap[rec.Field] = {};
        fieldMap[rec.Field][rec.ParentId] = { read: rec.PermissionsRead, edit: rec.PermissionsEdit };
      }
      const fields  = Object.keys(fieldMap).sort();
      const psArray = ps.records || [];
      const rows = fields.map(field => {
        const row = { Field: field };
        psArray.forEach(p => {
          const d = fieldMap[field][p.Id] || { read: false, edit: false };
          row[`${psNames[p.Id]} R`] = d.read ? '✓' : '—';
          row[`${psNames[p.Id]} E`] = d.edit ? '✓' : '—';
        });
        return row;
      });
      lastFls = rows;
      $('#flsResult').innerHTML = `<h4 style="margin:12px 0 4px">Field-level security: ${escapeHtml(objectName)} (${fields.length} fields)</h4>${table(rows)}`;
    } catch (e) { toast(e.message, 5000, { copyText: e.message }); }
  };

  $('#exportPermCompare').onclick = () => {
    const data = [...lastObj, ...lastFls];
    if (!data.length) return toast('Run a comparison first.');
    chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'sf-forge-permission-compare.csv', mime:'text/csv', content:toCsv(data) });
  };
}

// ── Permission Lens — v6: Full diff, copy, bulk user access ──────────────────
async function permLens() {
  view().innerHTML = `<section class="card">
    <h3>Permission Lens <span class="badge info">v6 — Diff · Copy · Bulk Assign</span></h3>
    <p class="muted">Compare, copy, and manage Salesforce permissions — Profiles and Permission Sets — without leaving this panel.</p>
    <div class="toolbar" style="margin-bottom:8px">
      <button id="plTabDiff"   class="pl-tab active-tab">⇄ Permission Diff</button>
      <button id="plTabCopy"   class="pl-tab">⇢ Permission Copy</button>
      <button id="plTabUsers"  class="pl-tab">👥 User Access</button>
    </div>

    <!-- DIFF PANEL -->
    <div id="plDiff">
      <p class="muted" style="margin-bottom:12px">Enter two Profiles or Permission Set names to compare side-by-side. Differences are highlighted.</p>
      <div class="toolbar">
        <input id="plLeft"  placeholder="Left — Profile or Permission Set name" style="flex:1">
        <input id="plRight" placeholder="Right — Profile or Permission Set name" style="flex:1">
      </div>
      <div class="toolbar">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px">
          <input type="checkbox" id="plDiffOnly"> Differences only
        </label>
        <input id="plDiffSearch" placeholder="Search field / permission name…" style="max-width:220px">
        <button id="plRunDiff">Compare</button>
        <button class="secondary" id="plExportDiffCSV">Export CSV</button>
        <button class="secondary" id="plExportDiffJSON">Export JSON</button>
      </div>
      <div id="plDiffTabs" style="display:flex;gap:8px;margin:10px 0;flex-wrap:wrap"></div>
      <div id="plDiffResult"></div>
    </div>

    <!-- COPY PANEL -->
    <div id="plCopy" style="display:none">
      <p class="muted" style="margin-bottom:12px">Copy selected permission categories from one Profile or Permission Set to another.</p>
      <div class="toolbar">
        <input id="plCopySrc"  placeholder="Source Permission Set / Profile name" style="flex:1">
        <input id="plCopyDest" placeholder="Destination Permission Set name"      style="flex:1">
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap;margin:10px 0">
        <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="plCopyObj"  checked> Object Permissions</label>
        <label style="display:flex;align-items:center;gap=6px;font-size:13px"><input type="checkbox" id="plCopyFls"  checked> Field-Level Security</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="plCopySys"  checked> System Permissions</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="plCopyApex" checked> Apex Class Access</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" id="plCopyVf"   checked> Visualforce Access</label>
      </div>
      <div class="toolbar">
        <input id="plCopyObj_filter" placeholder="Filter by object name (optional)" style="max-width:280px">
        <button id="plRunCopy">Copy Permissions</button>
      </div>
      <div id="plCopyResult"></div>
    </div>

    <!-- USER ACCESS PANEL -->
    <div id="plUsers" style="display:none">
      <p class="muted" style="margin-bottom:12px">Copy permission sets from one user to multiple users, or directly assign selected permission sets to a group of users.</p>
      <div style="border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px;background:var(--panel2)">
        <b style="font-size:13px">Option A — Copy access from a source user</b>
        <div class="toolbar" style="margin-top:8px">
          <input id="plUserSrc" placeholder="Source username or Id" style="flex:1">
          <button id="plLoadUserPerms">Load Permissions</button>
        </div>
        <div id="plUserPermList"></div>
      </div>
      <div style="border:1px solid var(--line);border-radius:14px;padding:14px;margin-bottom:12px;background:var(--panel2)">
        <b style="font-size:13px">Option B — Assign Permission Sets directly</b>
        <div class="toolbar" style="margin-top:8px">
          <input id="plPsSearch" placeholder="Permission Set name(s) comma-separated" style="flex:1">
          <button id="plFindPs">Find Permission Sets</button>
        </div>
        <div id="plPsList"></div>
      </div>
      <div style="border:1px solid var(--line);border-radius:14px;padding:14px;background:var(--panel2)">
        <b style="font-size:13px">Target Users</b>
        <div class="toolbar" style="margin-top:8px">
          <textarea id="plTargetUsers" placeholder="Usernames or Ids — one per line" style="min-height:80px;flex:1"></textarea>
        </div>
        <div class="toolbar">
          <button id="plAssignPerms">Assign to All Target Users</button>
          <span id="plAssignStatus" class="muted" style="font-size:12px"></span>
        </div>
        <div id="plAssignProgress"></div>
      </div>
    </div>
  </section>`;

  // ─ Tab switching ─────────────────────────────────────────────────────────
  function showTab(id) {
    ['plDiff','plCopy','plUsers'].forEach(p => document.getElementById(p).style.display = p === id ? '' : 'none');
    ['plTabDiff','plTabCopy','plTabUsers'].forEach(b => {
      const btn = document.getElementById(b);
      if (btn) btn.classList.toggle('active-tab', b === 'plTab' + id.replace('pl','').charAt(0).toUpperCase() + id.replace('pl','').slice(1));
    });
  }
  // Map button ids to panel ids
  const tabMap = { plTabDiff:'plDiff', plTabCopy:'plCopy', plTabUsers:'plUsers' };
  ['plTabDiff','plTabCopy','plTabUsers'].forEach(tid => {
    document.getElementById(tid).onclick = () => {
      document.querySelectorAll('.pl-tab').forEach(b => b.classList.remove('active-tab'));
      document.getElementById(tid).classList.add('active-tab');
      showTab(tabMap[tid]);
    };
  });

  // ─ DIFF logic ────────────────────────────────────────────────────────────
  let diffData = { obj:[], fls:[], sys:[], apex:[], vf:[] };
  let activeDiffTab = 'obj';

  async function resolvePset(name) {
    const quoted = `'${safeLike(name)}'`;
    const r = await requireApi().toolingQueryAll(
      `SELECT Id, Name, Label, IsOwnedByProfile, Profile.Name FROM PermissionSet WHERE Name=${quoted} OR Label=${quoted} OR Profile.Name=${quoted} LIMIT 5`,
      { maxRecords: 5 }
    );
    if (!r.records?.length) throw new Error(`Cannot find Profile/PermSet: "${name}"`);
    return r.records[0];
  }

  function diffIcon(l, r) {
    if (l === r) return `<span style="color:#4ade80">≡</span>`;
    return `<span style="color:#f87171">≠</span>`;
  }

  function boolCell(v) {
    return v ? `<span style="color:#4ade80">✓</span>` : `<span style="color:#f87171">—</span>`;
  }

  function renderDiffTable(rows, cols, leftName, rightName, diffOnly, search) {
    if (!rows.length) return '<p class="muted">No data found.</p>';
    let filtered = rows;
    if (diffOnly) filtered = filtered.filter(r => r.__diff);
    if (search)   filtered = filtered.filter(r => r.__key?.toLowerCase().includes(search.toLowerCase()));
    if (!filtered.length) return '<p class="muted">No differences found matching your filters.</p>';

    const thStyle = 'style="color:var(--purple2);padding:9px;text-align:left;border-bottom:1px solid var(--line)"';
    const tdStyle = 'style="padding:8px 9px;border-bottom:1px solid var(--line)"';
    const header = `<tr><th ${thStyle}>Name</th><th ${thStyle}>${escapeHtml(leftName)}</th><th ${thStyle}>${escapeHtml(rightName)}</th><th ${thStyle}>Δ</th></tr>`;
    const body = filtered.map(row => {
      const rowBg = row.__diff ? 'background:rgba(239,68,68,.07)' : '';
      const cells = cols.map(c => {
        const lv = row.left?.[c]; const rv = row.right?.[c];
        const lStr = lv !== undefined ? String(lv) : '—';
        const rStr = rv !== undefined ? String(rv) : '—';
        const diff  = lStr !== rStr;
        return `<td ${tdStyle}>${typeof lv === 'boolean' ? boolCell(lv) : escapeHtml(lStr)}</td>`+
               `<td ${tdStyle}>${typeof rv === 'boolean' ? boolCell(rv) : escapeHtml(rStr)}</td>`+
               `<td ${tdStyle}>${diffIcon(lStr, rStr)}</td>`;
      }).join('');
      return `<tr style="${rowBg}"><td ${tdStyle} style="font-weight:500;${rowBg}">${escapeHtml(row.__key)}</td>${cells}</tr>`;
    }).join('');
    return `<table class="table" style="font-size:12px"><thead>${header}</thead><tbody>${body}</tbody></table>`;
  }

  $('#plRunDiff').onclick = async () => {
    const leftName  = $('#plLeft').value.trim();
    const rightName = $('#plRight').value.trim();
    if (!leftName || !rightName) return toast('Enter both Profile/Permission Set names.');
    const btn = $('#plRunDiff');
    btn.disabled = true; btn.textContent = 'Comparing…';
    $('#plDiffResult').innerHTML = '<p class="muted">Fetching permission data…</p>';
    try {
      const [lp, rp] = await Promise.all([resolvePset(leftName), resolvePset(rightName)]);

      // Object Permissions
      const [loRes, roRes] = await Promise.all([
        requireApi().toolingQueryAll(`SELECT SobjectType,PermissionsRead,PermissionsCreate,PermissionsEdit,PermissionsDelete,PermissionsViewAllRecords,PermissionsModifyAllRecords FROM ObjectPermissions WHERE ParentId='${lp.Id}'`,{maxRecords:500}),
        requireApi().toolingQueryAll(`SELECT SobjectType,PermissionsRead,PermissionsCreate,PermissionsEdit,PermissionsDelete,PermissionsViewAllRecords,PermissionsModifyAllRecords FROM ObjectPermissions WHERE ParentId='${rp.Id}'`,{maxRecords:500})
      ]);
      const loMap = Object.fromEntries((loRes.records||[]).map(r=>[r.SobjectType,r]));
      const roMap = Object.fromEntries((roRes.records||[]).map(r=>[r.SobjectType,r]));
      const allObjects = [...new Set([...Object.keys(loMap),...Object.keys(roMap)])].sort();
      diffData.obj = allObjects.map(obj => {
        const l = loMap[obj]||{}, r = roMap[obj]||{};
        const fields = ['PermissionsRead','PermissionsCreate','PermissionsEdit','PermissionsDelete','PermissionsViewAllRecords','PermissionsModifyAllRecords'];
        const __diff = fields.some(f => !!l[f] !== !!r[f]);
        return { __key: obj, __diff, left: { R:!!l.PermissionsRead,C:!!l.PermissionsCreate,E:!!l.PermissionsEdit,D:!!l.PermissionsDelete,VA:!!l.PermissionsViewAllRecords,MA:!!l.PermissionsModifyAllRecords }, right: { R:!!r.PermissionsRead,C:!!r.PermissionsCreate,E:!!r.PermissionsEdit,D:!!r.PermissionsDelete,VA:!!r.PermissionsViewAllRecords,MA:!!r.PermissionsModifyAllRecords } };
      });

      // System Permissions
      const [lsRes, rsRes] = await Promise.all([
        requireApi().toolingQueryAll(`SELECT Id FROM PermissionSet WHERE Id='${lp.Id}'`,{maxRecords:1}),
        requireApi().toolingQueryAll(`SELECT Id FROM PermissionSet WHERE Id='${rp.Id}'`,{maxRecords:1})
      ]);
      // Fetch full perm set with system perms via REST describe
      const SYS_PERMS = ['PermissionsApiEnabled','PermissionsAuthorApex','PermissionsManageUsers','PermissionsViewSetup','PermissionsModifyAllData','PermissionsViewAllData','PermissionsRunReports','PermissionsViewAllUsers','PermissionsManageSandboxes','PermissionsScheduleApex'];
      const [lsFullRes, rsFullRes] = await Promise.all([
        requireApi().toolingQuery(`SELECT ${SYS_PERMS.join(',')} FROM PermissionSet WHERE Id='${lp.Id}' LIMIT 1`),
        requireApi().toolingQuery(`SELECT ${SYS_PERMS.join(',')} FROM PermissionSet WHERE Id='${rp.Id}' LIMIT 1`)
      ]);
      const ls = lsFullRes.records?.[0]||{}, rs = rsFullRes.records?.[0]||{};
      diffData.sys = SYS_PERMS.map(perm => {
        const lv = !!ls[perm], rv = !!rs[perm];
        return { __key: perm.replace('Permissions',''), __diff: lv !== rv, left:{V:lv}, right:{V:rv} };
      });

      // Apex Class Access
      const [laRes, raRes] = await Promise.all([
        requireApi().toolingQueryAll(`SELECT ApexClassId, ApexClass.Name FROM SetupEntityAccess WHERE ParentId='${lp.Id}' AND SetupEntityType='ApexClass' ORDER BY ApexClass.Name`,{maxRecords:2000}),
        requireApi().toolingQueryAll(`SELECT ApexClassId, ApexClass.Name FROM SetupEntityAccess WHERE ParentId='${rp.Id}' AND SetupEntityType='ApexClass' ORDER BY ApexClass.Name`,{maxRecords:2000})
      ]);
      const laSet = new Set((laRes.records||[]).map(r=>r.ApexClass?.Name||r.ApexClassId));
      const raSet = new Set((raRes.records||[]).map(r=>r.ApexClass?.Name||r.ApexClassId));
      const allApex = [...new Set([...laSet,...raSet])].sort();
      diffData.apex = allApex.map(name => ({
        __key: name, __diff: laSet.has(name) !== raSet.has(name),
        left:{Access: laSet.has(name)}, right:{Access: raSet.has(name)}
      }));

      // Visualforce Access
      const [lvRes, rvRes] = await Promise.all([
        requireApi().toolingQueryAll(`SELECT SetupEntityId, SetupEntity.Name FROM SetupEntityAccess WHERE ParentId='${lp.Id}' AND SetupEntityType='ApexPage' ORDER BY SetupEntity.Name`,{maxRecords:2000}),
        requireApi().toolingQueryAll(`SELECT SetupEntityId, SetupEntity.Name FROM SetupEntityAccess WHERE ParentId='${rp.Id}' AND SetupEntityType='ApexPage' ORDER BY SetupEntity.Name`,{maxRecords:2000})
      ]);
      const lvSet = new Set((lvRes.records||[]).map(r=>r.SetupEntity?.Name||r.SetupEntityId));
      const rvSet = new Set((rvRes.records||[]).map(r=>r.SetupEntity?.Name||r.SetupEntityId));
      const allVf = [...new Set([...lvSet,...rvSet])].sort();
      diffData.vf = allVf.map(name => ({
        __key: name, __diff: lvSet.has(name) !== rvSet.has(name),
        left:{Access: lvSet.has(name)}, right:{Access: rvSet.has(name)}
      }));

      const diffCounts = {
        obj:  diffData.obj.filter(r=>r.__diff).length,
        sys:  diffData.sys.filter(r=>r.__diff).length,
        apex: diffData.apex.filter(r=>r.__diff).length,
        vf:   diffData.vf.filter(r=>r.__diff).length
      };

      // Render tab bar
      const tabs = [
        {id:'obj',  label:`Objects (${diffCounts.obj} diff)`},
        {id:'sys',  label:`System Perms (${diffCounts.sys} diff)`},
        {id:'apex', label:`Apex Access (${diffCounts.apex} diff)`},
        {id:'vf',   label:`VF Access (${diffCounts.vf} diff)`}
      ];
      $('#plDiffTabs').innerHTML = tabs.map(t =>
        `<button class="secondary pl-diff-tab ${t.id===activeDiffTab?'active-tab':''}" data-dt="${t.id}" style="font-size:12px;padding:6px 12px">${t.label}</button>`
      ).join('');
      document.querySelectorAll('.pl-diff-tab').forEach(b =>
        b.onclick = () => {
          activeDiffTab = b.dataset.dt;
          document.querySelectorAll('.pl-diff-tab').forEach(x=>x.classList.remove('active-tab'));
          b.classList.add('active-tab');
          renderDiff();
        }
      );

      renderDiff();
      toast('Permission diff complete.');
    } catch(e) { toast(e.message, 5000, {copyText:e.message}); $('#plDiffResult').innerHTML = `<p class="error-note">${escapeHtml(e.message)}</p>`; }
    finally { btn.disabled = false; btn.textContent = 'Compare'; }
  };

  function renderDiff() {
    const diffOnly = $('#plDiffOnly')?.checked;
    const search   = $('#plDiffSearch')?.value || '';
    const leftName  = $('#plLeft')?.value.trim();
    const rightName = $('#plRight')?.value.trim();
    const colMaps = {
      obj:  { data: diffData.obj,  cols: ['R','C','E','D','VA','MA'] },
      sys:  { data: diffData.sys,  cols: ['V'] },
      apex: { data: diffData.apex, cols: ['Access'] },
      vf:   { data: diffData.vf,   cols: ['Access'] }
    };
    const { data, cols } = colMaps[activeDiffTab] || colMaps.obj;
    $('#plDiffResult').innerHTML = renderDiffTable(data, cols, leftName||'Left', rightName||'Right', diffOnly, search);
  }

  // Debounced search/filter re-render
  let diffFilterTimer;
  const diffRerender = () => { clearTimeout(diffFilterTimer); diffFilterTimer = setTimeout(renderDiff, 200); };
  setTimeout(() => {
    $('#plDiffOnly')?.addEventListener('change', renderDiff);
    $('#plDiffSearch')?.addEventListener('input', diffRerender);
  }, 100);

  // Export diff
  $('#plExportDiffCSV').onclick = () => {
    const all = [...diffData.obj, ...diffData.sys, ...diffData.apex, ...diffData.vf];
    if (!all.length) return toast('Run a comparison first.');
    const rows = all.map(r => ({ Name: r.__key, Diff: r.__diff ? 'DIFFERENT' : 'SAME', ...Object.fromEntries(Object.entries(r.left||{}).map(([k,v])=>['Left_'+k,v])), ...Object.fromEntries(Object.entries(r.right||{}).map(([k,v])=>['Right_'+k,v])) }));
    chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'sf-forge-perm-diff.csv', mime:'text/csv', content:toCsv(rows) });
  };
  $('#plExportDiffJSON').onclick = () => {
    if (!diffData.obj.length && !diffData.sys.length) return toast('Run a comparison first.');
    chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'sf-forge-perm-diff.json', mime:'application/json', content:JSON.stringify(diffData, null, 2) });
  };

  // ─ COPY logic ────────────────────────────────────────────────────────────
  $('#plRunCopy').onclick = async () => {
    const srcName  = $('#plCopySrc').value.trim();
    const destName = $('#plCopyDest').value.trim();
    if (!srcName || !destName) return toast('Enter both source and destination names.');
    const copyObj  = $('#plCopyObj').checked;
    const copyFls  = $('#plCopyFls').checked;
    const copySys  = $('#plCopySys').checked;
    const copyApex = $('#plCopyApex').checked;
    const copyVf   = $('#plCopyVf').checked;
    const objFilter = $('#plCopyObj_filter').value.trim();

    const btn = $('#plRunCopy'); btn.disabled = true; btn.textContent = 'Copying…';
    const res = $('#plCopyResult');
    res.innerHTML = '<p class="muted">Resolving permission sets…</p>';
    const log = (msg, color='var(--muted)') => {
      res.innerHTML += `<p style="font-size:12px;color:${color};margin:2px 0">${escapeHtml(msg)}</p>`;
    };
    try {
      const [src, dest] = await Promise.all([resolvePset(srcName), resolvePset(destName)]);
      if (dest.IsOwnedByProfile) throw new Error('Destination must be a Permission Set, not a Profile.');
      res.innerHTML = '';
      log(`Source: ${src.Label||src.Name} (${src.IsOwnedByProfile?'Profile':'PermSet'})`);
      log(`Destination: ${dest.Label||dest.Name} (PermSet)`);

      if (copyObj) {
        const q = objFilter
          ? `SELECT SobjectType,PermissionsRead,PermissionsCreate,PermissionsEdit,PermissionsDelete,PermissionsViewAllRecords,PermissionsModifyAllRecords FROM ObjectPermissions WHERE ParentId='${src.Id}' AND SobjectType LIKE '%${safeLike(objFilter)}%'`
          : `SELECT SobjectType,PermissionsRead,PermissionsCreate,PermissionsEdit,PermissionsDelete,PermissionsViewAllRecords,PermissionsModifyAllRecords FROM ObjectPermissions WHERE ParentId='${src.Id}'`;
        const srcObjs = await requireApi().toolingQueryAll(q, {maxRecords:500});
        const destObjs = await requireApi().toolingQueryAll(`SELECT Id,SobjectType FROM ObjectPermissions WHERE ParentId='${dest.Id}'`,{maxRecords:500});
        const destMap = Object.fromEntries((destObjs.records||[]).map(r=>[r.SobjectType,r.Id]));
        let upserted = 0;
        for (const op of (srcObjs.records||[])) {
          const payload = { ParentId:dest.Id, SobjectType:op.SobjectType, PermissionsRead:op.PermissionsRead, PermissionsCreate:op.PermissionsCreate, PermissionsEdit:op.PermissionsEdit, PermissionsDelete:op.PermissionsDelete, PermissionsViewAllRecords:op.PermissionsViewAllRecords, PermissionsModifyAllRecords:op.PermissionsModifyAllRecords };
          if (destMap[op.SobjectType]) {
            await requireApi().request(`/services/data/v66.0/tooling/sobjects/ObjectPermissions/${destMap[op.SobjectType]}`, 'PATCH', payload);
          } else {
            await requireApi().request('/services/data/v66.0/tooling/sobjects/ObjectPermissions', 'POST', payload);
          }
          upserted++;
        }
        log(`✓ Object Permissions: ${upserted} objects copied.`, '#4ade80');
      }

      if (copyApex) {
        const srcApex = await requireApi().toolingQueryAll(`SELECT ApexClassId FROM SetupEntityAccess WHERE ParentId='${src.Id}' AND SetupEntityType='ApexClass'`,{maxRecords:2000});
        const destApex = await requireApi().toolingQueryAll(`SELECT SetupEntityId FROM SetupEntityAccess WHERE ParentId='${dest.Id}' AND SetupEntityType='ApexClass'`,{maxRecords:2000});
        const destSet = new Set((destApex.records||[]).map(r=>r.SetupEntityId));
        let added = 0;
        for (const rec of (srcApex.records||[])) {
          if (!destSet.has(rec.ApexClassId)) {
            await requireApi().request('/services/data/v66.0/tooling/sobjects/SetupEntityAccess', 'POST', { ParentId:dest.Id, SetupEntityId:rec.ApexClassId, SetupEntityType:'ApexClass' });
            added++;
          }
        }
        log(`✓ Apex Class Access: ${added} classes added (${srcApex.records?.length - added} already present).`, '#4ade80');
      }

      if (copyVf) {
        const srcVf = await requireApi().toolingQueryAll(`SELECT SetupEntityId FROM SetupEntityAccess WHERE ParentId='${src.Id}' AND SetupEntityType='ApexPage'`,{maxRecords:2000});
        const destVf = await requireApi().toolingQueryAll(`SELECT SetupEntityId FROM SetupEntityAccess WHERE ParentId='${dest.Id}' AND SetupEntityType='ApexPage'`,{maxRecords:2000});
        const destSet = new Set((destVf.records||[]).map(r=>r.SetupEntityId));
        let added = 0;
        for (const rec of (srcVf.records||[])) {
          if (!destSet.has(rec.SetupEntityId)) {
            await requireApi().request('/services/data/v66.0/tooling/sobjects/SetupEntityAccess', 'POST', { ParentId:dest.Id, SetupEntityId:rec.SetupEntityId, SetupEntityType:'ApexPage' });
            added++;
          }
        }
        log(`✓ Visualforce Access: ${added} pages added.`, '#4ade80');
      }

      log('Permission copy complete.', '#a78bfa');
    } catch(e) { log('✗ Error: ' + e.message, '#f87171'); toast(e.message, 5000, {copyText:e.message}); }
    finally { btn.disabled = false; btn.textContent = 'Copy Permissions'; }
  };

  // ─ USER ACCESS logic ─────────────────────────────────────────────────────
  let selectedPermSets = [];

  $('#plLoadUserPerms').onclick = async () => {
    const src = $('#plUserSrc').value.trim();
    if (!src) return toast('Enter a username or User Id.');
    const btn = $('#plLoadUserPerms'); btn.disabled = true; btn.textContent = 'Loading…';
    try {
      const userQ = src.startsWith('005')
        ? await requireApi().query(`SELECT Id, Username FROM User WHERE Id='${src}' LIMIT 1`)
        : await requireApi().query(`SELECT Id, Username FROM User WHERE Username='${src}' LIMIT 1`);
      const user = userQ.records?.[0];
      if (!user) throw new Error(`User not found: ${src}`);
      const assigns = await requireApi().queryAll(`SELECT PermissionSetId, PermissionSet.Label, PermissionSet.Name FROM PermissionSetAssignment WHERE AssigneeId='${user.Id}' AND PermissionSet.IsOwnedByProfile=false ORDER BY PermissionSet.Label`, {maxRecords:500});
      const psets = (assigns.records||[]).map(r=>({ id:r.PermissionSetId, label:r.PermissionSet?.Label||r.PermissionSet?.Name }));
      selectedPermSets = psets;
      $('#plUserPermList').innerHTML = psets.length
        ? `<p style="margin:8px 0 4px;font-size:12px;color:var(--muted)">${psets.length} permission sets found on ${escapeHtml(user.Username)}. All will be assigned to target users.</p>`+
          `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${psets.map(p=>`<span style="background:rgba(139,92,246,.18);padding:3px 10px;border-radius:20px;font-size:12px">${escapeHtml(p.label)}</span>`).join('')}</div>`
        : '<p class="muted" style="font-size:12px;margin:8px 0">No permission sets found on this user (profile-owned excluded).</p>';
    } catch(e) { toast(e.message, 5000, {copyText:e.message}); }
    finally { btn.disabled = false; btn.textContent = 'Load Permissions'; }
  };

  $('#plFindPs').onclick = async () => {
    const names = $('#plPsSearch').value.split(',').map(x=>x.trim()).filter(Boolean);
    if (!names.length) return toast('Enter at least one permission set name.');
    const btn = $('#plFindPs'); btn.disabled = true; btn.textContent = 'Searching…';
    try {
      const quoted = names.map(n=>`'${safeLike(n)}'`).join(',');
      const r = await requireApi().toolingQueryAll(`SELECT Id, Name, Label FROM PermissionSet WHERE (Name IN (${quoted}) OR Label IN (${quoted})) AND IsOwnedByProfile=false ORDER BY Label`,{maxRecords:50});
      const psets = (r.records||[]).map(p=>({ id:p.Id, label:p.Label||p.Name }));
      selectedPermSets = psets;
      $('#plPsList').innerHTML = psets.length
        ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px">${psets.map(p=>`<span style="background:rgba(139,92,246,.18);padding:3px 10px;border-radius:20px;font-size:12px">${escapeHtml(p.label)}</span>`).join('')}</div>`
        : '<p class="muted" style="font-size:12px;margin:8px 0">No matching permission sets found.</p>';
    } catch(e) { toast(e.message, 5000, {copyText:e.message}); }
    finally { btn.disabled = false; btn.textContent = 'Find Permission Sets'; }
  };

  $('#plAssignPerms').onclick = async () => {
    if (!selectedPermSets.length) return toast('Load permission sets first (Option A or B).');
    const rawUsers = $('#plTargetUsers').value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);
    if (!rawUsers.length) return toast('Enter at least one target username or Id.');
    const btn = $('#plAssignPerms'); btn.disabled = true; btn.textContent = 'Assigning…';
    const progress = $('#plAssignProgress');
    progress.innerHTML = '';
    let done = 0, errors = 0;
    const total = rawUsers.length * selectedPermSets.length;
    const logLine = (msg, color='var(--muted)') => { progress.innerHTML += `<p style="font-size:11px;color:${color};margin:1px 0">${escapeHtml(msg)}</p>`; };
    try {
      for (const rawUser of rawUsers) {
        const isId = rawUser.startsWith('005');
        const userQ = isId
          ? await requireApi().query(`SELECT Id, Username FROM User WHERE Id='${rawUser}' LIMIT 1`)
          : await requireApi().query(`SELECT Id, Username FROM User WHERE Username='${rawUser}' LIMIT 1`);
        const user = userQ.records?.[0];
        if (!user) { logLine(`✗ User not found: ${rawUser}`, '#f87171'); errors++; continue; }
        for (const ps of selectedPermSets) {
          try {
            // Check existing assignment
            const existing = await requireApi().query(`SELECT Id FROM PermissionSetAssignment WHERE AssigneeId='${user.Id}' AND PermissionSetId='${ps.id}' LIMIT 1`);
            if (existing.records?.length) {
              logLine(`→ ${user.Username}: ${ps.label} already assigned`, '#fbbf24');
            } else {
              await requireApi().request('/services/data/v66.0/sobjects/PermissionSetAssignment', 'POST', { AssigneeId:user.Id, PermissionSetId:ps.id });
              logLine(`✓ ${user.Username}: ${ps.label} assigned`, '#4ade80');
            }
            done++;
          } catch(e2) {
            logLine(`✗ ${user.Username}: ${ps.label} — ${e2.message}`, '#f87171');
            errors++;
          }
          $('#plAssignStatus').textContent = `${done + errors}/${total} processed`;
        }
      }
      logLine(`Complete: ${done} assigned, ${errors} errors.`, '#a78bfa');
    } catch(e) { toast(e.message, 5000, {copyText:e.message}); }
    finally { btn.disabled = false; btn.textContent = 'Assign to All Target Users'; }
  };
}

// ── Org Change Tracker — v6: SetupAuditTrail viewer ──────────────────────────
async function changeTracker() {
  const TYPE_COLORS = {
    'Apex':       '#60a5fa',
    'Flow':       '#34d399',
    'Field':      '#fbbf24',
    'Object':     '#a78bfa',
    'Permission': '#f472b6',
    'Profile':    '#fb923c',
    'User':       '#22d3ee',
    'Security':   '#f87171',
    'Other':      '#9ca3af'
  };

  function classifyAction(action, section) {
    const a = (action||'').toLowerCase() + ' ' + (section||'').toLowerCase();
    if (a.includes('apex') || a.includes('class') || a.includes('trigger')) return 'Apex';
    if (a.includes('flow') || a.includes('process builder') || a.includes('workflow')) return 'Flow';
    if (a.includes('field') || a.includes('customfield')) return 'Field';
    if (a.includes('object') || a.includes('customobject')) return 'Object';
    if (a.includes('permissionset') || a.includes('permission set') || a.includes('permission')) return 'Permission';
    if (a.includes('profile')) return 'Profile';
    if (a.includes('user') || a.includes('login')) return 'User';
    if (a.includes('session') || a.includes('password') || a.includes('ip') || a.includes('trusted')) return 'Security';
    return 'Other';
  }

  view().innerHTML = `<section class="card">
    <h3>Org Change Tracker <span class="badge info">v6 — SetupAuditTrail</span></h3>
    <p class="muted">See every setup change made in your org — who changed what, when, and from where. Powered by SetupAuditTrail.</p>
    <div class="toolbar">
      <select id="ctDateRange" style="max-width:160px">
        <option value="1">Today</option>
        <option value="7" selected>Last 7 Days</option>
        <option value="30">Last 30 Days</option>
        <option value="90">Last 90 Days</option>
        <option value="180">Last 180 Days</option>
      </select>
      <input id="ctUser"   placeholder="Filter by username…" style="max-width:200px">
      <input id="ctSearch" placeholder="Search action / detail…" style="max-width:220px">
      <button id="ctRun">Fetch Changes</button>
      <button class="secondary" id="ctExport">Export CSV</button>
    </div>
    <div id="ctTypeChips" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px"></div>
    <div id="ctSummary"></div>
    <div id="ctResult"></div>
  </section>`;

  let allChanges = [];
  let activeTypes = new Set();

  function renderChips() {
    const counts = {};
    allChanges.forEach(c => { counts[c.__type] = (counts[c.__type]||0)+1; });
    const types = Object.keys(counts).sort();
    activeTypes = new Set(types); // default: all selected
    $('#ctTypeChips').innerHTML = types.map(t =>
      `<button class="ct-chip active-chip" data-type="${t}" style="font-size:11px;padding:4px 10px;border-color:${TYPE_COLORS[t]||'#9ca3af'};background:rgba(0,0,0,.3);color:${TYPE_COLORS[t]||'#9ca3af'}">${t} <span style="opacity:.7">(${counts[t]})</span></button>`
    ).join('');
    document.querySelectorAll('.ct-chip').forEach(chip => {
      chip.onclick = () => {
        const t = chip.dataset.type;
        if (activeTypes.has(t)) { activeTypes.delete(t); chip.classList.remove('active-chip'); chip.style.opacity = '0.4'; }
        else                    { activeTypes.add(t);    chip.classList.add('active-chip');    chip.style.opacity = '1'; }
        renderTable();
      };
    });
  }

  function renderTable() {
    const userFilter   = ($('#ctUser')?.value||'').toLowerCase();
    const searchFilter = ($('#ctSearch')?.value||'').toLowerCase();
    let rows = allChanges.filter(c => {
      if (!activeTypes.has(c.__type)) return false;
      if (userFilter && !(c.CreatedBy?.Username||'').toLowerCase().includes(userFilter)) return false;
      if (searchFilter && !`${c.Action} ${c.Display} ${c.Section}`.toLowerCase().includes(searchFilter)) return false;
      return true;
    });

    if (!rows.length) { $('#ctResult').innerHTML = '<p class="muted">No changes match the current filters.</p>'; return; }

    const thStyle = 'style="color:var(--purple2);padding:9px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap"';
    const tdStyle = 'style="padding:8px 9px;border-bottom:1px solid var(--line);font-size:12px;vertical-align:top"';
    const header = `<tr><th ${thStyle}>When</th><th ${thStyle}>Type</th><th ${thStyle}>Section</th><th ${thStyle}>User</th><th ${thStyle}>Action / Detail</th><th ${thStyle}>Delegate</th></tr>`;
    const body = rows.slice(0, 500).map(c => {
      const col = TYPE_COLORS[c.__type]||'#9ca3af';
      const badge = `<span style="background:rgba(0,0,0,.3);color:${col};border:1px solid ${col};border-radius:20px;padding:2px 8px;font-size:11px;white-space:nowrap">${c.__type}</span>`;
      return `<tr>
        <td ${tdStyle} style="white-space:nowrap">${escapeHtml(new Date(c.CreatedDate).toLocaleString())}</td>
        <td ${tdStyle}>${badge}</td>
        <td ${tdStyle}>${escapeHtml(c.Section||'')}</td>
        <td ${tdStyle}>${escapeHtml(c.CreatedBy?.Username||'—')}</td>
        <td ${tdStyle}>${escapeHtml((c.Display||c.Action||'').substring(0,200))}</td>
        <td ${tdStyle}>${escapeHtml(c.DelegateUser||'—')}</td>
      </tr>`;
    }).join('');
    const truncated = rows.length > 500 ? `<p class="muted" style="font-size:12px;margin-top:6px">Showing 500 of ${rows.length} results. Narrow filters or export CSV for full list.</p>` : '';
    $('#ctResult').innerHTML = `<table class="table" style="width:100%;font-size:12px"><thead>${header}</thead><tbody>${body}</tbody></table>${truncated}`;
  }

  // Debounced filter re-renders
  let filterTimer;
  const rerender = () => { clearTimeout(filterTimer); filterTimer = setTimeout(renderTable, 200); };
  setTimeout(() => {
    $('#ctUser')?.addEventListener('input', rerender);
    $('#ctSearch')?.addEventListener('input', rerender);
  }, 100);

  $('#ctRun').onclick = async () => {
    const days = parseInt($('#ctDateRange').value)||7;
    const since = new Date(Date.now() - days*86400000).toISOString().split('.')[0]+'Z';
    const btn = $('#ctRun'); btn.disabled = true; btn.textContent = 'Fetching…';
    $('#ctResult').innerHTML  = '<p class="muted">Querying SetupAuditTrail…</p>';
    $('#ctSummary').innerHTML = '';
    try {
      const r = await requireApi().queryAll(
        `SELECT Id, Action, Section, Display, DelegateUser, CreatedDate, CreatedById, CreatedBy.Username, CreatedBy.Name FROM SetupAuditTrail WHERE CreatedDate >= ${since} ORDER BY CreatedDate DESC`,
        { maxRecords: 5000 }
      );
      allChanges = (r.records||[]).map(c => ({ ...c, __type: classifyAction(c.Action, c.Section) }));

      // Summary bar
      const total   = allChanges.length;
      const users   = new Set(allChanges.map(c=>c.CreatedBy?.Username)).size;
      const types   = new Set(allChanges.map(c=>c.__type)).size;
      const dateRange = days === 1 ? 'today' : `last ${days} days`;
      $('#ctSummary').innerHTML = `<div style="display:flex;gap:18px;padding:10px 14px;background:var(--panel2);border-radius:10px;margin-bottom:12px;flex-wrap:wrap">
        <span style="font-size:13px"><b>${total}</b> <span class="muted">changes ${dateRange}</span></span>
        <span style="font-size:13px"><b>${users}</b> <span class="muted">user${users!==1?'s':''}</span></span>
        <span style="font-size:13px"><b>${types}</b> <span class="muted">change types</span></span>
      </div>`;

      renderChips();
      renderTable();
      toast(`Loaded ${total} audit trail entries.`);
    } catch(e) {
      const isPerms = /INSUFFICIENT_ACCESS|INVALID_FIELD/i.test(e.message);
      $('#ctResult').innerHTML = `<div class="notice" style="border-left:3px solid #f87171">
        <b>${isPerms ? 'Insufficient Permissions' : 'Query Error'}</b><br>
        ${escapeHtml(e.message)}<br><br>
        ${isPerms ? 'SetupAuditTrail requires "View Setup and Configuration" or System Administrator profile.' : ''}
      </div>`;
      toast(e.message, 5000, {copyText:e.message});
    } finally { btn.disabled = false; btn.textContent = 'Fetch Changes'; }
  };

  $('#ctExport').onclick = () => {
    if (!allChanges.length) return toast('Fetch changes first.');
    const rows = allChanges.map(c => ({
      Date: c.CreatedDate, Type: c.__type, Section: c.Section,
      Action: c.Action, Detail: c.Display, User: c.CreatedBy?.Username, Delegate: c.DelegateUser||''
    }));
    chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'sf-forge-audit-trail.csv', mime:'text/csv', content:toCsv(rows) });
  };
}

// ── Org Diff — Enhancement #13: field-level compare ──────────────────────────

async function orgdiff() {
  const stored = await readCredentialProfiles();
  view().innerHTML = `<section class="card">
    <h3>Org Diff Tool <span class="badge info">Field-level compare</span></h3>
    <p class="muted">Compare selected metadata — including field presence on custom objects — between the active org and another stored profile.</p>
    <div class="toolbar">
      <select id="diffTarget">${(stored.orgs||[]).map(o=>`<option value="${escapeHtml(o.key)}">${escapeHtml(o.alias || o.orgName || o.username || o.hostname)}</option>`).join('')}</select>
      <select id="diffType"><option>ApexClass</option><option>CustomObject</option><option>FlowDefinitionView</option><option>PermissionSet</option></select>
      <button id="runOrgDiff">Run Diff</button>
      <button class="secondary" id="runFieldDiff">Field-level Diff</button>
      <button class="secondary" id="exportOrgDiff">Export CSV</button>
    </div>
    <div id="diffObjectName" style="display:none;margin-top:8px">
      <input id="diffObjectInput" placeholder="Object API name for field diff, e.g. Account__c">
    </div>
    <div id="diffResult"></div>
  </section>`;

  let lastDiff = [];

  const queries = {
    ApexClass:        'SELECT Name, LastModifiedDate FROM ApexClass ORDER BY Name',
    CustomObject:     'SELECT DeveloperName, ManageableState FROM CustomObject ORDER BY DeveloperName',
    // FlowDefinitionView is Tooling API only — orgdiff uses toolingQueryAll so this is fine
    FlowDefinitionView:'SELECT Id, ApiName, Label, ActiveVersionId FROM FlowDefinitionView ORDER BY ApiName',
    PermissionSet:    'SELECT Name, Label, IsOwnedByProfile FROM PermissionSet ORDER BY Name'
  };

  function keyOf(type, r) { return r.Name || r.DeveloperName || r.ApiName || r.Label || r.Id; }

  $('#diffType').onchange = () => {
    $('#diffObjectName').style.display = $('#diffType').value === 'CustomObject' ? '' : 'none';
  };

  $('#runOrgDiff').onclick = async () => {
    try {
      const base   = requireApi();
      const target = await SalesforceApi.fromStoredProfile($('#diffTarget').value);
      const type   = $('#diffType').value;
      const left   = await base.toolingQueryAll(queries[type],   { maxRecords: 5000 });
      const right  = await target.toolingQueryAll(queries[type], { maxRecords: 5000 });
      const a = new Map((left.records||[]).map(r=>[keyOf(type,r),r]));
      const b = new Map((right.records||[]).map(r=>[keyOf(type,r),r]));
      const keys = [...new Set([...a.keys(), ...b.keys()])].sort();
      lastDiff = keys.map(k => {
        const lr = a.get(k), rr = b.get(k);
        let dateNote = '';
        if (lr?.LastModifiedDate && rr?.LastModifiedDate) {
          const ld = new Date(lr.LastModifiedDate), rd = new Date(rr.LastModifiedDate);
          if (ld > rd) dateNote = 'Active newer';
          else if (rd > ld) dateNote = 'Target newer';
          else dateNote = 'Same date';
        }
        return { Metadata: k, ActiveOrg: a.has(k)?'Yes':'No', TargetOrg: b.has(k)?'Yes':'No', Status: a.has(k)&&b.has(k)?'Both':a.has(k)?'Only Active':'Only Target', DateCompare: dateNote };
      });
      $('#diffResult').innerHTML = `<p class="muted">${lastDiff.length} ${escapeHtml(type)} records compared.</p>${table(lastDiff)}`;
    } catch(e) { toast(e.message, 5000, { copyText: e.message }); }
  };

  // Enhancement #13: field-level diff for CustomObject
  $('#runFieldDiff').onclick = async () => {
    try {
      const objectName = ($('#diffObjectInput').value || '').trim();
      if (!objectName) return toast('Enter an object API name for field diff.');
      const base   = requireApi();
      const target = await SalesforceApi.fromStoredProfile($('#diffTarget').value);
      const [la, ra] = await Promise.all([
        base.describeObject(objectName),
        target.describeObject(objectName)
      ]);
      const leftFields  = new Map((la.fields||[]).map(f=>[f.name, f]));
      const rightFields = new Map((ra.fields||[]).map(f=>[f.name, f]));
      const allNames    = [...new Set([...leftFields.keys(), ...rightFields.keys()])].sort();
      const rows = allNames.map(name => {
        const lf = leftFields.get(name), rf = rightFields.get(name);
        let change = '';
        if (!lf) change = 'Added in target';
        else if (!rf) change = 'Missing in target';
        else if (lf.type !== rf.type) change = `Type: ${lf.type} → ${rf.type}`;
        else if (lf.length !== rf.length) change = `Length: ${lf.length} → ${rf.length}`;
        else change = 'Match';
        return { Field: name, Type: lf?.type || rf?.type, InActive: lf?'✓':'—', InTarget: rf?'✓':'—', Change: change };
      });
      lastDiff = rows;
      const changes = rows.filter(r=>r.Change!=='Match').length;
      $('#diffResult').innerHTML = `<p class="muted">${rows.length} fields compared, ${changes} difference${changes===1?'':'s'}.</p>${table(rows)}`;
    } catch(e) { toast(e.message, 5000, { copyText: e.message }); }
  };

  $('#exportOrgDiff').onclick = () => {
    if (!lastDiff.length) return toast('Run a diff first.');
    chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'sf-forge-org-diff.csv', mime:'text/csv', content:toCsv(lastDiff) });
  };
}

// ── Deployment Assistant ──────────────────────────────────────────────────────
async function deploy() {
  view().innerHTML = `<section class="card">
    <h3>Deployment Assistant <span class="badge info">Preview First</span></h3>
    <p class="muted">Build package.xml and destructiveChanges.xml from selected metadata. This does not deploy automatically — generates files for review.</p>
    <div class="toolbar">
      <select id="deployType"><option>ApexClass</option><option>ApexTrigger</option><option>CustomObject</option><option>CustomField</option><option>Flow</option><option>PermissionSet</option><option>Profile</option></select>
      <textarea id="deployMembers" placeholder="One metadata member per line, e.g.&#10;Account.Customer_Tier__c&#10;MyApexClass"></textarea>
      <button id="previewDeploy">Preview Package</button>
      <button class="secondary" id="downloadPackageXml">Download package.xml</button>
      <button class="secondary" id="downloadDestructiveXml">Download destructiveChanges.xml</button>
    </div>
    <div id="deployResult"></div>
  </section>`;

  let packageXml = '', destructiveXml = '';

  function xml(type, members, destructive=false) {
    const memberXml = members.map(m=>`        <members>${escapeHtml(m)}</members>`).join(NL);
    return `<?xml version="1.0" encoding="UTF-8"?>${NL}<Package xmlns="http://soap.sforce.com/2006/04/metadata">${NL}    <types>${NL}${memberXml}${NL}        <name>${escapeHtml(type)}</name>${NL}    </types>${NL}    <version>66.0</version>${NL}</Package>`;
  }

  $('#previewDeploy').onclick = () => {
    const type    = $('#deployType').value;
    const members = $('#deployMembers').value.split(/\n|,/).map(x=>x.trim()).filter(Boolean);
    if (!members.length) return toast('Enter at least one metadata member.');
    packageXml    = xml(type, members, false);
    destructiveXml = xml(type, members, true);
    $('#deployResult').innerHTML = `<h3>Deployment Preview</h3><p class="muted">Review before deploying with Salesforce CLI or Metadata API.</p>${pre(packageXml)}`;
  };

  $('#downloadPackageXml').onclick = () => packageXml ? chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'package.xml', mime:'application/xml', content:packageXml }) : toast('Preview package first.');
  $('#downloadDestructiveXml').onclick = () => destructiveXml ? chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'destructiveChanges.xml', mime:'application/xml', content:destructiveXml }) : toast('Preview package first.');
}

// ── Agentforce Inspector — Enhancement #14 ────────────────────────────────────
async function agents() {
  view().innerHTML = `<section class="card">
    <h3>Agentforce Inspector <span class="badge info">NEW in v5</span></h3>
    <p class="muted">Inspect Einstein Copilot / Agentforce bot definitions, versions, topics, and actions via Tooling API.</p>
    <div class="toolbar">
      <button id="loadBots">Load Bots / Agents</button>
      <button class="secondary" id="exportBots">Export CSV</button>
    </div>
    <div id="botsList"></div>
    <div id="botDetail"></div>
  </section>`;

  let allBots = [];

  $('#loadBots').onclick = async () => {
    const resEl = $('#botsList');
    resEl.innerHTML = '<p class="muted">Querying BotDefinition via Tooling API…</p>';
    try {
      const r = await requireApi().toolingQueryAll(
        `SELECT Id, DeveloperName, MasterLabel, Type, Status, Description, LastModifiedDate FROM BotDefinition ORDER BY MasterLabel`,
        { maxRecords: 500 }
      );
      allBots = r.records || [];
      if (!allBots.length) {
        resEl.innerHTML = '<p class="muted">No BotDefinition records found. Agentforce / Einstein Copilot may not be provisioned in this org, or the session may have expired — try Re-check Health on the Dashboard first.</p>';
        return;
      }
      resEl.innerHTML = table(allBots.map(b => ({
        Name: b.MasterLabel, DeveloperName: b.DeveloperName,
        Type: b.Type, Status: b.Status, Modified: timeAgo(b.LastModifiedDate),
        Description: (b.Description||'').substring(0,80)
      })), id => `<button data-inspect-bot="${escapeHtml(id)}">Inspect</button>`);

      document.querySelectorAll('[data-inspect-bot]').forEach(btn =>
        btn.onclick = async () => {
          const bot = allBots.find(b => b.Id === btn.dataset.inspectBot);
          if (!bot) return;
          await inspectBot(bot);
        }
      );
    } catch (e) {
      const isExpired = /HTTP 401|HTTP 403|INVALID_SESSION|expired|undefined/i.test(e.message);
      resEl.innerHTML = `<div class="notice" style="border-left:3px solid #f87171">
        <b>${isExpired ? 'Session expired' : 'Could not load bots'}</b><br>
        ${escapeHtml(e.message)}<br><br>
        ${isExpired ? 'Your Salesforce session has expired. Go to <b>Dashboard → Session Recovery</b> to reconnect without re-entering credentials.' : 'BotDefinition may not be available in this org. Agentforce requires a Salesforce org with the feature enabled.'}
      </div>`;
    }
  };

  async function inspectBot(bot) {
    const detail = $('#botDetail');
    detail.innerHTML = `<p class="muted">Loading actions for ${escapeHtml(bot.MasterLabel)}…</p>`;
    try {
      // Load bot versions
      const versions = await requireApi().toolingQueryAll(
        `SELECT Id, VersionNumber, Status, LastModifiedDate FROM BotVersion WHERE BotDefinitionId='${bot.Id}' ORDER BY VersionNumber DESC`,
        { maxRecords: 50 }
      );
      // Load bot actions/topics — try GenAiPlugin if BotAction not available
      let actions = { records: [] };
      try {
        actions = await requireApi().toolingQueryAll(
          `SELECT Id, DeveloperName, MasterLabel, Type, Description FROM BotCustomAction WHERE BotDefinitionId='${bot.Id}' ORDER BY MasterLabel`,
          { maxRecords: 200 }
        );
      } catch (_) {
        try {
          actions = await requireApi().toolingQueryAll(
            `SELECT Id, DeveloperName, MasterLabel, Description FROM GenAiPlugin WHERE BotDefinitionId='${bot.Id}' ORDER BY MasterLabel`,
            { maxRecords: 200 }
          );
        } catch (_2) { /* actions API not available in this API version */ }
      }

      detail.innerHTML = `
        <h4 style="margin:16px 0 8px">${escapeHtml(bot.MasterLabel)} — Versions (${versions.records?.length || 0})</h4>
        ${table((versions.records||[]).map(v=>({Version:v.VersionNumber, Status:v.Status, Modified:timeAgo(v.LastModifiedDate)})))}
        <h4 style="margin:16px 0 8px">Actions / Topics (${actions.records?.length || 0})</h4>
        ${actions.records?.length ? table(actions.records.map(a=>({
          Name: a.MasterLabel, DeveloperName: a.DeveloperName,
          Type: a.Type||'—', Description: (a.Description||'').substring(0,100)
        }))) : '<p class="muted">No actions found for this bot.</p>'}
        <h4 style="margin:16px 0 8px">Raw Definition</h4>
        ${pre({ id: bot.Id, developerName: bot.DeveloperName, type: bot.Type, status: bot.Status, description: bot.Description })}`;
    } catch (e) {
      detail.innerHTML = `<p class="error-note">Could not load bot details: ${escapeHtml(e.message)}</p>`;
    }
  }

  $('#exportBots').onclick = () => {
    if (!allBots.length) return toast('Load bots first.');
    chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'sf-forge-agents.csv', mime:'text/csv', content:toCsv(allBots) });
  };
}


// ── API Limits Dashboard ──────────────────────────────────────────────────────
async function limitsView() {
  view().innerHTML = `<section class="card">
    <h3>API Limits <span class="badge info">Live usage</span></h3>
    <p class="muted">Org API limit consumption. Auto-refreshes every 60 seconds while this view is active.</p>
    <div class="toolbar">
      <button id="refreshLimits">Refresh Now</button>
      <button class="secondary" id="exportLimits">Export CSV</button>
    </div>
    <div id="limitsBody" style="margin-top:12px"></div>
  </section>`;

  let limitsHistory = {}, limitsData = {}, refreshTimer = null;

  function renderLimits(limits) {
    const entries = Object.entries(limits).sort((a,b)=>a[0].localeCompare(b[0]));
    const rows = entries.map(([name, val]) => {
      const max = val.Max || 0, rem = val.Remaining ?? 0;
      const used = max > 0 ? max - rem : 0;
      const pct  = max > 0 ? Math.round(used / max * 100) : 0;
      const colour = pct >= 90 ? '#f87171' : pct >= 70 ? '#fbbf24' : '#4ade80';
      // Sparkline from history
      const hist = limitsHistory[name] || [];
      const sparkPts = hist.slice(-10).map((p,i) => {
        const x = i * 14 + 4;
        const y = 16 - Math.round(p * 14);
        return `${x},${y}`;
      }).join(' ');
      const spark = hist.length > 1
        ? `<svg width="140" height="18" style="vertical-align:middle;margin-left:8px"><polyline points="${sparkPts}" fill="none" stroke="${colour}" stroke-width="1.5"/></svg>`
        : '';
      return `<tr>
        <td style="font-size:12px;padding:4px 8px 4px 0;white-space:nowrap">${escapeHtml(name)}</td>
        <td style="padding:4px 8px">
          <div style="background:var(--panel2);border-radius:4px;height:8px;width:160px;overflow:hidden">
            <div style="background:${colour};height:100%;width:${pct}%;transition:width .3s;border-radius:4px"></div>
          </div>
        </td>
        <td style="font-size:12px;color:${colour};padding:4px 8px">${pct}%</td>
        <td style="font-size:11px;color:var(--muted);padding:4px 0">${used.toLocaleString()} / ${max.toLocaleString()}${spark}</td>
      </tr>`;
    }).join('');
    $('#limitsBody').innerHTML = `<table style="width:100%"><tbody>${rows}</tbody></table>`;
  }

  async function doRefresh() {
    try {
      const data = await requireApi().limits();
      limitsData = data;
      Object.entries(data).forEach(([k,v]) => {
        if (!limitsHistory[k]) limitsHistory[k] = [];
        const pct = v.Max > 0 ? (v.Max - (v.Remaining??0)) / v.Max : 0;
        limitsHistory[k].push(pct);
        if (limitsHistory[k].length > 10) limitsHistory[k].shift();
      });
      renderLimits(data);
    } catch(e) { toast(e.message, 4000); }
  }

  $('#refreshLimits').onclick = doRefresh;
  $('#exportLimits').onclick  = () => {
    if (!Object.keys(limitsData).length) return toast('Load limits first.');
    const rows = Object.entries(limitsData).map(([k,v]) => ({ Limit: k, Max: v.Max, Remaining: v.Remaining, Used: v.Max - (v.Remaining??0), PctUsed: v.Max>0 ? Math.round((v.Max-(v.Remaining??0))/v.Max*100)+'%' : 'N/A' }));
    chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'sf-forge-limits.csv', mime:'text/csv', content:toCsv(rows) });
  };

  await doRefresh();
  refreshTimer = setInterval(doRefresh, 60000);
  // Clear timer when user navigates away
  const origRender = render;
  window._limitsCleanup = () => { if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; } };
}

// ── Apex Job Monitor ──────────────────────────────────────────────────────────
async function jobMonitor() {
  view().innerHTML = `<section class="card">
    <h3>Apex Job Monitor <span class="badge info">Async + Scheduled</span></h3>
    <p class="muted">Live view of queued, running, and recent Apex batch and scheduled jobs. Auto-refreshes every 30 seconds.</p>
    <div class="toolbar">
      <select id="jobTypeFilter">
        <option value="">All types</option>
        <option>BatchApex</option><option>ScheduledApex</option>
        <option>Future</option><option>Queueable</option><option>ApexToken</option>
      </select>
      <select id="jobStatusFilter">
        <option value="">All statuses</option>
        <option>Queued</option><option>Processing</option><option>Completed</option>
        <option>Failed</option><option>Aborted</option><option>Holding</option>
      </select>
      <button id="refreshJobs">Refresh</button>
      <button class="secondary" id="exportJobs">Export CSV</button>
    </div>
    <div id="jobsBody" style="margin-top:8px"></div>
    <div id="cronJobs" style="margin-top:16px"></div>
  </section>`;

  let allJobs = [], cronData = [], jobTimer = null;

  async function loadJobs() {
    try {
      const type   = $('#jobTypeFilter').value;
      const status = $('#jobStatusFilter').value;
      let soql = 'SELECT Id, JobType, ApexClass.Name, Status, JobItemsProcessed, TotalJobItems, NumberOfErrors, CreatedDate, CompletedDate FROM AsyncApexJob ORDER BY CreatedDate DESC LIMIT 100';
      const r  = await requireApi().query(soql);
      allJobs  = r.records || [];
      let filtered = allJobs;
      if (type)   filtered = filtered.filter(j => j.JobType === type);
      if (status) filtered = filtered.filter(j => j.Status === status);

      const rows = filtered.map(j => {
        const prog = j.TotalJobItems > 0 ? Math.round(j.JobItemsProcessed / j.TotalJobItems * 100) : 0;
        const sColour = { Processing:'#fbbf24', Completed:'#4ade80', Failed:'#f87171', Aborted:'#f87171' }[j.Status] || 'var(--muted)';
        const abortBtn = ['Queued','Processing','Holding'].includes(j.Status)
          ? `<button data-abort-job="${escapeHtml(j.Id)}" style="font-size:11px;padding:2px 6px;color:#f87171">Abort</button>` : '';
        return { Id:j.Id, Class: j.ApexClass?.Name||'—', Type: j.JobType, Status: j.Status, 
          Progress: j.TotalJobItems > 0 ? `${j.JobItemsProcessed}/${j.TotalJobItems} (${prog}%)` : '—',
          Errors: j.NumberOfErrors||0, Created: timeAgo(j.CreatedDate), _abort: abortBtn };
      });

      $('#jobsBody').innerHTML = filtered.length
        ? `<div style="overflow-x:auto"><table class="table" style="table-layout:fixed;width:100%">
            <thead><tr><th>Class</th><th>Type</th><th>Status</th><th>Progress</th><th>Errors</th><th>Created</th><th></th></tr></thead>
            <tbody>${rows.map(r=>`<tr>
              <td style="font-size:12px;overflow:hidden;text-overflow:ellipsis">${escapeHtml(r.Class)}</td>
              <td style="font-size:12px">${escapeHtml(r.Type)}</td>
              <td style="font-size:12px">${escapeHtml(r.Status)}</td>
              <td style="font-size:12px">${escapeHtml(r.Progress)}</td>
              <td style="font-size:12px;${r.Errors>0?'color:#f87171':''}">${r.Errors}</td>
              <td style="font-size:12px">${escapeHtml(r.Created)}</td>
              <td>${r._abort}</td>
            </tr>`).join('')}</tbody>
          </table></div>`
        : '<p class="muted">No jobs match filters.</p>';

      document.querySelectorAll('[data-abort-job]').forEach(btn => {
        btn.onclick = async () => {
          if (!confirm('Abort this job? This cannot be undone.')) return;
          try {
            await requireApi().request(`/services/data/v66.0/sobjects/AsyncApexJob/${btn.dataset.abortJob}`, { method:'DELETE' });
            toast('Job abort requested.'); loadJobs();
          } catch(e) { toast(e.message, 5000); }
        };
      });

      // Scheduled jobs (CronTrigger)
      const cr = await requireApi().query('SELECT Id, CronJobDetail.Name, State, NextFireTime, PreviousFireTime, StartTime, EndTime, CronExpression FROM CronTrigger ORDER BY NextFireTime ASC LIMIT 50');
      cronData = cr.records || [];
      if (cronData.length) {
        const cronRows = cronData.map(c => `<tr>
          <td style="font-size:12px">${escapeHtml(c.CronJobDetail?.Name||'—')}</td>
          <td style="font-size:12px">${escapeHtml(c.State)}</td>
          <td style="font-size:12px">${c.NextFireTime ? new Date(c.NextFireTime).toLocaleString() : '—'}</td>
          <td style="font-size:11px;color:var(--muted)">${escapeHtml(c.CronExpression||'')}</td>
          <td><button data-abort-cron="${escapeHtml(c.Id)}" style="font-size:11px;padding:2px 6px;color:#f87171">Delete</button></td>
        </tr>`).join('');
        $('#cronJobs').innerHTML = `<h4 style="font-size:13px;margin-bottom:8px">Scheduled Jobs (CronTrigger)</h4>
          <table class="table"><thead><tr><th>Name</th><th>State</th><th>Next Fire</th><th>Cron</th><th></th></tr></thead>
          <tbody>${cronRows}</tbody></table>`;
        document.querySelectorAll('[data-abort-cron]').forEach(btn => {
          btn.onclick = async () => {
            if (!confirm('Delete this scheduled job?')) return;
            try {
              await requireApi().request(`/services/data/v66.0/sobjects/CronTrigger/${btn.dataset.abortCron}`, { method:'DELETE' });
              toast('Scheduled job deleted.'); loadJobs();
            } catch(e) { toast(e.message, 5000); }
          };
        });
      }
    } catch(e) { toast(e.message, 4000); }
  }

  $('#refreshJobs').onclick = loadJobs;
  $('#exportJobs').onclick  = () => {
    if (!allJobs.length) return toast('Load jobs first.');
    chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'sf-forge-jobs.csv', mime:'text/csv', content:toCsv(allJobs.map(j=>({ Class:j.ApexClass?.Name, Type:j.JobType, Status:j.Status, Processed:j.JobItemsProcessed, Total:j.TotalJobItems, Errors:j.NumberOfErrors, Created:j.CreatedDate }))) });
  };
  ['jobTypeFilter','jobStatusFilter'].forEach(id => { const el=$(`#${id}`); if(el) el.onchange=loadJobs; });
  await loadJobs();
  jobTimer = setInterval(loadJobs, 30000);
  window._jobsCleanup = () => { if(jobTimer){clearInterval(jobTimer);jobTimer=null;} };
}

// ── Trace Flag Manager ────────────────────────────────────────────────────────
async function traceFlagManager() {
  view().innerHTML = `<section class="card">
    <h3>Trace Flag Manager <span class="badge info">Debug log control</span></h3>
    <p class="muted">Set and manage Apex debug log trace flags without leaving SF Forge. Trace flags control which debug events are captured per user.</p>
    <div class="toolbar">
      <button id="loadTraceFlags">Load Active Flags</button>
    </div>
    <div id="traceFlagList"></div>
    <h4 style="margin:16px 0 8px">New Trace Flag</h4>
    <div class="grid">
      <div class="field span6">
        <label>Traced Entity (User ID or Apex class ID)</label>
        <input id="tfEntityId" placeholder="User or Class ID — paste from SOQL">
        <small class="muted">Run: SELECT Id, Name FROM User WHERE Name = 'Your Name' to get a User ID</small>
      </div>
      <div class="field span6">
        <label>Expiration (minutes from now)</label>
        <input id="tfExpiry" type="number" value="60" min="1" max="1440">
      </div>
      <div class="field span3">
        <label>Apex Code</label>
        <select id="tfApex"><option>DEBUG</option><option>FINE</option><option>FINER</option><option>FINEST</option><option>INFO</option><option>WARN</option><option>ERROR</option><option>NONE</option></select>
      </div>
      <div class="field span3">
        <label>Apex Profiling</label>
        <select id="tfProf"><option>NONE</option><option>DEBUG</option><option>FINE</option><option>INFO</option></select>
      </div>
      <div class="field span3">
        <label>DB</label>
        <select id="tfDb"><option>DEBUG</option><option>INFO</option><option>FINE</option><option>NONE</option></select>
      </div>
      <div class="field span3">
        <label>Callout</label>
        <select id="tfCallout"><option>INFO</option><option>DEBUG</option><option>FINE</option><option>NONE</option></select>
      </div>
    </div>
    <div class="toolbar"><button id="createTraceFlag">Create Trace Flag</button></div>
    <div id="tfResult"></div>
  </section>`;

  async function loadFlags() {
    try {
      const r = await requireApi().toolingQuery(
        'SELECT Id, TracedEntityId, TracedEntity.Name, LogType, ExpirationDate, DebugLevel.ApexCode, DebugLevel.ApexProfiling, DebugLevel.Database, DebugLevel.Callout FROM TraceFlag ORDER BY ExpirationDate DESC LIMIT 50'
      );
      const flags = r.records || [];
      if (!flags.length) { $('#traceFlagList').innerHTML = '<p class="muted">No active trace flags.</p>'; return; }
      const rows = flags.map(f => {
        const expired = new Date(f.ExpirationDate) < new Date();
        return `<tr style="${expired?'opacity:.5':''}">
          <td style="font-size:12px">${escapeHtml(f.TracedEntity?.Name||f.TracedEntityId||'—')}</td>
          <td style="font-size:12px">${escapeHtml(f.LogType||'')}</td>
          <td style="font-size:12px">${escapeHtml(f.DebugLevel?.ApexCode||'')}</td>
          <td style="font-size:12px">${f.ExpirationDate ? new Date(f.ExpirationDate).toLocaleString() : '—'}${expired?' <span style="color:#f87171;font-size:10px">(expired)</span>':''}</td>
          <td><button data-del-flag="${escapeHtml(f.Id)}" style="font-size:11px;padding:2px 6px;color:#f87171">Delete</button></td>
        </tr>`;
      }).join('');
      $('#traceFlagList').innerHTML = `<table class="table"><thead><tr><th>Entity</th><th>Type</th><th>Apex Level</th><th>Expires</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
      document.querySelectorAll('[data-del-flag]').forEach(btn => {
        btn.onclick = async () => {
          try {
            await requireApi().tooling(`/sobjects/TraceFlag/${btn.dataset.delFlag}`, { method:'DELETE' });
            toast('Trace flag deleted.'); loadFlags();
          } catch(e) { toast(e.message, 5000); }
        };
      });
    } catch(e) { toast(e.message, 4000); }
  }

  $('#loadTraceFlags').onclick = loadFlags;

  $('#createTraceFlag').onclick = async () => {
    const entityId = $('#tfEntityId').value.trim();
    if (!entityId) return toast('Enter an entity ID (User or Apex Class).');
    const expiryMin = parseInt($('#tfExpiry').value) || 60;
    const expiryDate = new Date(Date.now() + expiryMin * 60000).toISOString();
    const btn = $('#createTraceFlag');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      // Create a DebugLevel first
      const dl = await requireApi().tooling('/sobjects/DebugLevel', {
        method: 'POST',
        body: JSON.stringify({
          DeveloperName: 'SFForge_' + Date.now(),
          MasterLabel: 'SF Forge Debug',
          ApexCode: $('#tfApex').value,
          ApexProfiling: $('#tfProf').value,
          Database: $('#tfDb').value,
          Callout: $('#tfCallout').value,
          System: 'DEBUG', Validation: 'INFO', Visualforce: 'INFO', Workflow: 'INFO'
        })
      });
      await requireApi().tooling('/sobjects/TraceFlag', {
        method: 'POST',
        body: JSON.stringify({
          TracedEntityId: entityId,
          DebugLevelId: dl.id,
          LogType: 'USER_DEBUG',
          StartDate: new Date().toISOString(),
          ExpirationDate: expiryDate
        })
      });
      $('#tfResult').innerHTML = '<p class="badge ok" style="margin-top:8px">Trace flag created. Debug logs will be captured.</p>';
      toast('Trace flag created — logs will appear in Debug Logs.');
      loadFlags();
    } catch(e) {
      $('#tfResult').innerHTML = `<p class="error-note">${escapeHtml(e.message)}</p>`;
    } finally { btn.disabled = false; btn.textContent = 'Create Trace Flag'; }
  };

  await loadFlags();
}

// ── Security Health Scan ──────────────────────────────────────────────────────
async function securityScan() {
  view().innerHTML = `<section class="card">
    <h3>Security Health Scan <span class="badge warn">Read-only audit</span></h3>
    <p class="muted">One-click org security checklist covering guest access, password policy, sharing settings, and high-risk permission sets.</p>
    <div class="toolbar">
      <button id="runSecScan">Run Security Scan</button>
      <button class="secondary" id="exportSecurity">Export Report</button>
    </div>
    <div id="secResults" style="margin-top:12px"></div>
  </section>`;

  let scanResults = [];

  function finding(name, status, detail, recommendation) {
    const icon = status === 'pass' ? '✓' : status === 'warn' ? '⚠' : '✗';
    const col  = status === 'pass' ? '#4ade80' : status === 'warn' ? '#fbbf24' : '#f87171';
    return `<div style="border-left:3px solid ${col};padding:8px 12px;margin-bottom:8px;background:var(--panel2);border-radius:0 6px 6px 0">
      <div style="display:flex;gap:8px;align-items:center">
        <span style="color:${col};font-size:16px;font-weight:500">${icon}</span>
        <b style="font-size:13px">${escapeHtml(name)}</b>
        <span style="font-size:11px;color:${col};margin-left:auto;text-transform:uppercase">${status}</span>
      </div>
      <p style="font-size:12px;color:var(--muted);margin:4px 0 0 24px">${escapeHtml(detail)}</p>
      ${recommendation ? `<p style="font-size:11px;color:var(--purple2);margin:2px 0 0 24px">→ ${escapeHtml(recommendation)}</p>` : ''}
    </div>`;
  }

  $('#runSecScan').onclick = async () => {
    const btn = $('#runSecScan');
    btn.disabled = true; btn.textContent = 'Scanning…';
    const res = $('#secResults');
    res.innerHTML = '<p class="muted">Running checks…</p>';
    scanResults = [];
    let html = '';

    const check = async (name, fn) => {
      try { return await fn(); }
      catch(e) { return { status:'warn', detail: 'Could not check: ' + e.message }; }
    };

    // 1. Guest user profile check
    const guestCheck = await check('Guest User Field Access', async () => {
      const r = await requireApi().query("SELECT Id, Name, UserType FROM User WHERE UserType = 'Guest' LIMIT 10");
      if (!r.records?.length) return { status:'pass', detail:'No guest users detected.' };
      return { status:'warn', detail:`${r.records.length} guest user${r.records.length>1?'s':''} found. Review their profile permissions.`, rec:'Audit guest user profile object and field permissions in Setup → Profiles.' };
    });
    html += finding('Guest User Accounts', guestCheck.status, guestCheck.detail, guestCheck.rec);
    scanResults.push({ Check:'Guest User Accounts', ...guestCheck });

    // 2. Password policy
    const pwCheck = await check('Password Complexity Policy', async () => {
      const r = await requireApi().query("SELECT Id, PasswordComplexity, PasswordExpiration, PasswordHistoryRestriction, MinPasswordLength FROM Profile WHERE Name = 'System Administrator' LIMIT 1");
      const p = r.records?.[0];
      if (!p) return { status:'warn', detail:'Could not retrieve password policy.' };
      const issues = [];
      if ((p.MinPasswordLength||0) < 8) issues.push('min length < 8');
      if (!p.PasswordComplexity || p.PasswordComplexity < 3) issues.push('low complexity requirement');
      if (!p.PasswordExpiration) issues.push('no password expiry');
      return issues.length
        ? { status:'warn', detail:`Issues: ${issues.join(', ')}.`, rec:'Strengthen password policy in Setup → Password Policies.' }
        : { status:'pass', detail:'Password policy meets basic security requirements.' };
    });
    html += finding('Password Policy', pwCheck.status, pwCheck.detail, pwCheck.rec);
    scanResults.push({ Check:'Password Policy', ...pwCheck });

    // 3. Profiles with Modify All Data
    const madCheck = await check('Modify All Data Permission', async () => {
      const r = await requireApi().query("SELECT Id, Name FROM Profile WHERE PermissionsModifyAllData = true ORDER BY Name LIMIT 20");
      const names = (r.records||[]).map(p=>p.Name).join(', ');
      if (!r.records?.length) return { status:'pass', detail:'No profiles with Modify All Data found (custom profiles only).' };
      return { status: r.records.length > 3 ? 'fail' : 'warn', detail:`${r.records.length} profile${r.records.length>1?'s':''} have Modify All Data: ${names}.`, rec:'Restrict Modify All Data to System Administrator profile only.' };
    });
    html += finding('Modify All Data Profiles', madCheck.status, madCheck.detail, madCheck.rec);
    scanResults.push({ Check:'Modify All Data', ...madCheck });

    // 4. Profiles with View All Data
    const vadCheck = await check('View All Data Permission', async () => {
      const r = await requireApi().query("SELECT Id, Name FROM Profile WHERE PermissionsViewAllData = true ORDER BY Name LIMIT 20");
      return r.records?.length
        ? { status:'warn', detail:`${r.records.length} profile${r.records.length>1?'s':''} have View All Data.`, rec:'Audit View All Data access — use permission sets instead of profiles where possible.' }
        : { status:'pass', detail:'View All Data is not granted to any custom profiles.' };
    });
    html += finding('View All Data Profiles', vadCheck.status, vadCheck.detail, vadCheck.rec);
    scanResults.push({ Check:'View All Data', ...vadCheck });

    // 5. API-enabled profiles (non-admin)
    const apiCheck = await check('API Access Policy', async () => {
      const r = await requireApi().query("SELECT Id, Name FROM Profile WHERE PermissionsApiEnabled = true AND Name != 'System Administrator' AND UserType = 'Standard' ORDER BY Name LIMIT 30");
      return r.records?.length
        ? { status:'warn', detail:`${r.records.length} non-admin profile${r.records.length>1?'s':''} have API access.`, rec:'Review whether all API-enabled profiles genuinely need API access.' }
        : { status:'pass', detail:'API access is restricted to administrator profiles.' };
    });
    html += finding('API Access (Non-Admin)', apiCheck.status, apiCheck.detail, apiCheck.rec);
    scanResults.push({ Check:'API Access', ...apiCheck });

    // 6. Active named credentials (informational)
    const ncCheck = await check('Named Credentials', async () => {
      const r = await requireApi().query("SELECT Id, DeveloperName, Endpoint FROM NamedCredential ORDER BY DeveloperName LIMIT 20");
      if (!r.records?.length) return { status:'pass', detail:'No named credentials found.' };
      const names = r.records.map(n=>n.DeveloperName).join(', ');
      return { status:'warn', detail:`${r.records.length} named credential${r.records.length>1?'s':''}: ${names}.`, rec:'Review each named credential endpoint and ensure credentials are rotated regularly.' };
    });
    html += finding('Named Credentials', ncCheck.status, ncCheck.detail, ncCheck.rec);
    scanResults.push({ Check:'Named Credentials', ...ncCheck });

    // 7. Permission sets with Modify All Data
    const psCheck = await check('Permission Sets — Modify All Data', async () => {
      const r = await requireApi().query("SELECT Id, Name, Label FROM PermissionSet WHERE PermissionsModifyAllData = true AND IsOwnedByProfile = false ORDER BY Label LIMIT 20");
      if (!r.records?.length) return { status:'pass', detail:'No permission sets grant Modify All Data.' };
      const names = r.records.map(p=>p.Label||p.Name).join(', ');
      return { status:'fail', detail:`${r.records.length} permission set${r.records.length>1?'s':''} grant Modify All Data: ${names}.`, rec:'Revoke Modify All Data from permission sets — assign only to System Administrator profile.' };
    });
    html += finding('Permission Sets — Modify All Data', psCheck.status, psCheck.detail, psCheck.rec);
    scanResults.push({ Check:'PermSet Modify All Data', ...psCheck });

    // Summary
    const pass = scanResults.filter(r=>r.status==='pass').length;
    const warn = scanResults.filter(r=>r.status==='warn').length;
    const fail = scanResults.filter(r=>r.status==='fail').length;
    const summary = `<div style="display:flex;gap:16px;margin-bottom:16px;padding:10px 14px;background:var(--panel2);border-radius:8px">
      <span style="color:#4ade80;font-size:13px">✓ ${pass} passed</span>
      <span style="color:#fbbf24;font-size:13px">⚠ ${warn} warnings</span>
      <span style="color:#f87171;font-size:13px">✗ ${fail} failed</span>
    </div>`;
    res.innerHTML = summary + html;
    btn.disabled = false; btn.textContent = 'Run Security Scan';
  };

  $('#exportSecurity').onclick = () => {
    if (!scanResults.length) return toast('Run the scan first.');
    chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'sf-forge-security-scan.csv', mime:'text/csv', content:toCsv(scanResults) });
  };
}

// ── Saved Workspace — Enhancement #8: SOQL templates per object ───────────────
async function workspace() {
  const key   = api?.key || 'global';
  const store  = await chrome.storage.local.get('sfForgeWorkspace');
  const all    = store.sfForgeWorkspace || {};
  const ws     = all[key] || { favoriteObjects: [], recentSoql: [], metadataSearches: [], notes: '', soqlTemplates: [] };

  view().innerHTML = `<section class="card">
    <h3>Saved Workspace <span class="badge info">Per Org</span></h3>
    <p class="muted">Save favorite objects, recent SOQL, metadata searches, notes, and named SOQL templates for the active org.</p>
    <div class="grid">
      <div class="field span6"><label>Favorite Objects</label><textarea id="wsObjects">${escapeHtml((ws.favoriteObjects||[]).join(NL))}</textarea></div>
      <div class="field span6"><label>Recent SOQL</label><textarea id="wsSoql">${escapeHtml((ws.recentSoql||[]).join(NL))}</textarea></div>
      <div class="field span6"><label>Metadata Searches</label><textarea id="wsMeta">${escapeHtml((ws.metadataSearches||[]).join(NL))}</textarea></div>
      <div class="field span6"><label>Workspace Notes</label><textarea id="wsNotes">${escapeHtml(ws.notes||'')}</textarea></div>
    </div>
    <div class="toolbar"><button id="saveWorkspace">Save Workspace</button><button class="secondary" id="exportWorkspace">Export JSON</button></div>

    <h4 style="margin:20px 0 8px">SOQL Templates <span class="badge info">Run in Inspector</span></h4>
    <p class="muted">Named queries you can run directly from the workspace.</p>
    <div id="soqlTemplates">${renderTemplates(ws.soqlTemplates||[])}</div>
    <div class="toolbar" style="margin-top:8px">
      <input id="tmplName" placeholder="Template name">
      <textarea id="tmplSoql" placeholder="SELECT Id, Name FROM Account LIMIT 10" style="min-height:60px"></textarea>
      <button id="addTemplate">Add Template</button>
    </div>
  </section>`;

  function renderTemplates(templates) {
    if (!templates.length) return '<p class="muted">No templates yet.</p>';
    return templates.map((t,i)=>`<div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
      <span style="flex:1;font-size:13px">${escapeHtml(t.name)}</span>
      <button data-run-tmpl="${i}">Run</button>
      <button class="danger" data-del-tmpl="${i}">✕</button>
    </div>`).join('');
  }

  function bindTemplates(templates) {
    document.querySelectorAll('[data-run-tmpl]').forEach(btn => {
      const t = templates[parseInt(btn.dataset.runTmpl)];
      btn.onclick = () => { active = 'inspector'; render().then(() => { const el = $('#soql'); if (el) el.value = t.soql; }); };
    });
    document.querySelectorAll('[data-del-tmpl]').forEach(btn => {
      btn.onclick = async () => {
        templates.splice(parseInt(btn.dataset.delTmpl), 1);
        ws.soqlTemplates = templates;
        all[key] = ws;
        await chrome.storage.local.set({ sfForgeWorkspace: all });
        $('#soqlTemplates').innerHTML = renderTemplates(templates);
        bindTemplates(templates);
      };
    });
  }

  bindTemplates(ws.soqlTemplates || []);

  $('#addTemplate').onclick = async () => {
    const name = $('#tmplName').value.trim();
    const soql = $('#tmplSoql').value.trim();
    if (!name || !soql) return toast('Enter a name and SOQL query.');
    ws.soqlTemplates = [...(ws.soqlTemplates||[]), { name, soql }];
    all[key] = ws;
    await chrome.storage.local.set({ sfForgeWorkspace: all });
    $('#soqlTemplates').innerHTML = renderTemplates(ws.soqlTemplates);
    bindTemplates(ws.soqlTemplates);
    $('#tmplName').value = '';
    $('#tmplSoql').value = '';
    toast('Template added.');
  };

  $('#saveWorkspace').onclick = async () => {
    all[key] = {
      ...ws,
      favoriteObjects:   $('#wsObjects').value.split(NL).map(x=>x.trim()).filter(Boolean),
      recentSoql:        $('#wsSoql').value.split(NL).map(x=>x.trim()).filter(Boolean),
      metadataSearches:  $('#wsMeta').value.split(NL).map(x=>x.trim()).filter(Boolean),
      notes:             $('#wsNotes').value
    };
    await chrome.storage.local.set({ sfForgeWorkspace: all });
    toast('Workspace saved.');
  };

  $('#exportWorkspace').onclick = () => chrome.runtime.sendMessage({ type:'DOWNLOAD_TEXT', filename:'sf-forge-workspace.json', mime:'application/json', content:JSON.stringify(ws,null,2) });
}

// ── Theme Engine ──────────────────────────────────────────────────────────────
async function themeEngine() {
  await loadThemeSettings();
  const presetOptions = Object.entries(THEME_PRESETS).map(([key, p]) =>
    `<option value="${key}" ${themeSettings.theme === key ? 'selected' : ''}>${p.label}</option>`
  ).join('');
  view().innerHTML = `<div class="grid">
    <section class="card span6">
      <h3>Dark Fenrir Theme Engine <span class="badge info">Live Preview</span></h3>
      <div class="field"><label>Theme Preset</label><select id="themePreset">${presetOptions}</select></div>
      <div class="field"><label>Accent Color</label><input id="accentColor" type="color" value="${escapeHtml(themeSettings.accent || THEME_PRESETS[themeSettings.theme].accent)}"></div>
      <div class="field"><label>Density</label><select id="density"><option value="comfortable" ${themeSettings.density==='comfortable'?'selected':''}>Comfortable</option><option value="compact" ${themeSettings.density==='compact'?'selected':''}>Compact</option></select></div>
      <div class="field"><label>Enterprise Scale</label><select id="scale"><option value="standard" ${themeSettings.scale==='standard'?'selected':''}>Standard</option><option value="large" ${themeSettings.scale==='large'?'selected':''}>Large enterprise mode</option></select></div>
      <div class="toolbar"><button id="saveTheme">Save Theme</button><button class="secondary" id="resetTheme">Reset</button></div>
    </section>
    <section class="card span6 theme-preview">
      <h3>Preview</h3>
      <div class="theme-swatch-row"><span class="swatch main"></span><span class="swatch alt"></span><span class="swatch panel"></span><span class="swatch bg"></span></div>
      <article class="org-tile color-purple">
        <div class="org-tile-head"><div><h4>Full SB</h4><p>Sandbox • active org preview</p></div><span class="badge ok">API Available</span></div>
        <div class="toolbar"><button>Primary Action</button><button class="secondary">Secondary</button><button class="danger">Danger</button></div>
      </article>
    </section>
  </div>`;

  const updateLive = () => saveThemeSettings({ theme: $('#themePreset').value, accent: $('#accentColor').value, density: $('#density').value, scale: $('#scale').value });
  $('#themePreset').onchange = async () => { const p = THEME_PRESETS[$('#themePreset').value]; $('#accentColor').value = p.accent; await updateLive(); };
  $('#accentColor').oninput  = updateLive;
  $('#density').onchange     = updateLive;
  $('#scale').onchange       = updateLive;
  $('#saveTheme').onclick    = async () => { await updateLive(); toast('Theme saved.'); };
  $('#resetTheme').onclick   = async () => { await saveThemeSettings({ theme:'dark-fenrir', accent:'#8b5cf6', density:'comfortable', scale:'standard' }); toast('Theme reset.'); render(); };

  // Append Update Settings section below the theme grid
  const updateSection = document.createElement('section');
  updateSection.className = 'card span12';
  updateSection.id = 'updateSettingsSection';
  const grid = view().querySelector('.grid');
  if (grid) grid.appendChild(updateSection);
  renderUpdateSettings(updateSection).catch(e => { updateSection.innerHTML = `<p class="error-note">${escapeHtml(e.message)}</p>`; });
}

// ── Data Loader — v7: standalone record edit + bulk update ───────────────────
async function dataLoader() {
  view().innerHTML = `<div class="grid">
    <section class="card span12">
      <h3>Data Loader <span class="badge info">Edit · Bulk Update · Delete</span></h3>
      <p class="muted">Run any SOQL query, then edit individual records in the panel below or bulk-update a field across all results. Changes are written immediately via the REST API.</p>
      <div class="toolbar">
        <textarea id="dlSoql" style="min-height:60px;flex:1" placeholder="SELECT Id, Name, StageName, CloseDate FROM Opportunity WHERE StageName = 'Prospecting' LIMIT 200"></textarea>
      </div>
      <div class="toolbar">
        <button id="dlRun">Run Query</button>
        <button class="secondary" id="dlRunAll">Load All Pages</button>
        <button class="secondary" id="dlCsv">Export CSV</button>
        <span id="dlProgress" class="muted" style="font-size:12px"></span>
      </div>
    </section>

    <section class="card span8" id="dlResultCard">
      <h3>Results <span class="muted" id="dlCount" style="font-size:13px;font-weight:400"></span></h3>
      <div id="dlResult"><p class="muted">Run a query to load records.</p></div>
    </section>

    <section class="card span4">
      <h3>Record Editor</h3>
      <div id="dlEditor">
        <p class="muted" style="font-size:12px">Click a row to open it here.</p>
      </div>
      <div id="dlEditorBar" style="display:none;margin-top:10px;border-top:1px solid var(--line);padding-top:10px">
        <div class="toolbar">
          <button id="dlSaveRecord">Save Record</button>
          <button class="secondary" id="dlCancelEdit">Cancel</button>
        </div>
        <p id="dlSaveStatus" class="muted" style="font-size:11px;margin:4px 0 0"></p>
      </div>

      <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px">
        <h4 style="font-size:13px;margin:0 0 8px">Bulk Update All Results</h4>
        <p class="muted" style="font-size:12px;margin-bottom:8px">Set one field to one value across every record in the current query result. Use with care.</p>
        <div class="field" style="margin-bottom:8px">
          <label style="font-size:12px">Field API Name</label>
          <input id="dlBulkField" placeholder="e.g. OwnerId">
        </div>
        <div class="field" style="margin-bottom:8px">
          <label style="font-size:12px">New Value</label>
          <input id="dlBulkValue" placeholder="e.g. 005xxx…">
        </div>
        <div class="toolbar">
          <button id="dlBulkUpdate" class="danger">Bulk Update</button>
          <span id="dlBulkStatus" class="muted" style="font-size:12px"></span>
        </div>
        <div id="dlBulkProgress"></div>
      </div>

      <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px">
        <h4 style="font-size:13px;margin:0 0 6px">Delete Selected Records</h4>
        <p class="muted" style="font-size:12px;margin-bottom:8px">Check rows in the results table then delete. Unrecoverable — use Recycle Bin to restore.</p>
        <div class="toolbar">
          <button id="dlDeleteSelected" class="danger">Delete Checked</button>
          <span id="dlDeleteStatus" class="muted" style="font-size:12px"></span>
        </div>
      </div>
    </section>
  </div>`;

  let dlRecords = [], dlSortCol = null, dlSortDir = 1, dlEditRec = null;

  function dlSort(records) {
    if (!dlSortCol) return records;
    return [...records].sort((a,b) => {
      const av = a[dlSortCol]??'', bv = b[dlSortCol]??'';
      return dlSortDir * (String(av)<String(bv)?-1:String(av)>String(bv)?1:0);
    });
  }

  function renderDlTable(records) {
    if (!records.length) return '<p class="muted">No records returned.</p>';
    const cols = [...new Set(records.flatMap(r=>Object.keys(r).filter(k=>k!=='attributes'&&!k.startsWith('_'))))].slice(0,10);
    const ths = cols.map(c=>{
      const arrow = c===dlSortCol?(dlSortDir===1?' ▲':' ▼'):'';
      return `<th style="cursor:pointer;font-size:12px;padding:7px 8px;color:var(--purple2)" data-dlcol="${escapeHtml(c)}">${escapeHtml(c)}${arrow}</th>`;
    }).join('');
    const rows = dlSort(records).map((r,i)=>`<tr style="cursor:pointer">
      <td style="padding:4px 6px"><input type="checkbox" class="dl-check" data-idx="${i}"></td>
      ${cols.map(c=>`<td style="font-size:11px;padding:4px 8px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:160px" title="${escapeHtml(String(r[c]??''))}">${escapeHtml(String(r[c]??'').substring(0,80))}</td>`).join('')}
    </tr>`).join('');
    return `<div style="overflow-x:auto"><table class="table" style="width:100%;table-layout:auto">
      <thead><tr><th style="width:28px;padding:4px"></th>${ths}</tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  }

  function bindDlTable() {
    document.querySelectorAll('[data-dlcol]').forEach(th=>{
      th.onclick = ()=>{
        if(dlSortCol===th.dataset.dlcol){dlSortDir*=-1;}else{dlSortCol=th.dataset.dlcol;dlSortDir=1;}
        $('#dlResult').innerHTML = renderDlTable(dlRecords);
        bindDlTable();
      };
    });
    document.querySelectorAll('#dlResult tbody tr').forEach((tr,i)=>{
      // click on row (not checkbox) opens editor
      tr.onclick = e=>{
        if(e.target.type==='checkbox') return;
        const rec = dlSort(dlRecords)[i];
        if(!rec) return;
        dlEditRec = rec;
        openDlEditor(rec);
      };
    });
  }

  function openDlEditor(rec) {
    const fields = Object.keys(rec).filter(k=>k!=='attributes');
    const rows = fields.map(k=>{
      const v = rec[k];
      const isComplex = typeof v === 'object' && v !== null;
      const inp = k==='Id' || isComplex
        ? `<span style="font-size:12px;color:var(--muted)">${escapeHtml(typeof v==='object'?JSON.stringify(v):String(v??''))}</span>`
        : `<input data-dl-edit="${escapeHtml(k)}" value="${escapeHtml(String(v??''))}" style="width:100%;font-size:12px;padding:2px 6px">`;
      return `<tr>
        <td style="font-size:11px;color:var(--muted);padding:3px 6px 3px 0;white-space:nowrap;vertical-align:middle">${escapeHtml(k)}</td>
        <td style="padding:2px 0;vertical-align:middle">${inp}</td>
      </tr>`;
    }).join('');
    $('#dlEditor').innerHTML = `<p style="font-size:11px;color:var(--purple2);margin:0 0 8px">${escapeHtml(rec.Id||'')}</p><table style="width:100%">${rows}</table>`;
    if(rec.Id && api?.orgUrl) {
      $('#dlEditor').innerHTML += `<a href="${api.orgUrl}/${rec.Id}" target="_blank" style="font-size:11px;color:var(--purple2);margin-top:6px;display:block">Open in Salesforce ↗</a>`;
    }
    $('#dlEditorBar').style.display = '';
    $('#dlSaveStatus').textContent = '';
  }

  $('#dlSaveRecord').onclick = async ()=>{
    if(!dlEditRec?.Id) return toast('Select a record first.');
    const objName = dlEditRec.attributes?.type;
    if(!objName) return toast('Object type unknown — ensure your SOQL selects Id so the record includes attributes.');
    const inputs = document.querySelectorAll('[data-dl-edit]');
    const changes = {};
    inputs.forEach(inp=>{
      const f=inp.dataset.dlEdit, orig=dlEditRec[f];
      const val=inp.value;
      if(String(orig??'')!==val){
        if(val==='true'||val==='false') changes[f]=val==='true';
        else changes[f] = val==='' ? null : val;
      }
    });
    if(!Object.keys(changes).length) return toast('No changes detected.');
    const btn=$('#dlSaveRecord'); btn.disabled=true; $('#dlSaveStatus').textContent='Saving…';
    try {
      await requireApi().request(`/services/data/v66.0/sobjects/${objName}/${dlEditRec.Id}`,{method:'PATCH',body:JSON.stringify(changes)});
      Object.assign(dlEditRec,changes);
      dlRecords = dlRecords.map(r=>r.Id===dlEditRec.Id?{...r,...changes}:r);
      $('#dlResult').innerHTML = renderDlTable(dlRecords);
      bindDlTable();
      openDlEditor(dlEditRec);
      $('#dlSaveStatus').textContent='✓ Saved';
      toast(`Saved ${Object.keys(changes).length} change${Object.keys(changes).length>1?'s':''} to ${dlEditRec.Id}.`);
    } catch(e){ $('#dlSaveStatus').textContent=''; toast(e.message,6000,{copyText:e.message}); }
    finally{ btn.disabled=false; }
  };

  $('#dlCancelEdit').onclick=()=>{ dlEditRec=null; $('#dlEditor').innerHTML='<p class="muted" style="font-size:12px">Click a row to open it here.</p>'; $('#dlEditorBar').style.display='none'; };

  async function runDlQuery(all=false) {
    const soql=$('#dlSoql').value.trim();
    if(!soql) return toast('Enter a SOQL query.');
    const prog=$('#dlProgress'); prog.textContent='Running…';
    try {
      const r = all
        ? await requireApi().queryAll(soql,{maxRecords:10000,onPage:(l,t)=>{prog.textContent=`Loaded ${l} of ${t}…`;}})
        : await requireApi().query(soql);
      dlRecords = r.records||[];
      prog.textContent = `${dlRecords.length} record${dlRecords.length!==1?'s':''}`+(r.truncated?` (capped at 10,000)`:'');
      $('#dlCount').textContent = prog.textContent;
      $('#dlResult').innerHTML = renderDlTable(dlRecords);
      bindDlTable();
    } catch(e){ prog.textContent=''; toast(e.message,5000,{copyText:e.message}); }
  }

  $('#dlRun').onclick    = ()=>runDlQuery(false);
  $('#dlRunAll').onclick  = ()=>runDlQuery(true);
  $('#dlCsv').onclick     = ()=>{
    if(!dlRecords.length) return toast('Run a query first.');
    chrome.runtime.sendMessage({type:'DOWNLOAD_TEXT',filename:'sf-forge-data.csv',mime:'text/csv',content:toCsv(dlRecords)});
  };

  // Bulk update
  $('#dlBulkUpdate').onclick = async ()=>{
    if(!dlRecords.length) return toast('Run a query first.');
    const field=$('#dlBulkField').value.trim();
    const value=$('#dlBulkValue').value.trim();
    if(!field) return toast('Enter a field API name.');
    const objName = dlRecords[0]?.attributes?.type;
    if(!objName) return toast('Object type unknown — re-run query.');
    if(!confirm(`Update "${field}" to "${value}" on ${dlRecords.length} records?\n\nThis cannot be undone.`)) return;
    const btn=$('#dlBulkUpdate'); btn.disabled=true;
    const prog=$('#dlBulkProgress'); prog.innerHTML='';
    const stat=$('#dlBulkStatus'); stat.textContent='';
    let ok=0, fail=0;
    const total=dlRecords.length;
    for(const rec of dlRecords){
      try{
        const payload={[field]: value===''?null:value};
        await requireApi().request(`/services/data/v66.0/sobjects/${objName}/${rec.Id}`,{method:'PATCH',body:JSON.stringify(payload)});
        rec[field]=value; ok++;
      } catch(e){ fail++; }
      stat.textContent=`${ok+fail}/${total} processed`;
    }
    prog.innerHTML=`<p style="font-size:12px;color:${fail?'#fbbf24':'#4ade80'};margin:4px 0">✓ ${ok} updated${fail?`, ${fail} failed`:''}</p>`;
    dlRecords=[...dlRecords];
    $('#dlResult').innerHTML=renderDlTable(dlRecords);
    bindDlTable();
    btn.disabled=false;
    toast(`Bulk update complete: ${ok} updated, ${fail} failed.`);
  };

  // Delete selected
  $('#dlDeleteSelected').onclick = async ()=>{
    const checked=[...document.querySelectorAll('.dl-check:checked')].map(c=>parseInt(c.dataset.idx));
    if(!checked.length) return toast('Check at least one row to delete.');
    const toDelete=checked.map(i=>dlSort(dlRecords)[i]).filter(Boolean);
    const objName=toDelete[0]?.attributes?.type;
    if(!objName) return toast('Object type unknown — re-run query.');
    if(!confirm(`Delete ${toDelete.length} record${toDelete.length>1?'s':''}?\n\nThis removes them from the org (Recycle Bin for recoverable objects).`)) return;
    const btn=$('#dlDeleteSelected'); btn.disabled=true;
    const stat=$('#dlDeleteStatus'); stat.textContent='Deleting…';
    let ok=0,fail=0;
    const deletedIds=new Set();
    for(const rec of toDelete){
      try{
        await requireApi().request(`/services/data/v66.0/sobjects/${objName}/${rec.Id}`,{method:'DELETE'});
        deletedIds.add(rec.Id); ok++;
      } catch(e){ fail++; }
    }
    dlRecords=dlRecords.filter(r=>!deletedIds.has(r.Id));
    stat.textContent=`${ok} deleted${fail?`, ${fail} failed`:''}`;
    $('#dlResult').innerHTML=renderDlTable(dlRecords);
    bindDlTable();
    btn.disabled=false;
    toast(`Deleted ${ok} record${ok!==1?'s':''}.`);
  };
}

// ── Automation Health Dashboard — v7 ─────────────────────────────────────────
async function automationHealth() {
  view().innerHTML = `<section class="card">
    <h3>Automation Health Dashboard <span class="badge info">v7 — Flows · Scheduled Jobs · Workflows · PBs</span></h3>
    <p class="muted">One view for every automation layer in your org. Understand what's active, what fires tonight, and what's obsolete.</p>
    <div class="toolbar">
      <button id="ahRun">Load All Automation</button>
      <button class="secondary" id="ahExport">Export CSV</button>
    </div>
    <div id="ahSummary" style="margin:10px 0"></div>
    <div id="ahTabs" style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px"></div>
    <div id="ahResult"></div>
  </section>`;

  let ahData = { flows:[], scheduled:[], workflows:[], processBuilders:[], validationRules:[] };
  let ahActiveTab = 'flows';

  function ahSummaryBar() {
    const parts = [
      { label:'Active Flows',      val: ahData.flows.filter(f=>f.Status==='Active').length,       total: ahData.flows.length,            col:'#34d399' },
      { label:'Scheduled Jobs',    val: ahData.scheduled.length,                                   total: ahData.scheduled.length,        col:'#60a5fa' },
      { label:'Active Workflows',  val: ahData.workflows.filter(w=>w.Active).length,               total: ahData.workflows.length,        col:'#fbbf24' },
      { label:'Process Builders',  val: ahData.processBuilders.filter(p=>p.Status==='Active').length, total: ahData.processBuilders.length, col:'#f472b6' },
      { label:'Validation Rules',  val: ahData.validationRules.filter(v=>v.Active).length,         total: ahData.validationRules.length,  col:'#a78bfa' }
    ];
    return `<div style="display:flex;gap:14px;flex-wrap:wrap;padding:10px 14px;background:var(--panel2);border-radius:10px">
      ${parts.map(p=>`<div style="text-align:center">
        <div style="font-size:20px;font-weight:700;color:${p.col}">${p.val}<span style="font-size:12px;color:var(--muted);font-weight:400">/${p.total}</span></div>
        <div style="font-size:11px;color:var(--muted)">${p.label}</div>
      </div>`).join('')}
    </div>`;
  }

  function ahTabBar() {
    const tabs = [
      {id:'flows',          label:`Flows (${ahData.flows.length})`},
      {id:'scheduled',      label:`Scheduled Jobs (${ahData.scheduled.length})`},
      {id:'workflows',      label:`Workflows (${ahData.workflows.length})`},
      {id:'processBuilders',label:`Process Builders (${ahData.processBuilders.length})`},
      {id:'validationRules',label:`Validation Rules (${ahData.validationRules.length})`}
    ];
    $('#ahTabs').innerHTML = tabs.map(t=>
      `<button class="secondary ah-tab ${t.id===ahActiveTab?'active-tab':''}" data-ahtab="${t.id}" style="font-size:12px;padding:6px 12px">${t.label}</button>`
    ).join('');
    document.querySelectorAll('.ah-tab').forEach(b=>b.onclick=()=>{
      ahActiveTab=b.dataset.ahtab;
      document.querySelectorAll('.ah-tab').forEach(x=>x.classList.remove('active-tab'));
      b.classList.add('active-tab');
      renderAhTab();
    });
  }

  function renderAhTab() {
    const res = $('#ahResult');
    if(ahActiveTab==='flows') {
      const rows = ahData.flows.map(f=>({
        Name: f.Label||f.ApiName, ApiName: f.ApiName, Type: f.ProcessType,
        Status: f.Status, Modified: timeAgo(f.LastModifiedDate)
      }));
      res.innerHTML = rows.length ? table(rows) : '<p class="muted">No flows found.</p>';
    } else if(ahActiveTab==='scheduled') {
      const rows = ahData.scheduled.map(c=>({
        Name: c.CronJobDetail?.Name||c.Id, State: c.State,
        NextFire: c.NextFireTime ? new Date(c.NextFireTime).toLocaleString() : '—',
        PrevFire: c.PreviousFireTime ? new Date(c.PreviousFireTime).toLocaleString() : '—',
        Cron: c.CronExpression||'—'
      }));
      res.innerHTML = rows.length ? table(rows) : '<p class="muted">No scheduled jobs found.</p>';
    } else if(ahActiveTab==='workflows') {
      const rows = ahData.workflows.map(w=>({
        Name: w.Name, Object: w.TableEnumOrId,
        Active: w.Metadata?.active ? '✓ Active' : '— Inactive',
        Actions: (w.Metadata?.actions||[]).map(a=>a.type).join(', ')||'—',
        Modified: timeAgo(w.LastModifiedDate)
      }));
      res.innerHTML = rows.length ? table(rows) : '<p class="muted">No workflow rules found (or API access not available).</p>';
    } else if(ahActiveTab==='processBuilders') {
      const rows = ahData.processBuilders.map(f=>({
        Name: f.Label||f.ApiName, ApiName: f.ApiName, Status: f.Status, Modified: timeAgo(f.LastModifiedDate)
      }));
      res.innerHTML = rows.length ? table(rows) : '<p class="muted">No Process Builders found.</p>';
    } else if(ahActiveTab==='validationRules') {
      const rows = ahData.validationRules.map(v=>({
        Name: v.ValidationName, Object: v.EntityDefinition?.QualifiedApiName||'—',
        Active: v.Active ? '✓' : '—',
        ErrorMessage: (v.ErrorMessage||'').substring(0,80),
        Modified: timeAgo(v.LastModifiedDate)
      }));
      res.innerHTML = rows.length ? table(rows) : '<p class="muted">No validation rules found.</p>';
    }
  }

  $('#ahRun').onclick = async ()=>{
    const btn=$('#ahRun'); btn.disabled=true; btn.textContent='Loading…';
    const res=$('#ahResult'); res.innerHTML='<p class="muted">Fetching automation data…</p>';
    try {
      // Flows: all non-process-builder flows
      const flowRes = await requireApi().toolingQueryAll(
        `SELECT Id, ApiName, Label, ProcessType, Status, LastModifiedDate FROM FlowDefinitionView WHERE ProcessType NOT IN ('CustomEvent','InvocableProcess') ORDER BY Label`,
        {maxRecords:2000}
      );
      ahData.flows = (flowRes.records||[]).filter(f=>f.ProcessType!=='InvocableProcess');
      ahData.processBuilders = (flowRes.records||[]).filter(f=>f.ProcessType==='InvocableProcess');

      // Scheduled jobs
      const cronRes = await requireApi().query(
        `SELECT Id, CronJobDetail.Name, State, NextFireTime, PreviousFireTime, StartTime, EndTime, CronExpression FROM CronTrigger ORDER BY NextFireTime ASC LIMIT 200`
      );
      ahData.scheduled = cronRes.records||[];

      // Workflow rules via Tooling API
      try {
        const wfRes = await requireApi().toolingQueryAll(
          `SELECT Id, Name, TableEnumOrId, Metadata, LastModifiedDate FROM WorkflowRule ORDER BY Name LIMIT 500`,
          {maxRecords:500}
        );
        ahData.workflows = wfRes.records||[];
      } catch(_) { ahData.workflows = []; }

      // Validation rules
      const vrRes = await requireApi().toolingQueryAll(
        `SELECT Id, ValidationName, Active, ErrorMessage, EntityDefinitionId, EntityDefinition.QualifiedApiName, LastModifiedDate FROM ValidationRule ORDER BY ValidationName LIMIT 1000`,
        {maxRecords:1000}
      );
      ahData.validationRules = vrRes.records||[];

      $('#ahSummary').innerHTML = ahSummaryBar();
      ahTabBar();
      renderAhTab();
      toast(`Automation loaded: ${ahData.flows.length} flows, ${ahData.scheduled.length} scheduled jobs, ${ahData.validationRules.length} validation rules.`);
    } catch(e){ res.innerHTML=`<p class="error-note">${escapeHtml(e.message)}</p>`; toast(e.message,5000,{copyText:e.message}); }
    finally{ btn.disabled=false; btn.textContent='Load All Automation'; }
  };

  $('#ahExport').onclick=()=>{
    const all=[
      ...ahData.flows.map(r=>({Category:'Flow',...r})),
      ...ahData.scheduled.map(r=>({Category:'ScheduledJob', Name:r.CronJobDetail?.Name, State:r.State, NextFireTime:r.NextFireTime, CronExpression:r.CronExpression})),
      ...ahData.workflows.map(r=>({Category:'WorkflowRule',...r})),
      ...ahData.processBuilders.map(r=>({Category:'ProcessBuilder',...r})),
      ...ahData.validationRules.map(r=>({Category:'ValidationRule',...r}))
    ];
    if(!all.length) return toast('Load automation first.');
    chrome.runtime.sendMessage({type:'DOWNLOAD_TEXT',filename:'sf-forge-automation-health.csv',mime:'text/csv',content:toCsv(all)});
  };
}

// ── User License & Login History Audit — v7 ──────────────────────────────────
async function userLicenseAudit() {
  view().innerHTML = `<section class="card">
    <h3>User &amp; License Audit <span class="badge info">v7 — Inactive · Licenses · Login History</span></h3>
    <p class="muted">Audit active users, identify inactive accounts for license reclamation, and review login failures.</p>
    <div class="toolbar" style="margin-bottom:8px">
      <button id="ulaTabUsers" class="pl-tab active-tab">👤 Users</button>
      <button id="ulaTabLicenses" class="pl-tab">📋 Licenses</button>
      <button id="ulaTabLogins" class="pl-tab">🔐 Login History</button>
    </div>

    <div id="ulaUsers">
      <div class="toolbar">
        <select id="ulaInactiveFilter">
          <option value="all">All active users</option>
          <option value="90">No login in 90+ days</option>
          <option value="180">No login in 180+ days</option>
          <option value="365">No login in 365+ days</option>
          <option value="never">Never logged in</option>
        </select>
        <input id="ulaUserSearch" placeholder="Search name or username…" style="max-width:220px">
        <select id="ulaLicenseFilter" style="max-width:200px"><option value="">All license types</option></select>
        <button id="ulaLoadUsers">Load Users</button>
        <button class="secondary" id="ulaExportUsers">Export CSV</button>
      </div>
      <div id="ulaUserResult"></div>
    </div>

    <div id="ulaLicenses" style="display:none">
      <div class="toolbar">
        <button id="ulaLoadLicenses">Load License Usage</button>
        <button class="secondary" id="ulaExportLicenses">Export CSV</button>
      </div>
      <div id="ulaLicenseResult"></div>
    </div>

    <div id="ulaLogins" style="display:none">
      <p class="muted" style="margin-bottom:10px">Login History shows the last 20,000 login events. Filter by status to find failed or blocked attempts.</p>
      <div class="toolbar">
        <select id="ulaLoginStatus">
          <option value="">All statuses</option>
          <option>Success</option><option>Failed</option><option>No Password</option>
          <option>Invalid Password</option><option>Locked</option>
        </select>
        <input id="ulaLoginUser" placeholder="Filter by username…" style="max-width:220px">
        <select id="ulaLoginDays" style="max-width:140px">
          <option value="1">Today</option>
          <option value="7" selected>Last 7 days</option>
          <option value="30">Last 30 days</option>
        </select>
        <button id="ulaLoadLogins">Load Login History</button>
        <button class="secondary" id="ulaExportLogins">Export CSV</button>
      </div>
      <div id="ulaLoginResult"></div>
    </div>
  </section>`;

  // Tab switching
  const tabPanels={ulaTabUsers:'ulaUsers', ulaTabLicenses:'ulaLicenses', ulaTabLogins:'ulaLogins'};
  ['ulaTabUsers','ulaTabLicenses','ulaTabLogins'].forEach(tid=>{
    document.getElementById(tid).onclick=()=>{
      document.querySelectorAll('.pl-tab').forEach(b=>b.classList.remove('active-tab'));
      document.getElementById(tid).classList.add('active-tab');
      Object.entries(tabPanels).forEach(([t,p])=>{ document.getElementById(p).style.display=t===tid?'':'none'; });
    };
  });

  let ulaUsers=[], ulaLicenses=[], ulaLogins=[];

  // ─ Users tab ────────────────────────────────────────────────────────────
  $('#ulaLoadUsers').onclick = async ()=>{
    const btn=$('#ulaLoadUsers'); btn.disabled=true; btn.textContent='Loading…';
    const res=$('#ulaUserResult'); res.innerHTML='<p class="muted">Querying users…</p>';
    try {
      const r = await requireApi().queryAll(
        `SELECT Id, Name, Username, Email, ProfileId, Profile.Name, UserType, IsActive, LastLoginDate, CreatedDate, UserLicenseId, UserLicense.Name FROM User WHERE IsActive=true ORDER BY LastLoginDate ASC NULLS FIRST`,
        {maxRecords:5000}
      );
      ulaUsers = r.records||[];
      // Populate license filter
      const licNames=[...new Set(ulaUsers.map(u=>u.UserLicense?.Name).filter(Boolean))].sort();
      $('#ulaLicenseFilter').innerHTML='<option value="">All license types</option>'+licNames.map(n=>`<option>${escapeHtml(n)}</option>`).join('');
      applyUlaFilters();
      toast(`${ulaUsers.length} active users loaded.`);
    } catch(e){ res.innerHTML=`<p class="error-note">${escapeHtml(e.message)}</p>`; toast(e.message,5000,{copyText:e.message}); }
    finally{ btn.disabled=false; btn.textContent='Load Users'; }
  };

  function applyUlaFilters() {
    const inact=$('#ulaInactiveFilter').value;
    const search=($('#ulaUserSearch').value||'').toLowerCase();
    const licFilter=$('#ulaLicenseFilter').value;
    const now=Date.now();
    let filtered=ulaUsers;
    if(inact==='never') filtered=filtered.filter(u=>!u.LastLoginDate);
    else if(inact!=='all'){
      const days=parseInt(inact);
      const cutoff=now-days*86400000;
      filtered=filtered.filter(u=>!u.LastLoginDate||new Date(u.LastLoginDate).getTime()<cutoff);
    }
    if(search) filtered=filtered.filter(u=>(u.Name||'').toLowerCase().includes(search)||(u.Username||'').toLowerCase().includes(search));
    if(licFilter) filtered=filtered.filter(u=>u.UserLicense?.Name===licFilter);

    const rows=filtered.map(u=>{
      const daysSince=u.LastLoginDate?Math.floor((now-new Date(u.LastLoginDate).getTime())/86400000):null;
      const daysColor=daysSince===null?'#f87171':daysSince>180?'#fbbf24':daysSince>90?'#fde68a':'#4ade80';
      return {
        Name:u.Name, Username:u.Username, Profile:u.Profile?.Name||'—',
        License:u.UserLicense?.Name||'—',
        LastLogin: daysSince===null?'Never':`${daysSince}d ago`,
        _daysSince:daysSince, _color:daysColor
      };
    });

    if(!rows.length){ $('#ulaUserResult').innerHTML='<p class="muted">No users match current filters.</p>'; return; }

    const thStyle='style="color:var(--purple2);padding:8px;text-align:left;border-bottom:1px solid var(--line)"';
    const tdStyle='style="padding:7px 8px;border-bottom:1px solid var(--line);font-size:12px"';
    const summary=`<p style="font-size:12px;color:var(--muted);margin-bottom:8px">${filtered.length} user${filtered.length!==1?'s':''} match filters</p>`;
    const body=rows.map(r=>`<tr>
      <td ${tdStyle}>${escapeHtml(r.Name)}</td>
      <td ${tdStyle}>${escapeHtml(r.Username)}</td>
      <td ${tdStyle}>${escapeHtml(r.Profile)}</td>
      <td ${tdStyle}>${escapeHtml(r.License)}</td>
      <td ${tdStyle} style="color:${r._color}">${escapeHtml(r.LastLogin)}</td>
    </tr>`).join('');
    $('#ulaUserResult').innerHTML=summary+`<div style="overflow-x:auto"><table class="table" style="width:100%">
      <thead><tr><th ${thStyle}>Name</th><th ${thStyle}>Username</th><th ${thStyle}>Profile</th><th ${thStyle}>License</th><th ${thStyle}>Last Login</th></tr></thead>
      <tbody>${body}</tbody>
    </table></div>`;
  }

  let ulaFilterTimer;
  setTimeout(()=>{
    ['ulaInactiveFilter','ulaLicenseFilter'].forEach(id=>{ const el=$(`#${id}`); if(el) el.onchange=applyUlaFilters; });
    $('#ulaUserSearch')?.addEventListener('input',()=>{ clearTimeout(ulaFilterTimer); ulaFilterTimer=setTimeout(applyUlaFilters,250); });
  },100);

  $('#ulaExportUsers').onclick=()=>{
    if(!ulaUsers.length) return toast('Load users first.');
    chrome.runtime.sendMessage({type:'DOWNLOAD_TEXT',filename:'sf-forge-users.csv',mime:'text/csv',content:toCsv(ulaUsers.map(u=>({Name:u.Name,Username:u.Username,Profile:u.Profile?.Name,License:u.UserLicense?.Name,LastLogin:u.LastLoginDate||'Never',Created:u.CreatedDate})))});
  };

  // ─ Licenses tab ─────────────────────────────────────────────────────────
  $('#ulaLoadLicenses').onclick=async()=>{
    const btn=$('#ulaLoadLicenses'); btn.disabled=true; btn.textContent='Loading…';
    const res=$('#ulaLicenseResult'); res.innerHTML='<p class="muted">Querying license data…</p>';
    try {
      const r=await requireApi().query(`SELECT Id, Name, TotalLicenses, UsedLicenses, Status FROM UserLicense ORDER BY Name`);
      ulaLicenses=r.records||[];
      const rows=ulaLicenses.map(l=>{
        const pct=l.TotalLicenses>0?Math.round(l.UsedLicenses/l.TotalLicenses*100):0;
        const col=pct>=90?'#f87171':pct>=70?'#fbbf24':'#4ade80';
        return {Name:l.Name, Used:l.UsedLicenses, Total:l.TotalLicenses, Available:l.TotalLicenses-l.UsedLicenses, PctUsed:`${pct}%`, Status:l.Status, _pct:pct, _col:col};
      });
      const thStyle='style="color:var(--purple2);padding:8px;text-align:left;border-bottom:1px solid var(--line)"';
      const tdStyle='style="padding:7px 8px;border-bottom:1px solid var(--line);font-size:12px"';
      const body=rows.map(r=>`<tr>
        <td ${tdStyle}>${escapeHtml(r.Name)}</td>
        <td ${tdStyle}><div style="display:flex;align-items:center;gap:8px">
          <div style="background:var(--panel);border-radius:4px;height:8px;width:100px;overflow:hidden"><div style="background:${r._col};height:100%;width:${r._pct}%;border-radius:4px"></div></div>
          <span style="color:${r._col}">${r.PctUsed}</span>
        </div></td>
        <td ${tdStyle}>${r.Used} / ${r.Total}</td>
        <td ${tdStyle} style="color:${r.Available<=0?'#f87171':'#4ade80'}">${r.Available} available</td>
        <td ${tdStyle}>${escapeHtml(r.Status)}</td>
      </tr>`).join('');
      res.innerHTML=`<table class="table" style="width:100%"><thead><tr>
        <th ${thStyle}>License</th><th ${thStyle}>Usage</th><th ${thStyle}>Used/Total</th><th ${thStyle}>Available</th><th ${thStyle}>Status</th>
      </tr></thead><tbody>${body}</tbody></table>`;
      toast(`${ulaLicenses.length} license types loaded.`);
    } catch(e){ res.innerHTML=`<p class="error-note">${escapeHtml(e.message)}</p>`; toast(e.message,5000,{copyText:e.message}); }
    finally{ btn.disabled=false; btn.textContent='Load License Usage'; }
  };

  $('#ulaExportLicenses').onclick=()=>{
    if(!ulaLicenses.length) return toast('Load licenses first.');
    chrome.runtime.sendMessage({type:'DOWNLOAD_TEXT',filename:'sf-forge-licenses.csv',mime:'text/csv',content:toCsv(ulaLicenses)});
  };

  // ─ Login History tab ────────────────────────────────────────────────────
  $('#ulaLoadLogins').onclick=async()=>{
    const btn=$('#ulaLoadLogins'); btn.disabled=true; btn.textContent='Loading…';
    const res=$('#ulaLoginResult'); res.innerHTML='<p class="muted">Querying login history…</p>';
    try {
      const days=parseInt($('#ulaLoginDays').value)||7;
      const since=new Date(Date.now()-days*86400000).toISOString().split('.')[0]+'Z';
      const statusFilter=$('#ulaLoginStatus').value;
      const userFilter=($('#ulaLoginUser').value||'').trim();
      let soql=`SELECT Id, UserId, Username, LoginTime, LoginType, Status, SourceIp, Browser, Platform, Application FROM LoginHistory WHERE LoginTime >= ${since}`;
      if(statusFilter) soql+=` AND Status='${safeLike(statusFilter)}'`;
      if(userFilter) soql+=` AND Username LIKE '%${safeLike(userFilter)}%'`;
      soql+=` ORDER BY LoginTime DESC LIMIT 2000`;
      const r=await requireApi().queryAll(soql,{maxRecords:2000});
      ulaLogins=r.records||[];
      const rows=ulaLogins.map(l=>({
        Time:new Date(l.LoginTime).toLocaleString(), User:l.Username,
        Status:l.Status, Type:l.LoginType, Source:l.SourceIp||'—',
        Browser:l.Browser||'—', Platform:l.Platform||'—'
      }));
      const failed=ulaLogins.filter(l=>l.Status!=='Success').length;
      const summary=`<p style="font-size:12px;color:var(--muted);margin-bottom:8px">${ulaLogins.length} events — <span style="color:${failed?'#f87171':'#4ade80'}">${failed} failed/blocked</span></p>`;
      res.innerHTML=summary+table(rows);
      toast(`${ulaLogins.length} login events loaded.`);
    } catch(e){ res.innerHTML=`<p class="error-note">${escapeHtml(e.message)}</p>`; toast(e.message,5000,{copyText:e.message}); }
    finally{ btn.disabled=false; btn.textContent='Load Login History'; }
  };

  $('#ulaExportLogins').onclick=()=>{
    if(!ulaLogins.length) return toast('Load login history first.');
    chrome.runtime.sendMessage({type:'DOWNLOAD_TEXT',filename:'sf-forge-login-history.csv',mime:'text/csv',content:toCsv(ulaLogins)});
  };
}

// ── Who Broke It? Quick Filter — v7 ─────────────────────────────────────────
async function whobrokeit() {
  view().innerHTML = `<section class="card">
    <h3>Who Broke It? <span class="badge danger">Panic Button</span></h3>
    <p class="muted">Pre-built filters for the most common "something just stopped working" audit scenarios. Runs against SetupAuditTrail and surfaces only the changes most likely to cause incidents.</p>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:14px 0" id="wbiPanels">
      ${[
        {id:'wbiFlows',     label:'⚡ Flow Changes',         desc:'Activated, deactivated, or deleted Flows in the last 48h',           color:'#34d399'},
        {id:'wbiApex',      label:'🔧 Apex Changes',         desc:'Apex class or trigger edits, saves, or compilations',                color:'#60a5fa'},
        {id:'wbiProfiles',  label:'🛡 Profile & Perm Changes',desc:'Permission set or profile modifications',                           color:'#f472b6'},
        {id:'wbiValidation',label:'✓ Validation Rules',      desc:'Validation rule activations, deactivations, or edits',              color:'#fbbf24'},
        {id:'wbiBatch',     label:'⏱ Scheduled Job Changes', desc:'CronTrigger creates, deletes, or state changes',                    color:'#a78bfa'},
        {id:'wbiSecurity',  label:'🔒 Security Changes',     desc:'Password policies, trusted IPs, session settings, login changes',   color:'#f87171'}
      ].map(p=>`<div style="border:1px solid var(--line);border-left:3px solid ${p.color};border-radius:10px;padding:12px;background:var(--panel2)">
        <b style="font-size:13px;color:${p.color}">${p.label}</b>
        <p class="muted" style="font-size:11px;margin:4px 0 8px">${p.desc}</p>
        <div style="display:flex;gap:6px">
          <button id="${p.id}Btn" style="font-size:11px;padding:5px 10px">Run</button>
          <select id="${p.id}Days" style="font-size:11px;padding:4px;max-width:110px">
            <option value="1">Last 24h</option>
            <option value="2" selected>Last 48h</option>
            <option value="7">Last 7 days</option>
          </select>
        </div>
      </div>`).join('')}
    </div>

    <div style="margin-top:4px">
      <div class="toolbar">
        <button id="wbiRunAll">Run All Checks</button>
        <button class="secondary" id="wbiExport">Export CSV</button>
        <input id="wbiSearch" placeholder="Search results…" style="max-width:220px">
      </div>
    </div>
    <div id="wbiSummary" style="margin-top:10px"></div>
    <div id="wbiResult"></div>
  </section>`;

  let wbiAll=[];

  const FILTERS = {
    wbiFlows:      (days)=>`CreatedDate >= LAST_N_DAYS:${days} AND (Action LIKE '%Flow%' OR Action LIKE '%flow%' OR Section LIKE '%Flow%')`,
    wbiApex:       (days)=>`CreatedDate >= LAST_N_DAYS:${days} AND (Section LIKE '%Apex%' OR Section LIKE '%apex%' OR Action LIKE '%class%' OR Action LIKE '%trigger%')`,
    wbiProfiles:   (days)=>`CreatedDate >= LAST_N_DAYS:${days} AND (Section LIKE '%Profile%' OR Section LIKE '%PermissionSet%' OR Action LIKE '%Permission%')`,
    wbiValidation: (days)=>`CreatedDate >= LAST_N_DAYS:${days} AND (Section LIKE '%Validation%' OR Action LIKE '%Validation%')`,
    wbiBatch:      (days)=>`CreatedDate >= LAST_N_DAYS:${days} AND (Section LIKE '%Cron%' OR Action LIKE '%Schedule%' OR Action LIKE '%schedule%')`,
    wbiSecurity:   (days)=>`CreatedDate >= LAST_N_DAYS:${days} AND (Section LIKE '%Password%' OR Section LIKE '%Session%' OR Section LIKE '%Login%' OR Section LIKE '%Ip%' OR Action LIKE '%security%')`
  };

  const LABELS = {
    wbiFlows:'Flow Changes', wbiApex:'Apex Changes', wbiProfiles:'Profile/Perm Changes',
    wbiValidation:'Validation Rules', wbiBatch:'Scheduled Jobs', wbiSecurity:'Security Changes'
  };

  async function runFilter(id) {
    const days=parseInt(document.getElementById(`${id}Days`)?.value)||2;
    const where=FILTERS[id](days);
    const r=await requireApi().queryAll(
      `SELECT Id, Action, Section, Display, DelegateUser, CreatedDate, CreatedBy.Username, CreatedBy.Name FROM SetupAuditTrail WHERE ${where} ORDER BY CreatedDate DESC`,
      {maxRecords:500}
    );
    return (r.records||[]).map(c=>({...c, _category:LABELS[id]}));
  }

  function renderWbiResults(records) {
    const search=($('#wbiSearch')?.value||'').toLowerCase();
    let rows=records;
    if(search) rows=rows.filter(r=>`${r.Action} ${r.Display} ${r.Section} ${r.CreatedBy?.Username}`.toLowerCase().includes(search));
    if(!rows.length){ $('#wbiResult').innerHTML='<p class="muted">No matching audit entries found for the selected filters.</p>'; return; }
    const thStyle='style="color:var(--purple2);padding:8px;text-align:left;border-bottom:1px solid var(--line);white-space:nowrap"';
    const tdStyle='style="padding:7px 8px;border-bottom:1px solid var(--line);font-size:12px;vertical-align:top"';
    const catColors={
      'Flow Changes':'#34d399','Apex Changes':'#60a5fa','Profile/Perm Changes':'#f472b6',
      'Validation Rules':'#fbbf24','Scheduled Jobs':'#a78bfa','Security Changes':'#f87171'
    };
    const body=rows.map(r=>{
      const col=catColors[r._category]||'var(--muted)';
      return `<tr>
        <td ${tdStyle}><span style="background:rgba(0,0,0,.3);color:${col};border:1px solid ${col};border-radius:12px;padding:2px 8px;font-size:11px;white-space:nowrap">${escapeHtml(r._category)}</span></td>
        <td ${tdStyle} style="white-space:nowrap">${escapeHtml(new Date(r.CreatedDate).toLocaleString())}</td>
        <td ${tdStyle}>${escapeHtml(r.CreatedBy?.Username||'—')}</td>
        <td ${tdStyle}>${escapeHtml(r.Section||'')}</td>
        <td ${tdStyle}>${escapeHtml((r.Display||r.Action||'').substring(0,200))}</td>
      </tr>`;
    }).join('');
    $('#wbiResult').innerHTML=`<table class="table" style="width:100%"><thead><tr>
      <th ${thStyle}>Category</th><th ${thStyle}>When</th><th ${thStyle}>User</th><th ${thStyle}>Section</th><th ${thStyle}>Action/Detail</th>
    </tr></thead><tbody>${body}</tbody></table>`;
  }

  // Individual filter buttons
  Object.keys(FILTERS).forEach(id=>{
    document.getElementById(`${id}Btn`).onclick=async()=>{
      const btn=document.getElementById(`${id}Btn`);
      btn.disabled=true; btn.textContent='Loading…';
      try {
        const results=await runFilter(id);
        // Merge into wbiAll (replace category)
        wbiAll=wbiAll.filter(r=>r._category!==LABELS[id]);
        wbiAll=[...results,...wbiAll].sort((a,b)=>new Date(b.CreatedDate)-new Date(a.CreatedDate));
        const catCount=results.length;
        $('#wbiSummary').innerHTML=`<p style="font-size:12px;color:var(--muted)">${catCount} ${LABELS[id]} entries found. Total loaded: ${wbiAll.length} entries.</p>`;
        renderWbiResults(wbiAll);
        toast(`${LABELS[id]}: ${catCount} audit entries.`);
      } catch(e){ toast(e.message,5000,{copyText:e.message}); }
      finally{ btn.disabled=false; btn.textContent='Run'; }
    };
  });

  // Run all
  $('#wbiRunAll').onclick=async()=>{
    const btn=$('#wbiRunAll'); btn.disabled=true; btn.textContent='Running all checks…';
    $('#wbiResult').innerHTML='<p class="muted">Fetching all audit categories…</p>';
    wbiAll=[];
    try {
      const results=await Promise.allSettled(Object.keys(FILTERS).map(id=>runFilter(id)));
      results.forEach(r=>{ if(r.status==='fulfilled') wbiAll=[...wbiAll,...r.value]; });
      wbiAll.sort((a,b)=>new Date(b.CreatedDate)-new Date(a.CreatedDate));
      const cats={};
      wbiAll.forEach(r=>{ cats[r._category]=(cats[r._category]||0)+1; });
      $('#wbiSummary').innerHTML=`<div style="display:flex;gap:12px;flex-wrap:wrap;padding:8px 14px;background:var(--panel2);border-radius:8px;margin-bottom:10px">
        ${Object.entries(cats).map(([c,n])=>`<span style="font-size:12px"><b>${n}</b> <span class="muted">${c}</span></span>`).join('')}
      </div>`;
      renderWbiResults(wbiAll);
      toast(`All checks complete: ${wbiAll.length} audit entries loaded.`);
    } catch(e){ toast(e.message,5000,{copyText:e.message}); }
    finally{ btn.disabled=false; btn.textContent='Run All Checks'; }
  };

  let wbiSearchTimer;
  setTimeout(()=>{ $('#wbiSearch')?.addEventListener('input',()=>{ clearTimeout(wbiSearchTimer); wbiSearchTimer=setTimeout(()=>renderWbiResults(wbiAll),200); }); },100);

  $('#wbiExport').onclick=()=>{
    if(!wbiAll.length) return toast('Run a check first.');
    const rows=wbiAll.map(r=>({Category:r._category, Date:r.CreatedDate, User:r.CreatedBy?.Username, Section:r.Section, Action:r.Action, Detail:r.Display}));
    chrome.runtime.sendMessage({type:'DOWNLOAD_TEXT',filename:'sf-forge-who-broke-it.csv',mime:'text/csv',content:toCsv(rows)});
  };
}

// ── Field Usage Analyzer — v7 ─────────────────────────────────────────────────
async function fieldUsageAnalyzer() {
  view().innerHTML = `<section class="card">
    <h3>Field Usage Analyzer <span class="badge info">v7 — Flows · Apex · Rules · Reports</span></h3>
    <p class="muted">Before deleting or renaming a field, find every place it's referenced. Cross-checks Flows, Apex classes, Validation Rules, and Report data — all without leaving this panel.</p>
    <div class="toolbar">
      <input id="fuaObject" placeholder="Object API name (e.g. Opportunity)" style="max-width:200px">
      <input id="fuaField"  placeholder="Field API name (e.g. StageName)" style="max-width:200px">
      <button id="fuaRun">Analyze Field</button>
    </div>
    <div id="fuaSummary"></div>
    <div id="fuaTabs" style="display:flex;gap:8px;flex-wrap:wrap;margin:10px 0"></div>
    <div id="fuaResult"></div>
  </section>`;

  let fuaData={flows:[], apex:[], validationRules:[], fieldPerms:[], records:null};
  let fuaActiveTab='flows';

  $('#fuaRun').onclick=async()=>{
    const obj=$('#fuaObject').value.trim();
    const field=$('#fuaField').value.trim();
    if(!obj||!field) return toast('Enter both object and field API names.');
    const btn=$('#fuaRun'); btn.disabled=true; btn.textContent='Analyzing…';
    const res=$('#fuaResult'); res.innerHTML='<p class="muted">Scanning for field references…</p>';
    $('#fuaSummary').innerHTML=''; $('#fuaTabs').innerHTML='';
    fuaData={flows:[], apex:[], validationRules:[], fieldPerms:[], records:null};

    const fullField=field.includes('.')?field:`${obj}.${field}`;
    const fieldOnly=field.includes('.')?field.split('.').pop():field;

    try {
      // 1. Flows: search FlowElement metadata for field references (via Tooling)
      try {
        const flowMeta=await requireApi().toolingQueryAll(
          `SELECT Id, ApiName, Label, ProcessType, Status FROM FlowDefinitionView WHERE Status='Active' ORDER BY Label`,
          {maxRecords:500}
        );
        // For each flow, fetch its active version and check metadata for field reference
        const matchedFlows=[];
        for(const f of (flowMeta.records||[]).slice(0,100)){
          try{
            const verRes=await requireApi().toolingQuery(`SELECT Id, Metadata FROM Flow WHERE DefinitionId='${f.Id}' AND Status='Active' LIMIT 1`);
            const meta=verRes.records?.[0]?.Metadata;
            if(meta){
              const metaStr=typeof meta==='string'?meta:JSON.stringify(meta);
              if(metaStr.toLowerCase().includes(fieldOnly.toLowerCase())||metaStr.toLowerCase().includes(obj.toLowerCase())){
                matchedFlows.push({Name:f.Label, ApiName:f.ApiName, Status:f.Status, Type:f.ProcessType});
              }
            }
          }catch(_){}
        }
        fuaData.flows=matchedFlows;
      } catch(_){ fuaData.flows=[]; }

      // 2. Apex: search ApexClass body for field name string
      try {
        const apexRes=await requireApi().toolingQueryAll(
          `SELECT Id, Name, Body FROM ApexClass WHERE Status='Active' AND (Body LIKE '%${safeLike(fieldOnly)}%') ORDER BY Name`,
          {maxRecords:200}
        );
        fuaData.apex=(apexRes.records||[]).map(c=>{
          const body=c.Body||'';
          // Find line numbers
          const lines=body.split('\n');
          const lineRefs=lines.reduce((acc,line,i)=>{
            if(line.toLowerCase().includes(fieldOnly.toLowerCase())) acc.push(i+1);
            return acc;
          },[]).slice(0,5);
          return {Name:c.Name, Lines:lineRefs.join(', ')||'—', Matches:lineRefs.length};
        });
      } catch(_){ fuaData.apex=[]; }

      // 3. Validation Rules: check formula for field reference
      try {
        const vrRes=await requireApi().toolingQueryAll(
          `SELECT Id, ValidationName, Active, ErrorMessage, ErrorConditionFormula, EntityDefinition.QualifiedApiName FROM ValidationRule WHERE EntityDefinition.QualifiedApiName='${safeLike(obj)}' ORDER BY ValidationName`,
          {maxRecords:200}
        );
        fuaData.validationRules=(vrRes.records||[]).filter(v=>{
          const formula=(v.ErrorConditionFormula||'').toLowerCase();
          return formula.includes(fieldOnly.toLowerCase());
        }).map(v=>({Name:v.ValidationName, Active:v.Active?'✓ Active':'—', Object:v.EntityDefinition?.QualifiedApiName||obj, Formula:(v.ErrorConditionFormula||'').substring(0,120)}));
      } catch(_){ fuaData.validationRules=[]; }

      // 4. Field Permissions: which perm sets/profiles have this field visible
      try {
        const fpRes=await requireApi().toolingQueryAll(
          `SELECT ParentId, Parent.Label, Parent.IsOwnedByProfile, PermissionsRead, PermissionsEdit, SobjectType, Field FROM FieldPermissions WHERE SobjectType='${safeLike(obj)}' AND Field='${safeLike(fullField)}' ORDER BY Parent.Label`,
          {maxRecords:500}
        );
        fuaData.fieldPerms=(fpRes.records||[]).map(fp=>({
          'Profile/PermSet': fp.Parent?.Label||fp.ParentId,
          Type: fp.Parent?.IsOwnedByProfile?'Profile':'Permission Set',
          Read: fp.PermissionsRead?'✓':'—', Edit: fp.PermissionsEdit?'✓':'—'
        }));
      } catch(_){ fuaData.fieldPerms=[]; }

      // 5. Record count: how many non-null values exist
      try {
        const countRes=await requireApi().query(`SELECT COUNT(Id) total FROM ${obj} WHERE ${fieldOnly} != null LIMIT 1`);
        fuaData.records=countRes.records?.[0]?.total??countRes.totalSize??null;
      } catch(_){ fuaData.records=null; }

      // Summary
      const total=fuaData.flows.length+fuaData.apex.length+fuaData.validationRules.length+fuaData.fieldPerms.length;
      const recLabel=fuaData.records!==null?`${fuaData.records.toLocaleString()} non-null records`:'Record count unavailable';
      $('#fuaSummary').innerHTML=`<div style="display:flex;gap:16px;flex-wrap:wrap;padding:10px 14px;background:var(--panel2);border-radius:10px;margin-bottom:4px">
        <span style="font-size:13px"><b style="color:${fuaData.flows.length?'#fbbf24':'#4ade80'}">${fuaData.flows.length}</b> <span class="muted">Flows</span></span>
        <span style="font-size:13px"><b style="color:${fuaData.apex.length?'#fbbf24':'#4ade80'}">${fuaData.apex.length}</b> <span class="muted">Apex classes</span></span>
        <span style="font-size:13px"><b style="color:${fuaData.validationRules.length?'#fbbf24':'#4ade80'}">${fuaData.validationRules.length}</b> <span class="muted">Validation rules</span></span>
        <span style="font-size:13px"><b>${fuaData.fieldPerms.length}</b> <span class="muted">permission entries</span></span>
        <span style="font-size:13px;color:${fuaData.records>0?'#f87171':'#4ade80'}"><b>${recLabel}</b></span>
        ${total===0&&fuaData.records===0?'<span style="color:#4ade80;font-size:13px;font-weight:700">✓ Safe to delete (no references found, 0 values)</span>':''}
      </div>`;

      // Tab bar
      const tabs=[
        {id:'flows',          label:`Flows (${fuaData.flows.length})`},
        {id:'apex',           label:`Apex (${fuaData.apex.length})`},
        {id:'validationRules',label:`Validation Rules (${fuaData.validationRules.length})`},
        {id:'fieldPerms',     label:`Field Permissions (${fuaData.fieldPerms.length})`}
      ];
      $('#fuaTabs').innerHTML=tabs.map(t=>
        `<button class="secondary fua-tab ${t.id===fuaActiveTab?'active-tab':''}" data-fuatab="${t.id}" style="font-size:12px;padding:6px 12px">${t.label}</button>`
      ).join('');
      document.querySelectorAll('.fua-tab').forEach(b=>b.onclick=()=>{
        fuaActiveTab=b.dataset.fuatab;
        document.querySelectorAll('.fua-tab').forEach(x=>x.classList.remove('active-tab'));
        b.classList.add('active-tab');
        renderFuaTab();
      });
      renderFuaTab();
      toast(`Analysis complete: ${total} reference${total!==1?'s':''} found.`);
    } catch(e){ res.innerHTML=`<p class="error-note">${escapeHtml(e.message)}</p>`; toast(e.message,5000,{copyText:e.message}); }
    finally{ btn.disabled=false; btn.textContent='Analyze Field'; }
  };

  function renderFuaTab(){
    const res=$('#fuaResult');
    const data=fuaData[fuaActiveTab]||[];
    if(!data.length){ res.innerHTML='<p class="muted">No references found in this category.</p>'; return; }
    res.innerHTML=table(data);
  }
}

// ── Sandbox Refresh Tracker — v7 ─────────────────────────────────────────────
async function sandboxTracker() {
  view().innerHTML = `<section class="card">
    <h3>Sandbox Refresh Tracker <span class="badge info">v7 — SandboxInfo</span></h3>
    <p class="muted">View all sandbox instances, their type, last refresh date, and copy limit. Must be run from a Production org — sandbox orgs don't have SandboxInfo access.</p>
    <div class="toolbar">
      <button id="sbxLoad">Load Sandboxes</button>
      <button class="secondary" id="sbxExport">Export CSV</button>
      <input id="sbxSearch" placeholder="Search sandbox name…" style="max-width:220px">
    </div>
    <div id="sbxSummary" style="margin:10px 0"></div>
    <div id="sbxResult"></div>

    <div style="margin-top:18px;border-top:1px solid var(--line);padding-top:14px">
      <h4 style="font-size:13px;margin:0 0 6px">Sandbox Type Reference</h4>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font-size:12px">
        ${[
          {type:'Developer',      color:'#4ade80', desc:'200MB storage, one free per license'},
          {type:'Developer Pro',  color:'#60a5fa', desc:'1GB storage, ideal for teams'},
          {type:'Partial',        color:'#fbbf24', desc:'5GB, sample of prod data (5%)'},
          {type:'Full',           color:'#f87171', desc:'Full copy of prod, longest refresh cycle'}
        ].map(s=>`<div style="border:1px solid ${s.color};border-radius:8px;padding:8px;background:var(--panel2)">
          <b style="color:${s.color}">${s.type}</b>
          <p style="color:var(--muted);margin:3px 0 0;font-size:11px">${s.desc}</p>
        </div>`).join('')}
      </div>
    </div>
  </section>`;

  let sandboxes=[];

  const TYPE_COLORS={Developer:'#4ade80','Developer Pro':'#60a5fa',Partial:'#fbbf24',Full:'#f87171',Other:'#9ca3af'};

  function renderSbx(records) {
    const search=($('#sbxSearch')?.value||'').toLowerCase();
    let rows=records;
    if(search) rows=rows.filter(r=>(r.SandboxName||'').toLowerCase().includes(search)||(r.SandboxInfoId||'').includes(search));
    if(!rows.length){ $('#sbxResult').innerHTML='<p class="muted">No sandboxes match the search.</p>'; return; }

    const now=Date.now();
    const thStyle='style="color:var(--purple2);padding:8px;text-align:left;border-bottom:1px solid var(--line)"';
    const tdStyle='style="padding:7px 8px;border-bottom:1px solid var(--line);font-size:12px"';
    const body=rows.map(sbx=>{
      const typeColor=TYPE_COLORS[sbx.LicenseType]||TYPE_COLORS.Other;
      const daysSince=sbx.CreatedDate?Math.floor((now-new Date(sbx.CreatedDate).getTime())/86400000):null;
      const ageColor=daysSince===null?'var(--muted)':daysSince>180?'#f87171':daysSince>90?'#fbbf24':'#4ade80';
      const status=sbx.Status||'Unknown';
      const statusColor={Completed:'#4ade80',Pending:'#fbbf24',Processing:'#60a5fa',Deleting:'#f87171'}[status]||'var(--muted)';
      return `<tr>
        <td ${tdStyle}><b>${escapeHtml(sbx.SandboxName||sbx.SandboxInfoId||'—')}</b></td>
        <td ${tdStyle}><span style="color:${typeColor};border:1px solid ${typeColor};border-radius:10px;padding:2px 8px;font-size:11px">${escapeHtml(sbx.LicenseType||'—')}</span></td>
        <td ${tdStyle}><span style="color:${statusColor}">${escapeHtml(status)}</span></td>
        <td ${tdStyle} style="color:${ageColor}">${daysSince===null?'—':`${daysSince}d ago`}</td>
        <td ${tdStyle} style="color:var(--muted)">${sbx.CreatedDate?new Date(sbx.CreatedDate).toLocaleDateString():'—'}</td>
        <td ${tdStyle}>${escapeHtml(sbx.EndpointUrl||sbx.SandboxInfoId||'—')}</td>
        <td ${tdStyle}>${sbx.IsActive?'<span style="color:#4ade80">✓ Active</span>':'<span style="color:var(--muted)">—</span>'}</td>
      </tr>`;
    }).join('');

    $('#sbxResult').innerHTML=`<div style="overflow-x:auto"><table class="table" style="width:100%"><thead><tr>
      <th ${thStyle}>Name</th><th ${thStyle}>Type</th><th ${thStyle}>Status</th><th ${thStyle}>Last Refresh</th><th ${thStyle}>Refresh Date</th><th ${thStyle}>Endpoint / Id</th><th ${thStyle}>Active</th>
    </tr></thead><tbody>${body}</tbody></table></div>`;
  }

  $('#sbxLoad').onclick=async()=>{
    const btn=$('#sbxLoad'); btn.disabled=true; btn.textContent='Loading…';
    const res=$('#sbxResult'); res.innerHTML='<p class="muted">Querying SandboxProcess…</p>';
    try {
      // SandboxProcess is the standard object for sandbox history/status
      const r=await requireApi().queryAll(
        `SELECT Id, SandboxName, Status, LicenseType, IsActive, CreatedDate, EndpointUrl, SandboxInfoId FROM SandboxProcess ORDER BY CreatedDate DESC`,
        {maxRecords:200}
      );
      sandboxes=r.records||[];

      if(!sandboxes.length){
        res.innerHTML=`<div class="notice" style="border-left:3px solid #fbbf24">
          <b>No sandbox records found.</b><br>
          SandboxProcess records are only accessible from a <b>Production org</b>. If this is a sandbox, connect to the Production org and re-run.
          <br><br>You may also not have "Manage Sandboxes" permission.
        </div>`;
        return;
      }

      // Summary
      const types={};
      sandboxes.forEach(s=>{ types[s.LicenseType]=(types[s.LicenseType]||0)+1; });
      $('#sbxSummary').innerHTML=`<div style="display:flex;gap:14px;flex-wrap:wrap;padding:8px 14px;background:var(--panel2);border-radius:8px">
        <span style="font-size:13px"><b>${sandboxes.length}</b> <span class="muted">total sandboxes</span></span>
        ${Object.entries(types).map(([t,n])=>`<span style="font-size:13px;color:${TYPE_COLORS[t]||'var(--muted)'}">${n} ${t}</span>`).join('')}
      </div>`;

      renderSbx(sandboxes);
      toast(`${sandboxes.length} sandbox record${sandboxes.length!==1?'s':''} loaded.`);
    } catch(e){
      const isPerms=/INSUFFICIENT_ACCESS|INVALID_FIELD|SandboxProcess/i.test(e.message);
      res.innerHTML=`<div class="notice" style="border-left:3px solid #f87171">
        <b>${isPerms?'Sandbox access requires a Production org':'Query Error'}</b><br>
        ${escapeHtml(e.message)}<br><br>
        ${isPerms?'Connect to your Production org from the Connect Org screen, then re-run this view.':''}
      </div>`;
      toast(e.message,5000,{copyText:e.message});
    } finally{ btn.disabled=false; btn.textContent='Load Sandboxes'; }
  };

  let sbxSearchTimer;
  setTimeout(()=>{ $('#sbxSearch')?.addEventListener('input',()=>{ clearTimeout(sbxSearchTimer); sbxSearchTimer=setTimeout(()=>renderSbx(sandboxes),200); }); },100);

  $('#sbxExport').onclick=()=>{
    if(!sandboxes.length) return toast('Load sandboxes first.');
    chrome.runtime.sendMessage({type:'DOWNLOAD_TEXT',filename:'sf-forge-sandboxes.csv',mime:'text/csv',content:toCsv(sandboxes)});
  };
}

// ── Table renderer ─────────────────────────────────────────────────────────────
function table(records = [], action) {
  if (!records.length) return '<p class="muted">No rows yet.</p>';
  const cols = [...new Set(records.flatMap(r => Object.keys(r).filter(k => k !== 'attributes' && !k.startsWith('_'))))].slice(0, 8);
  const trunc = v => { const s = String(v ?? ''); return s.length > 60 ? s.substring(0, 57) + '…' : s; };
  return `<div style="overflow-x:auto;width:100%"><table class="table" style="table-layout:fixed;width:100%;word-break:break-word">
    <thead><tr>${cols.map(c=>`<th style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c)}</th>`).join('')}${action?'<th style="width:120px">Action</th>':''}</tr></thead>
    <tbody>${records.map(r =>
      `<tr>${cols.map(c=>`<td title="${escapeHtml(typeof r[c]==='object'?JSON.stringify(r[c]):String(r[c]??''))}" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(typeof r[c]==='object'?JSON.stringify(r[c]):trunc(r[c]))}</td>`).join('')}${action?`<td>${action(r.Id)}</td>`:''}</tr>`
    ).join('')}</tbody>
  </table></div>`;
}

// ── Boot ───────────────────────────────────────────────────────────────────────

// ── Update banner ──────────────────────────────────────────────────────────────
async function initUpdateBanner() {
  const banner   = document.getElementById('updateBanner');
  const textEl   = document.getElementById('updateBannerText');
  const notesEl  = document.getElementById('updateBannerNotes');
  const dlBtn    = document.getElementById('updateDownloadBtn');
  const relBtn   = document.getElementById('updateReleaseBtn');
  const dismissBtn = document.getElementById('updateDismissBtn');
  const progressEl = document.getElementById('updateProgress');
  if (!banner) return;

  let currentState = null;

  async function refreshBanner() {
    const state = await getUpdateState();
    currentState = state;
    if (!state?.hasUpdate || state.dismissed) {
      banner.classList.remove('visible');
      return;
    }
    const installed = state.installedVersion || chrome.runtime.getManifest().version;
    textEl.innerHTML = `<b>SF Forge ${escapeHtml(state.latestVersion)} is available</b> &nbsp;<span style="color:var(--muted);font-size:11px">Installed: v${escapeHtml(installed)}</span>`;
    notesEl.textContent = state.releaseNotes ? state.releaseNotes.split('\n')[0] : '';
    banner.classList.add('visible');
  }

  dismissBtn.onclick = async () => {
    await dismissUpdate();
    banner.classList.remove('visible');
    toast('Update dismissed — you can check again from Theme Engine → Update Settings.');
  };

  relBtn.onclick = () => {
    if (currentState?.releaseUrl) chrome.tabs.create({ url: currentState.releaseUrl });
  };

  dlBtn.onclick = async () => {
    if (!currentState?.downloadUrl) return toast('No download URL found for this release.');
    dlBtn.disabled = true;
    progressEl.style.display = '';
    progressEl.textContent = 'Starting download…';
    try {
      await chrome.runtime.sendMessage({
        type: 'DOWNLOAD_URL',
        url:  currentState.downloadUrl,
        filename: `sf-forge-${currentState.latestVersion}.zip`
      });
      progressEl.textContent = 'Downloading — check your Downloads folder.';
      toast(`SF Forge ${currentState.latestVersion} downloading. Unzip to your extension folder, then reload at chrome://extensions.`, 8000);
      setTimeout(() => {
        progressEl.style.display = 'none';
        dlBtn.disabled = false;
      }, 5000);
    } catch (e) {
      progressEl.textContent = '';
      progressEl.style.display = 'none';
      dlBtn.disabled = false;
      toast('Download failed: ' + e.message, 5000);
    }
  };

  // Initial check on load
  await refreshBanner();

  // Also trigger a fresh check from the service worker and re-read after 3s
  chrome.runtime.sendMessage({ type: 'CHECK_FOR_UPDATES' }).then(async () => {
    setTimeout(refreshBanner, 3000);
  }).catch(() => {});
}

// ── Update settings panel (rendered inside Theme Engine view) ─────────────────
async function renderUpdateSettings(container) {
  const config = await getRepoConfig();
  const state  = await getUpdateState();
  const installed = chrome.runtime.getManifest().version;

  container.innerHTML = `
    <h4 style="margin:20px 0 8px;font-size:13px">Update Settings</h4>
    <p class="muted" style="font-size:12px">SF Forge checks your GitHub repo for new releases. Enter the repo details below to enable auto-checking.</p>
    <div class="grid" style="margin-top:10px">
      <div class="field span6">
        <label>GitHub Owner / Org</label>
        <input id="upOwner" value="${escapeHtml(config.owner)}" placeholder="e.g. JonMurphey or TrustedTechTeam">
      </div>
      <div class="field span6">
        <label>Repository Name</label>
        <input id="upRepo" value="${escapeHtml(config.repo)}" placeholder="e.g. sf-forge">
      </div>
    </div>
    <div class="toolbar">
      <button id="saveRepoBtn">Save & Check Now</button>
      <button class="secondary" id="checkNowBtn">Check Now</button>
    </div>
    <div id="updateStatusBox" style="margin-top:10px;font-size:13px">
      ${state ? `
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          <span>Installed: <b>v${escapeHtml(installed)}</b></span>
          ${state.latestVersion ? `<span>Latest: <b>v${escapeHtml(state.latestVersion)}</b></span>` : ''}
          ${state.hasUpdate
            ? `<span style="color:var(--purple2)">&#x2B06; Update available</span>`
            : `<span style="color:#4ade80">&#x2713; Up to date</span>`
          }
          <span style="color:var(--muted);font-size:11px">Last checked: ${timeAgo(state.checkedAt)}</span>
        </div>
        ${state.releaseNotes ? `<p style="color:var(--muted);font-size:11px;margin-top:4px;white-space:pre-wrap">${escapeHtml(state.releaseNotes.substring(0,300))}</p>` : ''}
      ` : `<p class="muted">Not configured — enter your GitHub repo details above to enable update checking.</p>`}
    </div>`;

  document.getElementById('saveRepoBtn').onclick = async () => {
    const owner = document.getElementById('upOwner').value.trim();
    const repo  = document.getElementById('upRepo').value.trim();
    if (!owner || !repo) return toast('Enter both owner and repo name.');
    await saveRepoConfig(owner, repo);
    toast('Repo saved — checking for updates…');
    document.getElementById('updateStatusBox').innerHTML = '<p class="muted">Checking…</p>';
    const result = await chrome.runtime.sendMessage({ type: 'CHECK_FOR_UPDATES' });
    await renderUpdateSettings(container);
    await initUpdateBanner();
    toast(result?.state?.hasUpdate ? `Update available: v${result.state.latestVersion}` : 'SF Forge is up to date.');
  };

  document.getElementById('checkNowBtn').onclick = async () => {
    const owner = document.getElementById('upOwner').value.trim();
    const repo  = document.getElementById('upRepo').value.trim();
    if (!owner || !repo) return toast('Save your GitHub repo details first.');
    document.getElementById('updateStatusBox').innerHTML = '<p class="muted">Checking…</p>';
    const result = await chrome.runtime.sendMessage({ type: 'CHECK_FOR_UPDATES' });
    await renderUpdateSettings(container);
    toast(result?.state?.hasUpdate ? `Update available: v${result.state.latestVersion}` : 'SF Forge is up to date.');
  };
}

document.addEventListener('DOMContentLoaded', async () => {
  await loadThemeSettings();
  setupKeyboardShortcuts();
  $('#connectBtn').onclick = () => { active = 'connect'; render(); };

  // Stamp version from manifest — single source of truth, always in sync
  const versionEl = $('#sfForgeVersion');
  if (versionEl) {
    const { version } = chrome.runtime.getManifest();
    versionEl.textContent = `v${version}`;
  }

  render();
  // Run update banner init after first render — non-blocking
  initUpdateBanner().catch(() => {});
});

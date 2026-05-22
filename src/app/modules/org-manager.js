/**
 * SF Forge Org Manager v1.2.1
 *
 * KEY FIX: enrichOrgSession now sends the tab's own page URL as the first
 * candidate for /services/data/. The session bridge rewrites any cross-origin
 * URL to same-origin, so we don't need to derive hostnames at all for the
 * health check — we just need a live tab with the bridge loaded.
 *
 * The derived .my.salesforce.com URL is still stored as instanceUrl for
 * constructing API paths, but the BRIDGE always runs on the tab's origin.
 */

export const SF_HOST_PATTERN = /salesforce\.com|force\.com|visualforce\.com|site\.com|cloudforce\.com/i;
export const DEFAULT_API_VERSION = 'v66.0';

// ── URL helpers ──────────────────────────────────────────────────────────────
export function safeUrl(value) {
  try { return value && typeof value === 'string' ? new URL(value) : null; }
  catch { return null; }
}

export function isSalesforceUrl(url = '') {
  const u = safeUrl(url);
  return !!u && SF_HOST_PATTERN.test(u.hostname);
}

export function normalizeOrgUrl(urlOrHost) {
  const u = safeUrl(urlOrHost) || safeUrl(`https://${String(urlOrHost || '').replace(/^https?:\/\//, '')}`);
  return u ? `${u.protocol}//${u.hostname}` : '';
}

export function orgTypeFromHost(hostname = '') {
  const h = hostname.toLowerCase();
  // Sandbox detection must come before Production — sandbox hostnames contain '--'
  // e.g. myorg--fullsb.sandbox.my.salesforce.com  or  myorg--fullsb.lightning.force.com
  if (h.includes('scratch') || h.includes('.develop.'))                      return 'Scratch Org';
  if (h.includes('sandbox') || h.includes('--') || h.includes('.test.'))    return 'Sandbox';
  if (h.includes('site.com') || (h.endsWith('.force.com') && !h.includes('lightning'))) return 'Experience/Force';
  if (h.includes('lightning.force.com'))                                      return 'Production';
  if (h.includes('my.salesforce.com'))                                        return 'Production';
  return 'Salesforce';
}

export function colorClassForOrg(org) {
  const key = `${org.alias || ''} ${org.hostname || ''} ${org.type || ''}`.toLowerCase();
  if (key.includes('prod'))                                                               return 'red';
  if (key.includes('sand') || key.includes('uat') || key.includes('qa') || key.includes('--')) return 'amber';
  if (key.includes('dev') || key.includes('scratch'))                                    return 'blue';
  return 'purple';
}

/**
 * Given a Lightning/VF/Force hostname, return the canonical .my.salesforce.com
 * API base URL (used for storing instanceUrl and constructing API paths).
 *
 * Key SSO/sandbox cases:
 *   myorg.lightning.force.com              → myorg.my.salesforce.com
 *   myorg--fullsb.lightning.force.com      → myorg--fullsb.sandbox.my.salesforce.com
 *   myorg--fullsb.sandbox.my.salesforce.com → unchanged (already canonical)
 *   myorg.my.salesforce.com                → unchanged
 */
export function canonicalApiBase(hostname = '') {
  const h = hostname.toLowerCase();

  // Already canonical sandbox API base
  if (h.endsWith('.sandbox.my.salesforce.com')) return `https://${hostname}`;

  // Already canonical production API base
  if (h.endsWith('.my.salesforce.com') && !h.includes('--')) return `https://${hostname}`;

  // Lightning sandbox: myorg--sbname.lightning.force.com → myorg--sbname.sandbox.my.salesforce.com
  if (h.endsWith('.lightning.force.com') && h.includes('--')) {
    const sub = hostname.replace(/\.lightning\.force\.com$/i, '');
    return `https://${sub}.sandbox.my.salesforce.com`;
  }

  // Lightning production: myorg.lightning.force.com → myorg.my.salesforce.com
  if (h.endsWith('.lightning.force.com')) {
    return `https://${hostname.replace(/\.lightning\.force\.com$/i, '.my.salesforce.com')}`;
  }

  // Visualforce sandbox: myorg--sbname.visual.force.com → myorg--sbname.sandbox.my.salesforce.com
  if (h.endsWith('.visualforce.com') && h.includes('--')) {
    const sub = hostname.replace(/\.visualforce\.com$/i, '');
    return `https://${sub}.sandbox.my.salesforce.com`;
  }

  // Visualforce production
  if (h.endsWith('.visualforce.com')) {
    return `https://${hostname.replace(/\.visualforce\.com$/i, '.my.salesforce.com')}`;
  }

  // Force.com sandbox: myorg--sbname.force.com → myorg--sbname.sandbox.my.salesforce.com
  if (h.endsWith('.force.com') && !h.includes('lightning') && h.includes('--')) {
    const sub = hostname.replace(/\.force\.com$/i, '');
    return `https://${sub}.sandbox.my.salesforce.com`;
  }

  // Force.com production
  if (h.endsWith('.force.com') && !h.includes('lightning')) {
    return `https://${hostname.replace(/\.force\.com$/i, '.my.salesforce.com')}`;
  }

  // Already on .my.salesforce.com with sandbox prefix (e.g. myorg--sb.my.salesforce.com)
  if (h.endsWith('.my.salesforce.com') && h.includes('--')) {
    const sub = hostname.replace(/\.my\.salesforce\.com$/i, '');
    return `https://${sub}.sandbox.my.salesforce.com`;
  }

  return `https://${hostname}`;
}

// Legacy — kept for backward compat in salesforce-api.js
export function deriveApiHosts(hostname = '') {
  const base = canonicalApiBase(hostname);
  const set = new Set([hostname]);
  try { set.add(new URL(base).hostname); } catch {}
  return [...set].filter(Boolean);
}
export function apiUrlCandidatesForHost(hostname = '') {
  return deriveApiHosts(hostname).map(h => `https://${h}`);
}

// ── Session bridge fetch ─────────────────────────────────────────────────────
// Routes through the content script on `tabId`. The bridge rewrites any
// cross-origin SF URL to the tab's own origin automatically.
export async function bridgeFetch(tabId, url, options = {}) {
  let result;
  try {
    result = await chrome.runtime.sendMessage({
      type: 'SF_API_REQUEST',
      tabId,
      url,
      method: options.method || 'GET',
      body:   options.body   || null,
      headers: options.headers || {}
    });
  } catch (e) {
    throw new Error(`Extension messaging error: ${e.message}. Try refreshing the Salesforce tab.`);
  }

  if (!result) {
    throw new Error(
      'No response from session bridge. Refresh the Salesforce tab so the bridge script reloads, then click Detect Orgs.'
    );
  }
  if (!result.ok) {
    const label = result.errorLabel || (result.status ? `HTTP ${result.status}` : 'No response from bridge — refresh the Salesforce tab');
    const bodyDetail = result.body
      ? (typeof result.body === 'string' ? result.body : JSON.stringify(result.body))
      : '';
    throw new Error(label + (bodyDetail ? ': ' + bodyDetail : ''));
  }
  return result.body;
}

// ── Tab discovery ────────────────────────────────────────────────────────────
export async function findSalesforceTabs() {
  const tabs = await chrome.tabs.query({});
  return tabs
    .filter(t => t.url && isSalesforceUrl(t.url))
    .map(tab => {
      const url = safeUrl(tab.url);
      const hostname = url.hostname;
      const pageOrigin = `${url.protocol}//${hostname}`;
      const apiBase = canonicalApiBase(hostname);
      return {
        tabId: tab.id,
        windowId: tab.windowId,
        active: tab.active,
        title: tab.title || hostname,
        url: tab.url,
        hostname,
        pageUrl: pageOrigin,
        // instanceUrl = canonical .my.salesforce.com base for API path construction
        instanceUrl: apiBase,
        // pageOrigin = actual tab origin — bridge always fetches here
        pageOrigin,
        type: orgTypeFromHost(hostname),
        lastSeen: Date.now()
      };
    });
}

// ── Session enrichment ────────────────────────────────────────────────────────
// Uses the tab's own origin (via bridge rewrite) — no cross-origin fetch.
// SSO/MFA note: after SSO redirect, the tab's pageOrigin is always the final
// Salesforce domain (the IdP redirect completes before document_idle fires).
// We try pageOrigin first, then apiBase, then the tab's href origin as a last resort.
export async function enrichOrgSession(org) {
  const tabId = org.tabId;
  if (!tabId) throw new Error('No tabId for org. Refresh the org tab.');

  const pageOrigin = org.pageOrigin || org.pageUrl || `https://${org.hostname}`;
  const apiBase    = org.instanceUrl || canonicalApiBase(org.hostname);

  // Build a de-duplicated list of origins to try, most-specific first
  const candidates = [...new Set([pageOrigin, apiBase].filter(Boolean))];

  let apiAvailable = false;
  let workingOrigin = null;
  let lastError = null;

  for (const origin of candidates) {
    try {
      await bridgeFetch(tabId, `${origin}/services/data/`);
      apiAvailable  = true;
      workingOrigin = origin;
      lastError     = null;
      break;
    } catch (e) {
      lastError = e.message;
    }
  }

  // Identity
  let identity = null;
  if (apiAvailable && workingOrigin) {
    try {
      identity = await bridgeFetch(tabId, `${workingOrigin}/services/oauth2/userinfo`);
    } catch (e) {
      lastError = e.message;
    }
  }

  // Limits (non-fatal)
  let limits = null;
  if (apiAvailable && workingOrigin) {
    try {
      limits = await bridgeFetch(tabId, `${workingOrigin}/services/data/${DEFAULT_API_VERSION}/limits`);
    } catch (_) {}
  }

  return {
    ...org,
    instanceUrl: apiBase,
    pageOrigin: workingOrigin || pageOrigin,
    orgId:       identity?.organization_id || null,
    userId:      identity?.user_id         || null,
    username:    identity?.preferred_username || identity?.email || null,
    displayName: identity?.name            || null,
    apiAvailable,
    status:       apiAvailable ? 'active' : 'expired',
    availability: apiAvailable ? 'available' : 'unavailable',
    lastError,
    limits,
    healthCheckedAt: Date.now()
  };
}

// ── Session health recheck ────────────────────────────────────────────────────
export async function recheckSessionHealth(org) {
  const tabId      = org.tabId;
  const pageOrigin = org.pageOrigin || org.pageUrl || `https://${org.hostname}`;
  const apiBase    = org.instanceUrl || canonicalApiBase(org.hostname);

  if (!tabId) return { sidPresent: false, apiOk: false, identityOk: false, error: 'No tabId' };

  // sid cookie check — try both the tab origin and the canonical base
  let sidPresent = false;
  for (const origin of [pageOrigin, apiBase]) {
    try {
      const c = await chrome.cookies.get({ url: origin + '/', name: 'sid' });
      if (c?.value) { sidPresent = true; break; }
    } catch (_) {}
  }

  // /services/data/ — try both origins
  let apiOk = false, apiError = null, workingOrigin = null;
  for (const origin of [...new Set([pageOrigin, apiBase])]) {
    try {
      await bridgeFetch(tabId, `${origin}/services/data/`);
      apiOk = true; workingOrigin = origin; break;
    } catch (e) { apiError = e.message; }
  }

  // /services/oauth2/userinfo
  let identityOk = false, identityError = null, identity = null;
  if (apiOk && workingOrigin) {
    try {
      identity = await bridgeFetch(tabId, `${workingOrigin}/services/oauth2/userinfo`);
      identityOk = true;
    } catch (e) { identityError = e.message; }
  }

  return { sidPresent, apiOk, apiError, identityOk, identityError, identity, checkedAt: Date.now() };
}

// ── Org key: stable on orgId+userId ──────────────────────────────────────────
export function orgKey(org) {
  if (org.orgId && org.userId) return `${org.orgId}::${org.userId}`;
  if (org.orgId)               return org.orgId;
  return org.instanceUrl || org.pageOrigin || org.pageUrl || org.hostname || `tab-${org.tabId}`;
}

// ── Profile persistence — SID never stored ───────────────────────────────────
export async function readProfiles() {
  const store = await chrome.storage.local.get('sfForgeProfiles');
  return store.sfForgeProfiles || {
    favorites: {}, aliases: {}, colorTags: {}, recent: [], activeOrgKey: null
  };
}

export async function saveProfiles(profiles) {
  for (const r of (profiles.recent || [])) delete r.sid;
  await chrome.storage.local.set({ sfForgeProfiles: profiles });
  return profiles;
}

export async function mergeOrgIntoProfiles(org) {
  const profiles = await readProfiles();
  const key = orgKey(org);
  const recentItem = {
    key,
    hostname:    org.hostname    || '',
    instanceUrl: org.instanceUrl || org.pageOrigin || '',
    pageOrigin:  org.pageOrigin  || '',
    orgId:       org.orgId  || null,
    userId:      org.userId || null,
    username:    org.username || null,
    type:        org.type || 'Salesforce',
    lastSeen:    Date.now(),
    title:       org.title || org.hostname || 'Salesforce Org',
    tabId:       org.tabId
    // SID intentionally excluded
  };
  profiles.recent = [recentItem, ...(profiles.recent || []).filter(r => r.key !== key)].slice(0, 20);
  profiles.activeOrgKey = key;
  await saveProfiles(profiles);
  return profiles;
}

export async function updateOrgProfile(key, changes) {
  const profiles = await readProfiles();
  profiles.favorites ||= {}; profiles.aliases ||= {}; profiles.colorTags ||= {};
  if ('favorite'  in changes) profiles.favorites[key] = !!changes.favorite;
  if ('alias'     in changes) profiles.aliases[key]   = changes.alias || '';
  if ('colorTag'  in changes) profiles.colorTags[key] = changes.colorTag || '';
  await saveProfiles(profiles);
  return profiles;
}



// ── Credential / OAuth-like org profiles ─────────────────────────────────────
// SF Forge supports two connection modes:
// 1) Browser Session Bridge: uses an already-open Salesforce tab.
// 2) Stored Org Login: user explicitly saves an org profile and optional credentials.
//
// Security note: Chrome extensions do not have a true OS password vault API. Saved
// passwords are stored only when the user checks "Remember credentials". Session
// IDs are saved for quick reconnect but may expire per Salesforce session policy.
export const CREDENTIAL_STORE_KEY = 'sfForgeCredentialProfiles';

export function loginEndpointFor(type = 'production') {
  return String(type).toLowerCase().startsWith('sand')
    ? 'https://test.salesforce.com'
    : 'https://login.salesforce.com';
}

function xmlEscape(value = '') {
  return String(value).replace(/[<>&'\"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','\"':'&quot;'}[c]));
}

function textOf(doc, tag) {
  return doc.getElementsByTagName(tag)[0]?.textContent || '';
}

export function maskSecret(value = '') {
  const v = String(value || '');
  if (!v) return '';
  return v.length <= 8 ? '••••••••' : `${v.slice(0, 4)}••••••${v.slice(-4)}`;
}

export async function salesforceSoapLogin({ username, password, securityToken = '', loginType = 'production' }) {
  const loginBase = loginEndpointFor(loginType);
  const SOAP_LOGIN_VERSION = '59.0'; // SOAP Partner login only available up to v59.0; REST/Tooling stays on v66.0
  const endpoint = `${loginBase}/services/Soap/u/${SOAP_LOGIN_VERSION}`;
  const combinedPassword = `${password || ''}${securityToken || ''}`;
  const envelope = `<?xml version="1.0" encoding="utf-8" ?>
<env:Envelope xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:env="http://schemas.xmlsoap.org/soap/envelope/">
  <env:Body>
    <n1:login xmlns:n1="urn:partner.soap.sforce.com">
      <n1:username>${xmlEscape(username)}</n1:username>
      <n1:password>${xmlEscape(combinedPassword)}</n1:password>
    </n1:login>
  </env:Body>
</env:Envelope>`;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'text/xml; charset=UTF-8', 'SOAPAction': 'login' },
    body: envelope
  });
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const fault = textOf(doc, 'faultstring') || textOf(doc, 'sf:exceptionMessage');
  if (!res.ok || fault) {
    throw new Error(fault || `Salesforce login failed with HTTP ${res.status}`);
  }
  const sessionId = textOf(doc, 'sessionId');
  const serverUrl = textOf(doc, 'serverUrl');
  if (!sessionId || !serverUrl) throw new Error('Salesforce login succeeded but did not return a session. Check org login policy/MFA/security token.');

  const server = safeUrl(serverUrl);
  const instanceUrl = server ? `${server.protocol}//${server.hostname}` : '';
  const profile = {
    key: `${textOf(doc, 'organizationId') || instanceUrl}::${textOf(doc, 'userId') || username}`,
    connectionMode: 'stored-login',
    loginType,
    loginHost: loginBase,
    username: textOf(doc, 'userName') || username,
    displayName: textOf(doc, 'userFullName') || textOf(doc, 'userName') || username,
    userId: textOf(doc, 'userId') || null,
    orgId: textOf(doc, 'organizationId') || null,
    orgName: textOf(doc, 'organizationName') || '',
    instanceUrl,
    pageOrigin: instanceUrl,
    hostname: instanceUrl ? new URL(instanceUrl).hostname : '',
    type: String(loginType).toLowerCase().startsWith('sand') ? 'Sandbox' : 'Production',
    sessionId,
    sessionMasked: maskSecret(sessionId),
    apiAvailable: true,
    status: 'active',
    availability: 'available',
    healthCheckedAt: Date.now(),
    lastSeen: Date.now()
  };
  return profile;
}

export async function readCredentialProfiles() {
  const store = await chrome.storage.local.get(CREDENTIAL_STORE_KEY);
  return store[CREDENTIAL_STORE_KEY] || { orgs: [], activeKey: null };
}

export async function saveCredentialProfiles(data) {
  await chrome.storage.local.set({ [CREDENTIAL_STORE_KEY]: data || { orgs: [], activeKey: null } });
  return data;
}

export async function saveStoredLoginProfile(profile, { alias = '', colorTag = '', rememberCredentials = false, password = '', securityToken = '' } = {}) {
  const data = await readCredentialProfiles();
  const key = profile.key || orgKey(profile);
  const item = {
    ...profile,
    key,
    alias,
    colorTag: colorTag || colorClassForOrg({ ...profile, alias }),
    favorite: true,
    lastSeen: Date.now(),
    // session is intentionally stored because the user asked for vault-style reconnect.
    // It remains local to chrome.storage.local and is never sent anywhere except Salesforce APIs.
    sessionId: profile.sessionId,
    sessionMasked: maskSecret(profile.sessionId),
    savedCredentials: !!rememberCredentials,
    password: rememberCredentials ? password : '',
    securityToken: rememberCredentials ? securityToken : ''
  };
  data.orgs = [item, ...(data.orgs || []).filter(o => o.key !== key)].slice(0, 25);
  data.activeKey = key;
  await saveCredentialProfiles(data);

  const profiles = await readProfiles();
  profiles.aliases ||= {}; profiles.colorTags ||= {}; profiles.favorites ||= {};
  profiles.aliases[key] = alias || profile.orgName || profile.username || profile.hostname || '';
  profiles.colorTags[key] = item.colorTag;
  profiles.favorites[key] = true;
  profiles.activeOrgKey = key;
  profiles.recent = [
    { key, hostname: item.hostname, instanceUrl: item.instanceUrl, pageOrigin: item.instanceUrl, orgId: item.orgId, userId: item.userId, username: item.username, type: item.type, lastSeen: Date.now(), title: alias || item.orgName || item.hostname, connectionMode: 'stored-login' },
    ...(profiles.recent || []).filter(r => r.key !== key)
  ].slice(0, 20);
  await saveProfiles(profiles);
  return item;
}

export async function refreshStoredLoginProfile(profile) {
  if (!profile?.savedCredentials || !profile.password) {
    if (profile?.sessionId) return profile;
    throw new Error('This org has no saved password. Open Connect Org and sign in again.');
  }
  const fresh = await salesforceSoapLogin({ username: profile.username, password: profile.password, securityToken: profile.securityToken || '', loginType: profile.loginType || profile.type || 'production' });
  return saveStoredLoginProfile(fresh, { alias: profile.alias || '', colorTag: profile.colorTag || '', rememberCredentials: true, password: profile.password, securityToken: profile.securityToken || '' });
}

export async function getStoredOrgByKey(key) {
  const data = await readCredentialProfiles();
  return (data.orgs || []).find(o => o.key === key) || null;
}

export async function directSalesforceFetch(org, pathOrUrl, options = {}) {
  if (!org?.sessionId) throw new Error('No stored Salesforce session. Connect to Org first.');
  const base = org.instanceUrl || org.pageOrigin;
  const url = String(pathOrUrl).startsWith('http') ? pathOrUrl : `${base}${pathOrUrl}`;
  const headers = { 'Accept': 'application/json', 'Content-Type': 'application/json', ...(options.headers || {}), 'Authorization': `Bearer ${org.sessionId}` };
  const init = { ...options, headers };
  if (init.body && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
  const res = await fetch(url, init);
  const text = await res.text();
  let body; try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    const detail = Array.isArray(body) ? body.map(e => `${e.errorCode || res.status}: ${e.message || ''}`).join('; ') : (body?.message || body?.error_description || text || `HTTP ${res.status}`);
    throw new Error(detail);
  }
  return body;
}

export async function recheckStoredSessionHealth(org) {
  const result = { sidPresent: !!org?.sessionId, apiOk: false, identityOk: false, identity: null, checkedAt: Date.now() };
  // SSO sessions have no sessionId — they must use the tab bridge
  if (org?.ssoSession && org?.tabId) {
    try { await bridgeFetch(org.tabId, `${org.pageOrigin}/services/data/`); result.apiOk = true; } catch (e) { result.apiError = e.message; }
    if (result.apiOk) {
      try { result.identity = await bridgeFetch(org.tabId, `${org.pageOrigin}/services/oauth2/userinfo`); result.identityOk = true; } catch (e) { result.identityError = e.message; }
    }
  } else {
    try { await directSalesforceFetch(org, '/services/data/'); result.apiOk = true; } catch (e) { result.apiError = e.message; }
    if (result.apiOk) {
      try { result.identity = await directSalesforceFetch(org, '/services/oauth2/userinfo'); result.identityOk = true; } catch (e) { result.identityError = e.message; }
    }
  }
  return result;
}

// ── Main detect + enrich ─────────────────────────────────────────────────────
export async function detectAndEnrichOrgs() {
  const profiles = await readProfiles();
  const tabs = await findSalesforceTabs();
  const enriched = [];

  for (const org of tabs) {
    try {
      const session = await enrichOrgSession(org);
      const key = orgKey(session);
      enriched.push({
        ...session,
        key,
        alias:    profiles.aliases?.[key]   || '',
        colorTag: profiles.colorTags?.[key] || colorClassForOrg(session),
        favorite: !!profiles.favorites?.[key]
      });
    } catch (error) {
      const key = orgKey(org);
      enriched.push({
        ...org,
        key,
        status: 'expired',
        apiAvailable: false,
        availability: 'unavailable',
        error: error.message,
        alias:    profiles.aliases?.[key]   || '',
        colorTag: profiles.colorTags?.[key] || colorClassForOrg(org),
        favorite: !!profiles.favorites?.[key]
      });
    }
  }
  return enriched;
}

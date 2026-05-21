/**
 * SF Forge Salesforce API v3.0.0
 *
 * Enhancements:
 * - queryAll(): follows nextRecordsUrl automatically, returns all records
 * - toolingQueryAll(): same for Tooling API
 * - fetchTimeout(): all direct fetches (SOAP/stored-session) have a 30s timeout
 * - apiVersion bumped to v66.0 (Salesforce Spring '25)
 * - Removed duplicate export of detectAndEnrichOrgs (now re-exported cleanly)
 */
import {
  DEFAULT_API_VERSION,
  detectAndEnrichOrgs,
  findSalesforceTabs,
  mergeOrgIntoProfiles,
  normalizeOrgUrl,
  orgKey,
  safeUrl,
  bridgeFetch,
  directSalesforceFetch,
  getStoredOrgByKey,
  readCredentialProfiles,
  refreshStoredLoginProfile
} from './org-manager.js';

export { DEFAULT_API_VERSION, findSalesforceTabs, detectAndEnrichOrgs };

// ── Active tab helper ─────────────────────────────────────────────────────────
export async function getActiveSalesforceTab() {
  const tabs = await findSalesforceTabs();
  if (!tabs.length) throw new Error('No Salesforce org tabs found. Open a Salesforce org, then try again.');
  const [focused] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs.find(t => t.tabId === focused?.id) || tabs.find(t => t.active) || tabs[0];
}

// ── SalesforceApi class ───────────────────────────────────────────────────────
export class SalesforceApi {
  constructor({ orgUrl, apiVersion = DEFAULT_API_VERSION, org = null }) {
    this.orgUrl     = orgUrl;
    this.apiVersion = apiVersion;
    this.org        = org;
  }

  static async fromActiveTab() {
    const tab = await getActiveSalesforceTab();
    const orgUrl = tab.instanceUrl || normalizeOrgUrl(tab.url);
    const api = new SalesforceApi({ orgUrl, org: tab });
    await mergeOrgIntoProfiles({ ...tab, instanceUrl: orgUrl });
    return api;
  }

  static async fromOrg(org) {
    if (!org) throw new Error('No Salesforce org selected.');
    const orgUrl = org.instanceUrl || normalizeOrgUrl(org.url || org.hostname);
    if (!orgUrl) throw new Error('Could not resolve org URL. Refresh the Salesforce tab and run Detect Orgs again.');
    const api = new SalesforceApi({ orgUrl, org: { ...org, instanceUrl: orgUrl } });
    await mergeOrgIntoProfiles({ ...org, instanceUrl: orgUrl });
    return api;
  }

  static async fromStoredProfile(profileOrKey) {
    let profile = typeof profileOrKey === 'string' ? await getStoredOrgByKey(profileOrKey) : profileOrKey;
    if (!profile) throw new Error('Stored org profile was not found.');
    if (!profile.sessionId && profile.savedCredentials) profile = await refreshStoredLoginProfile(profile);
    if (!profile.sessionId) throw new Error('Stored org session is missing. Sign in again from Connect Org.');
    const orgUrl = profile.instanceUrl || normalizeOrgUrl(profile.hostname);
    const api = new SalesforceApi({ orgUrl, org: { ...profile, instanceUrl: orgUrl, connectionMode: 'stored-login' } });
    await mergeOrgIntoProfiles({ ...profile, instanceUrl: orgUrl });
    return api;
  }

  static async fromLastStoredProfile() {
    const data = await readCredentialProfiles();
    const profile = (data.orgs || []).find(o => o.key === data.activeKey) || (data.orgs || [])[0];
    if (!profile) throw new Error('No stored org profiles yet. Use Connect Org first.');
    return SalesforceApi.fromStoredProfile(profile);
  }

  get tabId()            { return this.org?.tabId; }
  get hasStoredSession() { return !!this.org?.sessionId; }

  // Core request: stored-login → Bearer token; browser session → content-script bridge
  async request(path, options = {}) {
    const url = path.startsWith('http') ? path : `${this.orgUrl}${path}`;
    const { headers = {}, ...rest } = options;
    const { Authorization, ...safeHeaders } = headers;
    if (this.hasStoredSession) {
      return directSalesforceFetch(this.org, url, { ...rest, headers: safeHeaders });
    }
    if (!this.tabId) throw new Error('No Salesforce tab associated. Use Connect Org to sign in or open a Salesforce tab.');
    return bridgeFetch(this.tabId, url, { ...rest, headers: safeHeaders });
  }

  // Convenience methods
  rest(resource, options)    { return this.request(`/services/data/${this.apiVersion}${resource}`, options); }
  tooling(resource, options) { return this.request(`/services/data/${this.apiVersion}/tooling${resource}`, options); }

  query(soql)        { return this.rest(`/query?q=${encodeURIComponent(soql)}`); }
  toolingQuery(soql) { return this.tooling(`/query?q=${encodeURIComponent(soql)}`); }

  /**
   * queryAll: follows nextRecordsUrl pages automatically.
   * Returns all records (up to maxRecords, default 5000).
   */
  async queryAll(soql, { maxRecords = 5000, onPage } = {}) {
    let result = await this.query(soql);
    const all = [...(result.records || [])];
    if (onPage) onPage(all.length, result.totalSize);
    while (!result.done && result.nextRecordsUrl && all.length < maxRecords) {
      result = await this.request(result.nextRecordsUrl);
      all.push(...(result.records || []));
      if (onPage) onPage(all.length, result.totalSize);
    }
    return { records: all.slice(0, maxRecords), totalSize: result.totalSize, truncated: all.length >= maxRecords && !result.done };
  }

  async toolingQueryAll(soql, { maxRecords = 2000 } = {}) {
    let result = await this.toolingQuery(soql);
    const all = [...(result.records || [])];
    while (!result.done && result.nextRecordsUrl && all.length < maxRecords) {
      result = await this.request(result.nextRecordsUrl);
      all.push(...(result.records || []));
    }
    return { records: all.slice(0, maxRecords), totalSize: result.totalSize };
  }

  describeGlobal()          { return this.rest('/sobjects'); }
  describeObject(name)      { return this.rest(`/sobjects/${encodeURIComponent(name)}/describe`); }
  limits()                  { return this.rest('/limits'); }
  identity()                { return this.request('/services/oauth2/userinfo'); }
  health()                  { return this.request('/services/data/'); }

  get key() { return this.org ? orgKey(this.org) : this.orgUrl; }
}

// ── Download helpers ──────────────────────────────────────────────────────────
export function downloadJson(filename, data) {
  chrome.runtime.sendMessage({
    type: 'DOWNLOAD_TEXT', filename,
    mime: 'application/json',
    content: JSON.stringify(data, null, 2)
  });
}

export function toCsv(records = []) {
  const cols = [...new Set(records.flatMap(r => Object.keys(r).filter(k => k !== 'attributes')))];
  const esc  = v => `"${String(v ?? '').replaceAll('"', '""')}"`;
  return [
    cols.join(','),
    ...records.map(r => cols.map(c => esc(typeof r[c] === 'object' ? JSON.stringify(r[c]) : r[c])).join(','))
  ].join('\n');
}

// ── SOQL input sanitizer ──────────────────────────────────────────────────────
export function safeLike(input = '') {
  return String(input).replace(/'/g, "\\'").replace(/[\\%_]/g, c => '\\' + c);
}

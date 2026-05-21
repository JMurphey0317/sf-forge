/**
 * SF Forge Popup v3.0.0
 * Shows both stored-login org profiles AND open Salesforce tabs.
 * Lens toggle and workspace quick-launch.
 */
import { detectAndEnrichOrgs, mergeOrgIntoProfiles, readCredentialProfiles } from '../app/modules/org-manager.js';

const statusEl   = document.querySelector('#status');
const orgList    = document.querySelector('#orgList');
const openApp    = document.querySelector('#openApp');
const openSidePanel = document.querySelector('#openSidePanel');
const toggleLens = document.querySelector('#toggleLens');

let allOrgs     = []; // tab-detected orgs
let storedOrgs  = []; // vault orgs
let selectedOrg = null;

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}
function badgeClass(org) {
  return org.status === 'active' && org.apiAvailable ? 'ok'
       : org.status === 'expired' ? 'bad' : 'warn';
}
function badgeLabel(org) {
  return org.connectionMode === 'stored-login' ? 'Stored' : (org.status === 'active' ? 'Active' : 'Check');
}

async function scanOrgs() {
  statusEl.innerHTML = '<em>Scanning…</em>';

  // Load both tab-detected and stored-login orgs in parallel
  const [detected, vaultData] = await Promise.all([
    detectAndEnrichOrgs().catch(() => []),
    readCredentialProfiles().catch(() => ({ orgs: [], activeKey: null }))
  ]);
  allOrgs    = detected;
  storedOrgs = (vaultData.orgs || []).map(s => ({
    ...s, connectionMode: 'stored-login',
    status: s.sessionId ? 'active' : 'expired',
    apiAvailable: !!s.sessionId
  }));

  const store = await chrome.storage.local.get('sfForgeProfiles');
  const activeKey = vaultData.activeKey || store.sfForgeProfiles?.activeOrgKey;

  // Prefer stored active org, then detected active tab
  selectedOrg = [...storedOrgs, ...allOrgs].find(o => o.key === activeKey)
    || allOrgs.find(o => o.active)
    || storedOrgs[0]
    || allOrgs[0]
    || null;

  const total = allOrgs.length + storedOrgs.length;
  if (!total) {
    statusEl.innerHTML = '<b>No Salesforce orgs found</b><br>Open a Salesforce tab or connect an org from the workspace.';
    orgList.innerHTML  = '';
    return;
  }
  statusEl.innerHTML = `<b>${total} org${total > 1 ? 's' : ''} available</b><br>Select an org or open the full workspace.`;

  const allVisible = [...storedOrgs, ...allOrgs];
  orgList.innerHTML = allVisible.map(org =>
    `<article class="org-card ${selectedOrg?.key === org.key ? 'selected' : ''}" data-key="${escapeHtml(org.key)}" data-tab-id="${org.tabId || ''}" title="${escapeHtml(org.instanceUrl || '')}">
      <div class="org-title">
        <span>${escapeHtml(org.alias || org.orgName || org.hostname)}</span>
        <span class="badge ${badgeClass(org)}">${badgeLabel(org)}</span>
      </div>
      <div class="org-meta">${escapeHtml(org.type || '')} • ${escapeHtml(org.username || org.orgId || 'Session detected')}</div>
      ${org.lastError ? `<div class="org-error">${escapeHtml(org.lastError)}</div>` : ''}
      ${org.connectionMode === 'stored-login' ? `<button class="mini danger" data-delete-stored-popup="${escapeHtml(org.key)}">Delete Stored Org</button>` : ''}
    </article>`
  ).join('');

  document.querySelectorAll('.org-card').forEach(card =>
    card.onclick = async (ev) => {
      if (ev.target.closest('[data-delete-stored-popup]')) return;
      const key    = card.dataset.key;
      const tabId  = card.dataset.tabId;
      selectedOrg  = allVisible.find(o => o.key === key) || null;
      if (selectedOrg && tabId) await mergeOrgIntoProfiles(selectedOrg).catch(() => {});
      // Mark active in storage
      const pd = await chrome.storage.local.get('sfForgeProfiles');
      const p  = pd.sfForgeProfiles || {};
      await chrome.storage.local.set({ sfForgeProfiles: { ...p, activeOrgKey: key } });
      scanOrgs();
    }
  );

  document.querySelectorAll('[data-delete-stored-popup]').forEach(btn =>
    btn.onclick = async (ev) => {
      ev.stopPropagation();
      if (!confirm('Delete this stored org profile from SF Forge?')) return;
      const key = btn.dataset.deleteStoredPopup;
      const data = await readCredentialProfiles().catch(() => ({ orgs: [], activeKey: null }));
      data.orgs = (data.orgs || []).filter(o => o.key !== key);
      if (data.activeKey === key) data.activeKey = data.orgs[0]?.key || null;
      await chrome.storage.local.set({ sfForgeCredentialProfiles: data });
      statusEl.innerHTML = '<b>Stored org deleted</b><br>The profile was removed from this Chrome profile.';
      scanOrgs();
    }
  );
}

openApp.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_APP' }));
openSidePanel.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true }).catch(() => []);
  chrome.runtime.sendMessage({ type: 'OPEN_SIDE_PANEL', tabId: tab?.id, windowId: tab?.windowId });
});

toggleLens.addEventListener('click', async () => {
  const tabId = selectedOrg?.tabId;
  if (!tabId) {
    statusEl.innerHTML = '<b>Tab required for LWC Lens</b><br>Select an org detected from an open Salesforce tab.';
    return;
  }
  const store = await chrome.storage.local.get('sfForge');
  const next  = !store.sfForge?.lensEnabled;
  await chrome.storage.local.set({ sfForge: { ...(store.sfForge || {}), lensEnabled: next } });
  try {
    try { await chrome.tabs.sendMessage(tabId, { type: 'SF_FORGE_LENS_PING' }); }
    catch (_) {
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['src/content/lwc-lens.css'] }).catch(() => {});
      await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content/lwc-lens.js'] });
    }
    await chrome.tabs.sendMessage(tabId, { type: 'SF_FORGE_LENS_TOGGLE', enabled: next });
    statusEl.innerHTML = `<b>LWC Lens ${next ? 'enabled' : 'disabled'}</b><br>Hover Lightning components to inspect names and paths.`;
  } catch (e) {
    statusEl.innerHTML = `<b>LWC Lens error</b><br>${escapeHtml(e.message)}`;
  }
});

scanOrgs();

/**
 * SF Forge Service Worker v7.0.0
 * Enhancements:
 *  - On install/startup: inject content scripts into any already-open SF tabs
 *    so the session bridge works immediately without requiring a page refresh.
 *    This is the primary fix for "not detecting Production tabs" after reload.
 *  - Alarm-based session auto-refresh every 90 min
 *  - GitHub Releases update check on startup and every 6 hours
 */

import { checkForUpdates } from '../app/modules/update-checker.js';

const CURRENT_VERSION = '7.0.0';
const STORAGE_KEY     = 'sfForge';

const SF_URL_PATTERN = /\.(salesforce|force|visualforce|site|cloudforce)\.com/i;

const CONTENT_SCRIPTS = [
  'src/content/salesforce-detector.js',
  'src/content/session-bridge.js',
  'src/content/lwc-lens.js'
];
const CONTENT_CSS = ['src/content/lwc-lens.css'];

/**
 * Inject the bridge into every already-open Salesforce tab.
 * Chrome only auto-injects content scripts into tabs opened AFTER the
 * extension installs/updates. Tabs already open at install/reload time
 * need a programmatic injection — otherwise Detect Orgs always fails.
 */
async function injectIntoExistingTabs() {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (_) { return; }

  for (const tab of tabs) {
    if (!tab.url || !SF_URL_PATTERN.test(tab.url) || !tab.id) continue;
    try {
      // CSS first (silent if already injected)
      await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: CONTENT_CSS }).catch(() => {});
      // Scripts — guard flag in the script itself prevents double-init
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: CONTENT_SCRIPTS });
    } catch (_) {
      // Tab may be a chrome:// URL, PDF, or otherwise restricted — skip silently
    }
  }
}

// ── Install / upgrade ──────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const store    = await chrome.storage.local.get(STORAGE_KEY);
  const existing = store[STORAGE_KEY] || {};
  const defaults = {
    apiVersion: 'v66.0', lensEnabled: false,
    theme: 'dark-fenrir', installedVersion: CURRENT_VERSION
  };
  await chrome.storage.local.set({
    [STORAGE_KEY]: { ...defaults, ...existing, installedVersion: CURRENT_VERSION }
  });

  if (reason === 'update') {
    const profiles = (await chrome.storage.local.get('sfForgeProfiles')).sfForgeProfiles || {};
    let dirty = false;
    for (const item of (profiles.recent || [])) {
      if (item.sid) { delete item.sid; dirty = true; }
    }
    if (dirty) await chrome.storage.local.set({ sfForgeProfiles: profiles });
  }

  // Set up alarms
  chrome.alarms.clearAll();
  chrome.alarms.create('sf-forge-session-refresh', { periodInMinutes: 90 });
  chrome.alarms.create('sf-forge-update-check',    { periodInMinutes: 360 });

  // Inject into existing tabs and run update check
  await injectIntoExistingTabs();
  checkForUpdates().catch(() => {});
});

// ── Startup ────────────────────────────────────────────────────────────────
chrome.runtime.onStartup.addListener(async () => {
  await injectIntoExistingTabs();
  checkForUpdates().catch(() => {});
});

// ── Alarms ─────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {

  if (alarm.name === 'sf-forge-update-check') {
    checkForUpdates().catch(() => {});
    return;
  }

  if (alarm.name === 'sf-forge-session-refresh') {
    try {
      const data     = await chrome.storage.local.get('sfForgeCredentialProfiles');
      const profiles = data.sfForgeCredentialProfiles || { orgs: [], activeKey: null };
      for (const org of (profiles.orgs || [])) {
        if (!org.sessionId) continue;
        try {
          const testUrl = `${org.instanceUrl}/services/data/`;
          const res = await fetch(testUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${org.sessionId}`, 'Accept': 'application/json' }
          });
          if (!res.ok && org.savedCredentials) {
            org.sessionId    = null;
            org.needsRefresh = true;
          }
        } catch (_) { /* network error — skip */ }
      }
      await chrome.storage.local.set({ sfForgeCredentialProfiles: profiles });
    } catch (_) { /* non-fatal */ }
  }
});

// ── Message router ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {

        case 'OPEN_APP':
          await chrome.tabs.create({ url: chrome.runtime.getURL('src/app/index.html') });
          sendResponse({ ok: true });
          break;

        case 'OPEN_SIDE_PANEL': {
          if (chrome.sidePanel?.open && message.tabId) {
            await chrome.sidePanel.open({ tabId: message.tabId });
          } else if (chrome.sidePanel?.open && message.windowId) {
            await chrome.sidePanel.open({ windowId: message.windowId });
          } else {
            await chrome.tabs.create({ url: chrome.runtime.getURL('src/app/index.html') });
          }
          sendResponse({ ok: true });
          break;
        }

        case 'DOWNLOAD_TEXT': {
          const mime = message.mime || 'text/plain';
          const url  = `data:${mime};charset=utf-8,${encodeURIComponent(message.content || '')}`;
          await chrome.downloads.download({
            url, filename: message.filename || 'sf-forge-download.txt', saveAs: true
          });
          sendResponse({ ok: true });
          break;
        }

        case 'DOWNLOAD_URL': {
          await chrome.downloads.download({
            url: message.url,
            filename: message.filename || 'sf-forge-update.zip',
            saveAs: true
          });
          sendResponse({ ok: true });
          break;
        }

        case 'CHECK_FOR_UPDATES': {
          const state = await checkForUpdates();
          sendResponse({ ok: true, state });
          break;
        }

        case 'INJECT_BRIDGE': {
          // Called from the app when Detect Orgs fails — re-inject into a specific tab
          const { tabId } = message;
          if (!tabId) { sendResponse({ ok: false, error: 'No tabId' }); break; }
          try {
            await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS }).catch(() => {});
            await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
            sendResponse({ ok: true });
          } catch (e) {
            sendResponse({ ok: false, error: e.message });
          }
          break;
        }

        case 'SF_API_REQUEST': {
          const { tabId, url, method, body, headers } = message;
          if (!tabId || !url) {
            sendResponse({ ok: false, error: 'Missing tabId or url' });
            break;
          }
          // Try the bridge; if it fails because the script isn't loaded yet,
          // inject it first and retry once.
          let result;
          try {
            result = await chrome.tabs.sendMessage(tabId, {
              type: 'SF_BRIDGE_FETCH', url, method: method || 'GET',
              body: body || null, headers: headers || {}
            });
          } catch (e) {
            // Bridge not loaded — inject now and retry
            try {
              await chrome.scripting.insertCSS({ target: { tabId }, files: CONTENT_CSS }).catch(() => {});
              await chrome.scripting.executeScript({ target: { tabId }, files: CONTENT_SCRIPTS });
              result = await chrome.tabs.sendMessage(tabId, {
                type: 'SF_BRIDGE_FETCH', url, method: method || 'GET',
                body: body || null, headers: headers || {}
              });
            } catch (e2) {
              sendResponse({ ok: false, errorLabel: `Bridge injection failed: ${e2.message}. Refresh the Salesforce tab and try again.` });
              break;
            }
          }
          sendResponse(result);
          break;
        }

        case 'GET_ACTIVE_TAB': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          sendResponse({ ok: true, tab });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'Unknown message type: ' + message?.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});

// ── Install / upgrade ──────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  const store    = await chrome.storage.local.get(STORAGE_KEY);
  const existing = store[STORAGE_KEY] || {};
  const defaults = {
    apiVersion: 'v66.0', lensEnabled: false,
    theme: 'dark-fenrir', installedVersion: CURRENT_VERSION
  };
  await chrome.storage.local.set({
    [STORAGE_KEY]: { ...defaults, ...existing, installedVersion: CURRENT_VERSION }
  });

  if (reason === 'update') {
    const profiles = (await chrome.storage.local.get('sfForgeProfiles')).sfForgeProfiles || {};
    let dirty = false;
    for (const item of (profiles.recent || [])) {
      if (item.sid) { delete item.sid; dirty = true; }
    }
    if (dirty) await chrome.storage.local.set({ sfForgeProfiles: profiles });
  }

  // Set up alarms
  chrome.alarms.clearAll();
  chrome.alarms.create('sf-forge-session-refresh', { periodInMinutes: 90 });
  chrome.alarms.create('sf-forge-update-check',    { periodInMinutes: 360 }); // every 6 hours

  // Run an update check immediately on install/update
  checkForUpdates().catch(() => {});
});

// ── Startup: run update check once per browser session ────────────────────
chrome.runtime.onStartup.addListener(() => {
  checkForUpdates().catch(() => {});
});

// ── Alarms ─────────────────────────────────────────────────────────────────
chrome.alarms.onAlarm.addListener(async (alarm) => {

  if (alarm.name === 'sf-forge-update-check') {
    checkForUpdates().catch(() => {});
    return;
  }

  if (alarm.name === 'sf-forge-session-refresh') {
    try {
      const data     = await chrome.storage.local.get('sfForgeCredentialProfiles');
      const profiles = data.sfForgeCredentialProfiles || { orgs: [], activeKey: null };
      for (const org of (profiles.orgs || [])) {
        if (!org.sessionId) continue;
        try {
          const testUrl = `${org.instanceUrl}/services/data/`;
          const res = await fetch(testUrl, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${org.sessionId}`, 'Accept': 'application/json' }
          });
          if (!res.ok && org.savedCredentials) {
            org.sessionId = null;
            org.needsRefresh = true;
          }
        } catch (_) { /* network error — skip */ }
      }
      await chrome.storage.local.set({ sfForgeCredentialProfiles: profiles });
    } catch (_) { /* non-fatal */ }
  }
});

// ── Message router ─────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    try {
      switch (message?.type) {

        case 'OPEN_APP':
          await chrome.tabs.create({ url: chrome.runtime.getURL('src/app/index.html') });
          sendResponse({ ok: true });
          break;

        case 'OPEN_SIDE_PANEL': {
          if (chrome.sidePanel?.open && message.tabId) {
            await chrome.sidePanel.open({ tabId: message.tabId });
          } else if (chrome.sidePanel?.open && message.windowId) {
            await chrome.sidePanel.open({ windowId: message.windowId });
          } else {
            await chrome.tabs.create({ url: chrome.runtime.getURL('src/app/index.html') });
          }
          sendResponse({ ok: true });
          break;
        }

        case 'DOWNLOAD_TEXT': {
          const mime = message.mime || 'text/plain';
          const url  = `data:${mime};charset=utf-8,${encodeURIComponent(message.content || '')}`;
          await chrome.downloads.download({
            url, filename: message.filename || 'sf-forge-download.txt', saveAs: true
          });
          sendResponse({ ok: true });
          break;
        }

        case 'DOWNLOAD_URL': {
          // Trigger a Chrome download from a direct URL (e.g. GitHub release zip)
          await chrome.downloads.download({
            url: message.url,
            filename: message.filename || 'sf-forge-update.zip',
            saveAs: true
          });
          sendResponse({ ok: true });
          break;
        }

        case 'CHECK_FOR_UPDATES': {
          const state = await checkForUpdates();
          sendResponse({ ok: true, state });
          break;
        }

        case 'SF_API_REQUEST': {
          const { tabId, url, method, body, headers } = message;
          if (!tabId || !url) {
            sendResponse({ ok: false, error: 'Missing tabId or url' });
            break;
          }
          const result = await chrome.tabs.sendMessage(tabId, {
            type: 'SF_BRIDGE_FETCH', url, method: method || 'GET',
            body: body || null, headers: headers || {}
          });
          sendResponse(result);
          break;
        }

        case 'GET_ACTIVE_TAB': {
          const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
          sendResponse({ ok: true, tab });
          break;
        }

        default:
          sendResponse({ ok: false, error: 'Unknown message type: ' + message?.type });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true;
});

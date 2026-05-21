/**
 * SF Forge Service Worker v5.1.1
 * Enhancements:
 *  - Alarm-based session auto-refresh every 90 min
 *  - GitHub Releases update check on startup and every 6 hours
 *  - Improved download handler
 */

import { checkForUpdates } from '../app/modules/update-checker.js';

const CURRENT_VERSION = '5.1.0';
const STORAGE_KEY     = 'sfForge';

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

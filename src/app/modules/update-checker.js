/**
 * SF Forge Update Checker
 *
 * Polls the GitHub Releases API for the configured repo.
 * Compares the latest release tag against the installed manifest version.
 * Stores the result in chrome.storage.local so the UI can read it without
 * making an additional network call.
 *
 * Storage key: sfForgeUpdateState
 * Shape: { latestVersion, downloadUrl, releaseUrl, releaseNotes, checkedAt, dismissed }
 */

const UPDATE_STORAGE_KEY = 'sfForgeUpdateState';
const REPO_CONFIG_KEY    = 'sfForgeRepoConfig';

// Pull the installed version straight from the manifest — single source of truth
function getInstalledVersion() {
  return chrome.runtime.getManifest().version;
}

// Semver compare: returns true if remote > local
function isNewer(remote, local) {
  const parse = v => String(v || '').replace(/^v/, '').split('.').map(n => parseInt(n) || 0);
  const [rMaj, rMin, rPatch] = parse(remote);
  const [lMaj, lMin, lPatch] = parse(local);
  if (rMaj !== lMaj) return rMaj > lMaj;
  if (rMin !== lMin) return rMin > lMin;
  return rPatch > lPatch;
}

/**
 * Fetch the latest release from GitHub and store the result.
 * Safe to call from the service worker — uses fetch() directly.
 * Returns { hasUpdate, latestVersion, downloadUrl, releaseUrl, releaseNotes } or null on error.
 */
export async function checkForUpdates() {
  try {
    const config = (await chrome.storage.local.get(REPO_CONFIG_KEY))[REPO_CONFIG_KEY];
    if (!config?.owner || !config?.repo) return null; // not configured

    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}/releases/latest`;
    const resp = await fetch(apiUrl, {
      headers: { 'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }
    });

    if (resp.status === 404) {
      // Repo not found or no releases yet — clear any stale state
      await chrome.storage.local.remove(UPDATE_STORAGE_KEY);
      return null;
    }
    if (!resp.ok) throw new Error(`GitHub API ${resp.status}`);

    const release = await resp.json();
    const latestVersion = String(release.tag_name || '').replace(/^v/, '');
    const installedVersion = getInstalledVersion();
    const hasUpdate = isNewer(latestVersion, installedVersion);

    // Find the .zip asset, falling back to the zipball_url
    const zipAsset = (release.assets || []).find(a =>
      a.name.endsWith('.zip') && a.state === 'uploaded'
    );
    const downloadUrl = zipAsset?.browser_download_url || release.zipball_url || null;
    const releaseUrl  = release.html_url || null;
    // Trim release notes to 500 chars for storage
    const releaseNotes = (release.body || '').substring(0, 500);

    const state = {
      hasUpdate,
      installedVersion,
      latestVersion,
      downloadUrl,
      releaseUrl,
      releaseNotes,
      checkedAt: Date.now(),
      dismissed: false
    };

    await chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: state });
    return state;
  } catch (err) {
    console.warn('[SF Forge] Update check failed:', err.message);
    return null;
  }
}

/**
 * Read the last cached update state — safe to call from any context.
 */
export async function getUpdateState() {
  const data = await chrome.storage.local.get(UPDATE_STORAGE_KEY);
  return data[UPDATE_STORAGE_KEY] || null;
}

/**
 * Dismiss the current update banner until a newer version is released.
 */
export async function dismissUpdate() {
  const data  = await chrome.storage.local.get(UPDATE_STORAGE_KEY);
  const state = data[UPDATE_STORAGE_KEY];
  if (state) await chrome.storage.local.set({ [UPDATE_STORAGE_KEY]: { ...state, dismissed: true } });
}

/**
 * Save repo config (owner + repo name).
 */
export async function saveRepoConfig(owner, repo) {
  await chrome.storage.local.set({ [REPO_CONFIG_KEY]: { owner: owner.trim(), repo: repo.trim() } });
}

/**
 * Read repo config.
 */
export async function getRepoConfig() {
  const data = await chrome.storage.local.get(REPO_CONFIG_KEY);
  return data[REPO_CONFIG_KEY] || { owner: '', repo: '' };
}

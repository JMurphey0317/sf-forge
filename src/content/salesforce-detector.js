/**
 * SF Forge Salesforce Detector v1.3.0
 * Runs in every matched page. Sets a dataset attribute for quick detection
 * and responds to page-info queries from the extension.
 *
 * v1.3.0: Broadened hostname check to cover sandbox lightning, custom domains,
 * develop/scratch orgs, and cloudforce.com — matching the manifest patterns.
 */
(() => {
  const SF_PATTERN = /salesforce\.com|force\.com|visualforce\.com|site\.com|cloudforce\.com/i;
  const isSalesforce = SF_PATTERN.test(location.hostname);
  document.documentElement.dataset.sfForgeDetected = String(isSalesforce);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SF_FORGE_PAGE_INFO') {
      sendResponse({
        ok: true,
        hostname: location.hostname,
        href: location.href,
        isSalesforce,
        title: document.title
      });
      return false; // sync
    }
  });
})();

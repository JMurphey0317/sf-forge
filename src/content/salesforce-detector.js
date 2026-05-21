/**
 * SF Forge Salesforce Detector v1.2.0
 * Runs in every matched page. Sets a dataset attribute for quick detection
 * and responds to page-info queries from the extension.
 */
(() => {
  const isSalesforce = /salesforce\.com|force\.com|visualforce\.com/i.test(location.hostname);
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

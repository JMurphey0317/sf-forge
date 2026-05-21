/**
 * SF Forge Session Bridge v1.3.0
 *
 * Runs inside the Salesforce page. Proxies REST calls from the extension
 * so fetch() runs in the SF origin → credentials:include, no CORS.
 *
 * v1.3.0 fixes:
 *  - Guard against res being undefined before accessing res.status
 *    (prevents "HTTP undefined" when the tab's fetch context throws pre-response)
 *  - Explicit status:0 for network-level failures (was missing in some paths)
 *  - errorLabel always set to a non-undefined string
 */
(() => {
  if (window.__sfForgeBridgeLoaded) return;
  window.__sfForgeBridgeLoaded = true;

  const tabOrigin = `${location.protocol}//${location.hostname}`;

  function resolveUrl(requestedUrl) {
    try {
      const u = new URL(requestedUrl);
      if (u.origin === tabOrigin) return requestedUrl;
      return `${tabOrigin}${u.pathname}${u.search}`;
    } catch {
      return requestedUrl.startsWith('/') ? `${tabOrigin}${requestedUrl}` : requestedUrl;
    }
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SF_FORGE_LENS_PING') { sendResponse({ ok: true }); return false; }
    if (message?.type !== 'SF_BRIDGE_FETCH') return false;

    const { url, method = 'GET', body = null, headers = {} } = message;
    const resolvedUrl = resolveUrl(url);

    (async () => {
      let res;
      try {
        const init = {
          method,
          credentials: 'include',
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            ...headers
          }
        };
        if (body && method !== 'GET' && method !== 'HEAD') {
          init.body = typeof body === 'string' ? body : JSON.stringify(body);
        }

        res = await fetch(resolvedUrl, init);

        const text = await res.text();
        let parsed;
        try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

        let errorLabel = null;
        if (!res.ok) {
          // Always produce a defined, non-empty errorLabel
          const httpCode = (typeof res.status === 'number' && res.status > 0) ? res.status : 0;
          if (httpCode === 401 || httpCode === 403) {
            const errCode = Array.isArray(parsed) ? parsed[0]?.errorCode : parsed?.errorCode;
            errorLabel = errCode || `HTTP ${httpCode} — session expired or insufficient access`;
          } else if (httpCode === 0) {
            errorLabel = 'Network error — no HTTP response received';
          } else {
            errorLabel = `HTTP ${httpCode}`;
            // Append SF error message if present
            const sfMsg = Array.isArray(parsed) ? parsed[0]?.message : parsed?.message;
            if (sfMsg) errorLabel += `: ${sfMsg}`;
          }
        }

        sendResponse({
          ok:             res.ok,
          status:         res.status,
          body:           parsed,
          resolvedOrigin: tabOrigin,
          errorLabel
        });

      } catch (err) {
        // res may be undefined here — do NOT reference res.status
        sendResponse({
          ok:             false,
          status:         0,
          body:           null,
          resolvedOrigin: tabOrigin,
          errorLabel:     `Network error: ${err.message || String(err)}`
        });
      }
    })();

    return true;
  });
})();

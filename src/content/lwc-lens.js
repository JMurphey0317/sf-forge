/**
 * SF Forge LWC Lens v1.2.0
 * Shadow-DOM aware component inspector with floating panel,
 * lock-selection, DOM path, and copy-to-clipboard.
 */
(() => {
  if (window.__sfForgeLensLoaded) return;
  window.__sfForgeLensLoaded = true;
  // Default disabled. User must enable from SF Forge. This prevents page noise and accidental overlays.

  let enabled = false;
  let locked = false;       // When locked, panel stays on current component
  let last = null;          // The currently outlined element
  let lockedComponent = null; // Snapshot when locked

  // ── Build the floating panel ─────────────────────────────────────────────
  const panel = document.createElement('div');
  panel.className = 'sf-forge-lens-panel hidden';
  panel.innerHTML = `
    <div class="sf-forge-lens-panel-header">
      <span class="sf-forge-lens-panel-tag" id="_sffl_tag">—</span>
      <button class="sf-forge-lens-panel-lock" id="_sffl_lock" title="Lock selection (pause hover)">⏸</button>
    </div>
    <div class="sf-forge-lens-panel-body">
      <div class="sf-forge-lens-path" id="_sffl_path"></div>
    </div>
    <div class="sf-forge-lens-panel-actions">
      <button class="sf-forge-lens-btn" id="_sffl_copy">Copy tag</button>
      <button class="sf-forge-lens-btn" id="_sffl_copypath">Copy path</button>
    </div>
  `;
  document.documentElement.appendChild(panel);

  const elTag   = panel.querySelector('#_sffl_tag');
  const elPath  = panel.querySelector('#_sffl_path');
  const elLock  = panel.querySelector('#_sffl_lock');
  const elCopy  = panel.querySelector('#_sffl_copy');
  const elCopyPath = panel.querySelector('#_sffl_copypath');

  // Stop mousemove from bleeding through the panel into the page
  panel.addEventListener('mousemove', e => e.stopPropagation());

  // ── Helpers ──────────────────────────────────────────────────────────────
  function looksLikeComponentTag(tag = '') {
    return tag.includes('-') && ![
      'lightning-icon','lightning-button-icon','lightning-primitive-icon',
      'svg-use','c-lookup-desktop-phone','aura-helptext'
    ].includes(tag);
  }

  function componentNameFromNode(node) {
    if (!node || node.nodeType !== Node.ELEMENT_NODE) return null;
    const tag = node.tagName?.toLowerCase?.() || '';
    const attrs = ['data-aura-class','data-component-id','data-global-id','data-component-name','data-key'];
    for (const attr of attrs) {
      const val = node.getAttribute?.(attr);
      if (val && !/^\d+$/.test(val)) return val;
    }
    if (looksLikeComponentTag(tag)) return tag;
    return null;
  }

  function componentFromEvent(event) {
    // composedPath crosses shadow roots (critical for LWC)
    const path = event.composedPath?.() || [];
    for (const node of path) {
      const name = componentNameFromNode(node);
      if (name) return { name, el: node, path };
    }
    // Fallback: walk DOM ancestors including shadow hosts
    let el = event.target;
    while (el && el !== document.documentElement) {
      const name = componentNameFromNode(el);
      if (name) return { name, el, path: [] };
      el = el.parentElement || el.getRootNode?.()?.host;
    }
    return null;
  }

  function buildDomPath(el) {
    const parts = [];
    let cur = el;
    let depth = 0;
    while (cur && cur !== document.documentElement && depth < 5) {
      const tag = cur.tagName?.toLowerCase?.() || '';
      const id = cur.id ? `#${cur.id}` : '';
      parts.unshift(`${tag}${id}`);
      // Cross shadow boundaries upward
      const root = cur.getRootNode?.();
      cur = (root instanceof ShadowRoot) ? root.host : cur.parentElement;
      depth++;
    }
    return parts.join(' › ');
  }

  function positionPanel(x, y) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const pw = panel.offsetWidth || 240, ph = panel.offsetHeight || 120;
    let left = x + 16, top = y + 16;
    if (left + pw > vw - 8) left = x - pw - 8;
    if (top + ph > vh - 8) top = y - ph - 8;
    panel.style.left = `${Math.max(8, left)}px`;
    panel.style.top  = `${Math.max(8, top)}px`;
  }

  function showPanel(found, x, y) {
    elTag.textContent  = found.name;
    elPath.textContent = buildDomPath(found.el);
    panel.classList.remove('hidden');
    positionPanel(x, y);
  }

  function clear() {
    if (!locked) {
      if (last?.classList) last.classList.remove('sf-forge-lens-outline');
      last = null;
      panel.classList.add('hidden');
    }
  }

  function applyOutline(el) {
    if (last === el) return;
    if (last?.classList) last.classList.remove('sf-forge-lens-outline');
    last = el;
    last.classList?.add('sf-forge-lens-outline');
  }

  // ── Lock button ──────────────────────────────────────────────────────────
  elLock.addEventListener('click', () => {
    locked = !locked;
    elLock.textContent = locked ? '▶' : '⏸';
    elLock.title = locked ? 'Resume hover' : 'Lock selection (pause hover)';
    elLock.classList.toggle('locked', locked);
    if (locked && last) {
      lockedComponent = { name: elTag.textContent, el: last };
    } else {
      lockedComponent = null;
    }
  });

  // ── Copy buttons ─────────────────────────────────────────────────────────
  async function copyText(text, label) {
    try {
      await navigator.clipboard.writeText(text);
      const orig = label === 'tag' ? elCopy.textContent : elCopyPath.textContent;
      const btn = label === 'tag' ? elCopy : elCopyPath;
      btn.textContent = '✓ Copied';
      setTimeout(() => { btn.textContent = orig; }, 1400);
    } catch (_) {}
  }
  elCopy.addEventListener('click', () => copyText(elTag.textContent, 'tag'));
  elCopyPath.addEventListener('click', () => copyText(elPath.textContent, 'path'));

  // ── Mouse events ─────────────────────────────────────────────────────────
  document.addEventListener('mousemove', (event) => {
    if (!enabled || locked) return;
    const found = componentFromEvent(event);
    if (!found) return clear();
    applyOutline(found.el);
    showPanel(found, event.clientX, event.clientY);
  }, { passive: true, capture: true });

  document.addEventListener('mouseleave', () => { if (!locked) clear(); });

  // Right-click: copy tag (contextmenu still fires on the page)
  document.addEventListener('contextmenu', async (event) => {
    if (!enabled) return;
    const found = componentFromEvent(event);
    if (found?.name) await copyText(found.name, 'tag');
  }, { capture: true });

  // ── Extension messages ────────────────────────────────────────────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SF_FORGE_LENS_TOGGLE') {
      enabled = Boolean(message.enabled);
      if (!enabled) {
        locked = false;
        lockedComponent = null;
        clear();
      }
      sendResponse({ ok: true, enabled });
      return false;
    }
    if (message?.type === 'SF_FORGE_LENS_PING') {
      sendResponse({ ok: true, enabled, locked });
      return false;
    }
  });
})();

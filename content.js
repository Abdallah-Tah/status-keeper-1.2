// Status Keeper content script: runs only on the Teams web pages listed in manifest.json.
// When the service worker asks, it sends a small, harmless mouse movement to the page.
(() => {
  if (window.__statusKeeperLoaded) return;
  window.__statusKeeperLoaded = true;

  function nudge() {
    const w = Math.max(document.documentElement.clientWidth, 200);
    const h = Math.max(document.documentElement.clientHeight, 200);
    const x = Math.round(w * (0.3 + Math.random() * 0.4));
    const y = Math.round(h * (0.3 + Math.random() * 0.4));
    const init = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x, screenY: y, view: window };
    const targets = [document, document.body || document.documentElement];
    for (const target of targets) {
      if (typeof PointerEvent === "function") {
        target.dispatchEvent(new PointerEvent("pointermove", { ...init, pointerType: "mouse", isPrimary: true }));
      }
      target.dispatchEvent(new MouseEvent("mousemove", init));
    }
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return false;
    if (msg.type === "status-keeper-nudge") {
      nudge();
      sendResponse({ ok: true });
    } else if (msg.type === "status-keeper-ping") {
      sendResponse({ ok: true });
    }
    return false;
  });
})();

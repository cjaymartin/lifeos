// Announces the extension's presence to the LifeOS app so it can hide the
// "Download Extension" prompt and show install/version state. Sets a data
// attribute (read synchronously by the app) and fires an event. Read-only.
(function () {
  const api = globalThis.browser ?? globalThis.chrome;
  try {
    const version = api.runtime.getManifest().version;
    document.documentElement.setAttribute('data-lifeos-extension', version);
    window.dispatchEvent(new CustomEvent('lifeos-extension-ready', { detail: { version } }));
  } catch { /* not in an extension context */ }
})();

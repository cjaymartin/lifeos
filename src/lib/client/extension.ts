// Client-side detection of the LifeOS Browser Extension. The extension's
// announce.js content script sets `data-lifeos-extension="<version>"` on
// <html> (at document_start) and fires a `lifeos-extension-ready` event.

export function getExtensionVersion(): string | null {
  if (typeof document === 'undefined') return null;
  return document.documentElement.getAttribute('data-lifeos-extension');
}

/** Resolve the installed extension version, or null if not detected within
 *  `timeoutMs` (the content script normally sets it before hydration, but we
 *  poll briefly to avoid a race). */
export function detectExtension(timeoutMs = 1500): Promise<string | null> {
  return new Promise((resolve) => {
    const immediate = getExtensionVersion();
    if (immediate) return resolve(immediate);
    if (typeof window === 'undefined') return resolve(null);

    let settled = false;
    const finish = (v: string | null) => {
      if (settled) return;
      settled = true;
      window.removeEventListener('lifeos-extension-ready', onReady as EventListener);
      clearInterval(poll);
      clearTimeout(timer);
      resolve(v);
    };
    const onReady = (e: Event) => finish((e as CustomEvent).detail?.version ?? getExtensionVersion() ?? 'unknown');
    const poll = setInterval(() => { const v = getExtensionVersion(); if (v) finish(v); }, 200);
    const timer = setTimeout(() => finish(null), timeoutMs);
    window.addEventListener('lifeos-extension-ready', onReady as EventListener);
  });
}

// Regression test for NIM-9 / abraxas/lifeos#4 — light-mode hydration mismatch.
//
// AppLayout's inline FOUC script applies the stored theme to <html> before
// paint, but the React tree must NOT depend on localStorage for its *initial*
// render: SSR runs with `window` undefined and always renders theme='dark', so
// if the first client render reads `theme=light` from localStorage the two
// trees disagree → React #418 hydration mismatch + a re-render on every page.
//
// The hydration invariant we assert: the server's initial markup and the
// client's *first* render (effects have not run yet — exactly what
// renderToStaticMarkup captures) must be byte-for-byte identical regardless of
// what theme is stored in localStorage.
//
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Sidebar from '@/components/Sidebar';

const props = { stacks: [], currentPath: '/' };

/** Render with `window`/`localStorage` shimmed to a given stored theme. */
function renderWithStoredTheme(theme: string | null): string {
  const store: Record<string, string> = {};
  if (theme !== null) store.theme = theme;
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: () => {},
    removeItem: () => {},
  };
  (globalThis as any).window = globalThis;
  try {
    return renderToStaticMarkup(<Sidebar {...props} />);
  } finally {
    delete (globalThis as any).window;
    delete (globalThis as any).localStorage;
  }
}

afterEach(() => {
  delete (globalThis as any).window;
  delete (globalThis as any).localStorage;
});

describe('Sidebar theme hydration (NIM-9)', () => {
  // SSR: `window` is undefined, so the component must fall back to 'dark'.
  const ssrMarkup = renderToStaticMarkup(<Sidebar {...props} />);

  it('initial client render with theme=light matches SSR markup', () => {
    const clientMarkup = renderWithStoredTheme('light');
    expect(clientMarkup).toBe(ssrMarkup);
  });

  it('initial client render with theme=dark matches SSR markup', () => {
    const clientMarkup = renderWithStoredTheme('dark');
    expect(clientMarkup).toBe(ssrMarkup);
  });

  it('SSR renders the dark-mode theme toggle (offers "Light mode")', () => {
    expect(ssrMarkup).toContain('Light mode');
    expect(ssrMarkup).not.toContain('Dark mode');
  });
});

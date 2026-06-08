// Regression test for #20 — sidebar collapsed-state hydration mismatch.
//
// Sibling of NIM-9 / #4 (see sidebar-theme-hydration.test.tsx). Sidebar seeded
// the `collapsed` useState from localStorage in its initializer. SSR runs with
// `window` undefined and always renders the expanded sidebar (`w-56`); a client
// with `sidebar-collapsed=true` stored would read `true` and render the
// collapsed sidebar (`w-14`) on its *first* render — the two trees disagree →
// React #418 hydration mismatch + a w-14↔w-56 layout reflow on every nav.
//
// The hydration invariant we assert: the server's initial markup and the
// client's *first* render (effects have not run yet — exactly what
// renderToStaticMarkup captures) must be byte-for-byte identical regardless of
// what `sidebar-collapsed` is stored in localStorage.
//
// @vitest-environment node
import { describe, it, expect, afterEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import Sidebar from '@/components/Sidebar';

const props = { stacks: [], currentPath: '/' };

/** Render with `window`/`localStorage` shimmed to a given stored collapsed value. */
function renderWithStoredCollapsed(collapsed: string | null): string {
  const store: Record<string, string> = {};
  if (collapsed !== null) store['sidebar-collapsed'] = collapsed;
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

describe('Sidebar collapsed hydration (#20)', () => {
  // SSR: `window` is undefined, so the component must fall back to expanded.
  const ssrMarkup = renderToStaticMarkup(<Sidebar {...props} />);

  it('initial client render with sidebar-collapsed=true matches SSR markup', () => {
    const clientMarkup = renderWithStoredCollapsed('true');
    expect(clientMarkup).toBe(ssrMarkup);
  });

  it('initial client render with sidebar-collapsed=false matches SSR markup', () => {
    const clientMarkup = renderWithStoredCollapsed('false');
    expect(clientMarkup).toBe(ssrMarkup);
  });

  it('SSR renders the expanded sidebar (w-56, not collapsed w-14)', () => {
    expect(ssrMarkup).toContain('w-56');
    expect(ssrMarkup).not.toContain('w-14');
    // Expanded sidebar shows the wordmark and the "Collapse" control label.
    expect(ssrMarkup).toContain('LifeOS');
    expect(ssrMarkup).toContain('Collapse');
  });
});

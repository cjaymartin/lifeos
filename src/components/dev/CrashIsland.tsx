// Test fixture for NIM-5 — a React island that throws during SSR on demand.
// Lets the QA/e2e suites prove that an island crashing mid-render yields a
// terminated 500 (custom error page) rather than the historical infinite hang.
// Harmless without `boom`: it just renders, behind auth, like any other page.
export default function CrashIsland({ boom }: { boom?: boolean }) {
  if (boom) {
    throw new Error('SSR crash test — deliberate island throw (NIM-5 regression)');
  }
  return <div data-testid="crash-island-ok">island rendered fine</div>;
}

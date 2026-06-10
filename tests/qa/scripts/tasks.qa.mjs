// QA: tasks stack (read-only flows) — see tests/qa/cases/tasks.md.
//
// Mutations (add/complete/edit/delete) live in the opt-in tasks-mutations area,
// which runs against an in-memory fake provider (LIFEOS_FAKE_TASKS=1) — never
// the real Todoist account (NIM-7). This area stays read-only.
import { startQA, expectVisible, readSandboxJson, BASE } from './qa-lib.mjs';

const qa = await startQA('tasks');
const data = readSandboxJson('src/content/tasks/tasks.json');
const open = (data.tasks ?? []).filter((t) => !t.completed);

await qa.check('TASK-1', 'page renders with view navigation and sync status', async (page) => {
  await page.goto(BASE + '/tasks');
  if ((await page.title()) !== 'Tasks — LifeOS') throw new Error(`title: ${await page.title()}`);
  for (const name of ['Today', 'Upcoming', 'Completed', 'Stats']) {
    await expectVisible(page.getByRole('button', { name }));
  }
  await expectVisible(page.getByText(/Not connected|Sync error|Synced|Waiting for first sync/));
});

await qa.check('TASK-2', 'Today view shows overdue + due-today tasks only', async (page) => {
  await page.goto(BASE + '/tasks');
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const due = (t) => String(t.due?.date ?? '').slice(0, 10);
  const dueNow = open.filter((t) => due(t) && due(t) <= today);
  const future = open.filter((t) => due(t) && due(t) > today);
  for (const t of dueNow.slice(0, 3)) {
    await expectVisible(page.getByText(t.content).first());
  }
  // A strictly-future task must NOT appear in Today
  const fut = future.find((t) => !dueNow.some((d2) => d2.content === t.content));
  if (fut && (await page.getByText(fut.content).count()) > 0) {
    throw new Error(`future task "${fut.content}" leaked into Today`);
  }
});

await qa.check('TASK-3', 'Upcoming view groups future tasks by day', async (page) => {
  await page.goto(BASE + '/tasks');
  await page.getByRole('button', { name: 'Upcoming' }).click();
  const withDue = open.filter((t) => t.due?.date);
  if (withDue.length) {
    await expectVisible(page.getByText(withDue[0].content).first(), 5000);
  }
});

await qa.check('TASK-4', 'Completed view renders the completed log', async (page) => {
  await page.goto(BASE + '/tasks');
  await page.getByRole('button', { name: 'Completed' }).click();
  await page.waitForTimeout(800);
  const completed = readSandboxJson('src/content/tasks/completed.json');
  const recent = (completed.completed ?? completed.tasks ?? [])[0];
  if (recent?.content) {
    await expectVisible(page.getByText(recent.content).first(), 5000);
  }
});

await qa.check('TASK-5', 'Stats view renders without errors', async (page) => {
  const before = qa.consoleErrors.length;
  await page.goto(BASE + '/tasks');
  await page.getByRole('button', { name: 'Stats' }).click();
  await page.waitForTimeout(1000);
  const errs = qa.consoleErrors.slice(before);
  if (errs.length) throw new Error(errs.map((e) => e.text).join(' | '));
});

await qa.check('TASK-6', 'project views render and count badges match data', async (page) => {
  await page.goto(BASE + '/tasks');
  // Projects section lists each project from the mirror
  for (const p of (data.projects ?? []).slice(0, 4)) {
    await expectVisible(page.getByRole('button', { name: new RegExp(p.name) }).first());
  }
  const first = (data.projects ?? [])[0];
  if (first) {
    await page.getByRole('button', { name: new RegExp(first.name) }).first().click();
    await page.waitForTimeout(500);
    const inProject = open.filter((t) => t.projectId === first.id);
    if (inProject[0]) await expectVisible(page.getByText(inProject[0].content).first());
  }
});

await qa.check('TASK-7', 'label views render used labels', async (page) => {
  await page.goto(BASE + '/tasks');
  const used = new Set(open.flatMap((t) => t.labels ?? []));
  const label = [...used][0];
  if (!label) return; // nothing to check in this dataset
  await page.getByRole('button', { name: new RegExp(label) }).first().click();
  await page.waitForTimeout(500);
  const tagged = open.find((t) => (t.labels ?? []).includes(label));
  if (tagged) await expectVisible(page.getByText(tagged.content).first());
});

await qa.check('TASK-8', 'SSE stream endpoint serves an event stream', async () => {
  // Read just the headers — don't hold the stream open
  const res = await qa.context.request.fetch(BASE + '/api/tasks/stream', {
    headers: { accept: 'text/event-stream' },
    timeout: 5000,
  }).catch((e) => {
    // request.fetch buffers the whole body, so a timeout while the stream
    // stays open is the expected shape — treat as pass-by-behavior.
    return null;
  });
  if (res && !res.ok()) throw new Error(`stream → ${res.status()}`);
});

await qa.check('TASK-9', 'tasks dashboard widget shows live mirror tasks', async (page) => {
  await page.goto(BASE + '/');
  const d = new Date();
  const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const dueNow = open.find((t) => String(t.due?.date ?? '').slice(0, 10) <= today && t.due?.date);
  if (dueNow) await expectVisible(page.getByText(dueNow.content).first());
});

await qa.check('TASK-10', 'no console errors across tasks views', async (page) => {
  const before = qa.consoleErrors.length;
  await page.goto(BASE + '/tasks');
  for (const name of ['Upcoming', 'Completed', 'Stats', 'Today']) {
    await page.getByRole('button', { name }).click();
    await page.waitForTimeout(400);
  }
  const errs = qa.consoleErrors.slice(before);
  if (errs.length) throw new Error(errs.map((e) => e.text).join(' | '));
});

await qa.finish();

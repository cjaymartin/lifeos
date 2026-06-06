// QA: task mutations — see tests/qa/cases/tasks.md (TASK-M1/M2).
//
// Opt-in area: run.mjs starts the server with LIFEOS_FAKE_TASKS=1 when this
// area is selected, so add/complete/reopen/edit/delete round-trip against an
// in-memory fake backend — never a real Todoist account (NIM-7). Selected via:
//   node tests/qa/run.mjs --area tasks-mutations
import { startQA, expectVisible, readSandboxJson, poll, BASE } from './qa-lib.mjs';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const mirrorTasks = () => readSandboxJson('src/content/tasks/tasks.json').tasks ?? [];
const projectTarget = () => {
  const ps = readSandboxJson('src/content/tasks/tasks.json').projects ?? [];
  return ps.find((p) => p.inbox) ?? ps[0];
};

const qa = await startQA('tasks-mutations');

// Loud guard: the whole point is exercising a CONNECTED (fake) backend. If the
// flag isn't active, fail rather than silently "pass" zero mutations.
const status = await (await qa.api('/api/tasks')).json();
if (!status?.sync?.configured) {
  await qa.check('TASK-M1', 'fake provider configured', async () => {
    throw new Error('LIFEOS_FAKE_TASKS not active — run via: node tests/qa/run.mjs --area tasks-mutations');
  });
  await qa.finish();
  process.exit(0);
}

const SUFFIX = Math.random().toString(36).slice(2, 8);
const NAME = `QA add ${SUFFIX}`;
const project = projectTarget();

await qa.check('TASK-M1', 'quick-add creates a task', async (page) => {
  const res = await qa.api('/api/tasks', {
    method: 'POST',
    data: { content: NAME, projectId: project?.id },
    headers: { 'content-type': 'application/json' },
  });
  if (res.status() !== 201) throw new Error(`POST /api/tasks → ${res.status()}`);
  await poll(() => mirrorTasks().some((t) => t.content === NAME), true);

  // And it renders in the project view.
  await page.goto(BASE + '/tasks');
  if (project) {
    await page.getByRole('button', { name: new RegExp(escapeRe(project.name)) }).first().click();
  }
  await expectVisible(page.getByText(NAME).first());
});

await qa.check('TASK-M2', 'complete / reopen / edit / delete round-trip', async () => {
  const id = mirrorTasks().find((t) => t.content === NAME)?.id;
  if (!id) throw new Error('seed task missing');
  const jsonHeaders = { 'content-type': 'application/json' };

  // edit content + priority
  let r = await qa.api(`/api/tasks/${id}`, {
    method: 'PATCH',
    data: { content: `${NAME} v2`, priority: 1 },
    headers: jsonHeaders,
  });
  if (r.status() !== 200) throw new Error(`PATCH → ${r.status()}`);
  await poll(() => mirrorTasks().find((t) => t.id === id)?.content, `${NAME} v2`);
  await poll(() => mirrorTasks().find((t) => t.id === id)?.priority, 1);

  // complete → leaves the active set
  r = await qa.api(`/api/tasks/${id}/complete`, { method: 'POST', data: {}, headers: jsonHeaders });
  if (r.status() !== 200) throw new Error(`complete → ${r.status()}`);
  await poll(() => mirrorTasks().some((t) => t.id === id), false);

  // reopen → returns to the active set
  r = await qa.api(`/api/tasks/${id}/reopen`, { method: 'POST', data: {}, headers: jsonHeaders });
  if (r.status() !== 200) throw new Error(`reopen → ${r.status()}`);
  await poll(() => mirrorTasks().some((t) => t.id === id), true);

  // delete → gone for good
  r = await qa.api(`/api/tasks/${id}`, { method: 'DELETE' });
  if (r.status() !== 200) throw new Error(`delete → ${r.status()}`);
  await poll(() => mirrorTasks().some((t) => t.id === id), false);
});

await qa.finish();

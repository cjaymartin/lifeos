import { test, expect, type Page } from '@playwright/test';
import { readSandboxJson, readSandboxVaultNotes } from './helpers';

// Task-mutation coverage (NIM-7). Runs ONLY against the in-memory fake provider
// (LIFEOS_FAKE_TASKS=1) — never a real Todoist account. The default
// `npm run test:e2e` leaves the flag unset so these skip; `npm run
// test:e2e:mutations` sets it. See tests/e2e/tasks-isolation.spec.ts for the
// complementary proof that the default sandbox is "Not connected".
test.skip(
  process.env.LIFEOS_FAKE_TASKS !== '1',
  'requires the fake task provider (LIFEOS_FAKE_TASKS=1)',
);

// These steps build on each other (add → edit → complete → reopen → delete)
// against the one shared sandbox, so they must run in order.
test.describe.configure({ mode: 'serial' });

function mirrorTasks(): any[] {
  // Active tasks are now per-note vault Markdown (projects stay in meta.json).
  return readSandboxVaultNotes<any>('tasks/active');
}

/** The project new tasks land in — inbox if present, else the first project. */
function targetProject(): { id: string; name: string } {
  const projects = readSandboxJson<{ projects: any[] }>('src/content/tasks/meta.json').projects ?? [];
  const inbox = projects.find((p) => p.inbox) ?? projects[0];
  if (!inbox) throw new Error('sandbox has no project to add tasks into');
  return { id: inbox.id, name: inbox.name };
}

async function openProject(page: Page, name: string) {
  await page.goto('/tasks');
  // The fake backend reports "connected", so quick-add must render.
  await expect(page.getByRole('button', { name }).first()).toBeVisible();
  await page.getByRole('button', { name }).first().click();
  await expect(page.getByPlaceholder('Add a task…')).toBeVisible();
}

/** The <li> wrapping a task with the given content. */
function row(page: Page, content: string) {
  return page.getByText(content, { exact: true }).first().locator('xpath=ancestor::li[1]');
}

const SUFFIX = Math.random().toString(36).slice(2, 8);
const NAME = `E2E add ${SUFFIX}`;
const RENAMED = `E2E edited ${SUFFIX}`;
const project = targetProject();

test('quick-add creates a task in the mirror and the UI', async ({ page }) => {
  await openProject(page, project.name);
  await page.getByPlaceholder('Add a task…').fill(NAME);
  await page.getByRole('button', { name: 'Add', exact: true }).click();

  // Renders in the project view…
  await expect(page.getByText(NAME, { exact: true }).first()).toBeVisible();
  // …and is persisted to the local sandbox mirror (proof it's the fake, not Todoist).
  await expect.poll(() => mirrorTasks().some((t) => t.content === NAME)).toBe(true);
  expect(mirrorTasks().find((t) => t.content === NAME).projectId).toBe(project.id);
});

test('edit changes content and priority', async ({ page }) => {
  await openProject(page, project.name);
  await row(page, NAME).getByText(NAME, { exact: true }).click(); // open the inline editor
  const editor = row(page, NAME);
  await editor.locator('input').first().fill(RENAMED); // content input is prefilled
  await editor.locator('select').selectOption('1'); // P1
  await editor.getByRole('button', { name: 'Save', exact: true }).click();

  await expect(page.getByText(RENAMED, { exact: true }).first()).toBeVisible();
  await expect
    .poll(() => mirrorTasks().find((t) => t.content === RENAMED)?.priority)
    .toBe(1);
});

test('complete moves the task to the Completed log; reopen brings it back', async ({ page }) => {
  await openProject(page, project.name);
  await row(page, RENAMED).getByRole('button', { name: 'Complete task' }).click();

  // Gone from the active mirror…
  await expect.poll(() => mirrorTasks().some((t) => t.content === RENAMED)).toBe(false);

  // …and present under Completed.
  await page.getByRole('button', { name: 'Completed' }).click();
  await expect(page.getByText(RENAMED, { exact: true }).first()).toBeVisible();

  // Reopen restores it to the active mirror.
  await row(page, RENAMED).getByRole('button', { name: 'Reopen' }).click();
  await expect.poll(() => mirrorTasks().some((t) => t.content === RENAMED)).toBe(true);
});

test('delete removes the task entirely', async ({ page }) => {
  await openProject(page, project.name);
  await row(page, RENAMED).getByText(RENAMED, { exact: true }).click(); // open editor
  await row(page, RENAMED).getByRole('button', { name: 'Delete task' }).click();

  await expect.poll(() => mirrorTasks().some((t) => t.content === RENAMED)).toBe(false);
});

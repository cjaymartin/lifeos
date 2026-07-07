import { test, expect } from '@playwright/test';
import { readSandboxVaultNotes } from './helpers';

function localISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

test.describe('tasks stack', () => {
  test('renders the tasks page with view navigation', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page).toHaveTitle('Tasks — LifeOS');
    for (const name of ['Today', 'Upcoming', 'Completed', 'Stats']) {
      await expect(page.getByRole('button', { name })).toBeVisible();
    }
    // Quick-add is gated on a configured connection. In the default isolated
    // sandbox that's always "Not connected" (see tasks-isolation.spec.ts);
    // under the fake-provider run it's quick-add. Either surface satisfies this
    // smoke check — the dedicated specs assert each precisely.
    const quickAdd = page.getByPlaceholder('Add a task…');
    const notConnected = page.getByText("Todoist isn't connected yet");
    await expect(quickAdd.or(notConnected).first()).toBeVisible();
  });

  test('tasks from the local mirror render', async ({ page }) => {
    const tasks = readSandboxVaultNotes<any>('tasks/active');
    await page.goto('/tasks');

    const open = tasks.filter((t: any) => !t.completed);
    const due = (t: any) => String(t.due?.date ?? t.due?.datetime ?? '').slice(0, 10);
    // The default Today view only shows overdue + due-today tasks, so pick one
    // of those; otherwise fall back to the earliest-due task under Upcoming.
    const today = localISO();
    const dueNow = open.find((t: any) => due(t) && due(t) <= today);
    if (dueNow) {
      await expect(page.getByText(dueNow.content).first()).toBeVisible();
      return;
    }
    const future = open.filter((t: any) => due(t)).sort((a: any, b: any) => due(a).localeCompare(due(b)))[0];
    if (future) {
      await page.getByRole('button', { name: 'Upcoming' }).click();
      await expect(page.getByText(future.content).first()).toBeVisible();
    }
  });
});

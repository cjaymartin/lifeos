import { test, expect } from '@playwright/test';
import { readSandboxJson } from './helpers';

test.describe('tasks stack', () => {
  test('renders the tasks page with quick-add', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page).toHaveTitle('Tasks — LifeOS');
    await expect(page.getByPlaceholder('Add a task…')).toBeVisible();
  });

  test('tasks from the local mirror render', async ({ page }) => {
    const data = readSandboxJson<{ tasks: any[] }>('src/content/tasks/tasks.json');
    await page.goto('/tasks');
    const open = data.tasks?.find((t: any) => !t.completed);
    if (open) {
      await expect(page.getByText(open.content).first()).toBeVisible();
    }
  });
});

// Daily-briefing agent job — definition only; all lock/spawn/log mechanics
// live in the agent-job runner module.
import { join } from 'path';
import {
  defineAgentJob,
  startAgentJob,
  runAgentJobBlocking,
  isAgentJobRunning,
} from '../../lib/jobs/runner.ts';
import { vaultDir, vaultPath } from '../../lib/content-paths.ts';

// The briefing note and the data the agent reads/writes now live in the vault;
// job plumbing (lock/log) stays in the machine store dir.
const dailyVault = vaultPath('daily');
const tasksActiveVault = vaultPath('tasks', 'active');
const deliveriesVault = vaultPath('deliveries');

export const populateDailyJob = defineAgentJob({
  name: 'populate-daily',
  dir: join(process.cwd(), 'src/content/daily'),
  lockFile: '.refresh-lock',
  // claude output lands here (bind-mounted) so failed runs are debuggable from the host
  logFile: '.refresh-log',
  prompt: '/populate-daily',
  // The vault lives outside /app — claude needs it added as a working dir or
  // the tasks-mirror reads and daily/deliveries writes below are refused.
  addDirs: [vaultDir()],
  allowedTools: [
    // Tasks come from the local mirror — now per-note vault Markdown under
    // tasks/active — via Read; no Todoist MCP tools needed anymore, the Tasks
    // stack syncs it continuously.
    'mcp__claude_ai_Google_Calendar__list_events',
    // Deliveries step (5.5) — delegated to the populate-deliveries skill
    'mcp__claude_ai_Gmail__search_threads',
    'mcp__claude_ai_Gmail__get_thread',
    'WebFetch',
    'Bash(curl *)',
    'Read(src/content/*)',
    `Read(${tasksActiveVault}/*)`,
    'Read(.claude/skills/*)',
    `Write(${dailyVault}/today.md)`,
    `Write(${deliveriesVault}/*)`,
  ],
});

/** Fire-and-forget spawn — for the API route. Returns immediately. */
export const spawnPopulateDaily = () => startAgentJob(populateDailyJob);

/** Is the daily refresh currently running? — for the status route. */
export const isPopulateDailyRunning = () => isAgentJobRunning(populateDailyJob);

/** Blocking run — for the CLI script / cron. Resolves when claude exits. */
export async function runPopulateDaily(): Promise<void> {
  if ((await runAgentJobBlocking(populateDailyJob)) === 'running') {
    console.error('[populate-daily] already running — skipping');
    process.exit(1);
  }
}

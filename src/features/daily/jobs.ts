// Daily-briefing agent job — definition only; all lock/spawn/log mechanics
// live in the agent-job runner module.
import { join } from 'path';
import {
  defineAgentJob,
  startAgentJob,
  runAgentJobBlocking,
  isAgentJobRunning,
} from '../../lib/jobs/runner.ts';

export const populateDailyJob = defineAgentJob({
  name: 'populate-daily',
  dir: join(process.cwd(), 'src/content/daily'),
  lockFile: '.refresh-lock',
  // claude output lands here (bind-mounted) so failed runs are debuggable from the host
  logFile: '.refresh-log',
  prompt: '/populate-daily',
  allowedTools: [
    // Tasks come from the local mirror (src/content/tasks/tasks.json) via Read —
    // no Todoist MCP tools needed anymore; the Tasks stack syncs it continuously.
    'mcp__claude_ai_Google_Calendar__list_events',
    // Deliveries step (5.5) — delegated to the populate-deliveries skill
    'mcp__claude_ai_Gmail__search_threads',
    'mcp__claude_ai_Gmail__get_thread',
    'WebFetch',
    'Bash(curl *)',
    'Read(src/content/*)',
    'Read(.claude/skills/*)',
    'Write(src/content/daily/today.json)',
    'Write(src/content/deliveries/deliveries.json)',
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

// Deliveries-scan agent job — definition only; all lock/spawn/log mechanics
// live in the agent-job runner module.
import { join } from 'path';
import { defineAgentJob, startAgentJob, isAgentJobRunning } from '../../lib/jobs/runner.ts';

export const populateDeliveriesJob = defineAgentJob({
  name: 'populate-deliveries',
  dir: join(process.cwd(), 'src/content/deliveries'),
  lockFile: '.refresh-lock',
  // claude output lands here (bind-mounted) so failed runs are debuggable from the host
  logFile: '.refresh-log',
  prompt: '/populate-deliveries',
  allowedTools: [
    'mcp__claude_ai_Gmail__search_threads',
    'mcp__claude_ai_Gmail__get_thread',
    'Read(src/content/*)',
    'Write(src/content/deliveries/deliveries.json)',
  ],
});

/** Fire-and-forget spawn — for the API route. Returns immediately. */
export const spawnPopulateDeliveries = () => startAgentJob(populateDeliveriesJob);

/** Is the deliveries scan currently running? — for the status route. */
export const isPopulateDeliveriesRunning = () => isAgentJobRunning(populateDeliveriesJob);

// Grocery agent jobs — definitions only; all lock/spawn/log mechanics live in
// the agent-job runner module.
import { join } from 'path';
import {
  defineAgentJob,
  startAgentJob,
  isAgentJobRunning,
  readAgentJobLog,
  type AgentJob,
} from '../../lib/jobs/runner.ts';

const DIR = join(process.cwd(), 'src/content/grocery');

export type GroceryJob = 'build-carts' | 'purchase-scan' | 'categorize';

export const groceryJobs: Record<GroceryJob, AgentJob> = {
  // build-carts streams JSONL events to its log (--output-format stream-json)
  // so the UI can show live progress; parsed by /api/grocery/build-progress
  'build-carts': defineAgentJob({
    name: 'grocery:build-carts',
    dir: DIR,
    lockFile: '.build-lock',
    logFile: '.build-log',
    prompt: '/build-carts',
    stream: true,
    allowedTools: [
      'WebSearch',
      'WebFetch',
      // Past Walmart order emails → reorder exact products instead of guessing
      'mcp__claude_ai_Gmail__search_threads',
      'mcp__claude_ai_Gmail__get_thread',
      'Read(src/content/grocery/*)',
      'Write(src/content/grocery/carts.json)',
      'Write(src/content/grocery/product-map.json)',
    ],
  }),
  'purchase-scan': defineAgentJob({
    name: 'grocery:purchase-scan',
    dir: DIR,
    lockFile: '.scan-lock',
    logFile: '.scan-log',
    prompt: '/grocery-purchase-scan',
    allowedTools: [
      'mcp__claude_ai_Gmail__search_threads',
      'mcp__claude_ai_Gmail__get_thread',
      'Read(src/content/grocery/*)',
      'Write(src/content/grocery/.scan-results.json)',
    ],
  }),
  categorize: defineAgentJob({
    name: 'grocery:categorize',
    dir: DIR,
    lockFile: '.categorize-lock',
    logFile: '.categorize-log',
    prompt: '/grocery-categorize',
    allowedTools: [
      'Read(src/content/grocery/*)',
      'Write(src/content/grocery/.categorized.json)',
    ],
  }),
};

export const isJobRunning = (job: GroceryJob) => isAgentJobRunning(groceryJobs[job]);

/** Fire-and-forget spawn — for the API routes. Returns immediately. */
export const spawnGroceryJob = (job: GroceryJob) => startAgentJob(groceryJobs[job]);

/** The build-carts stream-json log so far — for the progress route. */
export const readBuildLog = () => readAgentJobLog(groceryJobs['build-carts']);

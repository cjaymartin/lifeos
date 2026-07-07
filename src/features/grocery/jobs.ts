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
import { vaultDir, vaultPath } from '../../lib/content-paths.ts';

const DIR = join(process.cwd(), 'src/content/grocery');
// The grocery list + staples now live as Markdown notes in the vault; agents
// read them from there. They still write their dot-file output into DIR (the
// machine store), which ops.ts reconciles back into the list.
const VAULT_LIST_READ = `Read(${vaultPath('grocery', 'list')}/*)`;
const VAULT_STAPLES_READ = `Read(${vaultPath('grocery', 'staples')}/*)`;
// The vault is outside /app — every job that reads the list/staples needs it
// added as a working dir, or those reads are silently refused.
const VAULT_DIRS = [vaultDir()];

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
    addDirs: VAULT_DIRS,
    allowedTools: [
      'WebSearch',
      'WebFetch',
      // No Gmail — cart-building reorders from the product memory (grown by
      // confirmed purchases + order-history sync), web search as fallback.
      'Read(src/content/grocery/*)',
      VAULT_LIST_READ,
      VAULT_STAPLES_READ,
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
    addDirs: VAULT_DIRS,
    allowedTools: [
      'mcp__claude_ai_Gmail__search_threads',
      'mcp__claude_ai_Gmail__get_thread',
      'Read(src/content/grocery/*)',
      VAULT_LIST_READ,
      VAULT_STAPLES_READ,
      'Write(src/content/grocery/.scan-results.json)',
    ],
  }),
  categorize: defineAgentJob({
    name: 'grocery:categorize',
    dir: DIR,
    lockFile: '.categorize-lock',
    logFile: '.categorize-log',
    prompt: '/grocery-categorize',
    addDirs: VAULT_DIRS,
    allowedTools: [
      'Read(src/content/grocery/*)',
      VAULT_LIST_READ,
      'Write(src/content/grocery/.categorized.json)',
    ],
  }),
};

export const isJobRunning = (job: GroceryJob) => isAgentJobRunning(groceryJobs[job]);

/** Fire-and-forget spawn — for the API routes. Returns immediately. */
export const spawnGroceryJob = (job: GroceryJob) => startAgentJob(groceryJobs[job]);

/** The build-carts stream-json log so far — for the progress route. */
export const readBuildLog = () => readAgentJobLog(groceryJobs['build-carts']);

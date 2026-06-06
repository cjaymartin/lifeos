import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  defineAgentJob,
  startAgentJob,
  isAgentJobRunning,
  readAgentJobLog,
  runAgentJobBlocking,
  runAgentCapture,
  defineJobLock,
  isLockFresh,
  startLockedTask,
  parseStreamEvents,
} from '@/lib/jobs/runner';

let dir: string;
let shimDir: string;
const realPath = process.env.PATH!;

/** Install a fake `claude` binary for this test. */
function shimClaude(script: string) {
  writeFileSync(join(shimDir, 'claude'), `#!/bin/sh\n${script}\n`, { mode: 0o755 });
}

function job(overrides: Partial<Parameters<typeof defineAgentJob>[0]> = {}) {
  return defineAgentJob({
    name: 'test-job',
    dir,
    lockFile: '.test-lock',
    logFile: '.test-log',
    prompt: '/test-skill',
    allowedTools: ['WebSearch', 'Read(src/content/*)'],
    ...overrides,
  });
}

async function waitFor(cond: () => boolean, ms = 3000): Promise<void> {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 25));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lifeos-jobs-'));
  shimDir = mkdtempSync(join(tmpdir(), 'lifeos-shim-'));
  process.env.PATH = `${shimDir}:${realPath}`;
});

afterEach(() => {
  process.env.PATH = realPath;
  rmSync(dir, { recursive: true, force: true });
  rmSync(shimDir, { recursive: true, force: true });
});

describe('agent job lifecycle', () => {
  it('is not running when no lock exists', async () => {
    expect(await isAgentJobRunning(job())).toBe(false);
  });

  it('start acquires the lock; a second start reports running', async () => {
    shimClaude('sleep 1');
    const j = job();
    expect(await startAgentJob(j)).toBe('started');
    expect(await isAgentJobRunning(j)).toBe(true);
    expect(await startAgentJob(j)).toBe('running');
  });

  it('releases the lock when the agent exits', async () => {
    shimClaude('exit 0');
    const j = job();
    await startAgentJob(j);
    await waitFor(() => !existsSync(join(dir, '.test-lock')));
    expect(await isAgentJobRunning(j)).toBe(false);
  });

  it('treats a stale lock as not running and allows restart', async () => {
    const j = job();
    writeFileSync(join(dir, '.test-lock'), String(Date.now() - 10 * 60 * 1000));
    expect(await isAgentJobRunning(j)).toBe(false);
    shimClaude('exit 0');
    expect(await startAgentJob(j)).toBe('started');
  });

  it('redirects agent output to the log file and exposes it via readAgentJobLog', async () => {
    shimClaude('echo "agent output line"');
    const j = job();
    await startAgentJob(j);
    await waitFor(() => existsSync(join(dir, '.test-log')));
    await waitFor(() => readFileSync(join(dir, '.test-log'), 'utf-8').includes('agent output line'));
    expect(await readAgentJobLog(j)).toContain('agent output line');
  });

  it('constructs headless claude args: skill, acceptEdits, space-joined allowedTools', async () => {
    shimClaude('echo "ARGS:$@"');
    const j = job();
    await startAgentJob(j);
    await waitFor(() => existsSync(join(dir, '.test-log')));
    await waitFor(() => readFileSync(join(dir, '.test-log'), 'utf-8').includes('ARGS:'));
    const log = readFileSync(join(dir, '.test-log'), 'utf-8');
    expect(log).toContain('-p /test-skill');
    expect(log).toContain('--permission-mode acceptEdits');
    expect(log).toContain('--allowedTools WebSearch Read(src/content/*)');
    expect(log).not.toContain('stream-json');
  });

  it('stream jobs add --output-format stream-json --verbose', async () => {
    shimClaude('echo "ARGS:$@"');
    const j = job({ stream: true });
    await startAgentJob(j);
    await waitFor(() => existsSync(join(dir, '.test-log')));
    await waitFor(() => readFileSync(join(dir, '.test-log'), 'utf-8').includes('ARGS:'));
    const log = readFileSync(join(dir, '.test-log'), 'utf-8');
    expect(log).toContain('--output-format stream-json --verbose');
  });

  it('runAgentJobBlocking resolves on success and releases the lock', async () => {
    shimClaude('exit 0');
    const j = job();
    await expect(runAgentJobBlocking(j)).resolves.toBe('completed');
    expect(existsSync(join(dir, '.test-lock'))).toBe(false);
  });

  it('runAgentJobBlocking returns "running" without spawning when locked', async () => {
    const j = job();
    writeFileSync(join(dir, '.test-lock'), String(Date.now()));
    await expect(runAgentJobBlocking(j)).resolves.toBe('running');
  });

  it('runAgentJobBlocking rejects on non-zero exit but still releases the lock', async () => {
    shimClaude('exit 3');
    const j = job();
    await expect(runAgentJobBlocking(j)).rejects.toThrow(/exited with code 3/);
    expect(existsSync(join(dir, '.test-lock'))).toBe(false);
  });
});

describe('runAgentCapture', () => {
  it('captures stdout', async () => {
    shimClaude('echo "hello from the agent"');
    const out = await runAgentCapture({ prompt: 'say hello', allowedTools: ['WebSearch'] });
    expect(out).toBe('hello from the agent');
  });

  it('rejects on timeout', async () => {
    shimClaude('sleep 5');
    await expect(
      runAgentCapture({ prompt: 'slow', allowedTools: [], timeoutMs: 150 }),
    ).rejects.toThrow(/timeout/);
  });

  it('tees output to a log file when given one', async () => {
    shimClaude('echo "captured and logged"');
    const logPath = join(dir, '.capture-log');
    const out = await runAgentCapture({ prompt: 'x', allowedTools: [], logPath });
    expect(out).toContain('captured and logged');
    await waitFor(() => existsSync(logPath) && readFileSync(logPath, 'utf-8').includes('captured and logged'));
  });
});

describe('locked in-process tasks', () => {
  it('runs the task and releases the lock afterwards', async () => {
    const lock = defineJobLock(join(dir, '.task-lock'));
    let ran = false;
    const status = await startLockedTask(lock, async () => {
      expect(await isLockFresh(lock)).toBe(true);
      ran = true;
    });
    expect(status).toBe('started');
    await waitFor(() => ran);
    await waitFor(() => !existsSync(join(dir, '.task-lock')));
  });

  it('reports running while a task holds the lock', async () => {
    const lock = defineJobLock(join(dir, '.task-lock'));
    let release: () => void;
    const gate = new Promise<void>((r) => (release = r));
    await startLockedTask(lock, () => gate);
    expect(await startLockedTask(lock, async () => {})).toBe('running');
    release!();
    await waitFor(() => !existsSync(join(dir, '.task-lock')));
  });

  it('releases the lock even when the task throws', async () => {
    const lock = defineJobLock(join(dir, '.task-lock'));
    await startLockedTask(lock, async () => {
      throw new Error('boom');
    });
    await waitFor(() => !existsSync(join(dir, '.task-lock')));
  });
});

describe('parseStreamEvents', () => {
  const sample = [
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'cheddar' } }] } }),
    JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Looking at past orders\nmore detail' }] } }),
    'not json — ignored',
    JSON.stringify({ type: 'result', subtype: 'success', is_error: false }),
  ].join('\n');

  it('parses tool, note, and result events with the default labeler', () => {
    const { events, done, ok } = parseStreamEvents(sample);
    expect(done).toBe(true);
    expect(ok).toBe(true);
    expect(events.map((e) => e.t)).toEqual(['tool', 'note', 'result']);
    expect(events[1].label).toBe('Looking at past orders');
  });

  it('honours a custom tool labeler and result labels', () => {
    const { events } = parseStreamEvents(sample, {
      toolLabel: (name, input) => `custom:${name}:${input?.query}`,
      resultLabels: { ok: 'Cart ready', fail: 'Build failed' },
    });
    expect(events[0].label).toBe('custom:WebSearch:cheddar');
    expect(events[2].label).toBe('Cart ready');
  });

  it('flags failed runs', () => {
    const failed = JSON.stringify({ type: 'result', subtype: 'error', is_error: true });
    const { done, ok, events } = parseStreamEvents(failed, { resultLabels: { ok: 'x', fail: 'Build failed' } });
    expect(done).toBe(true);
    expect(ok).toBe(false);
    expect(events.at(-1)!.label).toBe('Build failed');
  });

  it('caps the feed at 60 events', () => {
    const lines = Array.from({ length: 80 }, (_, i) =>
      JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: `f${i}` } }] } }),
    ).join('\n');
    expect(parseStreamEvents(lines).events).toHaveLength(60);
  });
});

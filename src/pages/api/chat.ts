import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';

async function loadStackContent(stackId: string): Promise<string> {
  const dir = join(process.cwd(), 'src/content', stackId);
  try {
    const entries = await readdir(dir);
    const files = entries.filter(f => !f.startsWith('.') && f !== '.gitkeep' && (f.endsWith('.md') || f.endsWith('.json')));
    if (files.length === 0) return '(no content yet)';
    const contents = await Promise.all(
      files.map(async f => {
        const raw = await readFile(join(dir, f), 'utf-8');
        return `### ${f}\n${raw}`;
      })
    );
    return contents.join('\n\n---\n\n');
  } catch {
    return '(no content yet)';
  }
}

function runClaude(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const proc = spawn(
      'claude',
      [
        '-p', prompt,
        '--allowedTools', 'Write',
        '--output-format', 'text',
      ],
      {
        cwd: process.cwd(),
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
      }
    );

    proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString()));
    proc.on('close', code => {
      if (code === 0 || chunks.length > 0) resolve(chunks.join('').trim());
      else reject(new Error(`claude exited with code ${code}`));
    });
    proc.on('error', reject);

    // 60-second timeout
    setTimeout(() => { proc.kill(); reject(new Error('timeout')); }, 60_000);
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  let body: { message?: string; stackId?: string; stackLabel?: string; history?: { role: string; content: string }[] };
  try { body = await request.json(); } catch {
    return new Response('Bad request', { status: 400 });
  }

  const { message, stackId, stackLabel, history = [] } = body;
  if (!message) return new Response('Missing message', { status: 400 });
  if (!stackId) return new Response('Missing stackId', { status: 400 });
  if (!stackLabel) return new Response('Missing stackLabel', { status: 400 });

  const stackContent = await loadStackContent(stackId);

  const historyText = history.slice(0, -1)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const systemPrompt = `You are the ${stackLabel} assistant for LifeOS, a personal dashboard. You ONLY answer questions about ${stackLabel}. You have access to all ${stackLabel} content below. If asked about anything unrelated to ${stackLabel}, politely say you're scoped to ${stackLabel} only.

Content:
${stackContent}`;

  const fullPrompt = `${systemPrompt}

${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}User: ${message}`;

  try {
    const reply = await runClaude(fullPrompt);
    return new Response(JSON.stringify({ reply }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ reply: `Sorry, I couldn't process that. (${msg})` }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

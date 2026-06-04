import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';
import { stacks, CHAT_BASE_TOOLS } from '@/lib/stacks';

export interface Proposal {
  summary: string;
  files: { path: string; description: string }[];
}

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

function parseProposal(text: string): { cleanText: string; proposal?: Proposal } {
  const marker = 'WRITE_PROPOSAL:';
  const idx = text.indexOf(marker);
  if (idx === -1) return { cleanText: text };

  const jsonStr = text.slice(idx + marker.length).trim();
  if (!jsonStr.startsWith('{')) return { cleanText: text };

  // Walk to matching closing brace
  let depth = 0, end = 0;
  for (let i = 0; i < jsonStr.length; i++) {
    if (jsonStr[i] === '{') depth++;
    else if (jsonStr[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
  }
  if (!end) return { cleanText: text };

  try {
    const proposal = JSON.parse(jsonStr.slice(0, end)) as Proposal;
    return { cleanText: text.slice(0, idx).trim(), proposal };
  } catch {
    return { cleanText: text };
  }
}

function runClaude(prompt: string, tools: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    const proc = spawn(
      'claude',
      ['-p', prompt, '--allowedTools', tools.join(','), '--output-format', 'text'],
      { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } }
    );
    proc.stdout.on('data', (d: Buffer) => chunks.push(d.toString()));
    proc.on('close', code => {
      if (code === 0 || chunks.length > 0) resolve(chunks.join('').trim());
      else reject(new Error(`claude exited with code ${code}`));
    });
    proc.on('error', reject);
    setTimeout(() => { proc.kill(); reject(new Error('timeout after 5 minutes')); }, 300_000);
  });
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifySession(cookies.get('lifeos_session')?.value, import.meta.env.SESSION_SECRET ?? ''))
    return new Response('Unauthorized', { status: 401 });

  let body: {
    message?: string; stackId?: string; stackLabel?: string;
    currentPath?: string; pageTitle?: string;
    history?: { role: string; content: string }[];
    approved?: boolean;
  };
  try { body = await request.json(); } catch {
    return new Response('Bad request', { status: 400 });
  }

  const { message, stackId, stackLabel, currentPath, pageTitle, history = [], approved = false } = body;
  if (!message) return new Response('Missing message', { status: 400 });
  if (!stackId)  return new Response('Missing stackId', { status: 400 });
  if (!stackLabel) return new Response('Missing stackLabel', { status: 400 });

  const stack = stacks.find(s => s.id === stackId);
  const allTools = [...new Set([...CHAT_BASE_TOOLS, ...(stack?.chatTools ?? [])])];
  // Phase 1: no writes — Claude proposes first. Phase 2: all tools after user approval.
  const tools = approved ? allTools : allTools.filter(t => t !== 'Write');

  const stackContent = await loadStackContent(stackId);
  const contentDir = join(process.cwd(), 'src/content', stackId);

  const historyText = history.slice(0, -1)
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const pageContext = currentPath && currentPath !== `/${stackId}`
    ? `\nThe user is currently viewing: ${pageTitle ? `${pageTitle} (${currentPath})` : currentPath}`
    : '';

  const writeGuidance = approved
    ? `The user has reviewed and approved the proposed changes. Execute all file writes now — do not ask for further confirmation.`
    : `IMPORTANT — file write flow:
If you need to create or modify files, do NOT write them yet.
Instead: explain what you'd like to do in plain, friendly language (no file paths or technical jargon for the user), then end your message with exactly this on its own line:
WRITE_PROPOSAL: {"summary":"<one sentence plain English>","files":[{"path":"<full file path>","description":"<friendly description of what changes>"}]}
The user will see an Approve / Cancel card and decide. You will be called again to execute if approved.`;

  const systemPrompt = `You are the ${stackLabel} assistant for LifeOS, a personal dashboard. You ONLY answer questions and perform actions related to ${stackLabel}. If asked about anything unrelated to ${stackLabel}, politely say you're scoped to ${stackLabel} only.${pageContext}

Capabilities:
- Search the web (WebSearch, WebFetch) for information, images, recipes, etc.
- Read files in: ${contentDir}
${approved ? `- Write files in: ${contentDir}` : '- File writes require user approval (see below)'}
- Keep responses concise and friendly.

${writeGuidance}

Current ${stackLabel} content:
${stackContent}`;

  const fullPrompt = `${systemPrompt}

${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}User: ${message}

Today's date: ${new Date().toISOString().slice(0, 10)}`;

  try {
    const raw = await runClaude(fullPrompt, tools);

    if (!approved) {
      const { cleanText, proposal } = parseProposal(raw);
      if (proposal) {
        return new Response(JSON.stringify({ type: 'proposal', reply: cleanText, rawReply: raw, proposal }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    return new Response(JSON.stringify({ reply: raw }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return new Response(JSON.stringify({ reply: `Sorry, I couldn't process that. (${msg})` }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

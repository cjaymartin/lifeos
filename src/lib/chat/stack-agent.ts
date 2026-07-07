// ── Stack chat agent ─────────────────────────────────────────────────────────
//
// One definition of a feature stack's chat turn: build the scoped system prompt,
// resolve the tool allowlist, spawn the agent, and parse a write-proposal out of
// the reply. Shared by the single-stack route (/api/chat) and the dashboard
// orchestrator (which delegates to per-feature page-agents). Extracted from
// api/chat.ts so the two never drift.

import { join } from 'path';
import { runAgentCapture } from '@/lib/jobs/runner';
import { vaultDir } from '@/lib/content-paths';
import { loadStackContent } from '@/lib/content-store';
import { stacks, CHAT_BASE_TOOLS, loadChatGuide } from '@/features';

export interface Proposal {
  summary: string;
  files: { path: string; description: string }[];
}

export interface StackChatOpts {
  stackId: string;
  stackLabel: string;
  message: string;
  history?: { role: string; content: string }[];
  approved?: boolean;
  currentPath?: string;
  pageTitle?: string;
  /** Replace the loaded content dump (the dashboard target injects daily + widgets). */
  contentOverride?: string;
  /** Replace the feature's chat.md guide. */
  chatGuideOverride?: string;
  /** Path shown to the agent as its read/write dir; defaults to src/content/<stackId>. */
  contentDir?: string;
}

export interface StackChatResult {
  reply: string;
  rawReply: string;
  proposal?: Proposal;
}

/** Pull a trailing WRITE_PROPOSAL:{…} marker out of an agent reply, if present. */
export function parseProposal(text: string): { cleanText: string; proposal?: Proposal } {
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

/** The tool allowlist for a stack chat — writes are withheld until approval. */
export function resolveStackTools(stackId: string, approved: boolean): string[] {
  const stack = stacks.find(s => s.id === stackId);
  const allTools = [...new Set([...CHAT_BASE_TOOLS, ...(stack?.chatTools ?? [])])];
  // Phase 1: no writes — the agent proposes first. Phase 2: all tools after approval.
  return approved ? allTools : allTools.filter(t => t !== 'Write' && t !== 'Edit');
}

/** Assemble the full scoped prompt for one stack chat turn. */
export async function buildStackPrompt(opts: StackChatOpts): Promise<string> {
  const { stackId, stackLabel, message, history = [], approved = false, currentPath, pageTitle } = opts;

  const [stackContent, chatGuide] = await Promise.all([
    opts.contentOverride !== undefined ? Promise.resolve(opts.contentOverride) : loadStackContent(stackId),
    opts.chatGuideOverride !== undefined ? Promise.resolve(opts.chatGuideOverride) : loadChatGuide(stackId),
  ]);
  const contentDir = opts.contentDir ?? join(process.cwd(), 'src/content', stackId);

  const historyText = history
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const pageContext = currentPath && currentPath !== `/${stackId}`
    ? `\nThe user is currently viewing: ${pageTitle ? `${pageTitle} (${currentPath})` : currentPath}`
    : '';

  const writeGuidance = approved
    ? `The user has reviewed and approved the proposed changes. Execute all file writes now (Write or Edit) — do not ask for further confirmation.
CRITICAL — report honestly: if any Write/Edit tool call errors or is permission-denied, tell the user plainly that the change did NOT happen and which file failed. NEVER describe a change as done unless the tool call actually succeeded.`
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
${chatGuide ? `\nStack-specific guidance:\n${chatGuide}\n` : ''}
Current ${stackLabel} content:
${stackContent}`;

  return `${systemPrompt}

${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}User: ${message}

Today's date: ${new Date().toISOString().slice(0, 10)}`;
}

/** Run one stack chat turn end-to-end: prompt → agent → parsed result. */
export async function runStackChat(opts: StackChatOpts): Promise<StackChatResult> {
  const tools = resolveStackTools(opts.stackId, opts.approved ?? false);
  const prompt = await buildStackPrompt(opts);
  // Feature content (grocery, recipes, …) now lives in the vault outside /app;
  // add it so the agent's vault Read/Write isn't silently refused.
  const raw = await runAgentCapture({ prompt, allowedTools: tools, addDirs: [vaultDir()] });

  if (!opts.approved) {
    const { cleanText, proposal } = parseProposal(raw);
    if (proposal) return { reply: cleanText, rawReply: raw, proposal };
  }
  return { reply: raw, rawReply: raw };
}

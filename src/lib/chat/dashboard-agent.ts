// ── Dashboard chat orchestrator ──────────────────────────────────────────────
//
// The dashboard assistant speaks to every feature, hand-off style:
//   1. route   — pick which area(s) the question touches (agent + heuristic fallback)
//   2. delegate — ask each area's own page-agent (its content + chat.md guardrails),
//                 in parallel, under the existing propose→approve contract
//   3. synthesize — merge the area answers into one reply (with web search)
//
// Cross-feature writes survive approval faithfully: each proposing page-agent's
// own plan (rawReply) is packed into a HANDOFF_CONTEXT blob on the synthesis
// rawReply, which ChatSidebar echoes back on approval — so phase 2 replays exactly
// what was proposed, with no re-routing drift.

import { join } from 'path';
import { readFile } from 'fs/promises';
import { runAgentCapture } from '@/lib/jobs/runner';
import { loadStackContent } from '@/lib/content-store';
import { vaultPath } from '@/lib/content-paths';
import { stacks, loadChatGuide } from '@/features';
import { runStackChat, type Proposal, type StackChatResult } from './stack-agent';

export interface HistoryItem { role: string; content: string }

export interface DashboardChatResponse {
  type?: 'proposal';
  reply: string;
  rawReply?: string;
  proposal?: Proposal;
}

interface Target { id: string; label: string; description: string }
interface TargetAnswer { id: string; label: string; result: StackChatResult }

const HANDOFF_MARKER = 'HANDOFF_CONTEXT:';
const WEB_TOOLS = ['WebSearch', 'WebFetch'];

/** The dashboard itself, treated as a page: today's briefing + the widget grid. */
const DASHBOARD_TARGET: Target = {
  id: 'dashboard',
  label: 'Dashboard',
  description: "today's briefing — weather, calendar events, tasks due, deliveries, trash/recycling day, and the morning summary",
};

/** Routable areas: every sidebar stack plus the dashboard briefing. */
export function listTargets(): Target[] {
  return [
    ...stacks.map(s => ({ id: s.id, label: s.label, description: s.description ?? s.label })),
    DASHBOARD_TARGET,
  ];
}

const labelFor = (id: string): string =>
  listTargets().find(t => t.id === id)?.label ?? id;

/* ── Routing ──────────────────────────────────────────────────────────────── */

const KEYWORDS: Record<string, string[]> = {
  grocery: ['grocery', 'groceries', 'milk', 'buy', 'shop', 'cart', 'staple', 'pantry', 'fridge', 'ingredient', 'low on'],
  recipes: ['recipe', 'cook', 'meal', 'dinner', 'lunch', 'breakfast', 'bake', 'dish', 'eat'],
  tasks: ['task', 'todo', 'to-do', 'to do', 'todoist', 'reminder', 'due'],
  deliveries: ['delivery', 'deliveries', 'package', 'shipment', 'shipping', 'parcel', 'arriv', 'tracking'],
  dashboard: ['weather', 'rain', 'temperature', 'forecast', 'calendar', 'event', 'meeting', 'trash', 'recycling', 'today', 'my day', 'schedule', 'briefing'],
};

/** Cheap, deterministic keyword routing — the fallback when the router agent
 *  returns nothing parseable (and what drives the shimmed test agent). */
export function heuristicRoute(message: string): string[] {
  const m = message.toLowerCase();
  const known = new Set(listTargets().map(t => t.id));
  const hits = new Set<string>();
  for (const [id, words] of Object.entries(KEYWORDS)) {
    if (known.has(id) && words.some(w => m.includes(w))) hits.add(id);
  }
  return [...hits];
}

/** Extract a {"targets":[…]} array from a router reply; null if unparseable. */
function parseTargets(raw: string, known: string[]): string[] | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) return null;
  try {
    const obj = JSON.parse(raw.slice(start, end + 1));
    if (!Array.isArray(obj.targets)) return null;
    return obj.targets.filter((t: unknown): t is string => typeof t === 'string' && known.includes(t));
  } catch {
    return null;
  }
}

/** Decide which area(s) a question needs. Router agent first, heuristic fallback. */
export async function routeQuestion(message: string, history: HistoryItem[] = []): Promise<string[]> {
  const targets = listTargets();
  const known = targets.map(t => t.id);
  const list = targets.map(t => `- ${t.id}: ${t.description}`).join('\n');
  const historyText = history.length
    ? `Recent conversation:\n${history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}\n\n`
    : '';
  const prompt = `You route questions for a personal dashboard assistant. Pick the minimal set of areas needed to answer the user's question. Available areas:
${list}

Reply with ONLY a JSON object: {"targets":["id", ...]}. Use {"targets":[]} when the question is general knowledge or only needs a web search.

${historyText}User question: ${message}`;

  try {
    const raw = await runAgentCapture({ prompt, allowedTools: [] });
    const parsed = parseTargets(raw, known);
    if (parsed !== null) return parsed;
  } catch {
    // fall through to heuristic
  }
  return heuristicRoute(message);
}

/* ── Delegation ───────────────────────────────────────────────────────────── */

/** Load the dashboard's own content: today's briefing + the widget registry. */
async function loadDashboardContent(): Promise<string> {
  const [daily, briefing, widgets] = await Promise.all([
    // Machine-store daily reference data (recycling schedule, etc.)
    loadStackContent('daily'),
    // The morning briefing now lives as a vault note.
    readFile(vaultPath('daily', 'today.md'), 'utf-8').catch(() => ''),
    readFile(join(process.cwd(), 'src/content/widgets/registry.json'), 'utf-8').catch(() => ''),
  ]);
  const parts = [briefing ? `### daily/today.md\n${briefing}` : '', daily].filter(Boolean);
  const content = parts.join('\n\n---\n\n');
  return widgets ? `${content}\n\n---\n\n### widgets/registry.json\n${widgets}` : content;
}

/** Run one area's page-agent. Returns null for an unknown target id. */
async function runTarget(
  id: string,
  message: string,
  history: HistoryItem[],
  approved: boolean,
): Promise<TargetAnswer | null> {
  if (id === 'dashboard') {
    const [contentOverride, chatGuideOverride] = await Promise.all([
      loadDashboardContent(),
      loadChatGuide('daily'),
    ]);
    const result = await runStackChat({
      stackId: 'dashboard', stackLabel: 'Dashboard', message, history, approved,
      contentOverride, chatGuideOverride,
      contentDir: vaultPath('daily'),
    });
    return { id, label: 'Dashboard', result };
  }

  const stack = stacks.find(s => s.id === id);
  if (!stack) return null;
  const result = await runStackChat({ stackId: id, stackLabel: stack.label, message, history, approved });
  return { id, label: stack.label, result };
}

/* ── Synthesis ────────────────────────────────────────────────────────────── */

async function synthesize(message: string, history: HistoryItem[], parts: { label: string; reply: string }[]): Promise<string> {
  const historyText = history.length
    ? `Recent conversation:\n${history.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n')}\n\n`
    : '';

  if (parts.length === 0) {
    // General / web question — answer directly.
    const prompt = `You are the assistant on a personal dashboard called LifeOS. Answer the user's question concisely and helpfully. Use WebSearch / WebFetch when you need current or external information.

${historyText}User: ${message}`;
    return runAgentCapture({ prompt, allowedTools: WEB_TOOLS });
  }

  const consulted = parts.map(p => `### ${p.label}\n${p.reply || '(no answer)'}`).join('\n\n');
  const prompt = `You are the assistant on a personal dashboard called LifeOS. The user's question spans one or more areas of their dashboard. The relevant area assistants have answered below. Compose ONE concise, friendly reply that combines their answers into a coherent response for the user. Do NOT mention this internal hand-off or that you "consulted" anything — just answer. Use WebSearch / WebFetch if external information would help.

User question: ${message}

${historyText}Area answers:
${consulted}`;
  return runAgentCapture({ prompt, allowedTools: WEB_TOOLS });
}

async function synthesizeConfirmation(message: string, confirmations: { label: string; reply: string }[]): Promise<string> {
  const parts = confirmations.map(c => `### ${c.label}\n${c.reply || '(done)'}`).join('\n\n');
  const prompt = `You are the assistant on a personal dashboard called LifeOS. The user approved changes across one or more areas, and each area assistant has now applied its change and reported back below. Give the user ONE short, friendly confirmation of what was done. If any area reported a failure or that a change did NOT happen, surface that honestly rather than claiming success.

User's approval: ${message}

Area reports:
${parts}`;
  return runAgentCapture({ prompt, allowedTools: [] });
}

/* ── Hand-off context (faithful approval replay) ──────────────────────────── */

interface HandoffEntry { id: string; rawReply: string }

const encodeHandoff = (entries: HandoffEntry[]): string =>
  `${HANDOFF_MARKER}${JSON.stringify(entries)}`;

/** Find the most recent assistant turn carrying a HANDOFF_CONTEXT blob. */
function decodeHandoff(history: HistoryItem[]): HandoffEntry[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const idx = history[i].content.indexOf(HANDOFF_MARKER);
    if (idx === -1) continue;
    try {
      const parsed = JSON.parse(history[i].content.slice(idx + HANDOFF_MARKER.length).trim());
      if (Array.isArray(parsed)) return parsed.filter(e => e && typeof e.id === 'string' && typeof e.rawReply === 'string');
    } catch {
      return [];
    }
  }
  return [];
}

function mergeProposals(proposals: Proposal[]): Proposal {
  return {
    summary: proposals.map(p => p.summary).join(' '),
    files: proposals.flatMap(p => p.files),
  };
}

/* ── Entry point ──────────────────────────────────────────────────────────── */

export async function runDashboardChat(opts: {
  message: string;
  history?: HistoryItem[];
  approved?: boolean;
}): Promise<DashboardChatResponse> {
  const { message, approved = false } = opts;
  // The client echoes the current message as the last history entry too — drop it.
  const history = (opts.history ?? []).slice(0, -1);

  return approved ? executeApproved(message, history) : proposePhase(message, history);
}

async function proposePhase(message: string, history: HistoryItem[]): Promise<DashboardChatResponse> {
  const targetIds = await routeQuestion(message, history);
  const answers = (await Promise.all(targetIds.map(id => runTarget(id, message, history, false))))
    .filter((a): a is TargetAnswer => a !== null);

  const reply = await synthesize(message, history, answers.map(a => ({ label: a.label, reply: a.result.reply })));

  const proposing = answers.filter(a => a.result.proposal);
  if (proposing.length === 0) return { reply };

  const proposal = mergeProposals(proposing.map(a => a.result.proposal!));
  const handoff = encodeHandoff(proposing.map(a => ({ id: a.id, rawReply: a.result.rawReply })));
  return { type: 'proposal', reply, rawReply: `${reply}\n${handoff}`, proposal };
}

async function executeApproved(message: string, history: HistoryItem[]): Promise<DashboardChatResponse> {
  const handoff = decodeHandoff(history);
  if (handoff.length === 0) {
    // Nothing was proposed (or the context was lost) — answer plainly.
    return { reply: await synthesize(message, history, []) };
  }

  const reports = (await Promise.all(handoff.map(h =>
    // Replay each area's own plan: its rawReply becomes the assistant turn it executes against.
    runTarget(h.id, message, [...history, { role: 'assistant', content: h.rawReply }], true),
  ))).filter((a): a is TargetAnswer => a !== null);

  const reply = await synthesizeConfirmation(message, reports.map(r => ({ label: r.label, reply: r.result.reply })));
  return { reply };
}

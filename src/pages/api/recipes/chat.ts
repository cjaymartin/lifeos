import type { APIRoute } from 'astro';
import { requireSession } from '@/lib/auth';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { vaultDir, vaultPath } from '@/lib/content-paths';
import { runAgentCapture } from '@/lib/jobs/runner';

const RECIPES_DIR = vaultPath('recipes');

async function loadRecipes(): Promise<string> {
  try {
    const files = (await readdir(RECIPES_DIR)).filter(f => f.endsWith('.md'));
    const contents = await Promise.all(
      files.map(async f => {
        const raw = await readFile(join(RECIPES_DIR, f), 'utf-8');
        return `### ${f.replace('.md', '')}\n${raw}`;
      })
    );
    return contents.join('\n\n---\n\n');
  } catch {
    return '(no recipes found)';
  }
}

export const POST: APIRoute = async ({ request, cookies }) => {
  const denied = requireSession(cookies);
  if (denied) return denied;

  let body: { message?: string; slug?: string; history?: { role: string; content: string }[] };
  try { body = await request.json(); } catch {
    return new Response('Bad request', { status: 400 });
  }

  const { message, slug, history = [] } = body;
  if (!message) return new Response('Missing message', { status: 400 });

  const allRecipes = await loadRecipes();
  const focusNote = slug
    ? `The user is currently viewing the recipe with slug "${slug}". Refer to it by name when relevant.`
    : '';

  const historyText = history.slice(0, -1) // exclude the current message which is last
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n');

  const prompt = `You are a knowledgeable recipe assistant embedded in a personal recipe dashboard called LifeOS.

The user's recipe collection:
${allRecipes}

${focusNote}

${historyText ? `Conversation so far:\n${historyText}\n\n` : ''}User: ${message}

Instructions:
- Answer conversationally and helpfully about any recipe topic.
- For scaling or unit conversion questions, show the math clearly.
- If the user asks to add a new recipe, create the file at ${RECIPES_DIR}/<slug>.md using this exact frontmatter format:
  ---
  title: "<Title>"
  slug: "<slug>"
  source: "<URL or 'original'>"
  servings: <number>
  prepTime: "<e.g. 15 minutes>"
  cookTime: "<e.g. 30 minutes>"
  tags: ["tag1", "tag2"]
  dateAdded: "<YYYY-MM-DD>"
  ---
  ## Ingredients
  - <amount> <unit> <ingredient>
  ...
  ## Instructions
  1. Step one.
  ...
  ## Notes
  Any tips.
- If the user asks to edit an existing recipe, write the updated file to the same path.
- After writing a file, tell the user it has been saved and they can refresh to see it.
- Today's date is ${new Date().toISOString().slice(0, 10)}.
- Keep responses concise and practical.`;

  try {
    // Edit included — models reach for Edit on existing files, and a denied
    // edit headless leads to falsely-claimed success
    const reply = await runAgentCapture({
      prompt,
      allowedTools: ['Write', 'Edit', 'Read'],
      timeoutMs: 60_000,
      // Recipes live in the vault (outside /app) — without this the Write/Edit
      // to RECIPES_DIR is silently refused.
      addDirs: [vaultDir()],
    });
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

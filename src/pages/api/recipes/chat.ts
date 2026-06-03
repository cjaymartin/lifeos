import type { APIRoute } from 'astro';
import { verifySession } from '@/lib/auth';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';

const RECIPES_DIR = join(process.cwd(), 'src/content/recipes');

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
- If the user asks to add a new recipe, create the file at src/content/recipes/<slug>.md using this exact frontmatter format:
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
    const reply = await runClaude(prompt);
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

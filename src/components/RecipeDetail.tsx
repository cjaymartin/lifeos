'use client';
import { useState } from 'react';
import { Printer, FlaskConical, ChefHat } from 'lucide-react';

// ── types ──────────────────────────────────────────────────────────────────

export interface RecipeSection { heading: string; content: string }

interface Props {
  title: string;
  prepTime?: string;
  cookTime?: string;
  servings?: number;
  tags?: string[];
  source?: string;
  sections: RecipeSection[];
}

// ── constants ──────────────────────────────────────────────────────────────

const SCALES = [
  { label: '½×', value: 0.5 },
  { label: '1×', value: 1 },
  { label: '2×', value: 2 },
  { label: '3×', value: 3 },
];

const UNICODE_FRACS: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75,
  '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125,
  '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

const DISPLAY_FRACS: [number, string][] = [
  [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'],
  [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'],
  [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'],
];

const VOL_ML: Record<string, number> = {
  cup: 240, cups: 240,
  tbsp: 15, tablespoon: 15, tablespoons: 15,
  tsp: 5, teaspoon: 5, teaspoons: 5,
  'fl oz': 30,
  ml: 1, milliliter: 1, milliliters: 1,
  l: 1000, liter: 1000, liters: 1000,
};

const WEIGHT_G: Record<string, number> = {
  oz: 28.35, ounce: 28.35, ounces: 28.35,
  lb: 453.6, lbs: 453.6, pound: 453.6, pounds: 453.6,
  g: 1, gram: 1, grams: 1,
  kg: 1000, kilogram: 1000, kilograms: 1000,
};

// ── parsing helpers ────────────────────────────────────────────────────────

function parseAmount(str: string): number {
  let s = str.trim();
  for (const [frac, val] of Object.entries(UNICODE_FRACS)) s = s.replace(frac, String(val));
  const mixed = s.match(/^(\d+(?:\.\d+)?)\s+([\d.]+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]);
  const frac = s.match(/^(\d+)\/(\d+)$/);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  return Number(s) || 0;
}

function formatAmount(n: number): string {
  if (n === 0) return '0';
  const whole = Math.floor(n);
  const rem = n - whole;
  const EPS = 0.04;
  const matched = DISPLAY_FRACS.find(([v]) => Math.abs(rem - v) < EPS);
  if (matched) return whole > 0 ? `${whole}${matched[1]}` : matched[1];
  if (Math.abs(rem) < EPS) return String(whole);
  if (n >= 10) return String(Math.round(n));
  return n.toFixed(1).replace(/\.0$/, '');
}

const UNIT_WORDS = 'cups?|tablespoons?|tbsp|teaspoons?|tsp|scoops?|fl\\s?oz|ml|l|g|kg|oz|ounces?|lbs?|pounds?';
const ING_RE = new RegExp(
  `^([\\d\\s½¼¾⅓⅔⅛⅜⅝⅞\\/\\.]+?)\\s+(${UNIT_WORDS})\\s+(.+)$`, 'i'
);
const AMT_RE = /^([\d½¼¾⅓⅔⅛⅜⅝⅞]+(?:\s+[\d½¼¾⅓⅔⅛⅜⅝⅞]+)?)\s+(.+)$/;

interface Ingredient { amount: number | null; unit: string | null; name: string }

function parseIngredient(line: string): Ingredient {
  const u = line.match(ING_RE);
  if (u) return { amount: parseAmount(u[1]), unit: u[2], name: u[3] };
  const a = line.match(AMT_RE);
  if (a) {
    const amt = parseAmount(a[1]);
    if (amt > 0) return { amount: amt, unit: null, name: a[2] };
  }
  return { amount: null, unit: null, name: line };
}

function toMetric(amount: number, unit: string): { amount: number; unit: string } | null {
  const k = unit.toLowerCase().replace(/\s+/, ' ');
  if (VOL_ML[k] !== undefined) {
    const ml = amount * VOL_ML[k];
    if (ml >= 950) return { amount: Math.round(ml / 100) / 10, unit: 'L' };
    if (ml >= 50) return { amount: Math.round(ml / 5) * 5, unit: 'ml' };
    return { amount: Math.round(ml), unit: 'ml' };
  }
  if (WEIGHT_G[k] !== undefined) {
    const g = amount * WEIGHT_G[k];
    if (g >= 950) return { amount: Math.round(g / 100) / 10, unit: 'kg' };
    return { amount: Math.round(g), unit: 'g' };
  }
  return null;
}

function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/).map((p, i) =>
    p.startsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : p
  );
}

// ── component ──────────────────────────────────────────────────────────────

export default function RecipeDetail({ title, prepTime, cookTime, servings, tags, source, sections }: Props) {
  const [scale, setScale] = useState(1);
  const [metric, setMetric] = useState(false);

  const ingredientSection = sections.find(s => s.heading === 'Ingredients');
  const ingredients: Ingredient[] = ingredientSection
    ? ingredientSection.content
        .split('\n')
        .map(l => l.replace(/^[-•]\s*/, '').trim())
        .filter(Boolean)
        .map(parseIngredient)
    : [];

  function displayIngredient(ing: Ingredient): string {
    if (ing.amount === null) return ing.name;
    const scaled = ing.amount * scale;
    if (metric && ing.unit) {
      const converted = toMetric(scaled, ing.unit);
      if (converted) return `${formatAmount(converted.amount)} ${converted.unit} ${ing.name}`;
    }
    return `${formatAmount(scaled)}${ing.unit ? ' ' + ing.unit : ''} ${ing.name}`;
  }

  const btnBase = 'text-xs px-2.5 py-1 rounded-md border transition-colors';
  const btnActive = 'bg-primary text-primary-foreground border-transparent';
  const btnInactive = 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30';

  return (
    <div className="space-y-8">

      {/* ── Header (visible in print) ──────────────────────────────────── */}
      <div className="space-y-3">
        <div className="print:block hidden">
          <div className="flex items-center gap-2 mb-2">
            <ChefHat size={18} className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Recipe</span>
          </div>
        </div>
        <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
        <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
          {prepTime && <span>Prep: {prepTime}</span>}
          {cookTime && <span>Cook: {cookTime}</span>}
          {servings && <span>{servings} serving{servings !== 1 ? 's' : ''}</span>}
          {scale !== 1 && (
            <span className="text-foreground font-medium">
              → {scale < 1 ? `${formatAmount(servings! * scale)} servings` : `${formatAmount(servings! * scale)} servings`}
            </span>
          )}
          {source && source !== 'original' && <span>Source: {source}</span>}
        </div>
        {tags && tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.map(tag => (
              <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{tag}</span>
            ))}
          </div>
        )}
      </div>

      {/* ── Controls (hidden in print) ─────────────────────────────────── */}
      <div className="print:hidden flex flex-wrap items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border">
        <span className="text-xs text-muted-foreground font-medium mr-1">Scale</span>
        {SCALES.map(s => (
          <button
            key={s.value}
            onClick={() => setScale(s.value)}
            className={`${btnBase} ${scale === s.value ? btnActive : btnInactive}`}
          >{s.label}</button>
        ))}

        <div className="w-px h-4 bg-border mx-1" />

        <button
          onClick={() => setMetric(m => !m)}
          className={`${btnBase} flex items-center gap-1.5 ${metric ? btnActive : btnInactive}`}
        >
          <FlaskConical size={11} />
          {metric ? 'Metric' : 'US'}
        </button>

        <button
          onClick={() => window.print()}
          className={`${btnBase} ${btnInactive} flex items-center gap-1.5 ml-auto`}
        >
          <Printer size={11} />
          Print
        </button>
      </div>

      {/* ── Sections ───────────────────────────────────────────────────── */}
      {sections.map(({ heading, content }) => {
        const lines = content.split('\n').map(l => l.trim()).filter(Boolean);

        return (
          <div key={heading} className="space-y-3">
            <h2 className="text-base font-semibold text-foreground border-b border-border pb-1.5">{heading}</h2>

            {heading === 'Ingredients' ? (
              <ul className="space-y-2">
                {ingredients.map((ing, i) => (
                  <li key={i} className="text-sm text-foreground flex items-baseline gap-2">
                    <span className="text-muted-foreground select-none">·</span>
                    {displayIngredient(ing)}
                  </li>
                ))}
              </ul>
            ) : heading === 'Instructions' ? (
              <ol className="space-y-3 list-none">
                {lines
                  .map(l => l.replace(/^\d+\.\s*/, ''))
                  .map((l, i) => (
                    <li key={i} className="text-sm text-foreground flex gap-3">
                      <span className="shrink-0 w-5 h-5 rounded-full bg-muted text-muted-foreground text-xs flex items-center justify-center font-medium mt-0.5">
                        {i + 1}
                      </span>
                      <span>{renderInline(l)}</span>
                    </li>
                  ))
                }
              </ol>
            ) : (
              <div className="space-y-2">
                {content.split(/\n\n+/).map((p, i) => (
                  <p key={i} className="text-sm text-muted-foreground">{renderInline(p.trim())}</p>
                ))}
              </div>
            )}
          </div>
        );
      })}

    </div>
  );
}

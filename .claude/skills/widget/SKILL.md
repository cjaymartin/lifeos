---
name: widget
description: Manage dashboard widgets — list, enable/disable, reorder, edit config, create, or remove.
---

# Widget Manager

Manage `src/content/widgets/registry.json` which controls what appears on the dashboard. When a new widget **type** needs a renderer, also update `src/pages/index.astro`.

---

## Registry schema

```json
{
  "id": "unique-kebab-id",
  "type": "trash|weather|tasks|calendar|briefing|stat|note",
  "label": "Display name shown in the card header",
  "enabled": true,
  "order": 10,
  "size": "card|full",
  "displayCondition": "always|has-data|has-events|mon-to-trash-day",
  "config": {},
  "dataKey": "key-in-today.json",
  "populator": "populate-daily step-N or 'manual'"
}
```

Use **order gaps of 10** (10, 20, 30…) so items can always be inserted between existing ones.

---

## Built-in types

| type | size | displayCondition | dataKey | populator |
|---|---|---|---|---|
| `trash` | card | `mon-to-trash-day` | `trash` | populate-daily step-5 |
| `weather` | card | `has-data` | `weather` | populate-daily step-4 |
| `tasks` | card | `has-data` | `tasks` | populate-daily step-2 |
| `calendar` | full | `has-events` | `calendar` | populate-daily step-3 |
| `briefing` | full | `has-data` | `briefing` | populate-daily step-6 |
| `stat` | card | `has-data` | custom | manual or new populate step |
| `note` | card or full | `always` | *(none — content in config)* | none |

---

## Display conditions

- `always` — always render (use for notes, static content)
- `has-data` — render if `today.json[dataKey]` is truthy
- `has-events` — render if `today.json[dataKey]` is a non-empty array
- `mon-to-trash-day` — render Mon–Wed (day-of-week 1–3) only

---

## Operations

### list
Read and display `src/content/widgets/registry.json` in a readable table.
Show: ID, type, label, enabled, order, size, displayCondition.

### enable `<id>`
Set `"enabled": true` on the matching widget. Write registry. No rebuild needed.

### disable `<id>`
Set `"enabled": false` on the matching widget. Write registry. No rebuild needed.

### reorder `<id1> <id2> ...`
Assign orders 10, 20, 30… to the listed IDs in the given sequence.
Widgets not listed keep their current order but are renumbered to stay consistent.
Write registry. No rebuild needed.

### edit `<id>`
Accepts changes to: `label`, `size`, `displayCondition`, `enabled`, or any `config` key.
Merge only the specified fields into the existing widget entry. Write registry. No rebuild needed (unless a renderer change is also required).

**config** changes for built-in types:
- `trash` → `trashDay` (display string), `pickupBy` (time string)
- `weather` → `lat`, `lon`, `units` ("fahrenheit"/"celsius")
- `tasks` → `maxItems` (number, default 5), `source` ("todoist")
- `stat` → `unit` (string), `source` ("manual")
- `note` → `content` (text), `style` ("info"|"warning"|"success")

### create (existing type)
If the `type` already has a renderer in `src/pages/index.astro` (trash, weather, tasks, calendar, briefing, stat, note):

1. Choose a unique `id`.
2. Set `order` to last existing order + 10.
3. Add entry to registry.
4. Write registry. No rebuild needed.

**note widget** example:
```json
{
  "id": "reminder-note",
  "type": "note",
  "label": "Reminder",
  "enabled": true,
  "order": 25,
  "size": "card",
  "displayCondition": "always",
  "config": { "content": "...", "style": "warning" },
  "dataKey": "",
  "populator": "manual"
}
```

**stat widget** example (manual value — you set `today.json["steps"]` by hand or script):
```json
{
  "id": "steps",
  "type": "stat",
  "label": "Steps",
  "enabled": true,
  "order": 35,
  "size": "card",
  "displayCondition": "has-data",
  "config": { "unit": "steps today" },
  "dataKey": "steps",
  "populator": "manual"
}
```

### create (new type)
If the type has no renderer yet:

1. Add entry to registry with the new type name.
2. Add a renderer block inside `src/pages/index.astro`:
   - For a card widget: inside the `{cardWidgets.map(w => ...)}` block, add a `{w.type === '<new-type>' && ...}` conditional.
   - For a full-width widget: inside the `{fullWidgets.map(w => ...)}` block.
3. Run `npm run build` to verify no TypeScript/build errors.
4. If the widget needs daily data (not static): add a new numbered step at the bottom of `.claude/skills/populate-daily/SKILL.md` describing:
   - How to fetch/compute the data
   - What key to write in `today.json` (must match `dataKey`)
   - The data shape expected by the renderer

### remove `<id>`
1. Remove entry from registry. Write registry.
2. No rebuild needed.
3. If the removed widget's `type` is now unused by any other widget, ask the user whether to also remove its renderer from `index.astro` (don't do so automatically).
4. If the type had a dedicated populate-daily step that's now unneeded, ask the user whether to remove it.

---

## Rebuild rules

The app runs **SSR** — pages re-execute on every request, so the registry is read live.

| Change | Rebuild needed? |
|---|---|
| enable / disable / reorder / edit config | **No** |
| create with existing type | **No** |
| create with new type (renderer added to index.astro) | **Yes** — run `npm run build` |
| remove | **No** |

---

## Skill args

The user will invoke this skill with arguments like:

```
/widget list
/widget enable weather
/widget disable trash
/widget reorder weather tasks trash
/widget edit tasks --config maxItems=8
/widget edit briefing --label "Morning Brief" --size full
/widget create note daily-reminder --label "Reminder" --content "Check your calendar" --style info
/widget create stat steps --label "Steps" --unit "steps today"
/widget remove daily-reminder
```

Parse the first argument as the operation. Remaining arguments are the target ID and optional flags.
If the intent is ambiguous, ask one clarifying question before proceeding.

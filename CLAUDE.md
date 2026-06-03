# LifeOS — System Manual

## Project Identity

This is **LifeOS**, a local-first personal dashboard. It uses Astro for the UI and local Markdown/JSON files in `src/content/` for the database.

## The Two Modes

### APP MODE
If asked to build a new feature, view, or "stack" (like a Budget view): create `.astro` pages, React components, and define the data schema.

### DATA MODE
If asked to log a record, save a recipe, or add an entry: **do not write UI code.** Act as the database administrator — create or update the raw Markdown/JSON data files in `src/content/` and do nothing else.

## Execution

- Run `npm run build` after changing structural code.
- Do **not** rebuild when only modifying data files.

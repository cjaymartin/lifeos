---
name: journal
description: DATA MODE — add a journal entry to src/content/journal/. Creates or appends to today's markdown file. Does not touch any UI code.
---

# Journal Entry (DATA MODE)

You are acting as the **database administrator**. Do not write or modify any `.astro`, `.tsx`, or other UI files. Only create/update files in `src/content/journal/`.

## Behaviour

### If the user provides content

Write it immediately. Don't ask unnecessary questions.

### If the user says "journal" with no content

Prompt with: *"What's on your mind?"* — then write whatever they provide.

---

## File path

`src/content/journal/YYYY-MM-DD.md` using today's date.

If the file **already exists**, append the new entry below the last one with a `---` divider and a timestamp header. Multiple entries per day are allowed.

If the file **doesn't exist**, create it fresh.

---

## Format — new file

```markdown
---
date: "YYYY-MM-DD"
---

## <HH:MM AM/PM>

<Entry content here.>
```

## Format — appending to existing file

Append at the end:

```markdown

---

## <HH:MM AM/PM>

<Entry content here.>
```

---

## Entry content rules

- Write exactly what the user said, preserving their voice and wording
- Do **not** rephrase, summarise, or improve their writing unless explicitly asked
- If the user dictated stream-of-consciousness, write it as-is
- If the user asks you to "clean it up" or "make it readable", lightly fix grammar only — don't change meaning or tone
- Mood/tag extraction: if the entry naturally suggests a mood or topic (e.g. "stressful day", "great run"), add a `tags:` line to the frontmatter listing them. Only do this on new files (not appends).

---

## After writing

Confirm with one line: the file path and the timestamp of the entry. Nothing else — don't summarise the entry back to the user.

## Rules

- Never run `npm run build`
- Never modify any UI files
- Use the system's current date and time for timestamps

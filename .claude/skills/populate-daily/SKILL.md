---
name: populate-daily
description: Generate today's morning briefing — reads the local tasks mirror, pulls Google Calendar events, weather for Mattapoisett MA, and Wednesday trash status, then writes src/content/daily/today.json.
---

# Populate Daily Briefing

Gather data from all sources, synthesise a brief, and write `src/content/daily/today.json`. This skill is designed to be run each morning via cron.

## Owner context

- **Location:** Mattapoisett, MA (lat: 41.6534, lon: -70.8148)
- **Trash day:** Wednesday — collected by Harvey Waste & Recycling
- **Timezone:** America/New_York

---

## Step 0 — Check widget registry

Read `src/content/widgets/registry.json`. Note which widgets are enabled and their `populator` field. Only collect data for widgets that are enabled. Steps below map to populators:

- Step 2 (Tasks) → always run; it reads the local mirror (cheap) and feeds the briefing.
  The dashboard Tasks widget no longer uses this data — it syncs live via the Tasks stack.
- Step 3 (Google Calendar) → needed if any widget has `"populator": "populate-daily step-3"`
- Step 3.5 (Birthdays) → needed if any widget has `"populator": "populate-daily step-3.5"`
- Step 4 (Weather) → needed if any widget has `"populator": "populate-daily step-4"`
- Step 5 (Trash) → needed if any widget has `"populator": "populate-daily step-5"`
- Step 5.5 (Deliveries) → needed if any enabled widget's `populator` mentions `populate-deliveries`
- Step 5.7 (Water delivery) → needed if any widget has `"populator": "populate-daily step-5.7"`

If the registry file doesn't exist or can't be read, run all steps (safe default).

---

## Step 1 — Get today's date

Use `currentDate` from context or run `date` in bash. Format: YYYY-MM-DD. Also derive:
- Day of week (e.g. "Wednesday")
- Whether today is a US federal holiday (check against standard list)
- Whether yesterday was a US federal holiday

---

## Step 2 — Tasks (from the local mirror — do NOT call Todoist MCP tools)

Tasks now sync continuously into a local mirror maintained by the Tasks stack
(`src/lib/tasks/`). Read `src/content/tasks/tasks.json` instead of calling any
Todoist tools. Each task has `content`, `projectId`, `priority` (1 = highest),
and `due.date` (YYYY-MM-DD, may include a T…time part). Project names are in the
`projects` array.

Collect (comparing `due.date`'s date part against today):
- Tasks due today (with project names)
- Overdue tasks: `due.date` before today (count + list, capped at 5)

If the mirror file is missing or empty (sync not configured yet), set the tasks
block to `{"dueToday": 0, "overdue": 0, "items": []}` and skip task mentions in
the briefing.

---

## Step 3 — Google Calendar

Use `mcp__claude_ai_Google_Calendar__list_events` for today's date range (start of day → end of day, America/New_York).

Collect:
- All events: title, time, location if present
- Flag any events in the next 2 hours as "soon"

---

## Step 3.5 — Birthdays (next 30 days)

Find upcoming birthdays so the dashboard Birthday widget (and its day-of banner) can light up. Look forward **up to one month** (today → today + 30 days).

### Calendars to scan

Both:
- **Primary** — `cjay.martin@gmail.com`
- **Family** — `family03669477726391600714@group.calendar.google.com`

### How to detect a birthday (smartest match)

For each calendar, call `mcp__claude_ai_Google_Calendar__list_events` with `startTime` = today 00:00 and `endTime` = today + 30 days, `calendarId` set, and **`eventType: ["DEFAULT", "BIRTHDAY"]`** (the native `BIRTHDAY` type future-proofs Google Contacts birthdays; today there are none, but include it).

Keep an event if **either**:
- `eventType === "BIRTHDAY"` (native annual birthday), **or**
- it is an **all-day** event (`start.date` present, no `start.dateTime`) whose title matches `/\bbirthday\b|\bbday\b|🎂/i`.

Ignore timed events and anything that doesn't match — this avoids pulling in unrelated meetings.

### Clean each entry

- **name** — strip the birthday noise from the title: remove a trailing `'s Birthday` / `Birthday` / `bday`, a leading/trailing 🎂, and surrounding whitespace. Examples: `"Anna's Birthday"` → `"Anna"`, `"🎂 Mike"` → `"Mike"`, `"Mom bday"` → `"Mom"`. If stripping leaves an empty string, keep the original title.
- **date** — the occurrence date that falls inside the window, as `YYYY-MM-DD` (use `start.date`). These are annual recurring events, so the API already returns the instance dated this year.

### Output

- Dedupe by `name` + `date` (the same person can appear on both calendars).
- Sort ascending by date.
- Write the result as the `birthdays` array in `today.json` (see Step 7). If none, write `[]` — the widget hides itself via its `has-events` condition.

Mention any birthday **today or tomorrow** in the briefing (Step 6).

---

## Step 4 — Weather

Fetch from Open-Meteo (no API key needed):

```
https://api.open-meteo.com/v1/forecast?latitude=41.6534&longitude=-70.8148&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&forecast_days=1&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum
```

Extract:
- Current temp (°F), feels-like, conditions (decode WMO weather_code: 0=clear, 1-3=partly cloudy, 45/48=fog, 51-67=rain, 71-77=snow, 80-82=showers, 95+=thunderstorm)
- Today's high/low
- Any precipitation expected

---

## Step 5 — Trash day check

Only relevant if today is **Wednesday** (or a day that might be a make-up day after a holiday).

### 5a — Holiday delay

**Rule:** If a US federal holiday fell on Monday or Tuesday of this week, Wednesday pickup shifts to Thursday. If the holiday fell ON Wednesday, pickup also shifts to Thursday.

Determine `trashToday: boolean` from this logic.

### 5b — Recycling: read the official Trash & Recycling page

The town posts explicit weekly announcements directly on this page — it is the authoritative source. Do **not** guess, toggle, or use any local state file.

WebFetch: `http://www.mattapoisett.gov/238/Trash-Recycling`

Look for news alerts or announcements that reference the current week or the Monday–Sunday window containing today. They will say either:
- **"Trash Only Week"** → set `recycling: false`
- **"Recycling Week"** (or similar) → set `recycling: true`

The town pre-posts these for the whole year, so there will always be a matching entry. Find the announcement whose date falls in the current week (Monday–Sunday). If for any reason no announcement is found for the current week, fall back to reading `src/content/daily/recycling-schedule.json` which contains the full extracted 2026 schedule.

Set `trashNote` to any delay, cancellation, or special notice text found on the page for the current week. If nothing unusual, set it to `null`.

---

## Step 5.5 — Deliveries (delegated skill)

Read `.claude/skills/populate-deliveries/SKILL.md` and follow it exactly — it scans
Gmail for upcoming deliveries and writes `src/content/deliveries/deliveries.json`
(a separate file from today.json, with its own refresh button on /deliveries).

After it completes, note anything arriving **today** for the briefing.

---

## Step 5.7 — Water delivery (recurring, from email)

The owner gets recurring bottled-water deliveries from **ReadyRefresh** (a Primo
Brands service) — Poland Spring bottles. ReadyRefresh emails a reminder a few days
before each delivery, and the **delivery date is in the subject line**, e.g.
`Primo Brands™ reminder for Friday, June 26, 2026`. Deliveries recur roughly every
two weeks (typically a Friday).

### How to find the next date

Gmail search:
```
from:readyrefresh.com OR subject:(ReadyRefresh OR "Primo Brands") newer_than:30d
```

- Look at the most recent **reminder** email (`subject: Primo Brands… reminder for <weekday>, <Month D, YYYY>`). Parse the date out of the subject → `nextDate` (YYYY-MM-DD).
- Order-confirmation emails (`Thank you for your order`) also appear; they confirm the upcoming delivery but the reminder subject is the cleanest date source. If only a confirmation exists, open it (`get_thread`) and read the scheduled date from the body.
- Ignore any reminder whose parsed date is **in the past** (a delivery that already happened). If the most recent reminder is in the past and no future one exists yet, leave `water` out of `today.json` (omit the key) — the widget hides itself.

### Output

Write the `water` block in `today.json` (see Step 7):
```json
{ "nextDate": "YYYY-MM-DD", "vendor": "ReadyRefresh", "product": "Poland Spring", "note": null }
```

The widget shows automatically when `nextDate` is within **14 days**, and the
dashboard escalates to a warning banner inside **5 days** — these thresholds live
in `src/lib/widgets.ts` (`WATER_WINDOW_DAYS` / `WATER_WARNING_DAYS`), not here.
Set `note` to any reschedule/skip notice from the email, else `null`.

Mention a water delivery landing **today or tomorrow** in the briefing (Step 6).

---

## Step 6 — Synthesise briefing

Write a short, natural-language briefing paragraph (2-5 sentences). Tone: warm, personal, informative. Address the user directly. Include:
- Weather summary
- How many tasks due / overdue flag if any
- Any calendar events today
- Trash reminder if applicable
- Deliveries arriving today, if any (e.g. "Your Chewy order lands today")

Example:
> "Good morning! It's a chilly 38° morning in Mattapoisett with clear skies — high of 52° today. You have 3 tasks due, including 2 overdue items worth clearing out. Don't forget trash (and recycling) goes out today."

---

## Step 7 — Write the file

Write `src/content/daily/today.json`:

```json
{
  "date": "YYYY-MM-DD",
  "greeting": "Good morning, C.Jay.",
  "briefing": "<synthesised paragraph>",
  "weather": {
    "code": <WMO weather code integer>,
    "current": <temperature as number>,
    "feelsLike": <apparent temperature as number>,
    "condition": "<human-readable condition string>",
    "high": <number>,
    "low": <number>,
    "wind": <wind speed as number>,
    "precipitation": "<amount or 'None expected'>"
  },
  "tasks": {
    "dueToday": <number>,
    "overdue": <number>,
    "items": ["<task 1>", "<task 2>", "..."]
  },
  "calendar": [
    { "title": "<event>", "time": "<HH:MM AM/PM>", "soon": <boolean> }
  ],
  "trash": {
    "today": <boolean>,
    "recycling": <boolean>,
    "note": "<string or null>"
  },
  "birthdays": [
    { "name": "<person>", "date": "<YYYY-MM-DD>" }
  ],
  "water": {
    "nextDate": "<YYYY-MM-DD>",
    "vendor": "ReadyRefresh",
    "product": "Poland Spring",
    "note": "<string or null>"
  },
  "items": ["<bullet 1>", "<bullet 2>"]
}
```

`items` is a flat list of the 3-5 most actionable things from the day — used as bullet points on the dashboard.

---

## Cron setup reminder

To run this every morning at 6:30am, add to crontab:
```
30 6 * * * cd /home/cjay/WebstormProjects/lifeos && claude -p "/populate-daily" --allowedTools "mcp__claude_ai_Google_Calendar__*,mcp__claude_ai_Gmail__search_threads,mcp__claude_ai_Gmail__get_thread,WebFetch,Bash,Read,Write"
```

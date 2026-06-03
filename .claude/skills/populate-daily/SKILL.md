---
name: populate-daily
description: Generate today's morning briefing — pulls Todoist tasks, Google Calendar events, weather for Mattapoisett MA, and Wednesday trash status, then writes src/content/daily/today.json.
---

# Populate Daily Briefing

Gather data from all sources, synthesise a brief, and write `src/content/daily/today.json`. This skill is designed to be run each morning via cron.

## Owner context

- **Location:** Mattapoisett, MA (lat: 41.6534, lon: -70.8148)
- **Trash day:** Wednesday — collected by Harvey Waste & Recycling
- **Timezone:** America/New_York

---

## Step 1 — Get today's date

Use `currentDate` from context or run `date` in bash. Format: YYYY-MM-DD. Also derive:
- Day of week (e.g. "Wednesday")
- Whether today is a US federal holiday (check against standard list)
- Whether yesterday was a US federal holiday

---

## Step 2 — Todoist tasks

Use `mcp__claude_ai_Todoist__find-tasks-by-date` to get tasks due today.
Also use `mcp__claude_ai_Todoist__find-tasks` with a filter for overdue tasks.

Collect:
- Tasks due today (with project names)
- Overdue tasks (count + list, capped at 5)

---

## Step 3 — Google Calendar

Use `mcp__claude_ai_Google_Calendar__list_events` for today's date range (start of day → end of day, America/New_York).

Collect:
- All events: title, time, location if present
- Flag any events in the next 2 hours as "soon"

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

Only relevant if today is **Wednesday** (or a day that might be a make-up day).

**Holiday delay rule:** If any US federal holiday fell on Monday or Tuesday of this week, Wednesday pickup is typically delayed by one day (Thursday). If a holiday fell ON Wednesday, pickup shifts to Thursday.

To check for town-announced delays or cancellations, WebFetch:
`http://www.mattapoisett.gov/`

Look for any news items, alerts, or announcements mentioning "trash", "recycling", "Harvey", or "DPW delay" in the current week. If nothing is found, assume pickup is on schedule.

Determine and record:
- `trashToday: boolean` — is trash collected today?
- `trashNote: string | null` — any delay/cancellation note

**Recycling:** alternates weekly. Track in `src/content/daily/recycling-state.json` — if the file doesn't exist, create it with `{ "lastRecyclingDate": null }`. Toggle each Wednesday: if last recycling was ≤ 8 days ago it's trash-only this week; if > 8 days ago (or null) it's both trash + recycling.

---

## Step 6 — Synthesise briefing

Write a short, natural-language briefing paragraph (2-5 sentences). Tone: warm, personal, informative. Address the user directly. Include:
- Weather summary
- How many tasks due / overdue flag if any
- Any calendar events today
- Trash reminder if applicable

Example:
> "Good morning! It's a chilly 38° morning in Mattapoisett with clear skies — high of 52° today. You have 3 tasks due, including 2 overdue items worth clearing out. Don't forget trash (and recycling) goes out today."

---

## Step 7 — Write the file

Write `src/content/daily/today.json`:

```json
{
  "date": "YYYY-MM-DD",
  "greeting": "Good morning, CJ.",
  "briefing": "<synthesised paragraph>",
  "weather": {
    "current": "<temp>°F, <condition>",
    "high": <number>,
    "low": <number>,
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
  "items": ["<bullet 1>", "<bullet 2>"]
}
```

`items` is a flat list of the 3-5 most actionable things from the day — used as bullet points on the dashboard.

---

## Cron setup reminder

To run this every morning at 6:30am, add to crontab:
```
30 6 * * * cd /home/cjay/WebstormProjects/lifeos && claude -p "/populate-daily" --allowedTools "mcp__claude_ai_Todoist__*,mcp__claude_ai_Google_Calendar__*,WebFetch,Bash,Read,Write"
```

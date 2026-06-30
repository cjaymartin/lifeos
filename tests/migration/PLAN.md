# LifeOS — Data-Integrity QA Test Plan

_Generated 2026-06-30T14:47:13.212Z by tests/migration/spider.mjs._

## Purpose

Verify that every piece of **user data** the dashboard renders today is
still rendered after a backend change. The plan asserts on durable item
**identities** (names, contents, titles) — not on counts, ordering,
timestamps, weather, or layout — so it tolerates minor data churn but
fails loudly on real data loss.

## How to run

```bash
source ~/.nvm/nvm.sh && nvm use default   # node/npm on PATH
node tests/migration/verify.mjs           # builds, serves, checks, exits non-zero on any FAIL
```

`verify.mjs` starts the sandboxed authenticated server (no real agents,
no real data mutated), reloads every page below, and asserts each
expected token still renders, plus that API identity sets are intact.
Screenshots from the run land in `tests/migration/screenshots/verify/`
next to the baseline shots for visual diffing.

## Pass criteria

- **PASS**: every listed expected token is present on its page, and every
  baseline API identity is still served. Extra/new items are allowed.
- **FAIL**: any expected token missing, any baseline API identity gone,
  any page that returned a non-200 / redirected to /login, or a page
  whose rendered text collapses to near-empty.

---

## Page cases

### DASH — Dashboard

- **Route:** `/`
- **Baseline status:** 200, 1178 chars rendered
- **Screenshot:** `screenshots/baseline/DASH.png`
- **What it covers:** Dashboard widgets (daily briefing items, task names, water vendor/product).
- **Steps:** load the route in the authenticated session; let islands hydrate; read the rendered text.
- **Expected tokens (must all be present, 4):**
  - `Trash Only week — no recycling this Wednesday`
  - `Next water delivery (ReadyRefresh) is July 10`
  - `ReadyRefresh`
  - `Poland Spring`
- **Not asserted** (candidate data not visible on this view at baseline, 8): `Clear a few of the 6 overdue chores (fiber, teeth, vacuum downstairs)`, `Amazon Pledge cleaner arrives today`, `Mild and dry today — high 72°, no rain`, `Take Fiber (Inbox)`, `Do Something (Personal)`, `Brush Teeth Morning (Inbox)`, `Brush Teeth Evening (Inbox)`, `Vacuum Downstairs (Inbox)`

### TASK — Tasks

- **Route:** `/tasks`
- **Baseline status:** 200, 636 chars rendered
- **Screenshot:** `screenshots/baseline/TASK.png`
- **What it covers:** Task list contents (active + completed).
- **Steps:** load the route in the authenticated session; let islands hydrate; read the rendered text.
- **Expected tokens (must all be present, 1):**
  - `Brush Teeth Evening`
- **Not asserted** (candidate data not visible on this view at baseline, 27): `Do Something`, `Brush Teeth Morning`, `Vacuum Downstairs`, `Vacuum Upstairs`, `Clean Bathrooms`, `Office Inspection (With Photos)`, `Take Fiber`, `Take GLP-1`, …

### GROC — Grocery

- **Route:** `/grocery`
- **Baseline status:** 200, 8653 chars rendered
- **Screenshot:** `screenshots/baseline/GROC.png`
- **What it covers:** Grocery list item names + staple names.
- **Steps:** load the route in the authenticated session; let islands hydrate; read the rendered text.
- **Expected tokens (must all be present, 4):**
  - `Nature's Recipe Original Variety Pack (Chicken, Salmon & Turkey, 2.75 oz cups, 12-count)`
  - `Nature's Recipe Grain Free Savory Broth Variety Pack (Chicken/Venison/Duck, 2.75 oz cups, 12-count)`
  - `psyllium fiber`
  - `Equate Allergy Relief Fexofenadine 180 mg, 60 ct (generic Allegra)`
- **Not asserted** (candidate data not visible on this view at baseline, 22): `Cream Cheese Spread`, `granola bars`, `sliced ham`, `apples`, `blackberries`, `blueberries`, `chicken sausage patties`, `grapes`, …

### DELIV — Deliveries

- **Route:** `/deliveries`
- **Baseline status:** 200, 723 chars rendered
- **Screenshot:** `screenshots/baseline/DELIV.png`
- **What it covers:** Delivery item descriptions + vendors.
- **Steps:** load the route in the authenticated session; let islands hydrate; read the rendered text.
- **Expected tokens (must all be present, 6):**
  - `Nordstrom order`
  - `Pledge Multisurface cleaner`
  - `Hanes Men's Tagless Boxers (box 1 of 2)`
  - `Sugar Splash & 4 more items (box 2 of 2)`
  - `Nordstrom`
  - `Amazon`

### REC — Recipes index

- **Route:** `/recipes`
- **Baseline status:** 200, 543 chars rendered
- **Screenshot:** `screenshots/baseline/REC.png`
- **What it covers:** Recipe card titles.
- **Steps:** load the route in the authenticated session; let islands hydrate; read the rendered text.
- **Expected tokens (must all be present, 2):**
  - `Brown Sugar Protein Creami`
  - `Chocolate PB Protein Creami`

### SET — Settings

- **Route:** `/settings`
- **Baseline status:** 200, 1301 chars rendered
- **Screenshot:** `screenshots/baseline/SET.png`
- **What it covers:** Settings page renders (structural screenshot only).
- **Steps:** load the route in the authenticated session; let islands hydrate; read the rendered text.
- **Expected:** page renders with non-trivial content (structural check only — no data tokens asserted).

### SETL — Settings · Logins

- **Route:** `/settings/logins`
- **Baseline status:** 200, 1301 chars rendered
- **Screenshot:** `screenshots/baseline/SETL.png`
- **What it covers:** Logins page renders (structural screenshot only).
- **Steps:** load the route in the authenticated session; let islands hydrate; read the rendered text.
- **Expected:** page renders with non-trivial content (structural check only — no data tokens asserted).

### REC-brown-sugar-protein-creami — Recipe · Brown Sugar Protein Creami

- **Route:** `/recipes/brown-sugar-protein-creami`
- **Baseline status:** 200, 1611 chars rendered
- **Screenshot:** `screenshots/baseline/REC-brown-sugar-protein-creami.png`
- **What it covers:** Recipe detail for "Brown Sugar Protein Creami" — title + ingredient/step lines.
- **Steps:** load the route in the authenticated session; let islands hydrate; read the rendered text.
- **Expected tokens (must all be present, 13):**
  - `Brown Sugar Protein Creami`
  - `## Ingredients`
  - `cups Fairlife 2% Milk`
  - `tbsp Torani Sugar-Free Brown Sugar Syrup`
  - `scoop vanilla whey isolate (~25g protein)`
  - `¼ tsp xanthan gum`
  - `## Instructions`
  - `Blend the Base:** Pour the Fairlife milk into your Ninja Creami pint. Add the vanilla whey isolate, Torani syrup, and xanthan gum. Use an immersion blender or milk frother to mix until completely smooth with no powdery clumps.`
  - `Freeze Flat:** Secure the lid and place on a level surface in your freezer. Freeze undisturbed for a full 24 hours.`
  - `The Initial Spin:** Remove from freezer, take off the lid, and flatten any center peak with a spoon. Lock the pint in and run on the Lite Ice Cream cycle.`
  - `The Splash & Re-Spin:** If the result looks crumbly or dry (common with high-protein bases), dig a small well, add 1 tbsp Fairlife milk, and press Re-Spin.`
  - `Serve:** Enjoy immediately, or smooth the top and return to the freezer — re-spin before eating again to restore texture.`
  - `## Notes`

### REC-chocolate-pb-protein-creami — Recipe · Chocolate PB Protein Creami

- **Route:** `/recipes/chocolate-pb-protein-creami`
- **Baseline status:** 200, 2026 chars rendered
- **Screenshot:** `screenshots/baseline/REC-chocolate-pb-protein-creami.png`
- **What it covers:** Recipe detail for "Chocolate PB Protein Creami" — title + ingredient/step lines.
- **Steps:** load the route in the authenticated session; let islands hydrate; read the rendered text.
- **Expected tokens (must all be present, 13):**
  - `Chocolate PB Protein Creami`
  - `## Ingredients`
  - `cups Fairlife Chocolate Milk`
  - `tbsp powdered peanut butter`
  - `½ scoop Isopure Chocolate Whey Isolate`
  - `¼ tsp xanthan gum`
  - `## Instructions`
  - `Blend the Base:** Pour the Fairlife Chocolate Milk into your clean Ninja Creami pint. Add the powdered peanut butter, Isopure whey isolate, and xanthan gum. Use an immersion blender or handheld milk frother to thoroughly mix everything until completely smooth and free of powdery clumps.`
  - `Freeze Flat:** Secure the storage lid tightly onto the pint. Place it on a completely level surface in your freezer and let it freeze undisturbed for a full 24 hours. Ensuring it freezes flat protects your machine's blade.`
  - `The Initial Spin:** Remove the pint from the freezer and take off the lid. If a small frozen peak has formed in the center, scrape it flat with a spoon. Lock the pint into the outer bowl assembly, attach it to the Ninja Creami, and run it on the Lite Ice Cream cycle.`
  - `The Splash & Re-Spin:** Once the cycle finishes, the texture will likely look dry, powdery, or crumbly. This is normal for high-protein bases. Dig a small well in the center of the pint, pour in 1 tablespoon of liquid Fairlife milk, lock it back in, and press the Re-Spin button.`
  - `Serve:** Scoop out your ultra-thick, velvety chocolate peanut butter ice cream right away, or add your favorite allergen-safe mix-ins!`
  - `## Notes`

---

## API data-integrity cases

These hit the JSON the pages are built from, independent of rendering.
Every identity below must still be served (set inclusion; order-free).

### API-GROC — `GET /api/grocery`
- **Item names intact (2):** must include every one of:
  - `Nature's Recipe Original Variety Pack (Chicken, Salmon & Turkey, 2.75 oz cups, 12-count)`
  - `Nature's Recipe Grain Free Savory Broth Variety Pack (Chicken/Venison/Duck, 2.75 oz cups, 12-count)`
- **Staple names intact (26):**
  - `Cream Cheese Spread`
  - `Nature's Recipe Original Variety Pack (Chicken, Salmon & Turkey, 2.75 oz cups, 12-count)`
  - `Nature's Recipe Grain Free Savory Broth Variety Pack (Chicken/Venison/Duck, 2.75 oz cups, 12-count)`
  - `granola bars`
  - `sliced ham`
  - `apples`
  - `blackberries`
  - `blueberries`
  - `chicken sausage patties`
  - `grapes`
  - `plastic spoons`
  - `sliced turkey`
  - `strawberries`
  - `fairlife 2% milk`
  - `paper plates`
  - `paper bowls`
  - `Diet Coke (24-pack, 12 fl oz cans)`
  - `Ibuprofin`
  - `psyllium fiber`
  - `Shamrock Rockin' Protein Max — Strawberry`
  - `Shamrock Rockin' Protein Max — Chocolate`
  - `Shamrock Rockin' Protein Max — Vanilla`
  - `Clorox Disinfecting Wipes (Crisp Lemon & Fresh, 225 ct / 3-pack)`
  - `baby carrots`
  - `Special Kitty Classic Variety Pack Pate Cat Food (13 oz, 12-pack)`
  - `Equate Allergy Relief Fexofenadine 180 mg, 60 ct (generic Allegra)`

### API-TASK — `GET /api/tasks`
- **Task contents intact (13):**
  - `Do Something`
  - `Brush Teeth Morning`
  - `Brush Teeth Evening`
  - `Vacuum Downstairs`
  - `Vacuum Upstairs`
  - `Clean Bathrooms`
  - `Office Inspection (With Photos)`
  - `Take Fiber`
  - `Take GLP-1`
  - `Bravecto`
  - `Pay off 3272`
  - `Pay off Norwegian`
  - `Bidding Upgrade for Cruise!`

### API-DONE — `GET /api/tasks/completed`
- **Completed task contents intact (15):**
  - `Rimadyl`
  - `weeez`
  - `weee`
  - `test7`
  - `test2`
  - `Test Task`
  - `Sentinel`
  - `RELEASE WRITE UP (reach out to Mack. Write-up how to achieve releases in Jira. Using Roadmaps)`
  - `Call in dog pills`
  - `Check sodastream account`
  - `Kitty - Direct Deposit`
  - `Setup new`
  - `Tax appointment at Pallatroni & Robichaud`
  - `Call for taxes`
  - `Bjs`


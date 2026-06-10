# LifeOS Grocery Sync — browser extension

Reads your **Walmart order history** and **cart** in your own logged-in browser
session and syncs them to LifeOS. This lets cart-building reorder the exact
products you actually buy **without Gmail and without spidering Walmart** — the
build-carts agent just greps your local order-history catalog.

- **Read-only.** It only reads page content. It never clicks buy/reorder, never
  places an order, never touches payment or login.
- **No credentials leave your browser.** It sends only product names + Walmart
  item IDs to your own LifeOS instance, authenticated with an ingest token.
- **Why an extension** (not server-side automation): Walmart's bot protection
  (PerimeterX/Akamai) blocks headless/automated browsers. Your own session sails
  through, so the extension reads the pages you're already looking at.

## What it syncs

| Page | Sent to LifeOS | Effect |
| --- | --- | --- |
| `walmart.com/orders` | `POST /api/grocery/order-history` | Builds your reorder catalog (`order-history.json`) |
| `walmart.com/cart` | `POST /api/grocery/carts/observed` | Auto-fills cart reconciliation (what landed vs. didn't) |

## Install

### 1. Get your ingest token
While logged into LifeOS, open `<your LifeOS URL>/api/grocery/ingest-token` in a
tab (e.g. `https://lifeos.cjay.io/api/grocery/ingest-token`) and copy the
`token` value.

### 2a. Chrome / Edge / Brave (Manifest V3)
1. Go to `chrome://extensions`.
2. Toggle **Developer mode** (top-right) on.
3. Click **Load unpacked** and select this folder
   (`extension/lifeos-grocery/`).
4. Click the extension's icon → set your **LifeOS URL** and **token** →
   **Grant access & save** (approve the permission prompt for your LifeOS host).

### 2b. Firefox
1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and select `manifest.json` in this folder.
   *(Temporary add-ons unload when Firefox restarts; for a permanent install,
   package and sign via [AMO](https://addons.mozilla.org/developers/) or use a
   developer/unbranded build with `xpinstall.signatures.required=false`.)*
3. Open the add-on's **Preferences/Options**, set your **LifeOS URL** and
   **token**, and save (approve the host permission prompt).

> Tip: during development you can iterate with
> [`web-ext`](https://github.com/mozilla/web-ext): `npx web-ext run` from this
> folder launches Firefox with the extension loaded.

## Use

Just browse normally while signed into Walmart:
- Visit **Your Orders** (`walmart.com/orders`) and scroll through your history —
  products sync automatically (the toolbar badge flashes `OK`).
- Open your **Cart** before/after building a cart in LifeOS — it auto-fills the
  reconciliation step.

Badge legend: `OK` = synced, `ERR` = LifeOS rejected/unreachable (check URL +
token), `SET` = not configured yet.

## Notes & limitations

- **Markup fragility:** the scrapers key on the stable `/ip/<itemId>` link
  pattern rather than CSS classes, but a major Walmart redesign could still break
  them — update `content-orders.js` / `content-cart.js` if syncing stops.
- **Manifest V3** is used for both Chrome and Firefox. The `browser`/`chrome`
  API namespace is feature-detected, so the same files load in both.
- Only Walmart is supported today (Amazon order-history sync is a possible
  follow-up).

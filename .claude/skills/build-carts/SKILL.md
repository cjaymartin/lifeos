---
name: build-carts
description: Build ONE Walmart cart from the grocery list by reordering exact products from the saved product memory (product-map.json), web-matching only as a fallback. Does NOT use Gmail. Amazon only for items Walmart doesn't carry. NEVER places an order.
---

# Build Carts

Read the grocery list and build **one Walmart cart** of add-to-cart links the user can open and check out **themselves**. Reordering known products beats guessing new ones.

## ABSOLUTE RULE — never purchase

You build links only. **Never** place, submit, or check out an order; never log in to a retailer; never enter payment, address, or account details; never open a checkout flow. If a page asks for login or payment, stop and move on. The user reviews the cart and checks out manually.

## Step 1 — Read state

- The grocery-list notes in `$LIFEOS_VAULT_DIR/grocery/list/` (default `~/obsidian/lifeos/grocery/list/`) — one `<id>.md` per item, fields in YAML frontmatter, `id` = filename minus `.md`. Work only with items where `checked: false`. If none, write carts.json with an empty carts array and stop.
- `src/content/grocery/cart-request.json` (may not exist) — when present, `{ "itemIds": [...] }` is your work list: build ONLY for those item ids (intersected with the unchecked items). When absent, build for all unchecked items. The server resolves items with product-map entries instantly before spawning you, so your work list is normally just the unknown items.
- `src/content/grocery/carts.json` (may not exist) — the CURRENT cart state. You MERGE into it, never replace it wholesale (Step 3).
- Skip any item whose existing cart line is already fully added (`addedQty >= qty`) — it's in the user's real retailer cart; re-matching it would cause double-adds.
- `src/content/grocery/product-map.json` (may not exist) — the product memory: `{ "<normalized item name>": { "retailer", "productId", "product", "productUrl", "pinned"? } }`. Entries with `"pinned": true` were chosen by the user.
- `src/content/grocery/order-history.json` (may not exist) — past-purchased products captured from Walmart order history: `{ "syncedAt", "products": [{ "retailer", "productId", "product", "productUrl", "lastOrdered"? }] }`. This is your **local reorder catalog** — grep it instead of the web whenever you can.
- The staple notes in `$LIFEOS_VAULT_DIR/grocery/staples/` (default `~/obsidian/lifeos/grocery/staples/`) — one `<id>.md` per staple, fields in YAML frontmatter — staple names help disambiguate.

## Step 2 — Match each item, in strict priority order

**The user wants reorders of the exact products they already buy — a fresh web guess is the last resort.**

**`buyFrom` override:** an item with `"buyFrom": "amazon"` (or `"walmart"`) must be matched at that retailer ONLY — an amazon-buyFrom item goes straight to the Amazon cart (skip the Walmart steps for it), and a walmart-buyFrom item never falls back to Amazon (unmatched instead).

1. **product-map.json hit** → reuse it directly with **ZERO lookups** — no Gmail, no web search, no fetch, no "confirming" or cross-checking of any kind. Copy the entry into the cart and move on; this should take seconds. `source: "reorder"`, confidence `high`. `pinned: true` entries are the user's explicit choice — use them verbatim even if you'd pick differently; if the entry lacks a `product` title, display the list item's name instead (do NOT look the title up). A pinned `amazon` entry goes in the Amazon cart — that's the user's call, not a fallback violation.
2. **Local order-history catalog** (`order-history.json`, if present) → fuzzy-match the item name against the `product` titles of past purchases and reuse that exact `productId`/`productUrl`. This is a **local file grep — ZERO network, no Gmail.** Example: "fairlife 2% milk" → the past "Fairlife 2% Ultra-Filtered Milk, 52 fl oz" entry. `source: "reorder"`, confidence `high`. Prefer the most recently ordered (`lastOrdered`) when several match.
3. **Web search Walmart** (only if 1 and 2 miss) → try `WebFetch` of the direct search page `https://www.walmart.com/search?q=<url-encoded item>` first (optionally `&sort=best_seller`); fall back to `WebSearch` for `site:walmart.com/ip <item name>`. Extract the item id from `walmart.com/ip/<slug>/<itemId>`. `source: "new"`.
   - **Same-container rule:** when parsing a search/results page, pair each product title with the link in the *same result block* — never a title from one result with a URL from another, and skip anything marked "Sponsored". Mismatched pairs are how wrong products end up in carts.
   - **Picking among candidates:** prefer ordinary, household-normal sizes. When ratings are within ~0.5★ of each other, prefer the higher review count (4.0★ × 10,000 beats 5.0★ × 100). Prefer items sold/fulfilled by Walmart over third-party marketplace sellers (marketplace listings often carry inflated prices and flaky stock).
4. **Amazon fallback** (only if the item genuinely can't be found at Walmart at all) → search `site:amazon.com <item>`, extract the ASIN from `/dp/<ASIN>`. Same same-container and review-count rules. These go in a separate minimal Amazon cart.
5. Still nothing plausible → `unmatched` on the Walmart cart. Never force a bad match.

> **Do NOT use Gmail.** Cart-building reorders from the product memory and the
> local order-history catalog (both filled from the user's own session — see the
> grocery browser extension), with web search as the only fallback. Never scrape
> email. Gmail is used solely by the separate purchase-scan job.

**Verify on the product page (every `source: "new"` match):** `WebFetch` the actual `walmart.com/ip/<id>` (or `amazon.com/dp/<ASIN>`) page and confirm three things — the title matches what you searched for, a current price is shown, and it isn't out of stock / unavailable. Search-result snippets routinely show the wrong price or a different variant (promotions, sellers, pack sizes), and a redirect or title mismatch means the id is wrong — discard and try the next candidate. Only verified matches get confidence `high`; if the page is bot-gated and won't load, keep the match but cap confidence at `medium`. Reorders from the product memory or the local catalog (priorities 1–2) skip verification — the user already bought them.

**Out of stock → offer fallbacks, never silently drop.** If the best product (including a pinned or past-order one) is out of stock / unavailable on its page, do NOT just discard it. Instead:
- Keep the line but set `"status": "out_of_stock"`.
- From the same search results, collect **2–3 ranked alternative products** into `"alternatives"` — each `{ "productId", "product", "price", "productUrl", "size" }`, ordered best-first by the same picking rules (normal sizes, higher review count, sold by Walmart).
- You MAY pre-select the closest in-stock alternative as the line's product (copy its fields up onto the line) and set `"substituted": true` so the cart stays usable — but still include the full `alternatives` so the user can change it.
- If you genuinely can't find any in-stock alternative, leave the line `"status": "out_of_stock"` with an empty/absent `alternatives` — it surfaces as "needs attention", still never dropped.
- In-stock matches get `"status": "ok"` (or just omit `status`).

Budget your time: ~5-minute headless window. Resolve from the product memory instantly; do deep web verification only for the few genuinely-`new` matches.

## Step 3 — Write carts.json (MERGE, don't replace)

Start from the existing carts.json and **carry over every line whose `itemId` is not in this run's work list** — those are server-resolved (instant) lines and lines already added to the real cart; dropping them breaks the UI's "in cart" tracking. Keep their `addedQty` exactly as-is. Then add/update lines for the items you matched, and rebuild each cart's `cartUrl` from all of its lines.

**One Walmart cart.** An `amazon` cart ONLY if step 4 produced fallback items — never duplicate a Walmart-matched item into Amazon.

Cart links:
- Walmart: `https://affil.walmart.com/cart/addToCart?items=<id1>,<id2>_<qty>,...`
- Amazon (fallback cart only): `https://www.amazon.com/gp/aws/cart/add.html?ASIN.1=<asin>&Quantity.1=1...`

```json
{
  "builtAt": "<current ISO timestamp>",
  "carts": [
    {
      "retailer": "walmart",
      "label": "Walmart",
      "cartUrl": "https://affil.walmart.com/cart/addToCart?items=123456789,987654321_2",
      "items": [
        {
          "itemId": "<id from the grocery-list note>",
          "name": "<item name from the list>",
          "product": "Fairlife 2% Ultra-Filtered Milk, 52 fl oz",
          "price": "$4.12",
          "productUrl": "https://www.walmart.com/ip/.../123456789",
          "productId": "123456789",
          "qty": 1,
          "confidence": "high",
          "source": "reorder",
          "status": "ok"
        }
      ],
      "unmatched": ["dragon fruit"],
      "notes": "<optional caveats>"
    }
  ]
}
```

- `itemId` must be the exact `id` from the grocery-list note (filename minus `.md`) — the checkout flow uses it.
- `productId` is required on every match (Walmart item id / Amazon ASIN) — the UI rebuilds `cartUrl` from these when the user removes items.
- `status` defaults to `"ok"` when absent. An `"out_of_stock"` line carries `alternatives` (and optionally `substituted: true`) — see the out-of-stock rule in Step 2. Don't put out-of-stock items in `unmatched`.
- `addedQty` is UI-managed (tracks what the user already pushed to the real retailer cart). Never invent it — but if the **previous** carts.json has a line with the same `productId` carrying `addedQty`, copy it over so a rebuild doesn't cause double-adds.
- Always write the file, even on a poor run — the UI uses its mtime to detect completion.

## Step 4 — Update the product memory

Write `src/content/grocery/product-map.json`: merge every confirmed match into the existing map keyed by lowercase item name (`{ "fairlife 2% milk": { "retailer": "walmart", "productId": "123456789", "product": "...", "productUrl": "..." } }`). Preserve entries for items not on this run's list. Don't store `low`-confidence guesses. **Never overwrite or remove an entry with `"pinned": true`** — those belong to the user (filling in a missing `product` title on a pinned entry is the only allowed edit).

Do **not** modify the grocery-list or staple notes, or any other file.

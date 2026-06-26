---
name: walmart-cart
description: Operate the user's real Walmart cart on demand — get the current cart, look through item/order history, see pending deliveries, and add or remove items. Talks to the LifeOS browser extension in the user's logged-in session, falling back to the local Walmart session. NEVER places an order or checks out.
---

# Walmart Cart

Operate the user's **real Walmart cart** at any time through LifeOS. Every
operation runs in the user's own logged-in Walmart session: the LifeOS browser
extension when it's installed and listening, otherwise the local Playwright
session from Settings → Logins. You don't choose the transport — the server does
(see `docs/adr/0001-walmart-cart-control.md`); you just call the CLI.

## ABSOLUTE RULE — never purchase

You read the cart and add/remove lines only. **Never** place, submit, or check
out an order; never log in; never enter payment, address, or account details;
never open a checkout flow. Adding an item puts it in the cart for the user to
review and buy themselves. If anything would complete a purchase, stop.

## The interface

One CLI, one op per call. It prints a JSON `WalmartOpResult` to stdout and exits
non-zero on failure.

```bash
node scripts/walmart.mjs get-cart                        # 1. current cart
node scripts/walmart.mjs get-history                     # 2. item / order history
node scripts/walmart.mjs get-deliveries                  # 3. pending deliveries
node scripts/walmart.mjs add-item    --product <id> [--qty <n>]   # 4. add to cart
node scripts/walmart.mjs remove-item --product <id>      # 5. remove from cart
```

`<id>` is the Walmart **productId** — the number in `/ip/<slug>/<productId>`.
Resolve a name to a productId from `src/content/grocery/product-map.json`,
`order-history.json`, or a prior `get-cart` / `get-history` result before adding.

## Result shape

```jsonc
{
  "ok": true,
  "op": "get-cart",
  "executor": "extension",      // or "fallback" (local Playwright session)
  "cart":    [ { "productId", "product", "productUrl", "price?", "qty?" } ],  // get/add/remove-item
  "history": [ { "retailer": "walmart", "productId", "product", "productUrl" } ], // get-history
  "deliveries": [ { "orderId?", "status?", "eta?", "items": [ { "productId?", "product?" } ] } ], // get-deliveries
  "source":  "walmart"          // get-deliveries only: "walmart" (live) or "gmail" (backup feed)
}
```

On failure: `{ "ok": false, "op": "...", "error": "<reason>" }` and a non-zero
exit. The common reason is **no executor available** — the extension isn't
listening *and* the local Walmart session is signed out. Tell the user to either
open a Walmart tab with the LifeOS extension installed, or sign in under
Settings → Logins. Don't retry in a tight loop.

## How to use it

- **"What's in my cart?" / "add milk" / "drop the paper towels"** — run the
  matching op. For add/remove, first resolve the item name to a productId (see
  above); if you can't find one, say so rather than guessing.
- **add-item** confirms by returning the resulting cart — check the productId is
  present before reporting success.
- **remove-item** also returns the resulting cart — confirm the productId is gone.
- **get-deliveries** prefers live Walmart data (`source: "walmart"`); a
  `source: "gmail"` result came from the deliveries email scan and may be less
  current. Mention which when it matters.
- A call may take up to ~25s when it waits for the extension before falling back.
  That's expected; don't treat slowness as failure.

## What this is NOT

- Not cart *building* from the grocery list — that's the `build-carts` skill,
  which assembles add-to-cart links. This skill operates the live cart directly.
- Not checkout. There is no order-placing op, by design.

---
name: populate-deliveries
description: Scan Gmail for upcoming deliveries (packages, food/grocery, pharmacy) from the last 30 days, dedupe to one entry per shipment, and write src/content/deliveries/deliveries.json.
---

# Populate Deliveries

Scan Gmail for delivery-related emails, consolidate them into one entry per shipment, and write `src/content/deliveries/deliveries.json`. Runs standalone (widget refresh button) and is also invoked as a step of `/populate-daily`.

## Scope

A "delivery" is anything physical arriving at the house:

- **Packages** — Amazon, UPS, FedEx, USPS, DHL, OnTrac, LaserShip shipping/tracking notifications
- **Food & grocery** — DoorDash, Instacart, HelloFresh, Chewy autoship, etc.
- **Pharmacy / subscriptions** — mail-order pharmacy, recurring subscription boxes

**Exclude:** marketing/promo emails, abandoned-cart nags, return-label confirmations, digital purchases (ebooks, gift cards, software), and anything already delivered more than 2 days ago.

---

## Step 1 — Read existing state

1. Read `src/content/deliveries/deliveries.json` if it exists — reuse stable `id`s and any details (item names, tracking URLs) that new emails don't repeat.
2. Read `src/content/deliveries/dismissed.json` if it exists. **Never include a delivery whose `id` is in the dismissed list**, even if new emails about it arrive. Matching is exact-id only — a dismissed id must never suppress a *different* order, which is why ids have to be unique per order (see Step 3).

## Step 2 — Search Gmail (last 30 days)

Use `mcp__claude_ai_Gmail__search_threads` with several targeted queries rather than one giant one. Suggested set:

1. `newer_than:30d from:(ups.com OR fedex.com OR usps.com OR dhl.com OR ontrac.com) subject:(shipped OR delivery OR delivered OR "on its way" OR arriving OR tracking)`
2. `newer_than:30d from:amazon.com subject:(ordered OR shipped OR delivered OR arriving OR "out for delivery" OR "delivery estimate" OR "on the way")` — Amazon order confirmations ("Ordered: ...") are in scope: an order that hasn't shipped yet is an upcoming delivery with `status: ordered`.
3. `newer_than:30d subject:("your order has shipped" OR "out for delivery" OR "has been delivered" OR "track your package" OR "track your order")`
4. `newer_than:30d from:(instacart.com OR doordash.com OR hellofresh.com OR chewy.com) subject:(order OR delivery OR shipped)`
5. `newer_than:30d subject:(prescription OR pharmacy) subject:(shipped OR delivery OR "on its way")`

Adjust/extend queries if results suggest other senders. For each promising thread, use `mcp__claude_ai_Gmail__get_thread` to read the messages and extract details. Skip threads that are clearly out of scope (see Exclusions above).

## Step 3 — Consolidate: one entry per shipment

One shipment generates many emails (ordered → shipped → out for delivery → delivered). Dedupe:

- **Primary key:** tracking number. **Fallback:** order number. **Last resort:** `vendor-slug-YYYYMMDD` using the order date (e.g. `amazon-usb-cables-20260601`) — the date suffix keeps repeat orders of the same item distinct.
- **Never merge emails that carry different order numbers.** Same vendor ≠ same shipment: five Amazon orders are five entries. Amazon order numbers look like `114-1234567-1234567` and appear in the subject or body of confirmation emails — extract them whenever present. When you genuinely can't tell whether two emails belong to the same order, keep them as separate entries; a duplicate row is a minor cosmetic issue, a wrongly merged one hides real deliveries (and dismissing it hides them all).
- The **latest** email for a shipment wins for `status` and `eta`.
- Status progression: `ordered` → `shipped` → `out-for-delivery` → `delivered`. Never regress a status (a delayed "shipped" email after a "delivered" one doesn't undo delivery).
- An order that ships in multiple boxes = multiple entries (one per tracking number), each suffixed clearly in `item` (e.g. "Standing desk (box 1 of 2)").
- **ID stability across status changes:** an order first seen as `ordered` gets the order number as its `id`; when it later ships, keep the order-number `id` for the same single-shipment entry rather than re-keying to the tracking number (the dismissed list and UI rely on stable ids). Only introduce tracking-number ids when one order splits into multiple boxes.

## Step 4 — Build each entry

```json
{
  "id": "1Z999AA10123456784",
  "vendor": "Amazon",
  "item": "USB-C cables (2-pack)",
  "category": "package",
  "carrier": "UPS",
  "trackingNumber": "1Z999AA10123456784",
  "trackingUrl": "https://www.ups.com/track?tracknum=1Z999AA10123456784",
  "status": "shipped",
  "eta": "2026-06-05",
  "etaWindow": "by 9 PM",
  "deliveredAt": null,
  "emailThreadId": "<gmail thread id>",
  "emailUrl": "https://mail.google.com/mail/u/0/#all/<gmail thread id>"
}
```

Field notes:

- `category`: `package` | `food` | `pharmacy`
- `item`: short human summary of what's in the box. If the email hides the contents, use the vendor's order description or "Order #12345".
- `trackingUrl`: prefer the link in the email. Otherwise construct from carrier:
  - UPS: `https://www.ups.com/track?tracknum=<num>`
  - FedEx: `https://www.fedex.com/fedextrack/?trknbr=<num>`
  - USPS: `https://tools.usps.com/go/TrackConfirmAction?tLabels=<num>`
  - DHL: `https://www.dhl.com/us-en/home/tracking.html?tracking-id=<num>`
- `eta`: YYYY-MM-DD. Omit (null) if genuinely unknown.
- `etaWindow`: only when the email gives a time window.
- `deliveredAt`: YYYY-MM-DD, only when `status` is `delivered`.

## Step 5 — Lifecycle pruning

Drop entries that are:

- `delivered` with `deliveredAt` more than **2 days** before today
- Dismissed (in `dismissed.json`)
- Older than the 30-day window with no activity and no future ETA (stale/abandoned)

## Step 6 — Write the file

Write `src/content/deliveries/deliveries.json`:

```json
{
  "lastSynced": "<current ISO timestamp, America/New_York>",
  "deliveries": [ ...sorted by ETA ascending, unknown ETAs last, delivered at the end... ]
}
```

Always write the file, even if the list is empty (`"deliveries": []`) — the UI uses the file's mtime to detect sync completion.

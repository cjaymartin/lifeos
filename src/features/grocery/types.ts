// Browser-safe types and constants for the Grocery stack.
// Server-only helpers (file paths, loaders) live in src/lib/grocery.ts.

export type StapleStatus = 'stocked' | 'low' | 'out';
export type ItemSource = 'manual' | 'chat' | 'staple' | 'recipe' | 'scan';
export type Retailer = 'walmart' | 'amazon';
/** When a staple re-adds itself to the list: at Low (default), only at Out, or never */
export type RestockAt = 'low' | 'out' | 'never';

export interface GroceryItem {
  /** Stable id — kebab-case name + short random suffix */
  id: string;
  name: string;
  /** Free-form quantity like "2", "1 lb", "2 dozen" */
  quantity?: string;
  note?: string;
  /** One of DEFAULT_CATEGORIES */
  category: string;
  /** False until the categorize micro-agent (or the user) confirms the category */
  categoryConfirmed?: boolean;
  /** Mirrors an entry in staples.json (matched by normalized name) */
  staple?: boolean;
  /** Checked off while shopping — kept on the list until cleared/checked out */
  checked: boolean;
  addedAt: string;
  source: ItemSource;
  /** Cart builds must match this item at this retailer only */
  buyFrom?: Retailer;
  /** Preferred purchase count — overrides the parsed quantity at build time */
  defaultQty?: number;
}

export interface GroceryData {
  lastUpdated: string;
  items: GroceryItem[];
}

export interface Staple {
  id: string;
  name: string;
  category: string;
  status: StapleStatus;
  /** YYYY-MM-DD of the last recorded purchase (checkout or Gmail scan) */
  lastPurchased?: string;
  /** Auto re-add policy — default 'low' (re-add when Low or Out) */
  restockAt?: RestockAt;
  /** Cart builds must match this staple's items at this retailer only */
  buyFrom?: Retailer;
  /** Preferred purchase count — carried onto the list item when auto-re-added */
  defaultQty?: number;
}

export interface CartMatch {
  /** id of the grocery item this product was matched for */
  itemId: string;
  name: string;
  /** Matched product title at the retailer */
  product?: string;
  price?: string;
  productUrl?: string;
  /** Walmart item id or Amazon ASIN — used to (re)build the bulk cartUrl */
  productId?: string;
  qty?: number;
  /** How many of this line have already been pushed to the retailer cart via
   *  the "Add to cart" button — UI-managed; a fresh build resets it */
  addedQty?: number;
  confidence?: 'high' | 'medium' | 'low';
  /** 'reorder' = exact product from past orders; 'new' = fresh web match */
  source?: 'reorder' | 'new';
  /** Stock state of the matched product (absent ⇒ 'ok') */
  status?: 'ok' | 'out_of_stock' | 'unavailable';
  /** Ranked fallback products when the match is out of stock */
  alternatives?: ProductCandidate[];
  /** The agent auto-picked an alternative — flagged so the UI can surface it */
  substituted?: boolean;
}

/** A candidate product the agent surfaced as a possible match/substitute. */
export interface ProductCandidate {
  productId: string;
  product: string;
  price?: string;
  productUrl?: string;
  /** Free-form size/pack ("52 fl oz", "3-pack") to help the size decision */
  size?: string;
}

export interface RetailerCart {
  retailer: Retailer;
  label: string;
  /** Bulk add-to-cart deep link (opens the retailer cart pre-filled) */
  cartUrl?: string;
  items: CartMatch[];
  /** Item names the agent couldn't match at this retailer */
  unmatched: string[];
  notes?: string;
}

export interface CartsData {
  builtAt: string;
  carts: RetailerCart[];
}

export interface PurchaseRecord {
  date: string;
  name: string;
  quantity?: string;
  source: Retailer | 'in-store' | 'scan';
  orderId?: string;
  /** Set when a later "item unavailable / refunded" email reverses this buy */
  refunded?: boolean;
}

/** A specific retailer product pinned to (or learned for) an item name */
export interface ProductRef {
  retailer: Retailer;
  productId: string;
  product?: string;
  productUrl?: string;
  /** true = set by the user (authoritative; agents must never overwrite) */
  pinned?: boolean;
}

/** Full client state returned by GET /api/grocery */
export interface GroceryState {
  lastUpdated: string;
  items: GroceryItem[];
  staples: Staple[];
  carts: CartsData | null;
  /** normalized item name → preferred/learned product */
  productMap: Record<string, ProductRef>;
}

export const DEFAULT_CATEGORIES = [
  'Produce',
  'Meat & Seafood',
  'Dairy & Eggs',
  'Bakery',
  'Pantry',
  'Frozen',
  'Beverages',
  'Snacks',
  'Household',
  'Personal Care',
  'Other',
] as const;

export const STAPLE_STATUS_ORDER: StapleStatus[] = ['stocked', 'low', 'out'];

export const STAPLE_STATUS_LABELS: Record<StapleStatus, string> = {
  stocked: 'Stocked',
  low: 'Low',
  out: 'Out',
};

export const RETAILER_LABELS: Record<Retailer, string> = {
  walmart: 'Walmart',
  amazon: 'Amazon',
};

/** Plain cart pages — viewing only, never adds anything */
export const RETAILER_CART_URLS: Record<Retailer, string> = {
  walmart: 'https://www.walmart.com/cart',
  amazon: 'https://www.amazon.com/gp/cart/view.html',
};

/** Bulk add-to-cart deep link for a set of products. Opening this URL ADDS
 *  the items to the retailer cart — only call with what should be added. */
export function buildAddToCartUrl(
  retailer: Retailer,
  items: { productId: string; qty?: number }[],
): string | undefined {
  if (items.length === 0) return undefined;
  if (retailer === 'walmart') {
    const parts = items.map(m => (m.qty && m.qty > 1 ? `${m.productId}_${m.qty}` : m.productId));
    return `https://affil.walmart.com/cart/addToCart?items=${parts.join(',')}`;
  }
  if (retailer === 'amazon') {
    const params = items.map((m, i) => `ASIN.${i + 1}=${m.productId}&Quantity.${i + 1}=${m.qty ?? 1}`);
    return `https://www.amazon.com/gp/aws/cart/add.html?${params.join('&')}`;
  }
  return undefined;
}

/** Normalize a name for matching items ↔ staples ("Whole Milk " → "whole milk") */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

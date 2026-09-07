# Loomdesk
One WhatsApp number. Every answer, from your own stock.

Loomdesk is a shared WhatsApp inbox for a clothing business: several
support agents log in with their own username/password, all replying from
one connected WhatsApp Business number, with live inventory and order
data sitting right next to the chat so questions about stock, sales,
refunds and tracking can be answered in seconds — or eventually,
auto-answered.

## What's in this repo

This is the **MVP UI only** — a static frontend, no backend, no database.
Every agent, conversation, product, and order is hardcoded in
[`data.json`](data.json) and loaded into the page at runtime. Nothing you
do in the UI is saved anywhere except who's logged in (kept in
`sessionStorage` for the tab).

- `index.html` — login screen + the app shell (Inbox, Inventory, Orders, Dashboard)
- `css/style.css` — the whole visual design (white theme)
- `js/app.js` — all UI logic (login, chat, tables, filters, quick replies)
- `data.json` — mock agents, WhatsApp conversations, products/inventory, orders

## Running it

The app loads `data.json` with `fetch()`, which most browsers block if you
just double-click `index.html` (`file://` origin). Serve the folder instead:

```bash
npx serve .
# or
python -m http.server 8080
```

Then open the printed local URL. Any of the demo accounts on the login
screen (click one to autofill) will get you in — they all share the one
connected WhatsApp number shown in the top bar.

## What's demoed

- **Inbox** — conversation list with search/filters (All, Unassigned,
  Mine, Resolved), WhatsApp-style chat thread, assign-to-agent, mark
  resolved, and **quick replies** that pull live text out of `data.json`
  ("Check Stock" opens a product picker and inserts real variant/stock
  text into the composer; "Order Status" / "Send Tracking" pull the
  customer's most recent order) — a working preview of the
  auto-reply-from-inventory idea, all client-side.
- **Inventory** — searchable/filterable product table, variant-level
  stock, computed In Stock / Low Stock / Out of Stock status, stock value.
- **Orders** — searchable/filterable order table (Paid, Shipped,
  Delivered, Pending, Refunded), order detail modal, jump straight back
  into the matching conversation.
- **Dashboard** — quick snapshot: open conversations, unread count,
  latest day's sales, stock alerts.

## Next steps (not built yet)

This UI has no backend by design. Turning it into the real product means
wiring it to an actual WhatsApp Business API (e.g. a provider like Zoko,
or the Cloud API directly), a real inventory/orders database, and a rules
or LLM layer that drafts (or sends) replies from that data.

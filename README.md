# NMR Spec Sheet Library

A shopping-cart-style library for hardware spec sheets: browse, add sheets to a "case," and export a combined PDF to send to clients.

## What's here

- `public/index.html` + `public/js/catalog.js` — the public catalog and cart (this is what clients see)
- `public/admin.html` + `public/js/admin.js` — password-gated page for your team to upload/manage spec sheets
- `netlify/functions/catalog.js` — public read-only list of spec sheets
- `netlify/functions/admin-catalog.js` — upload / edit / delete (requires admin key)
- `netlify/functions/export.js` — merges selected spec sheets into one PDF and streams it back
- Storage: **Netlify Blobs** — the PDFs and the catalog index live there, no separate database needed

## One-time setup

1. **Create a new Netlify site** from this folder (drag-and-drop the folder in the Netlify dashboard, or connect it to a git repo — either works since it's just static files + functions).
2. **Set an admin password**: in the Netlify site's Environment Variables, add:
   - `ADMIN_PASSWORD` = a password only your team knows (this gates the `/admin.html` page)
3. **Point your subdomain** at the new site (e.g. `specs.kevdub.com`) — Domain settings → Add custom domain, then a CNAME record wherever your DNS lives.
4. Netlify Blobs needs no extra setup — it's automatically available to functions on any Netlify site.

## Day to day

- Your team uploads PDFs at `yoursite.com/admin.html` (enter the admin password once per browser session).
- Clients browse and build their cart at `yoursite.com/` — no login needed.
- Hitting "Export Combined PDF" merges the selected sheets, in the order they were added, into one PDF and downloads it — ready to attach to an email.

## Notes / assumptions I made

- **Flat catalog with category filter + search**, not a deep folder hierarchy — easy to change if you want subcategories.
- **Export = direct download** in the browser, not an auto-email. If you'd rather have it email the client directly (e.g. via a "send to" field), that's a small addition to `export.js` using an email API — happy to wire that up next.
- The admin check is a single shared password via `x-admin-key` header — fine for a small internal team, but if you want individual staff logins later, Netlify Identity is a natural upgrade.
- Preview button opens a single spec sheet in a new tab (reuses the export function with one ID).

## Local testing

```bash
npm install
npx netlify dev
```
This runs the site + functions locally with a local Blobs store, so you can upload a couple of test PDFs and try the full flow before it's live.

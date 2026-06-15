# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ZenithOne Credit Union is a luxury banking web application built with **vanilla HTML/CSS/JavaScript** on the frontend and **Supabase** (PostgreSQL + Deno Edge Functions) on the backend. There is no build system, no framework, no package manager — all dependencies load from CDN.

## Running Locally

```bash
# Any static file server works — port 5500 matches Supabase auth redirect config
python -m http.server 5500
# or
npx serve src/
```

Visit `http://localhost:5500`. The app runs in **demo mode** automatically when Supabase is unreachable — no credentials needed for UI development.

## Supabase / Edge Functions

```bash
npm install -g supabase
supabase login
supabase link --project-ref tfxuhnusogtwqukfypxb

# Deploy a single function
supabase functions deploy <function-name>

# Deploy all functions
supabase functions deploy account-summary transfer-funds transaction-history card-operations investment-data card-request admin-data get-public-config transaction-pin
```

Database schema is managed via SQL migration files in `supabase/migrations/`. Apply them by pasting into the Supabase Dashboard SQL Editor — migrations are written to be idempotent.

## Architecture

### Credential Bootstrap

No Supabase credentials are stored in the frontend source. On page load, `src/js/supabase-config.js` fetches the project URL and anon key from the `get-public-config` edge function (which reads them from Supabase Vault secrets). Only after that resolves does it initialize `window._supabase` and fire a custom `supabaseReady` DOM event.

All JS modules that need Supabase must listen for this event before acting:
```js
document.addEventListener('DOMContentLoaded', init);
document.addEventListener('supabaseReady', init); // fires if Supabase loads after DOMContentLoaded
```

### Auth Guard

`src/js/auth.js` defines `PUBLIC_PAGES` and `PRIVATE_PAGES` arrays and runs `checkAuthGuard()` on every page load. Private pages redirect to `login.html` if no session exists; the login/signup pages redirect to `dashboard.html` if already authenticated.

Session persistence is controlled by two `localStorage` keys: `zo_remember` (`"1"`) and `zo_remember_until` (Unix timestamp). When active, the custom Supabase `storage` adapter in `supabase-config.js` routes session tokens to `localStorage`; otherwise it uses `sessionStorage`.

Face ID / WebAuthn logout uses `scope: 'local'` (preserves the refresh token for biometric re-entry) while standard logout uses `scope: 'global'`.

### Calling Edge Functions

All authenticated API calls go through the `callEdgeFunction(name, body)` helper defined in `supabase-config.js`. It awaits the bootstrap promise, grabs the current JWT from `window._supabase.auth.getSession()`, and POSTs to `https://tfxuhnusogtwqukfypxb.supabase.co/functions/v1/<name>` with `Authorization: Bearer <token>` and `apikey: <anon_key>` headers.

### Page / Module Structure

Each HTML page in `src/` has a paired JS module in `src/js/`:

| Page | Module | Edge Function |
|------|--------|---------------|
| `dashboard.html` | `dashboard.js` | `account-summary` |
| `accounts.html` | `accounts.js` | direct Supabase client |
| `transactions.html` | `transactions.js` | `transaction-history` |
| `transfer.html` | `transfer.js` | `transfer-funds` |
| `cards.html` | `cards.js` | `card-operations`, `card-request` |
| `investments.html` | `investments.js` | `investment-data` |
| `settings.html` | `settings.js` | direct Supabase client |

Public informational pages (`index.html`, `about.html`, `services.html`, etc.) have no paired JS module.

### Database

All tables use **Row Level Security (RLS)** — users can only query their own rows. Edge Functions use the Supabase service role key (server-side only) to bypass RLS when needed for aggregations. There is no ORM; queries use the Supabase JS client directly against PostgREST.

Balance integrity is maintained by PostgreSQL triggers: transactions automatically update `accounts.balance` on insert/update.

### UI System

- **Design tokens:** navy (`#0a1525`, `#0d1e35`) + gold (`#c9a84c`, `#e8d07a`) throughout
- **Typography:** Cormorant Garamond (display/serif), Inter (body/sans-serif) — loaded from Google Fonts
- **`style.css`** — global design system, layout, components
- **`responsive.css`** — mobile overrides (imported separately in each HTML page)
- **`window.zenithToast(message, type, duration)`** — toast notifications (`type`: `'success' | 'error' | 'info' | 'warning'`), defined in `supabase-config.js`
- **`window.zenithConfirm(message, options)`** — returns a `Promise<boolean>`, used for destructive-action confirmation dialogs

### Session Lock

On private pages, `checkAuthGuard()` calls `window._startSessionLock()` (defined inline in `auth.js`). This locks the UI after 2 minutes of inactivity with an overlay requiring Face ID or password re-entry.

## Deployment

Frontend deploys to Vercel. `vercel.json` sets `outputDirectory: "src"`, so all files in `src/` become the web root. Backend is Supabase managed infrastructure.

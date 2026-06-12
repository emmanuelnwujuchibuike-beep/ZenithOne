# ZenithOne Credit Union — Setup Guide

## Project Structure

```
Banking website/
├── index.html            ← Landing page
├── login.html            ← Sign in
├── signup.html           ← Registration (4-step)
├── dashboard.html        ← Main app dashboard
├── accounts.html         ← Account overview
├── transactions.html     ← Transaction history
├── transfer.html         ← Fund transfers & Zelle
├── cards.html            ← Card management
├── investments.html      ← Investment portfolio
├── settings.html         ← Profile & settings
├── style.css             ← Global design system
├── js/
│   ├── supabase-config.js  ← Supabase client + helpers
│   ├── auth.js             ← Authentication & session guard
│   ├── dashboard.js        ← Dashboard data loading
│   ├── accounts.js         ← Accounts module
│   ├── transactions.js     ← Transactions module
│   ├── transfer.js         ← Transfer logic
│   ├── cards.js            ← Card management
│   ├── investments.js      ← Investments module
│   └── settings.js         ← Settings module
└── supabase/
    ├── config.toml
    ├── migrations/
    │   └── 20240101000000_initial_schema.sql   ← Full DB schema
    └── functions/
        ├── account-summary/index.ts
        ├── transfer-funds/index.ts
        ├── transaction-history/index.ts
        ├── card-operations/index.ts
        └── investment-data/index.ts
```

---

## Step 1 — Create a Supabase Project

1. Go to https://app.supabase.com and sign in
2. Click **New Project** → choose your organization
3. Set a database password and select **US East** region
4. Wait ~2 minutes for the project to provision

---

## Step 2 — Run Database Migrations

In the Supabase Dashboard → **SQL Editor**, paste the contents of:
```
supabase/migrations/20240101000000_initial_schema.sql
```
Click **Run**. This creates all tables, RLS policies, and triggers.

---

## Step 3 — Configure Your Credentials

Open `js/supabase-config.js` and replace the placeholder values:

```js
const SUPABASE_URL      = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_ANON_PUBLIC_KEY';
```

Find these in: Supabase Dashboard → **Settings → API**
- **Project URL** → `SUPABASE_URL`
- **anon public** key → `SUPABASE_ANON_KEY`

---

## Step 4 — Deploy Edge Functions

Install the Supabase CLI:
```bash
npm install -g supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

Deploy all functions:
```bash
supabase functions deploy account-summary
supabase functions deploy transfer-funds
supabase functions deploy transaction-history
supabase functions deploy card-operations
supabase functions deploy investment-data
```

---

## Step 5 — Configure Auth

In Supabase Dashboard → **Authentication → Settings**:
- Set **Site URL** to your domain (e.g., `https://meridianbank.com` or `http://localhost:5500`)
- Add redirect URLs for your local dev server
- Enable **Email Confirmations**
- Set **Minimum password length** to 12

---

## Step 6 — Run the Website

Open `index.html` in a browser via a local server:

```bash
# Using VS Code Live Server, or:
npx serve .
# or
python -m http.server 5500
```

Visit `http://localhost:5500` to see the landing page.

---

## Demo Mode

All pages work in **demo mode** without Supabase configured. The UI populates with realistic sample data. To test the full authentication and database flow, complete Steps 1–5.

---

## Tech Stack

| Layer         | Technology                     |
|---------------|-------------------------------|
| Frontend      | Vanilla HTML/CSS/JS            |
| Design System | Custom CSS (Cormorant + Inter) |
| Auth          | Supabase Auth (email + OTP)    |
| Database      | Supabase (PostgreSQL + RLS)    |
| Backend API   | Supabase Edge Functions (Deno) |
| Realtime      | Supabase Realtime              |
| Charts        | HTML5 Canvas (custom)          |

---

## Security Features Implemented

- Row Level Security (RLS) on all tables — users only access their own data
- JWT authentication via Supabase Auth on every Edge Function
- Daily and per-transaction transfer limits enforced server-side
- Audit log for all sensitive operations
- Password minimum 12 characters enforced
- Automatic balance update triggers prevent inconsistency
- CORS headers on all Edge Functions

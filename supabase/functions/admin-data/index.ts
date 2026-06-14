/**
 * ZenithOne Credit Union — Admin Data Edge Function
 * Requires is_admin = true in the caller's profile.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, errJson, getAuthToken } from '../_shared/cors.ts';
import { generateCardNumber, formatPan } from '../_shared/cards.ts';

// ── Credit limit defaults per card type ────────────────────────────────────────
const CARD_LIMITS: Record<string, number> = {
  virtual: 0, classic_debit: 0, gold: 5000, platinum: 15000,
  titanium: 30000, black: 75000, black_gold: 150000, business: 25000,
};

const CARD_CATALOG_DEF: Record<string, { name: string; tier: string; category: string; fee: number; gradient: string }> = {
  virtual:       { name: 'ZenithOne Virtual',   tier: 'standard', category: 'debit',  fee: 249,  gradient: 'linear-gradient(135deg,#1a3a5c,#0d2840)' },
  classic_debit: { name: 'ZenithOne Classic',   tier: 'standard', category: 'debit',  fee: 299,  gradient: 'linear-gradient(135deg,#1e293b,#0f172a)' },
  gold:          { name: 'ZenithOne Gold',      tier: 'premium',  category: 'credit', fee: 399,  gradient: 'linear-gradient(135deg,#b8860b,#8b6914)' },
  platinum:      { name: 'ZenithOne Platinum',  tier: 'premium',  category: 'credit', fee: 549,  gradient: 'linear-gradient(135deg,#718096,#4a5568)' },
  titanium:      { name: 'ZenithOne Titanium',  tier: 'private',  category: 'credit', fee: 749,  gradient: 'linear-gradient(135deg,#9ca3af,#6b7280)' },
  black:         { name: 'ZenithOne Black',     tier: 'black',    category: 'credit', fee: 999,  gradient: 'linear-gradient(135deg,#111827,#000000)' },
  black_gold:    { name: 'Black Gold Elite',    tier: 'black',    category: 'credit', fee: 1299, gradient: 'linear-gradient(135deg,#1a0a00,#c9a84c)' },
  business:      { name: 'Business Platinum',   tier: 'premium',  category: 'credit', fee: 699,  gradient: 'linear-gradient(135deg,#1e3a5f,#0a1929)' },
};

// Network surcharges added on top of the base fee (kept in sync with card-request).
const NETWORK_SURCHARGE: Record<string, number> = {
  'Visa': 0, 'Discover': 30, 'Mastercard': 60, 'American Express': 120,
};

// Infer a card's US network from its name. Explicit network words win; a bare
// "classic"/"classic debit" (legacy name with no network) falls back to Mastercard.
function networkForCard(name: string): string {
  const n = (name || '').toLowerCase();
  if (n.includes('mastercard')) return 'Mastercard';
  if (n.includes('amex') || n.includes('american express')) return 'American Express';
  if (n.includes('discover')) return 'Discover';
  if (n.includes('visa')) return 'Visa';
  if (n.includes('classic')) return 'Mastercard';
  return 'Visa';
}

// ── Ultra-premium 3D approval email sent to user when card is approved ─────────
function approvalEmailHtml(
  userName: string, cardName: string, cardTier: string,
  lastFour: string, expiryMonth: number, expiryYear: number,
  gradient: string, creditLimit: number, cardNumber: string,
): string {
  const expiry    = `${String(expiryMonth).padStart(2,'0')}/${String(expiryYear).slice(-2)}`;
  const limitFmt  = creditLimit > 0 ? '$' + creditLimit.toLocaleString('en-US') : 'See portal';
  const tierLabel = (cardTier || 'standard').toUpperCase().replace('_',' ');
  const yr        = new Date().getFullYear();
  const first     = userName.split(' ')[0];

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Your ${cardName} Is Approved</title>
<style>
@keyframes shimmer{0%{background-position:-500px 0}100%{background-position:500px 0}}
</style>
</head>
<body style="margin:0;padding:0;background:#030b16;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="background:linear-gradient(180deg,#030b16 0%,#060e1c 100%);padding:48px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Logo row -->
  <tr><td style="text-align:center;padding-bottom:40px;">
    <div style="font-size:10px;letter-spacing:5px;color:rgba(201,168,76,.55);text-transform:uppercase;margin-bottom:8px;">ZenithOne Credit Union</div>
    <div style="width:50px;height:1px;background:linear-gradient(90deg,transparent,#c9a84c,transparent);margin:0 auto 12px;"></div>
    <div style="display:inline-block;font-size:9px;letter-spacing:3px;color:#c9a84c;text-transform:uppercase;border:1px solid rgba(201,168,76,.3);padding:4px 16px;border-radius:99px;background:rgba(201,168,76,.05);">${tierLabel}</div>
  </td></tr>

  <!-- Approved headline -->
  <tr><td style="text-align:center;padding:0 16px 36px;">
    <div style="font-size:11px;letter-spacing:4px;color:#4ade80;text-transform:uppercase;margin-bottom:14px;">✦ &nbsp; Application Approved &nbsp; ✦</div>
    <div style="font-size:38px;font-weight:200;color:#ffffff;letter-spacing:-1px;line-height:1.15;margin-bottom:14px;">Congratulations,<br/>${first}.</div>
    <div style="font-size:14px;color:#475569;line-height:1.8;max-width:420px;margin:0 auto;">
      Your <strong style="color:#c9a84c;">${cardName}</strong> has been approved and activated on your account. It's ready to use right now.
    </div>
  </td></tr>

  <!-- ══ 3D Card ══ -->
  <tr><td align="center" style="padding:0 16px 40px;">
    <!-- Outer shadow/depth layer -->
    <div style="display:inline-block;position:relative;filter:drop-shadow(0 40px 60px rgba(0,0,0,.9)) drop-shadow(0 0 40px rgba(201,168,76,.12));">
      <!-- Depth cast (layered pseudo-card) -->
      <div style="position:absolute;top:10px;left:12px;right:-12px;bottom:-10px;background:rgba(0,0,0,.55);border-radius:20px;"></div>
      <div style="position:absolute;top:5px;left:6px;right:-6px;bottom:-5px;background:rgba(0,0,0,.35);border-radius:20px;"></div>
      <!-- Main card -->
      <div style="
        position:relative;
        background:${gradient};
        border-radius:20px;
        width:380px;max-width:calc(100vw - 48px);
        padding:32px 28px 28px;
        border:1px solid rgba(255,255,255,.15);
        box-shadow:
          0 1px 0 rgba(255,255,255,.2) inset,
          0 -1px 0 rgba(0,0,0,.5) inset;
        overflow:hidden;
      ">
        <!-- Shimmer sweep -->
        <div style="
          position:absolute;top:0;left:0;right:0;bottom:0;
          background:linear-gradient(105deg,transparent 25%,rgba(255,255,255,.10) 50%,transparent 75%);
          background-size:600px 100%;
          animation:shimmer 3.5s infinite linear;
          pointer-events:none;z-index:1;
        "></div>
        <!-- Holographic glow -->
        <div style="position:absolute;top:-50px;right:-50px;width:210px;height:210px;border-radius:50%;background:radial-gradient(circle,rgba(201,168,76,.20) 0%,transparent 68%);pointer-events:none;z-index:1;"></div>
        <!-- Top edge highlight -->
        <div style="position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.4),transparent);"></div>
        <!-- Content -->
        <div style="position:relative;z-index:2;">
          <!-- Header row -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:22px;">
            <div>
              <div style="font-size:9px;letter-spacing:4px;color:rgba(255,255,255,.3);text-transform:uppercase;margin-bottom:2px;">ZenithOne</div>
              <div style="font-size:15px;color:rgba(255,255,255,.85);font-weight:300;letter-spacing:.3px;">${cardName}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:8px;letter-spacing:2px;color:#4ade80;text-transform:uppercase;border:1px solid rgba(74,222,128,.3);padding:2px 8px;border-radius:99px;background:rgba(74,222,128,.06);">ACTIVE</div>
            </div>
          </div>
          <!-- Chip -->
          <div style="
            width:46px;height:36px;border-radius:6px;margin-bottom:22px;
            background:linear-gradient(135deg,#f0d060 0%,#d4a830 35%,#a07020 65%,#e8c050 100%);
            box-shadow:0 2px 8px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.25) inset;
            position:relative;overflow:hidden;
          ">
            <div style="position:absolute;top:50%;left:0;right:0;height:1px;background:rgba(0,0,0,.25);"></div>
            <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(0,0,0,.15);"></div>
          </div>
          <!-- Card number -->
          <div style="font-size:17px;letter-spacing:4px;color:rgba(255,255,255,.82);margin-bottom:22px;font-family:'Courier New',Courier,monospace;">${cardNumber}</div>
          <!-- Bottom row -->
          <div style="display:flex;justify-content:space-between;align-items:flex-end;">
            <div>
              <div style="font-size:8px;letter-spacing:2px;color:rgba(255,255,255,.25);text-transform:uppercase;margin-bottom:4px;">Cardholder</div>
              <div style="font-size:13px;color:rgba(255,255,255,.8);letter-spacing:2px;text-transform:uppercase;">${userName}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:8px;letter-spacing:2px;color:rgba(255,255,255,.25);text-transform:uppercase;margin-bottom:4px;">Expires</div>
              <div style="font-size:13px;color:rgba(255,255,255,.7);letter-spacing:3px;font-family:'Courier New',Courier,monospace;">${expiry}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </td></tr>

  <!-- Details -->
  <tr><td style="padding:0 16px 36px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:rgba(255,255,255,.022);border:1px solid rgba(255,255,255,.07);border-radius:14px;overflow:hidden;">
      <tr>
        <td width="50%" style="padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.05);">
          <div style="font-size:9px;letter-spacing:2px;color:#334155;text-transform:uppercase;margin-bottom:6px;">Card Ending</div>
          <div style="font-size:16px;color:#c9a84c;font-family:'Courier New',Courier,monospace;letter-spacing:4px;">•••• ${lastFour}</div>
        </td>
        <td width="50%" style="padding:18px 22px;border-bottom:1px solid rgba(255,255,255,.05);border-left:1px solid rgba(255,255,255,.05);">
          <div style="font-size:9px;letter-spacing:2px;color:#334155;text-transform:uppercase;margin-bottom:6px;">Expires</div>
          <div style="font-size:16px;color:#e2e8f0;font-family:'Courier New',Courier,monospace;letter-spacing:3px;">${expiry}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:18px 22px;">
          <div style="font-size:9px;letter-spacing:2px;color:#334155;text-transform:uppercase;margin-bottom:6px;">Card</div>
          <div style="font-size:14px;color:#e2e8f0;">${cardName}</div>
        </td>
        <td style="padding:18px 22px;border-left:1px solid rgba(255,255,255,.05);">
          <div style="font-size:9px;letter-spacing:2px;color:#334155;text-transform:uppercase;margin-bottom:6px;">Credit Limit</div>
          <div style="font-size:16px;color:#4ade80;font-family:'Courier New',Courier,monospace;">${limitFmt}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Message -->
  <tr><td style="padding:0 16px 40px;text-align:center;">
    <div style="font-size:13px;color:#334155;line-height:1.85;">Log in to your ZenithOne portal to view your card details,<br/>set spending limits, and start using your card today.</div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:24px 16px 0;border-top:1px solid rgba(255,255,255,.04);text-align:center;">
    <div style="font-size:10px;letter-spacing:.5px;color:#1e293b;line-height:1.9;">
      © ${yr} ZenithOne Credit Union. Member NCUA.<br/>
      This is an automated notification. Please do not reply to this email.
    </div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return cors();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = getAuthToken(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) throw new Error('Unauthorized');

    // Parse body once — must happen before any body reads below
    const body = await req.json() as { action?: string; [k: string]: unknown };
    const action = body.action ?? 'stats';

    // ── Minimum credit scores per loan type ───────────────────────────────────
    const LOAN_MIN_SCORES: Record<string, number> = {
      personal: 580, auto: 600, mortgage: 620,
      student: 560, business: 640, heloc: 640, credit_line: 600,
    };
    // Default APR per loan type (stored as decimal, e.g. 0.065 = 6.5%)
    const LOAN_DEFAULT_RATES: Record<string, number> = {
      personal: 0.1299, auto: 0.0799, mortgage: 0.0699,
      student: 0.0549, business: 0.1099, heloc: 0.0849, credit_line: 0.1799,
    };

    // ── USER ACTION: submit a loan application ─────────────────────────────────
    if (action === 'apply_loan') {
      const { loan_type, loan_name, requested_amount, term_months, purpose } =
        body as { action: string; loan_type: string; loan_name: string;
                  requested_amount: number; term_months?: number; purpose?: string };
      if (!loan_type)         throw new Error('loan_type required');
      if (!loan_name)         throw new Error('loan_name required');
      if (!requested_amount || requested_amount <= 0) throw new Error('requested_amount must be > 0');

      const { data: cp } = await supabase
        .from('credit_profiles').select('credit_score, total_credit_limit')
        .eq('user_id', user.id).maybeSingle();

      if (!cp || !cp.credit_score)
        throw new Error('No credit profile found. Please contact your branch officer.');

      const minScore = LOAN_MIN_SCORES[loan_type] ?? 580;
      if (cp.credit_score < minScore)
        throw new Error(
          `Your credit score (${cp.credit_score}) does not meet the minimum of ${minScore} required for this loan type.`
        );

      const maxAmount = Number(cp.total_credit_limit ?? 0);
      if (maxAmount <= 0)
        throw new Error('No credit limit established. Please contact your branch officer.');
      if (Number(requested_amount) > maxAmount)
        throw new Error(
          `Requested amount exceeds your approved credit limit of $${maxAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}.`
        );

      // Prevent duplicate pending applications for same type
      const { data: existing } = await supabase
        .from('loan_applications')
        .select('id')
        .eq('user_id', user.id)
        .eq('loan_type', loan_type)
        .eq('status', 'pending')
        .maybeSingle();
      if (existing)
        throw new Error('You already have a pending application for this loan type.');

      const { data: app, error: insErr } = await supabase.from('loan_applications').insert({
        user_id:   user.id, loan_type, loan_name,
        requested_amount: Number(requested_amount),
        term_months: term_months ?? null,
        purpose: purpose ?? null,
        status: 'pending',
        credit_score_at_application: cp.credit_score,
        credit_limit_at_application: cp.total_credit_limit,
      }).select().single();
      if (insErr) throw insErr;
      return json({ success: true, application: app });
    }

    // ── USER ACTION: fetch own loan applications ───────────────────────────────
    if (action === 'get_my_loan_applications') {
      const { data, error: selErr } = await supabase
        .from('loan_applications').select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (selErr) throw selErr;
      return json({ applications: data ?? [] });
    }

    // ── USER ACTION: close (delete) an account ──────────────────────────────────
    if (action === 'delete_account') {
      const { account_id } = body as { action: string; account_id: string };
      if (!account_id) throw new Error('account_id is required.');

      // Fetch account (must belong to caller)
      const { data: acct, error: acctErr } = await supabase
        .from('accounts').select('*').eq('id', account_id).eq('user_id', user.id).single();
      if (acctErr || !acct) throw new Error('Account not found.');

      // Block savings accounts
      if (acct.account_type === 'savings')
        throw new Error('Savings accounts cannot be closed. Please contact support if you need assistance.');

      // Block if balance > $0.01
      if ((acct.balance ?? 0) > 0.01)
        throw new Error(`Please transfer your remaining balance of $${Number(acct.balance).toFixed(2)} before closing this account.`);

      // Rate limit: 1 closure per 30 days
      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const { data: recent } = await supabase
        .from('accounts').select('closed_at').eq('user_id', user.id)
        .eq('status', 'closed').gte('closed_at', cutoff).limit(1);
      if (recent?.length) {
        const next = new Date(new Date(recent[0].closed_at).getTime() + 30 * 24 * 60 * 60 * 1000);
        const fmt  = next.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
        throw new Error(`You may only close one account every 30 days. Your next closure window opens on ${fmt}.`);
      }

      // Soft-close
      const closedAt = new Date().toISOString();
      const { error: closeErr } = await supabase
        .from('accounts').update({ status: 'closed', closed_at: closedAt }).eq('id', account_id);
      if (closeErr) throw closeErr;

      // Fetch caller profile + email for emails
      const { data: profile } = await supabase
        .from('profiles').select('full_name').eq('id', user.id).single();
      const { data: authData } = await supabase.auth.admin.getUserById(user.id);
      const userEmail  = authData?.user?.email ?? '';
      const userName   = (profile?.full_name as string) || userEmail.split('@')[0] || 'Member';
      const typeLabel  = { checking:'Checking', money_market:'Money Market', investment:'Investment',
                           cd:'Certificate of Deposit', business:'Business', savings:'Savings' }[acct.account_type as string] ?? acct.account_type;
      const last4      = String(acct.account_number ?? '').slice(-4);
      const closedFmt  = new Date(closedAt).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
      const closedTime = new Date(closedAt).toLocaleTimeString('en-US', { hour:'2-digit', minute:'2-digit', timeZoneName:'short' });
      const yr         = new Date().getFullYear();
      const first      = userName.split(' ')[0];

      // ── USER EMAIL — ultra-premium dark luxury ────────────────────────────────
      const userHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="dark"/>
<title>Account Closed — ZenithOne</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Inter:wght@300;400;500;600&display=swap');
@keyframes shimmerSweep{0%{background-position:-600px 0}100%{background-position:600px 0}}
</style>
</head>
<body style="margin:0;padding:0;background:#030b16;font-family:'Inter','Helvetica Neue',Arial,sans-serif;-webkit-font-smoothing:antialiased;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:linear-gradient(180deg,#030b16 0%,#05101f 50%,#030b16 100%);min-height:100vh;padding:48px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Gold accent top bar -->
  <tr><td style="padding-bottom:0;">
    <div style="height:2px;background:linear-gradient(90deg,transparent 0%,#7b5c0a 5%,#c9a84c 35%,#e8d07a 50%,#c9a84c 65%,#7b5c0a 95%,transparent 100%);border-radius:2px;margin-bottom:0;"></div>
  </td></tr>

  <!-- Header card -->
  <tr><td>
    <div style="background:linear-gradient(145deg,#0d1828 0%,#071020 100%);border:1px solid rgba(201,168,76,.18);border-top:none;border-radius:0 0 0 0;padding:36px 40px 28px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:9px;letter-spacing:5px;color:rgba(201,168,76,.55);text-transform:uppercase;margin-bottom:8px;font-family:'Inter',Arial,sans-serif;">ZenithOne Credit Union</div>
            <div style="width:40px;height:1px;background:linear-gradient(90deg,#c9a84c,transparent);margin-bottom:20px;"></div>
            <div style="font-family:'Cormorant Garamond','Georgia',serif;font-size:36px;font-weight:300;color:#ffffff;line-height:1.1;letter-spacing:-.01em;margin-bottom:6px;">Account<br/><em style="font-style:italic;color:rgba(255,255,255,.65);">Closed</em></div>
          </td>
          <td style="text-align:right;vertical-align:top;padding-top:4px;">
            <div style="display:inline-block;background:rgba(248,113,113,.1);border:1px solid rgba(248,113,113,.3);border-radius:8px;padding:8px 14px;">
              <div style="font-size:9px;letter-spacing:3px;color:rgba(248,113,113,.7);text-transform:uppercase;margin-bottom:2px;">Status</div>
              <div style="font-size:13px;font-weight:600;color:#fca5a5;letter-spacing:.04em;">CLOSED</div>
            </div>
          </td>
        </tr>
      </table>
    </div>
  </td></tr>

  <!-- Divider -->
  <tr><td style="padding:0;">
    <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.2),transparent);"></div>
  </td></tr>

  <!-- Body -->
  <tr><td>
    <div style="background:linear-gradient(180deg,#07111e 0%,#060e1a 100%);border:1px solid rgba(255,255,255,.06);border-top:none;border-bottom:none;padding:32px 40px;">

      <p style="font-size:15px;color:rgba(255,255,255,.7);line-height:1.75;margin:0 0 28px;font-weight:300;">
        Dear ${first},<br/><br/>
        We're writing to confirm that your ZenithOne account has been <strong style="color:rgba(255,255,255,.9);font-weight:500;">successfully closed</strong> as requested. All associated services have been deactivated effective immediately.
      </p>

      <!-- Account detail card -->
      <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:14px;padding:24px 28px;margin-bottom:28px;position:relative;overflow:hidden;">
        <div style="position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.25),transparent);"></div>
        <div style="font-size:9px;letter-spacing:4px;color:rgba(201,168,76,.5);text-transform:uppercase;margin-bottom:16px;">Account Summary</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding-bottom:14px;">
              <div style="font-size:11px;color:rgba(255,255,255,.35);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Account Type</div>
              <div style="font-size:15px;color:rgba(255,255,255,.88);font-weight:400;">${typeLabel} Account</div>
            </td>
            <td style="padding-bottom:14px;text-align:right;">
              <div style="font-size:11px;color:rgba(255,255,255,.35);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Account Number</div>
              <div style="font-size:15px;color:rgba(255,255,255,.88);font-family:'Courier New',monospace;letter-spacing:.1em;">•••• •••• ${last4}</div>
            </td>
          </tr>
          <tr>
            <td colspan="2" style="border-top:1px solid rgba(255,255,255,.06);padding-top:14px;">
              <div style="font-size:11px;color:rgba(255,255,255,.35);letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Closure Date &amp; Time</div>
              <div style="font-size:14px;color:rgba(255,255,255,.75);">${closedFmt} &nbsp;·&nbsp; ${closedTime}</div>
            </td>
          </tr>
        </table>
      </div>

      <!-- What's next -->
      <div style="margin-bottom:28px;">
        <div style="font-size:9px;letter-spacing:4px;color:rgba(201,168,76,.5);text-transform:uppercase;margin-bottom:14px;">What Happens Next</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="vertical-align:top;padding-right:14px;padding-bottom:12px;width:28px;">
              <div style="width:24px;height:24px;border-radius:7px;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.2);display:flex;align-items:center;justify-content:center;text-align:center;line-height:24px;font-size:11px;color:#c9a84c;font-weight:600;">1</div>
            </td>
            <td style="vertical-align:top;padding-bottom:12px;">
              <div style="font-size:13px;color:rgba(255,255,255,.75);line-height:1.6;">All pending transactions will be processed within <strong style="color:rgba(255,255,255,.88);">3–5 business days</strong>.</div>
            </td>
          </tr>
          <tr>
            <td style="vertical-align:top;padding-right:14px;padding-bottom:12px;width:28px;">
              <div style="width:24px;height:24px;border-radius:7px;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.2);display:flex;align-items:center;justify-content:center;text-align:center;line-height:24px;font-size:11px;color:#c9a84c;font-weight:600;">2</div>
            </td>
            <td style="vertical-align:top;padding-bottom:12px;">
              <div style="font-size:13px;color:rgba(255,255,255,.75);line-height:1.6;">Your account statements remain accessible through the <strong style="color:rgba(255,255,255,.88);">ZenithOne portal</strong> for 7 years.</div>
            </td>
          </tr>
          <tr>
            <td style="vertical-align:top;padding-right:14px;width:28px;">
              <div style="width:24px;height:24px;border-radius:7px;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.2);display:flex;align-items:center;justify-content:center;text-align:center;line-height:24px;font-size:11px;color:#c9a84c;font-weight:600;">3</div>
            </td>
            <td style="vertical-align:top;">
              <div style="font-size:13px;color:rgba(255,255,255,.75);line-height:1.6;">You may open a new account at any time. We'd be honoured to continue serving you.</div>
            </td>
          </tr>
        </table>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:8px;">
        <a href="https://zenithonecreditunion.com" style="display:inline-block;background:linear-gradient(135deg,#b8860b,#c9a84c,#e8c96a);color:#050d0a;font-size:13px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:14px 32px;border-radius:10px;text-decoration:none;">Visit Member Portal</a>
      </div>

    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td>
    <div style="background:#020810;border:1px solid rgba(255,255,255,.05);border-top:none;border-radius:0 0 14px 14px;padding:24px 40px;text-align:center;">
      <div style="height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.07),transparent);margin-bottom:20px;"></div>
      <div style="font-size:10px;letter-spacing:3px;color:rgba(201,168,76,.3);text-transform:uppercase;margin-bottom:10px;">ZenithOne Credit Union</div>
      <div style="font-size:11px;color:rgba(255,255,255,.2);line-height:1.8;">388 Madison Avenue · New York, NY 10017<br/>Member NCUA · FDIC Insured up to $250,000</div>
      <div style="font-size:10px;color:rgba(255,255,255,.15);margin-top:12px;line-height:1.7;">© ${yr} ZenithOne Credit Union. All rights reserved.<br/>This is an automated notification. Please do not reply to this email.</div>
    </div>
  </td></tr>

  <!-- Bottom gold line -->
  <tr><td style="padding-top:0;">
    <div style="height:1px;background:linear-gradient(90deg,transparent 0%,#7b5c0a 5%,#c9a84c 35%,#7b5c0a 95%,transparent 100%);margin-top:0;"></div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

      // ── ADMIN EMAIL — auto light / dark mode ──────────────────────────────────
      const adminHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<meta name="supported-color-schemes" content="light dark"/>
<title>Account Closure Alert — ZenithOne Admin</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500&family=Inter:wght@300;400;500;600&display=swap');

/* ── Light mode (default) ── */
:root { color-scheme: light dark; }
body { background:#f4f0eb; margin:0; padding:0; font-family:'Inter','Helvetica Neue',Arial,sans-serif; }
.em-shell   { background:#f4f0eb; }
.em-card    { background:#ffffff; border:1px solid rgba(0,0,0,.09); }
.em-accent  { background:linear-gradient(135deg,#f8f4ee,#ede8e1); border:1px solid rgba(180,145,60,.25); }
.em-title   { color:#0a1628; }
.em-label   { color:#64748b; }
.em-value   { color:#0a1628; }
.em-body    { color:#334155; }
.em-footer  { background:#ede8e1; border:1px solid rgba(0,0,0,.07); }
.em-foot-t  { color:#94a3b8; }
.em-divider { background:rgba(0,0,0,.07); }
.em-chip    { background:rgba(239,68,68,.09); border:1px solid rgba(239,68,68,.25); color:#dc2626; }
.em-num     { color:#475569; }

/* ── Dark mode ── */
@media (prefers-color-scheme: dark) {
  body        { background:#030b16 !important; }
  .em-shell   { background:#030b16 !important; }
  .em-card    { background:#07111e !important; border-color:rgba(255,255,255,.08) !important; }
  .em-accent  { background:linear-gradient(135deg,#0d1828,#071020) !important; border-color:rgba(201,168,76,.2) !important; }
  .em-title   { color:#f1f5f9 !important; }
  .em-label   { color:rgba(255,255,255,.35) !important; }
  .em-value   { color:rgba(255,255,255,.88) !important; }
  .em-body    { color:rgba(255,255,255,.6) !important; }
  .em-footer  { background:#020810 !important; border-color:rgba(255,255,255,.05) !important; }
  .em-foot-t  { color:rgba(255,255,255,.2) !important; }
  .em-divider { background:rgba(255,255,255,.07) !important; }
  .em-chip    { background:rgba(248,113,113,.1) !important; border-color:rgba(248,113,113,.3) !important; color:#fca5a5 !important; }
  .em-num     { color:rgba(255,255,255,.75) !important; font-family:'Courier New',monospace !important; }
}
</style>
</head>
<body>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="em-shell" style="padding:48px 16px;">
<tr><td align="center">
<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;">

  <!-- Top gold bar -->
  <tr><td>
    <div style="height:3px;background:linear-gradient(90deg,transparent 0%,#7b5c0a 5%,#c9a84c 40%,#e8d07a 55%,#c9a84c 70%,#7b5c0a 95%,transparent 100%);border-radius:3px 3px 0 0;"></div>
  </td></tr>

  <!-- Header -->
  <tr><td>
    <div class="em-card" style="padding:32px 40px 24px;border-top:none;border-radius:0;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td>
            <div style="font-size:9px;letter-spacing:5px;color:rgba(201,168,76,.65);text-transform:uppercase;margin-bottom:6px;font-family:'Inter',Arial,sans-serif;">ZenithOne Credit Union · Admin Alert</div>
            <div class="em-title" style="font-family:'Cormorant Garamond','Georgia',serif;font-size:32px;font-weight:300;line-height:1.1;letter-spacing:-.01em;">Member Account<br/><em style="font-style:italic;">Closure Notification</em></div>
          </td>
          <td style="text-align:right;vertical-align:top;padding-top:4px;">
            <div class="em-chip" style="display:inline-block;border-radius:8px;padding:8px 14px;">
              <div style="font-size:9px;letter-spacing:3px;text-transform:uppercase;margin-bottom:3px;opacity:.75;">Action Required</div>
              <div style="font-size:13px;font-weight:700;letter-spacing:.05em;">REVIEW</div>
            </div>
          </td>
        </tr>
      </table>
    </div>
  </td></tr>

  <!-- Divider -->
  <tr><td><div class="em-divider" style="height:1px;"></div></td></tr>

  <!-- Member details -->
  <tr><td>
    <div class="em-card" style="padding:28px 40px;border-top:none;border-bottom:none;border-radius:0;">
      <div style="font-size:9px;letter-spacing:4px;color:rgba(201,168,76,.6);text-transform:uppercase;margin-bottom:18px;">Member Information</div>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding-bottom:16px;width:50%;">
            <div class="em-label" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Full Name</div>
            <div class="em-value" style="font-size:15px;font-weight:500;">${userName}</div>
          </td>
          <td style="padding-bottom:16px;">
            <div class="em-label" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Email Address</div>
            <div class="em-value" style="font-size:15px;">${userEmail}</div>
          </td>
        </tr>
        <tr>
          <td colspan="2"><div class="em-divider" style="height:1px;margin-bottom:16px;"></div></td>
        </tr>
        <tr>
          <td style="padding-bottom:16px;width:50%;">
            <div class="em-label" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Account Type</div>
            <div class="em-value" style="font-size:15px;font-weight:500;">${typeLabel}</div>
          </td>
          <td style="padding-bottom:16px;">
            <div class="em-label" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Account Number</div>
            <div class="em-num" style="font-size:15px;font-family:'Courier New',monospace;letter-spacing:.1em;">•••• •••• ${last4}</div>
          </td>
        </tr>
        <tr>
          <td colspan="2">
            <div class="em-label" style="font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:4px;">Closure Timestamp</div>
            <div class="em-value" style="font-size:14px;">${closedFmt} &nbsp;·&nbsp; ${closedTime}</div>
          </td>
        </tr>
      </table>
    </div>
  </td></tr>

  <!-- Info accent box -->
  <tr><td style="padding:0 0 0 0;">
    <div class="em-card em-accent" style="margin:0;border-radius:0;padding:20px 40px;border-left:none;border-right:none;">
      <div class="em-body" style="font-size:13px;line-height:1.7;">
        <strong style="color:#c9a84c;">Note:</strong> This closure was initiated by the member through the ZenithOne self-service portal. No further action is required unless you wish to follow up with this member. All account data is retained per regulatory requirements.
      </div>
    </div>
  </td></tr>

  <!-- Footer -->
  <tr><td>
    <div class="em-footer" style="border-radius:0 0 14px 14px;padding:22px 40px;text-align:center;border-top:none;">
      <div class="em-foot-t" style="font-size:10px;letter-spacing:3px;text-transform:uppercase;margin-bottom:8px;">ZenithOne Credit Union — Administrative System</div>
      <div class="em-foot-t" style="font-size:11px;line-height:1.7;">388 Madison Avenue · New York, NY 10017<br/>© ${yr} ZenithOne Credit Union. Confidential.</div>
    </div>
  </td></tr>

  <!-- Bottom gold bar -->
  <tr><td>
    <div style="height:2px;background:linear-gradient(90deg,transparent 0%,#7b5c0a 5%,#c9a84c 40%,#7b5c0a 95%,transparent 100%);border-radius:0 0 3px 3px;"></div>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

      // ── Send emails ──────────────────────────────────────────────────────────
      const resendKey = Deno.env.get('RESEND_API_KEY');
      const fromAddr  = 'ZenithOne Credit Union <noreply@zenithonecreditunion.com>';
      if (resendKey) {
        const sends: Promise<unknown>[] = [];

        // User email
        if (userEmail) {
          sends.push(fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: fromAddr, to: [userEmail], subject: `Account Closed — ZenithOne Credit Union`, html: userHtml }),
          }));
        }

        // Admin emails
        const { data: adminProfs } = await supabase.from('profiles').select('id').eq('is_admin', true);
        if (adminProfs?.length) {
          const adminIds = new Set(adminProfs.map((p: { id: string }) => p.id));
          const { data: { users: authAdmins } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
          const adminEmails = (authAdmins ?? []).filter(u => adminIds.has(u.id)).map(u => u.email).filter(Boolean);
          if (adminEmails.length) {
            sends.push(fetch('https://api.resend.com/emails', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ from: fromAddr, to: adminEmails, subject: `[ZenithOne Admin] Account Closure — ${userName} · ${typeLabel} ••${last4}`, html: adminHtml }),
            }));
          }
        }

        await Promise.allSettled(sends);
      }

      // Notification in-app
      try {
        await supabase.from('notifications').insert({
          user_id: user.id,
          title:   'Account Closed',
          message: `Your ${typeLabel} account ending ${last4} has been successfully closed.`,
          type:    'warning',
          read:    false,
        });
      } catch { /* non-blocking */ }

      return json({ success: true, message: `Your ${typeLabel} account has been closed.` });
    }

    // ── Admin gate ─────────────────────────────────────────────────────────────
    const { data: callerProfile } = await supabase
      .from('profiles')
      .select('is_admin')
      .eq('id', user.id)
      .single();
    if (!callerProfile?.is_admin) throw new Error('Forbidden: admin access required');

    // Helper: build id→email map from auth.users (service role only)
    async function getEmailMap(): Promise<Record<string, string>> {
      const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const map: Record<string, string> = {};
      for (const u of authUsers ?? []) map[u.id] = u.email ?? '';
      return map;
    }

    if (action === 'stats') {
      const [
        { count: userCount },
        { count: txnCount },
        { data: accounts },
        { data: recentTxns },
        { data: recentProfiles },
        emailMap,
      ] = await Promise.all([
        supabase.from('profiles').select('*', { count: 'exact', head: true }),
        supabase.from('transactions').select('*', { count: 'exact', head: true }),
        supabase.from('accounts').select('balance').eq('status', 'active'),
        supabase.from('transactions')
          .select('id,description,amount,transaction_type,category,created_at,user_id')
          .order('created_at', { ascending: false }).limit(20),
        supabase.from('profiles')
          .select('id,full_name,created_at')
          .order('created_at', { ascending: false }).limit(5),
        getEmailMap(),
      ]);

      const totalDeposits = (accounts || []).reduce((s: number, a: { balance: number }) => s + (a.balance || 0), 0);

      const recentUsers = (recentProfiles ?? []).map((p: Record<string, unknown>) => ({
        ...p,
        email: emailMap[p.id as string] ?? '',
      }));

      return json({
        user_count:          userCount  ?? 0,
        transaction_count:   txnCount   ?? 0,
        total_deposits:      Math.round(totalDeposits * 100) / 100,
        recent_transactions: recentTxns ?? [],
        recent_users:        recentUsers,
      });
    }

    if (action === 'users') {
      const [
        { data: profiles, error: profErr },
        { data: accounts },
        emailMap,
      ] = await Promise.all([
        supabase.from('profiles')
          .select('id, full_name, banking_tier, created_at, is_admin')
          .order('created_at', { ascending: false }),
        supabase.from('accounts')
          .select('id, user_id, account_type, balance, status, account_number')
          .eq('status', 'active'),
        getEmailMap(),
      ]);

      if (profErr) throw profErr;

      const accMap: Record<string, { id: string; type: string; balance: number; number: string }[]> = {};
      for (const a of accounts ?? []) {
        if (!accMap[a.user_id]) accMap[a.user_id] = [];
        accMap[a.user_id].push({ id: a.id, type: a.account_type, balance: a.balance, number: a.account_number });
      }

      return json({
        users: (profiles ?? []).map((p: Record<string, unknown>) => ({
          ...p,
          email:         emailMap[p.id as string] ?? '',
          accounts:      accMap[p.id as string] ?? [],
          total_balance: (accMap[p.id as string] ?? []).reduce((s, a) => s + (a.balance || 0), 0),
        })),
      });
    }

    if (action === 'add_funds') {
      const { user_id, account_id, amount, note } = body as {
        action: string; user_id: string; account_id: string; amount: number; note?: string;
      };
      if (!user_id || !account_id || !amount || amount <= 0) {
        throw new Error('user_id, account_id, and a positive amount are required.');
      }

      // Verify account belongs to user and is active
      const { data: account, error: accErr } = await supabase
        .from('accounts')
        .select('id, account_type, account_number')
        .eq('id', account_id)
        .eq('user_id', user_id)
        .eq('status', 'active')
        .single();
      if (accErr || !account) throw new Error('Account not found or is not active.');

      const { error: txnErr } = await supabase
        .from('transactions')
        .insert({
          user_id,
          account_id,
          transaction_type: 'credit',
          amount,
          description:      note?.trim() || 'Admin credit',
          category:         'other',
          status:           'completed',
        });
      if (txnErr) throw txnErr;

      await supabase.from('notifications').insert({
        user_id,
        title:    'Funds Added',
        message:  `$${amount.toFixed(2)} has been credited to your ${account.account_type} account${note ? ' — ' + note : ''}.`,
        type:     'transaction',
        priority: 'normal',
      });

      return json({ success: true, message: `$${amount.toFixed(2)} added to ${account.account_type} account ending ${(account.account_number||'').slice(-4)||'••••'}` });
    }

    // ── List pending card requests ─────────────────────────────────────────────
    if (action === 'card_requests') {
      const emailMap = await getEmailMap();
      const { data: requests, error: rErr } = await supabase
        .from('card_requests')
        .select('id, user_id, card_type_key, card_name, card_tier, card_category, annual_fee, status, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      if (rErr) throw rErr;

      // Get profile names
      const userIds = [...new Set((requests || []).map((r: { user_id: string }) => r.user_id))];
      let nameMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id,full_name').in('id', userIds);
        for (const p of profs ?? []) nameMap[p.id] = p.full_name || '';
      }

      return json({
        requests: (requests || []).map((r: Record<string, unknown>) => ({
          ...r,
          user_name:  nameMap[r.user_id as string] || '',
          user_email: emailMap[r.user_id as string] || '',
        })),
      });
    }

    // ── Approve card request ────────────────────────────────────────────────────
    if (action === 'approve_card') {
      const { request_id } = body as { action: string; request_id: string };
      if (!request_id) throw new Error('request_id required');

      const { data: req, error: rErr } = await supabase
        .from('card_requests')
        .select('*')
        .eq('id', request_id)
        .single();
      if (rErr || !req) throw new Error('Card request not found');
      if (req.status !== 'pending') throw new Error(`Request is already ${req.status}`);

      // Generate card details — a realistic, Luhn-valid number matching the
      // network the member chose (carried in the request's card_name).
      const cardDef     = CARD_CATALOG_DEF[req.card_type_key as string];
      const network     = networkForCard(req.card_name as string);
      const cardNumber  = generateCardNumber(network);
      const lastFour    = cardNumber.slice(-4);
      const now         = new Date();
      const expiryYear  = now.getFullYear() + 4;
      const expiryMonth = now.getMonth() + 1;
      const creditLimit = CARD_LIMITS[req.card_type_key as string] ?? 5000;

      // Map catalog tier to DB-allowed values: standard|gold|platinum|black
      const TIER_MAP: Record<string, string> = {
        standard: 'standard', premium: 'gold', private: 'platinum', black: 'black',
      };
      const dbTier = TIER_MAP[req.card_tier as string] ?? 'standard';

      // Find the user's primary account for account_id (required NOT NULL)
      const { data: userAccount } = await supabase
        .from('accounts')
        .select('id')
        .eq('user_id', req.user_id)
        .eq('status', 'active')
        .order('created_at')
        .limit(1)
        .single();
      if (!userAccount) throw new Error('No active account found for this user — cannot issue card');

      // Get user name early for cardholder_name
      const { data: profileForCard } = await supabase.from('profiles').select('full_name').eq('id', req.user_id).single();
      const cardholderName = (profileForCard?.full_name || 'MEMBER').toUpperCase();

      // Create the card
      const { data: newCard, error: cardErr } = await supabase.from('cards').insert({
        account_id:            userAccount.id,
        user_id:               req.user_id,
        card_type:             req.card_category === 'debit' ? 'debit' : 'credit',
        card_tier:             dbTier,
        card_name:             req.card_name,
        card_number_last_four: lastFour,
        card_number_token:     cardNumber,
        expiry_month:          expiryMonth,
        expiry_year:           expiryYear,
        status:                'active',
        credit_limit:          creditLimit,
        available_credit:      creditLimit,
        current_balance:       0,
        cardholder_name:       cardholderName,
      }).select('id').single();
      if (cardErr) throw cardErr;

      // Update request status
      await supabase.from('card_requests')
        .update({ status: 'issued', card_id: newCard.id, updated_at: new Date().toISOString() })
        .eq('id', request_id);

      // Get user email for notification
      const userName = profileForCard?.full_name || 'Member';
      const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const userEmail = authUsers.find((u: { id: string }) => u.id === req.user_id)?.email || '';

      // In-app notification to user
      await supabase.from('notifications').insert({
        user_id:  req.user_id,
        title:    `Your ${req.card_name} Has Been Approved!`,
        message:  `Congratulations! Your ${req.card_name} application has been approved. Your card ending •••• ${lastFour} is now active.`,
        type:     'system',
        priority: 'urgent',
      });

      // Approval email to user
      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (resendKey && userEmail && cardDef) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from:    'ZenithOne Credit Union <noreply@zenithonecreditunion.com>',
            to:      [userEmail],
            subject: `Your ${req.card_name} Is Approved — ZenithOne Credit Union`,
            html:    approvalEmailHtml(userName, req.card_name, req.card_tier, lastFour, expiryMonth, expiryYear, cardDef.gradient, creditLimit, formatPan(cardNumber)),
          }),
        });
      }

      return json({ success: true, card_id: newCard.id, last_four: lastFour, message: `${req.card_name} approved and issued.` });
    }

    // ── Reject card request ─────────────────────────────────────────────────────
    if (action === 'reject_card') {
      const { request_id, reason } = body as { action: string; request_id: string; reason?: string };
      if (!request_id) throw new Error('request_id required');

      const { data: req, error: rErr } = await supabase
        .from('card_requests')
        .select('*')
        .eq('id', request_id)
        .single();
      if (rErr || !req) throw new Error('Card request not found');
      if (req.status !== 'pending') throw new Error(`Request is already ${req.status}`);

      await supabase.from('card_requests')
        .update({ status: 'rejected', updated_at: new Date().toISOString() })
        .eq('id', request_id);

      // Refund the fee that was charged at application time, back to checking.
      const refund = Number(req.annual_fee ?? 0);
      let refunded = false;
      if (refund > 0) {
        const { data: acct } = await supabase
          .from('accounts').select('id')
          .eq('user_id', req.user_id).eq('account_type', 'checking').eq('status', 'active')
          .order('created_at').limit(1).maybeSingle();
        if (acct) {
          const { error: refErr } = await supabase.from('transactions').insert({
            account_id:       acct.id,
            user_id:          req.user_id,
            amount:           refund,
            transaction_type: 'credit',
            category:         'fee',
            status:           'completed',
            description:      `Card application refund — ${req.card_name}`,
            reference_number: `RFND${Date.now()}`,
          });
          refunded = !refErr;
        }
      }

      const note      = reason?.trim() || 'Your application did not meet our current criteria.';
      const refundMsg = refunded ? ` Your $${refund.toFixed(2)} fee has been refunded to your checking account.` : '';
      await supabase.from('notifications').insert({
        user_id:  req.user_id,
        title:    `Card Application Update — ${req.card_name}`,
        message:  `We're unable to approve your ${req.card_name} application at this time. ${note}${refundMsg} Please contact support if you have questions.`,
        type:     'system',
        priority: 'high',
      });

      return json({ success: true, refunded, refund_amount: refunded ? refund : 0, message: `${req.card_name} request rejected.${refunded ? ` $${refund.toFixed(2)} refunded.` : ''}` });
    }

    // ── List editable card pricing (base fee per card type) ─────────────────────
    if (action === 'card_pricing') {
      const { data: rows, error: pErr } = await supabase
        .from('card_pricing').select('card_type_key, base_fee, updated_at');
      if (pErr) throw pErr;
      const byKey: Record<string, { base_fee: number; updated_at: string }> = {};
      for (const r of rows ?? []) byKey[r.card_type_key] = { base_fee: Number(r.base_fee), updated_at: r.updated_at };

      // Return one entry per known card type, in catalog order, with its name.
      const pricing = Object.entries(CARD_CATALOG_DEF).map(([key, def]) => ({
        card_type_key: key,
        name:          def.name,
        category:      def.category,
        base_fee:      byKey[key]?.base_fee ?? def.fee,
        updated_at:    byKey[key]?.updated_at ?? null,
      }));
      return json({ pricing, surcharges: NETWORK_SURCHARGE });
    }

    // ── Update a card type's base price ─────────────────────────────────────────
    if (action === 'update_card_price') {
      const { card_type_key, base_fee } = body as { action: string; card_type_key: string; base_fee: number };
      if (!card_type_key || !(card_type_key in CARD_CATALOG_DEF)) throw new Error('Invalid card type');
      const fee = Number(base_fee);
      if (!Number.isFinite(fee) || fee < 1) throw new Error('Base fee must be a positive amount.');

      const { error: upErr } = await supabase
        .from('card_pricing')
        .upsert({ card_type_key, base_fee: fee, updated_at: new Date().toISOString() }, { onConflict: 'card_type_key' });
      if (upErr) throw upErr;

      return json({ success: true, card_type_key, base_fee: fee, message: `${CARD_CATALOG_DEF[card_type_key].name} base price set to $${fee.toFixed(2)}.` });
    }

    // ── Backfill realistic card numbers onto already-issued cards ───────────────
    if (action === 'backfill_card_numbers') {
      // Only cards missing a stored full number.
      const { data: cards, error: cErr } = await supabase
        .from('cards')
        .select('id, card_name')
        .is('card_number_token', null);
      if (cErr) throw cErr;

      let updated = 0;
      const failures: string[] = [];

      for (const card of cards ?? []) {
        const network = networkForCard(card.card_name as string);
        let ok = false;
        // Retry a few times in case the random number collides with the UNIQUE token.
        for (let attempt = 0; attempt < 5 && !ok; attempt++) {
          const pan = generateCardNumber(network);
          const { error: uErr } = await supabase
            .from('cards')
            .update({
              card_number_token:     pan,
              card_number_last_four: pan.slice(-4),
              updated_at:            new Date().toISOString(),
            })
            .eq('id', card.id)
            .is('card_number_token', null); // guard against double-writes
          if (!uErr) ok = true;
        }
        if (ok) updated++; else failures.push(card.id as string);
      }

      return json({
        success:   true,
        scanned:   (cards ?? []).length,
        updated,
        failed:    failures.length,
        message:   `Backfilled ${updated} card${updated === 1 ? '' : 's'} with realistic numbers.`,
      });
    }

    // ── List a specific user's cards (admin) ────────────────────────────────────
    if (action === 'admin_list_user_cards') {
      const { user_id } = body as { action: string; user_id: string };
      if (!user_id) throw new Error('user_id required');
      const { data: cards, error } = await supabase
        .from('cards')
        .select('id, card_name, card_type, card_tier, card_number_last_four, card_number_token, status, available_credit, credit_limit, current_balance, expiry_month, expiry_year, cardholder_name, created_at')
        .eq('user_id', user_id)
        .neq('status', 'cancelled')
        .order('created_at');
      if (error) throw error;
      return json({ cards: cards || [] });
    }

    // ── Freeze / unfreeze / block / unblock a card (admin) ──────────────────────
    if (action === 'admin_card_action') {
      const { card_id, card_action } = body as { action: string; card_id: string; card_action: string };
      if (!card_id || !card_action) throw new Error('card_id and card_action required');
      const statusMap: Record<string, string> = {
        freeze: 'frozen', unfreeze: 'active', block: 'blocked', unblock: 'active',
      };
      const newStatus = statusMap[card_action];
      if (!newStatus) throw new Error('Invalid card_action. Use: freeze, unfreeze, block, unblock');

      const { data: card } = await supabase.from('cards').select('user_id, card_name').eq('id', card_id).single();
      if (!card) throw new Error('Card not found');

      const { error } = await supabase.from('cards')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', card_id);
      if (error) throw error;

      const actionLabel = card_action === 'freeze' ? 'frozen' : card_action === 'unfreeze' ? 'unfrozen' : card_action === 'block' ? 'permanently blocked' : 'unblocked';
      await supabase.from('notifications').insert({
        user_id:  card.user_id,
        title:    `Card ${card_action === 'freeze' ? 'Frozen' : card_action === 'unfreeze' ? 'Unfrozen' : card_action === 'block' ? 'Blocked' : 'Unblocked'}`,
        message:  `Your ${card.card_name} has been ${actionLabel} by ZenithOne admin. Contact support for more information.`,
        type:     'security',
        priority: 'high',
      });
      return json({ success: true, card_id, status: newStatus, message: `Card ${actionLabel}.` });
    }

    // ── Credit a card's available balance (admin fund) ───────────────────────────
    if (action === 'admin_fund_card') {
      const { card_id, amount, note } = body as { action: string; card_id: string; amount: number; note?: string };
      if (!card_id || !amount || amount <= 0) throw new Error('card_id and a positive amount are required');
      const { data: card, error: cErr } = await supabase.from('cards').select('*').eq('id', card_id).single();
      if (cErr || !card) throw new Error('Card not found');
      const newAvail = (Number(card.available_credit) || 0) + amount;
      const { error } = await supabase.from('cards')
        .update({ available_credit: newAvail, updated_at: new Date().toISOString() })
        .eq('id', card_id);
      if (error) throw error;
      await supabase.from('notifications').insert({
        user_id:  card.user_id,
        title:    'Card Funded',
        message:  `$${amount.toFixed(2)} has been added to your ${card.card_name}${note ? ' — ' + note : ''}. New available balance: $${newAvail.toFixed(2)}.`,
        type:     'transaction',
        priority: 'normal',
      });
      return json({ success: true, new_available: newAvail, message: `$${amount.toFixed(2)} added to card. New available: $${newAvail.toFixed(2)}.` });
    }

    // ── Deduct from a card's available balance (admin deduct) ────────────────────
    if (action === 'admin_deduct_card') {
      const { card_id, amount, note } = body as { action: string; card_id: string; amount: number; note?: string };
      if (!card_id || !amount || amount <= 0) throw new Error('card_id and a positive amount are required');
      const { data: card, error: cErr } = await supabase.from('cards').select('*').eq('id', card_id).single();
      if (cErr || !card) throw new Error('Card not found');
      const avail = Number(card.available_credit) || 0;
      if (avail < amount) throw new Error(`Card only has $${avail.toFixed(2)} available. Cannot deduct $${amount.toFixed(2)}.`);
      const newAvail = avail - amount;
      const { error } = await supabase.from('cards')
        .update({ available_credit: newAvail, updated_at: new Date().toISOString() })
        .eq('id', card_id);
      if (error) throw error;
      await supabase.from('notifications').insert({
        user_id:  card.user_id,
        title:    'Card Adjustment',
        message:  `$${amount.toFixed(2)} has been deducted from your ${card.card_name}${note ? ' — ' + note : ''}. Remaining balance: $${newAvail.toFixed(2)}.`,
        type:     'transaction',
        priority: 'normal',
      });
      return json({ success: true, new_available: newAvail, message: `$${amount.toFixed(2)} deducted. Remaining: $${newAvail.toFixed(2)}.` });
    }

    // ── List members with PIN status + reward points (admin) ────────────────────
    if (action === 'admin_list_members_pins') {
      const { data: members, error } = await supabase
        .from('profiles')
        .select('id, full_name, email:id, transaction_pin, pin_created_at, total_reward_points, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      // join auth.users email via admin API
      const { data: authUsers } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const emailMap: Record<string, string> = {};
      for (const u of (authUsers?.users || [])) emailMap[u.id] = u.email ?? '';
      const result = (members || []).map(m => ({
        id: m.id,
        full_name: m.full_name,
        email: emailMap[m.id] ?? '',
        pin_set: !!m.transaction_pin,
        pin_created_at: m.pin_created_at,
        total_reward_points: m.total_reward_points ?? 0,
      }));
      return json({ members: result });
    }

    // ── Admin reset a user's PIN ─────────────────────────────────────────────────
    if (action === 'admin_reset_pin') {
      const { target_user_id } = body as { action: string; target_user_id: string };
      if (!target_user_id) throw new Error('target_user_id required.');
      await supabase.from('profiles').update({ transaction_pin: null, pin_created_at: null }).eq('id', target_user_id);
      await supabase.from('notifications').insert({
        user_id: target_user_id,
        title: 'Security — PIN Reset',
        message: 'Your transaction PIN has been reset by an administrator. Please create a new PIN the next time you sign in.',
        type: 'security',
        priority: 'high',
      });
      return json({ success: true, message: 'PIN reset. User must create a new PIN.' });
    }

    // ── Give reward points to a user (admin) ─────────────────────────────────────
    if (action === 'admin_give_points') {
      const { target_user_id, points, reason } = body as { action: string; target_user_id: string; points: number; reason?: string };
      if (!target_user_id || !points || points <= 0) throw new Error('target_user_id and a positive points value are required.');
      const { data: prof, error: pErr } = await supabase.from('profiles')
        .select('total_reward_points, full_name')
        .eq('id', target_user_id).single();
      if (pErr || !prof) throw new Error('User not found.');
      const newTotal = (prof.total_reward_points ?? 0) + Math.round(points);
      await supabase.from('profiles').update({ total_reward_points: newTotal }).eq('id', target_user_id);
      await supabase.from('notifications').insert({
        user_id: target_user_id,
        title: 'Reward Points Added',
        message: `${Math.round(points).toLocaleString()} reward points have been added to your account${reason ? ' — ' + reason : ''}. New total: ${newTotal.toLocaleString()} points.`,
        type: 'reward',
        priority: 'normal',
      });
      return json({ success: true, new_total: newTotal, message: `${Math.round(points)} points added. New total: ${newTotal}.` });
    }

    // ── Set reward points for a user (admin override) ─────────────────────────────
    if (action === 'admin_set_points') {
      const { target_user_id, points } = body as { action: string; target_user_id: string; points: number };
      if (!target_user_id || points == null || points < 0) throw new Error('target_user_id and a non-negative points value are required.');
      await supabase.from('profiles').update({ total_reward_points: Math.round(points) }).eq('id', target_user_id);
      return json({ success: true, message: `Points set to ${Math.round(points)}.` });
    }

    // ── Set a card's credit limit + available credit (admin) ──────────────────────
    if (action === 'admin_set_card_credit') {
      const { card_id, credit_limit, available_credit } = body as {
        action: string; card_id: string; credit_limit: number; available_credit: number;
      };
      if (!card_id) throw new Error('card_id required');
      const limit = Number(credit_limit);
      const avail = Number(available_credit);
      if (!Number.isFinite(limit) || limit < 0)  throw new Error('Credit limit must be a non-negative number.');
      if (!Number.isFinite(avail) || avail < 0)  throw new Error('Available credit must be a non-negative number.');
      if (avail > limit)                          throw new Error('Available credit cannot exceed the credit limit.');

      const { data: card, error: cErr } = await supabase.from('cards').select('user_id, card_name').eq('id', card_id).single();
      if (cErr || !card) throw new Error('Card not found');

      const { error } = await supabase.from('cards')
        .update({ credit_limit: limit, available_credit: avail, updated_at: new Date().toISOString() })
        .eq('id', card_id);
      if (error) throw error;

      await supabase.from('notifications').insert({
        user_id:  card.user_id,
        title:    'Credit Line Updated',
        message:  `Your ${card.card_name} credit limit is now $${limit.toLocaleString('en-US')} with $${avail.toLocaleString('en-US')} available.`,
        type:     'account',
        priority: 'normal',
      });
      return json({ success: true, credit_limit: limit, available_credit: avail, message: `Credit line updated: $${avail.toLocaleString('en-US')} of $${limit.toLocaleString('en-US')}.` });
    }

    // ── Set / clear a user's portfolio value + profit/loss override (admin) ───────
    if (action === 'admin_set_portfolio') {
      const { target_user_id, portfolio_value, portfolio_gain } = body as {
        action: string; target_user_id: string; portfolio_value: number | null; portfolio_gain?: number | null;
      };
      if (!target_user_id) throw new Error('target_user_id required');

      // Parse a "value or null to clear" numeric field. `allowNegative` for P&L.
      const parseOverride = (raw: unknown, label: string, allowNegative: boolean): number | null => {
        if (raw === null || raw === undefined || `${raw}` === '') return null;
        const v = Number(raw);
        if (!Number.isFinite(v)) throw new Error(`${label} must be a number, or empty to clear.`);
        if (!allowNegative && v < 0) throw new Error(`${label} must be non-negative, or empty to clear.`);
        return Math.round(v * 100) / 100;
      };

      const valueOverride = parseOverride(portfolio_value, 'Portfolio value', false);
      const update: Record<string, unknown> = { portfolio_value_override: valueOverride };
      // P&L only set when the field is provided in the request.
      if ('portfolio_gain' in body) update.portfolio_gain_override = parseOverride(portfolio_gain, 'Profit / loss', true);

      const { error } = await supabase.from('profiles').update(update).eq('id', target_user_id);
      if (error) throw error;

      return json({
        success: true,
        portfolio_value: valueOverride,
        message: valueOverride === null
          ? 'Portfolio override cleared — value now reflects the user\'s holdings.'
          : `Portfolio value set to $${valueOverride.toLocaleString('en-US')}.`,
      });
    }

    // ── Set an account's balance to an exact value (admin) ────────────────────────
    if (action === 'admin_set_balance') {
      const { account_id, balance } = body as { action: string; account_id: string; balance: number };
      if (!account_id) throw new Error('account_id required');
      const v = Number(balance);
      if (!Number.isFinite(v) || v < 0) throw new Error('Balance must be a non-negative number.');
      const amount = Math.round(v * 100) / 100;

      const { data: acct, error: aErr } = await supabase
        .from('accounts').select('id, user_id, account_type, account_number').eq('id', account_id).single();
      if (aErr || !acct) throw new Error('Account not found.');

      // Direct set keeps balance and available_balance in lock-step (no trigger).
      const { error } = await supabase.from('accounts')
        .update({ balance: amount, available_balance: amount, updated_at: new Date().toISOString() })
        .eq('id', account_id);
      if (error) throw error;

      await supabase.from('notifications').insert({
        user_id:  acct.user_id,
        title:    'Account Balance Updated',
        message:  `Your ${String(acct.account_type).replace('_',' ')} account (••••${String(acct.account_number||'').slice(-4)}) balance is now $${amount.toLocaleString('en-US',{minimumFractionDigits:2})}.`,
        type:     'account',
        priority: 'normal',
      });
      return json({ success: true, balance: amount, message: `Balance set to $${amount.toLocaleString('en-US',{minimumFractionDigits:2})}.` });
    }

    // ── Set / clear a user's available-credit override (admin) ────────────────────
    if (action === 'admin_set_available_credit') {
      const { target_user_id, available_credit } = body as {
        action: string; target_user_id: string; available_credit: number | null;
      };
      if (!target_user_id) throw new Error('target_user_id required');

      let override: number | null = null;
      if (available_credit !== null && available_credit !== undefined && `${available_credit}` !== '') {
        const v = Number(available_credit);
        if (!Number.isFinite(v) || v < 0) throw new Error('Available credit must be non-negative, or empty to clear.');
        override = Math.round(v * 100) / 100;
      }

      const { error } = await supabase.from('profiles')
        .update({ available_credit_override: override }).eq('id', target_user_id);
      if (error) throw error;

      return json({
        success: true,
        available_credit: override,
        message: override === null
          ? 'Available-credit override cleared — value now reflects the user\'s cards.'
          : `Available credit set to $${override.toLocaleString('en-US')}.`,
      });
    }

    // ── List a user's financials: holdings, overrides, accounts (admin) ───────────
    if (action === 'admin_list_investments') {
      const { target_user_id } = body as { action: string; target_user_id: string };
      if (!target_user_id) throw new Error('target_user_id required');
      const [{ data: holdings, error }, { data: prof }, { data: accts }, { data: cards }] = await Promise.all([
        supabase.from('investments')
          .select('id, symbol, name, asset_type, quantity, purchase_price, current_price, total_value, gain_loss, created_at')
          .eq('user_id', target_user_id)
          .order('created_at', { ascending: false }),
        supabase.from('profiles')
          .select('portfolio_value_override, available_credit_override, portfolio_gain_override')
          .eq('id', target_user_id).single(),
        supabase.from('accounts')
          .select('id, account_type, account_number, balance, status')
          .eq('user_id', target_user_id).eq('status', 'active').order('created_at'),
        supabase.from('cards')
          .select('available_credit, card_type, status')
          .eq('user_id', target_user_id).neq('status', 'cancelled').neq('status', 'stolen'),
      ]);
      if (error) throw error;
      const holdingsTotal = (holdings || []).reduce((s, h) => s + (Number(h.total_value) || 0), 0);
      const holdingsGain  = (holdings || []).reduce((s, h) => s + (Number(h.gain_loss)   || 0), 0);
      const cardsCredit   = (cards || []).reduce((s, c) => c.card_type === 'credit' ? s + (Number(c.available_credit) || 0) : s, 0);
      return json({
        holdings: holdings || [],
        holdings_total: Math.round(holdingsTotal * 100) / 100,
        holdings_gain:  Math.round(holdingsGain  * 100) / 100,
        accounts: accts || [],
        cards_credit_available: Math.round(cardsCredit * 100) / 100,
        portfolio_value_override:  prof?.portfolio_value_override  ?? null,
        portfolio_gain_override:   prof?.portfolio_gain_override   ?? null,
        available_credit_override: prof?.available_credit_override ?? null,
      });
    }

    // ── Add an investment holding to a user (admin) ───────────────────────────────
    if (action === 'admin_add_investment') {
      const { target_user_id, symbol, name, asset_type, quantity, purchase_price, current_price } = body as {
        action: string; target_user_id: string; symbol: string; name?: string;
        asset_type?: string; quantity: number; purchase_price: number; current_price?: number;
      };
      if (!target_user_id) throw new Error('target_user_id required');
      const sym = (symbol || '').trim().toUpperCase();
      if (!sym) throw new Error('Symbol is required.');
      const qty   = Number(quantity);
      const cost  = Number(purchase_price);
      const price = current_price === undefined || current_price === null || `${current_price}` === '' ? Number(purchase_price) : Number(current_price);
      if (!Number.isFinite(qty)  || qty  <= 0) throw new Error('Quantity must be a positive number.');
      if (!Number.isFinite(cost) || cost <  0) throw new Error('Purchase price must be a non-negative number.');
      if (!Number.isFinite(price)|| price < 0) throw new Error('Current price must be a non-negative number.');

      const ALLOWED = ['stock','etf','bond','mutual_fund','crypto','reit','option','cash','other'];
      const type = ALLOWED.includes((asset_type || '').toLowerCase()) ? (asset_type as string).toLowerCase() : 'stock';

      // Holdings require an account_id — use the user's primary active account.
      const { data: acct } = await supabase
        .from('accounts').select('id').eq('user_id', target_user_id).eq('status', 'active')
        .order('created_at').limit(1).maybeSingle();
      if (!acct) throw new Error('User has no active account to attach the holding to.');

      const { data: inv, error } = await supabase.from('investments').insert({
        account_id:     acct.id,
        user_id:        target_user_id,
        symbol:         sym,
        name:           (name || sym).trim(),
        asset_type:     type,
        quantity:       qty,
        purchase_price: cost,
        current_price:  price,
      }).select('id, total_value').single();
      if (error) throw error;

      await supabase.from('notifications').insert({
        user_id:  target_user_id,
        title:    'Portfolio Updated',
        message:  `${qty} ${sym} added to your investment portfolio.`,
        type:     'account',
        priority: 'low',
      });
      return json({ success: true, id: inv.id, message: `Added ${qty} ${sym}.` });
    }

    // ── Delete an investment holding (admin) ──────────────────────────────────────
    if (action === 'admin_delete_investment') {
      const { investment_id } = body as { action: string; investment_id: string };
      if (!investment_id) throw new Error('investment_id required');
      const { error } = await supabase.from('investments').delete().eq('id', investment_id);
      if (error) throw error;
      return json({ success: true, message: 'Holding removed.' });
    }

    // ── List account opening requests (admin) ─────────────────────────────────
    if (action === 'admin_list_account_requests') {
      const { status_filter } = body as { action: string; status_filter?: string };
      let q = supabase
        .from('account_requests')
        .select('id, user_id, account_type, account_name, initial_deposit, note, status, admin_note, created_at')
        .order('created_at', { ascending: false });
      if (status_filter && status_filter !== 'all') q = q.eq('status', status_filter);
      const { data: requests, error: rErr } = await q;
      if (rErr) throw rErr;

      // Enrich with user email/name from profiles
      const userIds = [...new Set((requests || []).map((r: { user_id: string }) => r.user_id))];
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, full_name, email')
        .in('id', userIds as string[]);
      const profileMap = Object.fromEntries((profiles || []).map((p: { id: string; full_name: string; email: string }) => [p.id, p]));

      return json({
        requests: (requests || []).map((r: { user_id: string; [key: string]: unknown }) => ({
          ...r,
          user_name:  (profileMap[r.user_id] as { full_name?: string })?.full_name || 'Unknown',
          user_email: (profileMap[r.user_id] as { email?: string })?.email || '',
        })),
      });
    }

    // ── Approve an account request (admin) ────────────────────────────────────
    if (action === 'admin_approve_account_request') {
      const { request_id, interest_rate, admin_note } = body as {
        action: string; request_id: string; interest_rate?: number; admin_note?: string;
      };
      if (!request_id) throw new Error('request_id required');

      // Fetch the request
      const { data: req, error: reqErr } = await supabase
        .from('account_requests')
        .select('*')
        .eq('id', request_id)
        .single();
      if (reqErr || !req) throw new Error('Account request not found');
      if (req.status !== 'pending') throw new Error('Request is not pending');

      // Default interest rates by type
      const defaultRates: Record<string, number> = {
        checking: 0.005, savings: 0.0485, money_market: 0.051, cd: 0.055,
      };
      const rate = interest_rate ?? defaultRates[req.account_type] ?? 0.005;

      // Generate account number (10-digit)
      const acctNum = String(Math.floor(1000000000 + Math.random() * 9000000000));

      // Deduct initial deposit from source account (if member specified one)
      const deposit = Number(req.initial_deposit) || 0;
      if (req.source_account_id && deposit > 0) {
        const { data: src, error: srcErr } = await supabase
          .from('accounts').select('id, balance, available_balance')
          .eq('id', req.source_account_id).single();
        if (srcErr || !src) throw new Error('Source funding account not found');
        const avail = Number(src.available_balance ?? src.balance ?? 0);
        if (avail < deposit) throw new Error(`Source account has insufficient funds (available: $${avail.toFixed(2)})`);
        const { error: deductErr } = await supabase.from('accounts').update({
          balance:           Number(src.balance) - deposit,
          available_balance: avail - deposit,
          updated_at:        new Date().toISOString(),
        }).eq('id', req.source_account_id);
        if (deductErr) throw deductErr;
      }

      // Create the account (balance seeded directly — source already debited above)
      const { error: accErr } = await supabase.from('accounts').insert({
        user_id:           req.user_id,
        account_type:      req.account_type,
        account_name:      req.account_name || null,
        account_number:    acctNum,
        balance:           deposit,
        available_balance: deposit,
        interest_rate:     rate,
        routing_number:    '021000021',
        status:            'active',
      });
      if (accErr) throw accErr;

      // Update request status
      const { error: updErr } = await supabase
        .from('account_requests')
        .update({ status: 'approved', admin_note: admin_note || null, updated_at: new Date().toISOString() })
        .eq('id', request_id);
      if (updErr) throw updErr;

      // Notify user (non-blocking)
      try {
        const depMsg = deposit > 0 ? ` An initial deposit of $${deposit.toFixed(2)} has been transferred in.` : '';
        await supabase.from('notifications').insert({
          user_id: req.user_id,
          title:   'Account Approved',
          message: `Your ${req.account_type.replace('_', ' ')} account has been approved and is now active.${depMsg}`,
          type:    'success',
          read:    false,
        });
      } catch { /* ignore */ }

      return json({ success: true, message: 'Account approved and created.', account_number: acctNum });
    }

    // ── Reject an account request (admin) ─────────────────────────────────────
    if (action === 'admin_reject_account_request') {
      const { request_id, admin_note } = body as {
        action: string; request_id: string; admin_note?: string;
      };
      if (!request_id) throw new Error('request_id required');

      const { data: req, error: reqErr } = await supabase
        .from('account_requests')
        .select('user_id, account_type, status')
        .eq('id', request_id)
        .single();
      if (reqErr || !req) throw new Error('Account request not found');
      if (req.status !== 'pending') throw new Error('Request is not pending');

      const { error: updErr } = await supabase
        .from('account_requests')
        .update({ status: 'rejected', admin_note: admin_note || null, updated_at: new Date().toISOString() })
        .eq('id', request_id);
      if (updErr) throw updErr;

      // Notify user (non-blocking)
      try {
        await supabase.from('notifications').insert({
          user_id: req.user_id,
          title:   'Account Request Update',
          message: `Your ${req.account_type.replace('_', ' ')} account request was not approved${admin_note ? ': ' + admin_note : '.'}`,
          type:    'warning',
          read:    false,
        });
      } catch { /* ignore */ }

      return json({ success: true, message: 'Account request rejected.' });
    }

    // ── Get a member's credit profile + loans (admin) ────────────────────────
    if (action === 'admin_get_credit_loans') {
      const { target_user_id } = body as { action: string; target_user_id: string };
      if (!target_user_id) throw new Error('target_user_id required');
      const [{ data: cp }, { data: loans }] = await Promise.all([
        supabase.from('credit_profiles').select('*').eq('user_id', target_user_id).maybeSingle(),
        supabase.from('loans').select('*').eq('user_id', target_user_id).order('created_at', { ascending: false }),
      ]);
      return json({ credit_profile: cp || null, loans: loans || [] });
    }

    // ── Create / update a member's credit profile (admin) ─────────────────────
    if (action === 'admin_upsert_credit') {
      const { target_user_id, credit_score, score_provider, payment_history_pct,
              credit_utilization, credit_age_months, hard_inquiries, derogatory_marks,
              total_credit_limit, total_credit_used, credit_mix_score, admin_note } =
        body as { action: string; target_user_id: string; credit_score: number;
                  score_provider?: string; payment_history_pct?: number;
                  credit_utilization?: number; credit_age_months?: number;
                  hard_inquiries?: number; derogatory_marks?: number;
                  total_credit_limit?: number; total_credit_used?: number;
                  credit_mix_score?: number; admin_note?: string; };
      if (!target_user_id) throw new Error('target_user_id required');
      if (!credit_score || credit_score < 300 || credit_score > 850) throw new Error('credit_score must be 300–850');

      const payload = {
        user_id:             target_user_id,
        credit_score,
        score_provider:      score_provider      ?? 'FICO',
        score_updated_at:    new Date().toISOString(),
        payment_history_pct: payment_history_pct ?? 100,
        credit_utilization:  credit_utilization  ?? 0,
        credit_age_months:   credit_age_months   ?? 0,
        hard_inquiries:      hard_inquiries       ?? 0,
        derogatory_marks:    derogatory_marks     ?? 0,
        total_credit_limit:  total_credit_limit   ?? 0,
        total_credit_used:   total_credit_used    ?? 0,
        credit_mix_score:    credit_mix_score     ?? 100,
        admin_note:          admin_note           ?? null,
      };
      const { error } = await supabase.from('credit_profiles')
        .upsert(payload, { onConflict: 'user_id' });
      if (error) throw error;
      return json({ success: true, message: 'Credit profile saved.' });
    }

    // ── Add a loan for a member (admin) ───────────────────────────────────────
    if (action === 'admin_add_loan') {
      const { target_user_id, loan_type, loan_name, lender, account_number,
              original_amount, current_balance, interest_rate, monthly_payment,
              next_payment_date, term_months, paid_months, opened_date, status } =
        body as { action: string; target_user_id: string; loan_type: string;
                  loan_name: string; lender?: string; account_number?: string;
                  original_amount: number; current_balance: number;
                  interest_rate: number; monthly_payment: number;
                  next_payment_date?: string; term_months?: number;
                  paid_months?: number; opened_date?: string; status?: string; };
      if (!target_user_id) throw new Error('target_user_id required');
      if (!loan_type)      throw new Error('loan_type required');
      if (!loan_name)      throw new Error('loan_name required');
      const { error } = await supabase.from('loans').insert({
        user_id: target_user_id, loan_type, loan_name,
        lender: lender || null, account_number: account_number || null,
        original_amount: original_amount || 0, current_balance: current_balance || 0,
        interest_rate: interest_rate || 0, monthly_payment: monthly_payment || 0,
        next_payment_date: next_payment_date || null,
        term_months: term_months || null, paid_months: paid_months || 0,
        opened_date: opened_date || null, status: status || 'active',
      });
      if (error) throw error;
      return json({ success: true, message: 'Loan added.' });
    }

    // ── Update a loan record (admin) ──────────────────────────────────────────
    if (action === 'admin_update_loan') {
      const { loan_id, ...updates } = body as { action: string; loan_id: string; [k: string]: unknown };
      if (!loan_id) throw new Error('loan_id required');
      const allowed = ['loan_name','lender','current_balance','interest_rate','monthly_payment',
                       'next_payment_date','paid_months','status','account_number'];
      const patch: Record<string, unknown> = {};
      for (const k of allowed) if (k in updates) patch[k] = updates[k];
      const { error } = await supabase.from('loans').update(patch).eq('id', loan_id);
      if (error) throw error;
      return json({ success: true, message: 'Loan updated.' });
    }

    // ── Delete a loan record (admin) ──────────────────────────────────────────
    if (action === 'admin_delete_loan') {
      const { loan_id } = body as { action: string; loan_id: string };
      if (!loan_id) throw new Error('loan_id required');
      const { error } = await supabase.from('loans').delete().eq('id', loan_id);
      if (error) throw error;
      return json({ success: true, message: 'Loan removed.' });
    }

    // ── List all loan applications (admin) ────────────────────────────────────
    if (action === 'admin_list_loan_applications') {
      const { status_filter } = body as { action: string; status_filter?: string };
      let q = supabase
        .from('loan_applications')
        .select('*, profile:user_id(full_name)')
        .order('created_at', { ascending: false });
      if (status_filter && status_filter !== 'all') q = q.eq('status', status_filter);
      const { data, error } = await q;
      if (error) throw error;
      return json({ applications: data ?? [] });
    }

    // ── Approve a loan application (admin) ────────────────────────────────────
    if (action === 'admin_approve_loan_application') {
      const { application_id, monthly_payment, interest_rate, admin_note, opened_date } =
        body as { action: string; application_id: string; monthly_payment?: number;
                  interest_rate?: number; admin_note?: string; opened_date?: string };
      if (!application_id) throw new Error('application_id required');

      const { data: app, error: fetchErr } = await supabase
        .from('loan_applications').select('*').eq('id', application_id).single();
      if (fetchErr || !app) throw new Error('Loan application not found');
      if (app.status !== 'pending') throw new Error('Application is not pending');

      const rate     = interest_rate  ?? LOAN_DEFAULT_RATES[app.loan_type] ?? 0.1299;
      const payment  = monthly_payment ?? 0;
      const openDate = opened_date     ?? new Date().toISOString().split('T')[0];

      // Next payment = first of the month after today
      const now = new Date();
      const nextPayment = new Date(now.getFullYear(), now.getMonth() + 1, 1)
        .toISOString().split('T')[0];

      const { error: loanErr } = await supabase.from('loans').insert({
        user_id:          app.user_id,
        loan_type:        app.loan_type,
        loan_name:        app.loan_name,
        lender:           'ZenithOne Credit Union',
        original_amount:  app.requested_amount,
        current_balance:  app.requested_amount,
        interest_rate:    rate,
        monthly_payment:  payment,
        next_payment_date: nextPayment,
        term_months:      app.term_months ?? null,
        paid_months:      0,
        opened_date:      openDate,
        status:           'active',
      });
      if (loanErr) throw loanErr;

      const { error: updErr } = await supabase.from('loan_applications').update({
        status:                    'approved',
        monthly_payment_approved:  payment,
        interest_rate_approved:    rate,
        admin_note:                admin_note ?? null,
        updated_at:                new Date().toISOString(),
      }).eq('id', application_id);
      if (updErr) throw updErr;

      // Notify member
      const typeLabel: Record<string, string> = {
        personal:'Personal', auto:'Auto', mortgage:'Mortgage',
        student:'Student', business:'Business', heloc:'HELOC', credit_line:'Line of Credit',
      };
      const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2 });
      try {
        await supabase.from('notifications').insert({
          user_id: app.user_id,
          title:   'Loan Approved',
          message: `Your ${typeLabel[app.loan_type]||app.loan_type} loan of ${fmt(app.requested_amount)} has been approved and is now active.`,
          type:    'success',
          read:    false,
        });
      } catch { /* ignore */ }

      return json({ success: true, message: 'Loan application approved and loan created.' });
    }

    // ── Decline a loan application (admin) ────────────────────────────────────
    if (action === 'admin_decline_loan_application') {
      const { application_id, admin_note } =
        body as { action: string; application_id: string; admin_note?: string };
      if (!application_id) throw new Error('application_id required');

      const { data: app, error: fetchErr } = await supabase
        .from('loan_applications').select('*').eq('id', application_id).single();
      if (fetchErr || !app) throw new Error('Loan application not found');
      if (app.status !== 'pending') throw new Error('Application is not pending');

      const { error: updErr } = await supabase.from('loan_applications').update({
        status:     'declined',
        admin_note: admin_note ?? null,
        updated_at: new Date().toISOString(),
      }).eq('id', application_id);
      if (updErr) throw updErr;

      const typeLabel: Record<string, string> = {
        personal:'Personal', auto:'Auto', mortgage:'Mortgage',
        student:'Student', business:'Business', heloc:'HELOC', credit_line:'Line of Credit',
      };
      try {
        await supabase.from('notifications').insert({
          user_id: app.user_id,
          title:   'Loan Application Update',
          message: `Your ${typeLabel[app.loan_type]||app.loan_type} loan application could not be approved at this time.${admin_note ? ' Reason: ' + admin_note : ''}`,
          type:    'warning',
          read:    false,
        });
      } catch { /* ignore */ }

      return json({ success: true, message: 'Loan application declined.' });
    }

    // ── Send announcement to all users or a specific user (admin) ─────────────
    if (action === 'admin_send_announcement') {
      const { target, target_user_id, title, message, type: noteType } =
        body as { action: string; target: 'all' | 'user'; target_user_id?: string; title: string; message: string; type?: string };

      if (!title?.trim()) throw new Error('Announcement title is required.');
      if (!message?.trim()) throw new Error('Announcement message is required.');

      let userIds: string[] = [];

      if (target === 'all') {
        const { data: { users }, error: listErr } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        if (listErr) throw listErr;
        userIds = (users || []).map(u => u.id);
      } else {
        if (!target_user_id) throw new Error('target_user_id is required when target is "user".');
        userIds = [target_user_id];
      }

      if (!userIds.length) return json({ success: true, sent_to: 0 });

      const rows = userIds.map(uid => ({
        user_id: uid,
        title:   title.trim(),
        message: message.trim(),
        type:    noteType || 'announcement',
        read:    false,
      }));

      // Insert in batches of 500 to avoid Supabase payload limits
      for (let i = 0; i < rows.length; i += 500) {
        const { error: insErr } = await supabase.from('notifications').insert(rows.slice(i, i + 500));
        if (insErr) throw insErr;
      }

      return json({ success: true, sent_to: userIds.length });
    }

    throw new Error(`Unknown action: ${action}`);

  } catch (err) {
    return errJson(err);
  }
});

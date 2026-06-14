/**
 * ZenithOne Credit Union — Card Request Edge Function
 * Handles card applications, sends premium emails, notifies admin.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, errJson, getAuthToken } from '../_shared/cors.ts';

// `fee` is the base annual fee (Visa price). Network surcharges are added on top.
// No free cards — minimum possible price is $249.
const CARD_CATALOG: Record<string, { name: string; tier: string; category: string; fee: number; gradient: string }> = {
  virtual:       { name: 'ZenithOne Virtual',   tier: 'standard', category: 'debit',  fee: 249,  gradient: 'linear-gradient(135deg,#1a3a5c,#0d2840)' },
  classic_debit: { name: 'ZenithOne Classic',   tier: 'standard', category: 'debit',  fee: 299,  gradient: 'linear-gradient(135deg,#1e293b,#0f172a)' },
  gold:          { name: 'ZenithOne Gold',      tier: 'premium',  category: 'credit', fee: 399,  gradient: 'linear-gradient(135deg,#b8860b,#8b6914)' },
  platinum:      { name: 'ZenithOne Platinum',  tier: 'premium',  category: 'credit', fee: 549,  gradient: 'linear-gradient(135deg,#718096,#4a5568)' },
  titanium:      { name: 'ZenithOne Titanium',  tier: 'private',  category: 'credit', fee: 749,  gradient: 'linear-gradient(135deg,#9ca3af,#6b7280)' },
  black:         { name: 'ZenithOne Black',     tier: 'black',    category: 'credit', fee: 999,  gradient: 'linear-gradient(135deg,#111827,#000000)' },
  black_gold:    { name: 'Black Gold Elite',    tier: 'black',    category: 'credit', fee: 1299, gradient: 'linear-gradient(135deg,#1a0a00,#c9a84c)' },
  business:      { name: 'Business Platinum',   tier: 'premium',  category: 'credit', fee: 699,  gradient: 'linear-gradient(135deg,#1e3a5f,#0a1929)' },
};

// Network surcharges added on top of the base fee.
const NETWORK_SURCHARGE: Record<string, number> = {
  'Visa': 0, 'Discover': 30, 'Mastercard': 60, 'American Express': 120,
};

function cardEmailHtml(userName: string, cardName: string, fee: number, refId: string): string {
  const feeText = fee === 0 ? 'No annual fee' : `$${fee}/year annual fee`;
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#040d18;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#040d18;padding:40px 20px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">
  <!-- Header -->
  <tr><td style="padding-bottom:32px;text-align:center;">
    <div style="font-size:11px;letter-spacing:4px;color:#c9a84c;text-transform:uppercase;margin-bottom:6px;">ZenithOne Credit Union</div>
    <div style="width:40px;height:1px;background:linear-gradient(90deg,transparent,#c9a84c,transparent);margin:0 auto;"></div>
  </td></tr>

  <!-- Card Visual -->
  <tr><td style="padding-bottom:32px;">
    <div style="background:linear-gradient(135deg,#0a1929 0%,#111827 40%,#1a2a3a 100%);border-radius:18px;padding:36px;border:1px solid rgba(201,168,76,.25);box-shadow:0 20px 60px rgba(0,0,0,.6),0 0 80px rgba(201,168,76,.08);position:relative;overflow:hidden;">
      <div style="position:absolute;top:-40px;right:-40px;width:180px;height:180px;border-radius:50%;background:radial-gradient(circle,rgba(201,168,76,.15),transparent 70%);"></div>
      <div style="font-size:11px;letter-spacing:3px;color:rgba(201,168,76,.5);text-transform:uppercase;margin-bottom:4px;">Card Application Received</div>
      <div style="font-size:28px;font-weight:300;color:#ffffff;letter-spacing:1px;margin-bottom:24px;">${cardName}</div>
      <!-- Chip -->
      <div style="width:44px;height:34px;background:linear-gradient(135deg,#e8c96b,#c9a84c);border-radius:5px;margin-bottom:24px;"></div>
      <div style="font-size:15px;letter-spacing:6px;color:rgba(255,255,255,.55);margin-bottom:20px;font-family:'Courier New',monospace;">•••• •••• •••• ••••</div>
      <div style="display:flex;justify-content:space-between;align-items:flex-end;">
        <div>
          <div style="font-size:9px;letter-spacing:2px;color:rgba(255,255,255,.3);text-transform:uppercase;margin-bottom:3px;">Cardholder</div>
          <div style="font-size:13px;color:rgba(255,255,255,.7);letter-spacing:2px;text-transform:uppercase;">${userName}</div>
        </div>
        <div style="text-align:right;">
          <div style="display:inline-flex;">
            <div style="width:26px;height:26px;border-radius:50%;background:rgba(201,168,76,.5);margin-right:-10px;"></div>
            <div style="width:26px;height:26px;border-radius:50%;background:rgba(201,168,76,.8);"></div>
          </div>
        </div>
      </div>
    </div>
  </td></tr>

  <!-- Body -->
  <tr><td style="padding:0 8px 32px;">
    <div style="font-size:22px;color:#ffffff;font-weight:300;margin-bottom:8px;">Your application is under review, ${userName.split(' ')[0]}.</div>
    <div style="font-size:14px;color:#64748b;line-height:1.7;margin-bottom:24px;">We've received your application for the <strong style="color:#c9a84c;">${cardName}</strong>. Our team is reviewing your request and you'll hear from us within <strong style="color:#e2e8f0;">2–5 business days</strong>.</div>

    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;overflow:hidden;">
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.06);">
          <span style="font-size:11px;letter-spacing:2px;color:#64748b;text-transform:uppercase;">Reference ID</span>
          <div style="font-size:14px;color:#c9a84c;font-family:'Courier New',monospace;margin-top:4px;">#${refId.toUpperCase().slice(0,12)}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px;border-bottom:1px solid rgba(255,255,255,.06);">
          <span style="font-size:11px;letter-spacing:2px;color:#64748b;text-transform:uppercase;">Card Type</span>
          <div style="font-size:14px;color:#e2e8f0;margin-top:4px;">${cardName}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:16px 20px;">
          <span style="font-size:11px;letter-spacing:2px;color:#64748b;text-transform:uppercase;">Annual Fee</span>
          <div style="font-size:14px;color:#e2e8f0;margin-top:4px;">${feeText}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:24px 8px 0;border-top:1px solid rgba(255,255,255,.06);text-align:center;">
    <div style="font-size:11px;color:#334155;line-height:1.6;">© ${new Date().getFullYear()} ZenithOne Credit Union. Member FDIC.<br/>This is an automated confirmation. Do not reply to this email.</div>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

function adminEmailHtml(userName: string, userEmail: string, cardName: string, fee: number, refId: string, gradient: string): string {
  const feeText  = fee === 0 ? 'Free' : `$${fee}/yr`;
  const refShort = refId.toUpperCase().slice(0, 12);
  const yr       = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>Admin: New Card Request — ${cardName}</title>
<style>
@keyframes shimmer{0%{background-position:-500px 0}100%{background-position:500px 0}}
</style>
</head>
<body style="margin:0;padding:0;background:#020912;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
  style="background:linear-gradient(160deg,#020912 0%,#050d1a 60%,#030810 100%);padding:44px 16px;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

  <!-- Admin badge -->
  <tr><td style="text-align:center;padding-bottom:32px;">
    <div style="display:inline-block;font-size:9px;letter-spacing:4px;color:#f87171;text-transform:uppercase;border:1px solid rgba(248,113,113,.3);padding:5px 18px;border-radius:99px;background:rgba(248,113,113,.06);margin-bottom:12px;">Admin Notification</div>
    <div style="font-size:10px;letter-spacing:5px;color:rgba(201,168,76,.5);text-transform:uppercase;">ZenithOne Credit Union</div>
  </td></tr>

  <!-- Headline -->
  <tr><td style="text-align:center;padding:0 16px 32px;">
    <div style="font-size:11px;letter-spacing:4px;color:#f59e0b;text-transform:uppercase;margin-bottom:12px;">New Card Application Received</div>
    <div style="font-size:30px;font-weight:200;color:#ffffff;letter-spacing:-0.5px;line-height:1.2;margin-bottom:10px;">
      ${userName.split(' ')[0]} wants the<br/>
      <span style="color:#c9a84c;">${cardName}</span>
    </div>
  </td></tr>

  <!-- ══ Ultra-premium 3D Card ══ -->
  <tr><td align="center" style="padding:0 16px 36px;">
    <div style="display:inline-block;position:relative;filter:drop-shadow(0 50px 70px rgba(0,0,0,.95)) drop-shadow(0 0 50px rgba(201,168,76,.14));">
      <!-- Stacked depth layers -->
      <div style="position:absolute;top:14px;left:16px;right:-16px;bottom:-14px;background:rgba(0,0,0,.6);border-radius:20px;"></div>
      <div style="position:absolute;top:7px;left:8px;right:-8px;bottom:-7px;background:rgba(0,0,0,.4);border-radius:20px;"></div>
      <!-- Main card face -->
      <div style="
        position:relative;
        background:${gradient};
        border-radius:20px;
        width:390px;max-width:calc(100vw - 48px);
        padding:30px 28px 26px;
        border-top:1px solid rgba(255,255,255,.22);
        border-left:1px solid rgba(255,255,255,.14);
        border-right:1px solid rgba(0,0,0,.3);
        border-bottom:1px solid rgba(0,0,0,.5);
        overflow:hidden;
      ">
        <!-- Shimmer sweep -->
        <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:linear-gradient(105deg,transparent 20%,rgba(255,255,255,.12) 50%,transparent 80%);background-size:700px 100%;animation:shimmer 4s infinite linear;pointer-events:none;z-index:1;"></div>
        <!-- Radial holographic glow top-right -->
        <div style="position:absolute;top:-60px;right:-60px;width:230px;height:230px;border-radius:50%;background:radial-gradient(circle,rgba(201,168,76,.25) 0%,transparent 65%);pointer-events:none;z-index:1;"></div>
        <!-- Bottom-left subtle glow -->
        <div style="position:absolute;bottom:-40px;left:-40px;width:160px;height:160px;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.04) 0%,transparent 70%);pointer-events:none;z-index:1;"></div>
        <!-- Card content -->
        <div style="position:relative;z-index:2;">
          <!-- Top row -->
          <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px;">
            <div>
              <div style="font-size:8px;letter-spacing:5px;color:rgba(255,255,255,.28);text-transform:uppercase;margin-bottom:2px;">ZenithOne</div>
              <div style="font-size:16px;color:rgba(255,255,255,.88);font-weight:300;letter-spacing:.3px;">${cardName}</div>
            </div>
            <div style="font-size:8px;letter-spacing:2px;color:rgba(255,255,255,.28);text-transform:uppercase;text-align:right;">
              <div style="color:rgba(255,165,0,.7);border:1px solid rgba(255,165,0,.25);padding:2px 8px;border-radius:99px;font-size:7px;letter-spacing:2px;background:rgba(255,165,0,.05);">PENDING REVIEW</div>
            </div>
          </div>
          <!-- Chip -->
          <div style="width:46px;height:36px;border-radius:6px;margin-bottom:20px;background:linear-gradient(135deg,#f0d060 0%,#d4a830 35%,#a07020 65%,#e8c050 100%);box-shadow:0 2px 10px rgba(0,0,0,.5),0 1px 0 rgba(255,255,255,.25) inset;position:relative;overflow:hidden;">
            <div style="position:absolute;top:50%;left:0;right:0;height:1px;background:rgba(0,0,0,.25);"></div>
            <div style="position:absolute;left:50%;top:0;bottom:0;width:1px;background:rgba(0,0,0,.15);"></div>
          </div>
          <!-- Card number placeholder -->
          <div style="font-size:17px;letter-spacing:6px;color:rgba(255,255,255,.5);margin-bottom:20px;font-family:'Courier New',Courier,monospace;">•••• •••• •••• ••••</div>
          <!-- Bottom row -->
          <div style="display:flex;justify-content:space-between;align-items:flex-end;">
            <div>
              <div style="font-size:8px;letter-spacing:2px;color:rgba(255,255,255,.22);text-transform:uppercase;margin-bottom:4px;">Applicant</div>
              <div style="font-size:13px;color:rgba(255,255,255,.78);letter-spacing:2px;text-transform:uppercase;">${userName}</div>
            </div>
            <div style="text-align:right;">
              <div style="font-size:8px;letter-spacing:2px;color:rgba(255,255,255,.22);text-transform:uppercase;margin-bottom:4px;">Annual Fee</div>
              <div style="font-size:13px;color:${fee === 0 ? '#4ade80' : '#c9a84c'};letter-spacing:1px;font-family:'Courier New',Courier,monospace;">${feeText}</div>
            </div>
          </div>
        </div>
        <!-- Bottom shadow cast under card -->
        <div style="position:absolute;bottom:-18px;left:10%;right:10%;height:25px;background:rgba(0,0,0,.45);filter:blur(12px);border-radius:50%;pointer-events:none;"></div>
      </div>
    </div>
  </td></tr>

  <!-- Details table -->
  <tr><td style="padding:0 16px 28px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
      style="background:rgba(255,255,255,.022);border:1px solid rgba(255,255,255,.07);border-radius:14px;overflow:hidden;">
      <tr>
        <td style="padding:15px 20px;border-bottom:1px solid rgba(255,255,255,.05);">
          <div style="font-size:9px;letter-spacing:2px;color:#334155;text-transform:uppercase;margin-bottom:5px;">Member</div>
          <div style="font-size:14px;color:#e2e8f0;">${userName}</div>
        </td>
        <td style="padding:15px 20px;border-bottom:1px solid rgba(255,255,255,.05);border-left:1px solid rgba(255,255,255,.05);">
          <div style="font-size:9px;letter-spacing:2px;color:#334155;text-transform:uppercase;margin-bottom:5px;">Email</div>
          <div style="font-size:13px;color:#c9a84c;">${userEmail}</div>
        </td>
      </tr>
      <tr>
        <td style="padding:15px 20px;">
          <div style="font-size:9px;letter-spacing:2px;color:#334155;text-transform:uppercase;margin-bottom:5px;">Card Applied</div>
          <div style="font-size:14px;color:#e2e8f0;">${cardName}</div>
        </td>
        <td style="padding:15px 20px;border-left:1px solid rgba(255,255,255,.05);">
          <div style="font-size:9px;letter-spacing:2px;color:#334155;text-transform:uppercase;margin-bottom:5px;">Reference</div>
          <div style="font-size:13px;color:#c9a84c;font-family:'Courier New',Courier,monospace;letter-spacing:2px;">#${refShort}</div>
        </td>
      </tr>
    </table>
  </td></tr>

  <!-- Action reminder -->
  <tr><td style="padding:0 16px 36px;text-align:center;">
    <div style="font-size:12px;color:#334155;line-height:1.85;">Log in to the ZenithOne Admin Panel to approve or reject this request.<br/>The member is awaiting your decision.</div>
  </td></tr>

  <!-- Footer -->
  <tr><td style="padding:20px 16px 0;border-top:1px solid rgba(255,255,255,.04);text-align:center;">
    <div style="font-size:10px;letter-spacing:.5px;color:#1e293b;line-height:1.9;">
      © ${yr} ZenithOne Credit Union &nbsp;·&nbsp; Internal Admin Alert<br/>
      This notification was sent automatically. Do not reply to this email.
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

    const body = await req.json() as { card_type_key: string; network?: string };
    const { card_type_key } = body;
    const network = body.network ?? 'Visa';

    const cardDef = CARD_CATALOG[card_type_key];
    if (!cardDef) throw new Error('Invalid card type');
    if (!(network in NETWORK_SURCHARGE)) throw new Error('Invalid card network');

    // Base fee is admin-editable (card_pricing table); fall back to catalog default.
    const { data: priceRow } = await supabase
      .from('card_pricing').select('base_fee').eq('card_type_key', card_type_key).maybeSingle();
    const baseFee  = priceRow ? Number(priceRow.base_fee) : cardDef.fee;

    // Final price = base fee + network surcharge. Name carries the chosen network.
    const fee      = baseFee + NETWORK_SURCHARGE[network];
    const cardName = `${cardDef.name} ${network}`;

    // Get user profile
    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
    const userName = profile?.full_name || user.email?.split('@')[0] || 'Member';

    // Prevent duplicate pending requests
    const { data: existing } = await supabase
      .from('card_requests')
      .select('id')
      .eq('user_id', user.id)
      .eq('card_type_key', card_type_key)
      .eq('status', 'pending')
      .maybeSingle();
    if (existing) throw new Error('You already have a pending request for this card type.');

    // ── Require sufficient balance, then charge the card price ───────────────────
    // Check all active accounts; prefer checking, fall back to savings/money_market.
    const { data: allAccts } = await supabase
      .from('accounts').select('id, balance, account_type')
      .eq('user_id', user.id).eq('status', 'active')
      .in('account_type', ['checking', 'savings', 'money_market'])
      .order('account_type'); // checking < money_market < savings alphabetically

    if (!allAccts || allAccts.length === 0)
      throw new Error('No active account found to pay the card fee. Please ensure your account is active.');

    // Pick: (1) checking with enough, (2) any account with enough, (3) checking (to show its balance in error)
    const account =
      allAccts.find(a => a.account_type === 'checking' && Number(a.balance) >= fee) ||
      allAccts.find(a => Number(a.balance) >= fee) ||
      allAccts.find(a => a.account_type === 'checking') ||
      allAccts[0];

    const balance = Number(account.balance ?? 0);
    if (balance < fee) {
      const total = allAccts.reduce((s, a) => s + Number(a.balance || 0), 0);
      throw new Error(`Insufficient balance. The ${cardName} costs $${fee.toFixed(2)}, but your total account balance is $${total.toFixed(2)}. Please add funds and try again.`);
    }

    // Insert request
    const { data: request, error: reqErr } = await supabase
      .from('card_requests')
      .insert({
        user_id:       user.id,
        card_type_key,
        card_name:     cardName,
        card_tier:     cardDef.tier,
        card_category: cardDef.category,
        annual_fee:    fee,
      })
      .select('id')
      .single();
    if (reqErr) throw reqErr;

    const refId = request.id;

    // Charge the card price to checking (trigger debits the balance). Roll back the
    // request if the charge fails so a member is never left with an unpaid request.
    const { error: chargeErr } = await supabase.from('transactions').insert({
      account_id:       account.id,
      user_id:          user.id,
      amount:           fee,
      transaction_type: 'fee',
      category:         'fee',
      status:           'completed',
      description:      `Card purchase — ${cardName}`,
      reference_number: `CARD${Date.now()}`,
    });
    if (chargeErr) {
      await supabase.from('card_requests').delete().eq('id', refId);
      throw new Error('Could not process the card payment. Please try again.');
    }
    const newBalance = balance - fee;

    // Notify user in-app
    await supabase.from('notifications').insert({
      user_id:  user.id,
      title:    `Card Application Received — ${cardName}`,
      message:  `Your application for the ${cardName} is under review. $${fee.toFixed(2)} has been charged to your checking account (new balance $${newBalance.toFixed(2)}). Reference: #${refId.slice(0,8).toUpperCase()}. We'll update you within 2–5 business days.`,
      type:     'system',
      priority: 'high',
    });

    // Notify all admins in-app
    const { data: admins } = await supabase.from('profiles').select('id').eq('is_admin', true);
    if (admins && admins.length > 0) {
      await supabase.from('notifications').insert(
        admins.map((a: { id: string }) => ({
          user_id:  a.id,
          title:    `New Card Request: ${cardName}`,
          message:  `${userName} (${user.email}) has applied for the ${cardName}${fee > 0 ? ` ($${fee}/yr)` : ''}. Ref: #${refId.slice(0,8).toUpperCase()}`,
          type:     'system',
          priority: 'high',
        }))
      );
    }

    // Send emails via Resend (if API key is configured)
    const resendKey = Deno.env.get('RESEND_API_KEY');
    if (resendKey && user.email) {
      const fromAddr = 'ZenithOne Credit Union <noreply@zenithonecreditunion.com>';

      // Email to user
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from:    fromAddr,
          to:      [user.email],
          subject: `Your ${cardName} Application — ZenithOne Credit Union`,
          html:    cardEmailHtml(userName, cardName, fee, refId),
        }),
      });

      // Email to admin(s)
      const { data: authAdmins } = await supabase.auth.admin.listUsers({ perPage: 100 });
      const adminProfiles = await supabase.from('profiles').select('id').eq('is_admin', true);
      const adminIds = new Set((adminProfiles.data || []).map((p: { id: string }) => p.id));
      const adminEmails = (authAdmins?.users || []).filter(u => adminIds.has(u.id)).map(u => u.email).filter(Boolean);

      if (adminEmails.length > 0) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from:    fromAddr,
            to:      adminEmails,
            subject: `[Admin] New Card Request: ${cardName} — ${userName}`,
            html:    adminEmailHtml(userName, user.email!, cardName, fee, refId, cardDef.gradient),
          }),
        });
      }
    }

    return json({
      success:     true,
      request_id:  refId,
      card_name:   cardName,
      amount_charged: fee,
      new_balance: newBalance,
      message:     `Your application for the ${cardName} has been submitted. $${fee.toFixed(2)} was charged to your checking account. Reference: #${refId.slice(0,8).toUpperCase()}`,
    });

  } catch (err) {
    return errJson(err);
  }
});

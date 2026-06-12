/**
 * ZenithOne Credit Union — Card Request Edge Function
 * Handles card applications, sends premium emails, notifies admin.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, errJson, getAuthToken } from '../_shared/cors.ts';

const CARD_CATALOG: Record<string, { name: string; tier: string; category: string; fee: number; gradient: string }> = {
  virtual:       { name: 'Virtual Card',           tier: 'standard', category: 'debit',  fee: 0,   gradient: 'linear-gradient(135deg,#1a3a5c,#0d2840)' },
  classic_debit: { name: 'Classic Debit',          tier: 'standard', category: 'debit',  fee: 0,   gradient: 'linear-gradient(135deg,#1e293b,#0f172a)' },
  gold:          { name: 'ZenithOne Gold Visa®',   tier: 'premium',  category: 'credit', fee: 95,  gradient: 'linear-gradient(135deg,#b8860b,#8b6914)' },
  platinum:      { name: 'ZenithOne Platinum Visa®',tier:'premium',  category: 'credit', fee: 195, gradient: 'linear-gradient(135deg,#718096,#4a5568)' },
  titanium:      { name: 'ZenithOne Titanium Visa®',tier:'private',  category: 'credit', fee: 295, gradient: 'linear-gradient(135deg,#9ca3af,#6b7280)' },
  black:         { name: 'ZenithOne Black Visa®',  tier: 'black',    category: 'credit', fee: 395, gradient: 'linear-gradient(135deg,#111827,#000000)' },
  black_gold:    { name: 'Black Gold Elite Mastercard®', tier:'black',category:'credit', fee: 595, gradient: 'linear-gradient(135deg,#1a0a00,#c9a84c)' },
  business:      { name: 'Business Platinum Visa®',tier: 'premium',  category: 'credit', fee: 350, gradient: 'linear-gradient(135deg,#1e3a5f,#0a1929)' },
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
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"/></head>
<body style="margin:0;padding:0;background:#040d18;font-family:'Helvetica Neue',Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#040d18;padding:40px 20px;">
<tr><td align="center">
<table width="580" cellpadding="0" cellspacing="0" style="max-width:580px;width:100%;">
  <tr><td style="padding-bottom:24px;">
    <div style="font-size:11px;letter-spacing:4px;color:#c9a84c;text-transform:uppercase;">Admin · New Card Request</div>
  </td></tr>
  <!-- 3D Card representation -->
  <tr><td style="padding-bottom:32px;">
    <div style="background:${gradient};border-radius:18px;padding:28px 32px;box-shadow:0 30px 60px rgba(0,0,0,.8),8px 8px 0 rgba(0,0,0,.4),0 0 40px rgba(201,168,76,.1);border:1px solid rgba(255,255,255,.12);transform:perspective(800px) rotateY(-8deg) rotateX(4deg);position:relative;overflow:hidden;">
      <div style="position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(255,255,255,.3),transparent);"></div>
      <div style="position:absolute;bottom:-30px;right:-30px;width:120px;height:120px;border-radius:50%;background:rgba(255,255,255,.04);"></div>
      <div style="font-size:10px;letter-spacing:3px;color:rgba(255,255,255,.4);text-transform:uppercase;margin-bottom:4px;">ZENITHONE</div>
      <div style="font-size:18px;color:rgba(255,255,255,.9);font-weight:300;margin-bottom:20px;">${cardName}</div>
      <div style="width:38px;height:28px;background:linear-gradient(135deg,#e8c96b,#c9a84c);border-radius:4px;margin-bottom:16px;"></div>
      <div style="font-size:13px;letter-spacing:5px;color:rgba(255,255,255,.45);margin-bottom:14px;font-family:'Courier New',monospace;">•••• •••• •••• ••••</div>
      <div style="font-size:12px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:2px;">${userName}</div>
    </div>
  </td></tr>
  <!-- Details -->
  <tr><td style="padding-bottom:24px;">
    <div style="font-size:18px;color:#fff;margin-bottom:16px;">New Card Application</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;">
      <tr><td style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.05);"><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Member</span><div style="color:#e2e8f0;margin-top:3px;">${userName}</div></td></tr>
      <tr><td style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.05);"><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Email</span><div style="color:#c9a84c;margin-top:3px;">${userEmail}</div></td></tr>
      <tr><td style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.05);"><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Card</span><div style="color:#e2e8f0;margin-top:3px;">${cardName}</div></td></tr>
      <tr><td style="padding:14px 18px;border-bottom:1px solid rgba(255,255,255,.05);"><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Annual Fee</span><div style="color:#4ade80;margin-top:3px;">${fee === 0 ? 'Free' : '$' + fee + '/yr'}</div></td></tr>
      <tr><td style="padding:14px 18px;"><span style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;">Reference</span><div style="color:#c9a84c;font-family:'Courier New',monospace;margin-top:3px;">#${refId.toUpperCase().slice(0,12)}</div></td></tr>
    </table>
  </td></tr>
  <tr><td style="text-align:center;padding-top:16px;">
    <div style="font-size:11px;color:#334155;">Login to admin panel to approve or reject this request.</div>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;
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

    const body = await req.json() as { card_type_key: string };
    const { card_type_key } = body;

    const cardDef = CARD_CATALOG[card_type_key];
    if (!cardDef) throw new Error('Invalid card type');

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

    // Insert request
    const { data: request, error: reqErr } = await supabase
      .from('card_requests')
      .insert({
        user_id:       user.id,
        card_type_key,
        card_name:     cardDef.name,
        card_tier:     cardDef.tier,
        card_category: cardDef.category,
        annual_fee:    cardDef.fee,
      })
      .select('id')
      .single();
    if (reqErr) throw reqErr;

    const refId = request.id;

    // Notify user in-app
    await supabase.from('notifications').insert({
      user_id:  user.id,
      title:    `Card Application Received — ${cardDef.name}`,
      message:  `Your application for the ${cardDef.name} is under review. Reference: #${refId.slice(0,8).toUpperCase()}. We'll update you within 2–5 business days.`,
      type:     'system',
      priority: 'high',
    });

    // Notify all admins in-app
    const { data: admins } = await supabase.from('profiles').select('id').eq('is_admin', true);
    if (admins && admins.length > 0) {
      await supabase.from('notifications').insert(
        admins.map((a: { id: string }) => ({
          user_id:  a.id,
          title:    `New Card Request: ${cardDef.name}`,
          message:  `${userName} (${user.email}) has applied for the ${cardDef.name}${cardDef.fee > 0 ? ` ($${cardDef.fee}/yr)` : ''}. Ref: #${refId.slice(0,8).toUpperCase()}`,
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
          subject: `Your ${cardDef.name} Application — ZenithOne Credit Union`,
          html:    cardEmailHtml(userName, cardDef.name, cardDef.fee, refId),
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
            subject: `[Admin] New Card Request: ${cardDef.name} — ${userName}`,
            html:    adminEmailHtml(userName, user.email!, cardDef.name, cardDef.fee, refId, cardDef.gradient),
          }),
        });
      }
    }

    return json({
      success:    true,
      request_id: refId,
      card_name:  cardDef.name,
      message:    `Your application for the ${cardDef.name} has been submitted. Reference: #${refId.slice(0,8).toUpperCase()}`,
    });

  } catch (err) {
    return errJson(err);
  }
});

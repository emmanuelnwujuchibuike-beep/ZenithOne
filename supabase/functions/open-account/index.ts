/**
 * ZenithOne Credit Union — Open Account Application
 * Actions: apply | list_user | list_pending | verify
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, errJson, getAuthToken } from '../_shared/cors.ts';

const FROM_ADDR  = Deno.env.get('RESEND_FROM') || 'ZenithOne Credit Union <onboarding@resend.dev>';
const ADMIN_SITE = 'https://zenithonecreditunion.com';

// ── Account type metadata ─────────────────────────────────────────────────────
const ACCOUNT_META: Record<string, { label: string; rate: string; color: string }> = {
  'essential-checking':  { label: 'Essential Checking',         rate: '0.01% APY',  color: '#60a5fa' },
  'interest-checking':   { label: 'Interest Checking',          rate: '0.15% APY',  color: '#34d399' },
  'high-yield-savings':  { label: 'High-Yield Savings',         rate: '4.75% APY',  color: '#c9a84c' },
  'money-market':        { label: 'Money Market Savings',       rate: '4.25% APY',  color: '#a78bfa' },
  'cd':                  { label: 'Certificate of Deposit',     rate: 'Up to 5.25% APY', color: '#f59e0b' },
  'youth-checking':      { label: 'Youth/Student Checking',     rate: '0.05% APY',  color: '#4ade80' },
  'business-checking':   { label: 'Business Checking',          rate: '0.01% APY',  color: '#fb923c' },
  'business-savings':    { label: 'Business Savings',           rate: '3.50% APY',  color: '#38bdf8' },
  'ira-savings':         { label: 'IRA Savings',                rate: '4.00% APY',  color: '#f472b6' },
};

// ═════════════════════════════════════════════════════════════════════════════
//  SHARED EMAIL SHELL
// ═════════════════════════════════════════════════════════════════════════════
const emailStyles = `<style>
  body,table,td,p,a { margin:0;padding:0; }
  img { border:0;display:block; }
  body,#eBody { background:#04090f !important; }
  #eWrap { background:#04090f; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; }
  #eHdr  { background:linear-gradient(170deg,#0e2040 0%,#060e1a 100%); }
  #eCard { background:#0c1a2e; border:1px solid rgba(201,168,76,.18); border-top:none; }
  .e-txt-primary   { color:#f0f4f8 !important; }
  .e-txt-secondary { color:rgba(240,244,248,.52) !important; }
  .e-txt-gold      { color:#c9a84c !important; }
  .e-txt-green     { color:#4ade80 !important; }
  .e-txt-red       { color:#f87171 !important; }
  .e-row-bg  { background:rgba(255,255,255,.025) !important; }
  .e-badge-pending  { display:inline-block;background:rgba(251,191,36,.12) !important;color:#fbbf24 !important;border:1px solid rgba(251,191,36,.3) !important;border-radius:99px;padding:4px 14px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase; }
  .e-badge-ok       { display:inline-block;background:rgba(74,222,128,.12) !important;color:#4ade80 !important;border:1px solid rgba(74,222,128,.3) !important;border-radius:99px;padding:4px 14px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase; }
  .e-badge-review   { display:inline-block;background:rgba(96,165,250,.12) !important;color:#60a5fa !important;border:1px solid rgba(96,165,250,.3) !important;border-radius:99px;padding:4px 14px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase; }
  .e-badge-err      { display:inline-block;background:rgba(248,113,113,.12) !important;color:#f87171 !important;border:1px solid rgba(248,113,113,.3) !important;border-radius:99px;padding:4px 14px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase; }
  .e-btn  { display:inline-block;background:linear-gradient(135deg,#c9a84c,#e8d07a) !important;color:#04090f !important;text-decoration:none;border-radius:12px;padding:16px 52px;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase; }
  .e-footer { color:rgba(255,255,255,.22) !important; }
  .e-box-gold  { background:rgba(201,168,76,.06) !important;border:1px solid rgba(201,168,76,.16) !important;border-radius:14px; }
  .e-box-green { background:rgba(74,222,128,.05) !important;border:1px solid rgba(74,222,128,.18) !important;border-radius:14px; }
  .e-box-red   { background:rgba(248,113,113,.05) !important;border:1px solid rgba(248,113,113,.18) !important;border-radius:14px; }
  .e-box-blue  { background:rgba(96,165,250,.05) !important;border:1px solid rgba(96,165,250,.18) !important;border-radius:14px; }
  @media (prefers-color-scheme:light) {
    body,#eBody { background:#edf1f6 !important; }
    #eWrap { background:#edf1f6 !important; }
    #eCard { background:#ffffff !important;border:1px solid rgba(0,0,0,.09) !important;border-top:none !important;box-shadow:0 12px 56px rgba(0,0,0,.13) !important; }
    .e-txt-primary   { color:#0d1e35 !important; }
    .e-txt-secondary { color:#4e6070 !important; }
    .e-txt-gold      { color:#8f6c1c !important; }
    .e-txt-green     { color:#15803d !important; }
    .e-txt-red       { color:#b91c1c !important; }
    .e-row-bg  { background:#f7f9fb !important; }
    .e-badge-pending { background:rgba(146,109,0,.1) !important;color:#7a5900 !important;border:1px solid rgba(146,109,0,.25) !important; }
    .e-badge-ok      { background:rgba(21,128,61,.1) !important;color:#15803d !important;border:1px solid rgba(21,128,61,.25) !important; }
    .e-badge-review  { background:rgba(29,78,216,.1) !important;color:#1d4ed8 !important;border:1px solid rgba(29,78,216,.25) !important; }
    .e-badge-err     { background:rgba(185,28,28,.1) !important;color:#b91c1c !important;border:1px solid rgba(185,28,28,.25) !important; }
    .e-btn   { background:linear-gradient(135deg,#8f6c1c,#c9a84c) !important;color:#ffffff !important; }
    .e-footer { color:#94a3b8 !important; }
    .e-box-gold  { background:rgba(143,108,28,.07) !important;border:1px solid rgba(143,108,28,.18) !important; }
    .e-box-green { background:rgba(21,128,61,.07) !important;border:1px solid rgba(21,128,61,.2) !important; }
    .e-box-red   { background:rgba(185,28,28,.07) !important;border:1px solid rgba(185,28,28,.2) !important; }
    .e-box-blue  { background:rgba(29,78,216,.07) !important;border:1px solid rgba(29,78,216,.2) !important; }
  }
  @media only screen and (max-width:640px) {
    #eWrap { padding:0 !important; }
    #eCard { border-radius:0 !important;border-left:none !important;border-right:none !important; }
    #eHdr  { border-radius:0 !important; }
    .e-pad { padding-left:20px !important;padding-right:20px !important; }
    .e-btn { padding:14px 36px !important; }
  }
</style>`;

function emailShell(title: string, preheader: string, body: string): string {
  const yr = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="UTF-8"/><meta http-equiv="X-UA-Compatible" content="IE=edge"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="color-scheme" content="light dark"/>
<meta name="supported-color-schemes" content="light dark"/>
<title>${title}</title>${emailStyles}
</head>
<body id="eBody" style="margin:0;padding:0;background:#04090f;-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#04090f;">${preheader}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>
<div id="eWrap" style="padding:48px 20px 44px;background:#04090f;">
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;margin:0 auto;"><tr><td>

<!-- HEADER -->
<table id="eHdr" width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:linear-gradient(170deg,#0e2040 0%,#060e1a 100%);border-radius:22px 22px 0 0;">
<tr><td height="3" style="height:3px;background:linear-gradient(90deg,transparent,#c9a84c 30%,#e8d07a 50%,#c9a84c 70%,transparent);font-size:0;">&nbsp;</td></tr>
<tr><td align="center" style="padding:44px 24px 40px;">
  <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;">
    <tr><td align="center" valign="middle" style="width:68px;height:68px;border-radius:18px;background:linear-gradient(135deg,#c9a84c,#e8d07a 52%,#c9a84c);text-align:center;vertical-align:middle;box-shadow:0 8px 32px rgba(201,168,76,.35);">
      <span style="display:block;font-size:28px;font-weight:900;color:#04090f;letter-spacing:-.04em;line-height:68px;font-family:Georgia,serif;">ZO</span>
    </td></tr>
  </table>
  <p style="margin:20px 0 0;font-size:13px;font-weight:800;letter-spacing:.32em;text-transform:uppercase;color:#c9a84c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">ZENITHONE</p>
  <p style="margin:6px 0 0;font-size:9px;font-weight:600;letter-spacing:.26em;text-transform:uppercase;color:rgba(201,168,76,.45);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">CREDIT UNION</p>
</td></tr>
<tr><td height="1" style="height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.28) 30%,rgba(201,168,76,.28) 70%,transparent);font-size:0;">&nbsp;</td></tr>
</table>

<!-- BODY -->
<div id="eCard" style="background:#0c1a2e;border:1px solid rgba(201,168,76,.18);border-top:none;border-radius:0 0 22px 22px;overflow:hidden;">
  ${body}
</div>

<!-- FOOTER -->
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:36px;">
<tr><td align="center" style="padding:0 20px;">
  <p class="e-footer" style="margin:0;font-size:11px;line-height:1.95;color:rgba(255,255,255,.22);text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    &copy; ${yr} ZenithOne Credit Union &mdash; All rights reserved.<br/>
    This is a secure, automated notification. Please do not reply directly.<br/>
    <a href="${ADMIN_SITE}/contact.html" style="color:#c9a84c;text-decoration:none;">Contact Support</a>
    &nbsp;&bull;&nbsp;
    <a href="${ADMIN_SITE}" style="color:rgba(255,255,255,.28);text-decoration:none;">zenithonecreditunion.com</a>
  </p>
</td></tr>
</table>

</td></tr></table>
</div>
</body></html>`;
}

function detailRow(label: string, value: string): string {
  return `<tr>
  <td class="e-row-bg" style="padding:14px 32px;background:rgba(255,255,255,.025);">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"><tr>
      <td class="e-txt-secondary" style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;font-weight:700;width:44%;padding-right:16px;vertical-align:middle;color:rgba(240,244,248,.5);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${label}</td>
      <td class="e-txt-primary" style="font-size:13px;font-weight:600;text-align:right;vertical-align:middle;color:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${value}</td>
    </tr></table>
  </td>
</tr>
<tr><td style="height:1px;background:rgba(255,255,255,.06);font-size:0;">&nbsp;</td></tr>`;
}

// ── Application received (to user) ────────────────────────────────────────────
function applicationReceivedEmail(opts: {
  userName: string; accountLabel: string; accountType: string;
  referenceId: string; submittedAt: string; accentColor: string;
}): string {
  const body = `
<div class="e-pad" style="padding:44px 32px 32px;text-align:center;">
  <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 24px;">
    <tr><td align="center" valign="middle" style="width:68px;height:68px;border-radius:18px;background:rgba(201,168,76,.1);border:1.5px solid rgba(201,168,76,.24);text-align:center;vertical-align:middle;line-height:68px;font-size:34px;font-family:Arial,sans-serif;">
      <span style="color:#c9a84c;display:inline-block;line-height:1;vertical-align:middle;">&#9733;</span>
    </td></tr>
  </table>
  <h1 class="e-txt-primary" style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4f8;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Application Received</h1>
  <p class="e-txt-secondary" style="margin:0 auto;font-size:14px;line-height:1.75;color:rgba(240,244,248,.52);max-width:420px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    Hello <strong class="e-txt-primary" style="color:#f0f4f8;font-weight:700;">${opts.userName}</strong>, your application for a <strong style="color:${opts.accentColor};">${opts.accountLabel}</strong> has been received and is being reviewed by our team.
  </p>
</div>
<div style="height:1px;background:rgba(255,255,255,.07);margin:0 32px;"></div>

<!-- Account type highlight -->
<div class="e-pad" style="padding:28px 32px 20px;">
  <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:22px 24px;text-align:center;">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:rgba(240,244,248,.38);font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Account Applied For</p>
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${opts.accentColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${opts.accountLabel}</p>
    <span class="e-badge-pending">Pending Review</span>
  </div>
</div>

<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  ${detailRow('Reference ID', opts.referenceId.slice(0, 8).toUpperCase())}
  ${detailRow('Submitted', opts.submittedAt)}
  ${detailRow('Review Time', '1–3 Business Days')}
</table>

<!-- Timeline -->
<div class="e-pad" style="padding:28px 32px 24px;">
  <p class="e-txt-secondary" style="margin:0 0 22px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:rgba(240,244,248,.4);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Application Timeline</p>
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
    ${[
      ['Application Submitted', 'We\'ve received your application and queued it for review.', true],
      ['Identity Verification', 'Our compliance team will verify your identity and information.', false],
      ['Credit & Risk Assessment', 'We\'ll review your financial profile and application details.', false],
      ['Decision & Account Opening', 'You\'ll receive an email with our decision within 1–3 business days.', false],
    ].map(([step, desc, done], i, arr) => `
    <tr>
      <td width="40" valign="top" style="padding-bottom:0;">
        <table cellpadding="0" cellspacing="0" role="presentation">
          <tr><td align="center" valign="middle" style="width:28px;height:28px;border-radius:50%;${done ? 'background:rgba(201,168,76,.14);border:2px solid #c9a84c;' : 'background:rgba(255,255,255,.06);border:2px solid rgba(255,255,255,.15);'}text-align:center;vertical-align:middle;">
            ${done ? `<span style="font-size:13px;font-weight:900;color:#c9a84c;line-height:28px;display:inline-block;font-family:Arial,sans-serif;">&#10003;</span>`
                   : `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.25);vertical-align:middle;"></span>`}
          </td></tr>
          ${i < arr.length - 1 ? `<tr><td align="center" style="padding:2px 0;"><div style="width:2px;height:34px;background:rgba(255,255,255,.09);margin:0 auto;"></div></td></tr>` : ''}
        </table>
      </td>
      <td style="padding-left:14px;padding-bottom:${i < arr.length - 1 ? '24px' : '0'};vertical-align:top;">
        <p class="e-txt-primary" style="margin:0 0 3px;font-size:13px;font-weight:700;color:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${step}</p>
        <p class="e-txt-secondary" style="margin:0;font-size:12px;line-height:1.65;color:rgba(240,244,248,.5);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${desc}</p>
      </td>
    </tr>`).join('')}
  </table>
</div>

<div style="height:1px;background:rgba(255,255,255,.07);margin:0 32px;"></div>
<div style="padding:36px 32px;text-align:center;">
  <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;">
    <tr><td align="center" style="border-radius:12px;background:linear-gradient(135deg,#c9a84c,#e8d07a);">
      <a href="${ADMIN_SITE}/accounts.html" class="e-btn" style="display:inline-block;padding:16px 52px;font-size:13px;font-weight:800;color:#04090f;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">View My Applications</a>
    </td></tr>
  </table>
</div>`;
  return emailShell(`Account Application Received — ZenithOne`, `Your ${opts.accountLabel} application is under review.`, body);
}

// ── Admin notification email ──────────────────────────────────────────────────
function adminApplicationEmail(opts: {
  userName: string; userEmail: string; accountLabel: string;
  referenceId: string; submittedAt: string; accentColor: string;
  details: Record<string, string>;
}): string {
  const body = `
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:rgba(201,168,76,.08);border-bottom:1px solid rgba(201,168,76,.18);">
<tr><td style="padding:16px 32px;">
  <table cellpadding="0" cellspacing="0" role="presentation"><tr>
    <td valign="middle" style="padding-right:10px;">
      <span style="font-size:15px;color:#c9a84c;display:inline-block;vertical-align:middle;font-weight:700;font-family:Arial,sans-serif;">&#9432;</span>
    </td>
    <td valign="middle"><span class="e-txt-gold" style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#c9a84c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Action Required — New Account Application</span></td>
  </tr></table>
</td></tr>
</table>

<div class="e-pad" style="padding:32px 32px 24px;">
  <h2 class="e-txt-primary" style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">New ${opts.accountLabel} Application</h2>
  <p class="e-txt-secondary" style="margin:0;font-size:13px;line-height:1.7;color:rgba(240,244,248,.52);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">A ZenithOne member has applied to open a new account. Please review in the Admin Dashboard.</p>
</div>

<!-- Member info -->
<div class="e-pad e-box-gold" style="margin:0 32px 24px;padding:20px 22px;background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.16);border-radius:14px;">
  <p class="e-txt-secondary" style="margin:0 0 10px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:rgba(240,244,248,.4);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Applicant</p>
  <p class="e-txt-primary" style="margin:0 0 5px;font-size:16px;font-weight:700;color:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${opts.userName}</p>
  <p class="e-txt-secondary" style="margin:0;font-size:13px;color:rgba(240,244,248,.52);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${opts.userEmail}</p>
</div>

<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  ${Object.entries(opts.details).map(([l, v]) => detailRow(l, v)).join('')}
  ${detailRow('Reference ID', opts.referenceId.slice(0, 8).toUpperCase())}
  ${detailRow('Submitted', opts.submittedAt)}
</table>

<div style="padding:36px 32px;text-align:center;">
  <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;">
    <tr><td align="center" style="border-radius:12px;background:linear-gradient(135deg,#c9a84c,#e8d07a);">
      <a href="${ADMIN_SITE}/dashboard.html" class="e-btn" style="display:inline-block;padding:16px 52px;font-size:13px;font-weight:800;color:#04090f;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Review in Dashboard</a>
    </td></tr>
  </table>
</div>`;
  return emailShell('New Account Application — ZenithOne Admin', `${opts.userName} applied for a ${opts.accountLabel}.`, body);
}

// ── Approval email ─────────────────────────────────────────────────────────────
function approvalEmail(opts: {
  userName: string; accountLabel: string; referenceId: string; accentColor: string; adminNote?: string;
}): string {
  const body = `
<div class="e-pad" style="padding:44px 32px 28px;text-align:center;border-bottom:1px solid rgba(255,255,255,.07);">
  <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 24px;">
    <tr><td align="center" valign="middle" style="width:68px;height:68px;border-radius:50%;background:rgba(74,222,128,.1);border:2px solid rgba(74,222,128,.3);text-align:center;vertical-align:middle;line-height:68px;font-size:36px;font-family:Arial,sans-serif;">
      <span style="color:#4ade80;display:inline-block;line-height:1;vertical-align:middle;">&#10004;</span>
    </td></tr>
  </table>
  <h1 class="e-txt-primary" style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4f8;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Application Approved</h1>
  <p class="e-txt-secondary" style="margin:0 auto;font-size:14px;line-height:1.75;color:rgba(240,244,248,.52);max-width:420px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    Congratulations, <strong class="e-txt-primary" style="color:#f0f4f8;font-weight:700;">${opts.userName}</strong>! Your application for a <strong style="color:${opts.accentColor};">${opts.accountLabel}</strong> has been approved. Welcome to ZenithOne.
  </p>
</div>

<div class="e-pad" style="padding:28px 32px 20px;">
  <div style="background:rgba(255,255,255,.03);border:1px solid rgba(74,222,128,.18);border-radius:16px;padding:22px 24px;text-align:center;">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:rgba(240,244,248,.38);font-weight:700;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Your New Account</p>
    <p style="margin:0 0 8px;font-size:22px;font-weight:700;color:${opts.accentColor};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${opts.accountLabel}</p>
    <span class="e-badge-ok">Approved &amp; Active</span>
  </div>
</div>

<table width="100%" cellpadding="0" cellspacing="0" role="presentation">
  ${detailRow('Reference ID', opts.referenceId.slice(0, 8).toUpperCase())}
  ${detailRow('Status', '<span class="e-badge-ok">Approved</span>')}
  ${opts.adminNote ? detailRow('Note from ZenithOne', opts.adminNote) : ''}
</table>

<div class="e-pad e-box-green" style="margin:24px 32px;padding:20px 22px;background:rgba(74,222,128,.05);border:1px solid rgba(74,222,128,.18);border-radius:14px;">
  <p class="e-txt-green" style="margin:0 0 8px;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#4ade80;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">What Happens Next</p>
  <p class="e-txt-secondary" style="margin:0;font-size:13px;line-height:1.7;color:rgba(240,244,248,.52);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    Your account is being set up and will appear in your dashboard within 1 business day. You'll receive your account details, debit card (if applicable), and welcome kit shortly. If you have any questions, our team is here to help.
  </p>
</div>

<div style="padding:12px 32px 40px;text-align:center;">
  <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;">
    <tr><td align="center" style="border-radius:12px;background:linear-gradient(135deg,#c9a84c,#e8d07a);">
      <a href="${ADMIN_SITE}/accounts.html" class="e-btn" style="display:inline-block;padding:16px 52px;font-size:13px;font-weight:800;color:#04090f;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">View My Accounts</a>
    </td></tr>
  </table>
</div>`;
  return emailShell(`Application Approved — ZenithOne`, `Your ${opts.accountLabel} application has been approved.`, body);
}

// ── Decline email ─────────────────────────────────────────────────────────────
function declineEmail(opts: {
  userName: string; accountLabel: string; referenceId: string; reason?: string;
}): string {
  const body = `
<div class="e-pad" style="padding:44px 32px 28px;text-align:center;border-bottom:1px solid rgba(255,255,255,.07);">
  <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 24px;">
    <tr><td align="center" valign="middle" style="width:68px;height:68px;border-radius:50%;background:rgba(248,113,113,.08);border:2px solid rgba(248,113,113,.26);text-align:center;vertical-align:middle;line-height:68px;font-size:36px;font-family:Arial,sans-serif;">
      <span style="color:#f87171;display:inline-block;line-height:1;vertical-align:middle;">&#10008;</span>
    </td></tr>
  </table>
  <h1 class="e-txt-primary" style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4f8;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Application Not Approved</h1>
  <p class="e-txt-secondary" style="margin:0 auto;font-size:14px;line-height:1.75;color:rgba(240,244,248,.52);max-width:420px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    Hello <strong class="e-txt-primary" style="color:#f0f4f8;font-weight:700;">${opts.userName}</strong>, after careful review, we were unable to approve your application for a <strong style="color:rgba(240,244,248,.7);">${opts.accountLabel}</strong> at this time.
  </p>
</div>

<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:8px;">
  ${detailRow('Reference ID', opts.referenceId.slice(0, 8).toUpperCase())}
  ${detailRow('Status', '<span class="e-badge-err">Not Approved</span>')}
  ${opts.reason ? detailRow('Reason', opts.reason) : ''}
</table>

<div class="e-pad e-box-blue" style="margin:24px 32px;padding:20px 22px;background:rgba(96,165,250,.05);border:1px solid rgba(96,165,250,.18);border-radius:14px;">
  <p style="margin:0 0 8px;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#60a5fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Your Options</p>
  <p class="e-txt-secondary" style="margin:0;font-size:13px;line-height:1.7;color:rgba(240,244,248,.52);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    You may reapply after 30 days or contact our member services team to discuss your options. We offer a range of accounts that may better fit your current financial profile.
  </p>
</div>

<div style="padding:12px 32px 40px;text-align:center;">
  <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;">
    <tr><td align="center" style="border-radius:12px;background:linear-gradient(135deg,#c9a84c,#e8d07a);">
      <a href="${ADMIN_SITE}/contact.html" class="e-btn" style="display:inline-block;padding:16px 52px;font-size:13px;font-weight:800;color:#04090f;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Contact Us</a>
    </td></tr>
  </table>
</div>`;
  return emailShell('Application Update — ZenithOne', `Regarding your ${opts.accountLabel} application.`, body);
}

// ── Under review email ────────────────────────────────────────────────────────
function underReviewEmail(opts: {
  userName: string; accountLabel: string; referenceId: string; adminNote?: string;
}): string {
  const body = `
<div class="e-pad" style="padding:44px 32px 28px;text-align:center;border-bottom:1px solid rgba(255,255,255,.07);">
  <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 24px;">
    <tr><td align="center" valign="middle" style="width:68px;height:68px;border-radius:50%;background:rgba(96,165,250,.1);border:2px solid rgba(96,165,250,.3);text-align:center;vertical-align:middle;line-height:68px;font-size:34px;font-family:Arial,sans-serif;">
      <span style="color:#60a5fa;display:inline-block;line-height:1;vertical-align:middle;">&#8987;</span>
    </td></tr>
  </table>
  <h1 class="e-txt-primary" style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4f8;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Application Under Review</h1>
  <p class="e-txt-secondary" style="margin:0 auto;font-size:14px;line-height:1.75;color:rgba(240,244,248,.52);max-width:420px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
    Hello <strong class="e-txt-primary" style="color:#f0f4f8;font-weight:700;">${opts.userName}</strong>, your <strong style="color:#60a5fa;">${opts.accountLabel}</strong> application requires additional review. We'll notify you as soon as a decision is made.
  </p>
</div>
<table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:8px;">
  ${detailRow('Reference ID', opts.referenceId.slice(0, 8).toUpperCase())}
  ${detailRow('Status', '<span class="e-badge-review">Under Review</span>')}
  ${opts.adminNote ? detailRow('Note', opts.adminNote) : ''}
</table>
<div style="padding:36px 32px;text-align:center;">
  <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;">
    <tr><td align="center" style="border-radius:12px;background:linear-gradient(135deg,#c9a84c,#e8d07a);">
      <a href="${ADMIN_SITE}/accounts.html" class="e-btn" style="display:inline-block;padding:16px 52px;font-size:13px;font-weight:800;color:#04090f;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">View Applications</a>
    </td></tr>
  </table>
</div>`;
  return emailShell('Application Under Review — ZenithOne', `Your ${opts.accountLabel} application requires additional review.`, body);
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ═════════════════════════════════════════════════════════════════════════════
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return cors();
  try {
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const token = getAuthToken(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return errJson('Unauthorized', 401);

    const body = await req.json() as Record<string, unknown>;
    const action = (body.action as string) || 'apply';

    // ── APPLY ────────────────────────────────────────────────────────────────
    if (action === 'apply') {
      const accountType = (body.account_type as string) || '';
      const meta = ACCOUNT_META[accountType];
      if (!meta) throw new Error(`Unknown account type: ${accountType}`);

      const record: Record<string, unknown> = {
        user_id:            user.id,
        account_type:       accountType,
        account_type_label: meta.label,
        status:             'pending',
        first_name:         body.first_name,
        last_name:          body.last_name,
        date_of_birth:      body.date_of_birth,
        ssn_last4:          body.ssn_last4,
        phone:              body.phone || null,
        address_line1:      body.address_line1,
        address_line2:      body.address_line2 || null,
        city:               body.city,
        state:              body.state,
        zip_code:           body.zip_code,
        employment_status:  body.employment_status || null,
        employer_name:      body.employer_name || null,
        annual_income:      body.annual_income || null,
        account_purpose:    body.account_purpose || null,
        initial_deposit:    body.initial_deposit || null,
        funding_source:     body.funding_source || null,
        cd_term_months:     body.cd_term_months || null,
        cd_amount:          body.cd_amount || null,
        ira_type:           body.ira_type || null,
        business_name:      body.business_name || null,
        business_type:      body.business_type || null,
        ein:                body.ein || null,
      };

      const { data: inserted, error: insErr } = await supabase
        .from('account_applications').insert(record).select('id,created_at').single();
      if (insErr) throw insErr;

      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
      const userName  = profile?.full_name || `${body.first_name} ${body.last_name}`;
      const userEmail = user.email || '';
      const resendKey = Deno.env.get('RESEND_API_KEY');

      const submittedAt = new Date(inserted.created_at).toLocaleString('en-US', {
        month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      });

      if (resendKey && userEmail) {
        const sends: Promise<Response>[] = [
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: FROM_ADDR, to: [userEmail],
              subject: `${meta.label} Application Received — ZenithOne`,
              html: applicationReceivedEmail({ userName, accountLabel: meta.label, accountType, referenceId: inserted.id, submittedAt, accentColor: meta.color }),
            }),
          }),
        ];

        // Admin emails
        const { data: { users: allUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const { data: adminProfiles } = await supabase.from('profiles').select('id').eq('is_admin', true);
        const adminIds = new Set((adminProfiles || []).map((p: { id: string }) => p.id));
        const adminEmails = (allUsers || []).filter((u: { id: string }) => adminIds.has(u.id)).map((u: { email?: string }) => u.email).filter(Boolean);

        const appDetails: Record<string, string> = {
          'Account Type': meta.label,
          'Applicant Name': `${body.first_name} ${body.last_name}`,
          'Date of Birth': body.date_of_birth as string,
          'Phone': (body.phone as string) || '—',
          'Address': `${body.address_line1}, ${body.city}, ${body.state} ${body.zip_code}`,
          'Employment': (body.employment_status as string) || '—',
          'Annual Income': (body.annual_income as string) || '—',
          'Initial Deposit': body.initial_deposit ? `$${Number(body.initial_deposit).toLocaleString()}` : '—',
        };

        if (adminEmails.length) {
          sends.push(fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: FROM_ADDR, to: adminEmails,
              subject: `[Admin] New ${meta.label} Application — ${userName}`,
              html: adminApplicationEmail({ userName, userEmail, accountLabel: meta.label, referenceId: inserted.id, submittedAt, accentColor: meta.color, details: appDetails }),
            }),
          }));
        }

        const results = await Promise.allSettled(sends);
        for (const r of results) {
          if (r.status === 'fulfilled') {
            const rj = await r.value.json().catch(() => ({}));
            if (!r.value.ok) console.error('[Resend error]', JSON.stringify(rj));
            else console.log('[Resend ok]', rj.id);
          } else console.error('[Resend fetch error]', r.reason);
        }
      }

      await supabase.from('notifications').insert({
        user_id: user.id,
        title:   `${meta.label} Application Submitted`,
        message: `Your application is under review. We'll notify you within 1–3 business days.`,
        type:    'info',
      });

      return json({ success: true, id: inserted.id, status: 'pending' });
    }

    // ── LIST_USER ────────────────────────────────────────────────────────────
    if (action === 'list_user') {
      const { data, error } = await supabase
        .from('account_applications')
        .select('id,account_type,account_type_label,status,first_name,last_name,admin_note,created_at,updated_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json({ applications: data || [] });
    }

    // ── LIST_PENDING (admin) ─────────────────────────────────────────────────
    if (action === 'list_pending') {
      const { data: adminCheck } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
      if (!adminCheck?.is_admin) return errJson('Unauthorized', 403);

      const status = (body.status as string) || 'all';
      let q = supabase.from('account_applications')
        .select('id,user_id,account_type,account_type_label,status,first_name,last_name,date_of_birth,phone,address_line1,city,state,zip_code,employment_status,annual_income,initial_deposit,account_purpose,admin_note,reviewed_at,created_at')
        .order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;

      const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const { data: profiles } = await supabase.from('profiles').select('id,full_name');
      const emailMap: Record<string, string> = {};
      const nameMap:  Record<string, string> = {};
      for (const u of authUsers || []) emailMap[u.id] = u.email || '';
      for (const p of profiles  || []) nameMap[p.id]  = p.full_name || '';

      const enriched = (data || []).map((r: Record<string, unknown>) => ({
        ...r,
        user_email: emailMap[r.user_id as string] || '',
        user_name:  nameMap[r.user_id as string]  || '',
      }));
      return json({ applications: enriched });
    }

    // ── VERIFY (admin) ───────────────────────────────────────────────────────
    if (action === 'verify') {
      const { data: adminCheck } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
      if (!adminCheck?.is_admin) return errJson('Unauthorized', 403);

      const { application_id, decision, admin_note } = body as {
        action: string; application_id: string; decision: 'approved' | 'declined' | 'under_review'; admin_note?: string;
      };
      if (!application_id || !['approved', 'declined', 'under_review'].includes(decision)) {
        throw new Error('application_id and decision are required');
      }

      const { data: app, error: appErr } = await supabase
        .from('account_applications').select('*').eq('id', application_id).single();
      if (appErr || !app) throw new Error('Application not found');

      await supabase.from('account_applications').update({
        status: decision, admin_note: admin_note || null,
        reviewed_by: user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', application_id);

      const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', app.user_id).single();
      const targetUser = authUsers.find((u: { id: string }) => u.id === app.user_id);
      const userEmail  = targetUser?.email || '';
      const userName   = profile?.full_name || `${app.first_name} ${app.last_name}`;
      const meta       = ACCOUNT_META[app.account_type] || { label: app.account_type_label, color: '#c9a84c' };

      const notifTitle = decision === 'approved' ? `${meta.label} Account Approved`
        : decision === 'under_review' ? `${meta.label} Application Under Review`
        : `${meta.label} Application Not Approved`;
      const notifMsg = decision === 'approved'
        ? `Your application for a ${meta.label} has been approved! Your account will be ready within 1 business day.`
        : decision === 'under_review'
        ? `Your ${meta.label} application requires additional review. We'll be in touch soon.`
        : `Your ${meta.label} application was not approved.${admin_note ? ' ' + admin_note : ''}`;

      await supabase.from('notifications').insert({
        user_id: app.user_id, title: notifTitle, message: notifMsg,
        type: decision === 'approved' ? 'success' : decision === 'under_review' ? 'info' : 'warning',
      });

      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (resendKey && userEmail) {
        const emailOpts = { userName, accountLabel: meta.label, referenceId: app.id, accentColor: meta.color, adminNote: admin_note };
        const html = decision === 'approved' ? approvalEmail(emailOpts)
          : decision === 'under_review' ? underReviewEmail(emailOpts)
          : declineEmail({ ...emailOpts, reason: admin_note });
        const subject = decision === 'approved' ? `Your ${meta.label} Application is Approved — ZenithOne`
          : decision === 'under_review' ? `Your ${meta.label} Application Needs Additional Review`
          : `Update on Your ${meta.label} Application — ZenithOne`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from: FROM_ADDR, to: [userEmail], subject, html }),
        });
      }

      return json({ success: true, status: decision });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    return errJson(e);
  }
});

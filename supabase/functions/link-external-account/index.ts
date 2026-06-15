/**
 * ZenithOne Credit Union — Link External Account / Card
 *
 * Actions:
 *   submit       → User submits a bank account or card to link (status: pending)
 *   list_user    → User fetches their own linked accounts
 *   list_pending → Admin lists all pending requests
 *   verify       → Admin approves or declines a request
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { cors, json, errJson, getAuthToken } from '../_shared/cors.ts';

const FROM_ADDR  = Deno.env.get('RESEND_FROM') || 'ZenithOne Credit Union <onboarding@resend.dev>';
const ADMIN_SITE = 'https://zenithonecreditunion.com';

// ── BIN → card network ────────────────────────────────────────────────────────
function detectNetwork(bin: string): string {
  if (!bin) return 'unknown';
  const n = bin.replace(/\D/g, '');
  if (/^4/.test(n))                            return 'visa';
  if (/^5[1-5]/.test(n) || /^2[2-7]/.test(n)) return 'mc';
  if (/^3[47]/.test(n))                        return 'amex';
  if (/^6011|^64[4-9]|^65/.test(n))           return 'discover';
  return 'unknown';
}

// ── Card art config based on BIN (first 4 digits) ────────────────────────────
function cardArtConfig(bin: string, network: string): { gradient: string; label: string; textColor: string } {
  const b = (bin || '').slice(0, 4);
  if (network === 'visa' && /^4(02|14|24|26|38|52)/.test(b))
    return { gradient: 'linear-gradient(135deg,#0c2461,#1a3a6b,#1e4d8c)', label: 'Visa Platinum', textColor: '#e8d07a' };
  if (network === 'visa')
    return { gradient: 'linear-gradient(135deg,#1a1a2e,#16213e,#0f3460)', label: 'Visa', textColor: '#c8d6e5' };
  if (network === 'mc' && /^5[45]/.test(b))
    return { gradient: 'linear-gradient(135deg,#1a0a00,#3b1e00,#7a3b00)', label: 'Mastercard World', textColor: '#f59e0b' };
  if (network === 'mc')
    return { gradient: 'linear-gradient(135deg,#1c1c1c,#3a1a1a,#6b2020)', label: 'Mastercard', textColor: '#fb7185' };
  if (network === 'amex' && /^37/.test(b))
    return { gradient: 'linear-gradient(135deg,#8a8a8a,#c0c0c0,#9a9a9a)', label: 'Amex Platinum', textColor: '#1a1a1a' };
  if (network === 'amex')
    return { gradient: 'linear-gradient(135deg,#7c5f00,#c9a84c,#7c5f00)', label: 'Amex Gold', textColor: '#fff9e6' };
  if (network === 'discover')
    return { gradient: 'linear-gradient(135deg,#1a0a00,#4a2000,#e06500)', label: 'Discover', textColor: '#fff' };
  return { gradient: 'linear-gradient(135deg,#1a2035,#2a3555,#1a2035)', label: 'Card', textColor: '#e2e8f0' };
}

// ═════════════════════════════════════════════════════════════════════════════
//  EMAIL TEMPLATES — Ultra-premium, auto light/dark mode
// ═════════════════════════════════════════════════════════════════════════════

const emailStyles = `
<style>
  /* ── Reset ── */
  body,table,td,p,a,li { margin:0;padding:0; }
  img { border:0;display:block;outline:none; }
  table { border-collapse:collapse; }

  /* ── Wrapper & structure (dark default) ── */
  body,#eBody { background:#04090f !important; }
  #eWrap      { background:#04090f; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; }
  #eHdr       { background:linear-gradient(170deg,#0e2040 0%,#060e1a 100%); }
  #eCard      { background:#0c1a2e; border:1px solid rgba(201,168,76,.18); border-top:none; }

  /* ── Typography ── */
  .e-txt-primary   { color:#f0f4f8 !important; }
  .e-txt-secondary { color:rgba(240,244,248,.52) !important; }
  .e-txt-gold      { color:#c9a84c !important; }
  .e-txt-green     { color:#4ade80 !important; }
  .e-txt-red       { color:#f87171 !important; }
  .e-txt-blue      { color:#60a5fa !important; }

  /* ── Row / divider ── */
  .e-row-bg  { background:rgba(255,255,255,.025) !important; }
  .e-divider { background:rgba(255,255,255,.06) !important; }

  /* ── Status badges ── */
  .e-badge-pending { display:inline-block;background:rgba(251,191,36,.12) !important;color:#fbbf24 !important;border:1px solid rgba(251,191,36,.3) !important;border-radius:99px;padding:4px 14px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase; }
  .e-badge-ok      { display:inline-block;background:rgba(74,222,128,.12) !important;color:#4ade80 !important;border:1px solid rgba(74,222,128,.3)  !important;border-radius:99px;padding:4px 14px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase; }
  .e-badge-err     { display:inline-block;background:rgba(248,113,113,.12) !important;color:#f87171 !important;border:1px solid rgba(248,113,113,.3) !important;border-radius:99px;padding:4px 14px;font-size:10px;font-weight:700;letter-spacing:.12em;text-transform:uppercase; }

  /* ── Button ── */
  .e-btn { display:inline-block;background:linear-gradient(135deg,#c9a84c,#e8d07a) !important;color:#04090f !important;text-decoration:none;border-radius:12px;padding:16px 52px;font-size:13px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif; }

  /* ── Info boxes ── */
  .e-box-gold  { background:rgba(201,168,76,.06) !important;border:1px solid rgba(201,168,76,.16) !important;border-radius:14px; }
  .e-box-green { background:rgba(74,222,128,.05) !important;border:1px solid rgba(74,222,128,.18) !important;border-radius:14px; }
  .e-box-red   { background:rgba(248,113,113,.05) !important;border:1px solid rgba(248,113,113,.18) !important;border-radius:14px; }
  .e-box-blue  { background:rgba(96,165,250,.05) !important;border:1px solid rgba(96,165,250,.18) !important;border-radius:14px; }

  /* ── Footer ── */
  .e-footer   { color:rgba(255,255,255,.22) !important; }
  .e-footer a { color:#c9a84c !important;text-decoration:none; }

  /* ── Light mode ── */
  @media (prefers-color-scheme:light) {
    body,#eBody { background:#edf1f6 !important; }
    #eWrap      { background:#edf1f6 !important; }
    #eHdr       { background:linear-gradient(170deg,#0e2040 0%,#060e1a 100%) !important; }
    #eCard      { background:#ffffff !important;border:1px solid rgba(0,0,0,.09) !important;border-top:none !important;box-shadow:0 12px 56px rgba(0,0,0,.13) !important; }

    .e-txt-primary   { color:#0d1e35 !important; }
    .e-txt-secondary { color:#4e6070 !important; }
    .e-txt-gold      { color:#8f6c1c !important; }
    .e-txt-green     { color:#15803d !important; }
    .e-txt-red       { color:#b91c1c !important; }
    .e-txt-blue      { color:#1d4ed8 !important; }

    .e-row-bg  { background:#f7f9fb !important; }
    .e-divider { background:rgba(0,0,0,.07) !important; }

    .e-badge-pending { background:rgba(146,109,0,.1) !important;color:#7a5900 !important;border:1px solid rgba(146,109,0,.25) !important; }
    .e-badge-ok      { background:rgba(21,128,61,.1)  !important;color:#15803d !important;border:1px solid rgba(21,128,61,.25)  !important; }
    .e-badge-err     { background:rgba(185,28,28,.1)  !important;color:#b91c1c !important;border:1px solid rgba(185,28,28,.25)  !important; }

    .e-btn { background:linear-gradient(135deg,#8f6c1c,#c9a84c) !important;color:#ffffff !important; }

    .e-box-gold  { background:rgba(143,108,28,.07) !important;border:1px solid rgba(143,108,28,.18) !important; }
    .e-box-green { background:rgba(21,128,61,.07)  !important;border:1px solid rgba(21,128,61,.2)   !important; }
    .e-box-red   { background:rgba(185,28,28,.07)  !important;border:1px solid rgba(185,28,28,.2)   !important; }
    .e-box-blue  { background:rgba(29,78,216,.07)  !important;border:1px solid rgba(29,78,216,.2)   !important; }

    .e-footer   { color:#94a3b8 !important; }
    .e-footer a { color:#8f6c1c !important; }
  }

  /* ── Responsive ── */
  @media only screen and (max-width:640px) {
    #eWrap  { padding:0 !important; }
    #eCard  { border-radius:0 !important;border-left:none !important;border-right:none !important; }
    #eHdr   { border-radius:0 !important; }
    .e-pad  { padding-left:20px !important;padding-right:20px !important; }
    .e-btn  { padding:14px 36px !important; }
    .e-cvis { margin:20px 16px !important; }
  }
</style>`;

// ── Shell wrapper ─────────────────────────────────────────────────────────────
function emailShell(title: string, preheader: string, bodyContent: string): string {
  const yr = new Date().getFullYear();
  return `<!DOCTYPE html>
<html lang="en" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="UTF-8"/>
  <meta http-equiv="X-UA-Compatible" content="IE=edge"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <meta name="color-scheme" content="light dark"/>
  <meta name="supported-color-schemes" content="light dark"/>
  <title>${title}</title>
  ${emailStyles}
</head>
<body id="eBody" style="margin:0;padding:0;background:#04090f;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">

  <!-- Hidden preheader -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;color:#04090f;line-height:1px;">${preheader}&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;&#8203;</div>

  <div id="eWrap" style="padding:48px 20px 44px;background:#04090f;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="max-width:600px;margin:0 auto;">
  <tr><td>

    <!-- ══ HEADER ══ -->
    <table id="eHdr" width="100%" cellpadding="0" cellspacing="0" role="presentation"
      style="background:linear-gradient(170deg,#0e2040 0%,#060e1a 100%);border-radius:22px 22px 0 0;overflow:hidden;">
      <!-- Gold shimmer top line -->
      <tr>
        <td height="3" style="height:3px;background:linear-gradient(90deg,transparent 0%,#c9a84c 30%,#e8d07a 50%,#c9a84c 70%,transparent 100%);font-size:0;line-height:0;">&nbsp;</td>
      </tr>
      <!-- Brand centre -->
      <tr>
        <td align="center" style="padding:44px 24px 40px;">
          <!-- ZO monogram -->
          <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;">
            <tr>
              <td align="center" valign="middle"
                style="width:68px;height:68px;min-width:68px;border-radius:18px;
                       background:linear-gradient(135deg,#c9a84c 0%,#e8d07a 52%,#c9a84c 100%);
                       text-align:center;vertical-align:middle;
                       box-shadow:0 8px 32px rgba(201,168,76,.35);">
                <span style="display:block;font-size:28px;font-weight:900;color:#04090f;
                             letter-spacing:-.04em;line-height:68px;
                             font-family:Georgia,'Times New Roman',serif;">ZO</span>
              </td>
            </tr>
          </table>
          <!-- Brand name -->
          <p style="margin:20px 0 0;font-size:13px;font-weight:800;letter-spacing:.32em;
                    text-transform:uppercase;color:#c9a84c;
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">ZENITHONE</p>
          <p style="margin:6px 0 0;font-size:9px;font-weight:600;letter-spacing:.26em;
                    text-transform:uppercase;color:rgba(201,168,76,.45);
                    font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">CREDIT UNION</p>
        </td>
      </tr>
      <!-- Bottom gold line -->
      <tr>
        <td height="1" style="height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.28) 30%,rgba(201,168,76,.28) 70%,transparent);font-size:0;line-height:0;">&nbsp;</td>
      </tr>
    </table>

    <!-- ══ BODY CARD ══ -->
    <div id="eCard" style="background:#0c1a2e;border:1px solid rgba(201,168,76,.18);border-top:none;border-radius:0 0 22px 22px;overflow:hidden;">
      ${bodyContent}
    </div>

    <!-- ══ FOOTER ══ -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:36px;">
      <tr>
        <td align="center" style="padding:0 20px;">
          <p class="e-footer" style="margin:0;font-size:11px;line-height:1.95;color:rgba(255,255,255,.22);text-align:center;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
            &copy; ${yr} ZenithOne Credit Union &mdash; All rights reserved.<br/>
            This is a secure, automated notification. Please do not reply directly.<br/>
            <a href="${ADMIN_SITE}/contact.html" style="color:#c9a84c;text-decoration:none;">Contact Support</a>
            &nbsp;&nbsp;&bull;&nbsp;&nbsp;
            <a href="${ADMIN_SITE}" style="color:rgba(255,255,255,.28);text-decoration:none;">zenithonecreditunion.com</a>
          </p>
        </td>
      </tr>
    </table>

  </td></tr>
  </table>
  </div>
</body>
</html>`;
}

// ── Detail row helper ─────────────────────────────────────────────────────────
function detailRow(label: string, value: string): string {
  return `
<tr>
  <td class="e-row-bg" style="padding:14px 32px;background:rgba(255,255,255,.025);">
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      <tr>
        <td class="e-txt-secondary" style="font-size:11px;letter-spacing:.09em;text-transform:uppercase;font-weight:700;width:44%;padding-right:16px;vertical-align:middle;color:rgba(240,244,248,.5);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${label}</td>
        <td class="e-txt-primary" style="font-size:13px;font-weight:600;text-align:right;vertical-align:middle;color:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${value}</td>
      </tr>
    </table>
  </td>
</tr>
<tr>
  <td class="e-divider" style="height:1px;background:rgba(255,255,255,.06);font-size:0;line-height:0;">&nbsp;</td>
</tr>`;
}

// ── Card visual (inline in email) ────────────────────────────────────────────
function cardVisualHtml(art: { gradient: string; label: string; textColor: string }, last4: string, expiry: string, networkLabel: string, ribbonText: string, ribbonBg: string, ribbonTextColor: string): string {
  return `
<div class="e-cvis" style="margin:28px 28px 0;border-radius:18px;overflow:hidden;position:relative;height:196px;background:${art.gradient};box-shadow:0 24px 64px rgba(0,0,0,.55),0 4px 18px rgba(0,0,0,.3);">
  <!-- Shimmer -->
  <div style="position:absolute;inset:0;background:linear-gradient(135deg,rgba(255,255,255,0) 0%,rgba(255,255,255,.07) 45%,rgba(255,255,255,0) 65%);pointer-events:none;"></div>
  <!-- Grid texture -->
  <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.03) 1px,transparent 1px);background-size:28px 28px;"></div>
  <!-- EMV Chip -->
  <table cellpadding="0" cellspacing="0" role="presentation" style="position:absolute;top:32px;left:28px;">
    <tr>
      <td align="center" valign="middle" style="width:40px;height:30px;border-radius:6px;background:linear-gradient(135deg,#c8a84b,#e8d07a,#c8a84b);box-shadow:0 2px 8px rgba(0,0,0,.3);">
        <div style="width:28px;height:20px;border:1px solid rgba(0,0,0,.2);border-radius:3px;margin:0 auto;"></div>
      </td>
    </tr>
  </table>
  <!-- Network -->
  <div style="position:absolute;top:28px;right:24px;">
    <div style="font-size:19px;font-weight:900;letter-spacing:.04em;color:${art.textColor};opacity:.92;">${networkLabel.toUpperCase()}</div>
  </div>
  <!-- Card number -->
  <div style="position:absolute;bottom:60px;left:28px;font-family:'Courier New',Courier,monospace;font-size:17px;letter-spacing:.24em;color:${art.textColor};font-weight:600;text-shadow:0 1px 5px rgba(0,0,0,.5);">
    &#x2022;&#x2022;&#x2022;&#x2022;&nbsp;&nbsp;&#x2022;&#x2022;&#x2022;&#x2022;&nbsp;&nbsp;&#x2022;&#x2022;&#x2022;&#x2022;&nbsp;&nbsp;${last4}
  </div>
  <!-- Bottom row -->
  <div style="position:absolute;bottom:20px;left:28px;">
    <div style="font-size:8px;color:${art.textColor};opacity:.5;letter-spacing:.14em;text-transform:uppercase;margin-bottom:3px;">EXPIRES</div>
    <div style="font-size:14px;font-weight:700;color:${art.textColor};letter-spacing:.1em;">${expiry}</div>
  </div>
  <div style="position:absolute;bottom:20px;right:24px;">
    <div style="font-size:10px;font-weight:700;color:${art.textColor};opacity:.65;letter-spacing:.1em;text-transform:uppercase;">${art.label}</div>
  </div>
  <!-- Status ribbon -->
  <div style="position:absolute;top:0;right:0;background:${ribbonBg};padding:5px 16px;border-bottom-left-radius:12px;font-size:9px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;color:${ribbonTextColor};">
    ${ribbonText}
  </div>
</div>`;
}

// ── Submission confirmation (to user) ─────────────────────────────────────────
function submissionEmail(opts: {
  userName: string; type: 'bank' | 'card';
  bankName?: string; accountLast4?: string; accountType?: string; nickname?: string;
  cardNetwork?: string; cardLast4?: string; cardExpiry?: string; cardBin?: string;
}): string {
  const isCard = opts.type === 'card';
  const art = isCard ? cardArtConfig(opts.cardBin || '', opts.cardNetwork || 'unknown') : null;
  const networkLabel = opts.cardNetwork === 'visa' ? 'Visa' : opts.cardNetwork === 'mc' ? 'Mastercard'
    : opts.cardNetwork === 'amex' ? 'American Express' : opts.cardNetwork === 'discover' ? 'Discover' : 'Card';

  const visual = isCard ? cardVisualHtml(art!, opts.cardLast4 || '••••', opts.cardExpiry || '••/••', networkLabel, 'PENDING REVIEW', 'rgba(251,191,36,.92)', '#1a1000') : '';

  const details = isCard
    ? [
        ['Account Type', 'Debit / Credit Card'],
        ['Network', networkLabel],
        ['Card Number', `&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; ${opts.cardLast4}`],
        ['Expiry', opts.cardExpiry || '&mdash;'],
        ['Status', '<span class="e-badge-pending">Pending Verification</span>'],
      ]
    : [
        ['Account Type', `${(opts.accountType||'checking').charAt(0).toUpperCase()+(opts.accountType||'checking').slice(1)} Account`],
        ['Institution', opts.bankName || '&mdash;'],
        ['Account Number', `&bull;&bull;&bull;&bull;&bull;&bull;&bull;${opts.accountLast4 || '&bull;&bull;'}`],
        ['Nickname', opts.nickname || '&mdash;'],
        ['Status', '<span class="e-badge-pending">Pending Verification</span>'],
      ];

  const steps = [
    ['Request Submitted', 'Your request is logged and queued for our compliance team.', true],
    [isCard ? 'Identity & Card Verification' : 'Micro-deposit Verification',
     isCard ? 'Our team will verify card ownership and identity.' : 'Two small micro-deposits will appear in your external account within 1&ndash;2 business days.', false],
    ['Approval Notification', `You&rsquo;ll receive an email once ${isCard ? 'your card is verified' : 'verification is complete'}.`, false],
  ];

  const body = `
    <!-- ── Hero ── -->
    <div class="e-pad" style="padding:44px 32px 32px;text-align:center;">
      <!-- Icon box (table-centered, no flex) -->
      <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 24px;">
        <tr>
          <td align="center" valign="middle"
            style="width:68px;height:68px;border-radius:18px;
                   background:rgba(201,168,76,.1);border:1.5px solid rgba(201,168,76,.24);
                   text-align:center;vertical-align:middle;">
            <span style="font-size:34px;color:#c9a84c;display:inline-block;line-height:1;vertical-align:middle;font-family:Arial,sans-serif;">&#9733;</span>
          </td>
        </tr>
      </table>
      <h1 class="e-txt-primary" style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4f8;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Request Received</h1>
      <p class="e-txt-secondary" style="margin:0;font-size:14px;line-height:1.75;color:rgba(240,244,248,.52);max-width:400px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        Hello <strong class="e-txt-primary" style="color:#f0f4f8;font-weight:700;">${opts.userName}</strong>, your ${isCard ? 'card' : 'bank account'} linking request has been received and is now under review by our compliance team.
      </p>
    </div>

    <!-- Divider -->
    <div style="height:1px;background:rgba(255,255,255,.07);margin:0 32px;"></div>

    ${visual}

    <!-- ── Details table ── -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:${isCard ? '20px' : '8px'};">
      ${details.map(([l, v]) => detailRow(l, v)).join('')}
    </table>

    <!-- ── Timeline ── -->
    <div class="e-pad" style="padding:32px 32px 24px;">
      <p class="e-txt-secondary" style="margin:0 0 22px;font-size:10px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;color:rgba(240,244,248,.4);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">What Happens Next</p>
      <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
        ${steps.map(([step, desc, done], i) => `
        <tr>
          <td width="40" valign="top" style="padding-bottom:${i < steps.length - 1 ? '0' : '0'};">
            <table cellpadding="0" cellspacing="0" role="presentation">
              <tr>
                <td align="center" valign="middle"
                  style="width:30px;height:30px;border-radius:50%;
                         ${done ? 'background:rgba(201,168,76,.14);border:2px solid #c9a84c;' : 'background:rgba(255,255,255,.06);border:2px solid rgba(255,255,255,.15);'}
                         text-align:center;vertical-align:middle;">
                  ${done
                    ? `<span style="font-size:13px;font-weight:900;color:#c9a84c;line-height:30px;display:inline-block;font-family:Arial,sans-serif;">&#10003;</span>`
                    : `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:rgba(255,255,255,.25);vertical-align:middle;"></span>`}
                </td>
              </tr>
              ${i < steps.length - 1 ? `<tr><td align="center" style="padding:2px 0;"><div style="width:2px;height:36px;background:rgba(255,255,255,.09);margin:0 auto;"></div></td></tr>` : ''}
            </table>
          </td>
          <td style="padding-left:14px;padding-bottom:${i < steps.length - 1 ? '28px' : '0'};vertical-align:top;">
            <p class="e-txt-primary" style="margin:0 0 4px;font-size:13px;font-weight:700;color:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${step}</p>
            <p class="e-txt-secondary" style="margin:0;font-size:12px;line-height:1.68;color:rgba(240,244,248,.5);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${desc}</p>
          </td>
        </tr>`).join('')}
      </table>
    </div>

    <!-- Divider -->
    <div style="height:1px;background:rgba(255,255,255,.07);margin:0 32px;"></div>

    <!-- ── CTA ── -->
    <div style="padding:36px 32px;text-align:center;">
      <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;">
        <tr>
          <td align="center" style="border-radius:12px;background:linear-gradient(135deg,#c9a84c,#e8d07a);">
            <a href="${ADMIN_SITE}/dashboard.html" class="e-btn" style="display:inline-block;padding:16px 52px;font-size:13px;font-weight:800;color:#04090f;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">View My Account</a>
          </td>
        </tr>
      </table>
    </div>`;

  return emailShell('Account Linking Request Received — ZenithOne', `Your ${isCard ? 'card' : 'bank account'} linking request is under review.`, body);
}

// ── Admin notification email ──────────────────────────────────────────────────
function adminNotificationEmail(opts: {
  userName: string; userEmail: string; type: 'bank' | 'card';
  bankName?: string; accountLast4?: string; accountType?: string;
  cardNetwork?: string; cardLast4?: string; cardExpiry?: string; cardBin?: string;
  submittedAt: string; requestId: string;
}): string {
  const isCard = opts.type === 'card';
  const networkLabel = opts.cardNetwork === 'visa' ? 'Visa' : opts.cardNetwork === 'mc' ? 'Mastercard'
    : opts.cardNetwork === 'amex' ? 'American Express' : opts.cardNetwork === 'discover' ? 'Discover' : 'Unknown';

  const details = isCard
    ? [
        ['Request Type', 'Card Linking'],
        ['Network', networkLabel],
        ['Card Last 4', `&bull;&bull;&bull;&bull; ${opts.cardLast4}`],
        ['Expiry', opts.cardExpiry || '&mdash;'],
      ]
    : [
        ['Request Type', 'Bank Account Linking'],
        ['Institution', opts.bankName || '&mdash;'],
        ['Account Type', opts.accountType || '&mdash;'],
        ['Account Last 4', `&bull;&bull;&bull;&bull;&bull;&bull;&bull;${opts.accountLast4}`],
      ];

  const body = `
    <!-- ── Alert banner ── -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
      style="background:rgba(201,168,76,.08);border-bottom:1px solid rgba(201,168,76,.18);">
      <tr>
        <td style="padding:16px 32px;">
          <table cellpadding="0" cellspacing="0" role="presentation">
            <tr>
              <td valign="middle" style="padding-right:10px;">
                <span style="font-size:15px;color:#c9a84c;display:inline-block;vertical-align:middle;font-weight:700;font-family:Arial,sans-serif;">&#9432;</span>
              </td>
              <td valign="middle">
                <span class="e-txt-gold" style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#c9a84c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Action Required &mdash; New Linking Request</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <!-- ── Title ── -->
    <div class="e-pad" style="padding:32px 32px 24px;">
      <h2 class="e-txt-primary" style="margin:0 0 8px;font-size:22px;font-weight:700;color:#f0f4f8;line-height:1.25;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">New ${isCard ? 'Card' : 'Bank Account'} Linking Request</h2>
      <p class="e-txt-secondary" style="margin:0;font-size:13px;line-height:1.7;color:rgba(240,244,248,.52);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">A ZenithOne member has submitted a ${isCard ? 'card' : 'bank account'} for linking. Please review and take action from the Admin Dashboard.</p>
    </div>

    <!-- ── Member info box ── -->
    <div class="e-pad e-box-gold" style="margin:0 32px 24px;padding:20px 22px;background:rgba(201,168,76,.06);border:1px solid rgba(201,168,76,.16);border-radius:14px;">
      <p class="e-txt-secondary" style="margin:0 0 10px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:rgba(240,244,248,.4);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Member</p>
      <p class="e-txt-primary" style="margin:0 0 5px;font-size:16px;font-weight:700;color:#f0f4f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${opts.userName}</p>
      <p class="e-txt-secondary" style="margin:0;font-size:13px;color:rgba(240,244,248,.52);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${opts.userEmail}</p>
    </div>

    <!-- ── Details table ── -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation">
      ${[...details,
         ['Submitted', opts.submittedAt],
         ['Request ID', opts.requestId.slice(0, 8).toUpperCase()],
        ].map(([l, v]) => detailRow(l, v)).join('')}
    </table>

    <!-- ── CTA ── -->
    <div style="padding:36px 32px;text-align:center;">
      <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;">
        <tr>
          <td align="center" style="border-radius:12px;background:linear-gradient(135deg,#c9a84c,#e8d07a);">
            <a href="${ADMIN_SITE}/dashboard.html" class="e-btn" style="display:inline-block;padding:16px 52px;font-size:13px;font-weight:800;color:#04090f;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Review in Admin Dashboard</a>
          </td>
        </tr>
      </table>
    </div>`;

  return emailShell('New Linking Request — ZenithOne Admin', `${opts.userName} submitted a ${isCard ? 'card' : 'bank account'} for linking.`, body);
}

// ── Approval email (to user) ──────────────────────────────────────────────────
function approvalEmail(opts: {
  userName: string; type: 'bank' | 'card';
  bankName?: string; accountLast4?: string; accountType?: string; nickname?: string;
  cardNetwork?: string; cardLast4?: string; cardExpiry?: string; cardBin?: string;
}): string {
  const isCard = opts.type === 'card';
  const art = isCard ? cardArtConfig(opts.cardBin || '', opts.cardNetwork || 'unknown') : null;
  const networkLabel = opts.cardNetwork === 'visa' ? 'Visa' : opts.cardNetwork === 'mc' ? 'Mastercard'
    : opts.cardNetwork === 'amex' ? 'American Express' : opts.cardNetwork === 'discover' ? 'Discover' : 'Card';

  const visual = isCard ? cardVisualHtml(art!, opts.cardLast4 || '••••', opts.cardExpiry || '••/••', networkLabel, 'VERIFIED', 'rgba(74,222,128,.88)', '#001a00') : '';

  const details = isCard
    ? [['Network', networkLabel], ['Card', `&bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; &bull;&bull;&bull;&bull; ${opts.cardLast4}`], ['Status', '<span class="e-badge-ok">Verified &amp; Active</span>']]
    : [['Institution', opts.bankName || '&mdash;'], ['Account Type', opts.accountType || '&mdash;'], ['Account', `&bull;&bull;&bull;&bull;&bull;&bull;&bull;${opts.accountLast4}`], ['Nickname', opts.nickname || '&mdash;'], ['Status', '<span class="e-badge-ok">Linked &amp; Active</span>']];

  const body = `
    <!-- ── Hero ── -->
    <div class="e-pad" style="padding:44px 32px 28px;text-align:center;border-bottom:1px solid rgba(255,255,255,.07);">
      <!-- Check icon -->
      <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 24px;">
        <tr>
          <td align="center" valign="middle"
            style="width:68px;height:68px;border-radius:50%;
                   background:rgba(74,222,128,.1);border:2px solid rgba(74,222,128,.3);
                   text-align:center;vertical-align:middle;">
            <span style="font-size:36px;font-weight:900;color:#4ade80;display:inline-block;line-height:1;vertical-align:middle;font-family:Arial,sans-serif;">&#10004;</span>
          </td>
        </tr>
      </table>
      <h1 class="e-txt-primary" style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4f8;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">${isCard ? 'Card Verified' : 'Account Linked'}</h1>
      <p class="e-txt-secondary" style="margin:0 auto;font-size:14px;line-height:1.75;color:rgba(240,244,248,.52);max-width:420px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        Hello <strong class="e-txt-primary" style="color:#f0f4f8;font-weight:700;">${opts.userName}</strong> &mdash; your ${isCard ? 'card has been verified' : 'bank account has been successfully linked'} and is now ready to use on ZenithOne.
      </p>
    </div>

    ${visual}

    <!-- ── Details ── -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:${isCard ? '20px' : '8px'};">
      ${details.map(([l, v]) => detailRow(l, v)).join('')}
    </table>

    <!-- ── What you can do ── -->
    <div class="e-pad e-box-green" style="margin:24px 32px;padding:20px 22px;background:rgba(74,222,128,.05);border:1px solid rgba(74,222,128,.18);border-radius:14px;">
      <p class="e-txt-green" style="margin:0 0 8px;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#4ade80;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">What You Can Do Now</p>
      <p class="e-txt-secondary" style="margin:0;font-size:13px;line-height:1.7;color:rgba(240,244,248,.52);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        ${isCard ? 'Your card is now verified and ready as a funding source on ZenithOne. Manage it from your accounts page.' : 'Your external account is linked and ready. You can initiate ACH transfers to and from this account on the Transfer page.'}
      </p>
    </div>

    <!-- ── CTA ── -->
    <div style="padding:12px 32px 40px;text-align:center;">
      <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;">
        <tr>
          <td align="center" style="border-radius:12px;background:linear-gradient(135deg,#c9a84c,#e8d07a);">
            <a href="${ADMIN_SITE}/dashboard.html" class="e-btn" style="display:inline-block;padding:16px 52px;font-size:13px;font-weight:800;color:#04090f;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Go to Dashboard</a>
          </td>
        </tr>
      </table>
    </div>`;

  return emailShell(`${isCard ? 'Card Verified' : 'Bank Account Linked'} — ZenithOne`, `Your ${isCard ? 'card' : 'bank account'} has been approved and is now active.`, body);
}

// ── Decline email (to user) ───────────────────────────────────────────────────
function declineEmail(opts: {
  userName: string; type: 'bank' | 'card'; reason?: string;
  bankName?: string; cardLast4?: string; cardNetwork?: string;
}): string {
  const isCard = opts.type === 'card';
  const networkLabel = opts.cardNetwork === 'visa' ? 'Visa' : opts.cardNetwork === 'mc' ? 'Mastercard'
    : opts.cardNetwork === 'amex' ? 'American Express' : opts.cardNetwork === 'discover' ? 'Discover' : 'Card';

  const body = `
    <!-- ── Hero ── -->
    <div class="e-pad" style="padding:44px 32px 28px;text-align:center;border-bottom:1px solid rgba(255,255,255,.07);">
      <!-- X icon -->
      <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto 24px;">
        <tr>
          <td align="center" valign="middle"
            style="width:68px;height:68px;border-radius:50%;
                   background:rgba(248,113,113,.08);border:2px solid rgba(248,113,113,.26);
                   text-align:center;vertical-align:middle;">
            <span style="font-size:36px;font-weight:900;color:#f87171;display:inline-block;line-height:1;vertical-align:middle;font-family:Arial,sans-serif;">&#10008;</span>
          </td>
        </tr>
      </table>
      <h1 class="e-txt-primary" style="margin:0 0 12px;font-size:28px;font-weight:700;color:#f0f4f8;line-height:1.2;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Request Not Approved</h1>
      <p class="e-txt-secondary" style="margin:0 auto;font-size:14px;line-height:1.75;color:rgba(240,244,248,.52);max-width:420px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        Hello <strong class="e-txt-primary" style="color:#f0f4f8;font-weight:700;">${opts.userName}</strong>, unfortunately your ${isCard ? 'card' : 'bank account'} linking request could not be approved at this time.
      </p>
    </div>

    <!-- ── Details ── -->
    <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="margin-top:8px;">
      ${detailRow('Request Type', isCard ? `${networkLabel} Card &bull;&bull;&bull;&bull; ${opts.cardLast4 || ''}` : `Bank Account &mdash; ${opts.bankName || '&mdash;'}`)}
      ${detailRow('Status', '<span class="e-badge-err">Not Approved</span>')}
      ${opts.reason ? detailRow('Reason', opts.reason) : ''}
    </table>

    <!-- ── Help box ── -->
    <div class="e-pad e-box-blue" style="margin:24px 32px;padding:20px 22px;background:rgba(96,165,250,.05);border:1px solid rgba(96,165,250,.18);border-radius:14px;">
      <p class="e-txt-blue" style="margin:0 0 8px;font-size:10px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:#60a5fa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Need Help?</p>
      <p class="e-txt-secondary" style="margin:0;font-size:13px;line-height:1.7;color:rgba(240,244,248,.52);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
        If you believe this is an error or would like to try again with different information, please contact our support team or re-submit with corrected details.
      </p>
    </div>

    <!-- ── CTA ── -->
    <div style="padding:12px 32px 40px;text-align:center;">
      <table cellpadding="0" cellspacing="0" role="presentation" align="center" style="margin:0 auto;">
        <tr>
          <td align="center" style="border-radius:12px;background:linear-gradient(135deg,#c9a84c,#e8d07a);">
            <a href="${ADMIN_SITE}/contact.html" class="e-btn" style="display:inline-block;padding:16px 52px;font-size:13px;font-weight:800;color:#04090f;text-decoration:none;letter-spacing:.08em;text-transform:uppercase;border-radius:12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">Contact Support</a>
          </td>
        </tr>
      </table>
    </div>`;

  return emailShell('Account Linking Update — ZenithOne', `Your ${isCard ? 'card' : 'bank account'} linking request has been reviewed.`, body);
}

// ═════════════════════════════════════════════════════════════════════════════
//  MAIN HANDLER
// ═════════════════════════════════════════════════════════════════════════════
Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return cors();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const token = getAuthToken(req);
    const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
    if (authErr || !user) return errJson('Unauthorized', 401);

    const body = await req.json() as Record<string, unknown>;
    const action = (body.action as string) || 'submit';

    // ── SUBMIT — user submits bank or card ───────────────────────────────────
    if (action === 'submit') {
      const type = body.type as 'bank' | 'card';
      if (!['bank', 'card'].includes(type)) throw new Error('type must be bank or card');

      // Build insert payload
      const record: Record<string, unknown> = { user_id: user.id, type, status: 'pending' };

      if (type === 'bank') {
        record.bank_name            = body.bank_name as string;
        record.routing_number       = (body.routing_number as string).replace(/\D/g, '');
        record.account_number_last4 = (body.account_number as string).slice(-4);
        record.account_type         = body.account_type as string;
        record.nickname             = body.nickname as string || null;
      } else {
        const rawCard = (body.card_number as string).replace(/\D/g, '');
        const bin4    = rawCard.slice(0, 4);
        const net     = detectNetwork(rawCard.slice(0, 6));
        record.card_last4      = rawCard.slice(-4);
        record.card_network    = net;
        record.card_bin        = bin4;
        record.card_expiry_mo  = body.card_exp_mo as string;
        record.card_expiry_yr  = body.card_exp_yr as string;
        record.card_name       = body.card_name as string;
      }

      const { data: inserted, error: insErr } = await supabase
        .from('linked_accounts').insert(record).select('id,created_at').single();
      if (insErr) throw insErr;

      // Get user profile & email
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', user.id).single();
      const userName = profile?.full_name || 'Member';
      const userEmail = user.email || '';

      const resendKey = Deno.env.get('RESEND_API_KEY');

      if (resendKey && userEmail) {
        const expiry = type === 'card'
          ? `${record.card_expiry_mo}/${(record.card_expiry_yr as string).slice(-2)}`
          : undefined;

        const emailOpts = {
          type,
          userName,
          bankName:       record.bank_name as string,
          accountLast4:   record.account_number_last4 as string,
          accountType:    record.account_type as string,
          nickname:       record.nickname as string,
          cardNetwork:    record.card_network as string,
          cardLast4:      record.card_last4 as string,
          cardExpiry:     expiry,
          cardBin:        record.card_bin as string,
        };

        // ── Email to user ──
        const userSubject = type === 'bank'
          ? `Bank Account Linking Request Received — ZenithOne`
          : `Card Linking Request Received — ZenithOne`;

        const submittedAt = new Date(inserted.created_at).toLocaleString('en-US', {
          month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
        });

        const sends: Promise<Response>[] = [
          fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: FROM_ADDR, to: [userEmail], subject: userSubject, html: submissionEmail(emailOpts) }),
          }),
        ];

        // ── Email to all admins ──
        const { data: { users: allUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
        const { data: adminProfiles } = await supabase.from('profiles').select('id').eq('is_admin', true);
        const adminIds = new Set((adminProfiles || []).map((p: { id: string }) => p.id));
        const adminEmails = (allUsers || []).filter((u: { id: string }) => adminIds.has(u.id)).map((u: { email?: string }) => u.email).filter(Boolean);

        if (adminEmails.length) {
          sends.push(fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({
              from: FROM_ADDR, to: adminEmails,
              subject: `[Admin] New ${type === 'bank' ? 'Bank Account' : 'Card'} Linking Request — ${userName}`,
              html: adminNotificationEmail({ ...emailOpts, userEmail, submittedAt, requestId: inserted.id }),
            }),
          }));
        }

        const emailResults = await Promise.allSettled(sends);
        for (const r of emailResults) {
          if (r.status === 'fulfilled') {
            const rj = await r.value.json().catch(() => ({}));
            if (!r.value.ok) console.error('[Resend error]', JSON.stringify(rj));
            else console.log('[Resend ok]', rj.id);
          } else {
            console.error('[Resend fetch error]', r.reason);
          }
        }
      }

      // In-app notification
      await supabase.from('notifications').insert({
        user_id: user.id,
        title:   type === 'bank' ? 'Bank Account Linking Request Submitted' : 'Card Linking Request Submitted',
        message: `Your request to link ${type === 'bank' ? `${record.bank_name} account` : `${record.card_last4} card`} is under review. We'll notify you once it's approved.`,
        type:    'info',
      });

      return json({ success: true, id: inserted.id, status: 'pending' });
    }

    // ── LIST_USER — user fetches their linked accounts ───────────────────────
    if (action === 'list_user') {
      const { data, error } = await supabase
        .from('linked_accounts')
        .select('id,type,status,bank_name,account_number_last4,account_type,nickname,card_name,card_last4,card_expiry_mo,card_expiry_yr,card_network,card_bin,admin_note,created_at,updated_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json({ linked_accounts: data || [] });
    }

    // ── LIST_PENDING — admin fetches all pending (or all) requests ────────────
    if (action === 'list_pending') {
      const { data: adminCheck } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
      if (!adminCheck?.is_admin) return errJson('Unauthorized', 403);

      const status = (body.status as string) || 'pending';
      let q = supabase
        .from('linked_accounts')
        .select('id,user_id,type,status,bank_name,account_number_last4,account_type,nickname,card_name,card_last4,card_expiry_mo,card_expiry_yr,card_network,card_bin,admin_note,reviewed_at,created_at')
        .order('created_at', { ascending: false });
      if (status !== 'all') q = q.eq('status', status);
      const { data, error } = await q;
      if (error) throw error;

      // Attach user emails
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

      return json({ linked_accounts: enriched });
    }

    // ── VERIFY — admin approves or declines ───────────────────────────────────
    if (action === 'verify') {
      const { data: adminCheck } = await supabase.from('profiles').select('is_admin').eq('id', user.id).single();
      if (!adminCheck?.is_admin) return errJson('Unauthorized', 403);

      const { request_id, decision, admin_note } = body as {
        action: string; request_id: string; decision: 'approved' | 'declined'; admin_note?: string;
      };
      if (!request_id || !['approved', 'declined'].includes(decision)) {
        throw new Error('request_id and decision (approved|declined) are required');
      }

      const { data: req, error: rErr } = await supabase
        .from('linked_accounts').select('*').eq('id', request_id).single();
      if (rErr || !req) throw new Error('Request not found');
      if (req.status !== 'pending') throw new Error(`Already ${req.status}`);

      await supabase.from('linked_accounts').update({
        status: decision, admin_note: admin_note || null,
        reviewed_by: user.id, reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', request_id);

      // Get user email
      const { data: { users: authUsers } } = await supabase.auth.admin.listUsers({ perPage: 1000 });
      const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', req.user_id).single();
      const targetUser = authUsers.find((u: { id: string }) => u.id === req.user_id);
      const userEmail  = targetUser?.email || '';
      const userName   = profile?.full_name || 'Member';

      // In-app notification
      const notifTitle   = decision === 'approved'
        ? `${req.type === 'bank' ? 'Bank Account' : 'Card'} Linked Successfully`
        : `${req.type === 'bank' ? 'Bank Account' : 'Card'} Linking Request Declined`;
      const notifMessage = decision === 'approved'
        ? `Your ${req.type === 'bank' ? req.bank_name + ' account' : 'card ending ' + req.card_last4} has been verified and is now active.`
        : `Your linking request for ${req.type === 'bank' ? req.bank_name + ' account' : 'card ending ' + req.card_last4} was not approved.${admin_note ? ' Reason: ' + admin_note : ''}`;

      await supabase.from('notifications').insert({
        user_id: req.user_id, title: notifTitle, message: notifMessage,
        type: decision === 'approved' ? 'success' : 'warning',
      });

      // Email
      const resendKey = Deno.env.get('RESEND_API_KEY');
      if (resendKey && userEmail) {
        const expiry = req.type === 'card'
          ? `${req.card_expiry_mo}/${(req.card_expiry_yr || '').slice(-2)}`
          : undefined;
        const emailOpts = {
          type:           req.type, userName,
          bankName:       req.bank_name, accountLast4: req.account_number_last4,
          accountType:    req.account_type, nickname: req.nickname,
          cardNetwork:    req.card_network, cardLast4: req.card_last4,
          cardExpiry:     expiry, cardBin: req.card_bin,
          reason:         admin_note,
        };
        const subject = decision === 'approved'
          ? `Your ${req.type === 'bank' ? 'Bank Account' : 'Card'} Has Been Verified — ZenithOne`
          : `ZenithOne Account Linking Update`;
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { Authorization: `Bearer ${resendKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: FROM_ADDR, to: [userEmail], subject,
            html: decision === 'approved' ? approvalEmail(emailOpts) : declineEmail(emailOpts),
          }),
        });
      }

      return json({ success: true, status: decision });
    }

    throw new Error(`Unknown action: ${action}`);
  } catch (e) {
    return errJson(e);
  }
});

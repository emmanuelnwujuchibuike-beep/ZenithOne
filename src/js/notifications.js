/*!
 * ZenithOne Notification Center — Ultra Premium
 * Self-contained: injects CSS, HTML, and handles real-time.
 * Include after supabase-config.js and auth.js on every page.
 */
(function (global) {
  'use strict';

  // ─── SVG icon library ──────────────────────────────────────────────────────
  const ICO = {
    bell: `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
    transaction: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M7 16V4m0 0L3 8m4-4l4 4M17 8v12m0 0l4-4m-4 4l-4-4"/></svg>`,
    announcement: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M22 4S15 8 8 8H4a2 2 0 0 0 0 4h.5l1 8h3l1-4c1 .07 2 .2 3 .4"/><path d="M22 4c0 4-2 7-3 8"/></svg>`,
    security: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
    success: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><polyline points="20 6 9 17 4 12"/></svg>`,
    warning: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`,
    info: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>`,
    error: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>`,
    empty: `<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>`,
  };

  // ─── Type palette ──────────────────────────────────────────────────────────
  const TYPES = {
    transaction:  { c:'#c9a84c', bg:'rgba(201,168,76,.14)',  glow:'rgba(201,168,76,.4)',  ico: ICO.transaction,  lbl:'Transaction' },
    announcement: { c:'#a78bfa', bg:'rgba(167,139,250,.14)', glow:'rgba(167,139,250,.4)', ico: ICO.announcement, lbl:'Announcement' },
    security:     { c:'#f87171', bg:'rgba(248,113,113,.14)', glow:'rgba(248,113,113,.4)', ico: ICO.security,     lbl:'Security' },
    success:      { c:'#4ade80', bg:'rgba(74,222,128,.14)',  glow:'rgba(74,222,128,.4)',  ico: ICO.success,      lbl:'Success' },
    warning:      { c:'#f97316', bg:'rgba(249,115,22,.14)',  glow:'rgba(249,115,22,.4)',  ico: ICO.warning,      lbl:'Alert' },
    info:         { c:'#60a5fa', bg:'rgba(96,165,250,.14)',  glow:'rgba(96,165,250,.4)',  ico: ICO.info,         lbl:'Info' },
    error:        { c:'#f87171', bg:'rgba(248,113,113,.14)', glow:'rgba(248,113,113,.4)', ico: ICO.error,        lbl:'Alert' },
  };
  const tc = t => TYPES[t] || TYPES.info;

  // ─── State ─────────────────────────────────────────────────────────────────
  let _notes = [], _filter = 'all', _userId = null, _channel = null;
  const _toasted = new Set();

  // ─── CSS (injected once into <head>) ───────────────────────────────────────
  const CSS = `
    /* ══ Bell button ════════════════════════════════════════════════════════ */
    .zn-bell {
      position: relative;
      display: flex; align-items: center; justify-content: center;
      width: 44px; height: 44px; border-radius: 13px;
      border: 1px solid rgba(255,255,255,.08);
      background: rgba(255,255,255,.03);
      color: rgba(255,255,255,.55); cursor: pointer;
      transition: all .22s cubic-bezier(.4,0,.2,1);
      flex-shrink: 0; margin-right: 6px;
    }
    .zn-bell:hover {
      background: rgba(201,168,76,.1);
      border-color: rgba(201,168,76,.3);
      color: #c9a84c;
      box-shadow: 0 0 0 1px rgba(201,168,76,.2), 0 6px 20px rgba(201,168,76,.18);
    }
    .zn-bell.active { color: #c9a84c; border-color: rgba(201,168,76,.35); background: rgba(201,168,76,.09); }

    /* Pulse ring */
    .zn-bell-ring {
      display: none; position: absolute; inset: -4px; border-radius: 17px;
      border: 1.5px solid rgba(201,168,76,.55);
      animation: znRing 2.4s cubic-bezier(.4,0,.6,1) infinite;
    }
    .zn-bell.active .zn-bell-ring { display: block; }
    @keyframes znRing {
      0%,100% { opacity:.55; transform: scale(1); }
      50%      { opacity:.08; transform: scale(1.16); }
    }

    /* Count badge */
    .zn-bell-badge {
      display: none; position: absolute; top: -6px; right: -6px;
      min-width: 19px; height: 19px; padding: 0 5px; border-radius: 10px;
      background: linear-gradient(135deg,#b8860b,#e8c96a,#c9a84c);
      color: #050d0a; font-size: .59rem; font-weight: 900; letter-spacing: .01em;
      align-items: center; justify-content: center; line-height: 1;
      box-shadow: 0 2px 10px rgba(201,168,76,.55), 0 0 0 1.5px rgba(6,10,20,.8);
      animation: znBadgePop .2s cubic-bezier(.34,1.56,.64,1) both;
    }
    .zn-bell-badge.show { display: flex; }
    @keyframes znBadgePop { from{transform:scale(0)} to{transform:scale(1)} }

    /* ══ Overlay ══════════════════════════════════════════════════════════════ */
    .zn-overlay {
      position: fixed; inset: 0; z-index: 1100;
      background: rgba(2,5,16,.55); backdrop-filter: blur(5px);
      opacity: 0; pointer-events: none;
      transition: opacity .28s ease;
    }
    .zn-overlay.open { opacity: 1; pointer-events: auto; }

    /* ══ Notification Panel ════════════════════════════════════════════════════ */
    .zn-panel {
      position: fixed; top: 0; right: 0; bottom: 0; z-index: 1101;
      width: 400px; max-width: 100vw;
      background: linear-gradient(180deg, #08101e 0%, #050c1a 100%);
      border-left: 1px solid rgba(201,168,76,.18);
      display: flex; flex-direction: column;
      transform: translateX(100%);
      transition: transform .34s cubic-bezier(.4,0,.2,1);
      box-shadow: -28px 0 90px rgba(0,0,0,.55);
      will-change: transform;
    }
    /* Top accent line */
    .zn-panel::before {
      content:''; position:absolute; top:0; left:0; right:0; height:1px; z-index:1;
      background: linear-gradient(90deg, transparent 0%, rgba(201,168,76,.65) 45%, rgba(167,139,250,.4) 100%);
    }
    .zn-panel.open { transform: translateX(0); }

    /* Header */
    .zn-ph {
      display: flex; align-items: flex-start; justify-content: space-between;
      padding: 26px 24px 20px; border-bottom: 1px solid rgba(255,255,255,.07);
      flex-shrink: 0; position: relative; z-index: 1;
    }
    .zn-ph-eyebrow {
      font-size: .58rem; letter-spacing: .26em; text-transform: uppercase;
      color: rgba(201,168,76,.6); margin-bottom: 5px;
    }
    .zn-ph-title {
      font-family: 'Cormorant Garamond','Georgia',serif;
      font-size: 1.5rem; font-weight: 300; color: #fff; letter-spacing: .01em; line-height: 1;
    }
    .zn-ph-sub {
      font-size: .7rem; color: rgba(255,255,255,.3); margin-top: 5px;
      letter-spacing: .04em;
    }
    .zn-ph-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
    .zn-mark-btn {
      background: none; border: 1px solid rgba(255,255,255,.09);
      color: rgba(255,255,255,.38); font-size: .65rem; letter-spacing: .08em;
      text-transform: uppercase; padding: 5px 12px; border-radius: 8px;
      cursor: pointer; transition: all .18s; white-space: nowrap;
    }
    .zn-mark-btn:hover { border-color: rgba(201,168,76,.4); color: #c9a84c; }
    .zn-close-x {
      display: flex; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 9px; border: none;
      background: rgba(255,255,255,.04); color: rgba(255,255,255,.35); cursor: pointer;
      transition: background .15s, color .15s; flex-shrink: 0;
    }
    .zn-close-x:hover { background: rgba(255,255,255,.09); color: #fff; }

    /* Filter tabs */
    .zn-tabs {
      display: flex; border-bottom: 1px solid rgba(255,255,255,.06);
      flex-shrink: 0; overflow-x: auto; scrollbar-width: none; padding: 0 20px;
    }
    .zn-tabs::-webkit-scrollbar { display: none; }
    .zn-tab {
      background: none; border: none; border-bottom: 2px solid transparent;
      color: rgba(255,255,255,.32); font-size: .67rem; letter-spacing: .1em;
      text-transform: uppercase; padding: 13px 11px; cursor: pointer;
      transition: color .18s, border-color .18s; white-space: nowrap; flex-shrink: 0;
    }
    .zn-tab:hover  { color: rgba(255,255,255,.65); }
    .zn-tab.on     { color: #c9a84c; border-bottom-color: #c9a84c; }

    /* Body */
    .zn-body {
      flex: 1; overflow-y: auto; padding: 14px 16px; position: relative;
      scrollbar-width: thin; scrollbar-color: rgba(201,168,76,.18) transparent;
    }
    .zn-body::-webkit-scrollbar       { width: 3px; }
    .zn-body::-webkit-scrollbar-track  { background: transparent; }
    .zn-body::-webkit-scrollbar-thumb  { background: rgba(201,168,76,.2); border-radius: 3px; }

    /* Date group separator */
    .zn-date-sep {
      font-size: .6rem; letter-spacing: .14em; text-transform: uppercase;
      color: rgba(255,255,255,.2); margin: 14px 4px 8px; display: flex;
      align-items: center; gap: 10px;
    }
    .zn-date-sep::after {
      content:''; flex:1; height:1px; background: rgba(255,255,255,.06);
    }

    /* Empty state */
    .zn-empty {
      display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 72px 24px; text-align: center;
    }
    .zn-empty-ico { color: rgba(255,255,255,.1); margin-bottom: 18px; }
    .zn-empty-title {
      font-family: 'Cormorant Garamond', serif; font-size: 1.25rem;
      color: rgba(255,255,255,.3); margin-bottom: 8px; font-weight: 300;
    }
    .zn-empty-sub { font-size: .77rem; color: rgba(255,255,255,.18); line-height: 1.6; }

    /* Notification card */
    .zn-card {
      display: flex; align-items: flex-start; gap: 12px;
      padding: 13px 14px; border-radius: 14px; margin-bottom: 6px;
      border: 1px solid rgba(255,255,255,.055); background: rgba(255,255,255,.018);
      cursor: pointer; position: relative; overflow: hidden;
      transition: border-color .2s, background .2s, transform .15s;
      animation: znCardIn .22s cubic-bezier(.4,0,.2,1) both;
    }
    /* Left accent bar */
    .zn-card::before {
      content:''; position:absolute; left:0; top:8px; bottom:8px; width:2.5px;
      border-radius:0 2px 2px 0; background:var(--nc); opacity:0; transition:opacity .2s;
    }
    .zn-card:hover { background: rgba(255,255,255,.035); transform: translateX(2px); }
    .zn-card:hover::before { opacity:.7; }
    .zn-card.unread {
      border-color: rgba(255,255,255,.08);
      background: linear-gradient(135deg, var(--nb) 0%, rgba(255,255,255,.015) 100%);
    }
    .zn-card.unread::before { opacity:1; }
    @keyframes znCardIn { from{opacity:0;transform:translateY(6px)} to{opacity:1;transform:none} }

    .zn-card-ico {
      width: 36px; height: 36px; border-radius: 10px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .zn-card-body { flex:1; min-width:0; }
    .zn-card-title {
      font-family: 'Cormorant Garamond', serif; font-size: 1rem; font-weight: 500;
      color: rgba(255,255,255,.88); line-height: 1.2; margin-bottom: 3px;
    }
    .zn-card-msg {
      font-size: .74rem; color: rgba(255,255,255,.4); line-height: 1.5;
      display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    }
    .zn-card-foot {
      display: flex; align-items: center; gap: 8px; margin-top: 5px;
    }
    .zn-card-time { font-size: .62rem; color: rgba(255,255,255,.22); letter-spacing: .03em; }
    .zn-card-type-lbl {
      font-size: .58rem; letter-spacing: .1em; text-transform: uppercase;
      padding: 2px 7px; border-radius: 5px; background: var(--nb); color: var(--nc);
    }
    .zn-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: linear-gradient(135deg,#c9a84c,#e8d07a);
      flex-shrink: 0; margin-top: 5px; align-self: flex-start;
      box-shadow: 0 0 7px rgba(201,168,76,.65);
      animation: znDotPulse 2s ease infinite;
    }
    @keyframes znDotPulse { 0%,100%{opacity:1} 50%{opacity:.45} }

    /* ══ Toast ════════════════════════════════════════════════════════════════ */
    .zn-toasts {
      position: fixed; top: 78px; right: 20px; z-index: 1200;
      display: flex; flex-direction: column; gap: 10px; pointer-events: none;
      width: 350px; max-width: calc(100vw - 32px);
    }
    .zn-toast {
      width: 100%; pointer-events: auto;
      background: linear-gradient(145deg, rgba(8,14,28,.97) 0%, rgba(4,8,18,.99) 100%);
      border: 1px solid rgba(255,255,255,.1); border-radius: 18px;
      display: flex; align-items: center; gap: 13px; padding: 14px 16px;
      position: relative; overflow: hidden;
      box-shadow:
        0 24px 64px rgba(0,0,0,.65),
        0 0 0 1px rgba(255,255,255,.03) inset,
        0 1px 0 rgba(255,255,255,.07) inset;
      /* Start off-screen right */
      transform: translateX(calc(100% + 28px));
      opacity: 0;
      transition: transform .38s cubic-bezier(.22,.68,0,1.2), opacity .3s ease;
    }
    /* Top shimmer line */
    .zn-toast::before {
      content:''; position:absolute; top:0; left:12px; right:12px; height:1px;
      background: linear-gradient(90deg, transparent, rgba(255,255,255,.12), transparent);
      pointer-events: none;
    }
    /* Gold shimmer sweep on entry */
    .zn-toast::after {
      content:''; position:absolute; inset:0; pointer-events:none;
      background: linear-gradient(108deg, transparent 38%, rgba(255,255,255,.045) 55%, transparent 72%);
      transform: translateX(-100%); transition: transform .7s ease .12s;
    }
    .zn-toast.in { transform: translateX(0); opacity: 1; }
    .zn-toast.in::after { transform: translateX(100%); }
    .zn-toast.out { transform: translateX(calc(100% + 28px)); opacity: 0; }

    /* Left accent pillar */
    .zn-ta {
      position: absolute; left: 0; top: 0; bottom: 0; width: 3px;
      border-radius: 18px 0 0 18px;
    }
    /* Icon */
    .zn-ti {
      width: 38px; height: 38px; border-radius: 11px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }
    /* Text */
    .zn-tt { flex:1; min-width:0; }
    .zn-tt-title {
      font-family: 'Cormorant Garamond', serif; font-size: 1.02rem; font-weight: 500;
      color: rgba(255,255,255,.92); line-height: 1.2; margin-bottom: 2px;
    }
    .zn-tt-msg {
      font-size: .72rem; color: rgba(255,255,255,.42);
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    /* Progress bar */
    .zn-toast-bar {
      position: absolute; bottom: 0; left: 0; height: 2px; border-radius: 0 0 18px 18px;
      background: linear-gradient(90deg, var(--tc), transparent);
      animation: znBar 2s linear forwards;
    }
    @keyframes znBar { from{width:100%} to{width:0%} }

    /* ══ Responsive ═══════════════════════════════════════════════════════════ */
    @media (max-width: 640px) {
      .zn-panel { width: 100vw; }
      .zn-toasts { top: 68px; right: 12px; left: 12px; width: auto; }
    }
    @media (max-width: 420px) {
      .zn-ph { padding: 20px 18px 16px; }
      .zn-ph-title { font-size: 1.3rem; }
      .zn-body { padding: 12px; }
    }
  `;

  // ─── Utils ─────────────────────────────────────────────────────────────────
  function esc(s) {
    return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function relTime(iso) {
    const d = Date.now() - new Date(iso).getTime(), s = d/1e3, m = s/60, h = m/60, dy = h/24;
    if (s < 55) return 'just now';
    if (m < 60) return `${Math.floor(m)}m ago`;
    if (h < 24) return `${Math.floor(h)}h ago`;
    if (dy < 7) return `${Math.floor(dy)}d ago`;
    return new Date(iso).toLocaleDateString('en-US',{month:'short',day:'numeric'});
  }

  function dayLabel(iso) {
    const d = new Date(iso), now = new Date();
    const diff = Math.floor((now - d) / 86400000);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    if (diff < 7) return d.toLocaleDateString('en-US',{weekday:'long'});
    return d.toLocaleDateString('en-US',{month:'long',day:'numeric',year:diff>365?'numeric':undefined});
  }

  // ─── Render panel body ─────────────────────────────────────────────────────
  function renderPanel() {
    const body = document.getElementById('znBody');
    if (!body) return;

    let list = _notes;
    if (_filter === 'unread')        list = _notes.filter(n => !n.read);
    if (_filter === 'announcement')  list = _notes.filter(n => n.type === 'announcement');
    if (_filter === 'security')      list = _notes.filter(n => n.type === 'security');

    const EMPTY = {
      unread:       ['All Read',           'You have no unread notifications.'],
      announcement: ['No Announcements',   'No announcements from ZenithOne yet.'],
      security:     ['No Security Alerts', 'Your account has no security alerts.'],
      all:          ['All Clear',          'Your activity will appear here.'],
    };
    if (!list.length) {
      const [t,s] = EMPTY[_filter] || EMPTY.all;
      body.innerHTML = `<div class="zn-empty"><div class="zn-empty-ico">${ICO.empty}</div><div class="zn-empty-title">${t}</div><div class="zn-empty-sub">${s}</div></div>`;
      return;
    }

    let html = '', lastDay = '';
    list.forEach((n, i) => {
      const day = dayLabel(n.created_at);
      if (day !== lastDay) {
        html += `<div class="zn-date-sep">${day}</div>`;
        lastDay = day;
      }
      const c = tc(n.type);
      html += `
        <div class="zn-card ${n.read?'':'unread'}"
             style="--nc:${c.c};--nb:${c.bg};animation-delay:${Math.min(i,12)*0.028}s"
             onclick="window._znRead('${n.id}')">
          <div class="zn-card-ico" style="background:${c.bg};color:${c.c};">${c.ico}</div>
          <div class="zn-card-body">
            <div class="zn-card-title">${esc(n.title)}</div>
            <div class="zn-card-msg">${esc(n.message||'')}</div>
            <div class="zn-card-foot">
              <span class="zn-card-time">${relTime(n.created_at)}</span>
              <span class="zn-card-type-lbl" style="--nc:${c.c};--nb:${c.bg};">${c.lbl}</span>
            </div>
          </div>
          ${n.read?'':`<div class="zn-dot"></div>`}
        </div>`;
    });
    body.innerHTML = html;
  }

  // ─── Badge ─────────────────────────────────────────────────────────────────
  function updateBadge() {
    const u = _notes.filter(n => !n.read).length;
    const btn   = document.getElementById('znBell');
    const badge = document.getElementById('znBadge');
    const sub   = document.getElementById('znPanelSub');
    if (btn)   btn.classList.toggle('active', u > 0);
    if (badge) {
      badge.textContent = u > 99 ? '99+' : u;
      badge.classList.toggle('show', u > 0);
    }
    if (sub) sub.textContent = u > 0 ? `${u} unread` : 'All caught up';
  }

  // ─── Toast ─────────────────────────────────────────────────────────────────
  function showToast(n) {
    if (_toasted.has(n.id)) return;
    _toasted.add(n.id);
    const wrap = document.getElementById('znToasts');
    if (!wrap) return;
    const c = tc(n.type);
    const el = document.createElement('div');
    el.className = 'zn-toast';
    el.style.setProperty('--tc', c.c);
    el.innerHTML = `
      <div class="zn-ta" style="background:${c.c};box-shadow:0 0 10px ${c.glow};"></div>
      <div class="zn-ti" style="background:${c.bg};color:${c.c};">${c.ico}</div>
      <div class="zn-tt">
        <div class="zn-tt-title">${esc(n.title)}</div>
        <div class="zn-tt-msg">${esc((n.message||'').slice(0,80))}${(n.message||'').length>80?'…':''}</div>
      </div>
      <div class="zn-toast-bar" style="background:linear-gradient(90deg,${c.c},${c.bg});"></div>`;
    wrap.appendChild(el);
    // RAF double-fire to trigger transition
    requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('in')));
    setTimeout(() => {
      el.classList.remove('in');
      el.classList.add('out');
      setTimeout(() => el.remove(), 450);
    }, 2000);
  }

  // ─── Panel open / close ────────────────────────────────────────────────────
  function openPanel() {
    document.getElementById('znPanel')?.classList.add('open');
    document.getElementById('znOvl')?.classList.add('open');
    document.body.style.overflow = 'hidden';
    renderPanel();
  }
  function closePanel() {
    document.getElementById('znPanel')?.classList.remove('open');
    document.getElementById('znOvl')?.classList.remove('open');
    document.body.style.overflow = '';
  }
  function togglePanel() {
    document.getElementById('znPanel')?.classList.contains('open') ? closePanel() : openPanel();
  }
  function setFilter(f) {
    _filter = f;
    document.querySelectorAll('.zn-tab').forEach(b => b.classList.toggle('on', b.dataset.f === f));
    renderPanel();
  }

  // ─── Data ──────────────────────────────────────────────────────────────────
  async function fetchNotifications() {
    try {
      const { data } = await window._supabase
        .from('notifications').select('*')
        .eq('user_id', _userId)
        .order('created_at', { ascending: false })
        .limit(120);
      _notes = data || [];
      updateBadge();
      if (document.getElementById('znPanel')?.classList.contains('open')) renderPanel();
      // Show toast for newest unread once per session
      const sk = `znseen_${_userId}`;
      const lastSeen = sessionStorage.getItem(sk);
      const fresh = _notes.filter(n => !n.read && (!lastSeen || new Date(n.created_at) > new Date(lastSeen)));
      if (fresh.length) {
        setTimeout(() => showToast(fresh[0]), 900);
        sessionStorage.setItem(sk, new Date().toISOString());
      }
    } catch {}
  }

  async function markRead(id) {
    const n = _notes.find(x => x.id === id); if (!n || n.read) return;
    n.read = true; updateBadge(); renderPanel();
    try { await window._supabase.from('notifications').update({read:true}).eq('id',id).eq('user_id',_userId); } catch {}
  }

  async function markAllRead() {
    _notes.forEach(n => n.read = true); updateBadge(); renderPanel();
    try { await window._supabase.from('notifications').update({read:true}).eq('user_id',_userId); } catch {}
  }

  // ─── Real-time ─────────────────────────────────────────────────────────────
  function subscribeRealtime() {
    if (!window._supabase || !_userId || _channel) return;
    _channel = window._supabase.channel(`zn_notif_${_userId}`)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'notifications',
        filter: `user_id=eq.${_userId}`
      }, ({ new: n }) => {
        _notes.unshift(n);
        updateBadge();
        if (document.getElementById('znPanel')?.classList.contains('open')) renderPanel();
        showToast(n);
      })
      .subscribe();
  }

  // ─── HTML injection ─────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('znCSS')) return;
    const el = document.createElement('style');
    el.id = 'znCSS'; el.textContent = CSS;
    document.head.appendChild(el);
  }

  function injectBell() {
    const right = document.querySelector('.app-topbar-right');
    if (!right) return;

    // Replace existing #notifBtn if present, else inject before avatar
    const existing = document.getElementById('notifBtn');
    const btn = document.createElement('button');
    btn.id = 'znBell'; btn.className = 'zn-bell';
    btn.setAttribute('aria-label', 'Notifications');
    btn.onclick = togglePanel;
    btn.innerHTML = `
      <span class="zn-bell-ring"></span>
      ${ICO.bell}
      <span class="zn-bell-badge" id="znBadge">0</span>`;

    if (existing) {
      existing.replaceWith(btn);
    } else {
      const avatar = right.querySelector('.sidebar-avatar');
      if (avatar) right.insertBefore(btn, avatar);
      else right.appendChild(btn);
    }
  }

  function injectPanel() {
    if (document.getElementById('znPanel')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div class="zn-overlay" id="znOvl"></div>
      <div class="zn-panel" id="znPanel">
        <div class="zn-ph">
          <div>
            <div class="zn-ph-eyebrow">ZenithOne Credit Union</div>
            <div class="zn-ph-title">Notifications</div>
            <div class="zn-ph-sub" id="znPanelSub">Loading…</div>
          </div>
          <div class="zn-ph-actions">
            <button class="zn-mark-btn" onclick="window._znMarkAll()">Mark all read</button>
            <button class="zn-close-x" onclick="window._znClose()">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div class="zn-tabs">
          <button class="zn-tab on"  data-f="all"          onclick="window._znFilter('all')">All</button>
          <button class="zn-tab"     data-f="unread"       onclick="window._znFilter('unread')">Unread</button>
          <button class="zn-tab"     data-f="announcement" onclick="window._znFilter('announcement')">Announcements</button>
          <button class="zn-tab"     data-f="security"     onclick="window._znFilter('security')">Security</button>
        </div>
        <div class="zn-body" id="znBody">
          <div class="zn-empty"><div class="zn-empty-ico">${ICO.empty}</div><div class="zn-empty-sub">Loading…</div></div>
        </div>
      </div>
      <div class="zn-toasts" id="znToasts"></div>
    `);
    document.getElementById('znOvl').onclick = closePanel;
  }

  // ─── Boot ───────────────────────────────────────────────────────────────────
  async function boot() {
    try {
      const { data: { session } } = await window._supabase.auth.getSession();
      if (!session) return;
      _userId = session.user.id;
      await fetchNotifications();
      subscribeRealtime();
    } catch {}
  }

  function init() {
    injectStyles();
    injectBell();
    injectPanel();
    if (window._supabase) boot();
    else document.addEventListener('supabaseReady', boot, { once: true });
  }

  // ─── Expose globals ─────────────────────────────────────────────────────────
  global._znClose   = closePanel;
  global._znMarkAll = markAllRead;
  global._znRead    = markRead;
  global._znFilter  = setFilter;
  global._znRefresh = fetchNotifications;
  global._znToast   = showToast;

  // ─── Auto-init ───────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})(window);

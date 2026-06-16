(function () {
  'use strict';

  var SPA_PAGES = ['dashboard.html', 'accounts.html', 'transfer.html', 'cards.html', 'investments.html', 'settings.html', 'transactions.html', 'credit.html'];
  var PAGE_EXTRA_SCRIPT = { 'cards.html': 'js/cards.js', 'investments.html': 'js/investments.js', 'settings.html': 'js/settings.js' };

  var current = { page: (location.pathname.split('/').pop() || 'dashboard.html'), owned: null };
  var navInProgress = false;

  function pageNameFromUrl(url) {
    try {
      var u = new URL(url, location.href);
      if (u.origin !== location.origin) return null;
      return u.pathname.split('/').pop() || '';
    } catch (e) { return null; }
  }

  function isSpaPage(name) { return SPA_PAGES.indexOf(name) !== -1; }

  function showBar() {
    var bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;top:0;left:0;height:2px;width:0;background:linear-gradient(90deg,#c9a84c,#e4cd8a);z-index:9999;transition:width .25s ease,opacity .3s ease;opacity:1;';
    document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.style.width = '70%'; });
    return bar;
  }

  function hideBar(bar) {
    if (!bar) return;
    bar.style.width = '100%';
    setTimeout(function () {
      bar.style.opacity = '0';
      setTimeout(function () { bar.remove(); }, 300);
    }, 150);
  }

  function teardownCurrent() {
    var o = current.owned;
    if (!o) return;
    o.listeners.forEach(function (l) {
      try { l.target.removeEventListener(l.type, l.fn, l.opts); } catch (e) {}
    });
    o.intervals.forEach(function (id) { clearInterval(id); });
    o.timeouts.forEach(function (id) { clearTimeout(id); });
    current.owned = null;
  }

  function runPageScripts(extraCode, inlineCode) {
    var owned = { listeners: [], intervals: [], timeouts: [] };
    var origAddWin = window.addEventListener.bind(window);
    var origAddDoc = document.addEventListener.bind(document);
    var origSetInterval = window.setInterval.bind(window);
    var origSetTimeout = window.setTimeout.bind(window);

    window.addEventListener = function (type, fn, opts) {
      owned.listeners.push({ target: window, type: type, fn: fn, opts: opts });
      return origAddWin(type, fn, opts);
    };
    document.addEventListener = function (type, fn, opts) {
      owned.listeners.push({ target: document, type: type, fn: fn, opts: opts });
      return origAddDoc(type, fn, opts);
    };
    window.setInterval = function () {
      var id = origSetInterval.apply(null, arguments);
      owned.intervals.push(id);
      return id;
    };
    window.setTimeout = function () {
      var id = origSetTimeout.apply(null, arguments);
      owned.timeouts.push(id);
      return id;
    };

    var indirectEval = window.eval;
    try {
      if (extraCode) indirectEval(extraCode);
      if (inlineCode) indirectEval(inlineCode);
    } catch (err) {
      console.error('[spa-router] page script error', err);
    } finally {
      window.addEventListener = origAddWin;
      document.addEventListener = origAddDoc;
      window.setInterval = origSetInterval;
      window.setTimeout = origSetTimeout;
    }

    owned.listeners.forEach(function (l) {
      var isBootEvent = (l.type === 'load' && l.target === window) || (l.type === 'DOMContentLoaded' && l.target === document);
      if (!isBootEvent) return;
      try { l.fn(new Event(l.type)); } catch (e) { console.error('[spa-router] boot listener error', e); }
    });

    current.owned = owned;
  }

  async function navigate(url, push) {
    var name = pageNameFromUrl(url);
    if (!name || !isSpaPage(name)) { location.href = url; return; }
    if (navInProgress) return;
    navInProgress = true;
    var bar = showBar();
    try {
      var res = await fetch(url, { credentials: 'same-origin' });
      if (!res.ok) throw new Error('bad status ' + res.status);
      var html = await res.text();
      var doc = new DOMParser().parseFromString(html, 'text/html');

      var newRoot = doc.getElementById('spaPageRoot');
      var curRoot = document.getElementById('spaPageRoot');
      if (!newRoot || !curRoot) throw new Error('missing spaPageRoot');

      var extraSrc = PAGE_EXTRA_SCRIPT[name];
      var extraCode = null;
      if (extraSrc) {
        var r2 = await fetch(extraSrc, { credentials: 'same-origin' });
        extraCode = await r2.text();
      }

      teardownCurrent();

      document.querySelectorAll('style[data-spa-style="page"]').forEach(function (el) { el.remove(); });
      doc.querySelectorAll('style[data-spa-style="page"]').forEach(function (el) {
        document.head.appendChild(el.cloneNode(true));
      });

      curRoot.innerHTML = newRoot.innerHTML;

      if (doc.title) document.title = doc.title;
      var newTopbarTitle = doc.querySelector('.app-topbar-title');
      var curTopbarTitle = document.querySelector('.app-topbar-title');
      if (newTopbarTitle && curTopbarTitle) curTopbarTitle.textContent = newTopbarTitle.textContent;
      document.querySelectorAll('.sidebar-item[href]').forEach(function (a) {
        a.classList.toggle('active', a.getAttribute('href') === name);
      });

      if (push) history.pushState({ spaUrl: url }, '', url);
      current.page = name;

      var inlineScriptEl = doc.querySelector('script[data-spa-script="page"]');
      var inlineCode = inlineScriptEl ? inlineScriptEl.textContent : '';
      runPageScripts(extraCode, inlineCode);

      if (window.checkAuthGuard) { try { window.checkAuthGuard(); } catch (e) {} }
      window.scrollTo(0, 0);
    } catch (err) {
      console.error('[spa-router] navigation failed, falling back to full load', err);
      location.href = url;
      return;
    } finally {
      hideBar(bar);
      navInProgress = false;
    }
  }

  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('a[href]');
    if (!a || a.hasAttribute('download') || (a.target && a.target !== '_self')) return;
    var name = pageNameFromUrl(a.href);
    if (!name || !isSpaPage(name)) return;
    e.preventDefault();
    navigate(a.href, true);
  });

  window.addEventListener('popstate', function (e) {
    if (e.state && e.state.spaUrl) navigate(e.state.spaUrl, false);
    else location.reload();
  });

  window.spaNavigate = function (url) { navigate(url, true); };

  history.replaceState({ spaUrl: location.pathname + location.search }, '', location.href);
})();

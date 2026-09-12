(function () {
  try {
    var saved = localStorage.getItem('theme');
    var dark = saved ? saved === 'dark'
                     : window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.dataset.theme = 'dark';
  }

  function init() {
    var root = document.documentElement;
    var toggle = document.getElementById('themeToggle');

    toggle.addEventListener('click', function () {
      var next = root.dataset.theme === 'dark' ? 'light' : 'dark';
      root.dataset.theme = next;
      try { localStorage.setItem('theme', next); } catch (e) {}
    });

    var yearEl = document.getElementById('year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    function setupModal(triggerId, overlayId) {
      var trigger = document.getElementById(triggerId);
      var overlay = document.getElementById(overlayId);
      if (!trigger || !overlay) return null;

      var closeBtn = overlay.querySelector('.modal-close');
      var lastFocus = null;

      function open() {
        lastFocus = document.activeElement;
        overlay.classList.add('open');
        overlay.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        if (closeBtn) closeBtn.focus();
      }

      function close() {
        overlay.classList.remove('open');
        overlay.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        if (lastFocus && lastFocus.focus) lastFocus.focus();
      }

      trigger.addEventListener('click', open);
      if (closeBtn) closeBtn.addEventListener('click', close);

      overlay.addEventListener('mousedown', function (e) {
        if (e.target === overlay) close();
      });

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && overlay.classList.contains('open')) close();
      });

      return { open: open, close: close };
    }

    setupModal('emailBtn', 'emailModal');
    setupModal('biliBtn', 'biliModal');

    var copyBtn = document.getElementById('copyBtn');
    if (copyBtn) {
      var label = copyBtn.querySelector('.copy-label');
      var email = document.getElementById('emailText').textContent.trim();

      function showCopied() {
        copyBtn.classList.add('copied');
        label.textContent = '已复制 ✓';
        clearTimeout(copyBtn._timer);
        copyBtn._timer = setTimeout(function () {
          copyBtn.classList.remove('copied');
          label.textContent = label.dataset.default;
        }, 1600);
      }

      function legacyCopy() {
        var ta = document.createElement('textarea');
        ta.value = email;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = false;
        try { ok = document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
        if (ok) showCopied();
      }

      copyBtn.addEventListener('click', function () {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(email).then(showCopied, legacyCopy);
        } else {
          legacyCopy();
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
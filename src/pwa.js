/*
 * Mini Excel - "install as an app" support.
 * Only runs on the website (http/https). Inside the desktop (Electron) window it does nothing.
 */
(function () {
  'use strict';
  if (!/^https?:$/.test(location.protocol)) return;

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {
        /* offline mode is a bonus: the app works without it */
      });
    });
  }

  // Chrome / Edge / Android: show our own "Install" button when the browser says the app can be installed.
  const btn = document.getElementById('btn-install');
  let later = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    later = e;
    if (btn) btn.hidden = false;
  });
  if (btn) {
    btn.addEventListener('click', () => {
      if (!later) return;
      later.prompt();
      later = null;
      btn.hidden = true;
    });
  }
  window.addEventListener('appinstalled', () => {
    if (btn) btn.hidden = true;
  });
})();

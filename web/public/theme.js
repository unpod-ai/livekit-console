// Runs before the app/styles to avoid painting the wrong appearance on first load.
(() => {
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  const valid = value => ['light', 'dark', 'system'].includes(value) ? value : 'system';
  let preference = 'system';
  try { preference = valid(localStorage.getItem('lkc.theme')); } catch { /* Storage may be disabled. */ }
  function apply(value) {
    preference = valid(value);
    const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
    root.dataset.themePreference = preference;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
    window.dispatchEvent(new Event('console-theme-change'));
  }
  window.addEventListener('console-theme-set', event => {
    const value = valid(event.detail);
    try { localStorage.setItem('lkc.theme', value); } catch { /* Keep the session choice usable. */ }
    apply(value);
  });
  window.addEventListener('storage', event => {
    if (event.key === 'lkc.theme' || event.key === null) apply(event.newValue);
  });
  media.addEventListener('change', () => { if (preference === 'system') apply('system'); });
  apply(preference);
})();

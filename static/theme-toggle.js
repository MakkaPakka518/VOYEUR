import { mountPixelToggle } from './components/pixel-toggle/PixelToggleEngine.js';
import { t } from './i18n.js';

const STORAGE_KEY = 'ig-luv-theme';

export function createThemeToggle(hosts) {
  const document = hosts[0]?.ownerDocument;
  if (!document) return { destroy() {} };
  const window = document.defaultView;
  let theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
  let dead = false;
  const instances = [];

  function apply(next, persist = true) {
    theme = next === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    document.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.content = theme === 'dark' ? '#0b1522' : '#13243a');
    if (persist) {
      try { window.localStorage.setItem(STORAGE_KEY, theme); } catch {}
    }
    instances.forEach(instance => instance.update({ checked: theme === 'light' }));
  }

  hosts.forEach(host => {
    const instance = mountPixelToggle(host, {
      checked: theme === 'light',
      sound: false,
      onCheckedChange: checked => apply(checked ? 'light' : 'dark'),
    });
    instance.root.querySelector('.pixel-switch').setAttribute('aria-label', t('action.theme'));
    instances.push(instance);
  });
  const storage = event => { if (event.key === STORAGE_KEY && event.newValue) apply(event.newValue, false); };
  window.addEventListener('storage', storage);
  apply(theme, false);

  return {
    get theme() { return theme; },
    setTheme(next) { if (!dead) apply(next); },
    destroy() {
      if (dead) return;
      dead = true;
      window.removeEventListener('storage', storage);
      instances.forEach(instance => instance.destroy());
    },
  };
}

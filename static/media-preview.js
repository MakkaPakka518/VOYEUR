import { t } from './i18n.js';

/** Native modal media viewer. Owns loading handlers, playback and scroll restoration. */
export function createMediaPreview(dialog) {
  const document = dialog.ownerDocument, window = document.defaultView;
  const content = dialog.querySelector('#preview-content');
  const message = dialog.querySelector('#preview-message');
  const title = dialog.querySelector('#preview-title');
  const download = dialog.querySelector('#preview-download');
  const closeButton = dialog.querySelector('#preview-close');
  const listeners = new AbortController();
  let mediaListeners, opener, scrollY = 0, bodyStyle = '', skipHistory = false, dead = false, locked = false;

  function unload() {
    mediaListeners?.abort();
    const media = content.firstElementChild;
    if (media) {
      if (media.tagName === 'VIDEO') media.pause();
      media.removeAttribute('src');
      if (media.tagName === 'VIDEO') media.load();
      media.remove();
    }
  }

  function open(item, source = null, pushHistory = true) {
    if (dead) return;
    const url = new URL(item.url, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith('/files/')) return;
    const wasOpen = dialog.open;
    unload();
    if (!wasOpen) {
      locked = true;
      skipHistory = false;
      opener = source || document.activeElement;
      scrollY = window.scrollY;
      bodyStyle = document.body.style.cssText;
      const width = document.body.getBoundingClientRect().width;
      Object.assign(document.body.style, { position: 'fixed', top: `-${scrollY}px`, left: '0', width: `${width}px`, overflow: 'hidden' });
    }
    document.querySelectorAll('video').forEach(video => video.pause());
    title.textContent = item.title || t('preview.title');
    message.textContent = t('preview.loading');
    message.hidden = false;
    url.searchParams.set('download', '1');
    download.href = url.pathname + url.search;
    const video = item.kind === 'video';
    const media = document.createElement(video ? 'video' : 'img');
    media.className = 'preview-media';
    if (video) {
      media.controls = true;
      media.playsInline = true;
      media.preload = 'metadata';
    } else media.alt = item.title || t('preview.original');
    mediaListeners = new AbortController();
    media.addEventListener(video ? 'loadedmetadata' : 'load', () => { message.hidden = true; }, { signal: mediaListeners.signal });
    media.addEventListener('error', () => { message.textContent = t('preview.failed'); message.hidden = false; }, { signal: mediaListeners.signal });
    media.src = item.url;
    content.replaceChildren(media);
    if (pushHistory) window.history.pushState({ page: window.location.pathname, preview: item }, '', window.location.href);
    if (!wasOpen) dialog.showModal();
    closeButton.focus({ preventScroll: true });
  }

  function close(fromHistory = false) {
    if (!dialog.open && !locked) return;
    skipHistory = fromHistory;
    if (dialog.open) dialog.close();
    restore();
  }

  function restore() {
    if (!locked) return;
    locked = false;
    unload();
    document.body.style.cssText = bodyStyle;
    window.scrollTo({ top: scrollY, behavior: 'instant' });
    if (opener?.isConnected && opener.getClientRects().length) opener.focus({ preventScroll: true });
    if (!dead && !skipHistory && window.history.state?.preview) window.history.back();
    skipHistory = false;
  }
  dialog.addEventListener('close', () => { if (!dialog.open) restore(); }, { signal: listeners.signal });
  closeButton.addEventListener('click', () => close(), { signal: listeners.signal });
  dialog.addEventListener('click', event => {
    const box = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom)) close();
  }, { signal: listeners.signal });

  return {
    open, close,
    get isOpen() { return dialog.open; },
    destroy() {
      if (dead) return;
      dead = true;
      close(true);
      unload();
      listeners.abort();
    },
  };
}

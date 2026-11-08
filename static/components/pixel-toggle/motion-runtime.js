/** Instance-owned DOM lifecycle for the compact native LeiBox integration. */
export function createSurface(target, config, initial = {}) {
  const document = target.ownerDocument;
  const window = document.defaultView;
  const element = document.createElement('div');
  element.dataset.motionSurface = '';
  element.style.cssText = 'display:block;position:relative;width:100%;min-width:0;overflow:hidden;isolation:isolate';
  const root = element.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = ':host{display:block}[hidden]{display:none!important}*{box-sizing:border-box}.motion-frame{position:relative;transform-origin:top left}.motion-body{position:relative;width:100%;margin:0}' + config.css;
  const frame = document.createElement('div');
  frame.className = 'motion-frame';
  const body = document.createElement('div');
  body.className = 'motion-body';
  body.innerHTML = config.markup;
  frame.append(body);
  root.append(style, frame);
  target.append(element);
  let options = { ...initial }, dead = false;
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cleanups = [], frames = new Set();
  const reduced = () => options.reducedMotion ?? media.matches;
  function resize() {
    const width = element.clientWidth || config.width;
    const scale = Math.min(1, width / config.width);
    const height = Number.isFinite(options.height) ? Math.max(1, options.height) : config.height;
    element.style.setProperty('--motion-height', `${height}px`);
    element.style.height = `${height * scale}px`;
    element.dataset.reducedMotion = String(reduced());
    frame.style.width = `${Math.max(width, config.width)}px`;
    frame.style.height = `${height}px`;
    frame.style.transform = `scale(${scale})`;
  }
  const observer = new window.ResizeObserver(resize);
  observer.observe(element);
  resize();
  const controller = {
    element, root,
    update(next) { if (!dead) { options = { ...options, ...next }; resize(); } },
    destroy() {
      if (dead) return;
      dead = true;
      observer.disconnect();
      frames.forEach(id => window.cancelAnimationFrame(id));
      cleanups.reverse().forEach(cleanup => cleanup());
      frames.clear();
      element.remove();
    },
  };
  return {
    root, element, body, frame, document, window, controller, reduced,
    on(node, type, listener, settings) {
      node.addEventListener(type, listener, settings);
      cleanups.push(() => node.removeEventListener(type, listener, settings));
    },
    requestAnimationFrame(callback) {
      if (dead) return 0;
      const id = window.requestAnimationFrame(time => { frames.delete(id); if (!dead) callback(time); });
      frames.add(id);
      return id;
    },
    cancelAnimationFrame(id) { window.cancelAnimationFrame(id); frames.delete(id); },
    addCleanup(cleanup) { cleanups.push(cleanup); },
  };
}

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = dirname(fileURLToPath(import.meta.url));
const artifacts = process.env.ARTIFACT_DIR || '/tmp/opencode/ig-luv-carousel-check';
await mkdir(artifacts, { recursive: true });
const colors = ['#d23c41', '#235dc8', '#248358', '#9a53bb'];
const requests = [];
let revision = 0;
let includePlatforms = false;
const fixture = () => ({
  config: { targets: ['demo'], username: 'demo', has_password: true, enabled: true, interval: 300, post_limit: 12, cleanup_days: 0, ...(includePlatforms ? {
    tiktok: { targets: ['demo'], username: 'demo', has_password: true, login_method: 'password', enabled: true, interval: 60, post_limit: 6, cleanup_days: 7 },
    threads: { targets: ['demo'], username: '', has_password: false, login_method: 'password', enabled: true, interval: 900, post_limit: 24, cleanup_days: 30 },
    x: { targets: ['demo'], username: '', has_password: false, has_cookie: true, login_method: 'cookie', enabled: false, interval: 3600, post_limit: 6, cleanup_days: 0 },
    douyin: { targets: ['MS4wLjAB_Test-ID'], username: '', has_password: false, has_cookie: true, login_method: 'password', enabled: true, interval: 300, post_limit: 12, cleanup_days: 14 },
    wechat: { targets: ['wxid_demo'], username: '', has_password: false, login_method: 'desktop', enabled: true, interval: 900, post_limit: 6, cleanup_days: 7 },
  } : {}) },
  status: { state: 'ready', checked_at: '2026-11-08T10:00:00Z', ...(includePlatforms ? { platforms: {
    instagram: { state: 'ready' }, tiktok: { state: 'error', error_code: 'verification_required' }, threads: { state: 'ready' }, x: { state: 'disabled' }, douyin: { state: 'ready' }, wechat: { state: 'ready' },
  }} : {}) },
  library: [{ name: 'demo', status: { checked_at: `revision-${revision}` }, latest: '/files/photo/3.svg',
    items: Array.from({ length: 14 }, (_, i) => ({
      id: `post-${i}`, caption: `归档照片 ${i + 1}`, captured_at: '2026-11-08T10:00:00Z',
      source_url: `https://www.instagram.com/p/post-${i}/`,
      files: [{ name: 'media-01.jpg', kind: 'image', url: `/files/photo/${i % 4}.svg` },
        { name: 'page.png', kind: 'image', url: `/files/photo/${(i + 1) % 4}.svg` },
        ...(i === 0 ? [{ name: 'media-02.mp4', kind: 'video', url: '/files/video.mp4' }] : [])],
    })),
  }, ...(includePlatforms ? [{ name: 'demo', key: 'tiktok:demo', platform: 'tiktok', status: {}, latest: '/files/photo/1.svg', items: [{
    id: 'tk-123', caption: 'TikTok 图文和视频', captured_at: '2026-11-08T10:00:00Z', source_url: 'https://www.tiktok.com/@demo/photo/123',
    files: [{ name: 'media-01.jpg', kind: 'image', url: '/files/photo/1.svg' }, { name: 'media-02.jpg', kind: 'image', url: '/files/photo/2.svg' },
      { name: 'media-03.mp4', kind: 'video', url: '/files/video.mp4' }],
  }] }, { name: 'demo', key: 'threads:demo', platform: 'threads', status: {}, latest: '/files/photo/2.svg', items: [{
    id: 'th-text', caption: '這是一則沒有圖片或影片的 Threads 純文字貼文。', captured_at: '2026-11-08T10:00:00Z', source_url: 'https://www.threads.com/@demo/post/text',
    files: [{ name: 'page.png', kind: 'image', url: '/files/photo/3.svg' }, { name: 'content.txt', kind: 'text', url: '/files/text/content.txt' }],
  }, {
    id: 'th-photo', caption: 'Threads 圖片貼文', captured_at: '2026-11-08T09:00:00Z', source_url: 'https://www.threads.com/@demo/post/photo',
    files: [{ name: 'media-01.jpg', kind: 'image', url: '/files/photo/0.svg' }, { name: 'page.png', kind: 'image', url: '/files/photo/1.svg' }],
  }] }, { name: 'demo', key: 'x:demo', platform: 'x', status: {}, latest: '/files/photo/0.svg', items: [{
    id: 'x-text', caption: '这是一条 X 纯文字贴文。', captured_at: '2026-11-08T08:00:00Z', source_url: 'https://x.com/demo/status/123',
    files: [{ name: 'page.png', kind: 'image', url: '/files/photo/0.svg' }, { name: 'content.txt', kind: 'text', url: '/files/text/content.txt' }],
  }] }, { name: 'MS4wLjAB_Test-ID', key: 'douyin:MS4wLjAB_Test-ID', platform: 'douyin', status: {}, latest: '/files/photo/2.svg', items: [{
    id: '7666666666666666666', caption: '抖音图文作品', captured_at: '2026-11-08T07:00:00Z', source_url: 'https://www.douyin.com/note/7666666666666666666',
    files: [{ name: 'media-01.jpg', kind: 'image', url: '/files/photo/2.svg' }, { name: 'page.png', kind: 'image', url: '/files/photo/3.svg' }],
  }] }, { name: 'wxid_demo', display_name: '微信好友', key: 'wechat:wxid_demo', platform: 'wechat', status: {}, latest: null, items: [{
    id: 'wechat-page', caption: '朋友圈页面快照 1', captured_at: '2026-11-08T06:00:00Z', source_url: '',
    files: [{ name: 'media-01.png', kind: 'image', url: '/files/photo/1.svg' }],
  }] }] : [])],
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/state') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(fixture()));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    requests.push([req.method, url.pathname, raw ? JSON.parse(raw) : null, url.search]);
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
    return;
  }
  const photoMatch = url.pathname.match(/^\/(?:files\/)?photo\/(\d)\.svg$/);
  if (photoMatch) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><path fill="${colors[Number(photoMatch[1])]}" d="M0 0h600v800H0z"/></svg>`);
    return;
  }
  if (url.pathname === '/files/text/content.txt') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('這是一則沒有圖片或影片的 Threads 純文字貼文。');
    return;
  }
  if (url.pathname === '/component') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Carousel test</title><style>body{margin:0;background:#eaeaea}#demo,#second{max-width:940px;margin:auto}</style><div id="demo"></div><div id="second"></div></html>');
    return;
  }
  try {
    const path = url.pathname === '/login' ? '/static/login.html' : ['/', '/instagram', '/tiktok', '/douyin', '/threads', '/x', '/moments', '/settings'].includes(url.pathname) ? '/static/index.html' : url.pathname;
    if (!path.startsWith('/static/') || path.includes('..')) throw new Error('Not found');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml' })[extname(path)] || 'application/octet-stream');
    res.end(await readFile(join(root, path)));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
const errors = [];
async function open({ savedLocale = 'zh-CN', ...options } = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ...options });
  if (savedLocale) await page.addInitScript(value => localStorage.setItem('ig-luv-locale', value), savedLocale);
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (/GL_INVALID/.test(message.text())) errors.push(message.text()); });
  return page;
}
async function mount(page, options = {}) {
  await page.goto(`${base}/component`);
  await page.evaluate(async options => {
    const { mountInkSpreadCarousel } = await import('/static/components/ink-spread-carousel/InkSpreadCarouselEngine.js');
    window.mountCarousel = mountInkSpreadCarousel;
    window.changes = [];
    window.carousel = mountInkSpreadCarousel(document.querySelector('#demo'), {
      images: Array.from({ length: 4 }, (_, i) => ({ src: `/photo/${i}.svg`, alt: `Photo ${i}` })),
      onIndexChange: i => window.changes.push(i),
      ...options,
    });
  }, options);
  await page.waitForFunction(() => window.carousel.root.querySelector('.ib-scene').dataset.ready === 'true');
}
async function done(page, index) {
  try {
    await page.waitForFunction(index => {
      const { dataset } = window.carousel.root.querySelector('.ib-scene');
      return dataset.index === String(index) && dataset.animating === 'false';
    }, index);
  } catch (error) {
    const state = await page.locator('.ib-scene').evaluate(scene => ({ ...scene.dataset }));
    throw new Error(`carousel did not settle on ${index}: ${JSON.stringify(state)}`, { cause: error });
  }
}
async function pixel(page, x, y) {
  return page.evaluate(({ x, y }) => {
    const canvas = window.carousel.root.querySelector('canvas');
    const gl = canvas.getContext('webgl');
    if (!gl) return [...canvas.getContext('2d').getImageData(x * canvas.width, y * canvas.height, 1, 1).data];
    const data = new Uint8Array(4);
    gl.readPixels(Math.floor(x * canvas.width), Math.floor((1 - y) * canvas.height), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, data);
    return [...data];
  }, { x, y });
}
const near = (a, b) => a.slice(0, 3).every((value, i) => Math.abs(value - b[i]) < 8);
async function clickSide(photo, side) {
  const { width, height } = await photo.boundingBox();
  await photo.click({ position: { x: width * (side === 'left' ? .2 : .8), y: height * .5 } });
}
async function navigate(page, path) {
  await page.locator(`a[data-route][href="${path}"]:visible`).first().click();
  await page.waitForURL(`${base}${path}`);
}

try {
  const page = await open();
  await mount(page, { duration: 2400 });
  assert.equal(await page.locator('.ib-scene').getAttribute('data-renderer'), 'webgl');
  assert.equal(await page.locator('button button').count(), 0);
  assert.equal(await page.locator('.ib-nav').count(), 0);
  assert.equal(await page.locator('.ib-card button').count(), 1);
  const photo = page.locator('.ib-photo');
  await photo.click({ position: { x: 380, y: 45 } });
  await page.waitForFunction(() => Number(window.carousel.root.querySelector('.ib-scene').dataset.progress) > 0.22);
  assert(near(await pixel(page, .9, .1), [35, 93, 200]), 'press origin should reveal new photo');
  assert(near(await pixel(page, .1, .9), [210, 60, 65]), 'unrevealed corner must keep original colors');
  await page.screenshot({ path: `${artifacts}/early.png` });
  await page.waitForFunction(() => Number(window.carousel.root.querySelector('.ib-scene').dataset.progress) > 0.55);
  await page.screenshot({ path: `${artifacts}/middle.png` });
  await done(page, 1);
  await page.screenshot({ path: `${artifacts}/late.png` });
  assert(near(await pixel(page, .9, .9), [35, 93, 200]));

  // Rapid requests continue from the visible frame and only emit the final index.
  await page.evaluate(() => { window.changes.length = 0; window.carousel.update({ duration: 900 }); });
  await photo.click({ position: { x: 380, y: 510 } });
  await page.waitForFunction(() => Number(window.carousel.root.querySelector('.ib-scene').dataset.progress) > 0.25);
  const before = await pixel(page, .85, .85);
  await page.evaluate(() => {
    window.savedCanvas = window.carousel.root.querySelector('canvas');
    window.carousel.root.querySelector('.ib-photo').click();
  });
  const after = await pixel(page, .85, .85);
  assert(near(after, before), `interruption must not flash back: ${before} -> ${after}`);
  await clickSide(photo, 'left');
  await done(page, 2);
  assert.deepEqual(await page.evaluate(() => window.changes), [2]);
  assert(await page.evaluate(() => window.savedCanvas === window.carousel.root.querySelector('canvas')));
  const left = await page.locator('.ib-scene').getAttribute('data-origin');
  await clickSide(photo, 'right');
  const right = await page.locator('.ib-scene').getAttribute('data-origin');
  assert.notEqual(left, right);
  await done(page, 3);

  await photo.focus();
  await page.keyboard.press('Home');
  await done(page, 0);
  await clickSide(photo, 'left');
  await done(page, 3);
  await clickSide(photo, 'right');
  await done(page, 0);
  await photo.focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('.ib-scene').getAttribute('data-origin'), '0.8800,0.5000');
  await done(page, 1);
  await page.keyboard.press('End');
  await done(page, 3);
  await page.keyboard.press('Space');
  await done(page, 0);
  await page.keyboard.press('Enter');
  await done(page, 1);
  await page.evaluate(() => { window.changes.length = 0; window.carousel.update({ index: 2 }); });
  await done(page, 2);
  assert.deepEqual(await page.evaluate(() => window.changes), []);

  // Image replacement failure leaves the previous texture and controls usable.
  await page.evaluate(() => window.carousel.update({ images: ['/missing.png', '/photo/0.svg'] }));
  await page.locator('.ib-error').waitFor({ state: 'visible' });
  assert(await page.locator('.ib-error').isVisible());
  assert(near(await pixel(page, .5, .5), [36, 131, 88]));
  await page.keyboard.press('ArrowRight');
  await done(page, 3);
  await page.evaluate(() => {
    window.carousel.update({ images: ['/missing-again.png', '/photo/1.svg'] });
    window.carousel.update({ images: ['/photo/0.svg', '/photo/1.svg'], index: 0 });
  });
  await page.waitForFunction(() => window.carousel.root.querySelector('.ib-status').textContent.startsWith('1 / 2'));
  assert(await page.locator('.ib-error').isHidden());

  // Hidden and offscreen time must not advance the transition.
  await page.evaluate(() => window.carousel.update({ duration: 2400 }));
  await photo.click();
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  const paused = await page.locator('.ib-scene').getAttribute('data-progress');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.ib-scene').getAttribute('data-progress'), paused);
  await page.evaluate(() => {
    delete document.hidden;
    document.dispatchEvent(new Event('visibilitychange'));
    document.querySelector('#demo').style.marginTop = '2500px';
  });
  await page.waitForFunction(() => window.carousel.root.querySelector('.ib-scene').dataset.visible === 'false');
  const offscreen = await page.locator('.ib-scene').getAttribute('data-progress');
  await page.waitForTimeout(250);
  assert.equal(await page.locator('.ib-scene').getAttribute('data-progress'), offscreen);
  await page.evaluate(() => document.querySelector('#demo').style.marginTop = '0');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await done(page, 1);
  await page.emulateMedia({ reducedMotion: 'no-preference' });

  await page.evaluate(() => {
    window.glExtension = window.carousel.root.querySelector('canvas').getContext('webgl').getExtension('WEBGL_lose_context');
    window.glExtension.loseContext();
  });
  await page.waitForFunction(() => window.carousel.root.querySelector('.ib-scene').dataset.renderer === 'image');
  await clickSide(photo, 'right');
  await done(page, 0);
  await page.evaluate(() => window.glExtension.restoreContext());
  await page.waitForFunction(() => window.carousel.root.querySelector('.ib-scene').dataset.renderer === 'webgl');
  assert(near(await pixel(page, .5, .5), [210, 60, 65]));
  const draws = await page.locator('.ib-scene').getAttribute('data-draws');
  await page.waitForTimeout(150);
  assert.equal(await page.locator('.ib-scene').getAttribute('data-draws'), draws, 'idle canvas must stop drawing');

  // The included atlas, independent instances, updates and teardown/remount.
  await page.evaluate(() => {
    window.second = window.mountCarousel(document.querySelector('#second'), { height: 720, reducedMotion: true });
  });
  await page.waitForFunction(() => window.second.root.querySelector('.ib-scene').dataset.ready === 'true');
  await page.evaluate(() => window.second.update({ index: 3 }));
  assert.equal(await page.locator('#demo .ib-scene').getAttribute('data-index'), '0');
  assert.equal(await page.locator('#second .ib-scene').getAttribute('data-index'), '3');
  await page.locator('#second').screenshot({ path: `${artifacts}/atlas.png` });
  await page.evaluate(() => {
    window.carousel.update({ images: ['/photo/0.svg', '/photo/1.svg'] });
    window.carousel.destroy(); window.carousel.destroy(); window.second.destroy();
  });
  assert.equal(await page.locator('[data-motion-surface]').count(), 0);
  await mount(page, { reducedMotion: true });

  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await photo.focus();
    const measured = await photo.evaluate(button => {
      const rect = button.getBoundingClientRect();
      const computed = getComputedStyle(button);
      return { target: rect.width / 2, outline: computed.outlineStyle, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert(measured.target >= 48 && measured.outline === 'solid' && !measured.overflow, JSON.stringify(measured));
    await page.screenshot({ path: `${artifacts}/component-${width}.png` });
  }
  await page.close();

  const fallback = await open({ viewport: { width: 375, height: 844 }, hasTouch: true, isMobile: true });
  await fallback.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function(type, ...args) {
      return type.startsWith('webgl') ? null : original.call(this, type, ...args);
    };
  });
  await mount(fallback, { duration: 2400 });
  assert.equal(await fallback.locator('.ib-scene').getAttribute('data-renderer'), 'canvas2d');
  const box = await fallback.locator('.ib-photo').boundingBox();
  await fallback.touchscreen.tap(box.x + box.width * .1, box.y + box.height * .1);
  await fallback.waitForFunction(() => Number(window.carousel.root.querySelector('.ib-scene').dataset.progress) > .24);
  assert(near(await pixel(fallback, .1, .1), [154, 83, 187]));
  assert(near(await pixel(fallback, .9, .9), [210, 60, 65]));
  await fallback.screenshot({ path: `${artifacts}/fallback-touch.png` });
  await fallback.locator('.ib-photo').tap({ position: { x: box.width * .8, y: box.height * .5 } });
  await fallback.evaluate(() => window.carousel.update({ reducedMotion: true }));
  await done(fallback, 0);
  await fallback.close();

  const panel = await open();
  await panel.goto(base);
  await panel.locator('.photo-carousel-card').first().waitFor();
  const themeSwitch = panel.locator('.page-header .theme-toggle .pixel-switch');
  await themeSwitch.waitFor();
  assert.equal(await panel.locator('.theme-toggle [role="switch"]').count(), 2);
  assert.equal(await themeSwitch.getAttribute('aria-checked'), 'true');
  let themeBox = await themeSwitch.boundingBox();
  assert(themeBox.width >= 90 && themeBox.height >= 48, JSON.stringify(themeBox));
  await themeSwitch.click();
  await panel.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await panel.evaluate(() => localStorage.getItem('ig-luv-theme')), 'dark');
  assert.equal(await panel.locator('meta[name="theme-color"]').getAttribute('content'), '#0b1522');
  assert.equal(await panel.locator('.mobile-header .theme-toggle .pixel-switch').getAttribute('aria-checked'), 'false');
  await panel.screenshot({ path: `${artifacts}/theme-dark-1440.png` });
  for (const width of [375, 768]) {
    await panel.setViewportSize({ width, height: 1000 });
    assert.equal(await panel.locator('.theme-toggle:visible').count(), 1);
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.equal(await panel.locator('body').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(16, 24, 32)');
    await panel.screenshot({ path: `${artifacts}/theme-dark-${width}.png` });
  }
  await panel.setViewportSize({ width: 1440, height: 1000 });
  await themeSwitch.press('Space');
  await panel.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  themeBox = await themeSwitch.boundingBox();
  await panel.mouse.move(themeBox.x + themeBox.width * .8, themeBox.y + themeBox.height / 2);
  await panel.mouse.down();
  await panel.mouse.move(themeBox.x + themeBox.width * .2, themeBox.y + themeBox.height / 2, { steps: 8 });
  await panel.mouse.up();
  await panel.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await themeSwitch.click();
  await themeSwitch.click();
  assert.equal(await themeSwitch.getAttribute('aria-checked'), 'false', 'rapid clicks must end on the last requested theme');
  await panel.emulateMedia({ reducedMotion: 'reduce' });
  await themeSwitch.press('Space');
  await panel.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await themeSwitch.locator('.pixel-knob').evaluate(node => node.style.left), '264px');
  await panel.emulateMedia({ reducedMotion: 'no-preference' });
  await themeSwitch.click();
  await panel.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await panel.reload();
  await panel.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.querySelector('.theme-toggle [data-motion-surface]'));
  assert.equal(await panel.evaluate(() => localStorage.getItem('ig-luv-theme')), 'dark');
  await panel.locator('.page-header .theme-toggle .pixel-switch').click();
  await panel.waitForFunction(() => document.documentElement.dataset.theme === 'light');
  assert.equal(await panel.locator('.photo-carousel-card[data-kind="image"]').count(), 2, 'all 14 images split into groups, none lost');
  assert.equal(await panel.locator('.photo-carousel-card[data-kind="screenshot"]').count(), 2);
  assert.equal(await panel.locator('.media-card[data-kind="video"] video').count(), 1);
  assert(await panel.locator('.media-kind-group[data-media-group="image"]').first().evaluate(node => node.open));
  for (const kind of ['video', 'screenshot']) assert.equal(await panel.locator(`.media-kind-group[data-media-group="${kind}"]`).first().evaluate(node => node.open), false);
  assert.equal((await panel.locator('.sidebar .wordmark').innerText()).replace(/\s+/g, ' ').trim(), 'VOYEUR');
  assert.equal(await panel.locator('.sidebar .wordmark-mark svg').count(), 1);
  const card = panel.locator('.photo-carousel-card').first();
  await card.locator('.ib-scene[data-ready="true"]').waitFor();
  await clickSide(card.locator('.ib-photo'), 'right');
  await panel.waitForFunction(() => document.querySelector('.photo-carousel-card [data-motion-surface]').shadowRoot.querySelector('.ib-scene').dataset.index === '1');
  assert.equal(await card.locator('.delete-button').getAttribute('data-item'), 'post-1');
  assert.match(await card.locator('.media-actions a').first().getAttribute('href'), /photo\/1/);
  await panel.evaluate(() => {
    window.panelCanvas = document.querySelector('.photo-carousel-card [data-motion-surface]').shadowRoot.querySelector('canvas');
    window.panelVideo = document.querySelector('video');
  });
  await panel.locator('.media-kind-group[data-media-group="video"] > summary').click();
  assert(await panel.locator('.media-kind-group[data-media-group="video"]').evaluate(node => node.open));
  revision++;
  await panel.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await panel.waitForTimeout(250);
  assert(await panel.evaluate(() => window.panelCanvas === document.querySelector('.photo-carousel-card [data-motion-surface]').shadowRoot.querySelector('canvas')));
  assert(await panel.evaluate(() => window.panelVideo === document.querySelector('video')));
  assert(await panel.locator('.media-kind-group[data-media-group="video"]').evaluate(node => node.open));
  assert.equal(await card.locator('.photo-count').innerText(), '2 / 12');

  // Original files open in this page, with focus, history and scroll restoration.
  const original = card.locator('.media-actions a[data-preview]').first();
  await original.scrollIntoViewIfNeeded();
  const originalScroll = await panel.evaluate(() => scrollY);
  const originalWidth = await panel.locator('.workspace').evaluate(node => node.getBoundingClientRect().width);
  const pageCount = panel.context().pages().length;
  await original.click();
  const dialog = panel.locator('#media-preview');
  await dialog.waitFor({ state: 'visible' });
  await panel.waitForFunction(() => document.querySelector('#preview-content img')?.naturalWidth > 0);
  assert.equal(await dialog.locator('img').getAttribute('src'), await original.getAttribute('href'));
  assert.equal(panel.url(), `${base}/`);
  assert.equal(panel.context().pages().length, pageCount);
  assert.equal(await panel.evaluate(() => document.body.style.position), 'fixed');
  assert(Math.abs(await panel.locator('.workspace').evaluate(node => node.getBoundingClientRect().width) - originalWidth) < 1);
  await panel.screenshot({ path: `${artifacts}/image-preview-desktop.png` });
  await panel.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  await panel.waitForFunction(expected => Math.abs(scrollY - expected) < 2, originalScroll);
  assert(await original.evaluate(node => document.activeElement === node));
  await panel.goForward();
  await dialog.waitFor({ state: 'visible' });
  await panel.goBack();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await dialog.locator('img,video').count(), 0);

  panel.on('dialog', dialog => dialog.accept());
  await card.locator('.delete-button').click();
  await panel.waitForFunction(() => document.querySelector('#toast').textContent === '内容已删除');
  assert(requests.some(([method, path]) => method === 'DELETE' && path === '/api/targets/demo/items/post-1'));
  for (const width of [375, 768, 1440]) {
    await panel.setViewportSize({ width, height: 1000 });
    await panel.locator('[data-filter="image"]').click();
    assert.equal(await panel.locator('.media-card[data-kind="video"]:visible').count(), 0);
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await card.scrollIntoViewIfNeeded();
    if (width === 375) {
      const photo = await card.locator('.ib-photo').boundingBox();
      assert(photo.width >= 350 && photo.height >= 460, `phone photo is too small: ${JSON.stringify(photo)}`);
      assert(photo.width / 2 >= 48, 'both mobile photo halves must be usable touch targets');
      assert.equal(await card.locator('.ib-nav').count(), 0);
      await clickSide(card.locator('.ib-photo'), 'right');
      await panel.waitForFunction(() => document.querySelector('.photo-carousel-card [data-motion-surface]').shadowRoot.querySelector('.ib-scene').dataset.index === '2');
      assert.equal(await card.locator('.delete-button').getAttribute('data-item'), 'post-2');
      const mobileTheme = panel.locator('.mobile-header .theme-toggle .pixel-switch');
      const toggleBox = await mobileTheme.boundingBox();
      assert(toggleBox.width >= 90 && toggleBox.height >= 48, JSON.stringify(toggleBox));
      const refresh = panel.locator('#mobile-run');
      const refreshBox = await refresh.boundingBox();
      assert(refreshBox.width >= 48 && refreshBox.height >= 48, JSON.stringify(refreshBox));
      assert.notEqual(await refresh.evaluate(node => getComputedStyle(node).backgroundColor), 'rgba(0, 0, 0, 0)');
    }
    await panel.screenshot({ path: `${artifacts}/panel-${width}.png` });
  }
  await panel.locator('[data-filter="video"]').click();
  assert.equal(await panel.locator('.media-card[data-kind="video"]:visible').count(), 1);
  await panel.locator('[data-filter="screenshot"]').click();
  assert.equal(await panel.locator('.photo-carousel-card[data-kind="screenshot"]:visible').count(), 2);
  const latestCard = panel.locator('.photo-carousel-card[data-kind="screenshot"]:visible').first();
  await latestCard.locator('.ib-scene[data-ready="true"]').waitFor();
  assert.equal(await latestCard.locator('.delete-button').getAttribute('data-latest'), '1');
  await latestCard.locator('.delete-button').click();
  assert(requests.some(([method, path]) => method === 'DELETE' && path === '/api/targets/demo/latest'));

  // Both platforms share the viewer, but keep same-name targets and actions separate.
  includePlatforms = true;
  await panel.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const tk = panel.locator('.target-block[data-platform="tiktok"]');
  await tk.waitFor();
  await navigate(panel, '/tiktok');
  assert(await panel.locator('#settings').isHidden());
  await panel.locator('[data-filter="image"]').click();
  assert.equal(await panel.locator('.target-block[data-platform="instagram"]:visible').count(), 0);
  const tkCard = tk.locator('.photo-carousel-card[data-kind="image"]');
  await tkCard.scrollIntoViewIfNeeded();
  await tkCard.locator('.ib-scene[data-ready="true"]').waitFor();
  await clickSide(tkCard.locator('.ib-photo'), 'left');
  await tkCard.locator('.ib-scene[data-index="1"][data-animating="false"]').waitFor();
  assert.equal(await tkCard.locator('.delete-button').getAttribute('data-platform'), 'tiktok');
  await tkCard.locator('.delete-button').click();
  await panel.waitForTimeout(100);
  assert(requests.some(([method, path, , search]) => method === 'DELETE' && path === '/api/targets/demo/items/tk-123' && search === '?platform=tiktok'));
  assert.equal(await tk.locator('.target-actions a').getAttribute('href'), 'https://www.tiktok.com/@demo');
  const th = panel.locator('.target-block[data-platform="threads"]');
  await navigate(panel, '/threads');
  await th.waitFor();
  assert.equal(await panel.locator('#page-title').innerText(), 'Threads');
  assert.equal(await panel.locator('.target-block[data-platform="instagram"]:visible').count(), 0);
  assert.equal(await th.locator('.target-actions a').getAttribute('href'), 'https://www.threads.com/@demo');
  assert.equal(await th.locator('.media-kind-group[data-media-group="text"]').evaluate(node => node.open), false);
  await panel.locator('[data-filter="text"]').click();
  const textCard = th.locator('.text-card');
  await textCard.waitFor();
  assert.match(await textCard.locator('.text-content').innerText(), /純文字貼文/);
  assert.equal(await textCard.locator('a', { hasText: '下载文字' }).getAttribute('href'), '/files/text/content.txt?download=1');
  assert.equal(await textCard.locator('.delete-button').getAttribute('data-platform'), 'threads');
  for (const width of [375, 768, 1440]) {
    await panel.setViewportSize({ width, height: 1000 });
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({ path: `${artifacts}/threads-text-${width}.png` });
  }
  await textCard.locator('.delete-button').click();
  await panel.waitForTimeout(100);
  assert(requests.some(([method, path, , search]) => method === 'DELETE' && path === '/api/targets/demo/items/th-text' && search === '?platform=threads'));
  const xTarget = panel.locator('.target-block[data-platform="x"]');
  await navigate(panel, '/x');
  await xTarget.waitFor();
  assert.equal(await panel.locator('#page-title').innerText(), 'X');
  assert.equal(await xTarget.locator('.target-actions a').getAttribute('href'), 'https://x.com/demo');
  await panel.locator('[data-filter="text"]').click();
  assert.match(await xTarget.locator('.text-content').innerText(), /X 纯文字贴文/);
  for (const width of [375, 1440]) {
    await panel.setViewportSize({ width, height: 1000 });
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({ path: `${artifacts}/x-text-${width}.png` });
  }
  const douyinTarget = panel.locator('.target-block[data-platform="douyin"]');
  await navigate(panel, '/douyin');
  await douyinTarget.waitFor();
  assert.equal(await panel.locator('#page-title').innerText(), '抖音');
  assert.equal(await douyinTarget.locator('.target-actions a').getAttribute('href'), 'https://www.douyin.com/user/MS4wLjAB_Test-ID');
  await panel.locator('[data-filter="image"]').click();
  assert.equal(await douyinTarget.locator('.photo-carousel-card[data-kind="image"]:visible').count(), 1);
  for (const width of [375, 1440]) {
    await panel.setViewportSize({ width, height: 1000 });
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({ path: `${artifacts}/douyin-${width}.png` });
  }
  const wechatTarget = panel.locator('.target-block[data-platform="wechat"]');
  await navigate(panel, '/moments');
  await wechatTarget.waitFor();
  assert.equal(await panel.locator('#page-title').innerText(), '微信朋友圈');
  assert.match(await wechatTarget.locator('.target-heading h3').innerText(), /微信好友/);
  assert.equal(await wechatTarget.locator('.target-actions a', { hasText: '打开主页' }).count(), 0);
  await navigate(panel, '/instagram');
  assert.equal(await tk.isVisible(), false);
  assert.equal(await panel.locator('.target-block[data-platform="instagram"]:visible').count(), 1);
  await navigate(panel, '/');
  assert.equal(await panel.locator('.target-block:visible').count(), 6);
  await navigate(panel, '/settings');
  assert(await panel.locator('#library').isHidden());
  assert.equal(await panel.locator('.settings-group[open]').count(), 0);
  await panel.locator('#platform-settings summary').click();
  await panel.locator('#settings-platform').selectOption('tiktok');
  assert(await panel.locator('#platform-enabled').isChecked());
  assert.equal(await panel.locator('#interval').inputValue(), '60');
  assert.equal(await panel.locator('#post-limit').inputValue(), '6');
  assert.equal(await panel.locator('#cleanup-days').inputValue(), '7');
  assert(await panel.getByText('TikTok 账号', { exact: true }).isVisible());
  assert(await panel.getByText('输入 TikTok 验证码', { exact: true }).isVisible());
  await panel.locator('#verification-code').fill('123456');
  await panel.locator('#submit-verification').click();
  assert(requests.some(([method, path, body, search]) => method === 'POST' && path === '/api/verification' && search === '?platform=tiktok' && body.code === '123456'));
  await panel.locator('#login-method').selectOption('cookie');
  assert(await panel.locator('#cookie-field').isVisible());
  assert(await panel.locator('#verification-panel').isHidden());
  assert(await panel.locator('#ig-username').isHidden());
  await panel.locator('#targets-settings summary').click();
  await panel.locator('#ig-targets').fill('demo');
  await panel.locator('#tiktok-cookie').fill('sessionid=fixture-session');
  await panel.locator('#settings-form [type="submit"]').click();
  assert(requests.some(([method, path, body]) => method === 'POST' && path === '/api/config' && body.platform === 'tiktok' && body.login_method === 'cookie' && body.cookie === 'sessionid=fixture-session' && body.interval === 60 && body.post_limit === 6 && body.cleanup_days === 7));
  await panel.waitForFunction(() => document.querySelector('#tiktok-cookie').value === '');
  await panel.locator('#reset-session').click();
  assert(requests.some(([method, path, , search]) => method === 'POST' && path === '/api/reset-session' && search === '?platform=tiktok'));
  for (const width of [375, 768, 1440]) {
    await panel.setViewportSize({ width, height: 1000 });
    await panel.locator('#login-method').selectOption('cookie');
    await panel.locator('#settings').scrollIntoViewIfNeeded();
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await panel.screenshot({ path: `${artifacts}/tiktok-settings-${width}.png` });
  }
  await panel.locator('#settings-platform').selectOption('threads');
  assert(await panel.getByText('Threads 账号', { exact: true }).isVisible());
  assert.equal(await panel.locator('#login-method-label').innerText(), 'Threads 登录方式');
  assert.equal(await panel.locator('#ig-targets').inputValue(), 'demo');
  await panel.locator('#login-method').selectOption('cookie');
  assert.equal(await panel.locator('#cookie-label').innerText(), 'Threads Cookie');
  await panel.locator('#tiktok-cookie').fill('sessionid=threads-fixture');
  await panel.locator('#settings-form [type="submit"]').click();
  assert(requests.some(([method, path, body]) => method === 'POST' && path === '/api/config' && body.platform === 'threads' && body.login_method === 'cookie' && body.cookie === 'sessionid=threads-fixture'));
  await panel.locator('#reset-session').click();
  assert(requests.some(([method, path, , search]) => method === 'POST' && path === '/api/reset-session' && search === '?platform=threads'));
  await panel.locator('#settings-platform').selectOption('x');
  assert.equal(await panel.locator('#platform-enabled').isChecked(), false);
  assert.equal(await panel.locator('#login-method-label').innerText(), 'X 登录方式');
  await panel.locator('#login-method').selectOption('cookie');
  assert.equal(await panel.locator('#cookie-label').innerText(), 'X Cookie');
  await panel.locator('#tiktok-cookie').fill('auth_token=x-fixture; ct0=csrf');
  await panel.locator('#settings-form [type="submit"]').click();
  assert(requests.some(([method, path, body]) => method === 'POST' && path === '/api/config' && body.platform === 'x' && body.login_method === 'cookie' && body.cookie === 'auth_token=x-fixture; ct0=csrf'));
  await panel.locator('#reset-session').click();
  assert(requests.some(([method, path, , search]) => method === 'POST' && path === '/api/reset-session' && search === '?platform=x'));
  await panel.locator('#settings-platform').selectOption('douyin');
  assert.equal(await panel.locator('#login-method-label').innerText(), '抖音 登录方式');
  assert.equal(await panel.locator('#login-method option[value="password"]').innerText(), '公开模式');
  assert(await panel.locator('#ig-username').isHidden());
  assert.equal(await panel.locator('#ig-targets').inputValue(), 'MS4wLjAB_Test-ID');
  assert.match(await panel.locator('#ig-targets').getAttribute('placeholder'), /主页链接/);
  await panel.locator('#login-method').selectOption('phone');
  assert(await panel.locator('#ig-username').isVisible());
  assert(await panel.locator('#ig-password').isHidden());
  assert.match(await panel.locator('#ig-username').getAttribute('placeholder'), /11 位手机号/);
  await panel.locator('#login-method').selectOption('qrcode');
  assert(await panel.locator('#cookie-field').isHidden());
  assert.match(await panel.locator('#public-note').innerText(), /存储到照片/);
  await panel.locator('#settings-form [type="submit"]').click();
  assert(requests.some(([method, path, body]) => method === 'POST' && path === '/api/config' && body.platform === 'douyin' && body.login_method === 'qrcode'));
  await panel.waitForFunction(() => !document.querySelector('#settings-form [type="submit"]').disabled);
  await panel.waitForTimeout(1100);
  await panel.locator('#login-method').selectOption('cookie');
  assert.equal(await panel.locator('#cookie-label').innerText(), '抖音 Cookie');
  await panel.locator('#tiktok-cookie').fill('sessionid=douyin-fixture; ttwid=device');
  await panel.locator('#settings-form [type="submit"]').click();
  assert(requests.some(([method, path, body]) => method === 'POST' && path === '/api/config' && body.platform === 'douyin' && body.login_method === 'cookie' && body.cookie === 'sessionid=douyin-fixture; ttwid=device'));
  await panel.locator('#reset-session').click();
  assert(requests.some(([method, path, , search]) => method === 'POST' && path === '/api/reset-session' && search === '?platform=douyin'));
  await panel.locator('#cleanup-platform').click();
  assert(requests.some(([method, path, , search]) => method === 'DELETE' && path === '/api/cleanup' && search === '?platform=douyin'));
  await panel.locator('#settings-platform').selectOption('instagram');
  assert.equal(await panel.locator('#ig-username').inputValue(), 'demo');
  assert(await panel.locator('#cookie-field').isHidden());
  await panel.locator('#settings-platform').selectOption('wechat');
  assert(await panel.locator('#login-method-field').isHidden());
  assert(await panel.locator('#targets-settings').isVisible());
  assert.equal(await panel.locator('#ig-targets').inputValue(), 'wxid_demo');
  assert.equal(await panel.locator('#ig-targets').getAttribute('list'), 'wechat-authors');
  assert(await panel.locator('#reset-session').isHidden());
  assert.match(await panel.locator('#public-note').innerText(), /不读取聊天内容/);
  await panel.reload();
  await panel.locator('#settings-platform').waitFor({ state: 'attached' });
  assert.equal(panel.url(), `${base}/settings`);
  assert(await panel.locator('#library').isHidden());
  assert.equal(await panel.locator('.settings-group[open]').count(), 0);
  await panel.screenshot({ path: `${artifacts}/settings-collapsed-desktop.png` });
  await panel.waitForFunction(() => document.querySelector('#ig-targets').value === 'demo');
  await panel.evaluate(() => document.querySelector('#ig-targets').value = '');
  await panel.locator('#settings-form [type="submit"]').click();
  assert(await panel.locator('#targets-settings').evaluate(node => node.open));

  await navigate(panel, '/tiktok');
  await panel.locator('[data-filter="video"]').click();
  await tk.locator('a[data-preview="video"]').click();
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.locator('video').getAttribute('src'), '/files/video.mp4');
  assert(await dialog.locator('video').evaluate(node => node.controls && node.playsInline));
  await panel.waitForFunction(() => document.querySelector('#preview-message').textContent.includes('加载失败'));
  await panel.locator('#preview-close').click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await dialog.locator('video').count(), 0);
  await panel.locator('[data-filter="image"]').click();
  await tk.locator('a[data-preview="image"]').first().click();
  await dialog.waitFor({ state: 'visible' });
  await panel.waitForFunction(() => document.querySelector('#preview-content img')?.naturalWidth > 0);
  await panel.locator('#preview-message').waitFor({ state: 'hidden' });
  await panel.screenshot({ path: `${artifacts}/image-preview-mobile.png` });
  await panel.goBack();
  await dialog.waitFor({ state: 'hidden' });
  await panel.close();

  const mobilePreview = await open({ viewport: { width: 375, height: 844 }, isMobile: true, hasTouch: true });
  await mobilePreview.goto(`${base}/instagram`);
  assert(await mobilePreview.locator('#settings').isHidden());
  assert.equal(await mobilePreview.locator('#page-title').innerText(), 'Instagram');
  const mobileOriginal = mobilePreview.locator('.target-block[data-platform="instagram"] a[data-preview="image"]').first();
  await mobileOriginal.scrollIntoViewIfNeeded();
  const mobileScroll = await mobilePreview.evaluate(() => scrollY);
  await mobileOriginal.tap();
  const mobileDialog = mobilePreview.locator('#media-preview');
  await mobileDialog.waitFor({ state: 'visible' });
  await mobilePreview.waitForFunction(() => document.querySelector('#preview-content img')?.naturalWidth > 0);
  const fullscreen = await mobileDialog.boundingBox();
  assert(Math.abs(fullscreen.width - 375) < 1 && Math.abs(fullscreen.height - 844) < 1, JSON.stringify(fullscreen));
  const closeArea = await mobilePreview.locator('#preview-close').boundingBox();
  assert(closeArea.width >= 48 && closeArea.height >= 48);
  await mobilePreview.screenshot({ path: `${artifacts}/preview-fullscreen-touch-375.png` });
  await mobilePreview.goBack();
  await mobileDialog.waitFor({ state: 'hidden' });
  assert.equal(mobilePreview.url(), `${base}/instagram`);
  assert(Math.abs(await mobilePreview.evaluate(() => scrollY) - mobileScroll) < 2);
  await navigate(mobilePreview, '/settings');
  assert.equal(await mobilePreview.locator('.settings-group[open]').count(), 0);
  assert(await mobilePreview.locator('#library').isHidden());
  await mobilePreview.screenshot({ path: `${artifacts}/settings-collapsed-touch-375.png` });
  await mobilePreview.locator('#platform-settings summary').tap();
  assert(await mobilePreview.locator('#settings-platform').isVisible());
  await mobilePreview.locator('#platform-settings summary').tap();
  assert(await mobilePreview.locator('#settings-platform').isHidden());
  await mobilePreview.setViewportSize({ width: 320, height: 844 });
  assert(await mobilePreview.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  assert.equal(await mobilePreview.locator('.bottom-nav a:visible').count(), 6);
  assert(await mobilePreview.locator('.bottom-nav a[href="/x"]').isHidden());
  for (const link of await mobilePreview.locator('.bottom-nav a:visible').all()) {
    const box = await link.boundingBox();
    assert(box.width >= 48 && box.height >= 48, JSON.stringify(box));
  }
  await mobilePreview.locator('.mobile-header .wordmark').click();
  assert.equal(mobilePreview.url(), `${base}/`);
  assert.equal(await mobilePreview.locator('.mobile-header .wordmark').getAttribute('aria-current'), 'page');
  await mobilePreview.close();
  const loginPage = await open();
  await loginPage.goto(base);
  await loginPage.evaluate(() => localStorage.setItem('ig-luv-theme', 'dark'));
  await loginPage.goto(`${base}/login`);
  assert.equal(await loginPage.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await loginPage.locator('meta[name="theme-color"]').getAttribute('content'), '#0b1522');
  assert.equal(await loginPage.locator('.login-form-wrap').evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(16, 24, 32)');
  await loginPage.screenshot({ path: `${artifacts}/login-dark.png` });
  await loginPage.close();

  const localeCases = [
    ['zh-CN', '回到观察室', '全部媒体', '保存并连接', '切换图片'],
    ['zh-TW', '回到觀察室', '所有媒體', '儲存並連線', '切換圖片'],
    ['en', 'Back to the Watch Room', 'All media', 'Save and connect', 'Change image'],
  ];
  for (const [savedLocale, loginHeading, pageTitle, saveLabel, carouselLabel] of localeCases) {
    const localized = await open({ savedLocale });
    await localized.goto(`${base}/login`);
    assert.equal(await localized.locator('html').getAttribute('lang'), savedLocale);
    assert.equal(await localized.locator('.login-form h2').innerText(), loginHeading);
    assert.equal(await localized.locator('.locale-select').inputValue(), savedLocale);
    for (const width of [375, 390, 768, 1440]) {
      await localized.setViewportSize({ width, height: 1000 });
      assert(await localized.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${savedLocale} login overflow at ${width}px`);
    }
    await localized.setViewportSize({ width: 390, height: 844 });
    await localized.screenshot({ path: `${artifacts}/login-${savedLocale}-390.png` });
    await localized.goto(base);
    await localized.locator('.photo-carousel-card .ib-scene[data-ready="true"]').first().waitFor();
    assert.equal(await localized.locator('#page-title').innerText(), pageTitle);
    assert((await localized.locator('.photo-carousel-card .ib-photo').first().getAttribute('aria-label')).startsWith(carouselLabel));
    await navigate(localized, '/settings');
    assert.equal(await localized.locator('#settings-form [type="submit"]').innerText(), saveLabel);
    assert.equal(await localized.locator('.theme-toggle:visible .pixel-switch').getAttribute('aria-label'), await localized.locator('.theme-toggle:visible').evaluate((_, expected) => expected, savedLocale === 'en' ? 'Switch day or night theme' : savedLocale === 'zh-TW' ? '切換日夜主題' : '切换日夜主题'));
    for (const width of [375, 390, 768, 1440]) {
      await localized.setViewportSize({ width, height: 1000 });
      assert(await localized.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${savedLocale} panel overflow at ${width}px`);
      assert.equal(await localized.locator('.locale-select:visible').count(), 1);
      const clipped = await localized.locator('button:visible').evaluateAll(buttons => buttons.filter(button => button.innerText.trim() && button.scrollWidth > button.clientWidth + 1).map(button => button.innerText.trim()));
      assert.deepEqual(clipped, [], `${savedLocale} has clipped button text at ${width}px`);
    }
    await localized.setViewportSize({ width: 390, height: 844 });
    await localized.screenshot({ path: `${artifacts}/settings-${savedLocale}-390.png`, fullPage: true });
    await localized.close();
  }

  const persistedLocale = await open({ savedLocale: null, locale: 'fr-FR' });
  await persistedLocale.goto(`${base}/login`);
  await Promise.all([
    persistedLocale.waitForNavigation(),
    persistedLocale.locator('.locale-select').selectOption('en'),
  ]);
  assert.equal(await persistedLocale.evaluate(() => localStorage.getItem('ig-luv-locale')), 'en');
  assert.equal(await persistedLocale.locator('html').getAttribute('lang'), 'en');
  await persistedLocale.close();
  assert.deepEqual(errors, []);
  console.log(`PASS: WebGL/2D ink masks, interruption, keyboard/touch, failure/races, visibility, reduced motion, context recovery, cleanup, gallery actions and 375/768/1440 layouts. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
  server.close();
}

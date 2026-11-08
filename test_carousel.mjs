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
let includeTikTok = false;
const fixture = () => ({
  config: { targets: ['demo'], username: 'demo', has_password: true, interval: 300, post_limit: 12 },
  status: { state: 'ready', checked_at: '2026-11-08T10:00:00Z', ...(includeTikTok ? { platforms: {
    instagram: { state: 'ready' }, tiktok: { state: 'error', error_code: 'verification_required' },
  }} : {}) },
  library: [{ name: 'demo', status: { checked_at: `revision-${revision}` }, latest: '/files/photo/3.svg',
    items: Array.from({ length: 14 }, (_, i) => ({
      id: `post-${i}`, caption: `归档照片 ${i + 1}`, captured_at: '2026-11-08T10:00:00Z',
      source_url: `https://www.instagram.com/p/post-${i}/`,
      files: [{ name: 'media-01.jpg', kind: 'image', url: `/files/photo/${i % 4}.svg` },
        { name: 'page.png', kind: 'image', url: `/files/photo/${(i + 1) % 4}.svg` },
        ...(i === 0 ? [{ name: 'media-02.mp4', kind: 'video', url: '/files/video.mp4' }] : [])],
    })),
  }, ...(includeTikTok ? [{ name: 'demo', key: 'tiktok:demo', platform: 'tiktok', status: {}, latest: '/files/photo/1.svg', items: [{
    id: 'tk-123', caption: 'TikTok 图文和视频', captured_at: '2026-11-08T10:00:00Z', source_url: 'https://www.tiktok.com/@demo/photo/123',
    files: [{ name: 'media-01.jpg', kind: 'image', url: '/files/photo/1.svg' }, { name: 'media-02.jpg', kind: 'image', url: '/files/photo/2.svg' },
      { name: 'media-03.mp4', kind: 'video', url: '/files/video.mp4' }],
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
  if (url.pathname === '/component') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Carousel test</title><style>body{margin:0;background:#eaeaea}#demo,#second{max-width:940px;margin:auto}</style><div id="demo"></div><div id="second"></div></html>');
    return;
  }
  try {
    const path = ['/', '/instagram', '/tiktok', '/settings'].includes(url.pathname) ? '/static/index.html' : url.pathname;
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
async function open(options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, ...options });
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
  await page.waitForFunction(index => {
    const { dataset } = window.carousel.root.querySelector('.ib-scene');
    return dataset.index === String(index) && dataset.animating === 'false';
  }, index);
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
  assert.match(await page.locator('.ib-error').innerText(), /previous photos are still available/);
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
  assert.equal(await panel.locator('.photo-carousel-card[data-kind="image"]').count(), 2, 'all 14 images split into groups, none lost');
  assert.equal(await panel.locator('.photo-carousel-card[data-kind="screenshot"]').count(), 2);
  assert.equal(await panel.locator('.media-card[data-kind="video"] video').count(), 1);
  const card = panel.locator('.photo-carousel-card').first();
  await card.locator('.ib-scene[data-ready="true"]').waitFor();
  await clickSide(card.locator('.ib-photo'), 'right');
  await panel.waitForFunction(() => document.querySelector('[data-motion-surface]').shadowRoot.querySelector('.ib-scene').dataset.index === '1');
  assert.equal(await card.locator('.delete-button').getAttribute('data-item'), 'post-1');
  assert.match(await card.locator('.media-actions a').first().getAttribute('href'), /photo\/1/);
  await panel.evaluate(() => {
    window.panelCanvas = document.querySelector('[data-motion-surface]').shadowRoot.querySelector('canvas');
    window.panelVideo = document.querySelector('video');
  });
  revision++;
  await panel.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await panel.waitForTimeout(250);
  assert(await panel.evaluate(() => window.panelCanvas === document.querySelector('[data-motion-surface]').shadowRoot.querySelector('canvas')));
  assert(await panel.evaluate(() => window.panelVideo === document.querySelector('video')));
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
  assert(Math.abs(await panel.evaluate(() => scrollY) - originalScroll) < 2);
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
    await panel.getByRole('button', { name: '图片', exact: true }).click();
    assert.equal(await panel.locator('.media-card[data-kind="video"]:visible').count(), 0);
    assert(await panel.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await card.scrollIntoViewIfNeeded();
    if (width === 375) {
      const photo = await card.locator('.ib-photo').boundingBox();
      assert(photo.width >= 350 && photo.height >= 460, `phone photo is too small: ${JSON.stringify(photo)}`);
      assert(photo.width / 2 >= 48, 'both mobile photo halves must be usable touch targets');
      assert.equal(await card.locator('.ib-nav').count(), 0);
      await clickSide(card.locator('.ib-photo'), 'right');
      await panel.waitForFunction(() => document.querySelector('[data-motion-surface]').shadowRoot.querySelector('.ib-scene').dataset.index === '2');
      assert.equal(await card.locator('.delete-button').getAttribute('data-item'), 'post-2');
    }
    await panel.screenshot({ path: `${artifacts}/panel-${width}.png` });
  }
  await panel.getByRole('button', { name: '视频', exact: true }).click();
  assert.equal(await panel.locator('.media-card[data-kind="video"]:visible').count(), 1);
  await panel.getByRole('button', { name: '截图', exact: true }).click();
  assert.equal(await panel.locator('.photo-carousel-card[data-kind="screenshot"]:visible').count(), 2);

  // Both platforms share the viewer, but keep same-name targets and actions separate.
  includeTikTok = true;
  await panel.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  const tk = panel.locator('.target-block[data-platform="tiktok"]');
  await tk.waitFor();
  await navigate(panel, '/tiktok');
  assert(await panel.locator('#settings').isHidden());
  await panel.getByRole('button', { name: '图片', exact: true }).click();
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
  await navigate(panel, '/instagram');
  assert.equal(await tk.isVisible(), false);
  assert.equal(await panel.locator('.target-block[data-platform="instagram"]:visible').count(), 1);
  await navigate(panel, '/');
  assert.equal(await panel.locator('.target-block:visible').count(), 2);
  await navigate(panel, '/settings');
  assert(await panel.locator('#library').isHidden());
  assert.equal(await panel.locator('.settings-group[open]').count(), 0);
  await panel.locator('#platform-settings summary').click();
  await panel.locator('#settings-platform').selectOption('tiktok');
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
  await panel.getByRole('button', { name: '保存并连接', exact: true }).click();
  assert(requests.some(([method, path, body]) => method === 'POST' && path === '/api/config' && body.platform === 'tiktok' && body.login_method === 'cookie' && body.cookie === 'sessionid=fixture-session'));
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
  await panel.locator('#settings-platform').selectOption('instagram');
  assert.equal(await panel.locator('#ig-username').inputValue(), 'demo');
  assert(await panel.locator('#cookie-field').isHidden());
  await panel.reload();
  await panel.locator('#settings-platform').waitFor({ state: 'attached' });
  assert.equal(panel.url(), `${base}/settings`);
  assert(await panel.locator('#library').isHidden());
  assert.equal(await panel.locator('.settings-group[open]').count(), 0);
  await panel.screenshot({ path: `${artifacts}/settings-collapsed-desktop.png` });
  await panel.waitForFunction(() => document.querySelector('#ig-targets').value === 'demo');
  await panel.evaluate(() => document.querySelector('#ig-targets').value = '');
  await panel.getByRole('button', { name: '保存并连接', exact: true }).click();
  assert(await panel.locator('#targets-settings').evaluate(node => node.open));

  await navigate(panel, '/tiktok');
  await panel.getByRole('button', { name: '视频', exact: true }).click();
  await tk.locator('a[data-preview="video"]').click();
  await dialog.waitFor({ state: 'visible' });
  assert.equal(await dialog.locator('video').getAttribute('src'), '/files/video.mp4');
  assert(await dialog.locator('video').evaluate(node => node.controls && node.playsInline));
  await panel.waitForFunction(() => document.querySelector('#preview-message').textContent.includes('加载失败'));
  await panel.getByRole('button', { name: '关闭预览', exact: true }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await dialog.locator('video').count(), 0);
  await panel.getByRole('button', { name: '图片', exact: true }).click();
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
  await mobilePreview.close();
  assert.deepEqual(errors, []);
  console.log(`PASS: WebGL/2D ink masks, interruption, keyboard/touch, failure/races, visibility, reduced motion, context recovery, cleanup, gallery actions and 375/768/1440 layouts. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
  server.close();
}

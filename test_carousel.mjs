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
const fixture = () => ({
  config: { targets: ['demo'], username: 'demo', has_password: true, interval: 300, post_limit: 12 },
  status: { state: 'ready', checked_at: '2026-11-08T10:00:00Z' },
  library: [{ name: 'demo', status: { checked_at: `revision-${revision}` }, latest: '/photo/3.svg',
    items: Array.from({ length: 14 }, (_, i) => ({
      id: `post-${i}`, caption: `归档照片 ${i + 1}`, captured_at: '2026-11-08T10:00:00Z',
      source_url: `https://www.instagram.com/p/post-${i}/`,
      files: [{ name: 'media-01.jpg', kind: 'image', url: `/photo/${i % 4}.svg` },
        { name: 'page.png', kind: 'image', url: `/photo/${(i + 1) % 4}.svg` },
        ...(i === 0 ? [{ name: 'media-02.mp4', kind: 'video', url: '/video.mp4' }] : [])],
    })),
  }],
});
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/state') {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(fixture()));
    return;
  }
  if (url.pathname.startsWith('/api/')) {
    requests.push([req.method, url.pathname]);
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
    return;
  }
  if (/^\/photo\/\d\.svg$/.test(url.pathname)) {
    res.setHeader('Content-Type', 'image/svg+xml');
    res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="800"><path fill="${colors[Number(url.pathname[7])]}" d="M0 0h600v800H0z"/></svg>`);
    return;
  }
  if (url.pathname === '/component') {
    res.setHeader('Content-Type', 'text/html');
    res.end('<!doctype html><html lang="zh-CN"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Carousel test</title><style>body{margin:0;background:#eaeaea}#demo,#second{max-width:940px;margin:auto}</style><div id="demo"></div><div id="second"></div></html>');
    return;
  }
  try {
    const path = url.pathname === '/' ? '/static/index.html' : url.pathname;
    if (!path.startsWith('/static/') || path.includes('..')) throw new Error('Not found');
    res.setHeader('Content-Type', ({ '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html' })[extname(path)] || 'application/octet-stream');
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

try {
  const page = await open();
  await mount(page, { duration: 2400 });
  assert.equal(await page.locator('.ib-scene').getAttribute('data-renderer'), 'webgl');
  assert.equal(await page.locator('button button').count(), 0);
  const photo = page.locator('.ib-photo');
  await photo.click({ position: { x: 40, y: 45 } });
  await page.waitForFunction(() => Number(window.carousel.root.querySelector('.ib-scene').dataset.progress) > 0.22);
  assert(near(await pixel(page, .1, .1), [35, 93, 200]), 'press origin should reveal new photo');
  assert(near(await pixel(page, .9, .9), [210, 60, 65]), 'unrevealed corner must keep original colors');
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
    window.carousel.root.querySelector('.ib-nav--next').click();
  });
  const after = await pixel(page, .85, .85);
  assert(near(after, before), `interruption must not flash back: ${before} -> ${after}`);
  await page.locator('.ib-nav--prev').click();
  await done(page, 2);
  assert.deepEqual(await page.evaluate(() => window.changes), [2]);
  assert(await page.evaluate(() => window.savedCanvas === window.carousel.root.querySelector('canvas')));
  const left = await page.locator('.ib-scene').getAttribute('data-origin');
  await page.locator('.ib-nav--next').click();
  const right = await page.locator('.ib-scene').getAttribute('data-origin');
  assert.notEqual(left, right);
  await done(page, 3);

  await photo.focus();
  await page.keyboard.press('Home');
  await done(page, 0);
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
  await page.locator('.ib-nav--next').click();
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
    await page.locator('.ib-nav--next').focus();
    const measured = await page.locator('.ib-nav--next').evaluate(button => {
      const rect = button.getBoundingClientRect();
      const computed = getComputedStyle(button);
      return { target: rect.width * 72 / 64, outline: computed.outlineStyle, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert(measured.target >= 24 && measured.outline === 'solid' && !measured.overflow, JSON.stringify(measured));
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
  assert(near(await pixel(fallback, .1, .1), [35, 93, 200]));
  assert(near(await pixel(fallback, .9, .9), [210, 60, 65]));
  await fallback.screenshot({ path: `${artifacts}/fallback-touch.png` });
  await fallback.locator('.ib-nav--next').tap();
  await fallback.evaluate(() => window.carousel.update({ reducedMotion: true }));
  await done(fallback, 2);
  await fallback.close();

  const panel = await open();
  await panel.goto(base);
  await panel.locator('.photo-carousel-card').first().waitFor();
  assert.equal(await panel.locator('.photo-carousel-card[data-kind="image"]').count(), 2, 'all 14 images split into groups, none lost');
  assert.equal(await panel.locator('.photo-carousel-card[data-kind="screenshot"]').count(), 2);
  assert.equal(await panel.locator('.media-card[data-kind="video"] video').count(), 1);
  const card = panel.locator('.photo-carousel-card').first();
  await card.locator('.ib-scene[data-ready="true"]').waitFor();
  await card.locator('.ib-nav--next').click();
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
      const arrow = await card.locator('.ib-nav--next').boundingBox();
      assert(arrow.width >= 48, 'mobile arrow must keep a usable touch target');
      await card.locator('.ib-nav--next').click();
      await panel.waitForFunction(() => document.querySelector('[data-motion-surface]').shadowRoot.querySelector('.ib-scene').dataset.index === '2');
      assert.equal(await card.locator('.delete-button').getAttribute('data-item'), 'post-2');
    }
    await panel.screenshot({ path: `${artifacts}/panel-${width}.png` });
  }
  await panel.getByRole('button', { name: '视频', exact: true }).click();
  assert.equal(await panel.locator('.media-card[data-kind="video"]:visible').count(), 1);
  await panel.getByRole('button', { name: '截图', exact: true }).click();
  assert.equal(await panel.locator('.photo-carousel-card[data-kind="screenshot"]:visible').count(), 2);
  await panel.close();
  assert.deepEqual(errors, []);
  console.log(`PASS: WebGL/2D ink masks, interruption, keyboard/touch, failure/races, visibility, reduced motion, context recovery, cleanup, gallery actions and 375/768/1440 layouts. Screenshots: ${artifacts}`);
} finally {
  await browser.close();
  server.close();
}

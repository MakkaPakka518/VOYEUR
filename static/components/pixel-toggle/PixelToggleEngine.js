// src/lib/motion-core/pixel-toggle.mjs
import { createSurface } from "./motion-runtime.js";

// LeiBox native source, adapted to a compact ig luv header control.
// Design reference: https://x.com/kaolti/status/2119151022014894260

// src/lib/motion-core/pixel-toggle-paint.mjs
var TRACK_WIDTH = 520;
var TRACK_HEIGHT = 272;
var KNOB_SIZE = 240;
var INSET = 16;
var TRAVEL = 248;
var MARGIN = 72;
var RADIUS = 66;
var TURN = Math.PI * 2;
var clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
var mix = (from, to, fraction) => from + (to - from) * fraction;
var wrap = (value, period) => (value % period + period) % period;
var parseColor = (color) => color.match(/../g).map((channel) => parseInt(channel, 16));
var blend = (a, b, time) => a.map((channel, index) => Math.round(mix(channel, b[index], time)));
var rgba = (color, alpha2 = 1) => `rgba(${color.join(",")},${alpha2})`;
var palette = {
  background: ["151516", "d9d9d7"],
  halo: ["202138", "f3e2c2"],
  focus: ["d6d6ff", "5d3609"],
  "track-top": ["040508", "e2e0dc"],
  "track-bottom": ["0b0c12", "eeece8"],
  "track-inset": ["000000", "b9b5ae"],
  "track-light": ["191a22", "ffffff"],
  "track-edge": ["1e1f27", "ffffff"],
  "track-shadow": ["000000", "9c978d"],
  "knob-top": ["9a9fbd", "ffffff"],
  "knob-bottom": ["4a4d63", "f2efe9"],
  "knob-rim": ["ffffff", "ffffff"],
  "knob-shadow": ["000000", "8a8378"]
};
var alpha = { "knob-top": [0.5, 0.94], "knob-bottom": [0.42, 0.88], "knob-rim": [0.27, 0.62], "knob-shadow": [0.44, 0.35] };
var sceneColors = Object.entries(palette).map(([name, colors]) => ({ name, night: parseColor(colors[0]), day: parseColor(colors[1]) }));
var lightColors = [
  [[112, 110, 255], [224, 225, 255]],
  [[255, 205, 222], [255, 246, 248]],
  [[255, 168, 18], [255, 232, 150]]
];
function makeMoon() {
  const pixels = [];
  for (let row = -7; row <= 7; row++) {
    for (let col = -7; col <= 7; col++) {
      if (Math.hypot(col + 0.9, row + 0.7) > 6) continue;
      const cut = Math.hypot(col - 1.8, row + 2.7);
      if (cut > 4.6) pixels.push([col - 0.4, row, 1]);
      else if ((col + row) % 2 === 0 || cut > 3.6) pixels.push([col - 0.4, row, 0.12 + 0.4 * (1 - cut / 4.6)]);
    }
  }
  return pixels.concat([[5, -6, 1], [4, -6, 0.7], [6, -6, 0.7], [5, -7, 0.7], [5, -5, 0.7], [3, -4, 0.35], [7, -3, 0.3], [2, -7, 0.3], [7, -7, 0.25]]);
}
function makeSun() {
  const pixels = [];
  for (let row = -4; row <= 3; row++) {
    for (let col = -4; col <= 3; col++) {
      if ((col + 0.5) ** 2 + (row + 0.5) ** 2 <= 17.2) pixels.push([col, row, 1]);
    }
  }
  for (let ray = 0; ray < 8; ray++) {
    const angle = ray * Math.PI / 4;
    const distances = ray % 2 ? [6.1, 7.2] : [6.7, 7.7, 8.7];
    distances.forEach((distance, index) => {
      pixels.push([Math.round(Math.cos(angle) * distance - 0.5), Math.round(Math.sin(angle) * distance - 0.5), ray % 2 && index ? 0.6 : 0.78]);
    });
  }
  return pixels;
}
var glyphs = [{ pixels: makeMoon(), size: 8.4, ratio: 1.18 }, { pixels: makeSun(), size: 7.2, ratio: 1 }];
var particleCount = Math.max(...glyphs.map((glyph) => glyph.pixels.length)) + 20;
function createPixelParticles() {
  let glyph = 0;
  const dots = Array.from({ length: particleCount }, () => {
    const angle = Math.random() * TURN;
    const distance = Math.sqrt(Math.random()) * 74;
    return {
      scatterX: Math.cos(angle) * distance,
      scatterY: Math.sin(angle) * distance * 0.85,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      tx: 0,
      ty: 0,
      opacity: 0,
      targetOpacity: 0,
      phase: Math.random() * TURN
    };
  });
  function assign(index, immediate) {
    glyph = index;
    const { pixels, size } = glyphs[index];
    const targets = [...pixels];
    for (let i = targets.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [targets[i], targets[j]] = [targets[j], targets[i]];
    }
    dots.forEach((dot, i) => {
      const target = targets[i];
      dot.tx = target ? target[0] * size : dot.scatterX;
      dot.ty = target ? target[1] * size : dot.scatterY;
      dot.targetOpacity = target?.[2] ?? 0;
      if (immediate) {
        dot.x = dot.tx;
        dot.y = dot.ty;
        dot.opacity = dot.targetOpacity;
        dot.vx = dot.vy = 0;
      }
    });
  }
  function burst(strength) {
    for (const dot of dots) {
      const angle = Math.random() * TURN;
      const speed = (60 + Math.random() * 200) * strength;
      dot.vx += Math.cos(angle) * speed;
      dot.vy += Math.sin(angle) * speed;
    }
  }
  function advance(theme, agitation, pointer, center, dt) {
    const nextGlyph = theme > 0.5 ? 1 : 0;
    if (nextGlyph !== glyph) assign(nextGlyph, false);
    const scatter = Math.max(agitation, clamp(1 - Math.abs(2 * theme - 1) * 1.6));
    let moving = false;
    for (const dot of dots) {
      dot.phase += dt * 2;
      const tx = mix(dot.tx, dot.scatterX, scatter) + Math.sin(dot.phase) * scatter * 6;
      const ty = mix(dot.ty, dot.scatterY, scatter) + Math.cos(dot.phase * 0.82) * scatter * 6;
      dot.vx += ((tx - dot.x) * 340 - dot.vx * 27) * dt;
      dot.vy += ((ty - dot.y) * 340 - dot.vy * 27) * dt;
      if (pointer) {
        const dx = dot.x - (pointer.x - center.x), dy = dot.y - (pointer.y - center.y);
        const distance = Math.hypot(dx, dy);
        if (distance > 0 && distance < 49) {
          const force = (1 - (distance / 49) ** 2) * 2800 * dt / distance;
          dot.vx += dx * force;
          dot.vy += dy * force;
        }
      }
      dot.x += dot.vx * dt;
      dot.y += dot.vy * dt;
      const opacity = Math.max(dot.targetOpacity * (1 - scatter * 0.25), scatter * 0.55);
      dot.opacity = mix(dot.opacity, opacity, Math.min(1, dt * (opacity > dot.opacity ? 9 : 12)));
      moving || (moving = Math.abs(tx - dot.x) + Math.abs(ty - dot.y) > 0.15 || Math.abs(dot.vx) + Math.abs(dot.vy) > 0.8 || Math.abs(opacity - dot.opacity) > 5e-3);
    }
    return { scatter, moving };
  }
  function draw(ctx, center, theme, scatter) {
    const { size, ratio } = glyphs[glyph];
    const color = blend([255, 255, 255], [60, 56, 53], theme);
    ctx.shadowColor = "#e1e4ff";
    for (const dot of dots) {
      if (dot.opacity < 0.02) continue;
      const speed = clamp(Math.hypot(dot.vx, dot.vy) / 420);
      const height = size * 0.82 * (1 - speed * 0.35) * (1 - scatter * 0.35);
      const width = height * (1 + (ratio - 1) * (1 - speed) * (1 - scatter));
      ctx.shadowBlur = dot.targetOpacity > 0.9 ? Math.max(0, (1 - 2 * theme) * 6) : 0;
      ctx.fillStyle = rgba(color, dot.opacity * (1 - speed * 0.2));
      ctx.fillRect(center.x + dot.x - width / 2, center.y + dot.y - height / 2, width, height);
    }
  }
  return { assign, advance, draw, burst };
}
function roundedOutline({ x, y, width, height }, radius) {
  const right = x + width, bottom = y + height, cx = x + width / 2, cy = y + height / 2;
  const r = Math.min(radius, width / 2, height / 2);
  const corner = Math.PI * r / 2;
  const horizontal = width - 2 * r, vertical = height - 2 * r;
  const perimeter = 2 * (horizontal + vertical) + 4 * corner;
  const quarter = horizontal / 2 + corner + vertical / 2;
  const opposite = horizontal + 2 * corner + vertical;
  const segments = [];
  let end = 0;
  const line = (sx, sy, tx, ty) => {
    const length = Math.hypot(tx - sx, ty - sy);
    if (length) {
      end += length;
      segments.push({ end, length, point: (t) => [mix(sx, tx, t), mix(sy, ty, t)] });
    }
  };
  const curve = (ox, oy, start) => {
    end += corner;
    segments.push({ end, length: corner, point: (t) => {
      const angle = start + t * Math.PI / 2;
      return [ox + Math.cos(angle) * r, oy + Math.sin(angle) * r];
    } });
  };
  line(cx, y, right - r, y);
  curve(right - r, y + r, -Math.PI / 2);
  line(right, y + r, right, bottom - r);
  curve(right - r, bottom - r, 0);
  line(right - r, bottom, x + r, bottom);
  curve(x + r, bottom - r, Math.PI / 2);
  line(x, bottom - r, x, y + r);
  curve(x + r, y + r, Math.PI);
  line(x + r, y, cx, y);
  const point = (distance) => {
    const at = wrap(distance, perimeter);
    const segment = segments.find((item) => at <= item.end) ?? segments.at(-1);
    return segment.point(1 - (segment.end - at) / segment.length);
  };
  const phaseDistance = (phase) => {
    const turn = wrap(phase, 1) * 4;
    const side = Math.floor(turn);
    const sides = [opposite, quarter, 0, quarter + opposite, opposite];
    return mix(side === 2 ? perimeter : sides[side], sides[side + 1], turn - side);
  };
  return { point, phaseDistance, perimeter, center: { x: cx, y: cy } };
}
function sampleRibbon(outline, distance, length) {
  return Array.from({ length: 49 }, (_, i) => {
    const fraction = i / 48;
    const at = distance + (fraction - 0.5) * length;
    const [x, y] = outline.point(at);
    const [ax, ay] = outline.point(at - 1);
    const [bx, by] = outline.point(at + 1);
    const span = Math.hypot(bx - ax, by - ay) || 1;
    return { x, y, nx: (by - ay) / span, ny: (ax - bx) / span, taper: Math.sin(Math.PI * fraction) };
  });
}
function paintRibbon(ctx, samples, { width, exponent, offset = 0, color, opacity = 1, blur = 0 }) {
  const shape = new Path2D();
  const outline = (point, side) => {
    const spread = offset + side * width / 2 * point.taper ** exponent;
    return [point.x + point.nx * spread, point.y + point.ny * spread];
  };
  shape.moveTo(...outline(samples[0], 1));
  for (const sample of samples) shape.lineTo(...outline(sample, 1));
  for (let i = samples.length - 1; i >= 0; i--) shape.lineTo(...outline(samples[i], -1));
  shape.closePath();
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.fillStyle = rgba(color);
  if (blur && "filter" in ctx) ctx.filter = `blur(${blur}px)`;
  else if (blur) {
    ctx.shadowBlur = blur * 2;
    ctx.shadowColor = ctx.fillStyle;
  }
  ctx.fill(shape);
  ctx.restore();
}
function createPixelPainter(scene, knob, canvas, dpr) {
  const ctx = canvas.getContext("2d");
  canvas.width = Math.round((TRACK_WIDTH + 2 * MARGIN) * dpr);
  canvas.height = Math.round((TRACK_HEIGHT + 2 * MARGIN) * dpr);
  let previousTheme;
  return function paint(box, theme, phase, transit, dots, scatter) {
    if (theme !== previousTheme) {
      for (const { name, night: night2, day } of sceneColors) {
        const opacity = alpha[name];
        scene.style.setProperty(`--${name}`, rgba(blend(night2, day, theme), opacity ? mix(...opacity, theme) : 1));
      }
      previousTheme = theme;
    }
    Object.assign(knob.style, { left: `${box.x}px`, top: `${box.y}px`, width: `${box.width}px`, height: `${box.height}px` });
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, dpr * MARGIN, dpr * MARGIN);
    ctx.clearRect(-MARGIN, -MARGIN, TRACK_WIDTH + 2 * MARGIN, TRACK_HEIGHT + 2 * MARGIN);
    const padding = 13;
    const outside = roundedOutline({
      x: box.x - padding,
      y: box.y - padding,
      width: box.width + 2 * padding,
      height: box.height + 2 * padding
    }, RADIUS + padding);
    const inside = roundedOutline(box, RADIUS);
    const arcFraction = mix(0.31, 0.33, theme) * (1 - 0.12 * Math.sin(TURN * wrap(phase, 0.5)));
    const outer = sampleRibbon(outside, outside.phaseDistance(phase), outside.perimeter * arcFraction);
    const inner = sampleRibbon(inside, inside.phaseDistance(phase), inside.perimeter * arcFraction * 1.25);
    const family = theme < 0.5 ? 0 : 1;
    const [wash, core] = lightColors[family].map((color, index) => blend(color, lightColors[family + 1][index], theme * 2 - family));
    const bright = blend(core, [255, 255, 255], mix(0.8, 0.04, theme));
    const body = blend(wash, core, 0.54);
    const night = theme < 0.55;
    ctx.globalCompositeOperation = night ? "lighter" : "source-over";
    paintRibbon(ctx, outer, { width: 64, exponent: 0.5, offset: 16, color: wash, blur: 25, opacity: mix(0.86, 0.54, theme) });
    paintRibbon(ctx, outer, { width: 18, exponent: 0.6, offset: 4, color: wash, blur: 8, opacity: 0.74 });
    paintRibbon(ctx, outer, { width: 9, exponent: 0.75, color: body, blur: 2, opacity: 0.94 });
    paintRibbon(ctx, outer, { width: 5.6, exponent: 0.9, color: bright, blur: 0.5 });
    ctx.globalCompositeOperation = "source-over";
    const clip = new Path2D();
    clip.roundRect(box.x, box.y, box.width, box.height, RADIUS);
    ctx.save();
    ctx.clip(clip);
    const edge = inner[24];
    const depth = KNOB_SIZE * mix(0.57, 0.7, theme) * (1 + transit * 0.3);
    ctx.save();
    ctx.translate(edge.x, edge.y);
    ctx.rotate(Math.atan2(edge.nx, -edge.ny));
    ctx.scale(KNOB_SIZE * 0.84, depth * 0.62);
    const oriented = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    oriented.addColorStop(0, rgba(bright, mix(0.91, 0.84, theme)));
    oriented.addColorStop(0.23, rgba(wash, mix(0.9, 0.52, theme)));
    oriented.addColorStop(0.56, rgba(wash, mix(0.46, 0.23, theme)));
    oriented.addColorStop(1, rgba(wash, 0));
    ctx.fillStyle = oriented;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
    paintRibbon(ctx, inner, { width: 22, exponent: 0.5, color: night ? bright : body, blur: 8, opacity: 0.76 - transit * 0.35 });
    paintRibbon(ctx, inner, { width: 8, exponent: 0.6, color: bright, blur: 2, opacity: 0.92 });
    dots.draw(ctx, inside.center, theme, scatter);
    ctx.restore();
  };
}
function knobGeometry(position, stretch) {
  let width = KNOB_SIZE * (1 + Math.max(-0.08, stretch));
  let x = INSET + position * TRAVEL - (width - KNOB_SIZE) / 2;
  if (x < INSET) {
    width -= INSET - x;
    x = INSET;
  }
  const right = TRACK_WIDTH - INSET;
  x = Math.min(x, right - KNOB_SIZE * 0.86);
  width = clamp(width, KNOB_SIZE * 0.86, right - x);
  const height = KNOB_SIZE * (1 - (width / KNOB_SIZE - 1) * 0.45);
  return { x, y: (TRACK_HEIGHT - height) / 2, width, height };
}

// src/lib/motion-core/pixel-toggle.mjs
var DAY_ANGLE = 0.46;
var restAngle = (checked) => checked ? DAY_ANGLE : 0;
var smooth = (progress) => progress * progress * (3 - 2 * progress);
var easeOut = (progress) => 1 - (1 - progress) ** 3;
function createPixelToggle(host, initial, css2, preview = false) {
  const scope = createSurface(host, {
    width: 572,
    height: 320,
    css: css2,
    markup: `<div class="pixel-scene"><button class="pixel-switch" type="button" role="switch" aria-label="切换日夜主题"><span class="pixel-knob" aria-hidden="true"></span><canvas class="pixel-effects" aria-hidden="true"></canvas></button></div>`
  }, initial);
  const { root, on, requestAnimationFrame, cancelAnimationFrame, reduced } = scope;
  const scene = root.querySelector(".pixel-scene");
  const control = root.querySelector(".pixel-switch");
  const owner = host.ownerDocument;
  const browser = owner.defaultView;
  if (preview) scene.dataset.preview = "";
  const pixelRatio = Math.min(preview ? 1 : 1.5, browser.devicePixelRatio || 1);
  const paint = createPixelPainter(scene, root.querySelector(".pixel-knob"), root.querySelector("canvas"), pixelRatio);
  const particles = createPixelParticles();
  let options = { sound: true, ...initial };
  let checked = Boolean(options.checked);
  let position = Number(checked), theme = position, phase = restAngle(checked);
  let speed = 0, stretch = 0, stretchSpeed = 0, agitation = 0;
  let colorMove, lightMove, drag, pointer;
  let frame = 0, lastTime = 0, audio, suppressClick = false, destroyed = false;
  function render(box = knobGeometry(position, stretch), scatter = 0, transit = 0) {
    paint(box, clamp(theme), phase, transit, particles, scatter);
  }
  function stop() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
  }
  function snap() {
    stop();
    position = theme = Number(checked);
    phase = restAngle(checked);
    speed = stretch = stretchSpeed = agitation = 0;
    colorMove = lightMove = void 0;
    particles.assign(position, true);
    render();
  }
  function requestFrame() {
    if (!frame && !owner.hidden && !reduced()) frame = requestAnimationFrame(tick);
  }
  function tick(now) {
    frame = 0;
    const dt = lastTime ? clamp((now - lastTime) / 1e3, 1e-3, 0.033) : 1 / 60;
    lastTime = now;
    let transit = 0;
    if (drag?.active) {
      const positionTheme = 1 / (1 + Math.exp(-(position - 0.5) / 0.07));
      theme = mix(theme, positionTheme, 1 - Math.exp(-dt * 14));
      phase = mix(phase, drag.base + clamp(position) * DAY_ANGLE, 1 - Math.exp(-dt * 18));
      speed *= Math.exp(-dt * 16);
      transit = 0.5;
    } else {
      if (colorMove) {
        const p = clamp((now - colorMove.start) / colorMove.duration);
        theme = mix(colorMove.from, Number(checked), smooth(p));
        if (p === 1) colorMove = void 0;
      }
      if (lightMove) {
        const p = clamp((now - lightMove.start) / lightMove.duration);
        phase = mix(lightMove.from, lightMove.to, easeOut(p));
        transit = Math.min(1, p * 8) * (1 - p) ** 2.2;
        if (p === 1) lightMove = void 0;
      }
      const dtSmall = dt / 4;
      for (let i = 0; i < 4; i++) {
        speed += ((Number(checked) - position) * 380 - speed * 26.5) * dtSmall;
        position += speed * dtSmall;
      }
      if (Math.abs(position - Number(checked)) < 1e-4 && Math.abs(speed) < 1e-3) {
        position = Number(checked);
        speed = 0;
      }
    }
    const stretchGoal = Math.min(0.16, Math.abs(speed) * TRAVEL / 2600 * 0.16);
    stretchSpeed += ((stretchGoal - stretch) * 520 - stretchSpeed * 30) * dt;
    stretch += stretchSpeed * dt;
    if (!stretchGoal && Math.abs(stretch) < 1e-4 && Math.abs(stretchSpeed) < 1e-3) stretch = stretchSpeed = 0;
    agitation = Math.max(drag && !drag.active ? 0.3 : 0, agitation - dt * 7);
    const box = knobGeometry(position, stretch);
    const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    const livePointer = pointer && now - pointer.at < 160 ? pointer : void 0;
    const { scatter, moving } = particles.advance(clamp(theme), agitation, livePointer, center, dt);
    render(box, scatter, transit);
    if (moving || agitation || position !== Number(checked) || stretch || colorMove || lightMove || drag?.active) requestFrame();
    else lastTime = 0;
  }
  function playClick() {
    if (!options.sound || !browser.AudioContext) return;
    try {
      audio ?? (audio = new browser.AudioContext());
      if (audio.state === "suspended") void audio.resume().catch(() => {
      });
      const tone = audio.createOscillator();
      const volume = audio.createGain();
      const start = audio.currentTime;
      tone.type = "triangle";
      tone.frequency.setValueAtTime(checked ? 1500 : 900, start);
      tone.frequency.exponentialRampToValueAtTime(checked ? 2300 : 480, start + 0.06);
      volume.gain.setValueAtTime(1e-4, start);
      volume.gain.exponentialRampToValueAtTime(0.1, start + 5e-3);
      volume.gain.exponentialRampToValueAtTime(1e-4, start + 0.09);
      tone.connect(volume).connect(audio.destination);
      tone.onended = () => {
        tone.disconnect();
        volume.disconnect();
      };
      tone.start(start);
      tone.stop(start + 0.1);
    } catch {
    }
  }
  function change(next, trigger, trusted = false) {
    const changed = next !== checked;
    checked = next;
    control.setAttribute("aria-checked", String(checked));
    if (reduced() || owner.hidden) snap();
    else {
      const now = browser.performance.now();
      const clicking = trigger === "click";
      const rest = restAngle(checked);
      const finalPhase = clicking ? Math.ceil(phase + 0.1 - rest) + rest : Math.round(phase - rest) + rest;
      colorMove = { from: theme, start: now, duration: clicking ? checked ? 100 : 70 : 140 };
      lightMove = { from: phase, to: finalPhase, start: now + (clicking ? 10 : 0), duration: clicking ? 900 : 700 };
      if (clicking) {
        agitation = 0.8;
        particles.burst(1.1);
      }
      requestFrame();
    }
    if (changed && trigger !== "update" && trigger !== "cancel") {
      if (trusted) playClick();
      options.onCheckedChange?.(checked);
    }
  }
  function point(event) {
    const rect = control.getBoundingClientRect();
    const scale = rect.width / TRACK_WIDTH;
    return { x: (event.clientX - rect.left) / scale, y: (event.clientY - rect.top) / scale };
  }
  on(control, "pointerdown", (event) => {
    if (!event.isPrimary || event.button !== 0 || drag) return;
    const local = point(event);
    drag = {
      id: event.pointerId,
      startX: local.x,
      startPosition: position,
      x: local.x,
      at: browser.performance.now(),
      velocity: 0,
      active: false,
      base: 0
    };
    suppressClick = false;
    control.setPointerCapture(event.pointerId);
    if (!reduced()) {
      agitation = 0.3;
      particles.burst(0.35);
      requestFrame();
    }
  });
  on(control, "pointermove", (event) => {
    if (drag && event.pointerId !== drag.id) return;
    const local = point(event);
    pointer = event.pointerType === "touch" && !drag ? void 0 : { ...local, at: browser.performance.now() };
    if (drag) {
      const delta = local.x - drag.startX;
      if (!drag.active && Math.abs(delta) > 3) {
        drag.active = true;
        drag.base = Math.round(phase - position * DAY_ANGLE);
        control.dataset.dragging = "";
        colorMove = lightMove = void 0;
      }
      if (drag.active) {
        const raw = drag.startPosition + delta / TRAVEL;
        const next = raw < 0 ? -((-raw) ** 0.6) * 0.05 : raw > 1 ? 1 + (raw - 1) ** 0.6 * 0.05 : raw;
        const now = browser.performance.now();
        const elapsed = Math.max(1, now - drag.at);
        drag.velocity = mix(drag.velocity, (local.x - drag.x) / elapsed, 0.5);
        speed = mix(speed, (next - position) * 1e3 / elapsed, 0.5);
        drag.x = local.x;
        drag.at = now;
        position = next;
        agitation = Math.max(agitation, clamp(Math.abs(drag.velocity) * 1.6) * 0.9);
        if (reduced()) {
          theme = Number(next >= 0.5);
          phase = drag.base + clamp(next) * DAY_ANGLE;
          particles.assign(theme, true);
          render();
        }
      }
    }
    requestFrame();
  });
  on(control, "pointerleave", () => {
    pointer = void 0;
    requestFrame();
  });
  function finishDrag(event) {
    if (!drag || event.pointerId !== drag.id) return;
    const completed = event.type === "pointerup";
    const { active, velocity, at } = drag;
    drag = void 0;
    if (event.pointerType === "touch" || !completed) pointer = void 0;
    delete control.dataset.dragging;
    if (!active) return;
    suppressClick = true;
    const fling = browser.performance.now() - at <= 120 && Math.abs(velocity) > 0.6;
    const next = completed ? fling ? velocity > 0 : position >= 0.5 : checked;
    change(next, completed ? "drag" : "cancel", event.isTrusted);
  }
  on(control, "pointerup", finishDrag);
  on(control, "pointercancel", finishDrag);
  on(control, "lostpointercapture", finishDrag);
  on(control, "click", (event) => {
    if (event.detail && suppressClick) return;
    change(!checked, "click", event.isTrusted);
  });
  on(owner, "visibilitychange", () => {
    if (!owner.hidden) return;
    drag = pointer = void 0;
    delete control.dataset.dragging;
    snap();
  });
  on(browser.matchMedia("(prefers-reduced-motion: reduce)"), "change", () => {
    if (reduced()) snap();
  });
  scope.addCleanup(() => {
    if (audio) void audio.close().catch(() => {
    });
  });
  control.setAttribute("aria-checked", String(checked));
  snap();
  return {
    ...scope.controller,
    update(next) {
      if (destroyed) return;
      options = { ...options, ...next };
      scope.controller.update(next);
      if (typeof next.checked === "boolean" && next.checked !== checked) {
        if (drag && control.hasPointerCapture(drag.id)) {
          suppressClick = true;
          control.releasePointerCapture(drag.id);
        }
        drag = pointer = void 0;
        delete control.dataset.dragging;
        change(next.checked, "update");
      } else if (reduced() && !drag) snap();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stop();
      scope.controller.destroy();
    }
  };
}

// src/lib/motion-core/pixel-toggle-entry.js
var css = ".pixel-scene {\r\n  position: relative;\r\n  display: grid;\r\n  min-height: var(--motion-height, 540px);\r\n  place-items: center;\r\n  isolation: isolate;\r\n  overflow: hidden;\r\n  background: radial-gradient(640px 460px at 50% 48%, var(--halo), transparent 72%),\r\n    linear-gradient(180deg, transparent, #00000012), var(--background);\r\n}\r\n\r\n.pixel-scene[data-preview] { background: #f4f4f4; }\r\n\r\n.pixel-switch {\r\n  position: relative;\r\n  width: 520px;\r\n  height: 272px;\r\n  padding: 0;\r\n  border: 0;\r\n  border-radius: 82px;\r\n  background: linear-gradient(180deg, var(--track-top), var(--track-bottom));\r\n  box-shadow: inset 0 12px 24px var(--track-inset), inset 0 -2px 4px var(--track-light),\r\n    0 1.5px 0 var(--track-edge), 0 26px 46px -20px var(--track-shadow);\r\n  transform: scale(.58);\r\n  outline-offset: 8px;\r\n  cursor: grab;\r\n  touch-action: pan-y;\r\n  user-select: none;\r\n  -webkit-tap-highlight-color: transparent;\r\n}\r\n\r\n.pixel-switch[data-dragging] { cursor: grabbing; }\r\n.pixel-switch:focus-visible { outline: 2px solid var(--focus); }\r\n.pixel-switch > * { pointer-events: none; }\r\n\r\n.pixel-knob {\r\n  position: absolute;\r\n  display: block;\r\n  border-radius: 66px;\r\n  background: linear-gradient(180deg, var(--knob-top), var(--knob-bottom));\r\n  box-shadow: inset 0 0 0 1px var(--knob-rim), inset 0 0 5px #ffffff2e,\r\n    0 16px 22px -9px var(--knob-shadow), 0 4px 9px var(--knob-shadow);\r\n}\r\n\r\n.pixel-effects {\r\n  position: absolute;\r\n  display: block;\r\n  width: 664px;\r\n  height: 416px;\r\n  left: -72px;\r\n  top: -72px;\r\n}\r\n";
function mountPixelToggle(host, options = {}) {
  const compactCss = css
    .replace("var(--motion-height, 540px)", "var(--motion-height, 320px)")
    .replace("transform: scale(.58);", "transform: none;")
    + ".pixel-scene{background:transparent!important}";
  return createPixelToggle(host, options, compactCss);
}
export {
  mountPixelToggle
};

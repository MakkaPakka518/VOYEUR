# Ink Spread Carousel

Vendored from [LeiBox](https://leibox.pantoria.cn/docs/animations/ink-spread-carousel).
Design reference: [Lorenzo Cabra](https://x.com/cabralorenzo/status/2114082220566860026/video/1).
The included source is LeiBox's independent reconstruction, not the paid reference implementation.
Lucide/Feather notices and the inline default artwork are retained in the engine.

The ig luv page uses the browser-native entry directly, with no build step or npm runtime dependencies:

```js
import { mountInkSpreadCarousel } from './InkSpreadCarouselEngine.js';

const carousel = mountInkSpreadCarousel(document.querySelector('#photos'), {
  images: [{ src: '/files/example.jpg', alt: '归档图片' }, '/files/another.jpg'],
  onIndexChange(index) { console.log(index); },
});
carousel.update({ duration: 1200, roughness: 0.6, reducedMotion: false });
carousel.destroy();
```

Defaults: `index: 0`, `duration: 900` (250–2400ms), `roughness: 0.6` (0–1),
`height: 876` (minimum 620), `reducedMotion: undefined` (system preference).
Omit `images` for the embedded four-photo demonstration; there are no remote assets.
The panel accepts 1–12 photos per instance, showing a static card for a single photo.
Custom photos are center-cropped without distortion; cross-origin sources require CORS.
Image replacements are atomic, and a failure leaves the existing photos available.
Click the left half for the previous photo or the right half for the next;
the ink reveal starts at the exact press location. There are no overlaid arrow buttons.
Left/Right, Home and End remain available; Enter or Space advances from the center.

The panel's phone layout overrides `--motion-scene-width: 453.333` and
`--motion-scene-height: 620`, removes outer margins, and renders a roughly
353×464px photo at a 375px viewport. Other viewport sizes retain the original scene layout.

Integration changes: native ES module lifecycle, Chinese controls, decoded image cache cleanup,
single-image support, center cropping, exact click coordinates, interruption shadows, and
preserved external-index callback semantics. The TypeScript entry remains available for bundlers;
the shipped `motion-runtime.js` is the runtime used by the engine.

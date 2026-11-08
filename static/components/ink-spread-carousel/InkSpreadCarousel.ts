import { mountInkSpreadCarousel, type InkSpreadCarouselOptions } from "./InkSpreadCarouselEngine.js";
import type { MotionController } from "./motion-runtime";

/** Mount into any DOM node. Call update() for options and destroy() on removal. */
export function mount(target: HTMLElement, options: InkSpreadCarouselOptions = {}): ReturnType<typeof mountInkSpreadCarousel> {
  return mountInkSpreadCarousel(target, options);
}
export type { InkSpreadCarouselOptions };

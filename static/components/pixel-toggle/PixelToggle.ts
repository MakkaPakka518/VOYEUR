import { mountPixelToggle, type PixelToggleOptions } from "./PixelToggleEngine.js";
import type { MotionController } from "./motion-runtime";

/** Mount into any DOM node. Call update() for options and destroy() on removal. */
export function mount(target: HTMLElement, options: PixelToggleOptions = {}): ReturnType<typeof mountPixelToggle> {
  return mountPixelToggle(target, options);
}
export type { PixelToggleOptions };

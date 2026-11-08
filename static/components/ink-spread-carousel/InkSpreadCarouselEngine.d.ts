import type { MotionOptions, MotionController } from "./motion-runtime";
export type InkSpreadCarouselOptions = MotionOptions & { index?: number; duration?: number; roughness?: number; images?: (string | { src: string; alt?: string })[]; onIndexChange?: (index: number) => void };
export function mountInkSpreadCarousel(target: HTMLElement, options?: InkSpreadCarouselOptions): Omit<MotionController, "update"> & { update(options: InkSpreadCarouselOptions): void };

/** Typed equivalent of the compact native lifecycle in motion-runtime.js. */
export interface MotionOptions { height?: number; reducedMotion?: boolean }
export interface MotionController {
  element: HTMLElement;
  root: ShadowRoot;
  update(options: MotionOptions): void;
  destroy(): void;
}
export interface SurfaceConfig { markup: string; css: string; width: number; height: number }

export declare function createSurface(target: HTMLElement, config: SurfaceConfig, initial?: MotionOptions): MotionController & {
  body: HTMLElement;
  frame: HTMLElement;
  document: Document;
  window: Window;
  controller: MotionController;
  reduced(): boolean;
  on(node: EventTarget, type: string, listener: EventListener, settings?: AddEventListenerOptions): void;
  requestAnimationFrame(callback: FrameRequestCallback): number;
  cancelAnimationFrame(id: number): void;
  addCleanup(cleanup: () => void): void;
};

import '@testing-library/jest-dom';

// jsdom has no ResizeObserver; the canvases only use it to track their size.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= ResizeObserverStub;

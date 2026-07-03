import { describe, it, expect, vi } from 'vitest';
import { KeyboardRouter, isTextTarget, isUndoRedoCombo, type CanvasKeyApi } from './router';

const key = (over: Partial<KeyboardEvent> = {}): KeyboardEvent =>
  ({
    key: 'Escape',
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    altKey: false,
    target: null,
    preventDefault: vi.fn(),
    ...over,
  }) as unknown as KeyboardEvent;

function canvasApi(over: Partial<CanvasKeyApi> = {}): CanvasKeyApi {
  return {
    cancelActiveGesture: vi.fn(),
    hasActiveGesture: vi.fn(() => false),
    handleKey: vi.fn(() => false),
    handleKeyUp: vi.fn(),
    ...over,
  };
}

describe('routing order: text → overlays → gesture-cancel → canvas → app', () => {
  it('steps aside entirely for text targets (incl. SELECT — the audited gap)', () => {
    const r = new KeyboardRouter();
    const app = vi.fn(() => true);
    r.registerApp(app);
    for (const tag of ['input', 'textarea', 'select']) {
      const el = document.createElement(tag);
      r.handleKeyDown(key({ key: 'z', metaKey: true, target: el as unknown as EventTarget }));
    }
    expect(app).not.toHaveBeenCalled();
  });

  it('overlays run innermost-first and consume', () => {
    const r = new KeyboardRouter();
    const order: string[] = [];
    r.registerOverlay(() => (order.push('outer'), false));
    r.registerOverlay(() => (order.push('inner'), true));
    const canvas = canvasApi({ hasActiveGesture: vi.fn(() => true) });
    r.registerCanvas('flat', canvas);
    r.handleKeyDown(key());
    expect(order).toEqual(['inner']); // consumed before outer AND before gesture-cancel
    expect(canvas.cancelActiveGesture).not.toHaveBeenCalled();
  });

  it('Escape with a gesture in flight cancels the gesture only', () => {
    const r = new KeyboardRouter();
    const canvas = canvasApi({ hasActiveGesture: vi.fn(() => true) });
    r.registerCanvas('flat', canvas);
    const app = vi.fn(() => true);
    r.registerApp(app);
    const e = key();
    r.handleKeyDown(e);
    expect(canvas.cancelActiveGesture).toHaveBeenCalledOnce();
    expect(canvas.handleKey).not.toHaveBeenCalled();
    expect(app).not.toHaveBeenCalled();
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('falls through to canvas then app when idle', () => {
    const r = new KeyboardRouter();
    const canvas = canvasApi();
    r.registerCanvas('flat', canvas);
    const app = vi.fn(() => true);
    r.registerApp(app);
    r.handleKeyDown(key({ key: 's', metaKey: true }));
    expect(canvas.handleKey).toHaveBeenCalledOnce();
    expect(app).toHaveBeenCalledOnce();
  });
});

describe('undo-consume (behavior change 7)', () => {
  it('Cmd+Z mid-drag cancels the drag, does NOT reach the app undo', () => {
    const r = new KeyboardRouter();
    const canvas = canvasApi({ hasActiveGesture: vi.fn(() => true) });
    r.registerCanvas('flat', canvas);
    const undo = vi.fn(() => true);
    r.registerApp(undo);
    r.handleKeyDown(key({ key: 'z', metaKey: true }));
    expect(canvas.cancelActiveGesture).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
  });

  it('a THROWING cancel still aborts the undo (never undo over a live drag)', () => {
    const r = new KeyboardRouter();
    const canvas = canvasApi({
      hasActiveGesture: vi.fn(() => true),
      cancelActiveGesture: vi.fn(() => {
        throw new Error('boom');
      }),
    });
    r.registerCanvas('flat', canvas);
    const undo = vi.fn(() => true);
    r.registerApp(undo);
    r.handleKeyDown(key({ key: 'z', ctrlKey: true }));
    expect(undo).not.toHaveBeenCalled();
  });

  it('second press (gesture gone) performs the app undo normally', () => {
    const r = new KeyboardRouter();
    const canvas = canvasApi();
    r.registerCanvas('flat', canvas);
    const undo = vi.fn(() => true);
    r.registerApp(undo);
    r.handleKeyDown(key({ key: 'z', metaKey: true }));
    expect(undo).toHaveBeenCalledOnce();
  });
});

describe('fault isolation', () => {
  it('a throwing canvas handler does not block app shortcuts (Cmd+S at 3am)', () => {
    const r = new KeyboardRouter();
    r.registerCanvas(
      'flat',
      canvasApi({
        handleKey: vi.fn(() => {
          throw new Error('canvas table bug');
        }),
      }),
    );
    const app = vi.fn(() => true);
    r.registerApp(app);
    r.handleKeyDown(key({ key: 's', metaKey: true }));
    expect(app).toHaveBeenCalledOnce();
  });

  it('a throwing overlay falls through to the next layer', () => {
    const r = new KeyboardRouter();
    r.registerOverlay(() => {
      throw new Error('overlay bug');
    });
    const app = vi.fn(() => true);
    r.registerApp(app);
    r.handleKeyDown(key({ key: 'k', metaKey: true }));
    expect(app).toHaveBeenCalledOnce();
  });
});

describe('registration lifecycle', () => {
  it('is StrictMode-idempotent: mount→unmount→mount is symmetric', () => {
    const r = new KeyboardRouter();
    const api1 = canvasApi();
    const un1 = r.registerCanvas('flat', api1);
    un1();
    const api2 = canvasApi();
    r.registerCanvas('flat', api2);
    r.handleKeyDown(key({ key: 'a' }));
    expect(api2.handleKey).toHaveBeenCalledOnce();
    expect(api1.handleKey).not.toHaveBeenCalled();
    un1(); // stale unregister is a no-op, must not evict api2
    r.handleKeyDown(key({ key: 'b' }));
    expect(api2.handleKey).toHaveBeenCalledTimes(2);
  });

  it('unregistering during an active gesture cancels it first', () => {
    const r = new KeyboardRouter();
    const api = canvasApi({ hasActiveGesture: vi.fn(() => true) });
    const un = r.registerCanvas('flat', api);
    un();
    expect(api.cancelActiveGesture).toHaveBeenCalledOnce();
  });

  it('keyup reaches the active canvas (Space/Alt release tracking)', () => {
    const r = new KeyboardRouter();
    const api = canvasApi();
    r.registerCanvas('flat', api);
    r.handleKeyUp(key({ key: ' ' }));
    expect(api.handleKeyUp).toHaveBeenCalledOnce();
  });
});

describe('helpers', () => {
  it('isTextTarget covers input/textarea/select/contentEditable', () => {
    expect(isTextTarget(document.createElement('input'))).toBe(true);
    expect(isTextTarget(document.createElement('textarea'))).toBe(true);
    expect(isTextTarget(document.createElement('select'))).toBe(true);
    const div = document.createElement('div');
    expect(isTextTarget(div)).toBe(false);
    Object.defineProperty(div, 'isContentEditable', { value: true });
    expect(isTextTarget(div)).toBe(true);
    expect(isTextTarget(null)).toBe(false);
  });

  it('isUndoRedoCombo matches mod+z and mod+shift+z', () => {
    expect(isUndoRedoCombo({ key: 'z', metaKey: true, ctrlKey: false })).toBe(true);
    expect(isUndoRedoCombo({ key: 'Z', metaKey: false, ctrlKey: true })).toBe(true);
    expect(isUndoRedoCombo({ key: 'z', metaKey: false, ctrlKey: false })).toBe(false);
  });
});

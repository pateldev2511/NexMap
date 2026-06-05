import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}
interface State {
  error: Error | null;
}

/**
 * Guards the canvas so a render-time error shows a recoverable message instead of
 * white-screening the whole app. The model lives in a module-scoped store (not
 * React state) and is autosaved, so data survives a render crash — the user can
 * Undo the offending change from the toolbar, then retry.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          padding: 24,
          textAlign: 'center',
          color: 'var(--chrome-fg)',
          background: 'var(--canvas-bg)',
        }}
      >
        <div style={{ fontSize: 15, fontWeight: 600 }}>
          Something went wrong rendering the canvas.
        </div>
        <div
          style={{
            fontSize: 12,
            fontFamily: 'var(--font-mono)',
            color: 'var(--chrome-fg-muted)',
            maxWidth: 420,
            wordBreak: 'break-word',
          }}
        >
          {error.message}
        </div>
        <div style={{ fontSize: 12, color: 'var(--chrome-fg-muted)', maxWidth: 420 }}>
          Your work is safe — it's autosaved locally. Use Undo (⌘Z) in the toolbar to
          revert the last change, then retry. Reload the page if this persists.
        </div>
        <button
          onClick={this.reset}
          style={{
            marginTop: 6,
            padding: '6px 14px',
            borderRadius: 7,
            border: '1px solid var(--chrome-border)',
            background: 'var(--accent)',
            color: '#fff',
            cursor: 'pointer',
          }}
        >
          Try again
        </button>
      </div>
    );
  }
}

import { Component } from 'react';

// The app has no error boundary anywhere from the DOM root down (confirmed
// by searching the whole codebase) — any uncaught exception thrown inside
// a React event handler or render (e.g. a ProseMirror transaction failing
// synchronously mid-click) unmounts the entire tree per React's default
// no-boundary behavior. This exists specifically to stop that turning into
// a full white-screen crash for whatever page it wraps.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary] caught an error:', error, info);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: '64px 24px',
            textAlign: 'center',
            maxWidth: '480px',
            margin: '0 auto',
            color: 'var(--text-primary, #0F172A)',
            fontFamily: 'inherit',
          }}
        >
          <div style={{ fontSize: '36px', marginBottom: '14px' }}>⚠️</div>
          <h2 style={{ margin: '0 0 8px', fontSize: '18px', fontWeight: 700 }}>
            Editor encountered an error
          </h2>
          <p style={{ margin: '0 0 22px', fontSize: '13.5px', lineHeight: 1.6, color: 'var(--text-muted, #64748B)' }}>
            Something went wrong while rendering this page. Reloading recovers it — your saved drafts and vault
            documents are unaffected.
          </p>
          <button
            type="button"
            onClick={this.handleReload}
            style={{
              padding: '11px 22px',
              borderRadius: '8px',
              background: '#3B82F6',
              color: '#FFFFFF',
              border: 'none',
              fontWeight: 600,
              fontSize: '13.5px',
              cursor: 'pointer',
            }}
          >
            Reload Editor
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

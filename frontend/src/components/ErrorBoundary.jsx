import { Component } from 'react';

// Catches any error thrown while a page renders (or inside one of its event handlers) so the advocate sees a calm
// message and a way forward instead of a white screen. Wrap a page, or the whole app shell with a `resetKey` (the
// current path) so moving to another page clears the error.
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

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" style={{ padding: '64px 24px', textAlign: 'center', maxWidth: '520px', margin: '0 auto', color: 'var(--ink, #181b1d)', fontFamily: 'inherit' }}>
          <h2 style={{ margin: '0 0 8px', fontFamily: "'Fraunces', Georgia, serif", fontWeight: 500, fontSize: '26px' }}>
            Something went wrong on this page
          </h2>
          <p style={{ margin: '0 0 22px', fontSize: '15px', lineHeight: 1.6, color: 'var(--ink-soft, #44494d)' }}>
            Your saved drafts, cases and documents are safe. Try again, or go back to the start page.
          </p>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => this.setState({ hasError: false })}
              style={{ minHeight: 44, padding: '0 22px', borderRadius: 10, background: 'var(--accent, #937243)', color: 'var(--on-accent, #fff)', border: 'none', fontWeight: 600, fontSize: 15, cursor: 'pointer' }}
            >
              Try again
            </button>
            <a
              href="/start"
              style={{ minHeight: 44, display: 'inline-flex', alignItems: 'center', padding: '0 22px', borderRadius: 10, border: '1px solid var(--rule, #ccc)', color: 'inherit', textDecoration: 'none', fontSize: 15 }}
            >
              Go to Start
            </a>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

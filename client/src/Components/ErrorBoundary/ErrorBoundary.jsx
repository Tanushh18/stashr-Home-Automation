import React from "react";
import "./ErrorBoundary.css";

/**
 * Without this, an uncaught render error anywhere in the tree unmounts the
 * whole app — a blank white screen with nothing in the UI to explain why.
 * This catches it, logs the real error to the console, and shows something
 * a person can act on instead.
 */
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error("Stashr crashed while rendering:", error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="eb" role="alert">
        <div className="eb__card">
          <span className="eb__seal" aria-hidden="true">
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3 5 6v5c0 4.4 3 8.3 7 10 4-1.7 7-5.6 7-10V6l-7-3Z" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
          </span>
          <p className="eb__kicker">Display fault</p>
          <h1 className="eb__title">Something broke while loading the page</h1>
          <p className="eb__body">
            Your data is safe — this is a display bug, not a data problem. Reloading usually fixes it.
            If it keeps happening, open the browser console (F12) and send the error shown there.
          </p>
          <details className="eb__details">
            <summary>Technical details</summary>
            <pre>
              {String(this.state.error?.stack || this.state.error?.message || this.state.error)}
            </pre>
          </details>
          <button type="button" className="eb__reload" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}

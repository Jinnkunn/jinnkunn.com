import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Optional label shown in the crash card. Defaults to "Workspace". */
  label?: string;
}

interface State {
  error: Error | null;
  componentStack: string;
}

/** Class-component error boundary sitting just inside <App />. React still
 * requires a class for this — hooks have no equivalent. We render a muted
 * crash card so the whole window doesn't go white when one surface throws
 * during render. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, componentStack: "" };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the component stack around for the "Copy details" button. Real
    // telemetry pipe can hook in here later.
    this.setState({ componentStack: info.componentStack ?? "" });
    // Still log so Tauri devtools / stderr capture it.
    console.error("[ErrorBoundary]", error, info);
  }

  private reset = () => {
    this.setState({ error: null, componentStack: "" });
  };

  private reload = () => {
    window.location.reload();
  };

  private copyDetails = async () => {
    const { error, componentStack } = this.state;
    if (!error) return;
    const payload = [
      `Error: ${error.message}`,
      error.stack ? `Stack:\n${error.stack}` : "",
      componentStack ? `Component stack:${componentStack}` : "",
    ]
      .filter(Boolean)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(payload);
    } catch {
      // Clipboard permission denied; swallow. The UI already shows the
      // message inline, so copy failure isn't fatal.
    }
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    const label = this.props.label ?? "Workspace";
    return (
      <div className="error-boundary" role="alert">
        <div className="error-boundary__card">
          <div className="error-boundary__icon" aria-hidden="true">
            ⚠︎
          </div>
          <h1 className="error-boundary__title">{label} crashed</h1>
          <p className="error-boundary__message">{error.message}</p>
          <div className="error-boundary__actions">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={this.reset}
            >
              Try again
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={this.reload}
            >
              Reload window
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void this.copyDetails()}
            >
              Copy details
            </button>
          </div>
          {error.stack && (
            <details className="error-boundary__details">
              <summary>Stack trace</summary>
              <pre>{error.stack}</pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

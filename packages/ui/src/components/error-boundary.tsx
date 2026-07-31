"use client";

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
}
interface State {
  error: Error | null;
}
export class ErrorBoundary extends Component<Props, State> {
  public override state: State = { error: null };
  public static getDerivedStateFromError(error: Error): State {
    return { error };
  }
  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Clockwork UI boundary", {
      error,
      componentStack: info.componentStack,
    });
  }
  public reset = () => {
    this.setState({ error: null });
  };
  public override render() {
    if (!this.state.error) return this.props.children;
    return (
      this.props.fallback?.(this.state.error, this.reset) ?? (
        <section className="cw-error" role="alert">
          <h2>Something went wrong</h2>
          <p>
            Reference the request ID in the page footer when contacting support.
          </p>
          <button
            className="cw-button cw-button--secondary"
            onClick={this.reset}
          >
            Try again
          </button>
        </section>
      )
    );
  }
}

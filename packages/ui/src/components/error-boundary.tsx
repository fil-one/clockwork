"use client";

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * Either a custom fallback or the words of the built-in one, in the reader's
 * language. The kit carries no English default.
 */
type Props = { children: ReactNode } & (
  | {
      fallback: (error: Error, reset: () => void) => ReactNode;
      messages?: never;
    }
  | {
      fallback?: undefined;
      messages: { title: string; description: string; retry: string };
    }
);
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
      // i18n-exempt: console diagnostic
      error,
      componentStack: info.componentStack,
    });
  }
  public reset = () => {
    this.setState({ error: null });
  };
  public override render() {
    if (!this.state.error) return this.props.children;
    const { fallback, messages } = this.props;
    if (fallback) return fallback(this.state.error, this.reset);
    // Unreachable by type: without a fallback the caller supplied messages.
    if (!messages) return null;
    return (
      <section className="cw-error" role="alert">
        <h2>{messages.title}</h2>
        <p>{messages.description}</p>
        <button className="cw-button cw-button--secondary" onClick={this.reset}>
          {messages.retry}
        </button>
      </section>
    );
  }
}

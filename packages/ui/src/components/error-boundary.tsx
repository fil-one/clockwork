"use client";

import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";

interface Props {
  children: ReactNode;
  fallback?: (error: Error, reset: () => void) => ReactNode;
  messages?: {
    title: string;
    description: string;
    retry: string;
  };
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
    const messages = this.props.messages ?? {
      title: "Something went wrong",
      description:
        "Reference the request ID in the page footer when contacting support.",
      retry: "Try again",
    };
    return (
      this.props.fallback?.(this.state.error, this.reset) ?? (
        <section className="cw-error" role="alert">
          <h2>{messages.title}</h2>
          <p>{messages.description}</p>
          <button
            className="cw-button cw-button--secondary"
            onClick={this.reset}
          >
            {messages.retry}
          </button>
        </section>
      )
    );
  }
}

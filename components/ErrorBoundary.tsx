"use client";

import React from "react";

type Props = {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  resetKey?: string | number;
  onError?: (error: unknown) => void;
};

type State = { hasError: boolean };

export default class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown) {
    this.props.onError?.(error);
    console.error("[ErrorBoundary] caught:", error);
  }

  componentDidUpdate(prevProps: Props) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        this.props.fallback || (
          <div className="w-full rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            Algo deu errado aqui, mas a página não caiu. Feche e tente
            novamente.
          </div>
        )
      );
    }

    return this.props.children;
  }
}

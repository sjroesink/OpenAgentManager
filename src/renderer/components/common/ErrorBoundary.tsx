import React, { Component } from 'react'

interface ErrorBoundaryProps {
  children: React.ReactNode
}

interface ErrorBoundaryState {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] Caught rendering error:', error, info.componentStack)
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen w-screen bg-surface-0 text-text-primary p-8">
          <h1 className="text-xl font-bold mb-4 text-error">Something went wrong</h1>
          <pre className="text-sm text-text-secondary bg-surface-2 rounded-lg p-4 max-w-2xl overflow-auto max-h-[60vh] whitespace-pre-wrap break-words">
            {this.state.error?.message}
            {'\n\n'}
            {this.state.error?.stack}
          </pre>
          <button
            className="mt-6 px-4 py-2 bg-accent text-accent-text rounded-lg hover:bg-accent-hover transition-colors"
            onClick={() => this.setState({ hasError: false, error: null })}
          >
            Try Again
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

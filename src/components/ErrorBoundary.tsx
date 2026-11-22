import {Component} from 'react';
import type {ErrorInfo, ReactNode} from 'react';

/** Stops one rendering bug from blanking the whole app; offers a reload instead. */
export class ErrorBoundary extends Component<{children: ReactNode}, {failed: boolean}> {
  state = {failed: false};

  static getDerivedStateFromError() {
    return {failed: true};
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('UI error:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="min-h-screen flex items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-4">
          <h1 className="text-[20px] font-bold text-[#1C1F22]">Something went wrong</h1>
          <p className="text-[14px] text-[#7A746B]">The page hit an unexpected error. Your data is safe. Reload to continue.</p>
          <button type="button" onClick={() => window.location.reload()} className="btn-primary cursor-pointer">
            Reload
          </button>
        </div>
      </div>
    );
  }
}

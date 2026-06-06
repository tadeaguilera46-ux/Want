import * as Sentry from "@sentry/react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

type Props = {
  children: ReactNode;
};

type State = {
  hasError: boolean;
  errorMessage?: string;
};

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = {
    hasError: false,
    errorMessage: undefined,
  };

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      errorMessage: error.message,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("AppErrorBoundary:", error, errorInfo);
    Sentry.captureException(error, {
      extra: { componentStack: errorInfo.componentStack },
    });
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-xl border border-red-800/50 bg-card p-6 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-100 text-red-400">
            <AlertTriangle size={28} />
          </div>

          <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-950">
            Algo salió mal
          </h1>

          <p className="mt-2 text-sm leading-relaxed text-slate-500">
            La app encontró un error inesperado. Podés recargar la pantalla para
            intentar continuar.
          </p>

          {import.meta.env.DEV && this.state.errorMessage && (
            <p className="mt-4 rounded-lg bg-slate-100 px-4 py-3 text-xs font-medium text-slate-500">
              {this.state.errorMessage}
            </p>
          )}

          <button
            onClick={this.handleReload}
            className="mt-5 inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-slate-950 px-5 text-sm font-bold text-white"
          >
            <RefreshCw size={16} />
            Recargar app
          </button>
        </div>
      </div>
    );
  }
}
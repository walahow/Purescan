import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react';

export interface ToastMessage {
  id: number;
  kind: 'success' | 'error' | 'info';
  text: string;
}

interface ToastBannerProps {
  toast: ToastMessage | null;
  onDismiss: () => void;
}

export function ToastBanner({ toast, onDismiss }: ToastBannerProps) {
  if (!toast) return null;

  const styles =
    toast.kind === 'error'
      ? 'border-red-300 bg-red-50 text-red-900'
      : toast.kind === 'success'
        ? 'border-zinc-900 bg-zinc-900 text-white'
        : 'border-zinc-300 bg-white text-zinc-900';

  const Icon =
    toast.kind === 'error' ? AlertCircle : toast.kind === 'success' ? CheckCircle2 : Info;

  const iconColor =
    toast.kind === 'error'
      ? 'text-red-600'
      : toast.kind === 'success'
        ? 'text-white'
        : 'text-zinc-700';

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed top-16 left-1/2 -translate-x-1/2 z-[70] w-[calc(100%-2rem)] max-w-md pointer-events-auto"
    >
      <div
        className={`flex items-center gap-2.5 border px-3.5 py-2.5 shadow-[6px_6px_0px_0px_rgba(24,24,27,0.12)] ${styles}`}
      >
        <Icon size={16} className={`shrink-0 ${iconColor}`} />
        <p className="flex-1 text-xs font-medium leading-snug">{toast.text}</p>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss notification"
          className="p-1 opacity-60 hover:opacity-100 transition-opacity cursor-pointer"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}

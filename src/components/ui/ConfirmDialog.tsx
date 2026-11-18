import { AlertTriangle, X } from 'lucide-react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-zinc-950/60 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
    >
      <div className="relative w-full max-w-sm bg-white border border-zinc-300 shadow-[10px_10px_0px_0px_rgba(24,24,27,0.22)]">
        <div className={`h-1 w-full ${destructive ? 'bg-red-600' : 'bg-zinc-900'}`} />
        <div className="p-6">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <AlertTriangle size={18} className={destructive ? 'text-red-600' : 'text-zinc-900'} />
              <h2
                id="confirm-dialog-title"
                className="font-mono text-xs font-bold uppercase tracking-widest text-zinc-900"
              >
                {title}
              </h2>
            </div>
            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              className="p-1 text-zinc-400 hover:text-zinc-900 cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
          <p className="text-sm text-zinc-600 leading-relaxed mb-6">{message}</p>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="h-11 rounded-none border border-zinc-200 bg-white font-mono text-[11px] font-bold uppercase tracking-wider text-zinc-700 hover:bg-zinc-100 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              className={`h-11 rounded-none font-mono text-[11px] font-bold uppercase tracking-wider text-white cursor-pointer ${
                destructive
                  ? 'bg-red-600 border border-red-600 hover:bg-red-700'
                  : 'bg-zinc-900 border border-zinc-900 hover:bg-zinc-800'
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

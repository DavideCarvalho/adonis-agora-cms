import { createContext, type ReactNode, useCallback, useContext, useRef, useState } from 'react';
import { cn } from '../agora-kit/lib/utils';

type Tone = 'ok' | 'bad';
type Toast = { id: number; message: string; tone: Tone };

const ToastContext = createContext<(message: string, tone?: Tone) => void>(() => undefined);

/** `toast(message, tone)`: a short confirmation, or (`bad`) a failure that stays a little longer. */
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(0);

  const toast = useCallback((message: string, tone: Tone = 'ok') => {
    next.current += 1;
    const id = next.current;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(
      () => setToasts((current) => current.filter((item) => item.id !== id)),
      tone === 'bad' ? 7000 : 3000,
    );
  }, []);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div
        className="pointer-events-none fixed right-4 bottom-4 z-50 flex max-w-[calc(100vw-2rem)] flex-col items-end gap-2"
        role="status"
        aria-live="polite"
      >
        {toasts.map((item) => (
          <div
            key={item.id}
            className={cn(
              'pointer-events-auto rounded-md border bg-popover px-3.5 py-2 text-[13px] text-fg shadow-lg animate-in fade-in slide-in-from-bottom-2',
              item.tone === 'bad' ? 'border-bad/40 text-bad' : 'border-brand-border',
            )}
          >
            {item.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

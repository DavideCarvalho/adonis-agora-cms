import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from '../atoms/index.js';
import { useMessages } from '../context.js';

export type ConfirmOptions = {
  title: string;
  body?: string | undefined;
  action: string;
  /** Red action button: for anything that loses data. */
  danger?: boolean | undefined;
};

type Confirm = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Confirm | null>(null);

/** Without a provider (a custom dashboard using `EditForm` alone) it falls back to the browser's. */
export function useConfirm(): Confirm {
  return (
    useContext(ConfirmContext) ?? ((options) => Promise.resolve(window.confirm(options.title)))
  );
}

/** One native `<dialog>` for the whole panel: focus trap, Escape and inertness come for free. */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const t = useMessages();
  const dialog = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((answer: boolean) => void) | null>(null);
  const [options, setOptions] = useState<ConfirmOptions | null>(null);

  const confirm = useCallback<Confirm>(
    (next) =>
      new Promise((resolve) => {
        resolver.current?.(false);
        resolver.current = resolve;
        setOptions(next);
      }),
    [],
  );

  useEffect(() => {
    if (options && !dialog.current?.open) dialog.current?.showModal();
  }, [options]);

  const settle = (answer: boolean) => {
    resolver.current?.(answer);
    resolver.current = null;
    dialog.current?.close();
    setOptions(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <dialog
        ref={dialog}
        className="confirm"
        onCancel={(event) => {
          event.preventDefault();
          settle(false);
        }}
      >
        {options ? (
          <>
            <h2 className="confirm__title">{options.title}</h2>
            {options.body ? <p className="confirm__body">{options.body}</p> : null}
            <div className="confirm__actions">
              <Button size="md" onClick={() => settle(false)}>
                {t.cancel}
              </Button>
              <Button
                size="md"
                tone={options.danger ? 'destructive' : 'accent'}
                onClick={() => settle(true)}
              >
                {options.action}
              </Button>
            </div>
          </>
        ) : null}
      </dialog>
    </ConfirmContext.Provider>
  );
}

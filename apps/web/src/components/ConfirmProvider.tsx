import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';

export interface ConfirmOptions {
  title?: string;
  message: string;
  body?: ReactNode; // optional rich content under the message (e.g. a formatted list)
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** Demand this exact string before the confirm button works, where a misplaced click and a
   *  decision would otherwise look the same. */
  requireText?: string;
}

const ConfirmContext = createContext<(o: ConfirmOptions) => Promise<boolean>>(() => Promise.resolve(false));

/** `const confirm = useConfirm(); if (!(await confirm({ message }))) return;` — an in-app,
 *  themed replacement for window.confirm (centered, styled, Escape/overlay = cancel). */
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [opts, setOpts] = useState<ConfirmOptions | null>(null);
  const [typed, setTyped] = useState('');
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback(
    (o: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolver.current = resolve;
        setTyped('');
        setOpts(o);
      }),
    [],
  );
  const settle = (v: boolean) => {
    resolver.current?.(v);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={!!opts}
        onOpenChange={(open) => !open && settle(false)}
        onCloseAutoFocus={(e) => e.preventDefault()} // don't return focus → won't dismiss a parent dialog
        title={opts?.title ?? t('confirmTitle')}
      >
        <p className="whitespace-pre-wrap text-[13px] text-muted">{opts?.message}</p>
        {opts?.body}
        {opts?.requireText && (
          <div className="mt-3 space-y-1.5">
            <p className="text-[13px] text-muted">{t('confirmTypeName', { name: opts.requireText })}</p>
            <Input
              aria-label="confirm-text"
              autoFocus
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && typed === opts.requireText) settle(true);
              }}
            />
          </div>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button aria-label="confirm-cancel" variant="ghost" size="sm" onClick={() => settle(false)}>
            {opts?.cancelLabel ?? t('cancel')}
          </Button>
          <Button
            aria-label="confirm-ok"
            autoFocus={!opts?.requireText} // the field takes focus when there is one
            disabled={!!opts?.requireText && typed !== opts.requireText}
            size="sm"
            variant={opts?.danger ? 'default' : 'brand'}
            className={opts?.danger ? 'border-delete text-delete hover:bg-delete/10' : ''}
            onClick={() => settle(true)}
          >
            {opts?.confirmLabel ?? t('confirm')}
          </Button>
        </div>
      </Dialog>
    </ConfirmContext.Provider>
  );
}

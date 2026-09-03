import { useTranslation } from 'react-i18next';
import { Button } from './button';

/** The dialog's bottom action row: a ghost cancel, then the brand primary action. */
export function DialogFooter({
  onCancel,
  confirmLabel,
  disabled,
  busy,
  onConfirm,
}: {
  onCancel: () => void;
  confirmLabel: string;
  disabled?: boolean;
  /** The confirm action is in flight; cancel stays live. */
  busy?: boolean;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="mt-4 flex justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={onCancel}>
        {t('cancel')}
      </Button>
      <Button variant="brand" size="sm" disabled={disabled} busy={busy} onClick={onConfirm}>
        {confirmLabel}
      </Button>
    </div>
  );
}

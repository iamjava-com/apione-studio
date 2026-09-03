import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../api';
import { useDialogForm } from '../hooks/useDialogForm';
import { Input } from './ui/input';
import { Dialog } from './ui/dialog';
import { DialogFooter } from './ui/DialogFooter';
import { ErrorText } from './ui/ErrorText';

/** Self-service password change for the logged-in user. Requires the current password (the server
 *  enforces it too); the confirm field is a client-side typo guard only. */
export function ChangePasswordDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const firstRef = useRef<HTMLInputElement>(null);

  const form = useDialogForm(open, () => {
    setCurrent('');
    setNext('');
    setConfirm('');
    requestAnimationFrame(() => firstRef.current?.focus());
  });

  const submit = () => {
    if (!current || !next || form.busy) return;
    if (next !== confirm) {
      form.setError(t('passwordMismatch'));
      return;
    }
    void form.submit(async () => {
      await api.changePassword(current, next);
      onOpenChange(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('changePassword')}>
      <div className="space-y-2">
        <Input
          ref={firstRef}
          aria-label="current-password"
          type="password"
          placeholder={t('currentPassword')}
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          aria-label="new-password"
          type="password"
          placeholder={t('newPassword')}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Input
          aria-label="confirm-password"
          type="password"
          placeholder={t('confirmPassword')}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>
      <ErrorText error={form.error} className="mt-2" />
      <DialogFooter
        onCancel={() => onOpenChange(false)}
        confirmLabel={t('save')}
        disabled={!current || !next}
        busy={form.busy}
        onConfirm={submit}
      />
    </Dialog>
  );
}

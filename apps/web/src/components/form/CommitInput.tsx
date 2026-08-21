import { useEffect, useState } from 'react';
import { Input } from '../ui/input';
import { usePendingEdit } from './PendingEdits';

/**
 * Text input that edits locally and only commits on blur / Enter — so renaming a
 * map key (schema name, response code) doesn't fire per-keystroke and doesn't lose
 * focus when the parent re-keys the row. Rejected commits snap back to `value`.
 *
 * Uncommitted text is reported to the save bar, which treats it as unsaved work.
 */
export function CommitInput({
  value,
  onCommit,
  className,
  ...rest
}: {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  'aria-label'?: string;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  usePendingEdit(v.trim() !== '' && v.trim() !== value);
  const commit = () => {
    const next = v.trim();
    if (next && next !== value) onCommit(next);
    else setV(value); // empty / unchanged → revert
  };
  return (
    <Input
      {...rest}
      className={className}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

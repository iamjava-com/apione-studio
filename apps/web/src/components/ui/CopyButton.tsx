import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Copy } from 'lucide-react';

/**
 * Copy `text` to the clipboard and flip the icon to a check. A blocked clipboard is silently
 * ignored — the value this copies is always on screen to copy by hand.
 */
export function CopyButton({
  text,
  className,
  iconSize = 14,
  resetMs,
  withLabel = false,
  ...rest
}: {
  text: string;
  className?: string;
  iconSize?: number;
  /** Revert to the copy icon after this many ms; omit to keep the check until unmount. */
  resetMs?: number;
  /** Also render the copy/copied word next to the icon. */
  withLabel?: boolean;
  'aria-label'?: string;
  title?: string;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      if (resetMs !== undefined) {
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setCopied(false), resetMs);
      }
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <button type="button" className={className} onClick={() => void copy()} {...rest}>
      {copied ? <Check size={iconSize} /> : <Copy size={iconSize} />}
      {withLabel && (copied ? t('copied') : t('copy'))}
    </button>
  );
}

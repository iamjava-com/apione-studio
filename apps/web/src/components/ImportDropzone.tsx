import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Upload } from 'lucide-react';
import { cn } from '../lib/utils';

/** Fused file picker + drop target: click to choose or drop a spec file (takes the first).
 *  Shows the supported formats in place — the one spot that documents them. */
export function ImportDropzone({ onFile, busy }: { onFile: (file: File) => void; busy?: boolean }) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (files: FileList | null) => {
    const f = files?.[0];
    if (f) onFile(f);
  };

  return (
    <button
      type="button"
      aria-label="import-dropzone"
      disabled={busy}
      onClick={() => inputRef.current?.click()}
      // Radix portals this into <body>, but React events bubble by the React tree — so stop
      // propagation, or a drop here would also fire the page-level drop handler (double import).
      onDragEnter={(e) => e.stopPropagation()}
      onDragOver={(e) => {
        e.stopPropagation();
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setOver(true);
        }
      }}
      onDragLeave={(e) => {
        e.stopPropagation();
        setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setOver(false);
        take(e.dataTransfer.files);
      }}
      className={cn(
        'flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-6 text-center transition-colors',
        over ? 'border-brand bg-brand/5' : 'border-border hover:border-brand/60',
        busy && 'pointer-events-none opacity-60',
      )}
    >
      <Upload size={20} className="text-faint" />
      <span className="text-[13px] text-muted">{busy ? t('importing') : t('importFromFile')}</span>
      <span className="text-[11px] text-faint">{t('importFormats')}</span>
      <input
        ref={inputRef}
        type="file"
        accept=".json,.yaml,.yml,application/json,application/yaml"
        className="hidden"
        aria-label="import-new-file"
        onChange={(e) => {
          take(e.target.files);
          e.target.value = '';
        }}
      />
    </button>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import Editor from '@monaco-editor/react';
import YAML from 'yaml';
import { api, type MockSchema } from '../api';
import '../monaco-setup'; // configures Monaco on import; this view is where that cost belongs
import { EDITOR_FONT } from '../lib/editor-font';
import { useTheme } from '../theme';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

/**
 * The schema auto mode answers from. Opened on request rather than shown alongside the endpoint:
 * it explains *why* the generated response looks the way it does, which is worth having — but
 * only when asked, or it is just another read-only panel nobody wanted.
 *
 * The way to change it is to edit the spec, so the dialog ends in a jump to the design canvas.
 */
export function MockSchemaDialog({
  open,
  onOpenChange,
  projectId,
  method,
  path,
  onEditInDesign,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  method: string;
  path: string;
  onEditInDesign?: () => void;
}) {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const [data, setData] = useState<MockSchema | null>(null);
  const [error, setError] = useState<string | null>(null);

  const yaml = useMemo(() => (data?.schema == null ? '' : YAML.stringify(data.schema)), [data]);
  // Monaco can't size to its content, so the dialog would either clip a short schema in a
  // half-empty box or let a long one push the viewport.
  const height = Math.min(Math.max(yaml.split('\n').length * 19 + 16, 96), 440);

  useEffect(() => {
    if (!open) return;
    setData(null);
    setError(null);
    api
      .mockSchema(projectId, method, path)
      .then(setData)
      .catch((e) => setError((e as Error).message));
  }, [open, projectId, method, path]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('mockSchemaTitle')} size="lg">
      <div className="mb-2 flex items-center gap-2 text-[12px] text-muted">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="truncate font-mono" title={`${method.toUpperCase()} ${path}`}>
            {method.toUpperCase()} {path}
          </span>
          {data && (
            <span className="shrink-0 font-mono text-faint">
              {data.status}
              {data.contentType ? ` · ${data.contentType}` : ''}
            </span>
          )}
        </div>
        {onEditInDesign && (
          <Button
            className="shrink-0"
            size="sm"
            onClick={() => {
              onOpenChange(false);
              onEditInDesign();
            }}
          >
            {t('mockSchemaEdit')}
          </Button>
        )}
      </div>

      {error && <p className="text-[13px] text-danger">{error}</p>}
      {!error && data && data.schema === null && <p className="text-[13px] text-muted">{t('mockSchemaNone')}</p>}
      {!error && data && data.schema !== null && (
        <div className="overflow-hidden rounded-md border border-border" style={{ height }}>
          <Editor
            height="100%"
            theme={`apione-${theme}`}
            language="yaml"
            value={yaml}
            options={{
              readOnly: true,
              domReadOnly: true,
              // The dialog animates open from zero size; without this Monaco keeps the first measurement.
              automaticLayout: true,
              minimap: { enabled: false },
              lineNumbers: 'off',
              renderLineHighlight: 'none',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              fontSize: 13,
              tabSize: 2,
              fontFamily: EDITOR_FONT,
              padding: { top: 8, bottom: 8 },
            }}
          />
        </div>
      )}
    </Dialog>
  );
}

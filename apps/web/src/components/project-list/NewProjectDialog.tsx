import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FileText, X } from 'lucide-react';
import { api, type Group, type Project } from '../../api';
import { errorText } from '../../lib/errors';
import { useDialogForm } from '../../hooks/useDialogForm';
import { Input } from '../ui/input';
import { Dialog } from '../ui/dialog';
import { DialogFooter } from '../ui/DialogFooter';
import { ErrorText } from '../ui/ErrorText';
import { selectCls } from '../ui/select';
import { ImportDropzone } from '../ImportDropzone';

const SPEC_FILE = /\.(ya?ml|json)$/i;

/**
 * Create a project, either empty or from a dropped spec.
 *
 * `initialFile` lets a page-wide drop hand its file straight to the dialog. `defaultGroupId` is
 * the section the user started from — null means ungrouped. The group picker is hidden entirely
 * while no group exists, so a single-group-free instance sees exactly the old dialog.
 */
export function NewProjectDialog({
  open,
  onOpenChange,
  groups,
  defaultGroupId,
  initialFile,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  groups: Group[];
  defaultGroupId: string | null;
  initialFile: File | null;
  onCreated: (p: Project) => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [groupId, setGroupId] = useState<string | null>(defaultGroupId);
  // A staged spec waits here (parsed but not yet imported) so the user can confirm the name;
  // null → create an empty project. `preview` is the dry-run result (null while pending or after
  // a parse error, which blocks Create).
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ title: string | null; sourceFormat: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const form = useDialogForm(open, () => {
    setName('');
    setGroupId(defaultGroupId);
    setStagedFile(null);
    setPreview(null);
    if (initialFile) void stageFile(initialFile);
    else requestAnimationFrame(() => inputRef.current?.focus());
  });

  // Stage a dropped/picked spec: dry-run it on the server (validate + read its title) so we can
  // prefill the name and surface a parse error before anything is created. Kept as a File so the
  // real import re-reads it on confirm.
  async function stageFile(file: File) {
    setStagedFile(file);
    setPreview(null);
    form.setError(null);
    // reject by name first — a stray drop shouldn't be read into memory whole just to be rejected
    if (!SPEC_FILE.test(file.name)) return form.setError(t('err_invalid_spec'));
    setPreviewing(true);
    try {
      const res = await api.importPreview(await file.text());
      setPreview(res);
      if (res.title) setName((n) => (n.trim() ? n : res.title!)); // don't clobber a name the user typed
    } catch (e) {
      form.setError(errorText(e)); // parse failed → preview stays null, Create disabled
    } finally {
      setPreviewing(false);
    }
  }

  const clearStaged = () => {
    setStagedFile(null);
    setPreview(null);
    form.setError(null);
  };

  const submit = () => {
    if (previewing) return;
    if (stagedFile && !preview) return; // valid spec only
    if (!stagedFile && !name.trim()) return;
    void form.submit(async () => {
      const p = stagedFile
        ? await api.importNewProject(await stagedFile.text(), name.trim() || undefined, groupId)
        : await api.createProject(name.trim(), groupId);
      onOpenChange(false);
      onCreated(p);
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('newProject')}>
      <p className="mb-3 text-[12px] text-faint">{t('adminVisibleHint')}</p>
      <Input
        ref={inputRef}
        placeholder={t('projectNamePlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {groups.length > 0 && (
        <select
          aria-label={t('projectGroup')}
          className={`${selectCls} mt-2 w-full`}
          value={groupId ?? ''}
          onChange={(e) => setGroupId(e.target.value || null)}
        >
          <option value="">{t('ungrouped')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
      <div className="my-3 flex items-center gap-3">
        <div className="h-px flex-1 bg-border" />
        <span className="text-[12px] font-semibold text-faint">{t('or')}</span>
        <div className="h-px flex-1 bg-border" />
      </div>
      {stagedFile ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2.5">
          <FileText size={16} className="shrink-0 text-faint" />
          <span className="min-w-0 flex-1 truncate text-[13px] text-text">{stagedFile.name}</span>
          {previewing ? (
            <span className="text-[11px] text-faint">{t('importing')}</span>
          ) : (
            preview && <span className="shrink-0 text-[11px] text-faint">{t(`fmt_${preview.sourceFormat}`)}</span>
          )}
          <button
            type="button"
            aria-label={t('remove')}
            onClick={clearStaged}
            className="shrink-0 rounded p-0.5 text-faint transition-colors hover:text-text"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <ImportDropzone onFile={(f) => void stageFile(f)} busy={previewing} />
      )}
      <ErrorText error={form.error} className="mt-2" />
      <DialogFooter
        onCancel={() => onOpenChange(false)}
        confirmLabel={stagedFile ? t('import') : t('create')}
        disabled={previewing || (stagedFile ? !preview : !name.trim())}
        busy={form.busy}
        onConfirm={submit}
      />
    </Dialog>
  );
}

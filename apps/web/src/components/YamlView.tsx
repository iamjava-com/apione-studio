import { useEffect, useRef } from 'react';
import Editor, { type OnMount } from '@monaco-editor/react';
import YAML from 'yaml';
import '../monaco-setup'; // configures Monaco on import; this view is where that cost belongs
import { EDITOR_FONT } from '../lib/editor-font';
import { useTheme } from '../theme';
import type { SpecFile } from '../hooks/useSpecFile';

/* eslint-disable @typescript-eslint/no-explicit-any */
type RevealTarget = { kind: 'op'; method: string; path: string } | { kind: 'schema'; name: string };

/** Character offset of a path/schema key in the YAML text (for navigator → line reveal). */
function keyOffset(text: string, target: RevealTarget): number | null {
  try {
    const doc = YAML.parseDocument(text);
    const map: any = target.kind === 'op' ? doc.get('paths', true) : doc.getIn(['components', 'schemas'], true);
    const wanted = target.kind === 'op' ? target.path : target.name;
    const pair = map?.items?.find((p: any) => String(p.key) === wanted);
    return pair?.key?.range?.[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Raw YAML view — Monaco over the shared spec-file content (the escape hatch).
 *
 * Monaco is uncontrolled: a controlled `value` is reconciled in a passive effect, and a keystroke
 * that lands between commit and that effect gets overwritten (cursor to the end, text lost) — on a
 * large document, where renders are slow, that is every fast burst. Outside text arrives only via
 * `file.syncRev` (load / reset / restore / rebase / outline edits).
 */
export function YamlView({ file }: { file: SpecFile }) {
  const { theme } = useTheme();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

  useEffect(() => {
    const ed = editorRef.current;
    const model = ed?.getModel();
    if (!ed || !model || model.getValue() === file.text) return;
    const pos = ed.getPosition();
    ed.executeEdits('', [{ range: model.getFullModelRange(), text: file.text }]);
    ed.pushUndoStop();
    if (pos) ed.setPosition(model.validatePosition(pos));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- content is read, never a trigger
  }, [file.syncRev]);

  // Navigator clicks fire "apione-reveal"; jump Monaco to that key's line.
  useEffect(() => {
    const onReveal = (e: Event) => {
      const ed = editorRef.current;
      const model = ed?.getModel();
      if (!ed || !model) return;
      const offset = keyOffset(model.getValue(), (e as CustomEvent<RevealTarget>).detail);
      if (offset == null) return;
      const pos = model.getPositionAt(offset);
      ed.revealLineInCenter(pos.lineNumber);
      ed.setPosition(pos);
      ed.focus();
    };
    window.addEventListener('apione-reveal', onReveal);
    return () => window.removeEventListener('apione-reveal', onReveal);
  }, []);

  return (
    <Editor
      height="100%"
      theme={`apione-${theme}`}
      language="yaml"
      defaultValue={file.text}
      onChange={(v) => file.setText(v ?? '')}
      onMount={(ed) => (editorRef.current = ed)}
      options={{
        minimap: { enabled: false },
        fontSize: 13,
        tabSize: 2,
        fontFamily: EDITOR_FONT,
      }}
    />
  );
}

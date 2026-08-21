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

/** Raw YAML view — Monaco bound to the shared spec-file content (the escape hatch). */
export function YamlView({ file }: { file: SpecFile }) {
  const { theme } = useTheme();
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);

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
      value={file.content}
      onChange={(v) => file.setContent(v ?? '')}
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

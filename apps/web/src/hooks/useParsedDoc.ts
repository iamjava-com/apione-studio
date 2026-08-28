import { useEffect, useRef, useState } from 'react';
import type { ParseRequest, ParseResponse } from '../workers/yaml-parse.worker';

/**
 * `text` parsed as YAML, in a worker: a large spec takes hundreds of milliseconds to parse, and
 * on the main thread that blocks every keystroke in the editor. Trails the text by one parse;
 * null while the first parse is pending, when the text does not parse, and for empty text (which
 * is what a caller passes when it has no text to show — no parse is posted for it).
 */
export function useParsedDoc<T>(text: string): T | null {
  const [doc, setDoc] = useState<T | null>(null);
  const worker = useRef<Worker | null>(null);
  const ticket = useRef(0);

  useEffect(() => {
    const w = new Worker(new URL('../workers/yaml-parse.worker.ts', import.meta.url), { type: 'module' });
    w.onmessage = (e: MessageEvent<ParseResponse>) => {
      if (e.data.id === ticket.current) setDoc(e.data.doc as T | null);
    };
    worker.current = w;
    return () => {
      w.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    ticket.current += 1;
    if (text === '') setDoc(null);
    else worker.current?.postMessage({ id: ticket.current, text } satisfies ParseRequest);
  }, [text]);

  return doc;
}

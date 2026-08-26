import YAML from 'yaml';

/** Parses YAML off the main thread; `doc` is null when the text does not parse. */
export type ParseRequest = { id: number; text: string };
export type ParseResponse = { id: number; doc: unknown };

addEventListener('message', (e: MessageEvent<ParseRequest>) => {
  let doc: unknown;
  try {
    doc = YAML.parse(e.data.text) ?? {};
  } catch {
    doc = null;
  }
  postMessage({ id: e.data.id, doc } satisfies ParseResponse);
});

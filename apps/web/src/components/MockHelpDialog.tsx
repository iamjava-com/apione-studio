import { useTranslation } from 'react-i18next';
import { Dialog } from './ui/dialog';

/** The samples are the reference: they carry the contract better than prose, and need no
 *  translation. Only the headings are localized. */
const CONTRACT = `export default (req) => ({
  status: 200,
  headers: { 'x-trace': 'abc' },
  body: { hello: req.params.id },
});`;

const REQUEST = `req.method    // 'GET'
req.path      // '/users/42'
req.params    // { id: '42' }   ← from /users/{id}
req.query     // { page: '2' }
req.headers   // { authorization: 'Bearer …' }
req.body      // parsed JSON, or undefined`;

const RESPONSE = `// full form — status, headers and body
return { status: 404, body: { error: 'not found' } };

// shorthand — anything else is the body, with 200
return { items: [] };

// delayMs holds the response back, to act like a slow endpoint (max 30000)
return { body: { items: [] }, delayMs: 800 };`;

const CONDITIONAL = `export default (req) => {
  if (!req.headers.authorization) {
    return { status: 401, body: { error: 'no token' } };
  }
  if (req.query.empty === '1') {
    return { items: [], total: 0 };      // the empty-list case
  }
  if (req.params.id === '404') {
    return { status: 404, body: { error: 'not found' } };
  }
  return { items: [{ id: req.params.id }], total: 1 };
};`;

const LOGGING = `export default (req) => {
  console.log('query was', req.query);   // Debug panel → under the response
  return { items: [] };
};`;

const COMPLETION = `/**
 * @param {MockRequest} req
 * @returns {MockResponse}
 */`;

function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-md border border-border bg-bg p-2 font-mono text-[12px] leading-relaxed text-text">
      {children}
    </pre>
  );
}

function Section({ title, code }: { title: string; code: string }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1 text-[13px] font-medium text-text">{title}</h3>
      <Code>{code}</Code>
    </section>
  );
}

/** In-product reference for writing a custom mock. Without it the only documentation is two
 *  comment lines in the starter template, which leaves `req`'s shape and the sandbox's limits
 *  to guesswork. */
export function MockHelpDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('mockHelpTitle')} size="lg">
      <div className="max-h-[70vh] overflow-y-auto pr-1">
        <Section title={t('mockHelpContract')} code={CONTRACT} />
        <Section title={t('mockHelpRequest')} code={REQUEST} />
        <Section title={t('mockHelpResponse')} code={RESPONSE} />
        <Section title={t('mockHelpConditional')} code={CONDITIONAL} />
        <Section title={t('mockHelpLogging')} code={LOGGING} />

        <section>
          <h3 className="mb-1 text-[13px] font-medium text-text">{t('mockHelpLimits')}</h3>
          <p className="text-[12px] text-muted">{t('mockHelpNoIo')}</p>
          <p className="mb-1 mt-2 text-[12px] text-muted">{t('mockHelpCompletion')}</p>
          <Code>{COMPLETION}</Code>
        </section>
      </div>
    </Dialog>
  );
}

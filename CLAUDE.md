# ApiOne Studio — project rules

A pure OpenAPI studio: design, docs, mock, collaboration.

## Architecture, non-negotiable

- **Files are the truth.** The OpenAPI files on disk are the only authority; SQLite is an index / history / concurrency ledger, **never the truth**.
- **One write path.** A write = canonical file + appended version row, in one transaction. fsync the data and the directory, or the ledger runs ahead of the truth.
- **One transaction entry point:** `transact()` in `db/txn.ts`. Defer unrollbackable fs work (deleting files) with `onCommit()`, which runs after the outermost commit.
- **No git, no pessimistic locks.** Concurrency is optimistic (version numbers); history and restore come from the version table.
- **canonical-on-write.** Every save emits the canonical form: saving the same logical content twice is byte-identical. `yaml` is pinned exactly and the output bytes have snapshot tests — upgrading it is a deliberate migration.

## Buy the engine, build the shell

- mock = built-in auto + QuickJS-WASM sandbox (scripted); docs = Scalar; parse/bundle/lint = @redocly/openapi-core; Swagger 2→3 = swagger2openapi; breaking changes = oasdiff (out-of-process binary, degrades gracefully when absent).
- Every engine hides behind an adapter, out of process where possible. **Do not reimplement** any of them.
- Editor: Monaco as the fallback. Only the endpoint and schema forms are ours, and they need not cover all of OpenAPI.

## Non-goals

- No request client, no environment/variable-scope system, no scripted test orchestration — that is Postman's and curl's job.
- No other protocols (gRPC/WS/GraphQL).
- No ops advice baked in: rate limiting, TLS and reverse proxying belong to the deployment layer.

## Security

- **Auth is always required** (first run creates the admin). `/api` denies by default: every route carries its own guard and a missing one throws at startup (`assertApiRoutesGuarded`); the global hook is only the second layer, and it matches the route pattern, not `req.url`.
- **Minting credentials and destroying the ledger need a password session:** token management, creating users / changing roles / resetting passwords, deleting projects / files / accounts. API tokens are always refused — a password handed out is a new credential.
- **Mock sandbox:** QuickJS-WASM, no fs, network or timers. Every endpoint defaults to auto; written code still runs only after an explicit switch to scripted. **Never vm2.**
- **Mock responses must stay sandboxed:** the gateway shares the app's origin, so responses carry `CSP: sandbox` and `set-cookie` is stripped on the way through.
- **`$ref` stays inside the project directory:** enforced in the engine adapter's `loadExternalRef`. No remote refs; realpath first, then compare the prefix.
- Secrets never reach the spec or git; exports exclude sensitive values.

## Verification

- Run `npm run verify` (= `check` + `e2e`) after changing code. **`npm run check` excludes e2e** — running it alone is not verification.
- e2e owns ports 4100/5173 and fails outright if the dev server is up: stop it, run, start it back. Not a reason to skip.
- New behavior gets a test: interaction (drag, dialogs, routing, cross-panel sync) in `apps/web/e2e`, everything else in `apps/server/test`.
- A bug-fix test must fail before the fix, or it is not testing what you think.
- Never regenerate an applied migration; add a new one.

## Copy and comments

- One filter: **if I don't say this, will the reader get bitten?** Only then write it.
- Short and plain. No rhetoric, no "it is worth noting" bridges, no two sentences where one does.
- UI copy: skip what a user learns by trying (state they just picked, results in front of them). Silent truncation, or a capability that simply does not exist, must be said.
- Code comments: skip what the code already says — never a line of prose restating the line below it. Write invariants, counter-intuitive trade-offs, external constraints. What this change fixed and how it used to break goes in the commit message.
- The interface layer is the exception: JSDoc on exported functions and component props states the contract — what the caller must satisfy, who owns what.

## Stack

- Node 24 (pinned); OpenAPI 3.1 natively; Fastify + REST on the back end (not GraphQL); React + Vite + TS on the front.
- i18n from day one; the en/ja/zh key sets must stay aligned; the default follows the browser language.
- The two packages install separately (`npm --prefix`) with separate lockfiles — this is not an npm workspace.

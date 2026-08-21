---
name: ApiOne Studio
description: Read and edit OpenAPI specs held in a self-hosted ApiOne Studio instance. Use whenever the user asks what an endpoint accepts or returns, what their API contract says, or asks to add, change, document, or review an endpoint or schema that lives in ApiOne — including questions like "what does GET /orders return", "add a cancel-order endpoint", "is this change breaking".
---

# ApiOne Studio

ApiOne holds a team's OpenAPI specs as files on a server and puts an editor, docs, and mock server on top. This skill lets you work on those specs over its HTTP API.

## Credentials

Read `~/.apione/config.json` — `{ "url": ..., "token": ... }` — and send `Authorization: Bearer <token>` on every request.

If that file is missing, the user hasn't installed this. Ask them to create a token (account menu → **API Token**) and then follow `<instance url>/docs/setup.md`.

The token acts as that user, with exactly their permissions. A 403 means they genuinely lack the right; a 404 on a project can also mean they aren't a member of it.

## Start here, every time

**`GET {url}/docs/openapi.yaml`** — this instance describing itself: every endpoint, its parameters, its responses.

It is generated from the running server's own route definitions, so it is never stale. **This skill deliberately does not list endpoints** — those belong to the instance and change with it, while this file changes almost never. Read the spec rather than guessing a URL from memory.

## Three rules that will bite you otherwise

### 1. Files are the truth

A project is a directory of OpenAPI documents on disk. The database is an index — history, permissions, concurrency — never the source. Anything you want changed, you change by writing a file through the API.

### 2. Writes are optimistically concurrent

Every write carries `baseVersion`: the `version` you got when you read the file (`0` for a file that doesn't exist yet).

If it no longer matches, the write is **refused with 409** and the current state comes back in the error's `details`.

> **On a 409, re-read, reapply your change to the new content, and submit again.** Never retry the same body — the version moved because someone else's edit is in there now, and resubmitting would erase it.

### 3. Content is canonicalized on write

The server re-serializes what you send: fixed indentation, normalized `$ref` form, **comments dropped**. Two saves of the same logical document are byte-identical. Don't promise a user that their YAML formatting or comments will survive, and don't diff your input against the response expecting a match.

## Don't read the whole spec to change one endpoint

A real spec is tens of thousands of tokens. Fetching all of it to touch one endpoint spends your context on everything you aren't changing. Two endpoints exist so you don't have to:

- **Search** the project's operations to get a shortlist of summaries (method, path, summary, tags, and each one's `opId`). Check `truncated` in the response — if it's true, matches were dropped past the limit, so narrow the query rather than assuming you saw everything.
- **Read one operation** by its `opId` to get that operation in full, with `$ref`s already inlined so it reads on its own.

`opId` is the operation's identity (`x-apione-id`, stored inside the operation itself). It survives renaming and moving; method+path is only where the endpoint currently answers. Prefer it whenever something needs to keep pointing at the same endpoint.

Reach for the whole bundled spec only when the task genuinely spans the document — an audit, a global rename, a breaking-change review.

## Working on an API

### Answering questions about the contract

Search for the endpoint, read that one operation, answer from it. Usually two calls. Don't fetch the whole spec for this.

### Changing the spec

1. **Read the surrounding conventions first.** Read two or three neighbouring operations before adding one. Match their naming, error responses, security scheme, and tagging — a technically valid endpoint in the wrong house style is a bad contribution.
2. Read the file you're changing to get its current content and `version`.
3. Write it back with `baseVersion` set to that version.
4. **Check your work**: lint the project for structural errors, and run the breaking-change report if you edited anything existing. Both are endpoints; find them in the spec.
5. Tell the user which version you created, so they can look at the diff or roll it back.

Everything you write becomes a new version attributed to the token's owner, and every version is diffable and restorable from the UI. That's what makes it safe for you to edit directly — but it is not a reason to be careless: say what you changed.

### Scope

You act with this user's full permissions, with two deliberate exceptions, both reserved for someone signed in with a password:

- **You cannot delete a project, a file, or an account.** Those destroy version history — there would be nothing left to roll back to.
- **You cannot create user accounts, reset anyone's password, or change anyone's role.** Issuing a password mints a credential, and a credential outlives the token that made it.

The operations this covers carry the `passwordSession` security scheme in the spec, so you can see which they are before you call one. A `403 session_required` is the rule working, not a misconfiguration: tell the user to do it in the web UI rather than looking for a way around it.

Everything else is yours, including things worth pausing over. **Ask before overwriting a spec wholesale via import, and before changing project membership.** Editing an endpoint the user asked you to edit needs no ceremony.

## Workflow stages

Every endpoint carries a stage the team manages themselves: `design` → `pending_dev` → `developing` → `pending_release` → `released`. It comes back on every operation summary, and there are endpoints to set one, or many at once.

Nothing enforces an order and no stage blocks an edit — the App only stores what the team says. Two things are worth knowing:

- **`released` is the one the App acts on.** An export can ask for released endpoints only, and everything else is left out of it. Moving something out of `released` unpublishes it.
- **A stage is not spec content.** Setting one writes no file and appends no version, so it never shows up in the history or a breaking-change report. Retirement is the exception and goes the other way: an endpoint on its way out gets `deprecated: true` in the document, because that is a field consumers' own tooling reads.

Set a stage when the user asks you to. Don't infer one from work you did — writing an endpoint doesn't make it `developing`, and that call is theirs.

## Mocks

Every endpoint is mockable, served from the instance at `/mock/{projectId}/...` with no authentication. By default a mock is generated from the schema; an endpoint can instead be switched to a small JavaScript function that runs in a sandbox with no filesystem, network, or timers.

Mock code is addressed by `opId` and uses the same `baseVersion` concurrency as spec files. Only write one if asked — a mock is the team's test fixture, not something to add unprompted.

## Errors

Failures share one envelope: `{ "error": "<stable code>", "message": "...", "details": ... }`. Read `error`, not the prose. The ones worth recognising:

| code | what happened |
|---|---|
| `conflict` (409) | Version moved under you. Re-read and reapply. |
| `unauthorized` (401) | Token missing, revoked, or the account is disabled. |
| `forbidden` (403) | The user lacks that permission on that project; `details.requiredPermission` names it. |
| `session_required` (403) | Destroys history — only a password session may. Hand it back to the user. |
| `not_found` (404) | Gone — or a project they aren't a member of. Existence is deliberately hidden. |

# Install the ApiOne Studio skill

You are an AI coding agent being asked to set up access to an **ApiOne Studio** instance — a self-hosted workspace where a team designs and documents its OpenAPI specs. Once this is done you can read and edit those specs directly.

Where the **skill** goes depends on which agent you are, so that step states a goal and leaves the path to you. Where the **credentials** go does not: the skill is the same file for every agent and reads them from one fixed path. Do all four steps, then report back.

## What you need

- **Instance URL** — the origin you fetched this file from, e.g. `http://localhost:4100`.
- **API token** — ask the user for one. They create it inside ApiOne: account menu (their username, top right) → **API Token** → type a label → **New**. It is shown once.

Ask for the token before doing anything else; every endpoint needs it.

## Step 1 — store the credentials

Write them to **`~/.apione/config.json`** — on Windows, `%USERPROFILE%\.apione\config.json`:

```json
{ "url": "<instance url>", "token": "<the token>" }
```

**This path is fixed, not a suggestion.** The skill you install in step 2 is the same file for every agent, and it reads the credentials from exactly here. Putting them anywhere else means the skill cannot find them.

Create the directory if needed, then restrict the file to the current user — `chmod 600` on macOS/Linux; on Windows, `icacls` with inheritance removed.

**The token is the user's whole account.** It must not land in a project directory, a dotfile that gets committed, or a shell history you can avoid.

## Step 2 — install the skill

Fetch `<instance url>/docs/skill.md`. No authentication needed.

Save it verbatim wherever *you* keep long-lived instructions that load when relevant:

- **Claude Code** — `~/.claude/skills/apione/SKILL.md` (a personal skill; the file already carries the frontmatter it needs).
- **Any other agent** — your own equivalent: a rules file, a memory or instructions directory, whatever you load automatically. If you have a project-scoped mechanism but no user-scoped one, ask the user which project should get it.
- **No such mechanism at all** — save it somewhere stable, tell the user exactly where, and say they should point you at it when they want you to work on their APIs.

Do not edit the content on the way in, and do not paste the token into it. Re-fetching overwrites it cleanly on upgrade, and skill files get copied and committed.

## Step 3 — verify

Call `GET <instance url>/api/auth/me` with header `Authorization: Bearer <the token>`.

- **200** — done; the response names the account the token acts as.
- **401** — the token is wrong, was revoked, or the account is disabled. Ask for a fresh one.
- **connection refused / DNS failure** — wrong URL, or the instance isn't running. Confirm with the user.

Do not skip this. A silent misconfiguration resurfaces as a confusing 401 in the middle of real work.

## Step 4 — report

Tell the user:

- that it is installed, and **where** you put both files,
- which account the token acts as,
- how the skill will be picked up — automatically when they ask about their APIs, and, for Claude Code, that `/apione` invokes it directly.

## Upgrading later

Re-run this file. Step 2 replaces the skill with the version matching the instance; steps 1 and 3 are idempotent.

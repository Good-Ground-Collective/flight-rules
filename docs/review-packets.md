# Review Packets

`flight-rules packet` publishes a Review Packet to Ariadne and revises it later, as its author. A packet is one PR or a series of PRs with your confirmed annotations, in the order a reviewer should read them. It talks to Ariadne's Review Packets API, contract version 1 (think-lp/ariadne `docs/review-packets-api.md`).

Unlike `flight-rules board`, which stays quiet so a hook can never fail, every `packet` command is deliberate: it either succeeds and prints JSON, or exits 1 with a one-line next step. Nothing is skipped silently.

## Commands

```bash
flight-rules packet new-id --title "<title>"
flight-rules packet create --file <packet.json>
flight-rules packet update <id> --file <packet.json> [--expected-revision <n>]
flight-rules packet get <id>
flight-rules packet reviewers
```

- `new-id` prints one JSON line `{"id":"<generated id>"}`, so a skill can write the id into its packet file once and reuse that file, and id, for every retry.
- `create` sends the file and prints the stored packet as one JSON line. When the file has no `id`, one is generated from the title; an `id` in the file is used unchanged. It is idempotent on the packet `id`: repeating it with the same id and content returns the same packet, and the same `id` with different content fails with 409 `packet_exists`. See Packet ids below for `packet_id_taken`.
- `update` sends `PUT /v1/review-packets/{id}` with `{expectedRevision, operationId, packet}`. The `operationId` is generated for you. `expectedRevision` comes from `--expected-revision`, or from the file's `revision` field. The output of `packet get` carries one, so the usual flow is `packet get <id> > p.json`, edit, `packet update <id> --file p.json`. The server-owned fields in that output (`authorId`, `status`, `revision`, `createdAt`, `updatedAt`) are not sent back, and reviewers shown as `{id, github: {login}}` are sent as their logins. A file with no revision and no flag exits 1 before anything is sent.
- `get` prints the packet, including its `revision`.
- `reviewers` prints `{reviewers: [{id, name, github: {id, login}}]}`: the members you can name. Packets name reviewers by GitHub login.

## Review plans

`flight-rules epic review-plan <id>` and `flight-rules initiative review-plan <id>` tell an orchestrator how to hand off the PRs it is blocked on. The initiative verb plans across every epic in one graph, so dependencies between epics are kept and the route rule is applied once to the whole set.

The output carries `route`, `reasons`, `missing`, `blocked` and `unblocksOnMerge`. `route` is one of:

- `simple`: plain review requests are enough.
- `complex`: the set spans more than one wave, stacks on a branch other than the default, or has more than 4 PRs. Build a Review Packet.
- `incomplete`: a blocked ticket has no open PR. `missing` lists those tickets and the route is not decided until their PRs exist. Report them and stop.

A `blocked` entry has `pr: null` when no open PR matched its ticket. Skills skip such entries rather than failing.

## Packet ids

Ids are unique across every author. A generated id is `<slug>-<8 hex>`: the title in lowercase kebab-case (ASCII letters and digits, any other run collapsed to one `-`, at most 60 characters, `packet` when nothing is usable) and 8 random lowercase hex characters. It always matches `^[A-Za-z0-9_-]{1,80}$`.

A network failure or 5xx is retried once with the same id and body, which the server replays idempotently. When another author already holds the id, Ariadne answers 409 `packet_id_taken`: `create` regenerates the random suffix once, keeping the slug of the id it sent, and retries once. If the retry succeeds, the stored packet printed carries the new id. A second `packet_id_taken` exits 1 naming the ids tried; any other 409 is never retried.

## What is sent

A packet holds a title, an overview (objective and 1-5 highlights), 1-30 ordered PRs, and 1-10 reviewers. Each PR has its repo, number, head sha, title, optional ticket reference, your sign-off (or `null`) and up to 10 focus areas. A focus area has a kind (`design-pattern`, `business-logic`, `data-schema` or `other`), a title, a rationale and up to 10 anchors.

An anchor is `{path, line, startLine?, side}` with `side` `LEFT` or `RIGHT`. It points at code; it never carries any. The schemas are strict, so a `diff` or `snippet` field, or any other unknown field, is refused locally with every issue listed, and nothing is sent. Text is never cut to fit: a title over 200 characters, an objective over 600, a highlight over 200, a ticket over 100, a path over 400 or a rationale over 2,000 is an error, so an annotation is never silently lost.

## Token

The packet is attributed to you, the owner of the token. The token is read from `$ARIADNE_AGENT_TOKEN`, then `$ARIADNE_TOKEN`, then the file `flight-rules board login` saves (mode 0600). flight-rules never uses the `ariadne` CLI's Keychain session. The token is never printed.

## Config

`ariadne.url` (default: production; https only, http for `localhost` and `127.0.0.1`) is read only from user and local scope. Project settings and the config file cannot set it, so a repository cannot redirect your token. `ariadne.enabled=false` does not stop packet publishing; it only switches off hook reporting.

## Errors and next steps

| Failure | What to do |
| --- | --- |
| No token | Set `ARIADNE_AGENT_TOKEN`, or run `flight-rules board login` with an agent token from Ariadne › Settings › Connections. |
| `ariadne.url` invalid | Fix it with `flight-rules config set ariadne.url <https url> --scope user`. Nothing is sent. |
| Invalid packet (unknown field, over-long text, bad value) | Fix the file; the message lists every issue. Nothing was sent. |
| 401 `agent_token_expired` | Create a new agent token in Ariadne › Settings › Connections and run `flight-rules board login`. |
| 401 `unauthorized` | The token is revoked or mistyped; create a new one as above. |
| 403 `agents_opt_in_required` | Turn on Agents in Ariadne › Settings › Connections, then retry. |
| 409 `revision_conflict` | The packet changed. Re-read with `flight-rules packet get <id>`, reapply your edit and retry. |
| 409 `packet_id_taken` | Another author holds the id, and the one regeneration was taken too. Change the title or set a new id (`flight-rules packet new-id --title <title>`), then retry. |
| 409 `packet_exists` | The id is taken by a different packet. Use `packet update`, or choose a new id. |
| 422 `reviewer_not_found` | A reviewer is not an active Ariadne member with a linked GitHub login. List valid logins with `flight-rules packet reviewers`. |
| Network error | Check your connection and `ariadne.url`, then retry. A network failure or 5xx is retried once automatically; that is safe because create is keyed by the packet id and update carries a fresh `operationId`. |

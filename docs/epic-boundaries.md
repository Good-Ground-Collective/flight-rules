# Epic boundaries

An epic is a self-contained unit of work. Every one of its tickets can be built, reviewed and merged without waiting on a ticket in another epic, and the epic can finish on its own.

The reason is attention. Each dependency between epics keeps two epics open at once. A few of them leave five epics in flight with no clear order, and nobody can hold that in their head. A reviewer, who sees one PR at a time, has even less chance than the author.

## The rule

**Keep every blocked-by edge inside one epic.** Avoid an edge between epics unless it is absolutely necessary.

When a breakdown produces a dependency that would cross epics, restructure it with one of these moves:

1. **Move the dependent ticket** into its blocker's epic, when the ticket really belongs to that work.
2. **Merge the two tickets**, when the split exists only on paper and one PR would carry both.
3. **Sequence the epics**, so the blocking epic finishes before the dependent epic starts. The dependency then becomes an epic order instead of a ticket edge.

An edge that survives all three needs a one-line justification recorded on the dependent ticket. "Simpler to slice this way" is not a justification. "The API contract is owned by epic B and cannot ship from A" is.

## Epic order

An initiative breakdown proposes the order its epics are worked in, chosen to keep as few epics in flight as possible, ideally one. Record the order and its reason in the initiative body's `### Decisions`. `execute-wave` follows it when it drains an initiative.

## The CLI guard

`flight-rules ticket block <id> --by <blocker>` looks up both tickets' parent epics through the tracker: the `parent` field on Jira, the sub-issue parent on GitHub.

- **Same epic:** the link is made.
- **Different epics:** the command refuses and names the three moves above. Pass `--cross-epic-reason "<why>"` to link anyway. The reason is recorded on the dependent ticket twice: as a comment for people, and under `crossEpicReasons` in its LLM Context metadata for the plan verbs. Re-running the same link with the same reason does not add a second comment.
- **A parent can't be resolved** (a standalone ticket, or a tracker error): the command warns on stderr and makes the link.

```bash
flight-rules ticket block 42 --by 17 --cross-epic-reason "the shared auth client ships in epic 10 and cannot be duplicated in epic 40"
```

## The plan lint

`flight-rules epic plan`, `initiative plan`, `epic review-plan` and `initiative review-plan` add a `crossEpicEdges` array to their JSON. Each entry has `ticket`, `ticketEpic`, `blockedBy`, `blockerEpic` and `justification`. Edges are reported for open tickets only. `blockerEpic` is `null` when the blocker has no epic or its epic could not be resolved, and `justification` is `null` when none was recorded.

Each edge is also written to stderr as a warning:

```text
warning: cross-epic dependency: #42 (epic #40) is blocked by #17 (epic #10); no justification recorded
```

The lint never changes the waves or the cycle check. `initiative plan` also tags each planned ticket with its `epicId`, so a caller can work one epic at a time.

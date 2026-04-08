# Codex Review: `enable-tool-use-for-chain-delegates`

Anchor RFC: `docs/design/enable-tool-use-for-chain-delegates.md`

Reviewed branches:

- `elliott/enable-tool-use-for-the-chain-delegate` at `70ee18b8b2`
- `silas/enable-tool-use-for-the-chain-delegate` at `ae220d29ff`
- `cael/enable-tool-use-for-the-chain-delegate` at `d66ec471d5`
- `ronan/enable-tool-use-for-the-chain-delegate` at `fc0b8bc6fc`

I compared the branch tips directly with `git log`, `git diff`, and `git show`. I did not run tests.

## Quick Comparison

| Branch | 3-layer architecture | Canonical runtime gate | Leaf deny defense | Parent-rooted routing | Prompt / tests / docs | Code shape |
| --- | --- | --- | --- | --- | --- | --- |
| `elliott` | Mostly complete | Yes | Yes | Yes | Prompt/tests good, docs misplaced | Best merge shape |
| `silas` | Mostly complete | Yes | No | Yes | Prompt/tests good, docs misplaced | More duplicated |
| `cael` | Mostly complete | Yes | Yes | Yes | Incomplete | Similar to Elliott, less complete |
| `ronan` | Incomplete | Partly | Yes | Yes | Docs best, code incomplete | Weakest implementation |

## Branch-by-Branch

### `elliott/enable-tool-use-for-the-chain-delegate`

Commits: `583175ea21`, `70ee18b8b2`

What it gets right:

- Moves `continue_delegate` out of the unconditional deny list but keeps it in `SUBAGENT_TOOL_DENY_LEAF`, so only non-leaf sub-agents become eligible: `src/agents/pi-tools.policy.ts:24-54`.
- Consumes tool-enqueued delegates at the announce boundary and routes spawns back through the parent session via `targetRequesterSessionKey`: `src/agents/subagent-announce.ts:1805-2045`.
- Threads `drainsContinuationDelegateQueue: true` through the actual spawn path:
  - `src/agents/subagent-announce.ts:1912-1918`
  - `src/agents/subagent-announce.ts:2024-2030`
  - `src/agents/subagent-spawn.ts:79-81`
  - `src/agents/subagent-spawn.ts:683-685`
  - `src/commands/agent.ts:546-548`
  - `src/gateway/server-methods/agent.ts:237-240`
  - `src/gateway/server-methods/agent.ts:715-717`
- It is also the only branch that keeps the mirrored embedded-agent path aligned in `src/agents/agent-command.ts:550-552` and `src/agents/command/types.ts`.
- Prompt and test coverage are the strongest:
  - `src/agents/system-prompt.ts:756-795`
  - `src/agents/system-prompt.test.ts:330-380`
- Unique extra correctness win: queued announces preserve `continuationTrigger` instead of dropping `delegate-return` metadata:
  - `src/agents/subagent-announce.ts:879-880`
  - `src/agents/subagent-announce.ts:934-985`
  - `src/agents/subagent-announce-queue.ts`

Gaps:

- The announce-boundary tool loop does not enforce `maxDelegatesPerTurn`; it consumes and spawns every tool delegate in the queue: `src/agents/subagent-announce.ts:1975-2045`.
- The doc update is not on the RFC anchor path. This branch edits `docs/design/continue-work-signal-v2.md` instead of carrying the dedicated review anchor doc.
- `src/agents/pi-embedded-runner/run/attempt.ts:2015-2017` also gates `continuationEnabled` on `drainsContinuationDelegateQueue`. That keeps prompt exposure tight, but it is broader than the RFC requirement and should be an explicit policy choice.

Bottom line:

- Closest branch to the converged target.
- Not the one to land as-is; it still needs a small manual fix for `maxDelegatesPerTurn`.

### `silas/enable-tool-use-for-the-chain-delegate`

Commit: `ae220d29ff`

What it gets right:

- Consumes tool delegates at the announce boundary and spawns them through `targetRequesterSessionKey`: `src/agents/subagent-announce.ts:1963-2100`.
- Threads `drainsContinuationDelegateQueue` through `src/agents/subagent-spawn.ts`, `src/commands/agent.ts`, and `src/gateway/server-methods/agent.ts`.
- Updates the minimal prompt and adds coverage for tool-aware prompt behavior:
  - `src/agents/system-prompt.ts:756-797`
  - `src/agents/system-prompt.test.ts:341-361`
- It is the only branch that explicitly budgets tool delegates against `maxDelegatesPerTurn` at the announce boundary: `src/agents/subagent-announce.ts:1982-1994`.

Gaps:

- It removes `continue_delegate` from `SUBAGENT_TOOL_DENY_LEAF` entirely, so leaf sub-agents are no longer denied the tool:
  - `src/agents/pi-tools.policy.ts:24-54`
  - The test change encodes the same policy: `src/agents/system-prompt.test.ts:341-356`
- That directly fails the explicit defense-in-depth requirement from the RFC and from this review request.
- The docs are on a non-canonical file path: `docs/design/enable-delegate-tool-for-chain.md`.
- The announce implementation is more duplicated than Elliott's, and I would not cherry-pick it wholesale because it bundles the one must-keep idea (`maxDelegatesPerTurn` budgeting) with the leaf-deny regression.

Bottom line:

- Has one must-keep idea: the announce-boundary `maxDelegatesPerTurn` budget.
- Not acceptable as the landing base because it violates the leaf-deny requirement.

### `cael/enable-tool-use-for-the-chain-delegate`

Commits: `097e215dde`, `d66ec471d5`

What it gets right:

- Core runtime behavior is close to Elliott:
  - leaf deny is preserved in `src/agents/pi-tools.policy.ts:44-52`
  - announce-boundary consumption is present in `src/agents/subagent-announce.ts:1804-2035`
  - parent-rooted routing is correct
  - announce-boundary spawns set `drainsContinuationDelegateQueue: true`
- The spawn / gateway / command threading is present in the same core files as the other branches.

Gaps:

- No prompt update and no new test coverage. The branch does not touch `src/agents/system-prompt.ts` or `src/agents/system-prompt.test.ts`, so orchestrator sub-agents still get bracket-only guidance even when the tool is available.
- Like Elliott, the announce-boundary tool loop never enforces `maxDelegatesPerTurn`: `src/agents/subagent-announce.ts:1975-2035`.
- The design note is misplaced at repo root (`cael-design-enable-tool-delegates.md`) instead of `docs/design/...`.
- It does not carry Elliott's extra path-alignment work for the mirrored `src/agents/agent-command.ts` surface.

Bottom line:

- Cleaner than Ronan and safer than Silas on policy, but incomplete on prompt/tests/docs and still missing width enforcement.

### `ronan/enable-tool-use-for-the-chain-delegate`

Commits: `475de3730e`, `fc0b8bc6fc`

What it gets right:

- Best RFC/design write-up by far, and it lives at the correct anchor path: `docs/design/enable-tool-use-for-chain-delegates.md`.
- Keeps `continue_delegate` in `SUBAGENT_TOOL_DENY_LEAF`: `src/agents/pi-tools.policy.ts:44-52`.
- Announces still spawn through the parent session and parent origin, so the topology is conceptually right.

Gaps:

- The core 3-layer architecture is not fully wired because the announce-boundary spawn calls do not set `drainsContinuationDelegateQueue: true`:
  - bracket path: `src/agents/subagent-announce.ts:1900-1905`
  - tool path: `src/agents/subagent-announce.ts:2028-2033`
- That means the next-generation child spawned from a delegate does not get the tool, so the feature stops after one announce hop.
- The announce-boundary tool budgeting is unfinished / incorrect:
  - explicit `TODO` and hardcoded zero bracket count: `src/agents/subagent-announce.ts:1983-1988`
  - cost-cap check uses `accumulatedChildTokens` instead of the parent chain total: `src/agents/subagent-announce.ts:2006-2011`
- No prompt or test updates, so the tool can become available without any matching prompt/test coverage.

Bottom line:

- Best docs branch.
- Weakest code branch; not a viable landing base.

## Cross-Branch Findings

### 1. `drainsContinuationDelegateQueue === true` is still the real runtime gate

All four branches still rely on the same canonical tool exposure gate in `src/agents/openclaw-tools.ts:249-261`. That is good. None of the branches tries to bypass it.

The real differences are:

- whether the branch correctly threads the flag all the way to spawned delegate runs
- whether it preserves leaf deny as an extra guard
- whether prompt/tests/docs were updated to match the new policy

### 2. Only Elliott, Cael, and Ronan preserve leaf deny

Silas explicitly removes the leaf deny, which I consider a disqualifying regression for this feature.

### 3. Parent-rooted announce routing is correct in all four code branches

The important routing choice is to spawn from the announce boundary with:

- `agentSessionKey: targetRequesterSessionKey`
- parent delivery context from `targetRequesterOrigin`

All four branches do that correctly in `src/agents/subagent-announce.ts`. None of them tries to self-consume and route grandchildren back to the ephemeral child session.

### 4. No branch actually extracts a shared helper

All four branches still duplicate the bracket-path and tool-path chain-hop logic. Elliott's shape is the cleanest, but even there the spawn/timer logic is duplicated instead of shared. I would not block landing on a helper extraction here, but the implementation quality is still "best of the set", not "fully converged".

## Recommended Landing Branch / Merge Order

Recommendation: use `elliott/enable-tool-use-for-the-chain-delegate` as the base, then manually merge one narrow logic slice from the other branches.

Suggested order:

1. Start from Elliott's code branch (`583175ea21` + `70ee18b8b2`).
2. Manually add announce-boundary `maxDelegatesPerTurn` budgeting to Elliott's tool loop in `src/agents/subagent-announce.ts`.
   - Keep Elliott's leaf deny.
   - Keep Elliott's parent-rooted spawn calls.
   - Keep Elliott's sequential `toolHopBase` handling.
   - Do not cherry-pick Silas wholesale.
3. Bring over Ronan's RFC/doc file as the canonical design artifact: `docs/design/enable-tool-use-for-chain-delegates.md`.
4. Keep Elliott's queued-announce `continuationTriggerOverride` plumbing unless there is a strong desire to cut scope to the bare minimum.

## Cherry-Picks / Manual Merges I Recommend

### Must-do manual merge

- Port the `maxDelegatesPerTurn` budgeting idea from Silas into Elliott's `src/agents/subagent-announce.ts`.
  - The useful part is the budget accounting around `toolDelegates`.
  - Do not copy Silas's policy change in `src/agents/pi-tools.policy.ts`.

### Strongly recommended doc merge

- Take Ronan's RFC file (`docs/design/enable-tool-use-for-chain-delegates.md`) as the final design document.
  - Elliott's code branch is stronger, but Ronan's write-up is the correct anchor and the clearest explanation of the parent-rooted announce-boundary model.

### Do not cherry-pick wholesale

- Do not cherry-pick `silas` wholesale because it removes `continue_delegate` from leaf deny.
- Do not cherry-pick `ronan`'s `src/agents/subagent-announce.ts` because it misses `drainsContinuationDelegateQueue: true` on the announce-boundary spawns and leaves incorrect budget logic behind.
- `cael` does not contain a unique must-take piece beyond what Elliott already has.

## Final Recommendation

If the goal is the best merge shape with the fewest risky corrections, land Elliott's branch as the code base, manually add the missing announce-boundary `maxDelegatesPerTurn` enforcement, and take Ronan's RFC doc as the design artifact. Silas has the one critical width-budget idea but should not be used as the base. Cael does not beat Elliott on any reviewed axis.

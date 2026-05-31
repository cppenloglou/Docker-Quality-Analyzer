# Master Task Prompt (Cursor + Agent)

Use this template for most implementation requests.

## Default template

```text
Task:
<what to build/fix/refactor>

Product intent:
<why this matters, user-facing outcome>

Constraints:
- Keep behavior unchanged unless explicitly requested
- Follow project rules and context docs
- Keep change set minimal and readable
- Do not touch unrelated files

Validation:
- Run relevant strict checks for touched areas
- If checks fail, fix and rerun until green

Output format:
- What changed
- Why it changed
- Risks/edge cases
- Validation commands + results
```

## Quick variants

### Add feature

```text
Task:
Add <feature> in <paths>.

Constraints:
- Keep existing APIs backward compatible
- Add tests for new behavior

Validation:
- Run backend/frontend checks impacted by this feature
```

### Delete/remove

```text
Task:
Remove <component/flow/file>.

Constraints:
- Remove dead references/imports/docs in same pass
- Preserve behavior for remaining flows

Validation:
- Run checks and confirm no orphaned routes/types
```

### Refactor only

```text
Task:
Refactor <module> for readability/maintainability.

Constraints:
- No functional behavior change
- Keep public contracts unchanged

Validation:
- No-regression checks + targeted tests
```

## Where to point the agent first

- Current product decisions: `context/chat-knowledge-index.md`
- Workflow and lifecycle truth: `context/ui-and-jobs.md`
- Execution standards: `context/add-delete-refactor-playbook.md`
- Refactor priorities: `context/refactor-backlog.md`

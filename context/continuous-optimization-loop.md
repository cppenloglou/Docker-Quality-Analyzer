# Continuous Optimization Loop

## Goal

Continuously improve speed and reliability for add/delete/refactor work by feeding repeated issues back into rules, hooks, and playbooks.

## Inputs

- Hook output log: `context/quality-gate-feedback.log`
- Repeated review comments
- Repeated breakage classes (lint failures, test flakiness, build/type errors)
- Transcript knowledge index: `context/chat-knowledge-index.md`
- Transcript retention map: `context/chat-transcript-retention.md`

## Monthly loop

1. Review the last month of `quality-gate-feedback.log`.
2. Group failures by root cause category.
3. For each repeated category, choose one action:
   - Rule update in `.cursor/rules/`
   - Hook improvement in `.cursor/hooks.json` or `.cursor/hooks/`
   - Playbook update in `context/add-delete-refactor-playbook.md`
4. Apply the smallest effective fix and record it in the decision log.
5. Re-run strict gates to confirm the improvement does not regress quality.
6. Reclassify new parent transcripts monthly into keep/archive/delete and refresh the two transcript context files.

## Decision log template

Use this format for each improvement:

- **Date:**
- **Pattern observed:**
- **Frequency:**
- **Root cause:**
- **Action taken (rule/hook/playbook):**
- **Expected outcome:**
- **Validation result:**

## Exit criteria for each cycle

- At least one recurring pain point converted into a durable guardrail.
- No reduction in strict quality-gate coverage.

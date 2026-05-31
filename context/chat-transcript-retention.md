# Chat Transcript Retention Recommendations

Last updated: 2026-05-17

Scope: parent transcripts only (`<uuid>/<uuid>.jsonl`), excluding subagent transcripts.

## Keep (active reference)

- [Project Analysis Major Milestone](c9bcaf0d-eb3f-4815-8c70-47be9a8768b4) — major product workflow/scanner/privacy decisions
- [Project Workflow State Hardening](3a6344b2-564c-49c4-aecb-5723cb938eaa) — state-machine truthfulness and status handling
- [Simplify Upload Direct Analysis](b6513236-c6ac-492b-ba2b-e56811a73c8e) — direct-analysis workflow decision
- [Privacy-Safe Research Final Polish](199ee96f-ca71-439f-a20f-2ec2afc490fd) — privacy contract and sanitization behavior
- [Monitoring Persistence and Telemetry](847810c0-e6e4-4e79-a961-a6545816b9df) — monitoring/runtime telemetry behavior
- [Align Rules to Decisions](5a592014-6fed-4912-bbcd-98e82deca923) — rule/doc alignment to code truth
- [Create Initial MDC Rules](a390d7f6-3e64-4d86-a026-cbe617ffece5) — baseline rule architecture
- [Fix Project Results Rendering](780280d1-96c2-4557-9ec2-92017b540e86) — result/runtimestate truthfulness fixes
- [Refactor Cursor Rules Set](3229f8ea-37e6-4266-a65a-c1b35282ec21) — cross-rule consistency cleanup
- [Hadolint Wiki Links in Issues](2915bdbd-8745-467f-90ee-dda453e39737) — issue documentation-link behavior

## Archive (useful history, not daily reference)

- [API Keys Purpose and Removal](1735f5cb-1b99-4dad-b39a-fe37e9e44cc9)
- [Fix Compose API Export](4cf45642-35e7-4353-bf0d-2ad32ea139c8)
- [Research UI Motion Restyle](5d00f878-9fe7-405a-8976-e1c36842eca7)
- [Architecture and Compose Runnability](67e1a024-45d8-425a-a3c1-b2a1caaec0ee)
- [Frontend Cleanup and API Integration](7b29f305-2459-4bb3-abe6-05179cdc31f0)
- [Motion Polish and Gitignore](86a5d084-53f2-4e57-93ed-ee7d9cb928eb)
- [Populate Gitignore Across Repo](a801b002-7a0d-48aa-b421-b6c00f15a8e1)
- [Draft Resume Flow and DinD](eb0c5756-3c15-4b75-a77e-c5d499afea38)
- [Fix GitHub Actions Imports](f404051e-5b9e-48f5-bd07-6a5db8b08bcd)
- [README Update with DinD](f929403c-74cc-44fd-a3c2-26014427d69d)

## Delete (obsolete/noise)

- [Git Push and SSH Setup](33e492ca-e6e3-46a8-a391-40e17ed2976c) — local environment support only
- [Pytest Setup in Cursor](9deaf9e9-7b8c-4770-ab01-cb50e7d8def3) — IDE usage-only, no product decision
- [CI Import Error Request](a6ccf90a-8da1-44cb-a5e0-8f44ba187a4f) — incomplete/no durable app decision
- [Ask Test Types Only](e421981f-afd8-4619-8d58-54a62a5a14cb) — single-question/no decision transcript

## Retention policy

- Keep: product-defining behavior, privacy, workflow, runtime truthfulness, rules governance.
- Archive: tactical fixes that may help future debugging but are not canonical guidance.
- Delete: one-off tooling/help transcripts with no durable product knowledge.

## Generated grouping artifacts

- `context/transcript-groups-keep.txt`
- `context/transcript-groups-archive.txt`
- `context/transcript-groups-delete-candidates.txt`
- `context/transcript-grouping-commands.sh` (moves folders into `keep/`, `archive/`, `delete-candidates/` buckets without deleting content)

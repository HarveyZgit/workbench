# Skill Benchmark: session-handoff

## Scope

This is a single-configuration smoke evaluation, not a with/without-skill comparison.

## Result

- Configuration: `with_skill`
- Evals: 3
- Assertion pass rate: 100%
- Timing/tokens: not captured
- Independent baseline: not run because subagent delegation was not authorized in this session

## Notes

- Create mode produced a validated `.tmp/HANDOFF-<topic>.md`.
- Compatible resume mode immediately implemented the first task and passed 2 focused tests.
- Drift resume mode reported branch/file drift and did not mutate the replacement implementation.
- Each eval declares its reproducible `setup_eval_workspace.py` command; setup refuses to replace unmanaged directories.
- `--check-state` now separates structural validity from state compatibility and exits non-zero on drift.
- Use the review viewer for qualitative inspection; do not interpret this smoke result as causal proof against a baseline.

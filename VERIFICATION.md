# Verification

Automated checks: **110 Node tests and 16 Python tests passed**.

Base: upstream commit `e7fb804e99874902d5cf426303801e932cfdfff0`.

- Node tests cover upstream behavior, exact issue lookup, branch selection with real temporary Git repositories, cancellation, preparation failure, reopening, native restore dispatch, private settings migration and pane idempotence.
- Python tests cover local copies, private permissions, links, idempotence, tracked/ignored files, unsafe symlink rejection and explicit worktree provenance.
- The TOML manifest, entrypoints, Node modules and shell scripts are checked.
- Command/response contracts were checked against the bundled Herdr 0.9.0 schema. Hook environment variables were checked against upstream v0.9.0 source.
- No live Herdr session was controlled, agents launched, or containers restarted during automated verification.

## Manual validation

Visual layout and interactions still require validation in a real Herdr session. Simulated API tests cannot establish visual correctness.

Check all four tool modes, native close/reopen, restoration of a single missing pane, exact lookup outside the list filters, and a preparation failure followed by retry. Close the workspace rather than deleting a checkout containing work.

Application directories missing from a selected commit are reported during preparation. Uncommitted source changes are not copied into a worktree.

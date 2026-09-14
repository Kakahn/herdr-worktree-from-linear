# Worktree from Linear

A personal fork of [tdi/herdr-worktree-from-linear](https://github.com/tdi/herdr-worktree-from-linear), based on upstream plugin v0.6.0 (`e7fb804`). It adds an interactive worktree wizard, configurable file preparation, and recoverable development layouts. The original documentation is preserved in [UPSTREAM_README.md](UPSTREAM_README.md).

## Workflow

1. Open **Linear · Worktree from Linear issue** from your command palette, or choose **Linear · Find issue by identifier**.
2. Pick an issue from the filtered list or enter its exact identifier, such as `ENG-123`. Exact lookup bypasses the list's team, assignee and status filters, subject to the API key's access permissions.
3. Check the repository and edit the branch name. Linear's `branchName` supplies the initial suggestion; the last choice for this issue and repository is remembered.
4. For a new branch, choose the main checkout's current HEAD, a local branch, a known remote reference, or another reference/commit. References are resolved locally: run `git fetch` yourself first if you need updated remote references. The selected starting commit is resolved before creation.
5. Choose **Shell only**, **Claude Code**, **Codex**, or **Both**.
6. Confirm the summary. The plugin creates or opens the worktree, then prepares local files with visible progress.
7. Press Enter after preparation finishes to launch the panes. No development instructions are sent to either agent automatically.

```text
+---------------------------+---------------------------+
| Codex                     | Linear issue              |
|                           |                           |
+---------------------------+---------------------------+
| Claude Code               | LazyGit                   |
|                           |                           |
+---------------------------+---------------------------+
```

With one agent or a shell, the left column is a single pane. In Both mode, the agents share the same files. Existing branches retain their history; reopening never resets a branch or copies uncommitted changes from the main checkout.

## Reopening worktrees

Pane roles are identified through Herdr metadata. Existing managed panes are never restarted. Changing the selected mode adds missing roles while preserving existing ones; close unwanted panes yourself.

For worktrees previously configured by this fork, the `worktree.opened` hook offers visible preparation and restoration after a native reopen. Press Enter to recreate missing panes. If every requested role is present, the hook does nothing. Unrecognized workspaces are left alone.

An already-open workspace without identifiable managed panes receives a new workflow tab, preserving all existing terminals. A new tab may therefore also appear after a native reopen. Panes manually distributed across multiple tabs are not repaired automatically; a message asks you to group them first.

Closing a workspace terminates its processes. Reopening starts new processes for missing roles; it does not automatically resume previous Claude Code or Codex conversations.

## Install

Requirements: Herdr 0.9+, Node 22+, Python 3 for file preparation, Git and LazyGit. Install `claude` and/or `codex` for the corresponding modes. fzf is optional; a numbered picker is available as a fallback.

Clone this fork and run the activation script **from a Herdr terminal**:

```sh
git clone https://github.com/Kakahn/herdr-worktree-from-linear.git
cd herdr-worktree-from-linear
git checkout feature/worktree-workflow
bash scripts/activate.sh
```

The script copies the original plugin's personal settings into the private `kakahn.worktree-from-linear` configuration directory without printing the API key. An existing fork configuration is preserved. It links this local fork, then disables the original plugin. Your command palette shortcut does not change, and the Herdr server does not need to restart.

To switch back:

```sh
bash scripts/rollback.sh
```

Worktrees, panes and personal settings are preserved.

## Configuration

Start from [config.example.json](config.example.json). Keep your API key in the private plugin `config.json` or `LINEAR_API_KEY`, never in this repository. The private `workflow-state.json` stores branch choices, tool modes and local paths; do not share it either.

| Setting | Purpose |
| --- | --- |
| `teamKey`, `assignedToMe`, `includeTriage`, `issueLimit` | Issue list filters inherited from upstream |
| `placement`, `popupWidth`, `popupHeight` | Issue picker placement and size |
| `network.ipv4Only` | Optional IPv4 connection workaround; disabled by default |
| `network.timeoutMs` | Maximum duration of a Linear request |
| `preparation.enabled` | File preparation, enabled unless explicitly disabled |
| `preparation.machineFile` | Optional machine settings path; `~/` is supported |
| `preparation.rulesFile` | Optional file preparation rules path; `~/` is supported |
| `repos` | Optional Linear team key to local repository path mapping |

Without a `repos` mapping, the invoking terminal determines the repository. The wizard replaces the upstream `base` setting with an interactive choice and always includes the issue details in its layout.

### File preparation

Preparation is independent of any desktop app or company repository structure. Configure your own repository paths and copy/link rules:

- Put `machine.json` in the private plugin configuration directory, using [setup/machine.example.json](setup/machine.example.json) as a starting point.
- Put `rules.json` alongside it to override the generic examples in [setup/rules.json](setup/rules.json).
- Match repository keys between these two files. Paths belong to your local configuration, not the shared plugin.
- Alternatively, point `preparation.machineFile` and `preparation.rulesFile` to existing compatible files.
- Set `preparation.enabled` to `false` explicitly if a project needs no file preparation.

The helper copies only missing, ignored, untracked local files and preserves existing destinations. New file copies use private permissions. Unsafe symlinks and tracked destinations are rejected. Optional shared resource directories can be linked. No code from the worktree is executed, dependencies are not installed, and containers are not started.

Application directories absent from the selected commit are reported and skipped. A worktree contains committed code only: copying an environment file cannot add an uncommitted application.

If preparation fails, the worktree and any completed preparation remain in place. Fix the reported problem, then select the issue again; its custom branch name was saved before preparation began. Agents launch only after successful preparation and confirmation. Avoid configuring another setup hook to copy the same files concurrently.

## Tests

```sh
node --test
python3 setup/test_prepare.py
```

Tests use disposable Git repositories/worktrees and simulated Herdr responses. They do not control a live session, call Linear, or launch agents. See [VERIFICATION.md](VERIFICATION.md) for the verification scope and remaining manual checks.

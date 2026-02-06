# Diagnostics

This file tracks temporary diagnostic logging so it can be removed later.

## Git command logging

- File: `state/logs/git-commands.log`
- Purpose: Track git commands executed during project chat patch application.
- Added details:
  - `# patch_file` entry logs `projectRootAbs`, `diffLength`, and `diffHash`.
  - `# apply_patch` entries log patch ops and file sizes after writes.
  - `# stash_diff` entry logs stash ref and diff length.

Remove when patch flow is stable.

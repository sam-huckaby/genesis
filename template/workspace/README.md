# Seed Workspace

This workspace contains a Seed harness and one or more projects it grows.

Ripgrep (rg) is required: https://github.com/BurntSushi/ripgrep

## Tool test suite

Run from `seed/server`:

```bash
  bun install
  node --test --import tsx
```

## edit_file tool (small edits)

Use `edit_file` for most changes. It is the preferred tool for small edits and should be used first. It requires a `expectedSha256` precondition from `read_file`.

Example (append):

```json
{
  "mode": "append",
  "path": "AGENT.md",
  "expectedSha256": "<sha256>",
  "text": "\n### Reminder\n- Kids like cake.\n"
}
```

Modes:

- `anchor_replace`: replace content between anchors
  - `before: { type: "text", value: string }`
  - `after: { type: "text", value: string } | { type: "eof" }`
  - `replacement: string`
- `insert_after`: insert text immediately after an anchor
  - `anchor: { type: "text", value: string }`
  - `text: string`
- `append`: append text to EOF
  - `text: string`

Anchors are literal and must not overlap. If they do, `OVERLAPPING_ANCHORS` is returned with conflicting ranges.

Large multi-file unified diffs should use `apply_unified_diff`.

## apply_patch tool (OpenAI schema)

`apply_patch` matches the OpenAI tool schema and accepts a single V4A diff operation:

- `create_file` with a V4A diff (all lines start with `+`)
- `update_file` with a V4A diff (context/+- lines)
- `delete_file` with no diff

This tool enforces the same filesystem guardrails as `edit_file`.

Example (update_file):

```json
{
  "operation": {
    "type": "update_file",
    "path": "lib/fib.py",
    "diff": "@@\n-def fib(n):\n+def fibonacci(n):\n"
  }
}
```

To start the local server:

    seed open .

If the server is already running, open:

    http://localhost:3333

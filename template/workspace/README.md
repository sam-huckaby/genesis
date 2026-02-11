# Seed Workspace

This workspace contains a Seed harness and one or more projects it grows.

Ripgrep (rg) is required: https://github.com/BurntSushi/ripgrep

## Tool test suite

Run from `seed/server`:

```bash
  bun install
  node --test --import tsx
```

To start the local server:

    seed open .

If the server is already running, open:

    http://localhost:3333

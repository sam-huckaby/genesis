import { execFileSync } from "node:child_process";

const RIPGREP_URL = "https://github.com/BurntSushi/ripgrep";

export function validateWorkspaceName(name: string) {
  if (!/^[a-z0-9-]+$/.test(name)) {
    console.error(
      "Workspace name must contain only lowercase letters, numbers, and hyphens."
    );
    process.exit(1);
  }
}

export function validateRipgrep() {
  try {
    execFileSync("rg", ["--version"], { stdio: "ignore" });
  } catch {
    console.error(`ripgrep (rg) is required. Install from ${RIPGREP_URL}`);
    process.exit(1);
  }
}

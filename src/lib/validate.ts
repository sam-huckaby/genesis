export function validateWorkspaceName(name: string) {
  if (!/^[a-z0-9-]+$/.test(name)) {
    console.error(
      "Workspace name must contain only lowercase letters, numbers, and hyphens."
    );
    process.exit(1);
  }
}

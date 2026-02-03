import path from "node:path";
import fs from "fs-extra";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export async function copyWorkspaceTemplate(targetDir: string) {
  const templateDir = path.resolve(__dirname, "../../template/workspace");

  if (!(await fs.pathExists(templateDir))) {
    throw new Error(`Template directory not found: ${templateDir}`);
  }

  await fs.copy(templateDir, targetDir, {
    overwrite: false,
    errorOnExist: true
  });
}

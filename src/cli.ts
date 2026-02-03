#!/usr/bin/env node
import { Command } from "commander";
import { initCommand } from "./commands/init.js";

const program = new Command();

program
  .name("seed")
  .description("Seed - create and grow living applications")
  .version("0.0.1");

program
  .command("init")
  .argument("<workspace-name>", "Name of the new seed workspace")
  .option("--skip-install", "Skip bun install in the new workspace")
  .description("Create a new seed workspace")
  .action(async (workspaceName: string, options: { skipInstall?: boolean }) => {
    await initCommand(workspaceName, options);
  });

program.parse(process.argv);

import type { ProjectAdapter, ProjectType } from "./adapter.types.js";
import { createNextJsAdapter } from "./nextjs.adapter.js";
import { createGoAdapter } from "./go.adapter.js";
import { createOcamlDuneAdapter } from "./ocaml_dune.adapter.js";

const adapters: ProjectAdapter[] = [
  createNextJsAdapter(),
  createGoAdapter(),
  createOcamlDuneAdapter()
];

export function listAdapters(): ProjectAdapter[] {
  return adapters;
}

export function getAdapterByType(type: ProjectType): ProjectAdapter | undefined {
  return adapters.find((adapter) => adapter.id() === type);
}

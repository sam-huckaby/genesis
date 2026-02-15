import { spec as listFilesSpec } from "./list_files.js";
import { spec as readFileSpec } from "./read_file.js";
import { spec as readFilesSpec } from "./read_files.js";
import { spec as statSpec } from "./stat.js";
import { spec as grepSpec } from "./grep.js";
import { spec as projectInfoSpec } from "./project_info.js";
import { spec as applyPatchSpec } from "./apply_patch_tool.js";
import { spec as applyUnifiedDiffSpec } from "./apply_patch.js";
import { spec as editFileSpec } from "./edit_file.js";
import { spec as gitStatusSpec } from "./git_status.js";
import { spec as gitDiffSpec } from "./git_diff.js";
import { spec as searchToolsSpec } from "./search_tools.js";
import { spec as describeToolSpec } from "./describe_tool.js";
import { spec as buildLoopStartSpec } from "./build_loop_start.js";
import { spec as buildLoopStopSpec } from "./build_loop_stop.js";
import { spec as getBuildLoopsSpec } from "./get_build_loops.js";
import { spec as getBuildLoopDetailSpec } from "./get_build_loop_detail.js";
import type { ToolSpec } from "./tool_spec.js";

export const TOOL_SPECS: ToolSpec[] = [
  listFilesSpec,
  readFileSpec,
  readFilesSpec,
  statSpec,
  grepSpec,
  projectInfoSpec,
  editFileSpec,
  applyPatchSpec,
  applyUnifiedDiffSpec,
  gitStatusSpec,
  gitDiffSpec,
  searchToolsSpec,
  describeToolSpec,
  buildLoopStartSpec,
  buildLoopStopSpec,
  getBuildLoopsSpec,
  getBuildLoopDetailSpec
];

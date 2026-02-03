import { useEffect, useState } from "react";
import { apiGet, apiPost } from "../api/client.js";
import type { ChangesetDetail, ChangesetSummary } from "@shared/types";

type DiffView = "inline" | "split";

function renderDiffInline(diff: string) {
  return <pre className="diff-block">{diff}</pre>;
}

function renderDiffSplit(diff: string) {
  const lines = diff.split("\n");
  return (
    <div className="diff-split">
      <pre>
        {lines
          .filter((line) => !line.startsWith("+++ ") && !line.startsWith("@@") && !line.startsWith("diff --git"))
          .map((line, index) => (
            <div key={`l-${index}`} className={line.startsWith("-") ? "diff-removed" : "diff-context"}>
              {line.startsWith("+") ? "" : line}
            </div>
          ))}
      </pre>
      <pre>
        {lines
          .filter((line) => !line.startsWith("--- ") && !line.startsWith("@@") && !line.startsWith("diff --git"))
          .map((line, index) => (
            <div key={`r-${index}`} className={line.startsWith("+") ? "diff-added" : "diff-context"}>
              {line.startsWith("-") ? "" : line}
            </div>
          ))}
      </pre>
    </div>
  );
}

export default function Review() {
  const [changesets, setChangesets] = useState<ChangesetSummary[]>([]);
  const [selected, setSelected] = useState<ChangesetDetail | null>(null);
  const [view, setView] = useState<DiffView>("inline");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    apiGet<{ changesets: ChangesetSummary[] }>("/api/changesets/pending")
      .then((data) => setChangesets(data.changesets ?? []))
      .catch(() => setChangesets([]));
  }, []);

  const loadChangeset = async (id: number) => {
    const detail = await apiGet<ChangesetDetail>(`/api/changesets/${id}`);
    setSelected(detail);
  };

  const applyChangeset = async () => {
    if (!selected) {
      return;
    }
    try {
      await apiPost(`/api/changesets/${selected.id}/apply`, {});
      setMessage("Changeset applied and committed.");
      setSelected(null);
      const data = await apiGet<{ changesets: ChangesetSummary[] }>("/api/changesets/pending");
      setChangesets(data.changesets ?? []);
    } catch (error) {
      setMessage("Changeset conflict. Re-propose on latest code.");
    }
  };

  return (
    <section>
      <h1>Review</h1>
      {message ? <p>{message}</p> : null}

      <div className="panel">
        <h2>Pending changesets</h2>
        {changesets.length === 0 ? <p>No pending changesets.</p> : null}
        <ul>
          {changesets.map((cs) => (
            <li key={cs.id}>
              <button type="button" onClick={() => loadChangeset(cs.id)}>
                #{cs.id} {cs.summary}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {selected ? (
        <div className="panel">
          <h2>Changeset #{selected.id}</h2>
          <div className="task-actions">
            <button type="button" onClick={() => setView("inline")}
              disabled={view === "inline"}
            >
              Inline
            </button>
            <button type="button" onClick={() => setView("split")}
              disabled={view === "split"}
            >
              Side-by-side
            </button>
            <button type="button" onClick={applyChangeset}>
              Apply changeset
            </button>
          </div>
          {selected.files.map((file) => (
            <div key={file.path} className="diff-file">
              <h3>{file.path}</h3>
              {view === "inline" ? renderDiffInline(file.diff) : renderDiffSplit(file.diff)}
            </div>
          ))}
          {message === "Changeset conflict. Re-propose on latest code." ? (
            <button type="button">Re-propose with agent</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

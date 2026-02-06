import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet, apiPost } from "../api/client.js";
import Button from "../components/Button.js";
import type {
  ChangesetChatMessage,
  ChangesetDetail,
  ChangesetRebuildResponse,
  ChangesetSummary,
  ChangesetTestResponse
} from "@shared/types";

type DiffView = "inline" | "split";

type ToastState = {
  changesetId: number;
  summary: string;
};

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

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const error = new Error(`Request failed: ${res.status}`) as Error & {
      status?: number;
      data?: unknown;
    };
    error.status = res.status;
    error.data = data ?? undefined;
    throw error;
  }
  return data as T;
}

export default function Review() {
  const [changesets, setChangesets] = useState<ChangesetSummary[]>([]);
  const [selected, setSelected] = useState<ChangesetDetail | null>(null);
  const [view, setView] = useState<DiffView>("inline");
  const [message, setMessage] = useState<string | null>(null);
  const [testWarning, setTestWarning] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isRebuilding, setIsRebuilding] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<ChangesetChatMessage[]>([]);
  const [closeReason, setCloseReason] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const toastTimer = useRef<number | null>(null);

  const loadChangesets = async () => {
    try {
      const data = await apiGet<{ changesets: ChangesetSummary[] }>("/api/changesets/pending");
      setChangesets(data.changesets ?? []);
    } catch {
      setChangesets([]);
    }
  };

  const loadMessages = async (id: number) => {
    try {
      const data = await apiGet<{ messages: ChangesetChatMessage[] }>(
        `/api/changesets/${id}/messages`
      );
      setChatMessages(data.messages ?? []);
    } catch {
      setChatMessages([]);
    }
  };

  useEffect(() => {
    loadChangesets();
    return () => {
      if (toastTimer.current) {
        window.clearTimeout(toastTimer.current);
      }
    };
  }, []);

  const loadChangeset = async (id: number) => {
    setMessage(null);
    setTestWarning(null);
    setIsTesting(false);
    setCloseReason("");
    const detail = await apiGet<ChangesetDetail>(`/api/changesets/${id}`);
    setSelected(detail);
    await loadMessages(id);
  };

  const applyChangeset = async () => {
    if (!selected) {
      return;
    }
    try {
      await apiPost(`/api/changesets/${selected.id}/apply`, {});
      setMessage("Changeset applied and committed.");
      setSelected(null);
      setIsTesting(false);
      await loadChangesets();
    } catch {
      setMessage("Changeset conflict. Proposal blocked.");
      await loadChangesets();
    }
  };

  const closeChangeset = async () => {
    if (!selected) {
      return;
    }
    await apiPost(`/api/changesets/${selected.id}/close`, { reason: closeReason.trim() || undefined });
    setMessage("Proposal closed.");
    setSelected(null);
    setCloseReason("");
    setIsTesting(false);
    await loadChangesets();
  };

  const handleTest = async (force = false) => {
    if (!selected) {
      return;
    }
    setMessage(null);
    setTestWarning(null);
    try {
      const response = await postJson<ChangesetTestResponse>(
        `/api/changesets/${selected.id}/test`,
        force ? { force: true } : {}
      );
      if (response.applied) {
        setIsTesting(true);
        setMessage("Changes applied for testing.");
      }
    } catch (error) {
      const status = (error as { status?: number }).status;
      const data = (error as { data?: { warning?: string } }).data;
      if (status === 409 && data?.warning) {
        setTestWarning(data.warning);
        return;
      }
      setMessage("Unable to test changes.");
      await loadChangesets();
    }
  };

  const stopTest = async () => {
    if (!selected) {
      return;
    }
    await apiPost(`/api/changesets/${selected.id}/stop-test`, {});
    setIsTesting(false);
    setMessage("Test changes cleaned up.");
  };

  const handleRebuild = async () => {
    if (!selected) {
      return;
    }
    setIsRebuilding(true);
    setMessage(null);
    try {
      const response = await postJson<ChangesetRebuildResponse>(
        `/api/changesets/${selected.id}/rebuild`,
        { mode: "branch" }
      );
      if (response.changesetId) {
        setToast({ changesetId: response.changesetId, summary: selected.summary });
        if (toastTimer.current) {
          window.clearTimeout(toastTimer.current);
        }
        toastTimer.current = window.setTimeout(() => setToast(null), 10000);
      }
      await loadChangesets();
      setIsRebuilding(false);
    } catch {
      setMessage("Unable to rebuild proposal.");
      await loadChangesets();
      setIsRebuilding(false);
    }
  };

  const sendChat = async () => {
    if (!selected || !chatInput.trim()) {
      return;
    }
    const content = chatInput.trim();
    setChatInput("");
    await apiPost(`/api/changesets/${selected.id}/messages`, {
      role: "user",
      content
    });
    setChatMessages((prev: ChangesetChatMessage[]) => [...prev, { role: "user", content }]);
  };

  const orderedChangesets = useMemo(() => {
    return [...changesets].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  }, [changesets]);

  return (
    <section className="review-shell">
      <header className="review-header">
        <div>
          <h1>Review</h1>
          <p className="muted">Verify proposals, test them, and accept changes when ready.</p>
        </div>
      </header>

      {toast ? (
        <div className="review-toast">
          <div>
            Branched proposal created: #{toast.changesetId} {toast.summary}
          </div>
          <Button type="button" variant="secondary" onClick={() => loadChangeset(toast.changesetId)}>
            Open
          </Button>
        </div>
      ) : null}

      {message ? <div className="review-alert">{message}</div> : null}

      <div className="review-layout">
        <div className="panel review-list">
          <h2>Proposals</h2>
          {orderedChangesets.length === 0 ? <p className="muted">No proposals to review.</p> : null}
          <div className="review-list-items">
            {orderedChangesets.map((cs) => (
              <button
                key={cs.id}
                type="button"
                className={`review-list-item ${selected?.id === cs.id ? "is-active" : ""}`}
                onClick={() => loadChangeset(cs.id)}
              >
                <div className="review-list-title">#{cs.id} {cs.summary}</div>
                <div className="review-list-meta">
                  <span className="status-pill">{cs.status}</span>
                  {cs.status === "draft" ? (
                    <span className="draft-pill">Draft proposal in progress</span>
                  ) : null}
                  <span className="muted">{new Date(cs.createdAt).toLocaleString()}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="review-detail">
          {selected ? (
            <>
              <div className="panel review-summary">
                <div className="review-summary-row">
                  <div>
                    <h2>Changeset #{selected.id}</h2>
                    <p className="muted">{selected.summary}</p>
                  </div>
                  <span className="status-pill">{selected.status}</span>
                </div>
                <div className="review-meta">
                  <span>Base: {selected.baseRevision.slice(0, 7)}</span>
                  {selected.createdAt ? (
                    <span>Created: {new Date(selected.createdAt).toLocaleString()}</span>
                  ) : null}
                  {selected.parentId ? (
                    <button type="button" className="link-button" onClick={() => loadChangeset(selected.parentId ?? 0)}>
                      View parent #{selected.parentId}
                    </button>
                  ) : null}
                </div>
                {selected.closeReason ? (
                  <p className="muted">Close reason: {selected.closeReason}</p>
                ) : null}
              </div>

              <div className="panel review-actions">
                <div className="review-actions-row">
                  <div className="card-actions">
                    <Button
                      type="button"
                      variant={view === "inline" ? "secondary" : "tertiary"}
                      active={view === "inline"}
                      onClick={() => setView("inline")}
                    >
                      Inline
                    </Button>
                    <Button
                      type="button"
                      variant={view === "split" ? "secondary" : "tertiary"}
                      active={view === "split"}
                      onClick={() => setView("split")}
                    >
                      Side-by-side
                    </Button>
                  </div>
                  <div className="card-actions">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={isTesting ? stopTest : () => handleTest(false)}
                    >
                      {isTesting ? "Stop testing changes" : "Test changes"}
                    </Button>
                    <Button
                      type="button"
                      variant="tertiary"
                      disabled={isRebuilding || selected.status === "rebuilding"}
                      onClick={handleRebuild}
                    >
                      {selected.status === "rebuilding" || isRebuilding
                        ? "Rebuilding..."
                        : "Rebuild this proposal"}
                    </Button>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={applyChangeset}
                      disabled={selected.status !== "pending" && selected.status !== "draft"}
                    >
                      Accept Changes
                    </Button>
                  </div>
                </div>
                <div className="review-close-row">
                  <input
                    value={closeReason}
                    onChange={(event) => setCloseReason(event.target.value)}
                    placeholder="Optional close reason"
                  />
                  <Button type="button" variant="secondary" onClick={closeChangeset}>
                    Close Proposal
                  </Button>
                </div>
              </div>

              {testWarning ? (
                <div className="panel review-warning">
                  <p className="muted">
                    Working tree not clean. Testing will reset local changes.
                  </p>
                  <Button type="button" variant="secondary" onClick={() => handleTest(true)}>
                    Test anyway
                  </Button>
                </div>
              ) : null}

              {selected.files.map((file) => (
                <div key={file.path} className="diff-file">
                  <h3>{file.path}</h3>
                  {view === "inline" ? renderDiffInline(file.diff) : renderDiffSplit(file.diff)}
                </div>
              ))}

              <div className="panel review-chat-log">
                <h3>Proposal chat</h3>
                {chatMessages.length === 0 ? (
                  <p className="muted">No chat messages yet.</p>
                ) : (
                  <div className="review-chat-messages">
                    {chatMessages.map((entry, index) => (
                      <div key={`${entry.role}-${index}`} className="chat-message">
                        <strong>{entry.role}</strong>: {entry.content}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="panel review-empty">
              <p className="muted">Select a proposal to inspect details and chat.</p>
            </div>
          )}
        </div>
      </div>

      <div className="review-chat-composer">
        <div className="review-chat-inner">
          <textarea
            rows={3}
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            placeholder={selected ? "Send a note to the agent..." : "Select a proposal to chat"}
            disabled={!selected}
          />
          <div className="card-actions">
            <Button type="button" onClick={sendChat} disabled={!selected || !chatInput.trim()}>
              Send
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}

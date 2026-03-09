import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client.js";
import Card from "../components/Card.js";
import Button from "../components/Button.js";

type OnboardingState = {
  hasApiKey: boolean;
  openaiAuth?: {
    hasApiKey: boolean;
    hasOAuth: boolean;
    mode: "api_key" | "oauth" | null;
  };
  projects: { name: string; type: string; root_path_rel: string }[];
};

type OAuthStatusResponse = {
  status: "idle" | "awaiting_callback" | "processing" | "success" | "error";
  message?: string;
};

export default function Onboarding() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [oauthInput, setOauthInput] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(true);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  const refreshState = async () => {
    const data = await apiGet<OnboardingState>("/api/onboarding/state");
    setState(data);
    if (data.openaiAuth?.mode) {
      setShowKeyForm(false);
    }
  };

  useEffect(() => {
    refreshState()
      .catch(() => setState(null));
  }, []);

  const hasOpenAiAuth = state?.hasApiKey ?? false;
  const hasProjects = (state?.projects ?? []).length > 0;
  const authMode = state?.openaiAuth?.mode ?? null;

  const projectBadge = useMemo(
    () => ({
      nextjs: "Next",
      go_service: "Go",
      ocaml_dune: "OCaml"
    }),
    []
  );

  const saveApiKey = async () => {
    if (!apiKey) {
      setMessage("Enter an API key first.");
      return;
    }
    try {
      setMessage(null);
      await apiPost("/api/onboarding/api-key", { provider: "openai", apiKey });
      setShowKeyForm(false);
      await refreshState();
      window.dispatchEvent(new Event("seed:workspace-nav-updated"));
    } catch {
      setMessage("Failed to save API key.");
    }
  };

  const startOAuth = async () => {
    setIsAuthenticating(true);
    setMessage(null);
    try {
      const response = await apiPost<{ ok: boolean; url: string }>(
        "/api/onboarding/openai/oauth/start",
        {}
      );
      const popup = window.open(response.url, "seed-openai-oauth", "width=560,height=720");
      if (!popup) {
        setIsAuthenticating(false);
        setMessage("Popup blocked. Allow popups, then try Auth with OpenAI again.");
        return;
      }

      const startedAt = Date.now();
      const pollInterval = window.setInterval(() => {
        apiGet<OAuthStatusResponse>("/api/onboarding/openai/oauth/status")
          .then(async (status) => {
            if (status.status === "success") {
              window.clearInterval(pollInterval);
              setIsAuthenticating(false);
              await refreshState();
              setShowKeyForm(false);
              window.dispatchEvent(new Event("seed:workspace-nav-updated"));
              return;
            }

            if (status.status === "error") {
              window.clearInterval(pollInterval);
              setIsAuthenticating(false);
              setMessage(status.message ?? "OpenAI auth failed.");
              return;
            }

            if (Date.now() - startedAt > 2 * 60 * 1000) {
              window.clearInterval(pollInterval);
              setIsAuthenticating(false);
              setMessage("OpenAI auth timed out. Try again or paste the callback URL manually.");
            }
          })
          .catch(() => {
            window.clearInterval(pollInterval);
            setIsAuthenticating(false);
            setMessage("Failed to verify OpenAI auth status.");
          });
      }, 1500);
    } catch {
      setIsAuthenticating(false);
      setMessage("Failed to start OpenAI auth.");
    }
  };

  const completeOAuthManually = async () => {
    if (!oauthInput.trim()) {
      setMessage("Paste the OAuth callback URL first.");
      return;
    }
    setIsAuthenticating(true);
    setMessage(null);
    try {
      await apiPost("/api/onboarding/openai/oauth/manual", { input: oauthInput.trim() });
      setOauthInput("");
      await refreshState();
      setShowKeyForm(false);
      window.dispatchEvent(new Event("seed:workspace-nav-updated"));
    } catch {
      setMessage("Manual OpenAI auth failed.");
    } finally {
      setIsAuthenticating(false);
    }
  };

  if (!hasOpenAiAuth) {
    return (
      <section className="onboarding onboarding-centered">
        <Card
          title="Auth with OpenAI"
          footer={
            <div className="card-actions">
              <Button type="button" onClick={startOAuth} disabled={isAuthenticating}>
                {isAuthenticating ? "Authorizing..." : "Auth with OpenAI"}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setShowKeyForm(!showKeyForm)}>
                {showKeyForm ? "Hide API key" : "Use API key instead"}
              </Button>
            </div>
          }
        >
          <p className="muted">
            Connect with your ChatGPT subscription, or paste an OpenAI API key as fallback.
          </p>
          {showKeyForm ? (
            <div>
              <input
                type="password"
                placeholder="OpenAI API key"
                value={apiKey}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setApiKey(event.target.value)
                }
              />
              <div className="card-actions" style={{ marginTop: 8 }}>
                <Button type="button" onClick={saveApiKey}>
                  Save key
                </Button>
              </div>
            </div>
          ) : null}
          <div style={{ marginTop: 10 }}>
            <input
              type="text"
              placeholder="Paste OAuth callback URL"
              value={oauthInput}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setOauthInput(event.target.value)
              }
            />
            <div className="card-actions" style={{ marginTop: 8 }}>
              <Button type="button" variant="tertiary" onClick={completeOAuthManually}>
                Complete manual auth
              </Button>
            </div>
          </div>
          {message ? <p className="error-indicator">{message}</p> : null}
        </Card>
      </section>
    );
  }

  const showExisting = hasProjects;

  return (
    <section className={`onboarding ${hasProjects ? "" : "onboarding-centered"}`}>
      <div className="onboarding-header">
        <div>
          <h1>Onboarding</h1>
          <p className="muted">
            Set up your workspace, then start discovery to build a new project.
          </p>
        </div>
      </div>
      {message ? <p>{message}</p> : null}
      <div
        className={
          hasProjects ? "onboarding-grid onboarding-grid-projects" : "onboarding-centered-grid"
        }
      >
        <div className="onboarding-item onboarding-item-api">
          <Card
            title="OpenAI auth"
            headerMeta={
              hasOpenAiAuth ? (
                <span className="status-pill success">Installed</span>
              ) : (
                <span className="status-pill">Needed</span>
              )
            }
            footer={
              !showKeyForm ? (
                <div className="card-actions">
                  <Button type="button" onClick={startOAuth} disabled={isAuthenticating}>
                    {isAuthenticating ? "Authorizing..." : "Auth with OpenAI"}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setShowKeyForm(true)}>
                    Use API key
                  </Button>
                </div>
              ) : (
                <div className="card-actions">
                  <Button type="button" onClick={saveApiKey}>
                    Save key
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setShowKeyForm(false)}>
                    Cancel
                  </Button>
                </div>
              )
            }
          >
            <p className="muted">
              Required for discovery and generation. Current method: {authMode === "oauth"
                ? "OpenAI OAuth"
                : authMode === "api_key"
                  ? "API key"
                  : "Not configured"}
            </p>
            {showKeyForm ? (
              <div>
                <input
                  type="password"
                  placeholder="OpenAI API key"
                  value={apiKey}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setApiKey(event.target.value)
                  }
                />
                <input
                  type="text"
                  placeholder="Paste OAuth callback URL"
                  value={oauthInput}
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    setOauthInput(event.target.value)
                  }
                  style={{ marginTop: 8 }}
                />
                <div className="card-actions" style={{ marginTop: 8 }}>
                  <Button type="button" variant="tertiary" onClick={completeOAuthManually}>
                    Complete manual auth
                  </Button>
                </div>
              </div>
            ) : null}
          </Card>
        </div>

        <div className="onboarding-item onboarding-item-discovery">
          <Card
            title="Start new project"
            footer={
              <Link className="btn btn-primary" to="/discovery">
                Start discovery
              </Link>
            }
          >
            <p className="muted">Describe your app and get a scaffold recommendation.</p>
          </Card>
        </div>

        {showExisting ? (
          <div className="onboarding-item onboarding-item-projects">
            <Card title="Existing projects">
              {state?.projects?.length ? (
                <ul className="project-list">
                  {state.projects.map((project) => (
                    <li key={project.name} className="project-row">
                      <span className="badge">
                        {projectBadge[project.type as keyof typeof projectBadge] ?? "App"}
                      </span>
                      <Link to={`/projects/${encodeURIComponent(project.name)}/chat`}>{project.name}</Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No projects yet.</p>
              )}
            </Card>
          </div>
        ) : null}
      </div>
    </section>
  );
}

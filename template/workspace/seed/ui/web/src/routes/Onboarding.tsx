import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { apiGet, apiPost } from "../api/client.js";
import Card from "../components/Card.js";
import Button from "../components/Button.js";

type OnboardingState = {
  hasApiKey: boolean;
  projects: { name: string; type: string; root_path_rel: string }[];
};

export default function Onboarding() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [showKeyForm, setShowKeyForm] = useState(true);

  useEffect(() => {
    apiGet<OnboardingState>("/api/onboarding/state")
      .then((data) => {
        setState(data);
        setShowKeyForm(!data.hasApiKey);
      })
      .catch(() => setState(null));
  }, []);

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
      await apiPost("/api/onboarding/api-key", { provider: "openai", apiKey });
      setMessage("API key saved.");
      setShowKeyForm(false);
    } catch (error) {
      setMessage("Failed to save API key.");
    }
  };

  return (
    <section className="onboarding">
      <div className="onboarding-header">
        <div>
          <h1>Onboarding</h1>
          <p className="muted">
            Set up your workspace, then start discovery to build a new project.
          </p>
        </div>
      </div>
      {message ? <p>{message}</p> : null}
      <div className="onboarding-grid">
        <Card title="API key">
          <div className="card-header">
            {state?.hasApiKey ? (
              <span className="status-pill success">Installed</span>
            ) : (
              <span className="status-pill">Needed</span>
            )}
          </div>
          <p className="muted">Required for discovery and generation.</p>
          {showKeyForm ? (
            <div className="card-body">
              <input
                type="password"
                placeholder="OpenAI API key"
                value={apiKey}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setApiKey(event.target.value)
                }
              />
              <div className="card-actions">
                <Button type="button" onClick={saveApiKey}>
                  Save key
                </Button>
                {state?.hasApiKey ? (
                  <Button type="button" variant="secondary" onClick={() => setShowKeyForm(false)}>
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="card-body">
              <div className="status-row">
                <span className="status-icon">✓</span>
                <span>API key is installed for this workspace.</span>
              </div>
              <Button type="button" variant="tertiary" onClick={() => setShowKeyForm(true)}>
                Install new key
              </Button>
            </div>
          )}
        </Card>

        <Card title="Start new project">
          <p className="muted">Describe your app and get a scaffold recommendation.</p>
          <Link className="btn btn-primary" to="/discovery">
            Start discovery
          </Link>
        </Card>

        <Card title="Existing projects">
          {state?.projects?.length ? (
            <ul className="project-list">
              {state.projects.map((project) => (
                <li key={project.name} className="project-row">
                  <span className="badge">
                    {projectBadge[project.type as keyof typeof projectBadge] ?? "App"}
                  </span>
                  <Link to={`/chat?project=${project.name}`}>{project.name}</Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No projects yet.</p>
          )}
        </Card>
      </div>
    </section>
  );
}

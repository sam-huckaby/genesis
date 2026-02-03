import { useEffect, useState, type ChangeEvent } from "react";
import { apiGet, apiPut } from "../api/client.js";
import type { ProjectBrief, SaveProjectBriefRequest } from "@shared/types";
import Card from "../components/Card.js";
import Button from "../components/Button.js";
import { applyTheme, getThemes, loadThemeFromStorage } from "../theme/theme.js";

type ProjectSummary = { name: string };

export default function Settings() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<string>("");
  const [brief, setBrief] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [themes] = useState<string[]>(getThemes());
  const [selectedTheme, setSelectedTheme] = useState<string>("Default");

  useEffect(() => {
    apiGet<{ projects: ProjectSummary[] }>("/api/onboarding/state")
      .then((data) => setProjects(data.projects ?? []))
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    const current = loadThemeFromStorage();
    setSelectedTheme(current);
  }, []);

  const loadBrief = async (projectName: string) => {
    if (!projectName) {
      return;
    }
    try {
      const res = await apiGet<ProjectBrief>(`/api/projects/${projectName}/brief`);
      setBrief(res.briefText ?? "");
      setMessage(null);
    } catch {
      setBrief("");
      setMessage("Failed to load brief.");
    }
  };

  const saveBrief = async () => {
    if (!selectedProject) {
      return;
    }
    const payload: SaveProjectBriefRequest = {
      projectName: selectedProject,
      briefText: brief
    };
    try {
      await apiPut(`/api/projects/${selectedProject}/brief`, payload);
      setMessage("Brief updated.");
      setEditing(false);
    } catch {
      setMessage("Failed to update brief.");
    }
  };

  const updateTheme = (name: string) => {
    setSelectedTheme(name);
    applyTheme(name);
  };

  return (
    <section>
      <h1>Settings</h1>
      {message ? <p>{message}</p> : null}
      <div className="settings-grid">
        <Card title="Theme">
          <label>
            Theme selection
            <select
              value={selectedTheme}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                updateTheme(event.target.value)
              }
            >
              {themes.map((theme: string) => (
                <option key={theme} value={theme}>
                  {theme}
                </option>
              ))}
            </select>
          </label>
        </Card>

        <Card title="Project brief">
          <p className="muted">Editing the brief can cause project drift. Proceed intentionally.</p>
          <label>
            Project
            <select
              value={selectedProject}
              onChange={(event: ChangeEvent<HTMLSelectElement>) => {
                const value = event.target.value;
                setSelectedProject(value);
                setEditing(false);
                loadBrief(value);
              }}
            >
              <option value="">Select a project</option>
              {projects.map((project: ProjectSummary) => (
                <option key={project.name} value={project.name}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          {selectedProject ? (
            <div>
              {editing ? (
                <textarea
                  rows={8}
                  value={brief}
                  onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                    setBrief(event.target.value)
                  }
                />
              ) : (
                <div className="brief-text">{brief || "No brief saved."}</div>
              )}
              <div className="card-actions">
                {editing ? (
                  <Button type="button" onClick={saveBrief}>
                    Save brief
                  </Button>
                ) : (
                  <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                    Edit brief
                  </Button>
                )}
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </section>
  );
}

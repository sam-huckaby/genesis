import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
  useSearchParams
} from "react-router-dom";
import { apiGet, apiPost } from "./api/client.js";
import Onboarding from "./routes/Onboarding.js";
import Discovery from "./routes/Discovery.js";
import Projects from "./routes/Projects.js";
import Tasks from "./routes/Tasks.js";
import TaskDetailPage from "./routes/TaskDetail.js";
import DoneTasksPage from "./routes/DoneTasks.js";
import Chat from "./routes/Chat.js";
import Review from "./routes/Review.js";
import Settings from "./routes/Settings.js";
import type { NavSeenRequest, ProjectNavState, WorkspaceNavState } from "@shared/types";

type WorkspaceStateResponse = {
  workspaceNav?: WorkspaceNavState;
};

function LegacyProjectRedirect(props: { section: "chat" | "tasks" | "review" }) {
  const [params] = useSearchParams();
  const project = params.get("project")?.trim();
  if (!project) {
    return <Navigate to="/projects" replace />;
  }
  const nextQuery = new URLSearchParams(params);
  nextQuery.delete("project");
  const queryString = nextQuery.toString();
  const target = `/projects/${encodeURIComponent(project)}/${props.section}`;
  return <Navigate to={queryString ? `${target}?${queryString}` : target} replace />;
}

function getNavClass(isActive: boolean, isNew: boolean): string {
  const classes = ["app-nav-link"];
  if (isActive) {
    classes.push("active");
  }
  if (isNew) {
    classes.push("is-new");
  }
  return classes.join(" ");
}

export default function App() {
  const location = useLocation();
  const [workspaceNavState, setWorkspaceNavState] = useState<WorkspaceNavState | null>(null);
  const [projectNavState, setProjectNavState] = useState<ProjectNavState | null>(null);
  const projectMatch = useMemo(
    () => location.pathname.match(/^\/projects\/([^/]+)\/(chat|tasks|review)(?:\/.*)?$/),
    [location.pathname]
  );
  const activeProject = projectMatch ? decodeURIComponent(projectMatch[1] ?? "") : "";
  const encodedProject = useMemo(() => encodeURIComponent(activeProject), [activeProject]);
  const isProjectRealm = Boolean(projectMatch);

  const markNavSeen = useCallback(async (body: NavSeenRequest) => {
    await apiPost<{ ok: boolean }>("/api/nav/seen", body);
  }, []);

  const markWorkspaceSeen = useCallback(
    (item: "discovery" | "projects") => {
      setWorkspaceNavState((prev) => {
        if (!prev) {
          return prev;
        }
        if (item === "discovery" && prev.discoverySeen) {
          return prev;
        }
        if (item === "projects" && prev.projectsSeen) {
          return prev;
        }
        return {
          ...prev,
          discoverySeen: item === "discovery" ? true : prev.discoverySeen,
          projectsSeen: item === "projects" ? true : prev.projectsSeen
        };
      });
      markNavSeen({ realm: "workspace", item }).catch(() => {
        return;
      });
    },
    [markNavSeen]
  );

  const markProjectSeen = useCallback(
    (item: "chat" | "tasks" | "review") => {
      setProjectNavState((prev) => {
        if (!prev) {
          return prev;
        }
        if (item === "chat" && prev.chatSeen) {
          return prev;
        }
        if (item === "tasks" && prev.tasksSeen) {
          return prev;
        }
        if (item === "review" && prev.reviewSeen) {
          return prev;
        }
        return {
          ...prev,
          chatSeen: item === "chat" ? true : prev.chatSeen,
          tasksSeen: item === "tasks" ? true : prev.tasksSeen,
          reviewSeen: item === "review" ? true : prev.reviewSeen
        };
      });
      markNavSeen({ realm: "project", item }).catch(() => {
        return;
      });
    },
    [markNavSeen]
  );

  const loadWorkspaceNavState = useCallback(async () => {
    const data = await apiGet<WorkspaceStateResponse>("/api/onboarding/state");
    setWorkspaceNavState(
      data.workspaceNav ?? {
        discoveryUnlocked: false,
        projectsUnlocked: false,
        discoverySeen: false,
        projectsSeen: false
      }
    );
  }, []);

  const loadProjectNavState = useCallback(async (projectName: string) => {
    const data = await apiGet<ProjectNavState>(`/api/projects/${encodeURIComponent(projectName)}/nav`);
    setProjectNavState(data);
  }, []);

  useEffect(() => {
    if (isProjectRealm) {
      return;
    }
    loadWorkspaceNavState().catch(() => {
      setWorkspaceNavState({
        discoveryUnlocked: false,
        projectsUnlocked: false,
        discoverySeen: false,
        projectsSeen: false
      });
    });
  }, [isProjectRealm, loadWorkspaceNavState]);

  useEffect(() => {
    if (!activeProject) {
      setProjectNavState(null);
      return;
    }
    loadProjectNavState(activeProject).catch(() => {
      setProjectNavState({
        projectName: activeProject,
        tasksUnlocked: false,
        reviewUnlocked: false,
        chatSeen: false,
        tasksSeen: false,
        reviewSeen: false
      });
    });
  }, [activeProject, loadProjectNavState]);

  useEffect(() => {
    const handler = () => {
      if (isProjectRealm) {
        return;
      }
      loadWorkspaceNavState().catch(() => {
        return;
      });
    };
    window.addEventListener("seed:workspace-nav-updated", handler);
    return () => window.removeEventListener("seed:workspace-nav-updated", handler);
  }, [isProjectRealm, loadWorkspaceNavState]);

  useEffect(() => {
    if (!activeProject) {
      return;
    }
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ project?: string }>).detail;
      if (!detail?.project || detail.project === activeProject) {
        loadProjectNavState(activeProject).catch(() => {
          return;
        });
      }
    };
    window.addEventListener("seed:project-nav-updated", handler);
    return () => window.removeEventListener("seed:project-nav-updated", handler);
  }, [activeProject, loadProjectNavState]);

  useEffect(() => {
    if (isProjectRealm) {
      if (!projectNavState) {
        return;
      }
      const section = projectMatch?.[2];
      if (section === "chat" && !projectNavState.chatSeen) {
        markProjectSeen("chat");
      }
      if (section === "tasks" && projectNavState.tasksUnlocked && !projectNavState.tasksSeen) {
        markProjectSeen("tasks");
      }
      if (section === "review" && projectNavState.reviewUnlocked && !projectNavState.reviewSeen) {
        markProjectSeen("review");
      }
      return;
    }

    if (!workspaceNavState) {
      return;
    }
    if (
      /^\/discovery\/?$/.test(location.pathname) &&
      workspaceNavState.discoveryUnlocked &&
      !workspaceNavState.discoverySeen
    ) {
      markWorkspaceSeen("discovery");
    }
    if (
      /^\/projects\/?$/.test(location.pathname) &&
      workspaceNavState.projectsUnlocked &&
      !workspaceNavState.projectsSeen
    ) {
      markWorkspaceSeen("projects");
    }
  }, [
    isProjectRealm,
    location.pathname,
    markProjectSeen,
    markWorkspaceSeen,
    projectMatch,
    projectNavState,
    workspaceNavState
  ]);

  return (
    <div className="app-shell">
      <header className="app-header">
        <NavLink to="/" className="app-title-link">Seed</NavLink>
        <nav className="app-nav">
          {isProjectRealm ? (
            <>
                <NavLink
                  to={`/projects/${encodedProject}/chat`}
                  onClick={() => markProjectSeen("chat")}
                  className={({ isActive }) => getNavClass(isActive, !projectNavState?.chatSeen)}
                >
                  Chat
              </NavLink>
              {projectNavState?.tasksUnlocked ? (
                <NavLink
                  to={`/projects/${encodedProject}/tasks`}
                  onClick={() => markProjectSeen("tasks")}
                  className={({ isActive }) => getNavClass(isActive, !projectNavState.tasksSeen)}
                >
                  Tasks
                </NavLink>
              ) : null}
              {projectNavState?.reviewUnlocked ? (
                <NavLink
                  to={`/projects/${encodedProject}/review`}
                  onClick={() => markProjectSeen("review")}
                  className={({ isActive }) => getNavClass(isActive, !projectNavState.reviewSeen)}
                >
                  Review
                </NavLink>
              ) : null}
            </>
          ) : (
            <>
              {workspaceNavState?.projectsUnlocked ? (
                <NavLink
                  to="/projects"
                  onClick={() => markWorkspaceSeen("projects")}
                  className={({ isActive }) =>
                    getNavClass(isActive, Boolean(workspaceNavState && !workspaceNavState.projectsSeen))
                  }
                >
                  Projects
                </NavLink>
              ) : null}
              {workspaceNavState?.discoveryUnlocked ? (
                <NavLink
                  to="/discovery"
                  onClick={() => markWorkspaceSeen("discovery")}
                  className={({ isActive }) =>
                    getNavClass(isActive, Boolean(workspaceNavState && !workspaceNavState.discoverySeen))
                  }
                >
                  Start Discovery
                </NavLink>
              ) : null}
            </>
          )}
        </nav>
      </header>
      <main className="app-content">
        <Routes>
          <Route path="/" element={<Onboarding />} />
          <Route path="/discovery" element={<Discovery />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:project/chat" element={<Chat />} />
          <Route path="/projects/:project/tasks" element={<Tasks />} />
          <Route path="/projects/:project/tasks/done" element={<DoneTasksPage />} />
          <Route path="/projects/:project/tasks/:taskId" element={<TaskDetailPage />} />
          <Route path="/projects/:project/review" element={<Review />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/chat" element={<LegacyProjectRedirect section="chat" />} />
          <Route path="/tasks" element={<LegacyProjectRedirect section="tasks" />} />
          <Route path="/review" element={<LegacyProjectRedirect section="review" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

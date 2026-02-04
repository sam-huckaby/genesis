import { useEffect, useState } from "react";
import { Routes, Route, Link } from "react-router-dom";
import { apiGet } from "./api/client.js";
import Onboarding from "./routes/Onboarding.js";
import Discovery from "./routes/Discovery.js";
import Projects from "./routes/Projects.js";
import Tasks from "./routes/Tasks.js";
import Chat from "./routes/Chat.js";
import Review from "./routes/Review.js";
import Settings from "./routes/Settings.js";

export default function App() {
  const [hasProjects, setHasProjects] = useState(false);
  const [navFade, setNavFade] = useState(false);

  const loadState = () => {
    apiGet<{ projects?: { name: string }[] }>("/api/onboarding/state")
      .then((data) => {
        const nextHasProjects = (data.projects ?? []).length > 0;
        setHasProjects(nextHasProjects);
        if (nextHasProjects) {
          const shown = window.localStorage.getItem("seed.navShownOnce");
          if (!shown) {
            setNavFade(true);
            window.localStorage.setItem("seed.navShownOnce", "true");
            window.setTimeout(() => setNavFade(false), 600);
          }
        }
      })
      .catch(() => setHasProjects(false));
  };

  useEffect(() => {
    loadState();
    const handler = () => loadState();
    window.addEventListener("seed:projects-updated", handler);
    return () => window.removeEventListener("seed:projects-updated", handler);
  }, []);

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">Seed</div>
        {hasProjects ? (
          <nav className={`app-nav ${navFade ? "nav-fade-in" : ""}`}>
            <Link to="/">Onboarding</Link>
            <Link to="/discovery">Discovery</Link>
            <Link to="/projects">Projects</Link>
            <Link to="/tasks">Tasks</Link>
            <Link to="/chat">Chat</Link>
            <Link to="/review">Review</Link>
            <Link to="/settings">Settings</Link>
          </nav>
        ) : null}
      </header>
      <main className="app-content">
        <Routes>
          <Route path="/" element={<Onboarding />} />
          <Route path="/discovery" element={<Discovery />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/review" element={<Review />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </div>
  );
}

import { Routes, Route, Link } from "react-router-dom";
import Onboarding from "./routes/Onboarding.js";
import Discovery from "./routes/Discovery.js";
import Projects from "./routes/Projects.js";
import Tasks from "./routes/Tasks.js";
import Chat from "./routes/Chat.js";
import Review from "./routes/Review.js";
import Settings from "./routes/Settings.js";

export default function App() {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-title">Seed</div>
        <nav className="app-nav">
          <Link to="/">Onboarding</Link>
          <Link to="/discovery">Discovery</Link>
          <Link to="/projects">Projects</Link>
          <Link to="/tasks">Tasks</Link>
          <Link to="/chat">Chat</Link>
          <Link to="/review">Review</Link>
          <Link to="/settings">Settings</Link>
        </nav>
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

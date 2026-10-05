import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./business-plan.css";
import "./task-readiness-panel.css";
import "./operator-todos.css";
import "./project-feedback-panel.css";
import "./project-lifecycle-panel.css";
import "./automation-orchestrator.css";
import "./style.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing product Web root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

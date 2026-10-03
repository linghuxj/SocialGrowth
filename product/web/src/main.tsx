import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.js";
import "./business-plan.css";
import "./operator-todos.css";
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

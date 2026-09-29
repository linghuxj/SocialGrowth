import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

function App() {
  return (
    <main>
      <p className="eyebrow">WP-00 · 工程基础</p>
      <h1>SocialGrowth 正式产品</h1>
      <p>正式实现主线已与现有 Demo 分离。业务页面将在后续工作包中交付。</p>
      <p className="environment">环境标识：product</p>
    </main>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing product Web root element");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

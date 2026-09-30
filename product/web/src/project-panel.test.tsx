import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectPanel } from "./project-panel.js";
test("project panel keeps unloaded facts distinct from an empty list and does not invent approvals", () => {
  const html = renderToStaticMarkup(<ProjectPanel active refreshVersion={0} operators={[]} readOnly={false} onExpired={() => undefined} />);
  assert.ok(html.includes("事实尚未读取")); assert.ok(html.includes("新建项目")); assert.ok(!html.includes("尚无项目")); assert.ok(!html.includes("确认方向"));
});
test("inactive panel stays hidden and mobile entry does not expose project creation", () => {
  const html = renderToStaticMarkup(<ProjectPanel active={false} refreshVersion={0} operators={[]} readOnly onExpired={() => undefined} />);
  assert.ok(html.includes("hidden")); assert.ok(!html.includes("新建项目"));
});

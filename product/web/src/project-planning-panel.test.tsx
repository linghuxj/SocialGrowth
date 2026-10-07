import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProjectPlanningPanel } from "./project-planning-panel.js";
const props = { projectId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", active: true, readOnly: false, onExpired: () => undefined, onFactsChanged: () => undefined };
test("planning panel distinguishes unread facts from empty/approved/running state", () => {
  const html = renderToStaticMarkup(<ProjectPlanningPanel {...props} />); assert.ok(html.includes("事实尚未读取")); assert.ok(!html.includes("批准成功")); assert.ok(!html.includes("开始执行")); assert.ok(!html.includes("2026-10-04"));
});
test("inactive readonly planning panel exposes no save or execution actions", () => {
  const html = renderToStaticMarkup(<ProjectPlanningPanel {...props} active={false} readOnly />); assert.ok(html.includes("hidden")); assert.ok(!html.includes("保存全部草案")); assert.ok(!html.includes("启动项目"));
});

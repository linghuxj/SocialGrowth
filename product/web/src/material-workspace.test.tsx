import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MaterialWorkspace } from "./material-workspace.js";
const projectId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("unread material facts are not an empty library or candidate admission", () => {
  const html = renderToStaticMarkup(<MaterialWorkspace projectId={projectId} active readOnly={false} onExpired={() => undefined} />);
  assert.ok(html.includes("事实尚未读取")); assert.ok(!html.includes("尚无已登记素材"));
  assert.ok(html.includes('type="file"')); assert.ok(html.includes("不是勾选范围"));
  assert.ok(!html.includes("候选已通过")); assert.ok(!html.includes("发布成功"));
});
test("inactive mobile material panel stays hidden and has no file/write actions", () => {
  const html = renderToStaticMarkup(<MaterialWorkspace projectId={projectId} active={false} readOnly onExpired={() => undefined} />);
  assert.ok(html.includes("hidden")); assert.ok(!html.includes('type="file"')); assert.ok(!html.includes(">保存资料<"));
});

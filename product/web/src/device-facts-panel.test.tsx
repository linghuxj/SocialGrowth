import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ListOperatorDeviceFactsResponse } from "@socialgrowth/product-contracts";

import { DeviceFactsPanel } from "./device-facts-panel.js";

const facts: ListOperatorDeviceFactsResponse = {
  readAt: "2026-09-30T00:00:00Z",
  providers: [
    { providerId: "00000000-0000-4000-8000-000000000001", displayName: "甲提供者", phoneLastFour: "1234", status: "active" },
    { providerId: "00000000-0000-4000-8000-000000000002", displayName: "乙提供者", phoneLastFour: "5678", status: "disabled" },
  ],
  devices: [
    {
      deviceId: "00000000-0000-4000-8000-000000000003",
      providerId: "00000000-0000-4000-8000-000000000001",
      displayName: "执行手机甲",
      state: "associated_pending_access",
      connectionState: "unknown",
      lastConfirmedAt: null,
      factVersion: 2,
      updatedAt: "2026-09-29T23:00:00Z",
    },
    {
      deviceId: "00000000-0000-4000-8000-000000000004",
      providerId: "00000000-0000-4000-8000-000000000001",
      displayName: "执行手机乙",
      state: "paused",
      connectionState: "unknown",
      lastConfirmedAt: null,
      factVersion: 3,
      updatedAt: "2026-09-29T23:30:00Z",
    },
  ],
};

test("populated device panel keeps separate devices and an empty provider visible", () => {
  const markup = renderToStaticMarkup(<DeviceFactsPanel facts={facts} loading={false} error="" onRefresh={() => {}} />);
  assert.match(markup, /执行手机甲/);
  assert.match(markup, /执行手机乙/);
  assert.match(markup, /乙提供者/);
  assert.match(markup, /手机号尾号 5678/);
  assert.match(markup, /0 台/);
  assert.match(markup, /连接确认目前没有权威来源/);
  assert.match(markup, /最近确认：暂无/);
  assert.doesNotMatch(markup, /<span[^>]*>在线|<dt>当前项目|<th>发布身份/);
});

test("empty device panel distinguishes no associations from a load error", () => {
  const empty = renderToStaticMarkup(<DeviceFactsPanel facts={{ ...facts, devices: [] }} loading={false} error="" onRefresh={() => {}} />);
  assert.match(empty, /尚无已关联手机/);
  assert.match(empty, /2 位提供者/);
  const error = renderToStaticMarkup(<DeviceFactsPanel facts={null} loading={false} error="读取失败" onRefresh={() => {}} />);
  assert.match(error, /读取失败/);
  assert.match(error, /重试读取/);
  assert.doesNotMatch(error, /尚无已关联手机/);
});

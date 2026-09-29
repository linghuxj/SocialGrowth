import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App, productEnvironment } from "./app.js";

test("product Web renders its heading and explicit environment marker", () => {
  const markup = renderToStaticMarkup(<App />);

  assert.match(markup, /SocialGrowth 正式产品/);
  assert.match(markup, new RegExp(`环境标识：${productEnvironment}`));
  assert.doesNotMatch(markup, /环境标识：demo/i);
});

import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { App, productEnvironment } from "./app.js";

test("product Web renders the authenticated-entry loading state", () => {
  const markup = renderToStaticMarkup(<App />);

  assert.match(markup, /正在验证运营身份/);
  assert.equal(productEnvironment, "product");
  assert.doesNotMatch(markup, /环境：demo/i);
});

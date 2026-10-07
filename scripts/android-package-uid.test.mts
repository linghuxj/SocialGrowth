import assert from "node:assert/strict";
import test from "node:test";
import { parseAndroidPackageUid } from "./android-package-uid.js";

test("accepts Android 16 appId and legacy userId package identity", () => {
  assert.equal(parseAndroidPackageUid("Package [com.socialgrowth.product] (abc):\n  appId=10377"), "10377");
  assert.equal(parseAndroidPackageUid("Package [com.socialgrowth.product] (abc):\n  userId=10377"), "10377");
});

test("accepts repeated matching UID fields and rejects missing or conflicting identity", () => {
  assert.equal(parseAndroidPackageUid("appId=10377 userId=10377"), "10377");
  assert.equal(parseAndroidPackageUid("Package [com.socialgrowth.product]"), undefined);
  assert.throws(() => parseAndroidPackageUid("appId=10377 userId=10378"), /PACKAGE_UID_CONFLICT/);
  assert.throws(() => parseAndroidPackageUid("appId=10377 appId=10378"), /PACKAGE_UID_CONFLICT/);
});

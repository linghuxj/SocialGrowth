import { AppProvisioner } from "./app-readiness.ts";

const provisioner = new AppProvisioner({
  catalogPath: process.env.SG_APP_CATALOG,
  buildTools: process.env.SG_ANDROID_BUILD_TOOLS,
});
const install = process.argv.includes("--install-missing");
for (const packageName of ["com.facebook.katana", "com.google.android.youtube"]) {
  try {
    console.info(JSON.stringify(await provisioner.ensure(process.env.SG_DEVICE_SERIAL ?? "", packageName, install)));
  } catch (error) {
    console.error(JSON.stringify({ packageName, status: "blocked", reason: error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "APP_READINESS_FAILED" }));
    process.exitCode = 1;
  }
}

import { describeExecutorStartup, readExecutorConfig } from "./config.js";

import { startRuntimeFromEnvironment } from "./runtime/server.js";

const config = readExecutorConfig();
console.log(describeExecutorStartup(config));
if (config.SG_PRODUCT_EXECUTOR_MODE === "runtime") startRuntimeFromEnvironment();

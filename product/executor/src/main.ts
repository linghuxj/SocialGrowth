import { describeExecutorStartup, readExecutorConfig } from "./config.js";

console.log(describeExecutorStartup(readExecutorConfig()));

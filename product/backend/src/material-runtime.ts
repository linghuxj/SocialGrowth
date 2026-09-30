import type { OnApplicationShutdown } from "@nestjs/common";
import type { Pool } from "pg";
import { MaterialObjectStorage, MaterialStorageError, parseMaterialStorageConfig, type MaterialStorageConfig } from "./material-object-storage.js";
import { MaterialUploadStore } from "./material-upload-store.js";
import { MaterialRegistryStore } from "./material-registry-store.js";
import type { OperatorAuthService } from "./operator-auth-service.js";
const fields = ["LOCATION_ID", "ENDPOINT", "REGION", "BUCKET", "FORCE_PATH_STYLE", "ACCESS_KEY", "SECRET_KEY", "SESSION_TOKEN", "MAX_OBJECT_BYTES", "REQUEST_TIMEOUT_MS"] as const;
// Explicit trusted server environment only. Never a request body, ambient AWS
// profile/metadata, existing bucket discovery or auto-provisioning path.
export function readMaterialRuntimeConfig(environment: NodeJS.ProcessEnv = process.env): MaterialStorageConfig | null {
  const mode = environment.SG_PRODUCT_MATERIAL_MODE ?? "unavailable";
  if (mode === "unavailable" && fields.every(f => environment[`SG_PRODUCT_MATERIAL_${f}`] === undefined)) return null;
  if (mode !== "configured") throw new MaterialStorageError("CONFIGURATION_REQUIRED");
  const flag = environment.SG_PRODUCT_MATERIAL_FORCE_PATH_STYLE;
  if (flag !== "true" && flag !== "false") throw new MaterialStorageError("CONFIGURATION_REQUIRED");
  if (!/^[1-9][0-9]{0,8}$/.test(environment.SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES ?? "")
    || !/^[1-9][0-9]{0,5}$/.test(environment.SG_PRODUCT_MATERIAL_REQUEST_TIMEOUT_MS ?? "")) throw new MaterialStorageError("CONFIGURATION_REQUIRED");
  return parseMaterialStorageConfig({ storageLocationId: environment.SG_PRODUCT_MATERIAL_LOCATION_ID,
    endpoint: environment.SG_PRODUCT_MATERIAL_ENDPOINT, region: environment.SG_PRODUCT_MATERIAL_REGION, bucket: environment.SG_PRODUCT_MATERIAL_BUCKET,
    forcePathStyle: flag === "true", accessKeyId: environment.SG_PRODUCT_MATERIAL_ACCESS_KEY, secretAccessKey: environment.SG_PRODUCT_MATERIAL_SECRET_KEY,
    ...(environment.SG_PRODUCT_MATERIAL_SESSION_TOKEN !== undefined ? { sessionToken: environment.SG_PRODUCT_MATERIAL_SESSION_TOKEN } : {}),
    maxObjectBytes: Number(environment.SG_PRODUCT_MATERIAL_MAX_OBJECT_BYTES), requestTimeoutMs: Number(environment.SG_PRODUCT_MATERIAL_REQUEST_TIMEOUT_MS) });
}
export class MaterialRuntime implements OnApplicationShutdown {
  #storage: MaterialObjectStorage | null; #uploads: MaterialUploadStore; #registry: MaterialRegistryStore;
  constructor(pool: Pool, auth: OperatorAuthService, config: MaterialStorageConfig | null) {
    this.#storage = config ? new MaterialObjectStorage(config) : null;
    this.#uploads = new MaterialUploadStore(pool, auth, this.#storage);
    this.#registry = new MaterialRegistryStore(pool, auth, this.#storage ? this.#uploads.objectVerifier() : null);
  }
  uploads() { return this.#uploads; }
  registry() { return this.#registry; }
  onApplicationShutdown() { this.#storage?.close(); }
}

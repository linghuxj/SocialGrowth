import { materialObjectReferenceSchema } from "./material-registry-core.js";
import { MaterialRegistryError, type MaterialObjectVerifier } from "./material-registry-store.js";
import { MaterialObjectStorage } from "./material-object-storage.js";
// The protected lookup is a server upload/manifest registry, NOT request body.
// Production upload/location routing remains unconfigured until OPS supplies
// protected bindings. No ambient credential chain, URL or user-selected SDK.
export class MaterialStorageVerifier implements MaterialObjectVerifier {
  constructor(private readonly storage: MaterialObjectStorage, private readonly lookup: (projectId: string, objectId: string) => Promise<unknown>) {}
  async verify(input: { projectId: string; objectIds: string[] }, signal: AbortSignal) {
    const references = [];
    try {
      for (const objectId of input.objectIds) {
        if (signal.aborted) throw new MaterialRegistryError("VERIFIER_UNAVAILABLE");
        const ref = materialObjectReferenceSchema.parse(structuredClone(await this.lookup(input.projectId, objectId)));
        if (ref.projectId !== input.projectId || ref.objectId !== objectId) throw new MaterialRegistryError("INVALID_OBJECTS");
        await this.storage.readVerified(ref); // Actual full SHA/size/type, not manifest existence.
        if (signal.aborted) throw new MaterialRegistryError("VERIFIER_UNAVAILABLE");
        references.push(ref);
      }
      return references;
    } catch (e) { if (e instanceof MaterialRegistryError) throw e; throw new MaterialRegistryError("VERIFIER_UNAVAILABLE"); }
  }
}

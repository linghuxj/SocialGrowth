import { z } from "zod";
import { uuidSchema, timestampSchema } from "./common.js";

export const materialAnalysisOutputSchema = z.strictObject({
  languageTag: z.string().regex(/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/).nullable(),
  title: z.string().min(1).max(150),
  summary: z.string().min(1).max(2000),
  caption: z.string().min(1).max(2000),
  visibleText: z.string().max(3000),
  limitations: z.array(z.string().min(1).max(250)).max(6),
});
export const materialAnalysisResponseSchema = z.strictObject({
  projectId: uuidSchema, objectId: uuidSchema, sha256: z.string().regex(/^[a-f0-9]{64}$/),
  checkedAt: timestampSchema, durationSeconds: z.number().positive(), width: z.int().positive(), height: z.int().positive(),
  sampledFrames: z.int().min(1).max(8), output: materialAnalysisOutputSchema,
});
export type MaterialAnalysisResponse = z.infer<typeof materialAnalysisResponseSchema>;

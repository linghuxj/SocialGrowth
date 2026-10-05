import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materialAnalysisResponseSchema } from "@socialgrowth/product-contracts";
import type { MaterialRuntime } from "./material-runtime.js";
import type { ArtemisBusinessModel } from "./artemis-business-model.js";
import { ProductTransactionError } from "./product-transaction-error.js";

const run = (command: string, args: string[]): Promise<string> => new Promise((resolve, reject) => {
  execFile(command, args, { timeout: 20000, maxBuffer: 1024 * 1024 }, (error, stdout) => error ? reject(new Error("MEDIA_PROCESSING_UNAVAILABLE")) : resolve(stdout));
});
export async function analyzeMaterial(runtime: MaterialRuntime, model: ArtemisBusinessModel | null,
  token: string, csrf: string, projectId: string, objectId: string) {
  const source = await runtime.uploads().readAnalysisBytes(token, csrf, projectId, objectId);
  if (!model) throw new ProductTransactionError("INTERNAL_ERROR", "切片分析模型尚未配置，请配置 Artemis 模型后重试", true);
  const dir = await mkdtemp(join(tmpdir(), "sg-material-"));
  try {
    const video = join(dir, "clip.mp4"); await writeFile(video, source.bytes, { mode: 0o600 });
    const probe = JSON.parse(await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height:format=duration", "-of", "json", video])) as {
      streams: { width: number; height: number }[]; format: { duration: string } };
    const durationSeconds = Number(probe.format.duration), stream = probe.streams[0];
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0 || !stream?.width || !stream.height) throw new Error("MEDIA_INVALID");
    const frames: string[] = [];
    for (let i = 0; i < 6; i++) {
      const frame = join(dir, `${i}.jpg`);
      await run("ffmpeg", ["-nostdin", "-v", "error", "-ss", String(durationSeconds * (i + 0.5) / 6), "-i", video,
        "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "8", frame]);
      frames.push((await readFile(frame)).toString("base64"));
    }
    const output = await model.analyzeMaterial({ durationSeconds, frames }, AbortSignal.timeout(40000));
    await runtime.uploads().read(token, projectId, objectId);
    return materialAnalysisResponseSchema.parse({ projectId: projectId.toLowerCase(), objectId: objectId.toLowerCase(), sha256: source.sha256,
      checkedAt: new Date().toISOString(), durationSeconds, width: stream.width, height: stream.height, sampledFrames: frames.length, output });
  } catch (error) {
    if (error instanceof ProductTransactionError) throw error;
    throw new ProductTransactionError("INTERNAL_ERROR", "切片分析未完成，请检查视频处理工具及 Artemis 模型配置后重试", true);
  } finally { await rm(dir, { recursive: true, force: true }); }
}

import type { APIResponse, Route } from "playwright";

export async function fetchCapturedBrowserRequest(
  route: Route,
  originalHeaders: Record<string, string>,
): Promise<APIResponse> {
  try {
    return await route.fetch({ headers: originalHeaders });
  } catch {
    // Playwright's original transport exception may include request headers in its call log.
    // Never attach it as a cause or include its message in retained test output.
    throw new Error("Old-session browser request forwarding failed");
  }
}

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function createApiClient(base: string, sessionEnded: () => void, fetcher: typeof fetch = fetch) {
  return async function api<T = any>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(base + path, {
        credentials: "same-origin",
        ...(body !== undefined ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
        ...(signal ? { signal } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError("Runner unavailable. Try reconnecting.", 0);
    }
    if (response.status === 401) {
      sessionEnded();
      throw new ApiError("Your session ended. Connect the runner again to continue.", 401);
    }
    let value: any;
    try { value = await response.json(); }
    catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError("The runner returned an unreadable response. Try again.", response.status);
    }
    if (!response.ok) throw new ApiError(value.error ?? "The runner could not complete this request.", response.status);
    return value;
  };
}

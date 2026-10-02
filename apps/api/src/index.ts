import { localControl, apiToken } from "@aftershock/control";
import { createApi } from "./server.js";

let control: ReturnType<typeof localControl> | undefined;
try {
  control = localControl(); await control.store.migrate();
  const mode = process.env.AFTERSHOCK_WORKBENCH_MODE === "hosted-samples" ? "hosted-samples" : "local";
  const origin = process.env.AFTERSHOCK_WORKBENCH_ORIGIN || "http://127.0.0.1:8787";
  const url = new URL(origin);
  if (url.origin !== origin || (mode === "hosted-samples" && url.protocol !== "https:") || (mode === "local" && !["127.0.0.1", "localhost"].includes(url.hostname))) throw new Error("Invalid workbench origin.");
  const app = createApi(control.store, control.storage, apiToken(control.storage), origin, mode);
  const stop = async () => { await app.close(); await control!.store.pool.end(); };
  process.once("SIGINT", () => { void stop(); }); process.once("SIGTERM", () => { void stop(); });
  await app.listen({ host: mode === "hosted-samples" ? "0.0.0.0" : "127.0.0.1", port: 8787 });
  console.log(`Aftershock ${mode} API ready at ${origin}. Authentication token is in private workbench storage.`);
} catch {
  console.error("API startup failed; check dedicated control database and local workbench configuration.");
  await control?.store.pool.end(); process.exitCode = 2;
}

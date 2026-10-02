import { localControl, apiToken } from "@aftershock/control";
import { createApi } from "./server.js";

let control: ReturnType<typeof localControl> | undefined;
try {
  control = localControl(); await control.store.migrate();
  const app = createApi(control.store, control.storage, apiToken(control.storage));
  const stop = async () => { await app.close(); await control!.store.pool.end(); };
  process.once("SIGINT", () => { void stop(); }); process.once("SIGTERM", () => { void stop(); });
  await app.listen({ host: "127.0.0.1", port: 8787 });
  console.log("Aftershock local API ready at http://127.0.0.1:8787. Authentication token is in private workbench storage.");
} catch {
  console.error("API startup failed; check dedicated control database and local workbench configuration.");
  await control?.store.pool.end(); process.exitCode = 2;
}

import { localControl, runWorker } from "@aftershock/control";

let control: ReturnType<typeof localControl> | undefined;
try {
  control = localControl(); await control.store.migrate();
  const shutdown = new AbortController();
  process.once("SIGINT", () => shutdown.abort()); process.once("SIGTERM", () => shutdown.abort());
  console.log("Aftershock worker ready; claimed campaigns use fresh disposable state.");
  await runWorker(control.store, control.storage, shutdown.signal);
} catch { console.error("Worker stopped; check control storage and offline dependencies. Saved jobs remain available."); process.exitCode = 2; }
finally { await control?.store.pool.end(); }

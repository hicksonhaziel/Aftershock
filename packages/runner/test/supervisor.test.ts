import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { AdapterSupervisor, readArtifact, ObservedCrash } from "../src/index.js";

const fixture = `
import readline from 'node:readline';
import net from 'node:net';
const mode = process.argv[2];
let runId, initial, last, held;
const checkpoint = () => ({schemaVersion:1,runId,supported:mode.startsWith('barrier'),lastDurableDelivery:null,consumerValue:null});
readline.createInterface({input:process.stdin}).on('line', line => {
 const req=JSON.parse(line), p=req.params;
 if(mode==='timeout') return;
 if(mode==='exit') process.exit(0);
 if(mode==='flood') { process.stdout.write('x'.repeat(2048)); return; }
 let result;
 switch(req.method) {
 case 'describe': result={kind:'description',description:{schemaVersion:1,adapterVersion:'synthetic-test',projectionContract:'pumpfun-trades-v1',acknowledgement:'processed',supportsCheckpoints:mode.startsWith('barrier'),supportsFaultBarriers:mode.startsWith('barrier')?['afterDurableEffectCommit']:[],deterministicDependencies:[],executionControl:{controlledBoundaries:[],uncontrolledDependencies:[]}}}; break;
 case 'start': runId=p.runId;initial=p.initialState;result={kind:'lifecycle',runId,state:'started'};break;
 case 'releaseBarrier':
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:req.id,result:{kind:'lifecycle',runId,state:'released'}})+'\\n');
 process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:held.id,result:{kind:'ack',runId,deliveryId:held.params.deliveryId,acknowledgement:'processed'}})+'\\n');return;
 case 'deliver':
 if(mode.startsWith('barrier') && mode!=='barrier-silent') {
  held=req;
  process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'barrier',params:{protocolVersion:1,runId:mode==='barrier-wrong-run'?'other':runId,barrierId:'barrier-1',boundary:'afterDurableEffectCommit',eventIds:[mode==='barrier-wrong-event'?'other':'event-1'],committedThrough:mode==='barrier-wrong-sequence'?'99':p.sequence,checkpoint:checkpoint()}})+'\\n');return;
 }
 last=p.sequence;result={kind:'ack',runId,deliveryId:p.deliveryId,acknowledgement:mode==='wrong-ack'?'durable-commit':'processed'};break;
 case 'drain': result={kind:'drained',runId,throughSequence:mode==='wrong-drain'?'999':last,pending:0,writeErrors:mode==='write-error'?1:0,skipped:0,deadLetters:0};break;
 case 'snapshot': result={kind:'snapshot',snapshot:{schemaVersion:1,runId:mode==='wrong-run'?'other':runId,projectionVersion:'pumpfun-trades-v1',drainedThrough:last,state:initial,checkpoint:mode==='wrong-run'?{...checkpoint(),runId:'other'}:checkpoint(),excludedFields:[]}};break;
 case 'checkpoint': result={kind:'checkpoint',checkpoint:checkpoint()};break;
 case 'stop': result={kind:'lifecycle',runId,state:'stopped'};break;
 case 'reset': result={kind:'lifecycle',runId,state:'reset'};break;
 }
 const response=JSON.stringify({jsonrpc:'2.0',id:mode==='wrong-id'?'unknown':req.id,result})+'\\n';
 if(mode==='malformed') process.stdout.write('oops\\n');
 else if(mode==='duplicate') process.stdout.write(response+response);
 else if(mode.startsWith('network:')) {
  const socket=net.createConnection({host:'127.0.0.1',port:Number(mode.split(':')[1])});
  socket.on('connect',()=>{process.stdout.write('network unexpectedly available\\n');socket.destroy();});
  socket.on('error',()=>process.stdout.write(response));
 } else if(mode==='env' && process.env.AFTERSHOCK_TEST_SECRET) process.stdout.write('unexpected secret\\n');
 else process.stdout.write(response);
});
`;
function setup(mode = "normal", overrides: Partial<{ requestTimeoutMs: number; durationMs: number; maxOutputBytes: number }> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "aftershock-supervisor-test-"));
  writeFileSync(join(directory, "adapter.mjs"), fixture);
  writeFileSync(join(directory, "state.json"), "{}");
  const ref = { path: "state.json", sha256: createHash("sha256").update("{}").digest("hex") };
  const ownershipToken = randomUUID();
  const runner = new AdapterSupervisor({ executable: process.execPath, args: [join(directory, "adapter.mjs"), mode], directory,
    runId: "synthetic-run", ownershipToken, requestTimeoutMs: 3000, durationMs: 10000, maxOutputBytes: 65536, network: "disabled", ...overrides });
  return { runner, directory, ref, ownershipToken, async cleanup() { await runner.dispose(); rmSync(directory, { recursive: true, force: true }); } };
}

test("isolated synthetic adapter completes lifecycle, snapshot, checkpoint and reset protocol", async () => {
  const t = setup();
  try {
    assert.equal((await t.runner.describe()).acknowledgement, "processed");
    await t.runner.start(t.ref); await t.runner.deliver("delivery-0", "0", t.ref); await t.runner.drain();
    assert.equal((await t.runner.snapshot()).drainedThrough, "0");
    assert.equal((await t.runner.checkpoint()).supported, false);
    await t.runner.deliver("delivery-1", "1", t.ref); await t.runner.drain(); await t.runner.stop();
    await t.runner.reset(t.ownershipToken); await t.runner.start(t.ref); await t.runner.stop();
  } finally { await t.cleanup(); }
});
test("malformed, duplicate, uncorrelated, overflowing, timed-out and exiting adapters fail", async () => {
  for (const mode of ["malformed", "duplicate", "wrong-id", "flood", "timeout", "exit"]) {
    const t = setup(mode, { maxOutputBytes: 1024, requestTimeoutMs: mode === "timeout" ? 300 : 3000 });
    try { await assert.rejects(t.runner.describe(), mode === "timeout" ? /timed out/ : mode === "exit" ? /exited/ : mode === "flood" ? /output limit/ : /Malformed/, mode); }
    finally { await t.cleanup(); }
  }
});
test("incorrect acknowledgements, drain boundaries, write errors and snapshot run IDs fail", async () => {
  for (const mode of ["wrong-ack", "wrong-drain", "write-error", "wrong-run"]) {
    const t = setup(mode);
    try {
      await t.runner.describe(); await t.runner.start(t.ref);
      await assert.rejects(async () => {
        await t.runner.deliver("d-0", "0", t.ref); await t.runner.drain(); await t.runner.snapshot();
      }, mode === "write-error" ? /Malformed/ : /lifecycle or response/, mode);
    } finally { await t.cleanup(); }
  }
});
test("snapshot before drain and noncontiguous delivery sequences are rejected", async () => {
  for (const invalid of ["snapshot", "sequence", "reused-delivery"]) {
    const t = setup();
    try {
      await t.runner.describe(); await t.runner.start(t.ref); await t.runner.deliver("d-0", "0", t.ref);
      await assert.rejects(invalid === "snapshot" ? t.runner.snapshot() : t.runner.deliver(invalid === "sequence" ? "d-1" : "d-0", invalid === "sequence" ? "2" : "1", t.ref));
    } finally { await t.cleanup(); }
  }
});
test("artifact hashes, path traversal and symlink escapes are enforced", async () => {
  const t = setup();
  try {
    assert.equal(readArtifact(t.directory, t.ref).toString(), "{}");
    assert.throws(() => readArtifact(t.directory, { ...t.ref, path: "../state.json" }));
    symlinkSync("/etc/hosts", join(t.directory, "escape"));
    assert.throws(() => readArtifact(t.directory, { ...t.ref, path: "escape" }));
    writeFileSync(join(t.directory, "state.json"), "changed");
    assert.throws(() => readArtifact(t.directory, t.ref));
  } finally { await t.cleanup(); }
});
test("run duration terminates an unresponsive adapter independently of request timeout", async () => {
  const t = setup("timeout", { requestTimeoutMs: 1000, durationMs: 200 });
  try { await assert.rejects(t.runner.describe(), /duration/); }
  finally { await t.cleanup(); }
});

test("network namespace blocks host services and environment does not inherit credentials", async () => {
  const server = createServer(socket => socket.destroy());
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  process.env.AFTERSHOCK_TEST_SECRET = "synthetic-secret";
  try {
    for (const mode of [`network:${address.port}`, "env"]) {
      const t = setup(mode);
      try { await t.runner.describe(); } finally { await t.cleanup(); }
    }
  } finally { delete process.env.AFTERSHOCK_TEST_SECRET; await new Promise<void>(resolve => server.close(() => resolve())); }
});
test("reset refuses a token not owned by this run", async () => {
  const t = setup();
  try {
    await t.runner.describe(); await t.runner.start(t.ref); await t.runner.stop();
    await assert.rejects(t.runner.reset(randomUUID()));
  } finally { await t.cleanup(); }
});


test("commit barriers are correlated and supervisor observes an actual SIGKILL", async () => {
  for (const mode of ["barrier", "barrier-wrong-run", "barrier-wrong-event", "barrier-wrong-sequence"]) {
    const t = setup(mode);
    try {
      await t.runner.describe(); await t.runner.start(t.ref);
      const delivery = t.runner.deliver("d-0", "0", t.ref, { eventIds: ["event-1"], crash: true });
      if (mode === "barrier") await assert.rejects(delivery, error => error instanceof ObservedCrash && error.barrier.committedThrough === "0");
      else await assert.rejects(delivery, /Malformed/);
    } finally { await t.cleanup(); }
  }
});
test("nonselected barrier is released before delivery acknowledgement", async () => {
  const t = setup("barrier");
  try {
    await t.runner.describe(); await t.runner.start(t.ref);
    await t.runner.deliver("d-0", "0", t.ref, { eventIds: ["event-1"], crash: false });
    assert.equal(t.runner.barriers.length, 1);
  } finally { await t.cleanup(); }
});


test("a missing declared crash hook cannot pass as a delivered fault", async () => {
  const t = setup();
  try {
    await t.runner.describe(); await t.runner.start(t.ref);
    await assert.rejects(t.runner.deliver("d-0", "0", t.ref, { eventIds: ["event-1"], crash: true }), /UNSUPPORTED/);
  } finally { await t.cleanup(); }
});


test("a declared hook that never fires remains inconclusive", async () => {
  const t = setup("barrier-silent");
  try {
    await t.runner.describe(); await t.runner.start(t.ref);
    await assert.rejects(t.runner.deliver("d-0", "0", t.ref, { eventIds: ["event-1"], crash: true }), /INCONCLUSIVE/);
  } finally { await t.cleanup(); }
});

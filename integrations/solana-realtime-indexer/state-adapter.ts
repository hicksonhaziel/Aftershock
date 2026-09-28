import { sql, verifyContainer } from "../../packages/runner/src/postgres.js";
/** Owned durable-state controls around the pinned upstream schema; never a generic database URL. */
export class ExternalStateAdapter {
  constructor(readonly container: string, readonly token: string, readonly runId: string) {}
  private owned() {
    verifyContainer(this.container, this.token);
    if (sql(this.container, "SELECT ownership_token::text || ':' || run_id FROM aftershock_owner WHERE singleton;") !== `${this.token}:${this.runId}`) throw new Error("External state ownership mismatch.");
  }
  snapshot() {
    this.owned();
    const query = (statement: string) => JSON.parse(sql(this.container, statement));
    return {
      events: query("SELECT COALESCE(jsonb_agg((to_jsonb(e)-'received_at'-'payload'-'slot') || jsonb_build_object('payloadText',payload::text,'slot',slot::text) ORDER BY signature,absolute_path,event_ordinal),'[]'::jsonb) FROM events e;"),
      trades: query("SELECT COALESCE(jsonb_agg((to_jsonb(t)-'sol_amount'-'token_amount'-'fee'-'slot') || jsonb_build_object('slot',slot::text,'sol_amount',sol_amount::text,'token_amount',token_amount::text,'fee',fee::text) ORDER BY signature,absolute_path,event_ordinal),'[]'::jsonb) FROM trades t;"),
      checkpoint: query("SELECT COALESCE(jsonb_agg(jsonb_build_object('slot',last_completed_slot::text,'signature',last_completed_signature)),'[]'::jsonb) FROM ingestion_checkpoints;"),
      deadLetters: sql(this.container, "SELECT count(*) FROM dead_letters;"),
    };
  }
  reset() {
    this.owned(); sql(this.container, "TRUNCATE trades,events,pools,ingestion_checkpoints,dead_letters,stream_gaps;");
    const state = this.snapshot();
    if (state.events.length || state.trades.length || state.checkpoint.length || state.deadLetters !== "0") throw new Error("External reset failed.");
    return state;
  }
  recovery() {
    const state = this.snapshot();
    return { checkpoint: state.checkpoint, policy: "explicit-recorded-overlap", supportsFaultBarriers: [],
      limitation: "Finite replay can restart against retained state; precise external commit barriers remain unsupported." };
  }
}

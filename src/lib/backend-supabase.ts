import { createClient } from "@supabase/supabase-js";
import { BackendError, type Backend, type Conn } from "./backend";
import type { QueueEvent } from "./queue";

interface Row {
  id: number;
  ts: string;
  kind: QueueEvent["kind"];
  count: number;
  device: string | null;
  ref: number | null;
}

const toEvent = (r: Row): QueueEvent => ({
  id: Number(r.id),
  ts: Date.parse(r.ts),
  kind: r.kind,
  count: r.count,
  device: r.device,
  ref: r.ref === null ? null : Number(r.ref),
});

function codeOf(message: string | undefined): string {
  const known = ["already_checked_in", "not_checked_in", "rate_limited", "bad_pin", "bad_device", "bad_kind"];
  return known.find((k) => message?.includes(k)) ?? "network";
}

export function createSupabaseBackend(url: string, key: string): Backend {
  const sb = createClient(url, key, { auth: { persistSession: false } });
  // ต่างระหว่างนาฬิกาเครื่องนี้กับเซิร์ฟเวอร์ เพื่อให้ทุกเครื่องนับเวลาตรงกัน
  let skew = 0;
  const syncClock = async () => {
    const t0 = Date.now();
    const { data, error } = await sb.rpc("server_now");
    if (!error && data) skew = Date.parse(data as string) - (t0 + Date.now()) / 2;
  };
  void syncClock();

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { error } = await sb.rpc(fn, args);
    if (error) throw new BackendError(codeOf(error.message));
  };

  return {
    mode: "supabase",
    now: () => Date.now() + skew,
    async load(sinceMs) {
      const { data, error } = await sb
        .from("events")
        .select("id,ts,kind,count,device,ref")
        .gte("ts", new Date(sinceMs).toISOString())
        .order("id")
        .limit(5000);
      if (error) throw new BackendError("network");
      return (data as Row[]).map(toEvent);
    },
    subscribe(onEvent, onConn) {
      onConn("connecting");
      const ch = sb
        .channel("vanwise-events")
        .on("postgres_changes", { event: "INSERT", schema: "public", table: "events" }, (p) => onEvent(toEvent(p.new as Row)))
        .subscribe((status) => {
          const c: Conn = status === "SUBSCRIBED" ? "live" : status === "CLOSED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT" ? "offline" : "connecting";
          onConn(c);
          if (c === "live") void syncClock();
        });
      return () => {
        void sb.removeChannel(ch);
      };
    },
    checkin: (device) => rpc("checkin", { p_device: device }),
    cancel: (device) => rpc("cancel_checkin", { p_device: device }),
    async verifyPin(pin) {
      const { data, error } = await sb.rpc("verify_pin", { p_pin: pin });
      if (error) throw new BackendError("network");
      return data === true;
    },
    staff: (pin, kind, count = 1, ref = null) => rpc("staff_event", { p_pin: pin, p_kind: kind, p_count: count, p_ref: ref }),
  };
}

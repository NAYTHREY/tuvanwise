// โหมดทดลอง: เก็บเหตุการณ์ใน localStorage และส่งต่อระหว่างแท็บด้วย BroadcastChannel
// เปิดหน้าผู้ใช้กับหน้าทีมงานคนละแท็บในเบราว์เซอร์เดียวกัน จะเห็นคิวเดียวกัน
// มีนาฬิกาจำลอง (ตั้งเวลา/เร่งเวลา) ไว้สาธิตนอกเวลาให้บริการ

import { BackendError, type Backend } from "./backend";
import { bkkMidnight, type QueueEvent } from "./queue";

export const DEMO_PIN = process.env.NEXT_PUBLIC_DEMO_PIN || "2525";
const EV = "vanwise.local.events";
const CLK = "vanwise.local.clock";

export interface DemoClock {
  /** เวลาจริงตอนตั้ง */
  real: number;
  /** เวลาจำลองตอนตั้ง */
  sim: number;
  speed: number;
}

const read = <T,>(k: string, d: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : d;
  } catch {
    return d;
  }
};
const write = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* โหมดส่วนตัว: ใช้ได้เฉพาะแท็บนี้ */
  }
};

let memEvents: QueueEvent[] | null = null;
let memClock: DemoClock | null = null;
const reloadSubs = new Set<() => void>();
let channel: BroadcastChannel | null | undefined;
const getChannel = () => {
  if (channel === undefined) channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("vanwise") : null;
  return channel;
};

export function getDemoClock(): DemoClock {
  return memClock ?? read<DemoClock>(CLK, { real: 0, sim: 0, speed: 1 });
}
export function demoNow(): number {
  const c = getDemoClock();
  if (!c.real) return Date.now();
  return c.sim + (Date.now() - c.real) * c.speed;
}

export function createLocalBackend(): Backend {
  const bc = getChannel();
  const listeners = new Set<(e: QueueEvent) => void>();

  const events = (): QueueEvent[] => memEvents ?? read<QueueEvent[]>(EV, []);
  const save = (list: QueueEvent[]) => {
    memEvents = list;
    write(EV, list);
  };

  bc?.addEventListener("message", (m) => {
    memEvents = null;
    memClock = null;
    if (m.data?.type === "event") listeners.forEach((f) => f(m.data.event));
    if (m.data?.type === "reload") reloadSubs.forEach((f) => f());
  });

  const push = (e: Omit<QueueEvent, "id" | "ts">) => {
    const list = events();
    const ev: QueueEvent = { ...e, id: (list.at(-1)?.id ?? 0) + 1, ts: demoNow() };
    // เก็บแค่ 2 วันล่าสุด
    const keep = list.filter((x) => x.ts > ev.ts - 2 * 86_400_000);
    save([...keep, ev]);
    listeners.forEach((f) => f(ev));
    bc?.postMessage({ type: "event", event: ev });
  };

  const lastOf = (device: string) =>
    [...events()].reverse().find((e) => e.device === device && (e.kind === "checkin" || e.kind === "cancel") && e.ts > demoNow() - 30 * 60_000);

  return {
    mode: "local",
    now: demoNow,
    async load(sinceMs) {
      return events().filter((e) => e.ts >= sinceMs);
    },
    subscribe(onEvent) {
      listeners.add(onEvent);
      return () => listeners.delete(onEvent);
    },
    async checkin(device) {
      if (lastOf(device)?.kind === "checkin") throw new BackendError("already_checked_in");
      push({ kind: "checkin", count: 1, device, ref: null });
    },
    async cancel(device) {
      if (lastOf(device)?.kind !== "checkin") throw new BackendError("not_checked_in");
      push({ kind: "cancel", count: 1, device, ref: null });
    },
    async verifyPin(pin) {
      return pin === DEMO_PIN;
    },
    async staff(pin, kind, count = 1, ref = null) {
      if (pin !== DEMO_PIN) throw new BackendError("bad_pin");
      push({ kind, count: Math.max(1, Math.min(13, count)), device: null, ref });
    },
  };
}

/** ตั้งนาฬิกาจำลอง (ล้างคิวของวันจำลองเดิม) แล้วแจ้งทุกแท็บให้โหลดใหม่ */
export function setDemoClock(simMs: number | null, speed = 1) {
  const c: DemoClock = simMs === null ? { real: 0, sim: 0, speed: 1 } : { real: Date.now(), sim: simMs, speed };
  memClock = c;
  write(CLK, c);
  const day = bkkMidnight(simMs ?? Date.now());
  const list = read<QueueEvent[]>(EV, []).filter((e) => e.ts < day || e.ts > day + 86_400_000);
  memEvents = list;
  write(EV, list);
  notifyReload();
}

export function setDemoSpeed(speed: number) {
  setDemoClockKeep(demoNow(), speed);
}
function setDemoClockKeep(simMs: number, speed: number) {
  const c: DemoClock = { real: Date.now(), sim: simMs, speed };
  memClock = c;
  write(CLK, c);
  notifyReload();
}

/** เมื่อมีการตั้งนาฬิกาหรือล้างข้อมูล (จากแท็บไหนก็ได้) */
export function onDemoReload(f: () => void): () => void {
  reloadSubs.add(f);
  return () => reloadSubs.delete(f);
}
function notifyReload() {
  reloadSubs.forEach((f) => f());
  getChannel()?.postMessage({ type: "reload" });
}

/** ลบข้อมูลทดลองทั้งหมด */
export function clearDemo() {
  memEvents = [];
  memClock = null;
  try {
    localStorage.removeItem(EV);
    localStorage.removeItem(CLK);
  } catch {
    /* ไม่มี storage */
  }
  notifyReload();
}

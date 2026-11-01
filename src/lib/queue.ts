// สถานะคิวรถตู้ คำนวณจากบันทึกเหตุการณ์ (เช็กอิน / ยกเลิก / รถออก / รถถึง / ล้างคิว)
// ทุกเครื่องได้บันทึกชุดเดียวกันจากเซิร์ฟเวอร์ แล้วคำนวณด้วยฟังก์ชันนี้ จึงเห็นคิวตรงกัน
//
// กติกาที่พบจากข้อมูลภาคสนาม (1,455 รอบ, ก.ย. 2569):
// - รถออกที่นาทีลงท้าย 0 หรือ 5 เสมอ (99.9% ของรอบ) → รถเต็มตอน 11:43 จะออก 11:45
// - รถที่ยังไม่เต็ม ออกเมื่อรอครบ 20 นาทีนับจากคนแรก (169 จาก 193 รอบที่ไม่เต็ม)

import { dayTypeOf, predict, type Model } from "./model.ts";

export const SEATS = 13;
export const CAP_MIN = 20;
const MARK = 5 * 60_000;
const BKK = 7 * 3_600_000;

export type EventKind = "checkin" | "cancel" | "depart" | "arrive" | "reset";

export interface QueueEvent {
  id: number;
  /** เวลาที่เซิร์ฟเวอร์บันทึก (ms) */
  ts: number;
  kind: EventKind;
  count: number;
  /** รหัสเครื่องของผู้เช็กอิน (null = เจ้าหน้าที่เพิ่มให้) */
  device: string | null;
  /** รถออก: ไม่ใช้ / รถถึง: เวลาที่รถคันนั้นออก (ms) */
  ref: number | null;
}

export interface Van {
  startMs: number;
  members: (string | null)[];
  fullAtMs: number | null;
}

export interface Trip {
  startMs: number;
  depMs: number;
  n: number;
  by: "full" | "timeout" | "staff";
  members: (string | null)[];
  arrivedMs: number | null;
}

export interface QueueState {
  van: Van | null;
  /** คนที่เช็กอินตอนรถเต็มแล้ว รอคันถัดไป */
  overflow: (string | null)[];
  trips: Trip[];
}

/** ปัดขึ้นเป็นนาทีที่ลงท้าย 0 หรือ 5 */
export const ceil5 = (ms: number) => Math.ceil(ms / MARK) * MARK;

/** เวลาที่รถคันนี้จะออกตามกติกา (เต็ม → 5 นาทีถัดไป, ไม่เต็ม → ครบ 20 นาที) */
export function scheduledDeparture(v: Van): number {
  const cap = ceil5(v.startMs + CAP_MIN * 60_000);
  return v.fullAtMs !== null ? Math.min(ceil5(v.fullAtMs), cap) : cap;
}

export function deriveQueue(events: QueueEvent[], nowMs: number): QueueState {
  let van: Van | null = null;
  let overflow: (string | null)[] = [];
  const trips: Trip[] = [];
  const has = (d: string) => (van?.members.includes(d) ?? false) || overflow.includes(d);

  const board = (who: string | null, at: number) => {
    if (!van) van = { startMs: at, members: [], fullAtMs: null };
    if (van.members.length < SEATS) {
      van.members.push(who);
      if (van.members.length === SEATS) van.fullAtMs = at;
    } else overflow.push(who);
  };

  const depart = (at: number, by: Trip["by"]) => {
    if (!van) return;
    trips.push({ startMs: van.startMs, depMs: at, n: van.members.length, by, members: van.members, arrivedMs: null });
    van = null;
    const waiting = overflow;
    overflow = [];
    for (const w of waiting) board(w, at);
  };

  const advance = (t: number) => {
    // ใช้ while เพราะคนที่รอคันถัดไปอาจเต็มคันใหม่ทันที
    for (let guard = 0; van && guard < 50; guard++) {
      const dep = scheduledDeparture(van);
      if (dep > t) break;
      depart(dep, van.fullAtMs !== null && ceil5(van.fullAtMs) <= dep ? "full" : "timeout");
    }
  };

  const sorted = [...events].sort((a, b) => a.ts - b.ts || a.id - b.id);
  for (const e of sorted) {
    if (e.ts > nowMs) break;
    advance(e.ts);
    switch (e.kind) {
      case "checkin": {
        if (e.device && has(e.device)) break;
        const k = Math.max(1, Math.min(SEATS, e.count | 0));
        for (let i = 0; i < k; i++) board(i === 0 ? e.device : null, e.ts);
        break;
      }
      case "cancel": {
        // device = null คือเจ้าหน้าที่กด −1 ลบคนที่เจ้าหน้าที่นับไว้ล่าสุด (ไม่ลบคนที่เช็กอินผ่านแอป)
        const oi = e.device ? overflow.indexOf(e.device) : overflow.lastIndexOf(null);
        if (oi >= 0) {
          overflow.splice(oi, 1);
          break;
        }
        const v = van as Van | null;
        if (!v) break;
        const i = e.device ? v.members.indexOf(e.device) : v.members.lastIndexOf(null);
        if (i < 0) break;
        v.members.splice(i, 1);
        if (overflow.length) v.members.push(overflow.shift()!);
        if (v.members.length < SEATS) v.fullAtMs = null;
        if (v.members.length === 0) van = null;
        break;
      }
      case "depart":
        if (van) depart(e.ts, "staff");
        break;
      case "arrive": {
        const t = e.ref !== null ? trips.find((x) => x.depMs === e.ref) : [...trips].reverse().find((x) => x.arrivedMs === null);
        if (t && t.arrivedMs === null && e.ts >= t.depMs) t.arrivedMs = e.ts;
        break;
      }
      case "reset":
        van = null;
        overflow = [];
        break;
    }
  }
  advance(nowMs);
  return { van, overflow, trips };
}

// ---------- เวลาไทย ----------

export function bkkDateISO(ms: number): string {
  return new Date(ms + BKK).toISOString().slice(0, 10);
}
export function bkkMinute(ms: number): number {
  return (((ms + BKK) % 86_400_000) + 86_400_000) % 86_400_000 / 60_000;
}
export function bkkMidnight(ms: number): number {
  return Math.floor((ms + BKK) / 86_400_000) * 86_400_000 - BKK;
}
export function clockOf(ms: number): string {
  const m = Math.floor(bkkMinute(ms));
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

// ---------- คาดการณ์เวลารถคันถัดไปออก ----------

export interface Estimate {
  /** full = รถเต็มแล้ว เวลาแน่นอน / filling = กำลังรับคน / empty = ยังไม่มีคนรอ (ถ้ามาตอนนี้) */
  status: "full" | "filling" | "empty";
  n: number;
  depLo: number;
  depMid: number;
  depHi: number;
  /** เวลาที่ช้าที่สุดตามกติกา 20 นาที */
  capMs: number;
  /** มีสถิติของช่วงเวลานี้หรือไม่ (07:00–20:00) */
  hasStats: boolean;
}

export function estimateNext(model: Model, q: QueueState, nowMs: number): Estimate {
  const type = dayTypeOf(bkkDateISO(nowMs));
  const v = q.van;
  if (v && v.fullAtMs !== null) {
    const d = scheduledDeparture(v);
    return { status: "full", n: v.members.length, depLo: d, depMid: d, depHi: d, capMs: d, hasStats: true };
  }
  const startMs = v ? v.startMs : nowMs;
  const n = v ? v.members.length : 1;
  const elapsed = (nowMs - startMs) / 60_000;
  const capMs = ceil5(startMs + CAP_MIN * 60_000);
  const p = predict(model, type, bkkMinute(startMs), elapsed, n);
  const at = (x: number) => Math.min(ceil5(nowMs + x * 60_000), capMs);
  const status = v ? "filling" : "empty";
  if (!p) return { status, n: v ? n : 0, depLo: capMs, depMid: capMs, depHi: capMs, capMs, hasStats: false };
  const [lo, mid, hi] = [p.lo, p.mid, p.hi].map(at).sort((a, b) => a - b);
  return { status, n: v ? n : 0, depLo: lo, depMid: mid, depHi: hi, capMs, hasStats: true };
}

/** ค่าที่ระบบจะทายไว้ตอนคนแรกของรอบเช็กอิน (ใช้วัดความแม่นยำจริงในหน้าทีมงาน) */
export function predictedAtStart(model: Model, startMs: number) {
  const p = predict(model, dayTypeOf(bkkDateISO(startMs)), bkkMinute(startMs), 0, 1);
  if (!p) return null;
  const cap = ceil5(startMs + CAP_MIN * 60_000);
  const at = (x: number) => Math.min(ceil5(startMs + x * 60_000), cap);
  return { lo: at(p.lo), mid: at(p.mid), hi: at(p.hi) };
}

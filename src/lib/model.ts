// ตรรกะการทำนาย — ต้องตรงกับฟังก์ชัน predict() ใน scripts/build_model.py
// (มีเทสต์ใน tests/model.test.ts ยืนยันว่าตัวเลขตรงกับผลจาก Python)

export type DayType = "wd" | "we" | "all";

export interface SlotStats {
  slot: number;
  waits: number[];
  n: number;
  lam: number;
  depsPerHour: number;
  q10: number | null;
  q50: number | null;
  q90: number | null;
  mean: number | null;
}

export interface Model {
  meta: {
    source: string;
    route: string;
    seats: number;
    slotMinutes: number;
    firstSlot: number;
    lastSlot: number;
    minN: number;
    dateFrom: string;
    dateTo: string;
    days: number;
    rows: number;
    skipped: string[];
    daysByType: Record<string, number>;
    ratio: { lo: number; mid: number; hi: number };
    fullShare: number;
    nonFull: { n: number; at20: number };
    overallMean: number;
    travelMeasured: number;
    generated: string;
  };
  slots: Record<DayType, SlotStats[]>;
  weekday: { day: string; days: number; n: number; mean: number }[];
  backtest: {
    n: number;
    days: number;
    mae: number;
    maeBaseline: number;
    improvement: number;
    coverage: number;
    coverageStrict: number;
    within5: number;
    width: number;
    bySlot: { slot: number; n: number; mae: number; maeBaseline: number }[];
  };
  conditions: { label: string; n: number; days: string[]; mean: number }[];
}

export function quantile(sorted: number[], p: number): number | null {
  if (!sorted.length) return null;
  const i = p * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function slotOf(minuteOfDay: number, slotMinutes = 30): number {
  return Math.floor(minuteOfDay / slotMinutes);
}

export function slotLabel(slot: number, slotMinutes = 30): string {
  const a = slot * slotMinutes;
  const b = a + slotMinutes;
  return `${fmtClock(a)}–${fmtClock(b)}`;
}

export function fmtClock(min: number): string {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** วันจันทร์=0 … อาทิตย์=6 จากวันที่รูปแบบ YYYY-MM-DD */
export function weekdayOf(dateISO: string): number {
  const d = new Date(`${dateISO}T00:00:00Z`).getUTCDay(); // 0 = อาทิตย์
  return (d + 6) % 7;
}

export function dayTypeOf(dateISO: string): Exclude<DayType, "all"> {
  return weekdayOf(dateISO) >= 5 ? "we" : "wd";
}

export function inService(model: Model, minuteOfDay: number): boolean {
  const s = slotOf(minuteOfDay, model.meta.slotMinutes);
  return s >= model.meta.firstSlot && s <= model.meta.lastSlot;
}

export function getSlot(model: Model, type: DayType, slot: number): { stats: SlotStats; type: DayType } | null {
  const pick = (t: DayType) => model.slots[t].find((s) => s.slot === slot) ?? null;
  const own = pick(type);
  if (own && own.n >= model.meta.minN) return { stats: own, type };
  const all = pick("all");
  return all ? { stats: all, type: "all" } : null;
}

export type Confidence = "สูง" | "ปานกลาง" | "ต่ำ";

export interface Prediction {
  /** เวลาที่เหลือก่อนรถออก (นาที) */
  lo: number;
  mid: number;
  hi: number;
  /** จำนวนรอบในอดีตที่ใช้คำนวณ (หลังตัดรอบที่ออกไปก่อนเวลาที่รอมาแล้ว) */
  sample: number;
  usedType: DayType;
  slot: number;
  lam: number;
  /** เหตุผลหลักของตัวเลข */
  driver: "full" | "history" | "filling" | "beyond-history";
  confidence: Confidence;
}

/**
 * ทำนายเวลาที่เหลือก่อนรถตู้คันที่กำลังรับคนจะออก
 * @param startMin นาทีของวันที่ผู้โดยสารคนแรกของรอบนี้มาถึง (ใช้เลือกช่วงเวลา เหมือนตอนเก็บข้อมูล)
 * @param elapsed นาทีที่รอบนี้รอมาแล้ว
 * @param n จำนวนคนบนรถตอนนี้ (1–13)
 */
export function predict(model: Model, type: DayType, startMin: number, elapsed = 0, n = 1): Prediction | null {
  const slot = slotOf(startMin, model.meta.slotMinutes);
  const got = getSlot(model, type, slot);
  if (!got) return null;
  const { stats, type: usedType } = got;
  const seats = model.meta.seats;
  const k = seats - n;
  const cond = stats.waits.filter((w) => w > elapsed).map((w) => w - elapsed);

  if (k <= 0) {
    return { lo: 0, mid: 0, hi: 2, sample: cond.length, usedType, slot, lam: stats.lam, driver: "full", confidence: "สูง" };
  }

  const base: [number, number, number] = cond.length
    ? [quantile(cond, 0.1)!, quantile(cond, 0.5)!, quantile(cond, 0.9)!]
    : [0, 0, 5];
  const r = model.meta.ratio;
  const fill = (x: number) => (stats.lam > 0 ? (x * k) / stats.lam : Infinity);
  const lo = Math.min(base[0], fill(r.lo));
  const mid = Math.min(base[1], fill(r.mid));
  const hi = Math.min(base[2], fill(r.hi));

  let driver: Prediction["driver"] = "history";
  if (!cond.length) driver = "beyond-history";
  else if (fill(r.mid) < base[1]) driver = "filling";

  let confidence: Confidence = "ต่ำ";
  if (cond.length >= 30 && hi - lo <= 15) confidence = "สูง";
  else if (cond.length >= 10) confidence = "ปานกลาง";

  return { lo, mid, hi, sample: cond.length, usedType, slot, lam: stats.lam, driver, confidence };
}

export interface TravelConfig {
  min: number;
  max: number;
}

export interface PlanResult {
  ok: boolean;
  reason?: string;
  latestDeparture: number;
  safeArrive?: number;
  typicalArrive?: number;
  safeWait?: number;
  typicalWait?: number;
}

/** หาเวลาที่ควรไปถึงคิว เพื่อให้ถึงปลายทางทันเวลาเป้าหมาย */
export function planByTarget(model: Model, type: DayType, targetMin: number, travel: TravelConfig): PlanResult {
  const latestDeparture = targetMin - travel.max;
  const find = (q: "q50" | "q90") => {
    for (let a = Math.floor(latestDeparture); a >= latestDeparture - 180; a--) {
      if (!inService(model, a)) continue;
      const got = getSlot(model, type, slotOf(a, model.meta.slotMinutes));
      const w = got?.stats[q];
      if (w == null) continue;
      if (a + w <= latestDeparture) return { arrive: a, wait: w };
    }
    return null;
  };
  const safe = find("q90");
  const typical = find("q50");
  if (!safe || !typical) {
    return { ok: false, reason: "ช่วงเวลานี้อยู่นอกช่วงที่มีข้อมูล (รถออกระหว่าง 07:00–20:00)", latestDeparture };
  }
  return {
    ok: true,
    latestDeparture,
    safeArrive: safe.arrive,
    safeWait: safe.wait,
    typicalArrive: typical.arrive,
    typicalWait: typical.wait,
  };
}

export interface ForwardPlan {
  ok: boolean;
  reason?: string;
  wait?: { lo: number; mid: number; hi: number };
  depart?: { lo: number; mid: number; hi: number };
  arrive?: { lo: number; mid: number; hi: number };
  sample?: number;
  confidence?: Confidence;
}

/** ถ้าไปถึงคิวเวลา arriveMin จะได้ออกและถึงปลายทางเมื่อไร */
export function planByArrival(model: Model, type: DayType, arriveMin: number, travel: TravelConfig): ForwardPlan {
  if (!inService(model, arriveMin)) {
    return { ok: false, reason: "เวลานี้อยู่นอกช่วงที่มีข้อมูล (07:00–20:00)" };
  }
  const p = predict(model, type, arriveMin, 0, 1);
  if (!p) return { ok: false, reason: "ไม่มีข้อมูลของช่วงเวลานี้" };
  const travelMid = (travel.min + travel.max) / 2;
  return {
    ok: true,
    wait: { lo: p.lo, mid: p.mid, hi: p.hi },
    depart: { lo: arriveMin + p.lo, mid: arriveMin + p.mid, hi: arriveMin + p.hi },
    arrive: { lo: arriveMin + p.lo + travel.min, mid: arriveMin + p.mid + travelMid, hi: arriveMin + p.hi + travel.max },
    sample: p.sample,
    confidence: p.confidence,
  };
}

export function fmtMinutes(x: number): string {
  if (x < 1) return "ไม่ถึง 1";
  return String(Math.round(x));
}

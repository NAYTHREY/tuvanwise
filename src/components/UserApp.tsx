"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { MODEL, PLACES } from "@/lib/config";
import { deviceId, errorText, type Backend, type Conn } from "@/lib/backend";
import { useQueue } from "@/lib/useQueue";
import { SEATS, bkkDateISO, bkkMidnight, bkkMinute, clockOf, estimateNext, type Estimate, type QueueEvent, type QueueState } from "@/lib/queue";
import { dayTypeOf, fmtClock, getSlot, inService, planByArrival, planByTarget, predict, slotLabel, slotOf, travelAt, travelFor, type DayType } from "@/lib/model";
import { ColumnChart, type Column } from "./Charts";
import { Logo } from "./Logo";

const RouteMap = dynamic(() => import("./RouteMap"), {
  ssr: false,
  loading: () => <div className="grid h-[260px] place-items-center text-sm text-ink-3">กำลังโหลดแผนที่</div>,
});

const MIN = 60_000;
const OPEN_MIN = 7 * 60;

export function UserApp() {
  const { backend, state, events, now, conn, loaded } = useQueue();
  const est = useMemo(() => estimateNext(MODEL, state, now), [state, now]);
  const [highlight, setHighlight] = useState(false);

  // เปิดผ่าน QR ที่ท่ารถ (#checkin) → เลื่อนไปที่ปุ่มเช็กอิน
  useEffect(() => {
    const go = () => {
      if (window.location.hash !== "#checkin") return;
      setHighlight(true);
      window.setTimeout(() => document.getElementById("checkin")?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
      window.setTimeout(() => setHighlight(false), 2500);
    };
    go();
    window.addEventListener("hashchange", go);
    return () => window.removeEventListener("hashchange", go);
  }, []);

  const [page, setPage] = useState<"now" | "plan">("now");
  useEffect(() => {
    if (highlight) setPage("now");
  }, [highlight]);

  return (
    <div className="mx-auto max-w-xl px-4 pb-28 sm:px-6">
      <header className="flex items-center justify-between gap-3 pb-4 pt-6">
        <h1 className="m-0 text-[30px] leading-none">
          <Logo />
        </h1>
        <ConnBadge conn={conn} mode={backend?.mode} />
      </header>

      {page === "now" ? (
        <main className="grid gap-4">
          <Checkin backend={backend} state={state} now={now} highlight={highlight} />
          <NextVan est={est} state={state} events={events} now={now} ready={loaded} />
          <Journey est={est} now={now} />
          <Outlook now={now} />
        </main>
      ) : (
        <main className="grid gap-4">
          <Plan nowMs={now} />
          <MapCard />
        </main>
      )}

      <footer className="mt-10 text-center text-xs text-ink-3">
        <p>TU vanwise · TSE100 กลุ่ม 25 มหาวิทยาลัยธรรมศาสตร์</p>
      </footer>

      <nav
        aria-label="หน้าในแอป"
        className="fixed inset-x-0 bottom-0 z-[1000] border-t border-line bg-surface/95 backdrop-blur"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid max-w-xl grid-cols-2">
          {(
            [
              ["now", "รถตอนนี้", "M4 16V6a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10M4 16h16M4 16v3h3v-3m10 0v3h3v-3M7 12h.01M17 12h.01M4 9h16"],
              ["plan", "วางแผน & แผนที่", "M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Zm0 0v14m6-12v14"],
            ] as const
          ).map(([k, label, d]) => (
            <button
              key={k}
              onClick={() => {
                setPage(k);
                window.scrollTo({ top: 0 });
              }}
              aria-current={page === k ? "page" : undefined}
              className="flex min-h-[60px] flex-col items-center justify-center gap-0.5 text-[13px] font-semibold"
              style={{ color: page === k ? "var(--red)" : "var(--ink-3)" }}
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d={d} />
              </svg>
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  );
}

function MapCard() {
  return (
    <section className="panel overflow-hidden" aria-labelledby="map-title">
      <div className="p-5 pb-3">
        <h2 id="map-title" className="font-display text-xl font-semibold">
          แผนที่
        </h2>
        <p className="mt-1 text-sm text-ink-2">
          ขึ้นรถที่ {PLACES.origin.name} ลงที่ {PLACES.destination.name}
        </p>
      </div>
      <RouteMap />
    </section>
  );
}

function ConnBadge({ conn, mode }: { conn: Conn; mode?: Backend["mode"] }) {
  if (mode !== "supabase") return null;
  const map: Record<Conn, [string, string]> = {
    live: ["var(--ok)", "สด"],
    connecting: ["var(--ink-3)", "กำลังเชื่อมต่อ"],
    offline: ["var(--warn)", "ออฟไลน์"],
  };
  const [color, text] = map[conn];
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold" style={{ color }} role="status">
      <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
      {text}
    </span>
  );
}

// ---------------- รถคันถัดไป ----------------

/** เวลาเปิดทำนายครั้งถัดไป (07:00 วันนี้หรือพรุ่งนี้) */
function nextOpen(now: number) {
  const day = bkkMidnight(now);
  const today = bkkMinute(now) < OPEN_MIN;
  return { at: (today ? day : day + 86_400_000) + OPEN_MIN * MIN, today };
}

function ago(ms: number) {
  const m = Math.floor(ms / MIN);
  if (m < 1) return "เมื่อสักครู่";
  if (m < 60) return `${m} นาทีที่แล้ว`;
  return `${Math.floor(m / 60)} ชม. ที่แล้ว`;
}

function NextVan({ est, state, events, now, ready }: { est: Estimate; state: QueueState; events: QueueEvent[]; now: number; ready: boolean }) {
  const mins = Math.max(0, Math.round((est.depMid - now) / MIN));
  const outOfHours = !est.hasStats && est.status === "empty";
  const lastPeople = [...events].reverse().find((e) => e.ts <= now && (e.kind === "checkin" || e.kind === "cancel" || e.kind === "depart"));
  const app = state.van?.members.filter(Boolean).length ?? 0;
  const staff = (state.van?.members.length ?? 0) - app;

  if (ready && outOfHours) {
    const o = nextOpen(now);
    const first = predict(MODEL, dayTypeOf(bkkDateISO(o.at)), OPEN_MIN, 0, 1);
    const firstDep = first ? Math.min(Math.ceil((OPEN_MIN + first.mid) / 5) * 5, OPEN_MIN + 20) : OPEN_MIN + 20;
    return (
      <section className="board p-5 sm:p-6" aria-labelledby="next-title">
        <p id="next-title" className="text-sm text-board-dim">ตอนนี้นอกเวลาที่ระบบติดตามคิว</p>
        <p className="board-digits mt-1 text-[44px] leading-tight">เริ่ม {fmtClock(OPEN_MIN)} {o.today ? "วันนี้" : "พรุ่งนี้"}</p>
        <p className="mt-3 text-[15px] text-[#e7e9ee]">
          ไปถึงคิวตอน 07:00 รถน่าจะออกราว {fmtClock(firstDep)} ถึงฟิวเจอร์พาร์คราว {fmtClock(firstDep + travelAt(MODEL, bkkDateISO(o.at), firstDep).mid)}
        </p>
        <p className="mt-1 text-sm text-board-dim">ช่วงเช้าคนน้อย รถมักรอครบ 20 นาทีก่อนออก</p>
      </section>
    );
  }

  return (
    <section className="board p-5 sm:p-6" aria-labelledby="next-title" aria-live="polite">
      <p id="next-title" className="text-sm text-board-dim">
        {est.status === "empty" ? "ไปถึงคิวตอนนี้ รถน่าจะออก" : est.status === "full" ? "รถเต็มแล้ว ออกเวลา" : "รถคันถัดไปออก"}
      </p>

      {!ready ? (
        <p className="board-digits mt-2 text-6xl opacity-40">--:--</p>
      ) : (
        <>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="board-digits text-[64px] leading-none sm:text-7xl">{clockOf(est.depMid)}</p>
            <p className="pb-2 text-right text-board-dim">
              {mins === 0 ? "กำลังจะออก" : (
                <>
                  อีก <span className="board-digits text-2xl text-board-ink">{mins}</span> นาที
                </>
              )}
            </p>
          </div>
          {est.status !== "full" && est.depLo < est.depHi && (
            <p className="mt-2 text-sm text-board-dim">
              เร็วสุด {clockOf(est.depLo)} · ช้าสุด {clockOf(est.capMs)}
            </p>
          )}
          <SeatBar n={est.status === "empty" ? 0 : est.n} />
          {state.overflow.length > 0 && <p className="mt-1 text-sm text-board-dim">อีก {state.overflow.length} คนรอคันถัดไป</p>}
          <p className="mt-3 border-t border-white/10 pt-3 text-xs text-board-dim">
            {lastPeople ? (
              <>
                <span className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-[var(--ok)] align-middle" aria-hidden />
                จากคนจริงที่ท่ารถ
                {state.van && ` · เช็กอิน ${app} · เจ้าหน้าที่นับ ${staff}`} · อัปเดต {ago(now - lastPeople.ts)}
              </>
            ) : (
              "ยังไม่มีข้อมูลคนที่ท่ารถตอนนี้ เวลาที่แสดงมาจากสถิติ"
            )}
          </p>
        </>
      )}
    </section>
  );
}

function SeatBar({ n }: { n: number }) {
  return (
    <div className="mt-4">
      <div className="flex gap-1" role="img" aria-label={`มีคนรอ ${n} จาก ${SEATS} ที่นั่ง`}>
        {Array.from({ length: SEATS }, (_, i) => (
          <span
            key={i}
            className={`h-2.5 flex-1 rounded-full ${i < n ? "seat-fill" : ""}`}
            style={{ background: i < n ? "var(--board-ink)" : "rgba(255,255,255,0.14)" }}
          />
        ))}
      </div>
      <p className="mt-2 text-sm text-[#e7e9ee] tnum">
        คนรอบนรถ {n}/{SEATS} · ว่าง {SEATS - n} ที่
      </p>
    </div>
  );
}

// ---------------- การเดินทาง ----------------

function Journey({ est, now }: { est: Estimate; now: number }) {
  const live = est.hasStats || est.status !== "empty";
  // นอกเวลา: แสดงเวลาของรถคันแรกตอนเปิด (07:00)
  const o = nextOpen(now);
  const first = predict(MODEL, dayTypeOf(bkkDateISO(o.at)), OPEN_MIN, 0, 1);
  const firstDep = o.at + Math.min(Math.ceil((first?.mid ?? 20) / 5) * 5, 20) * MIN;
  const arriveAt = live ? now : o.at;
  const dep: number | null = live ? est.depMid : firstDep;
  const wait = Math.max(0, Math.round((dep - arriveAt) / MIN));
  const tr = travelAt(MODEL, bkkDateISO(dep), bkkMinute(dep));
  const rows: { t: string; title: string; note: string }[] = [
    { t: clockOf(arriveAt), title: `ถึงคิวที่ ${PLACES.origin.name}`, note: "ต่อคิวรถตู้สายฟิวเจอร์พาร์ค" },
    {
      t: clockOf(dep),
      title: "รถออก",
      note: `รอราว ${wait} นาที · ออกเมื่อเต็ม 13 ที่ หรือรอครบ 20 นาที`,
    },
    {
      t: clockOf(dep + tr.mid * MIN),
      title: `ถึง ${PLACES.destination.name}`,
      note: `นั่งรถราว ${tr.lo}–${tr.hi} นาทีตามสภาพจราจรช่วงนี้ ไม่จอดรับระหว่างทาง`,
    },
  ];
  return (
    <section className="panel p-5" aria-labelledby="trip-title">
      <h2 id="trip-title" className="font-display text-xl font-semibold">
        การเดินทาง
      </h2>
      <ol className="mt-3">
        {rows.map((r, i) => (
          <li key={i} className="grid grid-cols-[52px_16px_1fr] gap-x-2">
            <span className="pt-0.5 font-display font-semibold tnum">{r.t}</span>
            <span className="relative flex justify-center" aria-hidden>
              <span className="mt-1.5 h-3 w-3 rounded-full border-2" style={{ borderColor: "var(--red)", background: i === 2 ? "var(--red)" : "var(--surface)" }} />
              {i < rows.length - 1 && <span className="absolute bottom-0 top-5 w-0.5 bg-line" />}
            </span>
            <div className="pb-4">
              <p className="font-semibold leading-snug">{r.title}</p>
              <p className="text-sm text-ink-2">{r.note}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

// ---------------- 3 ชั่วโมงข้างหน้า ----------------

function Outlook({ now }: { now: number }) {
  const date = bkkDateISO(now);
  const minute = bkkMinute(now);
  const before = minute < OPEN_MIN;
  const after = !before && !inService(MODEL, minute);
  const type = dayTypeOf(after ? bkkDateISO(now + 86_400_000) : date);
  const start = before || after ? slotOf(OPEN_MIN) : slotOf(minute);
  const lams = MODEL.slots[type].map((s) => s.lam).sort((a, b) => a - b);
  const p = (q: number) => lams[Math.floor(q * (lams.length - 1))] ?? 0;
  const items = Array.from({ length: 6 }, (_, i) => start + i)
    .map((s) => getSlot(MODEL, type, s))
    .filter((g): g is NonNullable<typeof g> => g !== null && g.stats.q50 !== null);
  const level = (lam: number) => (lam >= p(0.66) ? ["คนเยอะ", "var(--red)"] : lam >= p(0.33) ? ["ปานกลาง", "var(--warn)"] : ["คนน้อย", "var(--ok)"]);

  return (
    <section className="panel p-5" aria-labelledby="outlook-title">
      <h2 id="outlook-title" className="font-display text-xl font-semibold">
        {before || after ? `ช่วงเช้า${after ? "พรุ่งนี้" : "วันนี้"}` : "3 ชั่วโมงข้างหน้า"}
      </h2>
      <ul className="mt-3 divide-y divide-line">
        {items.map(({ stats }, i) => {
          const [label, color] = level(stats.lam);
          return (
            <li key={stats.slot} className="flex items-center justify-between gap-3 py-2.5 text-sm">
              <span className="w-[92px] font-semibold tnum">
                {i === 0 && !before && !after ? "ตอนนี้" : fmtClock(stats.slot * 30)}
              </span>
              <span className="flex flex-1 items-center gap-1.5" style={{ color }}>
                <span className="h-2 w-2 rounded-full" style={{ background: color }} aria-hidden />
                {label}
              </span>
              <span className="text-ink-2 tnum">รอราว {Math.round(stats.q50!)} นาที</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 text-xs text-ink-3">จากสถิติ{type === "wd" ? "วันจันทร์–ศุกร์" : "วันเสาร์–อาทิตย์"} เวลารอนับจากคนแรกถึงคิว</p>
    </section>
  );
}

// ---------------- เช็กอิน ----------------

function Checkin({ backend, state, now, highlight }: { backend: Backend | null; state: QueueState; now: number; highlight: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => setMe(deviceId()), []);

  const seat = me && state.van ? state.van.members.indexOf(me) : -1;
  const waitingNext = me ? state.overflow.includes(me) : false;
  const myTrip = me ? [...state.trips].reverse().find((t) => t.members.includes(me) && now - t.depMs < 45 * MIN) : undefined;

  const run = async (f: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await f();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  let body: React.ReactNode;
  if (seat >= 0 || waitingNext) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{waitingNext ? "คันนี้เต็มแล้ว คุณได้คันถัดไป" : `เช็กอินแล้ว คุณคือคนที่ ${seat + 1}`}</p>
        <button className="btn btn-quiet text-sm" disabled={busy} onClick={() => run(() => backend!.cancel(me!))}>
          ยกเลิก
        </button>
      </div>
    );
  } else if (myTrip) {
    body = (
      <p className="font-semibold">
        รถของคุณออก {clockOf(myTrip.depMs)} ถึงฟิวเจอร์พาร์คราว {clockOf(myTrip.depMs + travelAt(MODEL, bkkDateISO(myTrip.depMs), bkkMinute(myTrip.depMs)).mid * MIN)}
      </p>
    );
  } else {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">อยู่ที่ท่ารถแล้ว?</p>
          <p className="text-sm text-ink-2">เช็กอินเพื่อให้ทุกคนเห็นจำนวนคนรอจริง</p>
        </div>
        <button className="btn btn-primary px-6" disabled={!backend || !me || busy} onClick={() => run(() => backend!.checkin(me!))}>
          เช็กอิน
        </button>
      </div>
    );
  }

  return (
    <section
      id="checkin"
      className="panel px-5 py-4 transition-shadow"
      style={highlight ? { boxShadow: "0 0 0 3px var(--gold)" } : undefined}
      aria-label="เช็กอิน"
    >
      {body}
      {error && (
        <p className="mt-2 text-sm font-semibold text-red" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

// ---------------- วางแผนล่วงหน้า ----------------

const toMin = (v: string) => {
  const [h, m] = v.split(":").map(Number);
  return h * 60 + m;
};
const floor5 = (m: number) => Math.floor(m / 5) * 5;
const ceil5m = (m: number) => Math.ceil(m / 5) * 5;

function Plan({ nowMs }: { nowMs: number }) {
  const today = new Date(nowMs + 7 * 3_600_000).toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [mode, setMode] = useState<"target" | "arrive">("target");
  const [target, setTarget] = useState("17:00");
  const [arrive, setArrive] = useState("16:00");
  const type = dayTypeOf(date);
  const time = mode === "target" ? target : arrive;

  return (
    <section className="panel p-5" aria-labelledby="plan-title">
      <h2 id="plan-title" className="font-display text-xl font-semibold">
        วางแผนล่วงหน้า
      </h2>

      <div className="mt-3 grid grid-cols-2 gap-1 rounded-[10px] bg-surface-2 p-1" role="group" aria-label="ต้องการรู้">
        {(
          [
            ["target", "อยากถึงก่อนกี่โมง"],
            ["arrive", "จะไปถึงคิวกี่โมง"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setMode(k)}
            aria-pressed={mode === k}
            className="min-h-[40px] rounded-lg px-2 text-sm font-semibold"
            style={{ background: mode === k ? "var(--surface)" : "transparent", color: mode === k ? "var(--ink)" : "var(--ink-2)", boxShadow: mode === k ? "0 1px 2px rgba(0,0,0,.08)" : undefined }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink-2">
          วัน
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-sm text-ink-2">
          {mode === "target" ? "ถึงฟิวเจอร์พาร์คก่อน" : "ถึงคิวรถเวลา"}
          <input
            type="time"
            value={time}
            onChange={(e) => e.target.value && (mode === "target" ? setTarget(e.target.value) : setArrive(e.target.value))}
          />
        </label>
      </div>

      {mode === "target" ? <TargetResult type={type} date={date} targetMin={toMin(target)} /> : <ArriveResult type={type} date={date} arriveMin={toMin(arrive)} />}

      <details className="mt-4 border-t border-line pt-3">
        <summary className="cursor-pointer text-sm font-semibold text-ink-2">เวลารอแต่ละช่วงของวัน</summary>
        <WaitChart type={type} highlightMin={mode === "target" ? toMin(target) - travelAt(MODEL, date, toMin(target)).hi : toMin(arrive)} />
      </details>
    </section>
  );
}

function Result({ label, time, note }: { label: string; time: string; note: string }) {
  return (
    <div className="mt-4 rounded-xl bg-red-soft p-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="font-display text-5xl font-semibold tnum text-red">{time}</p>
      <p className="mt-1 text-sm text-ink-2">{note}</p>
    </div>
  );
}

function TargetResult({ type, date, targetMin }: { type: DayType; date: string; targetMin: number }) {
  const r = planByTarget(MODEL, type, targetMin, travelFor(MODEL, date));
  if (!r.ok) return <p className="mt-4 rounded-xl bg-surface-2 p-4 text-sm">ช่วงเวลานี้ไม่มีข้อมูล ระบบทำนายได้ช่วง 07:00–20:00</p>;
  return (
    <Result
      label="ควรถึงคิวรถไม่เกิน"
      time={fmtClock(floor5(r.safeArrive!))}
      note={`เผื่อเวลารอและเดินทางแล้ว (ช่วงนั้นนั่งรถราว ${r.travel!.lo}–${r.travel!.hi} นาที)`}
    />
  );
}

function ArriveResult({ type, date, arriveMin }: { type: DayType; date: string; arriveMin: number }) {
  const r = planByArrival(MODEL, type, arriveMin, travelFor(MODEL, date));
  if (!r.ok) return <p className="mt-4 rounded-xl bg-surface-2 p-4 text-sm">ช่วงเวลานี้ไม่มีข้อมูล ระบบทำนายได้ช่วง 07:00–20:00</p>;
  const cap = ceil5m(arriveMin + 20);
  const dep = Math.min(ceil5m(r.depart!.mid), cap);
  return (
    <Result
      label="ถึงฟิวเจอร์พาร์คราว"
      time={fmtClock(dep + travelAt(MODEL, date, dep).mid)}
      note={`รถน่าจะออก ${fmtClock(dep)} · นั่งรถราว ${travelAt(MODEL, date, dep).lo}–${travelAt(MODEL, date, dep).hi} นาที`}
    />
  );
}

function WaitChart({ type, highlightMin }: { type: DayType; highlightMin: number }) {
  const hs = slotOf(highlightMin, MODEL.meta.slotMinutes);
  const cols: Column[] = useMemo(
    () =>
      MODEL.slots[type].map((s) => ({
        key: s.slot,
        tick: s.slot % 4 === 0 ? String(s.slot / 2).padStart(2, "0") : null,
        values: [s.q50],
        highlight: s.slot === hs,
        tip: [slotLabel(s.slot), `รอราว ${Math.round(s.q50 ?? 0)} นาที`],
      })),
    [type, hs],
  );
  return (
    <div className="mt-3">
      <ColumnChart columns={cols} series={[{ name: "เวลารอ", color: "var(--series-a)" }]} unit="นาที" height={180} title="เวลารอรถออกตามช่วงเวลา" />
      <p className="mt-1 text-xs text-ink-3">ช่วงเที่ยงถึงเย็นรถเต็มเร็ว ช่วงเช้าคนน้อยมักรอครบ 20 นาที</p>
    </div>
  );
}


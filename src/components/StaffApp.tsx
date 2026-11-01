"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import { MODEL } from "@/lib/config";
import { errorText, type Backend, type StaffKind } from "@/lib/backend";
import { useQueue } from "@/lib/useQueue";
import {
  SEATS,
  bkkDateISO,
  bkkMinute,
  clockOf,
  estimateNext,
  predictedAtStart,
  scheduledDeparture,
  type QueueState,
  type Trip,
} from "@/lib/queue";
import { dayTypeOf, getSlot, slotOf } from "@/lib/model";
import { DataView } from "./DataView";
import { Logo } from "./Logo";

const MIN = 60_000;
const PIN_KEY = "vanwise.staff.pin";

export function StaffApp() {
  const q = useQueue();
  const [pin, setPin] = useState<string | null>(null);
  useEffect(() => {
    try {
      setPin(sessionStorage.getItem(PIN_KEY));
    } catch {
      /* ไม่มี storage */
    }
  }, []);

  const logout = () => {
    try {
      sessionStorage.removeItem(PIN_KEY);
    } catch {
      /* ไม่มี storage */
    }
    setPin(null);
  };

  if (!q.backend) return <Shell><p className="text-ink-2">กำลังโหลด</p></Shell>;
  if (!pin) return <PinGate backend={q.backend} onOk={setPin} />;
  return <Console {...q} backend={q.backend} pin={pin} logout={logout} />;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl px-4 pb-16 pt-6 sm:px-6">{children}</div>;
}

function PinGate({ backend, onOk }: { backend: Backend; onOk: (pin: string) => void }) {
  const [v, setV] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      if (await backend.verifyPin(v)) {
        try {
          sessionStorage.setItem(PIN_KEY, v);
        } catch {
          /* ไม่มี storage */
        }
        onOk(v);
      } else setErr("PIN ไม่ถูกต้อง");
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <form onSubmit={submit} className="panel mx-auto mt-10 max-w-sm p-6">
        <p className="font-display text-2xl font-bold">
          <Logo /> ทีมงาน
        </p>
        <label className="mt-4 flex flex-col gap-1 text-sm text-ink-2">
          PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            value={v}
            onChange={(e) => setV(e.target.value)}
            className="rounded-[10px] border border-line bg-surface px-3 py-2 text-lg tracking-widest text-ink"
            autoFocus
          />
        </label>
        {err && <p className="mt-2 text-sm font-semibold text-red" role="alert">{err}</p>}
        <button className="btn btn-primary mt-4 w-full" disabled={!v || busy}>
          เข้าสู่หน้าทีมงาน
        </button>
        {backend.mode === "local" && <p className="mt-3 text-xs text-ink-3">โหมดทดลอง PIN คือ {process.env.NEXT_PUBLIC_DEMO_PIN || "2525"}</p>}
        <a href="#" className="mt-4 block text-center text-sm text-ink-2 underline underline-offset-4">
          กลับหน้าผู้ใช้
        </a>
      </form>
    </Shell>
  );
}

type Q = ReturnType<typeof useQueue>;
type Section = "queue" | "trips" | "qr" | "data";

function Console({ backend, state, now, conn, pin, logout }: Q & { backend: Backend; pin: string; logout: () => void }) {
  const [sec, setSec] = useState<Section>("queue");
  const [msg, setMsg] = useState<string | null>(null);
  const act = async (kind: StaffKind, count = 1, ref: number | null = null) => {
    setMsg(null);
    try {
      await backend.staff(pin, kind, count, ref);
    } catch (e) {
      setMsg(errorText(e));
    }
  };

  const tabs: [Section, string][] = [
    ["queue", "นับคน / คิว"],
    ["trips", "รอบรถวันนี้"],
    ["qr", "QR ท่ารถ"],
    ["data", "ความแม่นยำ"],
  ];

  return (
    <Shell>
      <header className="flex flex-wrap items-center justify-between gap-3 pb-4">
        <div>
          <p className="font-display text-2xl font-bold leading-none">
            <Logo /> <span className="text-ink-2">ทีมงาน</span>
          </p>
          <p className="mt-1.5 text-sm text-ink-2">
            {backend.mode === "supabase" ? `เซิร์ฟเวอร์จริง · ${conn === "live" ? "เชื่อมต่อแล้ว" : conn === "offline" ? "ออฟไลน์" : "กำลังเชื่อมต่อ"}` : "โหมดทดลองในเครื่อง (ยังไม่ได้ตั้งค่าเซิร์ฟเวอร์)"}
            {" · "}
            <span className="tnum">{clockOf(now)}</span>
          </p>
        </div>
        <div className="flex gap-2">
          <a href="#" className="btn">หน้าผู้ใช้</a>
          <button className="btn" onClick={logout}>ออก</button>
        </div>
      </header>

      <nav className="mb-5 grid grid-cols-4 gap-1 rounded-xl border border-line bg-surface p-1" aria-label="ส่วนของทีมงาน">
        {tabs.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setSec(k)}
            aria-current={sec === k ? "page" : undefined}
            className="min-h-[42px] rounded-lg px-1 text-[13px] font-semibold sm:text-sm"
            style={{ background: sec === k ? "var(--ink)" : "transparent", color: sec === k ? "var(--surface)" : "var(--ink-2)" }}
          >
            {label}
          </button>
        ))}
      </nav>

      {msg && <p className="mb-4 rounded-xl border border-red bg-red-soft px-4 py-3 text-sm font-semibold" role="alert">{msg}</p>}

      {sec === "queue" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <QueueControl state={state} now={now} act={act} />
          <InTransit state={state} now={now} act={act} />
          {backend.mode === "local" && <DemoControls backend={backend} pin={pin} now={now} state={state} />}
        </div>
      )}
      {sec === "trips" && <Trips state={state} now={now} />}
      {sec === "qr" && <QrPoster />}
      {sec === "data" && <DataView model={MODEL} />}
    </Shell>
  );
}

function QueueControl({ state, now, act }: { state: QueueState; now: number; act: (k: StaffKind, c?: number, r?: number | null) => Promise<void> }) {
  const v = state.van;
  const est = estimateNext(MODEL, state, now);
  const [confirmReset, setConfirmReset] = useState(false);
  return (
    <section className="panel p-5" aria-labelledby="qc-title">
      <h2 id="qc-title" className="font-display text-xl font-semibold">รถคันที่กำลังรับคน</h2>
      <p className="mt-2 font-display text-4xl font-semibold tnum">
        {v?.members.length ?? 0}/{SEATS} <span className="text-lg font-medium text-ink-2">คน</span>
      </p>
      {v ? (
        <p className="mt-1 text-sm text-ink-2 tnum">
          คนแรกมา {clockOf(v.startMs)} · รอมา {Math.floor((now - v.startMs) / MIN)} นาที ·{" "}
          {v.fullAtMs !== null ? `เต็มแล้ว ออกอัตโนมัติ ${clockOf(scheduledDeparture(v))}` : `ระบบทาย ${clockOf(est.depMid)} · ออกอัตโนมัติไม่เกิน ${clockOf(scheduledDeparture(v))}`}
        </p>
      ) : (
        <p className="mt-1 text-sm text-ink-2">ยังไม่มีคนรอ</p>
      )}
      {state.overflow.length > 0 && <p className="mt-1 text-sm text-ink-2">รอคันถัดไป {state.overflow.length} คน</p>}

      <p className="mt-4 text-sm font-semibold">นับคนที่มาถึงคิว (คนที่ไม่ได้เช็กอินผ่านแอป)</p>
      <div className="mt-2 grid grid-cols-[1fr_2fr] gap-2">
        <button
          className="btn h-20 text-2xl"
          disabled={!(v?.members.includes(null) || state.overflow.includes(null))}
          onClick={() => act("cancel")}
          aria-label="ลบหนึ่งคน"
        >
          −1
        </button>
        <button className="btn btn-primary h-20 text-3xl" onClick={() => act("checkin", 1)} aria-label="เพิ่มหนึ่งคน">
          +1
        </button>
      </div>
      <button className="btn mt-2 w-full" disabled={!v} onClick={() => act("depart")}>
        รถออกแล้ว (ออกก่อนกำหนด)
      </button>
      <p className="mt-2 text-xs text-ink-3">
        วางแท็บเล็ตไว้ที่โต๊ะคิว กด +1 ทุกครั้งที่มีคนมาต่อคิว ระบบบันทึกรถออกเองเมื่อเต็ม (นาทีลงท้าย 0/5) หรือรอครบ 20 นาที
      </p>
      <div className="mt-4 border-t border-line pt-3">
        {confirmReset ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm">ล้างคนรอทั้งหมด?</span>
            <button className="btn btn-primary" onClick={() => { void act("reset"); setConfirmReset(false); }}>ยืนยันล้างคิว</button>
            <button className="btn" onClick={() => setConfirmReset(false)}>ยกเลิก</button>
          </div>
        ) : (
          <button className="btn btn-quiet text-sm" onClick={() => setConfirmReset(true)}>ล้างคิว</button>
        )}
      </div>
    </section>
  );
}

function InTransit({ state, now, act }: { state: QueueState; now: number; act: (k: StaffKind, c?: number, r?: number | null) => Promise<void> }) {
  const list = state.trips.filter((t) => t.arrivedMs === null && now - t.depMs < 3 * 60 * MIN).slice(-5).reverse();
  return (
    <section className="panel p-5" aria-labelledby="tr-title">
      <h2 id="tr-title" className="font-display text-xl font-semibold">รถที่กำลังเดินทาง</h2>
      <p className="mt-1 text-sm text-ink-2">กดเมื่อได้รับแจ้งว่ารถถึงฟิวเจอร์พาร์ค ระบบจะได้เวลาเดินทางจริง</p>
      {list.length === 0 ? (
        <p className="mt-3 text-sm text-ink-3">ไม่มีรถที่กำลังเดินทาง</p>
      ) : (
        <ul className="mt-3 grid gap-2">
          {list.map((t) => (
            <li key={t.depMs} className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2">
              <span className="text-sm tnum">
                ออก {clockOf(t.depMs)} · {t.n} คน · {Math.floor((now - t.depMs) / MIN)} นาที
              </span>
              <button className="btn" onClick={() => act("arrive", 1, t.depMs)}>ถึงแล้ว</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------- รอบรถวันนี้ + ดาวน์โหลด ----------------

const BY: Record<Trip["by"], string> = { full: "เต็ม", timeout: "ครบ 20 นาที", staff: "เจ้าหน้าที่กด" };

function Trips({ state, now }: { state: QueueState; now: number }) {
  const rows = useMemo(
    () =>
      state.trips.map((t) => {
        const p = predictedAtStart(MODEL, t.startMs);
        const err = p ? Math.abs(t.depMs - p.mid) / MIN : null;
        const inRange = p ? t.depMs >= p.lo && t.depMs <= p.hi : null;
        return { t, p, err, inRange };
      }),
    [state.trips],
  );
  const scored = rows.filter((r) => r.err !== null);
  const mae = scored.length ? scored.reduce((a, r) => a + r.err!, 0) / scored.length : null;
  const travel = state.trips.filter((t) => t.arrivedMs !== null).map((t) => (t.arrivedMs! - t.depMs) / MIN);
  const avgTravel = travel.length ? travel.reduce((a, b) => a + b, 0) / travel.length : null;
  const checkedIn = state.trips.reduce((a, t) => a + t.members.filter(Boolean).length, 0);
  const total = state.trips.reduce((a, t) => a + t.n, 0);

  const download = () => {
    const date = bkkDateISO(now);
    const head = ["วันที่", "ปลายทาง/สาย", "เวลาเริ่มจับเวลา (คนแรกถึงคิว)", "เวลารถออก", "เวลารถถึงปลายทาง", "จำนวนคนบนรถตอนออก", "จำนวนที่นั่งรถ", "เช็กอินผ่านแอป", "สาเหตุรถออก", "ระบบทายไว้"];
    const lines = state.trips.map((t) => {
      const p = predictedAtStart(MODEL, t.startMs);
      return [date, "รังสิต-ฟิวเจอร์ปาร์ค", clockOf(t.startMs), clockOf(t.depMs), t.arrivedMs ? clockOf(t.arrivedMs) : "", t.n, SEATS, t.members.filter(Boolean).length, BY[t.by], p ? clockOf(p.mid) : ""].join(",");
    });
    const blob = new Blob(["﻿" + [head.join(","), ...lines].join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `tu-vanwise-${date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="grid gap-5">
      <section className="grid gap-3 sm:grid-cols-4">
        <Stat value={String(state.trips.length)} label="รอบที่ออกวันนี้" />
        <Stat value={mae === null ? "–" : `${mae.toFixed(1)} นาที`} label="ทายคลาดเฉลี่ย (ข้อมูลจริงวันนี้)" />
        <Stat value={avgTravel === null ? "–" : `${avgTravel.toFixed(0)} นาที`} label={`เวลาเดินทางเฉลี่ย (${travel.length} รอบ)`} />
        <Stat value={total ? `${Math.round((checkedIn / total) * 100)}%` : "–"} label="ผู้โดยสารที่เช็กอินผ่านแอป" />
      </section>
      <section className="panel p-5" aria-labelledby="trips-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="trips-title" className="font-display text-xl font-semibold">รอบรถวันนี้</h2>
          <button className="btn" disabled={!state.trips.length} onClick={download}>ดาวน์โหลด CSV (เปิดด้วย Excel)</button>
        </div>
        {rows.length === 0 ? (
          <p className="mt-3 text-sm text-ink-3">ยังไม่มีรอบที่ออกวันนี้</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm tnum">
              <thead className="text-ink-2">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3 font-medium">คนแรกถึง</th>
                  <th className="py-2 pr-3 font-medium">รถออก</th>
                  <th className="py-2 pr-3 font-medium">ระบบทาย</th>
                  <th className="py-2 pr-3 font-medium">คน</th>
                  <th className="py-2 pr-3 font-medium">สาเหตุ</th>
                  <th className="py-2 font-medium">เดินทาง</th>
                </tr>
              </thead>
              <tbody>
                {[...rows].reverse().map(({ t, p, inRange }) => (
                  <tr key={t.depMs} className="border-b border-line/60">
                    <td className="py-2 pr-3">{clockOf(t.startMs)}</td>
                    <td className="py-2 pr-3 font-semibold">{clockOf(t.depMs)}</td>
                    <td className="py-2 pr-3">
                      {p ? clockOf(p.mid) : "–"} {inRange !== null && <span className="text-ink-3">{inRange ? "✓ ในช่วง" : "นอกช่วง"}</span>}
                    </td>
                    <td className="py-2 pr-3">{t.n}</td>
                    <td className="py-2 pr-3">{BY[t.by]}</td>
                    <td className="py-2">{t.arrivedMs ? `${Math.round((t.arrivedMs - t.depMs) / MIN)} นาที` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-ink-3">CSV ใช้คอลัมน์เดียวกับชีตเก็บข้อมูล นำไปต่อท้าย TSE100_main.xlsx แล้วรัน npm run model เพื่ออัปเดตตัวทำนาย</p>
      </section>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="panel p-4">
      <p className="font-display text-2xl font-semibold tnum">{value}</p>
      <p className="mt-1 text-xs text-ink-2">{label}</p>
    </div>
  );
}

// ---------------- QR ----------------

function QrPoster() {
  const [src, setSrc] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  useEffect(() => {
    const u = `${window.location.origin}${window.location.pathname}#checkin`;
    setUrl(u);
    QRCode.toDataURL(u, { margin: 1, width: 480, color: { dark: "#1b1f26", light: "#ffffff" } }).then(setSrc).catch(() => setSrc(null));
  }, []);
  return (
    <section className="panel mx-auto max-w-md p-6 text-center" aria-labelledby="qr-title">
      <p className="font-display text-3xl font-bold"><Logo /></p>
      <h2 id="qr-title" className="mt-1 text-lg font-semibold">สแกนเพื่อเช็กอินคิวรถตู้ไปฟิวเจอร์พาร์ค</h2>
      {src ? <img src={src} alt="QR สำหรับเช็กอิน" className="mx-auto mt-4 w-64 rounded-lg" /> : <p className="mt-4 text-ink-3">กำลังสร้าง QR</p>}
      <p className="mt-3 break-all text-xs text-ink-3">{url}</p>
      <div className="mt-4 flex justify-center gap-2 print:hidden">
        {src && <a className="btn" href={src} download="tu-vanwise-qr.png">ดาวน์โหลดรูป QR</a>}
        <button className="btn" onClick={() => window.print()}>พิมพ์</button>
      </div>
      <p className="mt-3 text-xs text-ink-3 print:hidden">พิมพ์ติดที่ท่ารถตู้ ผู้โดยสารสแกนแล้วจะเปิดหน้าเช็กอินทันที</p>
    </section>
  );
}

// ---------------- โหมดทดลอง ----------------

function poisson(mean: number) {
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= Math.random();
  } while (p > L);
  return k - 1;
}

function DemoControls({ backend, pin, now, state }: { backend: Backend; pin: string; now: number; state: QueueState }) {
  const [auto, setAuto] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState("16:00");
  const nowRef = useRef(now);
  nowRef.current = now;
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    void import("@/lib/backend-local").then((m) => setSpeed(m.getDemoClock().speed || 1));
  }, []);

  // สร้างผู้โดยสารจำลองตามอัตราจริงของช่วงเวลานั้น
  useEffect(() => {
    if (!auto) return;
    let last = nowRef.current;
    const iv = window.setInterval(() => {
      const t = nowRef.current;
      const dt = Math.max(0, (t - last) / MIN);
      last = t;
      const got = getSlot(MODEL, dayTypeOf(bkkDateISO(t)), slotOf(bkkMinute(t), MODEL.meta.slotMinutes));
      const k = got ? poisson(got.stats.lam * dt) : 0;
      if (k > 0) void backend.staff(pin, "checkin", k);
      // รถที่ออกไปแล้วราว 20–25 นาที ให้ถึงปลายทางเอง
      for (const tr of stateRef.current.trips) {
        if (tr.arrivedMs === null && t - tr.depMs >= (20 + ((tr.depMs / MIN) % 6)) * MIN) void backend.staff(pin, "arrive", 1, tr.depMs);
      }
    }, 1000);
    return () => window.clearInterval(iv);
  }, [auto, backend, pin]);

  const setClock = async (hhmm: string | null) => {
    const m = await import("@/lib/backend-local");
    if (hhmm === null) return m.setDemoClock(null);
    const [h, mm] = hhmm.split(":").map(Number);
    const day = Math.floor((Date.now() + 7 * 3_600_000) / 86_400_000) * 86_400_000 - 7 * 3_600_000;
    m.setDemoClock(day + (h * 60 + mm) * MIN, speed);
  };
  const changeSpeed = async (s: number) => {
    setSpeed(s);
    (await import("@/lib/backend-local")).setDemoSpeed(s);
  };

  return (
    <section className="panel p-5 lg:col-span-2" aria-labelledby="demo-title">
      <h2 id="demo-title" className="font-display text-xl font-semibold">โหมดทดลอง</h2>
      <p className="mt-1 text-sm text-ink-2">
        ใช้สาธิตก่อนตั้งค่าเซิร์ฟเวอร์ เปิดหน้าผู้ใช้อีกแท็บในเบราว์เซอร์เดียวกันจะเห็นคิวเปลี่ยนตาม
      </p>
      <div className="mt-4 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm text-ink-2">
          ตั้งเวลาจำลอง
          <input type="time" value={time} onChange={(e) => e.target.value && setTime(e.target.value)} />
        </label>
        <button className="btn" onClick={() => setClock(time)}>เริ่มที่เวลานี้</button>
        <button className="btn btn-quiet" onClick={() => setClock(null)}>ใช้เวลาจริง</button>
        <label className="flex flex-col gap-1 text-sm text-ink-2">
          ความเร็ว
          <select value={speed} onChange={(e) => changeSpeed(Number(e.target.value))}>
            {[1, 5, 10, 30].map((s) => (
              <option key={s} value={s}>×{s}</option>
            ))}
          </select>
        </label>
        <button className={`btn ${auto ? "btn-primary" : ""}`} onClick={() => setAuto((a) => !a)} aria-pressed={auto}>
          {auto ? "หยุดผู้โดยสารจำลอง" : "เริ่มผู้โดยสารจำลอง"}
        </button>
        <button className="btn" onClick={() => backend.staff(pin, "checkin", 5)}>+5 คน</button>
      </div>
      <p className="mt-2 text-xs text-ink-3">ผู้โดยสารจำลองทำงานเฉพาะตอนเปิดหน้านี้ค้างไว้</p>
    </section>
  );
}

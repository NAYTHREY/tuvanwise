"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getBackend, type Backend, type Conn } from "./backend";
import { bkkMidnight, deriveQueue, type QueueEvent } from "./queue";

/** โหลดเหตุการณ์ของวันนี้ ฟังเหตุการณ์ใหม่ และคำนวณคิวทุกวินาที */
export function useQueue() {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [events, setEvents] = useState<QueueEvent[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const [conn, setConn] = useState<Conn>("connecting");
  const [loaded, setLoaded] = useState(false);
  const dayRef = useRef(0);

  useEffect(() => {
    let alive = true;
    void getBackend().then((b) => alive && setBackend(b));
    return () => {
      alive = false;
    };
  }, []);

  const reload = useCallback(async () => {
    if (!backend) return;
    const day = bkkMidnight(backend.now());
    dayRef.current = day;
    try {
      const list = await backend.load(day);
      setEvents(list);
      setLoaded(true);
      if (backend.mode === "local") setConn("live");
    } catch {
      setConn("offline");
    }
  }, [backend]);

  // รับเหตุการณ์ใหม่แบบเรียลไทม์
  useEffect(() => {
    if (!backend) return;
    void reload();
    const add = (e: QueueEvent) =>
      setEvents((prev) => (prev.some((x) => x.id === e.id) ? prev : [...prev, e].sort((a, b) => a.id - b.id)));
    let wasOffline = false;
    const off = backend.subscribe(add, (c) => {
      setConn(c);
      // กลับมาออนไลน์แล้ว โหลดใหม่เผื่อพลาดเหตุการณ์ระหว่างหลุด
      if (c === "live" && wasOffline) void reload();
      wasOffline = c === "offline";
    });
    let offReload = () => {};
    if (backend.mode === "local") {
      void import("./backend-local").then((m) => {
        offReload = m.onDemoReload(() => void reload());
      });
    }
    // สำรอง: โหลดใหม่ทุก 60 วินาที และเมื่อกลับมาที่แท็บ
    const iv = window.setInterval(() => void reload(), 60_000);
    const vis = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", vis);
    return () => {
      off();
      offReload();
      window.clearInterval(iv);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [backend, reload]);

  // นาฬิกา
  useEffect(() => {
    if (!backend) return;
    const tick = () => {
      const t = backend.now();
      setNow(t);
      if (dayRef.current && bkkMidnight(t) !== dayRef.current) void reload();
    };
    tick();
    const iv = window.setInterval(tick, 1000);
    return () => window.clearInterval(iv);
  }, [backend, reload]);

  const state = useMemo(() => deriveQueue(events, now), [events, now]);
  return { backend, events, state, now, conn, loaded, reload };
}

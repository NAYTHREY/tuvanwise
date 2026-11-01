// ตัวเชื่อมข้อมูลคิว มี 2 แบบ
// - supabase: เซิร์ฟเวอร์จริง ทุกเครื่องเห็นคิวเดียวกันแบบเรียลไทม์ (ตั้งค่าใน .env.local หรือ Vercel)
// - local: โหมดทดลอง เก็บในเบราว์เซอร์นี้เท่านั้น ใช้ได้ทันทีโดยไม่ต้องมีเซิร์ฟเวอร์

import type { EventKind, QueueEvent } from "./queue";

export type StaffKind = Extract<EventKind, "checkin" | "cancel" | "depart" | "arrive" | "reset">;
export type Conn = "connecting" | "live" | "offline";

export interface Backend {
  mode: "supabase" | "local";
  /** เวลาปัจจุบันที่ใช้ร่วมกัน (ms) */
  now(): number;
  load(sinceMs: number): Promise<QueueEvent[]>;
  /** รับเหตุการณ์ใหม่ทันที คืนฟังก์ชันยกเลิก */
  subscribe(onEvent: (e: QueueEvent) => void, onConn: (c: Conn) => void): () => void;
  checkin(device: string): Promise<void>;
  cancel(device: string): Promise<void>;
  verifyPin(pin: string): Promise<boolean>;
  staff(pin: string, kind: StaffKind, count?: number, ref?: number | null): Promise<void>;
}

export class BackendError extends Error {
  constructor(public code: string) {
    super(code);
  }
}

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const SERVER_CONFIGURED = Boolean(URL_ && KEY);

let cached: Promise<Backend> | null = null;
export function getBackend(): Promise<Backend> {
  if (!cached) {
    cached = SERVER_CONFIGURED
      ? import("./backend-supabase").then((m) => m.createSupabaseBackend(URL_!, KEY!))
      : import("./backend-local").then((m) => m.createLocalBackend());
  }
  return cached;
}

/** รหัสเครื่องแบบสุ่ม ใช้กันเช็กอินซ้ำ ไม่ผูกกับตัวตนผู้ใช้ */
export function deviceId(): string {
  const k = "vanwise.device";
  try {
    let id = localStorage.getItem(k);
    if (!id) {
      id = (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random()}`).replace(/[^a-z0-9-]/gi, "").slice(0, 40);
      localStorage.setItem(k, id);
    }
    return id;
  } catch {
    return "nostorage-" + Math.random().toString(36).slice(2, 12);
  }
}

export const ERROR_TEXT: Record<string, string> = {
  already_checked_in: "เครื่องนี้เช็กอินไว้แล้ว",
  not_checked_in: "ยังไม่ได้เช็กอิน",
  rate_limited: "มีคนเช็กอินพร้อมกันมาก ลองใหม่อีกครั้ง",
  bad_pin: "PIN ไม่ถูกต้อง",
  network: "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ ตรวจสอบอินเทอร์เน็ต",
};
export const errorText = (e: unknown) =>
  ERROR_TEXT[e instanceof BackendError ? e.code : "network"] ?? "เกิดข้อผิดพลาด ลองใหม่อีกครั้ง";

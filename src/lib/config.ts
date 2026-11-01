import raw from "@/data/model.json";
import type { Model } from "./model";

export const MODEL = raw as unknown as Model;

/**
 * เวลาเดินทาง ท่ารถตู้ มธ. → ฟิวเจอร์พาร์ค
 * ยังไม่มีข้อมูลวัดจริง (คอลัมน์ "เวลารถถึงปลายทาง" ใน Excel ยังว่างทุกแถว)
 * จึงใช้ค่าจากการสัมภาษณ์เจ้าหน้าที่ 4 ต.ค. 2569: รถไป-กลับประมาณ 45 นาที
 * เมื่อเก็บข้อมูลจริงได้แล้ว ให้แก้ตัวเลขนี้
 */
export const TRAVEL = {
  min: 20,
  max: 25,
  measured: false,
  source: "ประมาณจากการสัมภาษณ์เจ้าหน้าที่ (รถไป-กลับราว 45 นาที) ยังไม่ได้วัดจริง",
};

/** กติกาที่พบจากข้อมูล: รถที่ยังไม่เต็มมักออกเมื่อรอครบ 20 นาที (ใช้ในโหมดจำลองอัตโนมัติเท่านั้น) */
export const OBSERVED_CAP = 20;

/**
 * ตำแหน่งบนแผนที่ — ยังไม่ได้ยืนยันจุดขึ้นรถจริง
 * แก้พิกัดให้ตรงกับท่ารถตู้จริงแล้วเปลี่ยน confirmed เป็น true
 */
export const PLACES = {
  confirmed: false,
  origin: { name: "ท่ารถตู้ มธ. ศูนย์รังสิต", lat: 14.0716, lng: 100.6045 },
  destination: { name: "ฟิวเจอร์พาร์ค รังสิต", lat: 13.9893, lng: 100.6176 },
};

export const TZ = "Asia/Bangkok";

/** วันที่และนาทีของวันตามเวลาประเทศไทย */
export function bangkokNow(): { dateISO: string; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const dateISO = `${get("year")}-${String(get("month")).padStart(2, "0")}-${String(get("day")).padStart(2, "0")}`;
  return { dateISO, minute: get("hour") * 60 + get("minute") + get("second") / 60 };
}

const TH_DAYS = ["จันทร์", "อังคาร", "พุธ", "พฤหัสบดี", "ศุกร์", "เสาร์", "อาทิตย์"];
const TH_MONTHS = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

export function thaiDate(dateISO: string): string {
  const [y, m, d] = dateISO.split("-").map(Number);
  const wd = (new Date(`${dateISO}T00:00:00Z`).getUTCDay() + 6) % 7;
  return `วัน${TH_DAYS[wd]}ที่ ${d} ${TH_MONTHS[m - 1]} ${y + 543}`;
}

export function thaiShortDate(dateISO: string): string {
  const [, m, d] = dateISO.split("-").map(Number);
  return `${d} ${TH_MONTHS[m - 1]}`;
}

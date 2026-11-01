"use client";

import { useMemo } from "react";
import type { Model } from "@/lib/model";
import { TRAVEL, thaiShortDate } from "@/lib/config";
import { ColumnChart, type Column } from "./Charts";

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const one = (x: number) => x.toFixed(1);

type Status = "ผ่าน" | "ไม่ผ่าน" | "รอทดลองจริง";

export function DataView({ model }: { model: Model }) {
  const m = model.meta;
  const bt = model.backtest;

  const kpis: { name: string; target: string; result: string; status: Status; how: string }[] = [
    {
      name: "ความคลาดเคลื่อนเวลารอรถออก (MAE)",
      target: "≤ 5 นาที",
      result: `${one(bt.mae)} นาที`,
      status: bt.mae <= 5 ? "ผ่าน" : "ไม่ผ่าน",
      how: `ทดสอบแบบเว้นทีละวัน ${bt.days} วัน รวม ${bt.n.toLocaleString()} รอบ`,
    },
    {
      name: "ดีกว่าการเดาด้วยค่าเฉลี่ยรวม",
      target: "≥ 20%",
      result: `ดีกว่า ${pct(bt.improvement)} (ค่าเฉลี่ยรวมคลาด ${one(bt.maeBaseline)} นาที)`,
      status: bt.improvement >= 0.2 ? "ผ่าน" : "ไม่ผ่าน",
      how: "วิธีพื้นฐานคือบอกทุกคนว่ารอเท่าค่าเฉลี่ยทั้งเดือน",
    },
    {
      name: "ช่วงเวลาที่แสดงครอบคลุมค่าจริง",
      target: "≥ 80%",
      result: `${pct(bt.coverage)} (ไม่เผื่อปัดเศษ ${pct(bt.coverageStrict)})`,
      status: bt.coverage >= 0.8 ? "ผ่าน" : "ไม่ผ่าน",
      how: "ข้อมูลภาคสนามจดเวลาเป็นช่วง 5 นาที จึงเผื่อ ±2.5 นาที",
    },
    {
      name: "ความคลาดเคลื่อนเวลาเดินทาง",
      target: "≤ 5 นาที",
      result: m.travelMeasured ? `${m.travelMeasured} รอบที่มีข้อมูล` : "ยังไม่มีข้อมูลเวลาถึงปลายทาง",
      status: "รอทดลองจริง",
      how: "กดปุ่ม “ถึงแล้ว” ในส่วน “นับคน / คิว” ดูผลที่ “รอบรถวันนี้”",
    },
    {
      name: "อัตราการใช้งาน QR เช็กอิน",
      target: "≥ 50%",
      result: "ดูผลจริงที่ “รอบรถวันนี้”",
      status: "รอทดลองจริง",
      how: "เทียบจำนวนเช็กอินกับคนขึ้นรถที่ทีมนับจริง",
    },
    {
      name: "ความพึงพอใจผู้โดยสาร",
      target: "≥ 4/5",
      result: "ยังไม่ได้ทดลองกับผู้ใช้",
      status: "รอทดลองจริง",
      how: "แบบสอบถามหลังทดลองใช้",
    },
  ];

  const hourly: Column[] = useMemo(() => {
    const by = new Map<number, { n: number; e: number; b: number }>();
    for (const s of bt.bySlot) {
      const h = Math.floor(s.slot / 2);
      const cur = by.get(h) ?? { n: 0, e: 0, b: 0 };
      by.set(h, { n: cur.n + s.n, e: cur.e + s.mae * s.n, b: cur.b + s.maeBaseline * s.n });
    }
    return [...by.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([h, v]) => ({
        key: h,
        tick: String(h).padStart(2, "0"),
        values: [v.e / v.n, v.b / v.n],
        tip: [
          `${String(h).padStart(2, "0")}:00–${String(h + 1).padStart(2, "0")}:00`,
          `TU vanwise คลาด ${one(v.e / v.n)} นาที`,
          `ค่าเฉลี่ยรวมคลาด ${one(v.b / v.n)} นาที`,
          `${v.n} รอบ`,
        ],
      }));
  }, [bt]);

  const maxWd = Math.max(...model.weekday.map((w) => w.mean));
  const minWd = Math.min(...model.weekday.map((w) => w.mean));

  return (
    <div className="grid gap-5">
      <section className="panel p-5" aria-labelledby="kpi-title">
        <h2 id="kpi-title" className="font-display text-2xl font-semibold">ระบบทายแม่นแค่ไหน</h2>
        <p className="mt-1 max-w-3xl text-sm text-ink-2">
          ทดสอบโดยซ่อนข้อมูลทีละวัน ให้ระบบเรียนจากวันที่เหลือ แล้วทายเวลารอของทุกรอบในวันที่ซ่อนไว้
          ตอนที่ผู้โดยสารคนแรกถึงคิว จากนั้นเทียบกับเวลารถออกจริง ทำซ้ำครบทั้ง {bt.days} วัน
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <Stat value={`${one(bt.mae)} นาที`} label="คลาดเคลื่อนเฉลี่ยต่อรอบ" />
          <Stat value={pct(bt.within5)} label="ของรอบทายคลาดไม่เกิน 5 นาที" />
          <Stat value={pct(bt.coverage)} label="ของรอบที่เวลาจริงอยู่ในช่วงที่ระบบแสดง" />
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <caption className="sr-only">ตัวชี้วัดของโครงงานเทียบกับเป้าหมาย</caption>
            <thead className="text-ink-2">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">ตัวชี้วัด</th>
                <th className="py-2 pr-3 font-medium">เป้าหมาย</th>
                <th className="py-2 pr-3 font-medium">ผลตอนนี้</th>
                <th className="py-2 font-medium">สถานะ</th>
              </tr>
            </thead>
            <tbody>
              {kpis.map((k) => (
                <tr key={k.name} className="border-b border-line/60 align-top">
                  <td className="py-3 pr-3">
                    <p className="font-semibold">{k.name}</p>
                    <p className="text-xs text-ink-3">{k.how}</p>
                  </td>
                  <td className="py-3 pr-3 tnum">{k.target}</td>
                  <td className="py-3 pr-3 tnum">{k.result}</td>
                  <td className="py-3">
                    <StatusBadge s={k.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mt-6 font-semibold">ความคลาดเคลื่อนรายชั่วโมง (นาที ยิ่งต่ำยิ่งดี)</h3>
        <div className="mt-2">
          <ColumnChart
            columns={hourly}
            series={[
              { name: "TU vanwise", color: "var(--series-a)" },
              { name: "เดาด้วยค่าเฉลี่ยรวม", color: "var(--series-b)" },
            ]}
            unit="นาที"
            title="ความคลาดเคลื่อนเฉลี่ยรายชั่วโมง เทียบ TU vanwise กับค่าเฉลี่ยรวม"
            height={220}
          />
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-5" aria-labelledby="src-title">
          <h2 id="src-title" className="font-display text-xl font-semibold">ข้อมูลที่ใช้</h2>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <Fact k="ไฟล์" v={m.source} />
            <Fact k="สาย" v={m.route} />
            <Fact k="ช่วงที่เก็บ" v={`${thaiShortDate(m.dateFrom)} – ${thaiShortDate(m.dateTo)} 2569 (${m.days} วัน)`} />
            <Fact k="จำนวนรอบรถ" v={`${m.rows.toLocaleString()} รอบ`} />
            <Fact k="รถออกตอนเต็ม 13 ที่" v={pct(m.fullShare)} />
            <Fact k="เวลารอเฉลี่ยทั้งเดือน" v={`${one(m.overallMean)} นาที`} />
          </dl>

          <h3 className="mt-5 font-semibold">เวลารอเฉลี่ยแต่ละวัน</h3>
          <ul className="mt-2 space-y-2">
            {model.weekday.map((w) => (
              <li key={w.day} className="grid grid-cols-[64px_1fr_auto] items-center gap-3 text-sm">
                <span>{w.day}</span>
                <span className="h-3 rounded-r-[4px] bg-[var(--series-a)]" style={{ width: `${(w.mean / maxWd) * 100}%` }} aria-hidden />
                <span className="tnum text-ink-2">
                  {one(w.mean)} นาที <span className="text-ink-3">({w.days} วัน)</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">
            แต่ละวันต่างกันสูงสุด {one(maxWd - minWd)} นาที ระบบจึงแยกแค่วันธรรมดากับเสาร์–อาทิตย์ ซึ่งทดสอบแล้วแม่นที่สุด
            เสาร์มีข้อมูล 2 วันและอาทิตย์ 3 วัน ควรเก็บเพิ่ม
          </p>
        </section>

        <section className="panel p-5" aria-labelledby="method-title">
          <h2 id="method-title" className="font-display text-xl font-semibold">ระบบคำนวณอย่างไร</h2>
          <ol className="mt-3 space-y-3 text-sm">
            <Li n={1} t="แบ่งวันเป็นช่วงละ 30 นาที แยกวันธรรมดากับเสาร์–อาทิตย์">
              แต่ละช่วงเก็บเวลารอทุกรอบจาก Excel (คนแรกถึงคิวจนรถออก)
            </Li>
            <Li n={2} t="ตัดรอบที่ออกไปแล้วก่อนเวลาที่รอมา">
              ถ้ารอมาแล้ว 8 นาที ใช้เฉพาะรอบในอดีตที่รอนานกว่า 8 นาที แล้วหาค่ากลางและช่วง 10%–90% ของเวลาที่เหลือ
            </Li>
            <Li n={3} t="ใช้จำนวนคนที่เช็กอินบอกว่ารถใกล้เต็มแค่ไหน">
              เวลาเติมที่นั่งที่เหลือ = ที่นั่งว่าง ÷ อัตราคนมาถึง (λ) × ตัวปรับจากข้อมูลจริง ({one(m.ratio.mid)} เท่า)
              แล้วเลือกค่าที่น้อยกว่า
            </Li>
            <Li n={4} t="บวกเวลาเดินทางเป็นเวลาถึงปลายทาง">
              ตอนนี้ใช้ {TRAVEL.min}–{TRAVEL.max} นาทีจากการสัมภาษณ์ เพราะยังไม่มีข้อมูลวัดจริง
            </Li>
          </ol>
          <p className="mt-4 rounded-xl bg-surface-2 p-3 text-sm">
            สิ่งที่พบ: รถที่ออกโดยไม่เต็ม {m.nonFull.at20} จาก {m.nonFull.n} คันออกเมื่อรอครบ 20 นาทีพอดี
            น่าจะเป็นกติกาของท่ารถ ควรยืนยันกับเจ้าหน้าที่ เพราะในการสัมภาษณ์บอกว่าช่วงเช้าเคยรอถึงชั่วโมง
            และเวลารถออกลงท้าย 0 หรือ 5 เกือบทุกรอบ ระบบจึงปัดเวลาออกเป็น 5 นาทีถัดไป (รถเต็ม 11:43 ออก 11:45)
          </p>
        </section>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="panel p-5" aria-labelledby="limit-title">
          <h2 id="limit-title" className="font-display text-xl font-semibold">ข้อจำกัดที่ควรรู้</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm">
            <li>ข้อมูลมีเฉพาะเดือนกันยายน ยังไม่ครอบคลุมช่วงสอบ ปิดเทอม หรือฝึกงานปลายภาค ที่เจ้าหน้าที่บอกว่าคนเยอะ</li>
            <li>ไม่มีชีตของวันที่ 19, 26, 27 และ 28 ก.ย.</li>
            <li>เวลาในข้อมูลส่วนใหญ่จดทีละ 5 นาที ตัวเลขที่แสดงจึงละเอียดได้ประมาณนั้น</li>
            {model.conditions
              .filter((c) => c.label.startsWith("ฝน"))
              .map((c) => (
                <li key={c.label}>
                  {c.label}: บันทึก {c.n} รอบใน {c.days.length} วัน ({c.days.map(thaiShortDate).join(", ")}) รอเฉลี่ย {one(c.mean)} นาที
                  ข้อมูลน้อยเกินกว่าจะนำมาปรับการทำนาย
                </li>
              ))}
            <li>คอลัมน์เวลารถถึงปลายทางยังว่าง เวลาถึงฟิวเจอร์พาร์คจึงเป็นค่าประมาณ จนกว่าจะเก็บผ่านปุ่ม “ถึงแล้ว”</li>
            <li>ใครมีลิงก์ก็เช็กอินได้ แม้ไม่ได้อยู่ที่ท่ารถ ระบบกันได้แค่เช็กอินซ้ำจากเครื่องเดิม</li>
          </ul>
        </section>

        <section className="panel p-5" aria-labelledby="next-title">
          <h2 id="next-title" className="font-display text-xl font-semibold">ฟังก์ชันที่รอข้อมูล</h2>
          <p className="mt-1 text-sm text-ink-2">มีในข้อเสนอโครงงาน แต่ยังไม่ใส่ในต้นแบบเพราะยังไม่มีข้อมูลจริง</p>
          <ul className="mt-3 space-y-3 text-sm">
            <Need t="คำนวณค่าโดยสาร" d="ต้องมีอัตราค่าโดยสารทางการของสายนี้" />
            <Need t="ข้อมูลคนขับและทะเบียนรถ" d="ต้องได้รับอนุญาตจากท่ารถ และวางแนวทางคุ้มครองข้อมูลส่วนบุคคลของคนขับ" />
            <Need t="ตำแหน่งรถแบบเรียลไทม์" d="ต้องมี GPS หรือแอปบนมือถือคนขับ" />
          </ul>
        </section>
      </div>
    </div>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-xl bg-surface-2 p-4">
      <p className="font-display text-3xl font-semibold tnum">{value}</p>
      <p className="text-sm text-ink-2">{label}</p>
    </div>
  );
}

function StatusBadge({ s }: { s: Status }) {
  const style =
    s === "ผ่าน"
      ? { color: "var(--ok)", icon: "✓" }
      : s === "ไม่ผ่าน"
        ? { color: "var(--red)", icon: "✕" }
        : { color: "var(--warn)", icon: "…" };
  return (
    <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: style.color }}>
      <span aria-hidden>{style.icon}</span>
      {s}
    </span>
  );
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-ink-3">{k}</dt>
      <dd className="font-semibold">{v}</dd>
    </div>
  );
}

function Li({ n, t, children }: { n: number; t: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[28px_1fr] gap-2">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-xs font-semibold text-surface">{n}</span>
      <div>
        <p className="font-semibold">{t}</p>
        <p className="text-ink-2">{children}</p>
      </div>
    </li>
  );
}

function Need({ t, d }: { t: string; d: string }) {
  return (
    <li className="border-l-2 border-gold pl-3">
      <p className="font-semibold">{t}</p>
      <p className="text-ink-2">{d}</p>
    </li>
  );
}


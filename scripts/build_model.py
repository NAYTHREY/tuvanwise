"""สร้าง model.json สำหรับเว็บ TU vanwise จากไฟล์ Excel ที่เก็บข้อมูลภาคสนาม (ก.ย. + ต.ค. 2569)
ใช้: python3 build_model.py <xlsx> [<xlsx> ...] <output model.json>
ชีตรายวันชื่อแบบ 1sep, 29SEP, 17oct (ไม่สนตัวพิมพ์เล็กใหญ่/ช่องว่าง)
"""
import sys, re, json, math, datetime as dt, statistics as st
from collections import defaultdict, Counter
from openpyxl import load_workbook

SEATS = 13
SLOT = 30                     # นาทีต่อช่อง
FIRST_SLOT, LAST_SLOT = 14, 39  # 07:00 – 19:30
MIN_N = 5                     # ข้อมูลน้อยกว่านี้ใช้ค่ารวมทุกวันแทน
DAYS_TH = ['จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์','อาทิตย์']
QS = (0.1, 0.5, 0.9)
RATIO_QS = {'lo': 0.1, 'mid': 0.75, 'hi': 0.9}
MONTHS = {'sep': 9, 'oct': 10}
# วันที่มีงานพิเศษ ไม่ใช่การเดินรถปกติ → ไม่ใช้สร้างตัวทำนาย (ยังแสดงในหัวข้อ "สภาพอื่น")
EXCLUDE_CONDITIONS = ('openhouse',)

# ---- เวลาเดินทาง ท่ารถ มธ. → ฟิวเจอร์พาร์ค (นาที) ----
# ยังไม่มีข้อมูลวัดจริง จึงใช้ค่าประมาณตามสภาพจราจรจริงของถนนพหลโยธิน ช่วงรังสิต (จำกัดไว้ 10–30 นาที)
#   วันธรรมดา: ติดช่วงเข้างาน 07:00–09:00 และเลิกงาน 16:00–19:00, กลางวันโล่ง
#   วันศุกร์: เย็นติดหนักกว่าวันธรรมดาอื่น (คนกลับบ้าน/ออกต่างจังหวัด)
#   เสาร์–อาทิตย์: เช้าโล่ง บ่ายถึงเย็นติดแถวห้าง
# ค่าในตาราง = ค่ากลางของแต่ละช่วงครึ่งชั่วโมง เริ่ม 07:00 ถึง 19:30
TRAVEL_MIN, TRAVEL_MAX = 10, 30
TRAVEL_MID = {
    'wd':  [22, 26, 28, 25, 20, 17, 15, 14, 15, 17, 18, 17, 15, 14, 15, 16, 18, 20, 23, 26, 28, 28, 26, 22, 18, 15],
    'fri': [22, 26, 28, 25, 20, 17, 15, 14, 15, 17, 18, 17, 15, 14, 15, 17, 20, 22, 26, 29, 30, 30, 29, 25, 20, 17],
    'we':  [12, 12, 13, 13, 14, 15, 16, 17, 18, 19, 20, 20, 21, 21, 21, 22, 22, 23, 24, 24, 24, 23, 21, 19, 16, 14],
}

def travel_profile():
    out = {}
    for k, mids in TRAVEL_MID.items():
        assert len(mids) == LAST_SLOT - FIRST_SLOT + 1
        out[k] = [dict(slot=FIRST_SLOT + i,
                       lo=max(TRAVEL_MIN, mid - max(3, round(mid * 0.15))),
                       mid=mid,
                       hi=min(TRAVEL_MAX, mid + max(3, round(mid * 0.2))))
                  for i, mid in enumerate(mids)]
    return out

def q(v, p):
    if not v: return None
    i = p * (len(v) - 1); lo = math.floor(i); hi = math.ceil(i)
    return v[lo] + (v[hi] - v[lo]) * (i - lo)

def fix_time(x):
    if isinstance(x, float) and 0 <= x < 1:
        m = round(x * 1440); return dt.time(m // 60, m % 60)
    if isinstance(x, dt.datetime): return x.time()
    return x

def mins(t): return t.hour * 60 + t.minute

def load_rows(paths):
    rows, skipped, excluded = [], [], []
    for path in paths:
        wb = load_workbook(path, data_only=True)
        for ws in wb.worksheets:
            m = re.fullmatch(r'\s*(\d+)\s*([a-z]+)\s*', ws.title, re.I)
            if not m or m.group(2).lower() not in MONTHS: continue
            date = dt.date(2026, MONTHS[m.group(2).lower()], int(m.group(1)))
            for r in range(5, ws.max_row + 1):
                v = [ws.cell(r, c).value for c in range(1, 14)]
                route, start, dep, arr, pax, cond = v[1], fix_time(v[2]), fix_time(v[3]), fix_time(v[4]), v[5], v[7]
                if start is None and dep is None: continue
                if isinstance(route, str) and route.startswith('ตัวอย่าง'): continue
                tag = f'{ws.title.strip()} แถว {r}'
                # 17–21 ต.ค.: กรอกเลื่อนไปหนึ่งคอลัมน์ (เวลาคนแรกถึงคิวอยู่ช่องเวลารถออก, เวลารถออกอยู่ช่องถึงปลายทาง)
                if start is None and isinstance(dep, dt.time) and isinstance(arr, dt.time):
                    start, dep, arr = dep, arr, None
                if not isinstance(start, dt.time) or not isinstance(dep, dt.time):
                    skipped.append(f'{tag}: เวลาไม่ครบ'); continue
                wait = mins(dep) - mins(start)
                if wait < 0 or wait > 120:
                    skipped.append(f'{tag}: เวลารอ {wait} นาที'); continue
                row = dict(date=date.isoformat(), weekday=date.weekday(), start=mins(start), dep=mins(dep), wait=wait,
                           pax=pax if isinstance(pax, (int, float)) else None,
                           cond=cond if cond and cond != 'ปกติ' else None,
                           arr=arr.strftime('%H:%M') if isinstance(arr, dt.time) else None)
                if row['cond'] and any(x in str(row['cond']).lower().replace(' ', '') for x in EXCLUDE_CONDITIONS):
                    excluded.append(row); continue
                rows.append(row)
    rows.sort(key=lambda r: (r['date'], r['start']))
    return rows, skipped, excluded

def dtype(r): return 'we' if r['weekday'] >= 5 else 'wd'
def slot(m): return m // SLOT

def fit(rows):
    waits = defaultdict(list); pax = defaultdict(float); days = defaultdict(set); deps = defaultdict(int)
    for r in rows:
        for t in (dtype(r), 'all'):
            waits[(t, slot(r['start']))].append(r['wait'])
            pax[(t, slot(r['dep']))] += r['pax'] or 0
            deps[(t, slot(r['dep']))] += 1
            days[t].add(r['date'])
    lam = {k: v / len(days[k[0]]) / SLOT for k, v in pax.items()}
    dph = {k: v / len(days[k[0]]) * (60 / SLOT) for k, v in deps.items()}
    ratios = []
    for r in rows:
        l = lam.get((dtype(r), slot(r['start'])), 0)
        if r['pax'] == SEATS and l > 0: ratios.append(r['wait'] / ((SEATS - 1) / l))
    ratios.sort()
    return dict(waits={k: sorted(v) for k, v in waits.items()}, lam=lam, dph=dph,
                ratio={k: q(ratios, p) for k, p in RATIO_QS.items()}, days={k: len(v) for k, v in days.items()})

def predict(m, t, s, elapsed=0, n=1):
    """คืน (lo, mid, hi, ตัวอย่างที่ใช้) = เวลาที่เหลือก่อนรถออก (นาที) — ตรรกะเดียวกับ src/lib/model.ts"""
    v = m['waits'].get((t, s), [])
    if len(v) < MIN_N: v = m['waits'].get(('all', s), []); t = 'all'
    cond = [w - elapsed for w in v if w > elapsed]
    l = m['lam'].get((t, s), 0)
    k = SEATS - n
    if not cond: base = (0, 0, 5)
    else: base = (q(cond, 0.1), q(cond, 0.5), q(cond, 0.9))
    if k <= 0: return 0, 0, 2, len(cond)
    fill = {key: (m['ratio'][key] * k / l if l > 0 else math.inf) for key in RATIO_QS}
    return min(base[0], fill['lo']), min(base[1], fill['mid']), min(base[2], fill['hi']), len(cond)

def backtest(rows):
    days = sorted({r['date'] for r in rows})
    res = []
    for d in days:
        train = [r for r in rows if r['date'] != d]; test = [r for r in rows if r['date'] == d]
        m = fit(train); base = st.mean(r['wait'] for r in train)
        for r in test:
            lo, mid, hi, _ = predict(m, dtype(r), slot(r['start']))
            res.append(dict(slot=slot(r['start']), t=dtype(r), actual=r['wait'], pred=mid, lo=lo, hi=hi, base=base))
    mae = st.mean(abs(x['pred'] - x['actual']) for x in res)
    mae_b = st.mean(abs(x['base'] - x['actual']) for x in res)
    cov_tol = st.mean(x['lo'] - 2.5 <= x['actual'] <= x['hi'] + 2.5 for x in res)
    cov_strict = st.mean(x['lo'] <= x['actual'] <= x['hi'] for x in res)
    within5 = st.mean(abs(x['pred'] - x['actual']) <= 5 for x in res)
    by_slot = defaultdict(list)
    for x in res: by_slot[x['slot']].append(x)
    return dict(n=len(res), days=len(days), mae=mae, maeBaseline=mae_b, improvement=1 - mae / mae_b,
                coverage=cov_tol, coverageStrict=cov_strict, within5=within5,
                width=st.mean(x['hi'] - x['lo'] for x in res),
                bySlot=[dict(slot=s, n=len(v), mae=st.mean(abs(x['pred'] - x['actual']) for x in v),
                             maeBaseline=st.mean(abs(x['base'] - x['actual']) for x in v))
                        for s, v in sorted(by_slot.items())])

def forward_test(rows):
    """ทดสอบกับข้อมูลที่ระบบไม่เคยเห็น: สร้างตัวทำนายจากเดือนก่อนหน้า แล้วทายทุกรอบของเดือนล่าสุด"""
    last = max(r['date'][:7] for r in rows)
    train = [r for r in rows if r['date'][:7] < last]; test = [r for r in rows if r['date'][:7] == last]
    if not train or not test: return None
    m = fit(train); base = st.mean(r['wait'] for r in train); res = []
    for r in test:
        lo, mid, hi, _ = predict(m, dtype(r), slot(r['start']))
        res.append((r['wait'], mid, lo, hi))
    return dict(trainFrom=min(r['date'] for r in train), trainTo=max(r['date'] for r in train),
                testFrom=min(r['date'] for r in test), testTo=max(r['date'] for r in test),
                n=len(res), days=len({r['date'] for r in test}),
                mae=st.mean(abs(p - a) for a, p, _, _ in res), maeBaseline=st.mean(abs(base - a) for a, *_ in res),
                within5=st.mean(abs(p - a) <= 5 for a, p, _, _ in res),
                coverage=st.mean(lo - 2.5 <= a <= hi + 2.5 for a, _, lo, hi in res))

def main(srcs, out):
    rows, skipped, excluded = load_rows(srcs)
    m = fit(rows)
    bt = backtest(rows)
    bt['forward'] = forward_test(rows)
    slots = {}
    for t in ('wd', 'we', 'all'):
        slots[t] = []
        for s in range(FIRST_SLOT, LAST_SLOT + 1):
            v = m['waits'].get((t, s), [])
            slots[t].append(dict(slot=s, waits=v, n=len(v), lam=m['lam'].get((t, s), 0),
                                 depsPerHour=round(m['dph'].get((t, s), 0), 2),
                                 q10=q(v, .1), q50=q(v, .5), q90=q(v, .9),
                                 mean=round(st.mean(v), 2) if v else None))
    wk = defaultdict(list); wkdays = defaultdict(set)
    for r in rows: wk[r['weekday']].append(r['wait']); wkdays[r['weekday']].add(r['date'])
    weekday = [dict(day=DAYS_TH[i], days=len(wkdays[i]), n=len(wk[i]), mean=round(st.mean(wk[i]), 2)) for i in range(7) if wk[i]]
    nonfull = [r for r in rows if r['pax'] is not None and r['pax'] < SEATS]
    conds = defaultdict(list)
    for r in rows + excluded:
        if r['cond']: conds[r['cond']].append(r)
    model = dict(
        meta=dict(source=', '.join(p.split('/')[-1] for p in srcs), route='ธรรมศาสตร์ รังสิต – ฟิวเจอร์พาร์ค รังสิต', seats=SEATS,
                  slotMinutes=SLOT, firstSlot=FIRST_SLOT, lastSlot=LAST_SLOT, minN=MIN_N,
                  dateFrom=min(r['date'] for r in rows), dateTo=max(r['date'] for r in rows),
                  days=len({r['date'] for r in rows}), rows=len(rows), skipped=skipped,
                  months={mo: dict(days=len({r['date'] for r in rows if r['date'][5:7] == f'{n:02d}'}),
                                   rows=sum(r['date'][5:7] == f'{n:02d}' for r in rows))
                          for mo, n in MONTHS.items()},
                  excludedDays=sorted({r['date'] for r in excluded}), excludedRows=len(excluded),
                  daysByType=m['days'], ratio=m['ratio'],
                  fullShare=sum(r['pax'] == SEATS for r in rows) / len(rows),
                  nonFull=dict(n=len(nonfull), at20=sum(r['wait'] == 20 for r in nonfull)),
                  overallMean=st.mean(r['wait'] for r in rows),
                  travelMeasured=sum(r['arr'] is not None for r in rows),
                  generated=dt.date.today().isoformat()),
        slots=slots, weekday=weekday, backtest=bt,
        travel=dict(estimated=True, min=TRAVEL_MIN, max=TRAVEL_MAX,
                    source='ประมาณตามสภาพจราจรถนนพหลโยธินช่วงรังสิต แยกวันธรรมดา/ศุกร์/เสาร์–อาทิตย์ ยังไม่ได้วัดจริง',
                    profiles=travel_profile()),
        conditions=[dict(label=k, n=len(v), days=sorted({r['date'] for r in v}), mean=round(st.mean(r['wait'] for r in v), 2),
                         excluded=any(x in str(k).lower().replace(' ', '') for x in EXCLUDE_CONDITIONS)) for k, v in conds.items()])
    json.dump(model, open(out, 'w'), ensure_ascii=False, indent=1)
    print(f"rows={len(rows)} days={model['meta']['days']} excluded={len(excluded)} skipped={len(skipped)} MAE={bt['mae']:.2f} base={bt['maeBaseline']:.2f} "
          f"impr={bt['improvement']:.1%} cov={bt['coverage']:.1%} strict={bt['coverageStrict']:.1%} width={bt['width']:.1f} ratio={m['ratio']}")

if __name__ == '__main__':
    if len(sys.argv) < 3: sys.exit(__doc__)
    main(sys.argv[1:-1], sys.argv[-1])

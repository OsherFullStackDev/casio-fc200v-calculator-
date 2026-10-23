# Independent reference values for the FC-200V simulator.
import json, random, math, datetime, sys
import numpy_financial as npf

random.seed(20261023)
cases = []

def per_rate(ipct, py, cy):  # manual E-49
    if py == cy == 1: return ipct / 100
    return (1 + ipct / (100 * cy)) ** (cy / py) - 1

# ---- CMPD (integer n) against numpy-financial
for _ in range(3000):
    n = random.randint(1, 480)
    ipct = round(random.uniform(0.1, 30), 3)
    py = random.choice([1, 2, 4, 12]); cy = random.choice([1, 2, 4, 12, 365])
    begin = random.random() < 0.3
    pv = round(random.uniform(-500000, 500000), 2)
    pmt = round(random.uniform(-5000, 5000), 2)
    i = per_rate(ipct, py, cy)
    when = 'begin' if begin else 'end'
    fv = float(npf.fv(i, n, pmt, pv, when))
    if not math.isfinite(fv) or abs(fv) > 1e12: continue
    base = dict(n=n, iPct=ipct, PV=pv, PMT=pmt, FV=fv, PY=py, CY=cy, begin=begin, odd='CI')
    cases.append(dict(kind='tvm', target='FV', v={**base, 'FV': 0}, expect=fv))
    cases.append(dict(kind='tvm', target='PV', v=base, expect=float(npf.pv(i, n, pmt, fv, when))))
    if pmt != 0:
        cases.append(dict(kind='tvm', target='PMT', v=base, expect=float(npf.pmt(i, n, pv, fv, when))))
    # rate: only when a clear single solution exists (loan-like signs)
    if pv > 1000 and pmt < -1 and fv <= 0 and n >= 2:
        r = float(npf.rate(n, pmt, pv, fv, when))
        if math.isfinite(r) and abs(r - i) < 1e-6:
            cases.append(dict(kind='tvm', target='I%', v=base, expect=ipct))
    nn = float(npf.nper(i, pmt, pv, fv, when))
    if math.isfinite(nn): cases.append(dict(kind='tvm', target='n', v=base, expect=nn))

# ---- CASH: NPV, NFV, IRR
for _ in range(1500):
    k = random.randint(2, 20)
    flows = [round(random.uniform(-100000, -1000), 2)] + [round(random.uniform(-2000, 30000), 2) for _ in range(k)]
    ipct = round(random.uniform(0, 25), 3)
    npv = float(npf.npv(ipct / 100, flows))
    cases.append(dict(kind='npv', i=ipct, flows=flows, expect=npv))
    cases.append(dict(kind='nfv', i=ipct, flows=flows, expect=npv * (1 + ipct / 100) ** k))
    r = float(npf.irr(flows))
    if math.isfinite(r) and r * 100 > -50:
        cases.append(dict(kind='irr', flows=flows, expect=r * 100))

# ---- AMRT against numpy-financial ipmt/ppmt
for _ in range(1500):
    n = random.randint(2, 360); ipct = round(random.uniform(0.5, 20), 3)
    py = random.choice([1, 12]); cy = py
    begin = random.random() < 0.3; when = 'begin' if begin else 'end'
    pv = round(random.uniform(1000, 500000), 2)
    i = per_rate(ipct, py, cy)
    pmt = float(npf.pmt(i, n, pv, 0, when))
    pm1 = random.randint(1, n); pm2 = random.randint(pm1, n)
    ints = [float(npf.ipmt(i, k, n, pv, 0, when)) for k in range(pm1, pm2 + 1)]
    prns = [float(npf.ppmt(i, k, n, pv, 0, when)) for k in range(pm1, pm2 + 1)]
    bal = -float(npf.fv(i, pm2, pmt, pv, when))
    v = dict(n=n, iPct=ipct, PV=pv, PMT=pmt, FV=0, PY=py, CY=cy, begin=begin, PM1=pm1, PM2=pm2)
    cases.append(dict(kind='amrt', v=v, expect=dict(INT=ints[0], PRN=prns[0], BAL=bal,
                                                     **{'ΣINT': sum(ints), 'ΣPRN': sum(prns)})))

# ---- DAYS against Python's calendar
for _ in range(1500):
    a = datetime.date(1901, 1, 1) + datetime.timedelta(days=random.randint(0, 72000))
    b = a + datetime.timedelta(days=random.randint(0, 9000))
    if b.year > 2099: continue
    cases.append(dict(kind='days', d1=[a.year, a.month, a.day], d2=[b.year, b.month, b.day], expect=(b - a).days))

# ---- SMPL, CNVR, COST straight from the manual's formulas
for _ in range(800):
    dys = random.randint(1, 3000); ipct = round(random.uniform(0.1, 30), 3); pv = round(random.uniform(-1e6, 1e6), 2)
    dn = random.choice([360, 365]); si = dys / dn * pv * ipct / 100
    cases.append(dict(kind='smpl', v=dict(Dys=dys, iPct=ipct, PV=pv, dn=dn), expect=dict(SI=-si, SFV=-(pv + si))))
    n = random.randint(1, 365); apr = round(random.uniform(0.1, 40), 3)
    eff = ((1 + apr / 100 / n) ** n - 1) * 100
    cases.append(dict(kind='cnvr', n=n, apr=apr, eff=eff))
    cst = round(random.uniform(1, 1e5), 2); mrg = round(random.uniform(0, 95), 2)
    sel = cst / (1 - mrg / 100)
    cases.append(dict(kind='cost', CST=cst, SEL=sel, MRG=mrg))

# ---- DEPR transcribed from manual E-69/E-70
def depr(m, n, ipct, pv, fv, j, yr1):
    rdv = pv - fv; z = n * (n + 1) / 2; npr = n - yr1 / 12
    zp = (math.floor(npr) + 1) * (math.floor(npr) + 2 * (npr - math.floor(npr))) / 2
    syd1 = n / z * yr1 / 12 * (pv - fv)
    out = None
    for k in range(1, j + 1):
        if m == 'SL':
            d = (pv - fv) / n * yr1 / 12 if k == 1 else ((pv - fv) / n * (12 - yr1) / 12 if k == n + 1 else (pv - fv) / n)
        elif m == 'FP':
            d = pv * ipct / 100 * yr1 / 12 if k == 1 else (rdv if (k == n + 1 and yr1 != 12) else (rdv + fv) * ipct / 100)
        elif m == 'DB':
            d = pv * ipct / (100 * n) * yr1 / 12 if k == 1 else (rdv if (k == n + 1 and yr1 != 12) else (rdv + fv) * ipct / (100 * n))
        else:
            if yr1 == 12: d = (n - k + 1) / z * (pv - fv)
            elif k == 1: d = syd1
            elif k == n + 1: d = (npr - (n + 1) + 2) / zp * (pv - fv - syd1) * (12 - yr1) / 12
            else: d = (npr - k + 2) / zp * (pv - fv - syd1)
        rdv -= d; out = (d, rdv)
    return out
for _ in range(1500):
    n = random.randint(1, 40); yr1 = random.randint(1, 12); last = n if yr1 == 12 else n + 1
    j = random.randint(1, last); pv = round(random.uniform(1000, 1e6), 2); fv = round(random.uniform(0, pv * 0.3), 2)
    m = random.choice(['SL', 'FP', 'SYD', 'DB']); ipct = round(random.uniform(5, 250), 2)
    if m == 'FP': ipct = round(random.uniform(1, 60), 2)
    d, rdv = depr(m, n, ipct, pv, fv, j, yr1)
    cases.append(dict(kind='depr', m=m, v=dict(n=n, iPct=ipct, PV=pv, FV=fv, j=j, YR1=yr1), expect=dict(dep=d, RDV=rdv)))

# ---- BOND (Term) transcribed from manual E-77
for _ in range(800):
    n = random.randint(1, 60); rdv = 100; cpn = round(random.uniform(0, 12), 3); yld = round(random.uniform(0.1, 15), 3); M = random.choice([1, 2])
    prc = -rdv / (1 + yld / 100 / M) ** n - sum((cpn / M) / (1 + yld / 100 / M) ** k for k in range(1, n + 1))
    cases.append(dict(kind='bondterm', v=dict(dateMode=False, n=n, RDV=rdv, CPN=cpn, YLD=yld, M=M), expect=prc))

json.dump(cases, open(sys.argv[1], 'w'))
print(len(cases), 'cases')

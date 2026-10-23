# Loan timeline at 50 significant digits: payment, then interest for the period.
import json, random, sys
from decimal import Decimal as D, getcontext
getcontext().prec = 50
random.seed(7)
out = []
for _ in range(3000):
    n = random.randint(2, 360); ipct = round(random.uniform(0.5, 20), 3)
    py = random.choice([1, 12]); begin = random.random() < 0.5
    pv = round(random.uniform(1000, 500000), 2)
    i = D(ipct) / 100 / py
    g = (1 + i) ** n
    # Payment that clears the loan exactly.
    if g > D(10) ** 6: continue   # loans where (1+i)^n stays realistic
    # Rounded to the cent, and the very same number goes to the calculator.
    pmt = round(-(D(pv) * g) * i / ((1 + i * (1 if begin else 0)) * (g - 1)), 2)
    pm1 = random.randint(1, n); pm2 = random.randint(pm1, n)
    bal = D(pv); ints = []; prns = []
    for k in range(1, pm2 + 1):
        first = begin and k == 1
        sign = 1 if pmt > 0 else -1
        interest = D(0) if first else abs(bal * i) * sign       # manual E-58
        principal = pmt if first else pmt + bal * i
        bal = bal + principal
        if k >= pm1: ints.append(interest); prns.append(principal)
    out.append(dict(v=dict(n=n, iPct=ipct, PV=pv, PMT=float(pmt), FV=0, PY=py, CY=py, begin=begin, PM1=pm1, PM2=pm2),
                    expect={'INT': float(ints[0]), 'PRN': float(prns[0]), 'BAL': float(bal),
                            'ΣINT': float(sum(ints)), 'ΣPRN': float(sum(prns))}))
json.dump(out, open(sys.argv[1], 'w'))

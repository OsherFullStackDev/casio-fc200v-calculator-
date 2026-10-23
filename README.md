# מחשבון FC-200V

סימולטור בדפדפן של המחשבון הפיננסי Casio FC-200V, באותה פריסת מקשים, אותם צבעים ואותן פונקציות. עובד בטלפון ובמחשב, אפשר להתקין אותו כאפליקציה (PWA), והוא עובד גם בלי אינטרנט.

## מה יש בו

| מצב | מה מחשב |
| --- | --- |
| COMP | חישובים: sin/cos/tan, ln, eˣ, x², √, ^, π, e, Rnd, Δ%, nPr/nCr, Abs/Int/Frac, מעלות/רדיאנים, זיכרון A–D, X, Y, M |
| SMPL | ריבית פשוטה: SI, SFV |
| CMPD | ריבית דריבית: n, I%, PV, PMT, FV, P/Y, C/Y, Begin/End, תקופה חלקית CI/SI |
| CASH | NPV, IRR, PBP, NFV |
| AMRT | לוח סילוקין: BAL, INT, PRN, ΣINT, ΣPRN |
| CNVR | ריבית נומינלית ↔ אפקטיבית |
| COST | עלות, מחיר ושיעור רווח |
| DAYS | ימים בין תאריכים (365/360) |
| DEPR | פחת: SL, FP, SYD, DB ו-RDV |
| BOND | אג"ח: מחיר, תשואה, ריבית צבורה ועלות כוללת (Date/Term, שנתי/חצי שנתי) |
| BEVN | נקודת איזון, MOS, DOL, DFL, DCL, המרת כמות |
| STAT | 1-VAR ו-7 סוגי רגרסיה, עמודת FREQ, S-MENU, x̂/ŷ |

כמו במכשיר יש גם SHIFT/ALPHA, STO/RCL, VARS, CTLG, REPLAY (היסטוריה ועריכה עם סמן), INS, CLR, SHORTCUT/FMEM, ו-SETUP מלא. במסך עצמו יש כפתור "מדריך שימוש".

## הרצה מקומית

אין תלויות ואין שלב build. זה אתר סטטי:

```bash
npm start        # שרת על http://localhost:8080
npm test         # בדיקות (Node 20+)
```

## בדיקה מול מקור בלתי תלוי

`tests/reference.test.js` משווה את הנוסחאות ל-4,225 ערכים שחושבו בלי הקוד הזה: numpy-financial (CMPD, NPV, IRR), לוח השנה של Python (DAYS), סימולציית הלוואה ב-50 ספרות (AMRT), והנוסחאות מהמדריך של Casio שנכתבו מחדש ב-Python (כל השאר). כדי ליצור מחדש את הערכים:

```bash
python3 -m venv .venv && .venv/bin/pip install numpy-financial
.venv/bin/python tools/make_reference.py cases.json
.venv/bin/python tools/make_amrt_reference.py amrt.json
```

## פריסה

כל שירות לאתרים סטטיים מתאים. ב-Vercel: Import לרפו, בלי Framework, בלי Build Command, Output Directory = `.`

## מבנה

- `src/math.js` – מנתח ביטויים ועיצוב מספרים לתצוגה
- `src/finance.js` – הנוסחאות הפיננסיות והסטטיסטיות (לפי ההגדרות במדריך של FC-200V)
- `src/calculator.js` – מכונת המצבים של המחשבון: לחיצה ← מצב ← תצוגה של 4×16
- `src/keys.js` – פריסת המקשים
- `src/main.js` – חיבור ל-DOM, מקלדת ושמירה ב-localStorage

סימולטור עצמאי, ללא קשר ל-Casio.

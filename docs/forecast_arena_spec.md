# אפיון מערכת Forecast Arena על בסיס הטכנולוגיה הקיימת

## מטרת המסמך

המסמך מגדיר אפיון מוצרי־טכני ברור להקמת פרויקט חדש של **Forecast Arena** על בסיס מנוע הזירה הקיים, תוך העדפה למימוש **בתוך הפרויקט הקיים** ולא כקוד־בייס נפרד לחלוטין.[cite:32][cite:113][cite:116]

המסמך מיועד לעבודה ישירה מול **Claude Code כמפתח הראשי**, ולכן הוא מנוסח באופן אופרטיבי, מודולרי ומבוסס משימות, עם דגש על יכולותיו בבניית קוד, חיבור למקורות מידע, עבודה עם מסדי נתונים, הפעלת migrations, בדיקות UI, ושימוש בדפדפן לצורך ולידציה מלאה של הזרימה.[cite:4][cite:113][cite:116]

## החלטה ארכיטקטונית

ההמלצה היא **להקים את Forecast Arena בתוך הפרויקט הקיים**, כמודול/דומיין חדש בתוך אותו repository, ולא כפרויקט נפרד לחלוטין.[cite:113][cite:116] ההצדקה לכך היא שכבר קיימים מנגנוני Arena Core, APIs, Supabase, cron jobs, אבטחה, leaderboard ציבורי וזרימת benchmark חיה שנבדקו ועובדים בפועל, ולכן reuse בתוך אותו בסיס יקטין מאוד זמן פיתוח, יפחית סיכון, וישמור על אחידות תשתיתית.[cite:6][cite:32][cite:113][cite:117]

ההמלצה אינה אומרת “לערבב” את הדומיינים. יש לממש **הפרדה פנימית ברורה**: אותו monorepo או אותו app shell, אבל תחת namespace/domain נפרד כגון `forecast_arena`, `markets`, `forecast_rounds`, `forecast_submissions`, `forecast_scores`.[cite:113][cite:116] כך נשמרת היכולת בעתיד לפצל לשירות עצמאי אם יידרש, בלי להקריב עכשיו את כל המשתנים, הסודות, ה־API clients, ה־deployment pipeline וה־Supabase שכבר מחוברים בפרויקט.[cite:113][cite:114]

## עקרון המוצר

Forecast Arena היא זירת תחזיות מתמשכת שבה מספר שחקנים מבוססי AI מקבלים אותו market context, מחזירים תחזית מובנית, נמדדים לאורך זמן, ומדורגים בטבלת ביצועים חיה.[cite:76][cite:79] בשלב הראשון המערכת תתמקד ב־**forecasting על Polymarket** ולא ב־live trading מלא, משום שבשוקי תחזית יש outcome מוגדר, resolution ברור, ו־API נגיש שמאפשר למדוד איכות תחזית בצורה נקייה יותר ממסחר מניות קלאסי.[cite:97][cite:98][cite:100]

הערך המרכזי של המערכת לאורך זמן הוא לא “בחירת מודל מנצח אחד”, אלא בניית **trust layer מתמשכת**: מי מהשחקנים מדויק יותר, יציב יותר, מכויל יותר, ובאילו קטגוריות אירועים.[cite:76][cite:79][cite:95] זהו מנגנון מצטבר שמתרגם היסטוריית תחזיות ליכולת אמיתית להעריך למי להקשיב ומתי.[cite:82][cite:85][cite:95]

## היקף MVP

שלב ה־MVP יכלול:

- אינטגרציה ל־Polymarket market data בלבד.[cite:97][cite:100]
- הפעלה של 3–4 שחקנים/אייג’נטים על אותו מודל או לכל היותר שני ספקי מודלים, כדי לשלוט בעלויות.[cite:32]
- מצב **Forecast-only**: ללא פקודות קנייה/מכירה אמיתיות, אלא שמירת תחזיות, confidence, rationale, והשוואה למחיר השוק ול־event resolution.[cite:103][cite:106]
- ממשק benchmark ציבורי וממשק admin פנימי מלא.[cite:6][cite:116]

מה שלא ייכנס ל־MVP:

- מסחר אמיתי.
- אינטגרציה לברוקר מניות.
- intraday high-frequency logic.
- תמיכה מלאה בחדשות/רשתות חברתיות כבר ביום הראשון, אם כי הארכיטקטורה תיבנה כך שניתן יהיה להוסיף אותן בהמשך.[cite:103][cite:106]

## מיפוי לטכנולוגיה הקיימת

### מה נשמר

יש לשמר ככל האפשר את הליבה הקיימת של הזירה:

- מודל של tournaments / rounds / players / submissions / scores / leaderboard.[cite:113][cite:116]
- תשתית Supabase קיימת, כולל migrations, RLS, cron jobs ו־public/private data boundaries.[cite:113][cite:116][cite:117]
- מעטפת ה־UI של ה־public benchmark, בסגנון מינימליסטי עקבי.[cite:6]
- תהליכי תחזוקה ותפעול שכבר הוקמו, כולל keepalive jobs ונהלי hardening.[cite:113][cite:115][cite:116]

### מה משתנה

יש להחליף רק את שכבת הדומיין:

- `image` / `visual puzzle` מוחלף ב־`market context`.[cite:32]
- `guess` מוחלף ב־`forecast submission`.
- `avg score` מוחלף במדדי forecast performance כמו calibration, Brier score, resolved accuracy, edge vs market.[cite:76][cite:79]
- `arena tournament` מוחלף ב־`forecast season` / `evaluation run`.

## מבנה מוצע בתוך הפרויקט

ההמלצה היא להוסיף module חדש בתוך אותו repo, למשל:

```text
/apps/web
  /app/public-benchmark
  /app/forecast-arena
  /app/admin/forecast
/services
  /arena-core
  /forecast-arena
  /market-ingestion
  /scoring
/supabase
  /migrations
```

אם הפרויקט אינו monorepo, יש ליישם את אותה הפרדה כ־folders פנימיים. העיקרון הוא ש־**arena-core** יהפוך לשכבה shared, ו־**forecast-arena** יהיה adapter domain חדש מעליו.[cite:113][cite:116]

## מודל נתונים

### טבלאות reuse או הרחבה

אם קיימות טבלאות arena כלליות, יש להרחיבן במקום לייצר duplicate מיותר:

- `arena_tournaments` או `arena_seasons`
- `rounds`
- `players`
- `submissions`
- `scores`
- `agent_performance` אם כבר קיימת טבלה כזו בפרויקט.[cite:116]

### טבלאות חדשות נדרשות

#### markets

שומרת את המטא־דאטה של השוק:

- `id`
- `source`
- `source_market_id`
- `title`
- `slug`
- `category`
- `description`
- `end_date`
- `status`
- `outcome_type`
- `created_at`
- `updated_at`

#### market_snapshots

שומרת מצב שוק בכל polling cycle:[cite:98][cite:100]

- `id`
- `market_id`
- `snapshot_time`
- `yes_price`
- `no_price`
- `spread`
- `volume`
- `liquidity`
- `open_interest`
- `raw_payload`

#### forecast_rounds

מייצגת חלון הערכה:

- `id`
- `season_id`
- `market_id`
- `round_time`
- `context_version`
- `status`
- `created_at`

#### forecast_submissions

- `id`
- `round_id`
- `player_id`
- `market_id`
- `probability_yes`
- `confidence`
- `action`
- `rationale_short`
- `input_tokens`
- `output_tokens`
- `latency_ms`
- `model_name`
- `prompt_version`
- `created_at`

#### market_resolutions

- `id`
- `market_id`
- `resolved_outcome`
- `resolved_at`
- `resolution_source`
- `notes`

#### forecast_scores

- `id`
- `submission_id`
- `player_id`
- `market_id`
- `brier_score`
- `log_loss`
- `calibration_bucket`
- `market_edge`
- `resolved_score`
- `scored_at`

#### agent_wallets

לצורך שליטה כספית עתידית, גם אם אין live trading ב־MVP:

- `id`
- `player_id`
- `paper_balance`
- `allocated_capital`
- `realized_pnl`
- `unrealized_pnl`
- `max_drawdown`
- `updated_at`

#### agent_transactions

טבלה זו קריטית ל־audit trail מלא:

- `id`
- `player_id`
- `market_id`
- `submission_id`
- `transaction_type`
- `side`
- `price`
- `size`
- `notional`
- `status`
- `reason`
- `exchange_response`
- `created_at`

#### audit_events

לצורך תחקור מלא של כל פעולה:

- `id`
- `entity_type`
- `entity_id`
- `event_type`
- `actor`
- `summary`
- `payload`
- `created_at`

## שכבות המערכת

### 1. Market Ingestion Layer

שכבה זו תמשוך מידע מ־Polymarket APIs ותבנה market context פנימי.[cite:97][cite:98][cite:100]

יכולות נדרשות:

- משיכת רשימת שווקים פעילים.
- polling קבוע למחירים.
- שמירת snapshots היסטוריים.
- קליטת resolution של שווקים שנסגרו.
- normalization של payloads חיצוניים ל־schema אחיד.

Claude Code צריך לממש אותה כ־service מבודד עם retry logic, rate-limit awareness, logging מפורט, ו־dead-letter handling בסיסי אם request נכשל שוב ושוב.[cite:97][cite:100]

### 2. Context Builder

השכבה בונה context compact עבור כל שוק לפני הרצת שחקנים:

- כותרת השוק.
- תיאור השוק.
- מחיר yes/no נוכחי.
- שינוי מחיר מאז הסבב הקודם.
- נפח/נזילות אם זמינים.
- timeline קצר של snapshots אחרונים.

בהמשך אפשר להרחיב שכבה זו עם חדשות, טקסטים, tweets, אך ב־MVP אין חובה לכך.[cite:97][cite:100]

### 3. Player Engine

מנוע השחקנים יריץ 3–4 profiles שונים:

- `fast_reactor`
- `text_weighted_analyst`
- `contrarian`
- `consensus_guard`

לכל שחקן יהיו:

- prompt system קבוע
- state optional
- policy להגשת תחזית
- optional rule של abstain/no-update

יש להעדיף בהתחלה אותו model provider עם prompt/persona שונה, כדי להוכיח value לפני הגדלת עלויות.[cite:32]

### 4. Scoring Engine

ב־MVP scoring יהיה Forecast-first:

- Brier score על שווקים resolved.[cite:76][cite:79]
- Log loss.[cite:79]
- Calibration buckets, למשל תחזיות 0.6–0.7, 0.7–0.8 וכן הלאה.[cite:76]
- Edge מול מחיר שוק בזמן הגשת התחזית.
- Stability score: כמה השחקן משנה כיוון ללא הצדקה חזקה.

אין להיכנס ב־MVP לחישובי PnL מורכבים אלא אם נוסף paper trading mode בהמשך.[cite:103][cite:106]

### 5. Admin & Operations Layer

זו שכבה קריטית ולא nice-to-have. המערכת חייבת לכלול ממשק ניהול מקיף, כי המטרה היא גם שליטה, גם תחקור, וגם שיפור עתידי.[cite:119]

## ממשק הניהול הנדרש

### דשבורד עליון

המסך הראשי של ה־admin יכלול:

- מספר שווקים פעילים.
- מספר rounds שנפתחו היום.
- מספר submissions שנקלטו.
- שיעור כשלים בקריאות API.
- עלות משוערת לפי provider/model.
- שחקנים מובילים לפי 7 ימים / 30 ימים / all time.
- backlog של שווקים unresolved.

### מסך Players

עבור כל שחקן:

- ביצועים כלליים.
- ביצועים לפי קטגוריה.
- calibration chart.
- היסטוריית תחזיות.
- average latency.
- token usage.
- cost estimate.
- prompt version history.
- last successful run / last failure.

### מסך Market Detail

עבור כל שוק:

- market metadata.
- timeline של המחיר.
- כל הסבבים שנפתחו על השוק.
- מה כל שחקן הגיש בכל round.
- rationale קצר.
- שינויי תחזית לאורך זמן.
- outcome final אם resolved.

### מסך Transactions / Paper Ledger

גם אם אין מסחר אמיתי מיידית, חייב להיות ledger ברור:

- כל פעולה שהמערכת “הייתה מבצעת”.
- side, price, size, notional.
- source submission.
- status.
- PnL paper.
- cumulative exposure.

### מסך Costs & Finance

מסך חובה:

- עלות לפי model.
- עלות לפי player.
- עלות לפי יום/שבוע/חודש.
- עלות ממוצעת לכל market evaluation.
- cost per resolved win.
- API usage anomalies.

### מסך Audit / Explainability

זהו מסך תחקור מרכזי:

- למה נפתח round.
- איזה context נשלח.
- באיזו prompt version השתמשו.
- מה חזר מהמודל.
- אילו scores חושבו.
- האם הייתה שגיאת provider.
- מי/מה שינה הגדרה ניהולית.

## הרשאות ואבטחה

כיוון שהפרויקט רץ על Supabase ו־RLS כבר טופלו בפרויקט הקיים, יש להמשיך באותו קו קשוח.[cite:116][cite:117]

- כל טבלאות admin יהיו private בלבד.
- כל קריאות הניהול יעברו דרך server-side בלבד.
- public benchmark יקבל רק views ו־aggregates בטוחים.
- raw payloads, transactions, prompts, logs ו־costs לא יהיו זמינים ל־anon.
- כל migration חדש ייבדק מול Security Advisor.

## החלטת UI/UX

הצד הציבורי יישאר מינימליסטי, benchmark-oriented, בסגנון הנקי שכבר הועדף בזירת המודלים הקיימת.[cite:6]

ה־admin לעומת זאת צריך להיות utility-first:

- tables מהירות
- filters ברורים
- charts פשוטים
- drill-down מהיר
- ללא עומס ויזואלי, אבל עם density גבוהה יותר

המטרה היא לא “דשבורד יפה”, אלא כלי שליטה אמיתי יומיומי.

## Workflow לביצוע על ידי Claude Code

Claude Code ישמש כמפתח הראשי מקצה לקצה. לכן יש לצוות אותו לביצוע בפאזות סגורות, עם review אחרי כל שלב.[cite:4]

### Phase 1 — Domain Setup

- ניתוח הארכיטקטורה הקיימת.
- איתור כל מודולי ה־arena reusable.
- יצירת namespace חדש של forecast arena.
- הוספת migrations בסיסיות.
- שמירה על backward compatibility מלאה עם ה־public benchmark הקיים.[cite:116]

### Phase 2 — Market Ingestion

- חיבור ל־Polymarket APIs.[cite:97][cite:98]
- יצירת sync jobs.
- שמירת markets ו־market_snapshots.
- בדיקות retry ו־error handling.

### Phase 3 — Player Engine

- מימוש player profiles.
- הגדרת prompt schemas.
- שמירת submissions structured.
- לוגים מלאים לכל הרצה.

### Phase 4 — Scoring

- Brier/log-loss calculations.[cite:76][cite:79]
- leaderboard aggregates.
- category breakdowns.
- initial calibration view.

### Phase 5 — Admin System

- admin dashboard.
- pages: overview, players, markets, transactions, finance, audit.
- filters, exports, pagination.

### Phase 6 — QA + Browser Validation

Claude Code צריך להשתמש ביכולות browser/control כדי:

- לפתוח את ה־admin ואת ה־public benchmark.
- לעבור flow מלא של market sync → round creation → player submission → score update → leaderboard render.
- לבדוק states empty/loading/error.
- לוודא שלא נשבר ה־public benchmark הקיים.[cite:116]

## הנחיות ביצוע חשובות לקלוד קוד

1. אין לשבור שום route או schema קיימים שעבורם ה־public benchmark כבר תלוי.[cite:116]
2. יש לעבוד migration-first ולא לערוך ישירות production tables בלי SQL מתועד.[cite:113][cite:114]
3. יש להעדיף הרחבה של services קיימים על פני שכפול קוד.
4. כל endpoint חדש חייב להיות עם logging, structured errors ו־admin observability.
5. כל צד ניהולי ייבנה server-side protected בלבד.
6. יש להשתמש ב־feature flags אם צריך כדי לאפשר rollout בטוח.
7. יש לאמת end-to-end דרך הדפדפן אחרי כל phase משמעותי.

## המלצה לגבי מיקום הפרויקט

למרות שהמוצר הוא חדש, ההמלצה כרגע היא **לא לפתוח repository נפרד**.[cite:113][cite:116] הפיתוח צריך להיות בתוך הפרויקט הקיים, תחת דומיין חדש, משום שזה חוסך:

- הגדרת תשתיות חדשות
- שכפול secrets
- שכפול clients
- שכפול deployment
- שכפול Supabase schema management

בשלב מאוחר יותר, אם Forecast Arena יוכיח traction או ידרוש scaling/בידוד רגולטורי/חשבונאי, אפשר יהיה לפצל אותו.[cite:113][cite:116]

## שאלות פתוחות שדורשות החלטה ממך

לפני תחילת הבנייה, צריך ממך רק כמה הכרעות מוצריות קצרות:

1. האם ה־MVP מתחיל **רק עם Polymarket**, או שכבר עכשיו אתה רוצה להכין schema source-agnostic גם לקריפטו/מניות.
2. האם אתה רוצה ב־MVP רק **forecast tracking**, או כבר paper trading ledger מלא.
3. האם ה־admin יהיה פתוח רק לך/לצוות קטן, או שיש כוונה להראות חלק ממנו גם ללקוחות בעתיד.
4. האם אתה רוצה English-first או Hebrew-first ב־admin. אם יש Hebrew mode, צריך להקפיד על אפס אנגלית בטקסטים הפונים למשתמש, בהתאם להעדפה הידועה שלך.[cite:3]
5. האם יש provider מועדף לשחקנים הראשונים, או שעדיף להתחיל ממה שכבר מוגדר בפרויקט כדי לקצר זמן setup.

## קריטריוני הצלחה ל־30 הימים הראשונים

הפיילוט ייחשב מוצלח אם בתוך 30 יום מתקיימים התנאים הבאים:

- data ingestion יציב של Polymarket markets.[cite:97][cite:100]
- לפחות 3 players רצים אוטומטית.
- leaderboard מתעדכן ללא התערבות ידנית.
- admin מספק visibility מלאה על runs, costs, scores ו־audit trail.
- ה־public benchmark הקיים ממשיך לעבוד ללא regression.[cite:116]
- אפשר לקבל תשובה ברורה האם יש שונות אמיתית בין players, או שהמערכת עדיין לא מייצרת signal משמעותי.[cite:79][cite:95]

## מסקנה

הדרך הנכונה היא לבנות את Forecast Arena **בתוך הפרויקט הקיים, כמודול דומיין חדש מעל מנוע הזירה הקיים**, ולא כפרויקט חדש מאפס.[cite:113][cite:116] זה נותן את יחס הסיכון־תועלת הטוב ביותר, מאפשר reuse עמוק של התשתית שכבר נבדקה, ושומר על אופציה עתידית לפצל אם וכאשר המוצר יצמח.[cite:32][cite:113][cite:116]

האיפיון צריך להיות ממומש על ידי Claude Code בפאזות סגורות, עם דגש חזק על observability, auditability, cost control, ו־admin visibility — לא רק על הרצת מודלים.[cite:4][cite:119] בלי שכבת הניהול הזו, לא תהיה לך שליטה אמיתית במערכת, לא תוכל לתחקר, ולא תדע אם הערך המצטבר של הזירה הוא אמיתי או רק מדומה.[cite:119]

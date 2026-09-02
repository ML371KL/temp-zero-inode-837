# Аудит движка, сентябрь-2026 (v4.14.0)

Инструментарий экономического аудита панели: реплика скоринга (engine.py = ветка bt-v4136 + защиты
от пустых блоков; loader.py задаёт дефолт «живая логика v4.13.9» = варианты V1,V2,V4,V5,V7,V8,VT,OH),
машина ступеней и симулятор (harness.py), анализы a1…a10, отчёты рецензентов rev1/rev2, выходы out/.

Данные не включены: fetch.sh / fetch2.sh качают FRED (curl с дефолтным UA) и Yahoo (браузерный UA,
кусками по 5 лет); полная история HY/IG OAS 2000–2023 берётся из зеркала viki-m13/bonds
(см. loader.py, MIRROR). Внешние наборы (Шиллер, OECD CLI, FINRA, AAII, ISM) — EXTDATA_README.md.

Порядок: fetch.sh → fetch2.sh → a1_indicators.py [1990-01-01|2003-01-01] → a2_ablation.py →
a3_alternatives.py → a5_redesign.py → a6_events.py → a7_v5.py → a8_final.py → a9_lead.py → a10_prune.py;
report_build.py собирает HTML-отчёт из out/*.csv. Запускать с PYTHONIOENCODING=utf-8.

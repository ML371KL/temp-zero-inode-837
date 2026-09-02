# -*- coding: utf-8 -*-
"""Tiny inline-SVG chart helpers for the report (no external libs; theme via CSS classes)."""
import numpy as np, pandas as pd

def _scale(vmin, vmax, lo, hi):
    span = (vmax - vmin) or 1.0
    return lambda v: lo + (v - vmin) / span * (hi - lo)

def line_chart(series: dict, width=860, height=300, logy=True, ylabel="", title="", shade=None, yfmt=None, classes=None, legend=True):
    """series: name -> pd.Series (datetime index). shade: list of (start,end) date pairs to shade."""
    pad_l, pad_r, pad_t, pad_b = 54, 16, 28, 34
    allx = pd.concat([s for s in series.values()]).index
    x0, x1 = allx.min(), allx.max()
    vals = pd.concat([s for s in series.values()])
    if logy:
        vals = np.log(vals[vals > 0])
    y0, y1 = float(vals.min()), float(vals.max())
    y0, y1 = y0 - (y1 - y0) * 0.04, y1 + (y1 - y0) * 0.04
    sx = _scale(x0.value, x1.value, pad_l, width - pad_r)
    sy = _scale(y0, y1, height - pad_b, pad_t)
    out = [f'<svg viewBox="0 0 {width} {height}" class="chart" role="img" aria-label="{title}">']
    if title: out.append(f'<text x="{pad_l}" y="16" class="ch-title">{title}</text>')
    if shade:
        for a, b in shade:
            xa, xb = sx(pd.Timestamp(a).value), sx(pd.Timestamp(b).value)
            out.append(f'<rect x="{xa:.1f}" y="{pad_t}" width="{xb-xa:.1f}" height="{height-pad_t-pad_b}" class="ch-shade"/>')
    # y grid
    if logy:
        ticks = [1, 2, 3, 5, 8, 13, 20]
        ticks = [t for t in ticks if y0 <= np.log(t) <= y1]
        for t in ticks:
            yy = sy(np.log(t)); out.append(f'<line x1="{pad_l}" x2="{width-pad_r}" y1="{yy:.1f}" y2="{yy:.1f}" class="ch-grid"/>')
            out.append(f'<text x="{pad_l-6}" y="{yy+4:.1f}" class="ch-tick" text-anchor="end">{t}×</text>')
    else:
        for t in np.linspace(y0, y1, 5):
            yy = sy(t); out.append(f'<line x1="{pad_l}" x2="{width-pad_r}" y1="{yy:.1f}" y2="{yy:.1f}" class="ch-grid"/>')
            lab = yfmt(t) if yfmt else f"{t:.0f}"
            out.append(f'<text x="{pad_l-6}" y="{yy+4:.1f}" class="ch-tick" text-anchor="end">{lab}</text>')
    # x ticks (years)
    for yr in range(x0.year + 1, x1.year + 1, 2 if (x1.year - x0.year) < 30 else 4):
        xx = sx(pd.Timestamp(f"{yr}-01-01").value)
        out.append(f'<text x="{xx:.1f}" y="{height-pad_b+16}" class="ch-tick" text-anchor="middle">{yr}</text>')
    classes = classes or {}
    i = 0
    for name, s in series.items():
        s = s.dropna()
        if logy: s = np.log(s[s > 0])
        s = s.iloc[:: max(1, len(s) // 1200)]
        pts = " ".join(f"{sx(t.value):.1f},{sy(v):.1f}" for t, v in s.items())
        cls = classes.get(name, f"ch-l{i}")
        out.append(f'<polyline points="{pts}" class="ch-line {cls}" fill="none"/>')
        i += 1
    if legend:
        lx = pad_l + 6; ly = pad_t + 14
        i = 0
        for name in series:
            cls = classes.get(name, f"ch-l{i}")
            out.append(f'<line x1="{lx}" x2="{lx+18}" y1="{ly-4}" y2="{ly-4}" class="ch-line {cls}"/>')
            out.append(f'<text x="{lx+24}" y="{ly}" class="ch-leg">{name}</text>')
            ly += 16; i += 1
    if ylabel: out.append(f'<text x="{pad_l}" y="{height-6}" class="ch-tick">{ylabel}</text>')
    out.append("</svg>")
    return "\n".join(out)

def step_area(s: pd.Series, width=860, height=150, title="", shade=None, ymax=1.0, cls="ch-area"):
    pad_l, pad_r, pad_t, pad_b = 54, 16, 24, 30
    s = s.dropna(); x0, x1 = s.index.min(), s.index.max()
    sx = _scale(x0.value, x1.value, pad_l, width - pad_r); sy = _scale(0, ymax, height - pad_b, pad_t)
    out = [f'<svg viewBox="0 0 {width} {height}" class="chart" role="img" aria-label="{title}">']
    if title: out.append(f'<text x="{pad_l}" y="16" class="ch-title">{title}</text>')
    if shade:
        for a, b in shade:
            xa, xb = sx(pd.Timestamp(a).value), sx(pd.Timestamp(b).value)
            out.append(f'<rect x="{xa:.1f}" y="{pad_t}" width="{xb-xa:.1f}" height="{height-pad_t-pad_b}" class="ch-shade"/>')
    for t in (0, 0.5, 1.0):
        yy = sy(t); out.append(f'<line x1="{pad_l}" x2="{width-pad_r}" y1="{yy:.1f}" y2="{yy:.1f}" class="ch-grid"/>')
        out.append(f'<text x="{pad_l-6}" y="{yy+4:.1f}" class="ch-tick" text-anchor="end">{int(t*100)}%</text>')
    ch = s[s.diff().fillna(1) != 0]
    pts = [f"{sx(x0.value):.1f},{sy(0):.1f}"]
    prev = None
    for t, v in ch.items():
        xx = sx(t.value)
        if prev is not None: pts.append(f"{xx:.1f},{sy(prev):.1f}")
        pts.append(f"{xx:.1f},{sy(v):.1f}"); prev = v
    pts.append(f"{sx(x1.value):.1f},{sy(prev):.1f}"); pts.append(f"{sx(x1.value):.1f},{sy(0):.1f}")
    out.append(f'<polygon points="{" ".join(pts)}" class="{cls}"/>')
    for yr in range(x0.year + 1, x1.year + 1, 2 if (x1.year - x0.year) < 30 else 4):
        xx = sx(pd.Timestamp(f"{yr}-01-01").value)
        out.append(f'<text x="{xx:.1f}" y="{height-pad_b+16}" class="ch-tick" text-anchor="middle">{yr}</text>')
    out.append("</svg>")
    return "\n".join(out)

def bar_chart(labels, values, width=860, height=260, title="", fmt="{:+.1f}%", baseline=0.0, colors=None, sublabels=None):
    n = len(labels); pad_l, pad_r, pad_t, pad_b = 40, 16, 28, 54
    vmin, vmax = min(min(values), baseline), max(max(values), baseline)
    rng = (vmax - vmin) or 1; vmin -= rng * 0.15; vmax += rng * 0.15
    sy = _scale(vmin, vmax, height - pad_b, pad_t)
    bw = (width - pad_l - pad_r) / n
    out = [f'<svg viewBox="0 0 {width} {height}" class="chart" role="img" aria-label="{title}">']
    if title: out.append(f'<text x="{pad_l}" y="16" class="ch-title">{title}</text>')
    yb = sy(baseline); out.append(f'<line x1="{pad_l}" x2="{width-pad_r}" y1="{yb:.1f}" y2="{yb:.1f}" class="ch-axis"/>')
    for i, (lab, v) in enumerate(zip(labels, values)):
        x = pad_l + i * bw + bw * 0.15; w = bw * 0.7
        y = sy(v); top, h = (min(y, yb), abs(y - yb))
        cls = (colors[i] if colors else ("ch-bar-pos" if v >= baseline else "ch-bar-neg"))
        out.append(f'<rect x="{x:.1f}" y="{top:.1f}" width="{w:.1f}" height="{max(h,1):.1f}" class="{cls}"/>')
        ty = top - 5 if v >= baseline else top + h + 13
        out.append(f'<text x="{x+w/2:.1f}" y="{ty:.1f}" class="ch-val" text-anchor="middle">{fmt.format(v)}</text>')
        out.append(f'<text x="{x+w/2:.1f}" y="{height-pad_b+16}" class="ch-tick" text-anchor="middle">{lab}</text>')
        if sublabels: out.append(f'<text x="{x+w/2:.1f}" y="{height-pad_b+30}" class="ch-sub" text-anchor="middle">{sublabels[i]}</text>')
    out.append("</svg>")
    return "\n".join(out)

CHART_CSS = """
.chart{width:100%;height:auto;display:block}
.ch-title{font:600 12.5px var(--mono);fill:var(--ink-2)}
.ch-tick{font:11px var(--mono);fill:var(--ink-3)}
.ch-sub{font:10px var(--mono);fill:var(--ink-3)}
.ch-leg{font:11.5px var(--mono);fill:var(--ink)}
.ch-val{font:600 11px var(--mono);fill:var(--ink-2)}
.ch-grid{stroke:var(--line);stroke-width:1;stroke-dasharray:2 4}
.ch-axis{stroke:var(--ink-3);stroke-width:1}
.ch-shade{fill:var(--shade)}
.ch-line{stroke-width:1.8;stroke-linejoin:round}
.ch-l0{stroke:var(--ink-3)} .ch-l1{stroke:var(--accent)} .ch-l2{stroke:var(--accent-2)} .ch-l3{stroke:var(--ok)}
.ch-area{fill:var(--accent-soft)}
.ch-bar-pos{fill:var(--ok)} .ch-bar-neg{fill:var(--bad)} .ch-bar-neu{fill:var(--ink-3)}
"""

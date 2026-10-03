# -*- coding: utf-8 -*-
import io, os
OUT = os.path.dirname(os.path.abspath(__file__))

INK, MUTED, RULE, ACCENT, FILL = '#16181d', '#5a6070', '#d9dce3', '#1f4f8f', '#f7f8fa'
SANS = "Segoe UI,Helvetica Neue,Arial,sans-serif"


def esc(s):
    return s.replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')


def box(x, y, w, h, title, sub=None, fill=FILL, stroke=RULE, tcol=INK,
        dashed=False, ts=11.5, ss=9.5):
    d = ' stroke-dasharray="4 3"' if dashed else ''
    o = ['<rect x="%s" y="%s" width="%s" height="%s" rx="5" fill="%s" stroke="%s" '
         'stroke-width="1"%s/>' % (x, y, w, h, fill, stroke, d)]
    cx = x + w / 2.0
    if sub:
        o.append(txt(cx, y + h / 2.0 - 1, title, size=ts, anchor='middle',
                     weight='600', fill=tcol))
        o.append(txt(cx, y + h / 2.0 + 14, sub, size=ss, anchor='middle', fill=MUTED))
    else:
        o.append(txt(cx, y + h / 2.0 + 4, title, size=ts, anchor='middle',
                     weight='600', fill=tcol))
    return '\n'.join(o)


def txt(x, y, s, size=10, anchor='start', fill=INK, weight='400', style=''):
    st = ' font-style="%s"' % style if style else ''
    return ('<text x="%.1f" y="%.1f" text-anchor="%s" font-family="%s" font-size="%s" '
            'font-weight="%s" fill="%s"%s>%s</text>'
            % (float(x), float(y), anchor, SANS, size, weight, fill, st, esc(s)))


def arrow(x1, y1, x2, y2, dashed=False):
    d = ' stroke-dasharray="4 3"' if dashed else ''
    return ('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="#8b93a3" '
            'stroke-width="1.4"%s marker-end="url(#ah)"/>'
            % (float(x1), float(y1), float(x2), float(y2), d))


MARKER = ('<defs><marker id="ah" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" '
          'markerHeight="6" orient="auto-start-reverse">'
          '<path d="M 0 0 L 10 5 L 0 10 z" fill="#8b93a3"/></marker></defs>')


def gutter(y, label):
    return txt(88, y, label, size=9, anchor='end', fill=MUTED, weight='600')


# ---------------------------------------------------------------- architecture
W, H = 760, 436
s = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" width="%d" height="%d" '
     'role="img" aria-label="Cadence architecture: a five-stage synthesis pipeline over '
     'one kernel interface with a CPU and a GPU backend, fed by a library of more '
     'than two hundred built-in voices">' % (W, H, W, H),
     MARKER,
     '<rect x="0" y="0" width="%d" height="%d" fill="#ffffff"/>' % (W, H)]

s.append(gutter(30, 'DEMO'))
s.append(box(100, 8, 651, 36,
             'apps/web  \u00b7  voice picker with samples  \u00b7  playground  \u00b7  '
             'long-form editor  \u00b7  live RTF meter',
             dashed=True, fill='#ffffff', ts=10.5))

XS = [100, 234, 368, 502, 636]
BW, BY, BH = 115, 62, 56
stages = [('Text in', 'plain or marked up'),
          ('Front end', 'normalise \u00b7 G2P'),
          ('Acoustic model', 'phonemes \u2192 mel'),
          ('Vocoder', 'mel \u2192 24 kHz PCM'),
          ('AudioWorklet', 'streaming out')]
s.append(gutter(BY + 20, 'PIPELINE'))
for x, (t_, sub) in zip(XS, stages):
    s.append(box(x, BY, BW, BH, t_, sub))
for x in XS[:-1]:
    s.append(arrow(x + BW + 2, BY + BH / 2.0, x + BW + 17, BY + BH / 2.0))

# Two sources of the speaker vector, both feeding the same riser into the acoustic model.
RISER, S1, S2, SH = 425.5, 132, 174, 32
s.append(box(100, S1, 230, SH, 'Voice library  ·  200+ built-in voices',
             'an embedding vector and a sample clip each', ts=10.5, ss=9))
s.append(box(100, S2, 110, SH, 'Reference audio', '10 seconds', fill='#ffffff', ts=10, ss=9))
s.append(box(224, S2, 106, SH, 'Speaker encoder', 'voice vector', ts=10, ss=9))
s.append(arrow(212, S2 + SH / 2.0, 222, S2 + SH / 2.0))
# cloning path joins the riser
s.append('<polyline points="332,%.1f %.1f,%.1f %.1f,%.1f" fill="none" stroke="#8b93a3" '
         'stroke-width="1.4"/>'
         % (S2 + SH / 2.0, RISER, S2 + SH / 2.0, RISER, S1 + SH / 2.0))
# default path joins the riser and carries the arrowhead up into the acoustic model
s.append('<polyline points="332,%.1f %.1f,%.1f %.1f,%.1f" fill="none" stroke="#8b93a3" '
         'stroke-width="1.4" marker-end="url(#ah)"/>'
         % (S1 + SH / 2.0, RISER, S1 + SH / 2.0, RISER, BY + BH + 4))
s.append(f'<circle cx="{RISER}" cy="{S1 + SH / 2.0}" r="2.4" fill="#8b93a3"/>')
s.append(txt(340, S1 + 12, 'default', size=9, fill=MUTED, style='italic'))
s.append(txt(340, S2 + 12, 'cloning path', size=9, fill=MUTED, style='italic'))

KY, KH = 230, 38
s.append(gutter(KY + 22, 'KERNELS'))
s.append(box(100, KY, 651, KH,
             'Kernel interface  \u2014  gemm \u00b7 conv \u00b7 attention \u00b7 activations',
             fill='#eef2f8', stroke='#c3d0e2', tcol=ACCENT, ts=11))
s.append(arrow(559.5, BY + BH + 4, 559.5, KY - 3, dashed=True))
s.append(txt(571, 160, 'all tensor compute runs here', size=9, fill=MUTED, style='italic'))

DY, DH, DW = 286, 100, 316
s.append(gutter(DY + 26, 'BACKENDS'))
backends = [
    (100, 'CPU backend', 'WebAssembly SIMD  \u00b7  default',
     ['Hand-written GEMM microkernel',
      'Cache blocking, register tiling, packing',
      'int8 weights, per-channel scales, fused ops',
      'Workers over SharedArrayBuffer']),
    (435, 'GPU backend', 'WGSL compute  \u00b7  when available',
     ['Tiled matmul in workgroup memory',
      'Fused dequantise \u2192 multiply',
      'Same operator set, same tests',
      'Carries the larger cloning model'])]
for x, title, sub, lines in backends:
    s.append('<rect x="%d" y="%d" width="%d" height="%d" rx="5" fill="%s" stroke="%s"/>'
             % (x, DY, DW, DH, FILL, RULE))
    s.append(txt(x + 14, DY + 21, title, size=11.5, weight='600', fill=ACCENT))
    s.append(txt(x + 14, DY + 36, sub, size=9.5, fill=MUTED))
    for i, ln in enumerate(lines):
        yy = DY + 55 + i * 14
        s.append('<circle cx="%d" cy="%.1f" r="1.7" fill="#9aa2b1"/>' % (x + 17, yy - 3.5))
        s.append(txt(x + 25, yy, ln, size=9.5))

s.append('<line x1="100" y1="406" x2="751" y2="406" stroke="%s"/>' % RULE)
s.append(txt(100, 424, 'The same engine package runs unchanged in the browser, in Node and '
                       'in Electron. No framework is imported below the demo layer.',
             size=9.5, fill=MUTED, style='italic'))
s.append('</svg>')
io.open(os.path.join(OUT, 'diagram-architecture.svg'), 'w', encoding='utf-8').write('\n'.join(s))

# -------------------------------------------------------------------- timeline
TASKS = [
    ('Prototype and real-time-factor spike', 0, 2, 1),
    ('Text front end \u2014 normalisation, G2P', 1, 6, 1),
    ('CPU kernels \u2014 SIMD GEMM, int8, threads', 2, 10, 1),
    ('Vocoder kernels', 6, 12, 1),
    ('Acoustic model and streaming worklet', 8, 14, 1),
    ('GPU backend \u2014 WGSL operator set', 10, 16, 1),
    ('Voice library — curation and labelling', 12, 18, 1),
    ('Cloning path, editor, public release', 14, 18, 1),
    ('Data pipeline and corpus preparation', 18, 24, 2),
    ('Train the vocoder', 22, 30, 2),
    ('Train the acoustic model', 28, 40, 2),
    ('Voice design and speech-to-speech', 36, 44, 2),
]
LG, RG, TOP, RH, RGAP, WEEKS = 288, 20, 40, 17, 5, 44
TW = 760 - LG - RG
TH = TOP + len(TASKS) * (RH + RGAP) + 14


def wx(w):
    return LG + TW * w / float(WEEKS)


t = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 %d" width="760" height="%d" '
     'role="img" aria-label="Cadence schedule: Phase 1 engine over eighteen weeks, '
     'Phase 2 training to week forty-four">' % (TH, TH),
     '<rect x="0" y="0" width="760" height="%d" fill="#ffffff"/>' % TH]
for w in range(0, WEEKS + 1, 4):
    x = wx(w)
    t.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="#eceef2"/>'
             % (x, TOP - 6, x, TH - 14))
    t.append(txt(x, TOP - 12, 'w%d' % w, size=8.5, anchor='middle', fill=MUTED))
xd = wx(18)
t.append('<line x1="%.1f" y1="%d" x2="%.1f" y2="%d" stroke="%s" stroke-width="1.2" '
         'stroke-dasharray="4 3"/>' % (xd, TOP - 28, xd, TH - 14, ACCENT))
t.append(txt(wx(9), TOP - 30, 'PHASE 1 \u2014 THE ENGINE', size=9, anchor='middle',
             weight='600', fill=ACCENT))
t.append(txt(wx(31), TOP - 30, 'PHASE 2 \u2014 THE WEIGHTS', size=9, anchor='middle',
             weight='600', fill='#6b7688'))
for i, (name, a, b, ph) in enumerate(TASKS):
    y = TOP + i * (RH + RGAP)
    t.append(txt(LG - 12, y + 12, name, size=9.5, anchor='end'))
    x1, x2 = wx(a), wx(b)
    fill = ACCENT if ph == 1 else '#98a4b6'
    t.append('<rect x="%.1f" y="%d" width="%.1f" height="%d" rx="3" fill="%s"/>'
             % (x1, y, x2 - x1, RH, fill))
t.append('</svg>')
io.open(os.path.join(OUT, 'diagram-timeline.svg'), 'w', encoding='utf-8').write('\n'.join(t))
print('written; timeline height', TH)

from pathlib import Path
p = Path('webapp/src/components/SoloEmulatorView.tsx')
s = p.read_text()
old = '        enableFrameCapture: false,'
new = '        enableFrameCapture: true,'
if s.count(old) != 1:
    raise SystemExit(f'Expected exactly one Solo frame-capture flag, got {s.count(old)}')
p.write_text(s.replace(old, new))
print('Enabled the same preserved WebGL frame path for Solo as NetPlay; source archive unchanged.')

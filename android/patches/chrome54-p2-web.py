from pathlib import Path

# Build-only compatibility target for the Marshmallow P2 browser. Keep app source intact;
# this emits the old-browser bundle and leaves PS1 emulation exclusively on P1.
vite = Path('webapp/vite.config.ts')
s = vite.read_text()
old = "targets: ['Chrome >= 44']"
new = "targets: ['Chrome >= 54']"
if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise SystemExit('Could not find the Vite legacy-browser target')
vite.write_text(s)
print('Configured the compatibility web build for Chrome 54 and the P2 stream-only flow.')

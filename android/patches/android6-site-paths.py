from pathlib import Path

# GitHub Pages serves a project site under /<repository>/ rather than the domain root.
# Make Vite emit correct asset URLs there, while leaving the APK build default at '/'.
vite = Path('webapp/vite.config.ts')
s = vite.read_text()
needle = '''  return {
    plugins: [
'''
replacement = '''  return {
    base: process.env.VITE_BASE_PATH || '/',
    plugins: [
'''
if 'base: process.env.VITE_BASE_PATH' not in s:
    if s.count(needle) != 1:
        raise SystemExit('Could not add the GitHub Pages base path to Vite config')
    s = s.replace(needle, replacement, 1)
vite.write_text(s)

# Fix the existing studio image URL so it also loads under the Pages project path.
auth = Path('webapp/src/components/AuthGate.tsx')
s = auth.read_text()
old = 'src="/src/assets/images/ps1_console_studio_1795445729900.jpg"'
new = 'src={import.meta.env.BASE_URL + \'src/assets/images/ps1_console_studio_1795445729900.jpg\'}'
if old in s:
    s = s.replace(old, new, 1)
if old in s:
    raise SystemExit('Auth page image URL replacement did not apply')
auth.write_text(s)
print('Configured path-safe GitHub Pages assets for the Android 6 web build.')

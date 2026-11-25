from pathlib import Path
import re
p=Path('android/app/build.gradle.kts')
s=p.read_text()
s=re.sub(r'versionCode = \d+\n\s*versionName = "[^"]+"', 'versionCode = 19\n        versionName = "1.1.8-launch-recovery-compact-marshmallow"', s, count=1)
if 'versionCode = 19' not in s: raise SystemExit('Could not bump Android APK version')
p.write_text(s)
print('Bumped APK to versionCode 19.')

from pathlib import Path
import sys

page = Path(sys.argv[1] if len(sys.argv) > 1 else 'webapp/dist/marshmallow.html')
s = page.read_text()
if 'marshmallow-compact-page' in s:
    print('Marshmallow compact layout already present')
    raise SystemExit(0)
needle = '<head>'
if needle not in s:
    raise SystemExit('Could not find HTML head for Marshmallow compact layout')
insert = '''<head>
<script>document.documentElement.classList.add('marshmallow-compact-page');</script>
<style id="marshmallow-compact-page">
html.marshmallow-compact-page{font-size:13px!important}
.marshmallow-compact-page body{letter-spacing:0!important}
.marshmallow-compact-page header>div:first-child{height:54px!important;gap:.5rem!important;padding-left:.65rem!important;padding-right:.65rem!important}
.marshmallow-compact-page header>div:nth-child(2){padding:.25rem .4rem!important}
.marshmallow-compact-page main>div[class*="max-w-"]{padding-left:.65rem!important;padding-right:.65rem!important;padding-top:.7rem!important;padding-bottom:.7rem!important}
.marshmallow-compact-page main .px-6{padding-left:.65rem!important;padding-right:.65rem!important}
.marshmallow-compact-page main .py-8{padding-top:.7rem!important;padding-bottom:.7rem!important}
.marshmallow-compact-page main .p-6{padding:.8rem!important}
.marshmallow-compact-page main .p-5{padding:.7rem!important}
.marshmallow-compact-page main .gap-6{gap:.75rem!important}
.marshmallow-compact-page main .space-y-8>:not(:first-child){margin-top:.75rem!important}
.marshmallow-compact-page main .space-y-6>:not(:first-child){margin-top:.65rem!important}
</style>'''
s = s.replace(needle, insert, 1)
page.write_text(s)
print('Added compact spacing/font rules only to the Marshmallow page.')

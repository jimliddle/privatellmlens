from pathlib import Path
import base64, gzip, re

wrapper = Path('scripts/apply_local_tools.py').read_text(encoding='utf-8')
match = re.search(r"b64decode\('([^']+)'\)", wrapper)
if not match:
    raise SystemExit('compressed patch payload not found')
script = gzip.decompress(base64.b64decode(match.group(1))).decode('utf-8')
script = script.replace(
    'text = pattern.sub(tool_code, text, count=1)',
    'text = pattern.sub(lambda _: tool_code, text, count=1)',
)
exec(compile(script, 'apply_local_tools.py', 'exec'))

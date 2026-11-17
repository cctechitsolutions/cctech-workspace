"""Generate import-free editor deployments from the maintained function sources."""
from pathlib import Path
from html import escape
import re

root = Path(__file__).resolve().parent.parent
shared = root / 'supabase/functions/_shared'
def flatten(text):
    return '\n'.join(line for line in text.splitlines() if not line.startswith('import ')).replace('export ', '')
for function, dependencies in {
    'meta-webhook': ['whatsapp-webhook.mjs', 'meta-channels.mjs', 'worker-auth.mjs'],
    'channel-worker': ['whatsapp-webhook.mjs', 'meta-channels.mjs', 'customer-intake.mjs', 'conversation.mjs', 'worker-auth.mjs'],
}.items():
    entry = (root / f'supabase/functions/{function}/index.ts').read_text(encoding='utf-8')
    code = '// @ts-nocheck\n// Generated from maintained CCTech source. Store credentials only in Supabase Secrets.\n'
    code += '\n'.join(flatten((shared / name).read_text(encoding='utf-8')) for name in dependencies)
    code += '\n' + flatten(entry)
    output = root / f'artifacts/{function}'
    output.mkdir(parents=True, exist_ok=True)
    (output / 'index.ts').write_text(code, encoding='utf-8')
    filename = 'deploy-receiver.html' if function == 'meta-webhook' else 'deploy-worker.html'
    (root / filename).write_text('''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>CCTech function deployment</title><link rel="stylesheet" href="sourcing-workspace.css"><script type="module" src="deploy-receiver.mjs"></script></head><body><header><div><h1>CCTech server function</h1><p>No passwords or access tokens are included.</p></div></header><main><section class="card"><h2>'''+escape(function)+'''</h2><p>Copy the full code. Replace all of index.ts in the matching Supabase function and deploy the update.</p><button id="copyGroupSql">Copy complete function code</button><p id="copyStatus" role="status"></p><label>Function code<textarea id="groupSql" rows="24" readonly>'''+escape(code)+'''</textarea></label></section></main></body></html>''',encoding='utf-8')
    print(output / 'index.ts')

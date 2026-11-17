from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
from shutil import copyfile

root = Path(__file__).resolve().parent.parent
output = root / 'artifacts'
output.mkdir(exist_ok=True)
files = [
    'privacy-policy.html', 'data-deletion.html',
    'guided-intake.mjs', 'conversation-engine.mjs',
    'group-setup.html', 'group-setup.mjs',
    'workspace-dashboard.css', 'workspace-dashboard.mjs',
    'sourcing-workspace.html', 'sourcing-workspace.css', 'sourcing-workspace.mjs',
    'sourcing-client.mjs', 'sourcing-config.mjs', 'sourcing-orders.mjs',
    'sourcing-orders-model.mjs', 'sourcing-rfq.mjs', 'sourcing-pricing.mjs',
    'order-complete.html', 'order-complete.mjs', 'docs/supabase-setup.md',
]
shared = root / 'supabase/functions/_shared'
customer = (shared / 'customer-intake.mjs').read_text(encoding='utf-8').replace('export function planCustomer', 'function planCustomer')
conversation = (shared / 'conversation.mjs').read_text(encoding='utf-8').replace("import { planCustomer } from './customer-intake.mjs';", '')
(root / 'conversation-engine.mjs').write_text(customer + '\n' + conversation, encoding='utf-8')
target = output / 'cctech-workspace.zip'
entry = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=sourcing-workspace.html"><title>CCTech workspace</title></head><body><a href="sourcing-workspace.html">Open CCTech workspace</a></body></html>'
# A separate GitHub Pages path; never replace the public site's index.html.
workspace = root / 'workspace'
workspace.mkdir(exist_ok=True)
(workspace / 'index.html').write_text(entry, encoding='utf-8')
for name in files:
    destination = workspace / name
    destination.parent.mkdir(parents=True, exist_ok=True)
    copyfile(root / name, destination)
with ZipFile(target, 'w', ZIP_DEFLATED) as archive:
    archive.writestr('index.html', entry)
    for name in files:
        archive.write(root / name, name)
print(target)

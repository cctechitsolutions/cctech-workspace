"""Prepare the standalone CCTech app repository without unrelated website files.

Run from the existing project. The output is a separate upload folder; it does
not delete files from the old site, change Git remotes, or copy runtime secrets.
"""
from pathlib import Path
from shutil import copyfile
from zipfile import ZipFile, ZIP_DEFLATED
import hashlib
import json
import re
import subprocess
import sys

root = Path(__file__).resolve().parent.parent
destination = root.parent / 'CCTech Workspace'
if destination.resolve() == root.resolve():
    destination = root / 'artifacts/repository-upload'
manifest_path = destination / 'repository-package.json'
if destination.exists() and any(destination.iterdir()) and not manifest_path.exists():
    raise SystemExit('Output folder already contains unrelated files; choose a clean destination.')

# Keep generated browser/editor code consistent with the maintained functions.
subprocess.run([sys.executable, str(root / 'scripts/build-edge-editor.py')], check=True)
subprocess.run([sys.executable, str(root / 'scripts/package-workspace.py')], check=True)

files = [
    '.env.example', '.gitignore', 'package.json', 'package-lock.json',
    'privacy-policy.html', 'data-deletion.html',
    'sourcing-workspace.html', 'sourcing-workspace.css', 'sourcing-workspace.mjs',
    'sourcing-client.mjs', 'sourcing-config.mjs', 'sourcing-orders.mjs',
    'sourcing-orders-model.mjs', 'sourcing-rfq.mjs', 'sourcing-pricing.mjs',
    'workspace-dashboard.css', 'workspace-dashboard.mjs',
    'guided-intake.mjs', 'conversation-engine.mjs',
    'order-complete.html', 'order-complete.mjs',
    'group-setup.html', 'group-setup.mjs', 'setup-workspace.html', 'setup-workspace.mjs',
    'deploy-receiver.html', 'deploy-receiver.mjs', 'deploy-worker.html',
    'scripts/build-edge-editor.py', 'scripts/build-upgrade.py', 'scripts/package-workspace.py',
    'scripts/package-repository.py',
    'docs/connections-setup.md', 'docs/order-workflow.md', 'docs/supabase-setup.md',
    'docs/vendor-rfq-workflow.md', 'docs/whatsapp-automation.md',
    'supabase/config.toml', 'supabase/activate-owner.sql', 'supabase/activate-staff.sql',
    'supabase/setup-cctech.sql', 'supabase/upgrade-workspace.sql',
]
files += [str(p.relative_to(root)).replace('\\', '/') for p in sorted((root / 'tests').glob('*.test.mjs'))]
files += [str(p.relative_to(root)).replace('\\', '/') for p in sorted((root / 'supabase/migrations').glob('[0-9][0-9][0-9]_*.sql'))]
files += [str(p.relative_to(root)).replace('\\', '/') for p in sorted((root / 'supabase/functions').rglob('*')) if p.is_file() and p.suffix in ('.mjs', '.ts')]

for name in files:
    text = (root / name).read_text(encoding='utf-8')
    # Public publishable configuration is expected; server credentials are not.
    if re.search(r'\bsb_secret_[A-Za-z0-9_-]{12,}|\bEAA[A-Za-z0-9]{50,}|\beyJ[A-Za-z0-9_-]{30,}\.[A-Za-z0-9_-]{20,}\.', text):
        raise SystemExit(f'Possible credential in {name}; stopped before packaging.')
    if 'owner-review' in text and name in ('privacy-policy.html', 'data-deletion.html'):
        raise SystemExit('Privacy pages still contain an unapproved draft label.')

destination.mkdir(exist_ok=True)
for name in files:
    target = destination / name
    target.parent.mkdir(parents=True, exist_ok=True)
    copyfile(root / name, target)

(destination / 'index.html').write_text('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="0;url=sourcing-workspace.html"><title>CCTech Business Workspace</title></head><body><a href="sourcing-workspace.html">Open CCTech Business Workspace</a></body></html>', encoding='utf-8')
(destination / '.nojekyll').write_text('', encoding='utf-8')
(destination / 'README.md').write_text('''# CCTech Business Workspace

Standalone business application for CCTech IT Solutions, separate from the
public company website. The owner-approved privacy and data-deletion pages are
included. Application records remain in the existing Supabase project; copying
these files neither copies customer data nor activates messaging.

## Publish this repository

1. Create an empty public GitHub repository named `cctech-workspace` under
   `cctechitsolutions`. Do not initialise it with a generated README.
2. Upload the CONTENTS of this folder to the repository root. Do not upload the
   ZIP itself or an enclosing folder. `index.html` must be at the root.
3. In Settings > Pages, choose Deploy from a branch, main, /(root), then Save.
4. Wait for deployment and verify these URLs open:
   - https://cctechitsolutions.github.io/cctech-workspace/
   - https://cctechitsolutions.github.io/cctech-workspace/privacy-policy.html
   - https://cctechitsolutions.github.io/cctech-workspace/data-deletion.html
5. Sign into the new app using the existing Supabase owner/staff account.
   In Payment instructions and review link, save Public workspace URL as
   `https://cctechitsolutions.github.io/cctech-workspace`.
6. Set the privacy and data-deletion instruction URLs in Meta App settings > Basic.
   Review remaining Meta publishing requirements for each channel.

The old website/workspace is left in place until the new app is verified.
Do not delete the old repository or change its public homepage.

## Existing backend and live setup

Supabase project: `mjdgcytomlpciemjhcqc`.
Existing unified Meta callback (unchanged by moving the frontend):
`https://mjdgcytomlpciemjhcqc.supabase.co/functions/v1/clever-worker`.
Its display name is `meta-webhook`; the actual URL slug is `clever-worker`.

As last confirmed by the owner: Facebook messages and automatic replies worked;
WhatsApp test-message delivery, webhook verification and messages subscription
worked. Real WhatsApp inbound processing/automatic replies, the production
business number, Instagram messaging and vendor automation still need verification.
No paid WhatsApp template activation or spending budget has been approved.
This package contains local reply-flow improvements; local tests are not proof
that the same revision is deployed to Supabase.

## Development and backend source

- `python -m http.server 8080 --bind 127.0.0.1` serves the app locally.
- `npm ci` then `npm test` runs the tests.
- `python scripts/build-edge-editor.py` prepares single-file dashboard deployments.
- `python scripts/package-workspace.py` packages the frontend.
- The `supabase/` folder contains maintained functions and SQL history.
- `.env.example` lists configuration NAMES only. Real secrets belong in Supabase.

Do not rerun SQL setup/upgrades against the existing project without checking
which migrations have already been applied. Packaging does not migrate data,
deploy functions, change server switches or connect a Meta channel.

## Privacy and security

Customer/vendor records are protected by Supabase Auth and row-level security.
The publishable browser key is intentionally public and grants no admin access.
Do not upload private `.env` files, access tokens, personal attachments,
database exports, `node_modules`, `.git` or private setup notes.
''', encoding='utf-8')

guide = '''CCTECH WORKSPACE - SEPARATE REPOSITORY UPLOAD

Folder to upload: D:\\CCTech Workspace
Repository name: cctech-workspace
Owner: cctechitsolutions

Create: https://github.com/new
Choose Public. Leave README, licence and .gitignore initialisation unchecked.
Create repository, then use Upload files.
Select the CONTENTS of D:\\CCTech Workspace. Do not upload the ZIP file.
Keep index.html at the root; do not add another workspace/ folder around it.
Commit to main.

Settings > Pages > Deploy from a branch > main > /(root) > Save.
After GitHub Pages succeeds, the expected app address is:
https://cctechitsolutions.github.io/cctech-workspace/

Meta privacy URL, after the page is live:
https://cctechitsolutions.github.io/cctech-workspace/privacy-policy.html
Meta data deletion instructions URL, after the page is live:
https://cctechitsolutions.github.io/cctech-workspace/data-deletion.html

In the new workspace, save Public workspace URL as:
https://cctechitsolutions.github.io/cctech-workspace

Supabase data, logins, secrets and the clever-worker callback remain unchanged.
No new Supabase project is needed. Do not rerun SQL just because of this move.
Leave the old workspace running until the new address is verified.

WhatsApp and Instagram automation still need channel setup and end-to-end tests.
This upload alone does not activate them or approve paid messaging.
'''
(destination / 'UPLOAD-STEPS.txt').write_text(guide, encoding='utf-8')

packaged = sorted(p for p in destination.rglob('*') if p.is_file() and p != manifest_path)
manifest = {'repository': 'cctech-workspace', 'files': {str(p.relative_to(destination)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest() for p in packaged}}
manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
archive = root / 'artifacts/cctech-workspace-repository.zip'
with ZipFile(archive, 'w', ZIP_DEFLATED) as z:
    for p in sorted(destination.rglob('*')):
        if p.is_file():z.write(p, str(p.relative_to(destination)).replace('\\','/'))
print(f'Upload folder: {destination}')
print(f'Files: {len(packaged)+1}')
print(f'Backup ZIP: {archive}')

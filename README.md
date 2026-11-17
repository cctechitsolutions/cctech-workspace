# CCTech Business Workspace

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

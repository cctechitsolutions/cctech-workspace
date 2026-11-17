# Activate the CCTech connections

Live setup is partial. The receiver and worker were deployed on 12 November 2026;
Facebook server credentials were saved privately. Processing and sending remain
off, and a live automatic reply has not yet been verified. Local updates on
13 November still require deployment. WhatsApp and Instagram sending stay off.

## 1. Existing Supabase project

In project `mjdgcytomlpciemjhcqc`, create the staff Auth user
`chandra15031993@gmail.com` with a separate private password. Owner is
`cctechitsolutions@gmail.com`. Separate logins are necessary for owner-only payment
verification; the system cannot distinguish people sharing the owner's login.

Run `supabase/upgrade-workspace.sql` once in the SQL Editor. It is for the existing
project where migrations 001 and 002 were already applied. It retains vendors and
enquiries and applies migrations 003–008 in one transaction. If staff Auth is
created afterward, run `supabase/activate-staff.sql` after creating that user.
Do not run the original setup SQL again or blindly run `supabase db push` against
this manually initialized project.

## 2. Host the static workspace

Run `python scripts/package-workspace.py`. The frontend ZIP contains only the
explicit browser files, including the public publishable key. It excludes server
secrets, .git, database records, tests and node_modules. Host it at an HTTPS address
using the existing website repository or another approved host. If using the
existing website, publish the bundle in a separate `workspace/` directory so its
entry page does not replace the public business homepage. The static files
do not contain private business records; Supabase Auth/RLS protects those records.

Set the hosted base URL in workspace settings so the owner/staff alert links and
customer completion links point to the actual hosted app. Localhost is not suitable
for public webhook callbacks or links sent to customers.

## 3. Prepare Meta assets

- A Meta developer app under the business administrator's account.
- WhatsApp Business Platform account/phone and authorised number onboarding.
  Check the official supported coexistence path before changing the existing
  WhatsApp Business app number. Merely saving a phone or Meta ID is not connection.
- Facebook Page administrator authorisation for Page messaging.
- Eligible Instagram professional account and authorised messaging integration.
- Review the applicable permissions/access levels and complete Meta's required
  verification/app review before enabling real customer traffic.

Meta IDs go in Channel connections. App secrets/access tokens go only into server
secrets using the dashboard. Never paste passwords, OTPs or tokens into chat.
The Supabase publishable key supplied earlier cannot deploy functions or manage
these secrets; project-management login/authorisation is needed for those steps.

## 4. Deploy the backend with sending off

With Supabase CLI already authenticated by the owner, these are the deployment
commands (they do not migrate the database):

```powershell
npx supabase functions deploy meta-webhook --project-ref mjdgcytomlpciemjhcqc
npx supabase functions deploy channel-worker --project-ref mjdgcytomlpciemjhcqc
```

Use `.env.example` as the list of server variable NAMES, not as a public file of
real values. Supabase normally supplies SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
to functions. A project may instead supply a current secret key via server-only
configuration; reserved SUPABASE_ names may not be manually assignable in the UI.

Set the actual Graph API version shown in the Meta setup, channel business IDs,
each channel's access token/app secret, a random Meta verification token and a
random worker secret of at least 32 characters. Leave all of these false:

```text
AUTOMATION_PROCESS_ENABLED=false
AUTOMATION_SEND_ENABLED=false
WHATSAPP_COSTS_APPROVED=false
WHATSAPP_PAID_TEMPLATES_ENABLED=false
```

The existing deployment's actual callback URL is:
`https://mjdgcytomlpciemjhcqc.supabase.co/functions/v1/clever-worker`
Its display name is `meta-webhook`; renaming that label did not change the slug.
Update that existing function when using the dashboard editor. The CLI command
above would create a separate `meta-webhook` endpoint, so do not switch Meta's
callback without deploying and verifying the replacement first.

If the original `META_VERIFY_TOKEN` value is no longer available, leave its
Supabase secret unchanged. The updated receiver also accepts a separate
`WHATSAPP_VERIFY_TOKEN` of at least 32 characters for subscription challenges.
Choose and save that new value privately in Supabase, deploy the updated
receiver to the existing `clever-worker` endpoint, and enter the same new value
in WhatsApp webhook configuration. Do not copy a SHA256 digest as the value.
Both verification values remain accepted; POST messages still require the
correct channel App Secret signature. This does not enable sending or charges.

Configure the appropriate message webhook subscriptions for each authorised
channel and the matching verify token. The signed receiver must accept requests
without a Supabase JWT. POST webhook
payloads must have a valid channel App Secret signature before storage.

The updated receiver calls the worker with the server service-role JWT in
`Authorization` when available, preserving gateway JWT checks, and the private
`x-automation-worker-secret` header. The worker checks that secret independently;
a gateway JWT alone cannot invoke it. Deploy both updated functions together.
For environments configured without gateway JWT checks, the existing secret
Bearer authentication remains supported. Neither credential may appear in a
browser script or public cron URL.
The receiver wakes the worker after durable storage when processing is enabled.
Use a server scheduler with secret headers, approximately once a minute. Scheduling
is not installed or activated by these files. With processing/sending disabled,
no outbound jobs are claimed and no API messages are sent.

## 5. Verify and activate only after review

Test the subscribed accounts using permitted test contacts, with explicit approval
before sending real test messages. Verify correct account binding, no duplicate
imports, vendor/customer separation, quote approval, owner-only payment actions,
and customer completion scope. A signed incoming message marks the matching
saved connection as receiving; it does not enable sending automatically.

When ready, enable a verified channel in the workspace, enable server processing,
and separately approve/enable sending. WhatsApp costs and any paid templates need
explicit budget approval; no promise of permanently free messaging is made.
Outside a supported reply window, the worker blocks messages unless an approved
English template and the required cost permission are configured. Facebook and
Instagram closed-window messages are held rather than forcing a prohibited send.

Blocked or ambiguous jobs remain visible. Provider timeouts are held for review,
never blindly retried. Releasing them requires checking whether Meta accepted the
message to avoid duplicate sends/costs. No automated retry/release UI is provided
yet; an administrator must handle recovery.

Staff at the same number used by the WhatsApp sender receives workspace alerts.
Closed-app push notifications and separate WhatsApp delivery to that same sender
number are not implemented. Media IDs are captured, but media interpretation and
general free-form AI conversations are not implemented.

## Verification

`npm test` covers guided intake, durable event deduplication, reply parsing,
business pricing, actual PostgreSQL migrations/RLS/RPC roles, approvals, stale
revisions, owner payment protection, completion tokens, reminders and send gates.
These local checks are not evidence of live Meta delivery or deployed credentials.

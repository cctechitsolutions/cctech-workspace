# Connect the CCTech staff workspace

The CCTech project `mjdgcytomlpciemjhcqc` is configured in `sourcing-config.mjs`.
Its Auth settings endpoint accepted the publishable key on November 3, 2026.
The Data API reported that enquiries and suppliers were absent from the schema
cache. The database still needs initialization. The workspace runs locally;
it has not been deployed or verified with staff/supplier database access tests.

## When ready to connect

1. Keep the existing project on your selected free plan. Do not enable paid upgrades.
2. In the project's SQL Editor, run `supabase/setup-cctech.sql` once. This combines
   migrations 001 and 002 in order in a single transaction.
   Use a fresh development project first. Migration 002 deliberately rejects any
   existing offer with a mismatched supplier/request; review such rows manually.
3. In Authentication, create your owner user with email/password. Disable public
   sign-ups if this is only a staff/supplier application. Copy its user UUID.
4. From the SQL Editor only, provision that user as staff:

   ```sql
   insert into public.profiles (user_id, role, display_name)
   values ('YOUR-AUTH-USER-UUID', 'staff', 'CCTech owner');
   ```

   Do not grant staff through customer/supplier forms or user-editable metadata.
5. Serve this checkout locally: `python -m http.server 8080 --bind 127.0.0.1`.
   Open `http://127.0.0.1:8080/sourcing-workspace.html`.
6. Sign in using the staff email/password. The public URL and publishable key are
   already configured. No secret/service-role key belongs in the app. Login tokens
   and loaded business records stay in page memory, not localStorage. Refreshing
   the page requires sign-in again.
7. With synthetic records, save an enquiry and a supplier; sign out, sign back in
   and verify the records load. Refreshing does not delete database records.

## Required database access checks before real data

Create separate staff, Supplier A, Supplier B and unprovisioned Auth users.
Link the two supplier UUIDs to separate `suppliers.portal_user_id` records.
Test the REST API using each user's JWT; hiding UI is not an authorization test.

- Anonymous/unprovisioned users cannot read or write enquiries/suppliers/offers.
- Staff can create/list enquiries and suppliers.
- Supplier A cannot read customer enquiries, Supplier B's profile, requests or offers.
- Supplier A can insert an offer only for an A request, with A's supplier ID.
- A mixed A request/B supplier offer fails, as does moving an A offer to B's request.
- Suppliers cannot change their profile role or change an RFQ message/recipient.
- Logout and session expiry remove private records from the page.

These checks have **not** been executed against a real Supabase project in this
workspace. The browser client tests use mocked HTTP responses and do not prove RLS.

## What this stage includes

Staff sign-in, in-memory session handling, enquiry intake across all 15 categories,
supplier/service-partner creation and loading the most recent 100 records of each.
`vendor-sourcing.html` remains a separate practice demo with no persistence.

Next stages: supplier contact details, matching/RFQ preparation, manual WhatsApp
sharing, private supplier replies, offer comparison and pricing, customer quote
approval and verified NCH handoff. No messages, invoices or purchases are triggered
by this stage. NCH Express Invoice remains the official billing system.

## Development checks

Run `node --test tests/sourcing-client.test.mjs`. No package install is needed.
Auth transport follows [Supabase Auth REST documentation](https://supabase.github.io/auth/).
The browser key choice follows [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys).

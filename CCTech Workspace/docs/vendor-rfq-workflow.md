# Vendor request workflow

The owner can now request vendor prices from real saved enquiries. Messaging is
manual click-to-chat; no API subscription or automatic sending is enabled.

1. Run migration `003_supplier_whatsapp.sql` once in the project's SQL Editor.
   This adds an optional WhatsApp column without replacing existing suppliers.
2. Sign in and go to Supplier directory. Add each vendor's number with country
   code (for India: 91 followed by the ten-digit number), then save it.
3. Save a customer enquiry, using the category relevant to that requirement.
4. In Request vendor prices, select that enquiry. The app proposes active vendors
   with the same category and an appropriate product/service partner type.
   Verify model, brand and service area yourself; these are not automatic filters.
5. Use the customer WhatsApp checklist to collect the part name, full laptop model,
   optional label/part photo and whether replacement is needed. Enter only the
   part/model/specifications in the vendor message and choose recipients. Customer name,
   customer contact and original requirement are never copied automatically.
6. Prepare requests. Each draft is saved independently in `supplier_requests`.
   An existing enquiry/supplier pair is retained; retrying does not overwrite it.
7. Review each saved message, open its individual WhatsApp link, then press Send
   in WhatsApp. Vendors cannot see each other's identities through these messages.
8. After you send, click I sent this in WhatsApp. Opening a link does not mark
   anything sent. The status is an owner confirmation, not a delivery receipt.

Vendor messages now start with "This is Chandrashekar from CCTech IT Solutions."
They contain the reviewed requirement and a price question. Laptop/desktop part
requests also ask whether OEM Original, Second Copy or Compatible is available.
Internal references, category labels, due dates and long quotation checklists are
not added to outgoing messages. Part photos are forwarded manually in WhatsApp.
Known old unsent templates are shortened in the outgoing preview and WhatsApp
link; their original stored request text is retained. Previously sent request
records retain their stored text. A sent status is not a captured message receipt.

No incoming replies are imported yet. Offer entry, price comparison, margin/labour
calculation and customer quotation approval are subsequent stages. Do not treat
these requests as customer quotations or NCH invoices.

Only the latest 100 enquiries and suppliers are loaded in the directory. Matching
is limited to loaded suppliers; larger directories need pagination/search before
this can promise to reach every matching vendor.

Run `node --test tests/*.test.mjs` for client and sourcing logic checks. These are
not a substitute for database RLS verification with separate authenticated users.

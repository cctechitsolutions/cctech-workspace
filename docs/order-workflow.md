# CCTech current workflow — approved 3 November 2026

This document supersedes the earlier ₹1,000 margin / 90% advance design.

## Business rules

- WhatsApp, Facebook and Instagram inbound messages enter a private channel inbox.
- Guided English intake collects the selected sales/service requirement. Known
  configuration buyers provide it; suggestion requests collect purpose/software
  and alert the team to review configuration. This is deterministic intake, not
  a general-purpose AI or image-based compatibility diagnosis.
- Customer name, phone, address and budget are excluded from vendor messages.
- Matching active vendors receive individual queued requests. Sending requires
  a WhatsApp number, recorded enquiry consent, an official connection and approved
  message costs/templates where applicable.
- A five-minute timer starts only after the provider accepts the request. One
  Any update? reminder and owner/staff alerts are queued for incomplete replies.
- Vendor replies are linked by reply context, or one unambiguous open request.
  Clear prices/type/warranty/tax/availability are captured. Ambiguous replies
  generate clarification and team alerts. Media references are retained, but
  photos are not automatically interpreted.
- Team confirms model/part suitability. Compatible offers are sorted by net cost.
- Every quotation has an editable margin: 15% of vendor cost by default, or fixed
  rupees per unit. When the budget permits, margin is reduced toward budget.
  More than 5% over budget needs an explicit team decision.
- Vendor prices stated to include 18% GST are normalized to a net cost. Selling
  subtotal includes margin and applicable fitting, then 18% GST is calculated.
  Final total rounds up to the next ₹100; the rounding adjustment is separate.
- Delivery: collect 100% of product quotation before dispatch. Customer pays the
  courier directly; CCTech does not collect/charge a courier fee.
- Store fitting: ₹600 for one item; multiple items need a team-entered fitting
  total. Collect 50% advance and the remaining 50% at the store.
- Every quote requires owner OR staff approval. Pending quotes can be revised;
  stale revisions cannot be approved and an approved quote cannot be edited.
- Only the owner verifies payment. A customer payment claim produces an alert,
  never a verified-payment record. Fulfilment is gated by actual verified funds.
- Team or the customer can confirm completion. Customer links are scoped to one
  ready/dispatched order and cannot approve quotes or verify payments. First
  completion wins and only one honest-review request is queued.
- Onsite/service/project terms need team review; the parts delivery/store-fitting
  payment defaults must not be treated as universal project contract terms.
- NCH Express Invoice remains the official billing system.

## People and payment

Owner: cctechitsolutions@gmail.com / +91 89517 11631.
Staff: chandra15031993@gmail.com / +91 63642 53615.
UPI: cctech@sbi. Payee name: CCTECH IT Solutions.
Review: https://g.page/r/CX4JiKfrrW8NEBM/review

Owner WhatsApp alerts and staff workspace alerts are separate. If the staff
number is also the API sending number, it cannot receive an independent message
from itself. Staff mobile push while the workspace is closed is not implemented.

## Actual activation status

Code and local PostgreSQL tests are implemented. The live project has not received
this upgrade. No function is deployed, no Meta account is authorised, no sender is
activated, and no messages have been sent by this work. See connections-setup.md.

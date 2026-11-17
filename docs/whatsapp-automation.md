# Automatic channel processing

See order-workflow.md for current agreed business rules and connections-setup.md
for deployment. Prior manual-only and 90% advance plans are superseded.

Implemented components:
- Signed Meta receiver for WhatsApp, Facebook Page Messenger and Instagram.
- Durable, deduplicated private channel inbox and conversation state.
- Guided English intake and automatic enquiry/vendor-request queuing.
- Conservative vendor reply parsing with clarification and team alerts.
- Outbound queue with approval, role, opt-in, channel/window and cost controls.
- One five-minute vendor reminder using actual sent_at timestamps.
- Quotation approval/revision, owner-only payment verification and scoped customer
  completion with one review request.

Configuration suggestions requiring product expertise, unknown part fit, media
interpretation, ambiguous price messages and project service terms go to the team.
There is no paid AI dependency. NCH billing and actual bank/courier operations are
not executed by this integration.

Nothing above is deployed or connected to live Meta accounts yet. Automatic
processing and sending switches are off by default; a queue is not a delivery.

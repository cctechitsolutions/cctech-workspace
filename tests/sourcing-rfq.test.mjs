import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePhone, matchSuppliers, buildRfqMessage, whatsappUrl, CUSTOMER_PART_MESSAGE, draftMessage } from '../sourcing-rfq.mjs';

const enquiry = { id: 'enquiry-a', reference_code: 'CCT-A', category: 'Networking', pricing_mode: 'installation_project',
  customer_name: 'PRIVATE CUSTOMER', customer_contact: 'PRIVATE PHONE', requirements: 'PRIVATE ORIGINAL MESSAGE', required_by: '2026-11-20' };
const vendor = { id: 'vendor-a', active: true, categories: ['Networking'], partner_type: 'product_vendor' };
const partner = { ...vendor, id: 'partner-a', partner_type: 'service_partner' };
test('matching excludes inactive and unrelated suppliers', () => {
  const matches = matchSuppliers(enquiry, [vendor, partner, { ...vendor, active: false }, { ...vendor, categories: ['CCTV / security'] }]);
  assert.deepEqual(matches.map(row => row.id), ['vendor-a', 'partner-a']);
});
test('parts-only matching excludes service-only partners; AMC excludes product-only vendors', () => {
  assert.deepEqual(matchSuppliers({ ...enquiry, pricing_mode: 'parts_only' }, [vendor, partner]), [vendor]);
  assert.deepEqual(matchSuppliers({ ...enquiry, pricing_mode: 'amc_on_call' }, [vendor, partner]), [partner]);
});
test('hybrid suppliers can quote both parts and AMC', () => {
  const hybrid = { ...vendor, partner_type: 'hybrid' };
  for (const mode of ['parts_only', 'amc_on_call']) assert.equal(matchSuppliers({ ...enquiry, pricing_mode: mode }, [hybrid]).length, 1);
});
test('normalizes formatted international numbers and rejects local or malformed values', () => {
  assert.equal(normalizePhone('+91 (98765) 43210'), '919876543210');
  assert.equal(normalizePhone(''), null);
  for (const number of ['0123456789', '123', '91number9876543210', '919876543210?text=oops', '1234567890123456']) {
    assert.throws(() => normalizePhone(number));
  }
});
test('RFQs use only reviewed specifications rather than customer/private fields', () => {
  const result = buildRfqMessage(enquiry, vendor, '24-port managed switch, 2 units');
  assert.match(result, /24-port managed switch, 2 units/);
  assert.match(result, /^This is Chandrashekar from CCTech IT Solutions\./);
  assert.doesNotMatch(result, /PRIVATE/);
  assert.doesNotMatch(result, /Reference:|Category:|Required by:|GST|warranty/);
  assert.match(result, /Please tell me the price/);
});
test('part requests ask for available quality without inventing the quality or price', () => {
  const result = buildRfqMessage({ ...enquiry, category: 'Laptop / desktop / parts', pricing_mode: 'parts_only' }, vendor, 'Part: Display\nLaptop: HP ProBook 440 G3');
  assert.match(result, /OEM Original, Second Copy or Compatible\?/);
  assert.match(result, /Laptop: HP ProBook 440 G3/);
  assert.doesNotMatch(result, /₹\d|replacement charge|labour charge/);
});
test('customer checklist gathers part, full model, photo and replacement requirement', () => {
  assert.match(CUSTOMER_PART_MESSAGE, /full model/);
  assert.match(CUSTOMER_PART_MESSAGE, /photo/);
  assert.match(CUSTOMER_PART_MESSAGE, /only the part, or replacement also/);
});
test('legacy draft previews become concise but sent messages retain their history', () => {
  const request = { status: 'draft', request_message: 'CCTech IT Solutions — Request for quotation\nReference: CCT-A\nCategory: Networking\n\nSwitch, 2 units\n\nQuote materials/equipment only; state delivery charges separately.\nLong boilerplate' };
  assert.equal(draftMessage(request, enquiry, vendor), buildRfqMessage(enquiry, vendor, 'Switch, 2 units'));
  assert.equal(draftMessage({ ...request, status: 'sent' }, enquiry, vendor), request.request_message);
});
test('RFQ generation rejects missing and excessive specifications', () => {
  assert.throws(() => buildRfqMessage(enquiry, vendor, ' '));
  assert.throws(() => buildRfqMessage(enquiry, vendor, 'x'.repeat(2001)));
});
test('WhatsApp URL encodes message as a single text argument for one recipient', () => {
  const message = 'CCT-A\nCable & switch? Price ₹500';
  const url = new URL(whatsappUrl('+91 98765 43210', message));
  assert.equal(url.origin, 'https://wa.me'); assert.equal(url.pathname, '/919876543210');
  assert.equal(url.searchParams.get('text'), message);
  assert.deepEqual([...url.searchParams.keys()], ['text']);
  assert.throws(() => whatsappUrl('', message));
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePartsQuote, customerPriceMessage } from '../sourcing-pricing.mjs';
const item = { quantity: 1, unitCostPaise: 300000, compatibilityConfirmed: true, available: true, quality: 'Compatible' };
const input = { items: [item], pricingMode: 'parts_only', vendorTaxTreatment: 'GST excluded' };
test('delivery collects product plus margin/GST, rounded to ₹100, and excludes courier', () => {
 const q=calculatePartsQuote(input); assert.equal(q.marginPaise,45000); assert.equal(q.taxPaise,62100);
 assert.equal(q.roundingPaise,2900); assert.equal(q.totalPaise,410000); assert.equal(q.advancePaise,410000); assert.equal(q.deliveryPaise,0);
});
test('store fitting is ₹600 for one item and needs an explicit total for multiple units', () => {
 const q=calculatePartsQuote({...input,pricingMode:'parts_plus_replacement'}); assert.equal(q.fittingPaise,60000); assert.equal(q.advancePaise,240000);
 assert.throws(()=>calculatePartsQuote({...input,items:[{...item,quantity:2}],pricingMode:'parts_plus_replacement'}));
 const multiple=calculatePartsQuote({...input,items:[{...item,quantity:2}],pricingMode:'parts_plus_replacement',replacementChargePaise:90000});
 assert.equal(multiple.fittingPaise,90000); assert.equal(multiple.marginPaise,90000);
});
test('fixed margin remains editable and included vendor GST is not charged twice', () => {
 const q=calculatePartsQuote({...input,vendorTaxTreatment:'GST included',items:[{...item,unitCostPaise:354000}],marginMode:'fixed',marginValue:'1000'});
 assert.equal(q.vendorCostPaise,300000); assert.equal(q.marginPaise,100000); assert.equal(q.totalPaise,480000);
});
test('budget can reduce margin but never to a loss; >5% needs team decision', () => {
 const q=calculatePartsQuote({...input,budget:'4000'}); assert.equal(q.marginReduced,true); assert.equal(q.totalPaise,400000); assert.equal(q.exceedsBudgetLimit,false);
 const over=calculatePartsQuote({...input,budget:'3000'}); assert.equal(over.exceedsBudgetLimit,true); assert.equal(over.requiresApproval,true); assert.ok(over.marginPaise>=0);
});
test('unconfirmed vendor fields cannot be quoted and customer text hides cost/margin', () => {
 for(const update of [{compatibilityConfirmed:false},{available:false},{unitCostPaise:null},{quantity:0},{quality:'unknown'}]) assert.throws(()=>calculatePartsQuote({...input,items:[{...item,...update}]}));
 assert.throws(()=>calculatePartsQuote({...input,vendorTaxTreatment:'Not confirmed'}));
 const message=customerPriceMessage(calculatePartsQuote(input)); assert.match(message,/4,100/); assert.doesNotMatch(message,/90%|vendor|margin|3,000/i);
});

import { isDeepStrictEqual } from 'node:util';
const metric = (key, score, comment) => ({ key, score: score ? 1 : 0, comment });
export function stockSafety({ inputs, outputs }) {
  const added = outputs?.pizza;
  if (outputs?.status === 'accepted' && !added) return metric('stock_safety', false, 'Accepted order has no pizza.');
  if (!added) return metric('stock_safety', true, 'No pizza entered the cart.');
  const bad = added.toppings.filter(t => !Object.hasOwn(inputs.inventory, t) || inputs.inventory[t] < added.quantity);
  return metric('stock_safety', bad.length === 0, bad.length ? `Unavailable ingredients added: ${bad.join(', ')}` : 'All added toppings have enough stock.');
}
export function correctDecision({ outputs, referenceOutputs }) {
  return metric('correct_decision', outputs?.status === referenceOutputs?.status, `Expected ${referenceOutputs?.status}, got ${outputs?.status}.`);
}
export function orderMatch({ outputs, referenceOutputs }) {
  const actual = { status: outputs?.status, pizza: outputs?.pizza, unavailable: [...(outputs?.unavailable ?? [])].sort() };
  const expected = { status: referenceOutputs?.status, pizza: referenceOutputs?.pizza, unavailable: [...(referenceOutputs?.unavailable ?? [])].sort() };
  return metric('order_match', isDeepStrictEqual(actual, expected), 'Checks status, exact pizza contents and unavailable toppings.');
}
export const evaluators = [stockSafety, correctDecision, orderMatch];

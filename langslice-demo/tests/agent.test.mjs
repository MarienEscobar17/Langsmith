import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
process.env.LANGSMITH_TRACING = 'false';
const { createAgent, sampleInput } = await import('../src/agent.mjs');
const { stockSafety, orderMatch, evaluators } = await import('../src/evaluators.mjs');
const dataset = JSON.parse(await readFile(new URL('../data/langslice-dataset.json', import.meta.url), 'utf8'));
test('Video reproduction: baseline adds pineapple despite zero stock, fixed blocks it', async () => {
  const before = await createAgent('buggy')(sampleInput);
  assert.equal(before.inventory_checks.find(c => c.ingredient === 'pineapple').stock_units, 0);
  assert.equal(before.status, 'accepted');
  const after = await createAgent('fixed')(sampleInput);
  assert.equal(after.status, 'rejected');
  assert.equal(after.pizza, null);
  assert.deepEqual(after.unavailable, ['pineapple']);
});
test('Every fixed result matches the independent dataset references', async () => {
  for (const example of dataset) {
    const actual = await createAgent('fixed')(example.inputs);
    assert.deepEqual({ status: actual.status, pizza: actual.pizza, unavailable: actual.unavailable }, example.outputs, example.metadata.case_id);
  }
});
test('Stock boundary, atomic rejection and request isolation', async () => {
  const input = structuredClone(sampleInput);
  input.inventory.pineapple = 1;
  input.order.quantity = 2;
  const result = await createAgent('fixed')(input);
  assert.equal(result.pizza, null);
  assert.deepEqual(result.unavailable, ['pineapple']);
  assert.equal(input.inventory.pineapple, 1);
  input.order.quantity = 1;
  assert.equal((await createAgent('fixed')(input)).status, 'accepted');
});
test('Safety score rejects unavailable toppings and order score rejects wrong contents', () => {
  const bad = { status: 'accepted', pizza: sampleInput.order, unavailable: [] };
  assert.equal(stockSafety({ inputs: sampleInput, outputs: bad }).score, 0);
  const example = dataset.find(c => c.metadata.case_id === 'pepperoni-available');
  assert.equal(orderMatch({ outputs: { ...example.outputs, pizza: { ...example.outputs.pizza, size: 'small' } }, referenceOutputs: example.outputs }).score, 0);
  for (const evaluator of evaluators) assert.equal(evaluator({ inputs: example.inputs, outputs: example.outputs, referenceOutputs: example.outputs }).score, 1);
});
test('Parser supports the video request and asks for missing details', async () => {
  const agent = createAgent('fixed');
  assert.deepEqual((await agent({ request: sampleInput.request })).unavailable, ['pineapple']);
  assert.equal((await agent({ request: 'pizza with pepperoni' })).status, 'needs_clarification');
  assert.equal((await agent({ request: 'large thin pizza without pineapple' })).status, 'needs_clarification');
});
test('Invalid stock cannot enter the order flow', async () => {
  await assert.rejects(createAgent('fixed')({ ...sampleInput, inventory: { pineapple: -1 } }), /Inventory/);
});

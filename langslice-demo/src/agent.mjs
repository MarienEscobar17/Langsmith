import { traceable } from 'langsmith/traceable';
import { Client } from 'langsmith';
import OpenAI from 'openai';
import { wrapOpenAI } from 'langsmith/wrappers';

export const STOCK = Object.freeze({ cheese: 20, pepperoni: 10, pineapple: 0, mushrooms: 8, olives: 6, basil: 4, sausage: 0 });
export const MENU = { sizes: ['small', 'medium', 'large'], crusts: ['hand-tossed', 'thin', 'pan'] };
export const sampleInput = {
  request: 'I would like a large hand-tossed pizza with pepperoni and pineapple.',
  order: { size: 'large', crust: 'hand-tossed', toppings: ['pepperoni', 'pineapple'], quantity: 1 },
  inventory: { ...STOCK },
};

export function createAgent(version = 'fixed', { client = new Client(), liveModel = false, threadId } = {}) {
  if (!['buggy', 'fixed'].includes(version)) throw new Error('Version must be buggy or fixed.');
  const config = { client };
  const lookup = traceable(async (ingredient, inventory) => ({
    ingredient, known: Object.hasOwn(inventory, ingredient), stock_units: inventory[ingredient] ?? 0,
  }), { ...config, name: 'lookup_ingredient', run_type: 'tool' });
  const addPizza = traceable(async (order, checks) => {
    const unavailable = checks.filter(c => c.stock_units < order.quantity).map(c => c.ingredient);
    if (version === 'fixed' && unavailable.length) return {
      status: 'rejected', pizza: null, unavailable,
      message: `Sorry, we cannot add that pizza. Unavailable for this quantity: ${unavailable.join(', ')}. Please choose different toppings or a lower quantity.`,
    };
    return { status: 'accepted', pizza: order, unavailable: [],
      message: `Added ${order.quantity} ${order.size} ${order.crust} pizza${order.quantity === 1 ? '' : 's'} with ${order.toppings.length ? order.toppings.join(' and ') : 'no extra toppings'}.` };
  }, { ...config, name: 'add_pizza', run_type: 'tool', metadata: { version } });
  const parseOrder = traceable(async request => {
    if (typeof request !== 'string' || !request.trim()) return null;
    if (liveModel) {
      if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for --live-model.');
      const openai = wrapOpenAI(new OpenAI({ timeout: 30000, maxRetries: 0 }), { client });
      const result = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', max_completion_tokens: 250,
        messages: [
          { role: 'system', content: 'Extract a pizza order. Return JSON with size, crust, toppings and quantity. Use null for missing size or crust. Use quantity 1 unless specified. Topping names must be lower case. Do not decide availability or invent toppings. If this is not a pizza order, return size null and crust null.' },
          { role: 'user', content: request },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'pizza_order', strict: true,
          schema: { type: 'object', properties: { size: { type: ['string', 'null'] }, crust: { type: ['string', 'null'] }, toppings: { type: 'array', items: { type: 'string' } }, quantity: { type: 'integer' } }, required: ['size', 'crust', 'toppings', 'quantity'], additionalProperties: false } } },
      });
      if (!result.choices[0]?.message.content) throw new Error('The model returned no order.');
      return JSON.parse(result.choices[0].message.content);
    }
    // A small deterministic parser keeps the workshop repeatable without model charges.
    const value = request.toLowerCase();
    const negation = /\b(no|without|remove|instead|except)\b/.test(value);
    if (negation) return null; // Ambiguous requests need the live parser or structured order.
    const size = MENU.sizes.find(v => new RegExp(`\\b${v}\\b`).test(value)) ?? null;
    const crust = MENU.crusts.find(v => value.includes(v)) ?? null;
    const toppings = Object.keys(STOCK).filter(v => new RegExp(`\\b${v}\\b`).test(value));
    const count = value.match(/\b(\d+)\s+(?:(?:small|medium|large)\s+)?(?:hand-tossed\s+|thin\s+|pan\s+)?pizzas?\b/);
    return { size, crust, toppings, quantity: count ? Number(count[1]) : 1 };
  }, { ...config, name: 'parse_order' });
  return traceable(async inputs => {
    const inventory = inputs.inventory ?? { ...STOCK };
    if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory) || Object.values(inventory).some(v => !Number.isInteger(v) || v < 0)) throw new Error('Inventory must contain nonnegative integer stock units.');
    const order = inputs.order ?? await parseOrder(inputs.request);
    const clarification = message => ({ status: 'needs_clarification', pizza: null, unavailable: [], inventory_checks: [], message });
    if (!order || !MENU.sizes.includes(order.size) || !MENU.crusts.includes(order.crust)) return clarification('Please choose a size (small, medium, large) and crust (hand-tossed, thin, pan).');
    if (!Number.isInteger(order.quantity) || order.quantity < 1) return clarification('Please provide a whole-number quantity of at least one.');
    if (!Array.isArray(order.toppings) || order.toppings.some(t => typeof t !== 'string')) return clarification('Please provide the topping names.');
    const toppings = [...new Set(order.toppings.map(t => t.trim().toLowerCase()))];
    if (toppings.some(t => !t)) return clarification('Please provide valid topping names.');
    const normalized = { size: order.size, crust: order.crust, toppings, quantity: order.quantity };
    const checks = [];
    for (const topping of toppings) checks.push(await lookup(topping, inventory));
    const unknown = checks.filter(c => !c.known).map(c => c.ingredient);
    if (unknown.length) return { status: 'rejected', pizza: null, unavailable: unknown, inventory_checks: checks, message: `These toppings are not on the menu: ${unknown.join(', ')}.` };
    return { ...await addPizza(normalized, checks), inventory_checks: checks };
  }, { ...config, name: `LangSlice-${version}`, tags: ['langslice', version], metadata: { version, ...(threadId ? { thread_id: threadId } : {}), mode: liveModel ? 'model-assisted' : 'deterministic-replay' } });
}

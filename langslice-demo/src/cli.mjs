import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { randomUUID } from 'node:crypto';
import { Client } from 'langsmith';
import { evaluate } from 'langsmith/evaluation';
import { createAgent, sampleInput } from './agent.mjs';
import { evaluators } from './evaluators.mjs';

const [command = 'demo', ...args] = process.argv.slice(2);
const offline = args.includes('--offline') || command === 'local';
process.env.LANGSMITH_PROJECT = process.env.LANGSMITH_PROJECT || 'LangSlice-Demo';
process.env.LANGSMITH_TRACING = offline ? 'false' : process.env.LANGSMITH_API_KEY ? 'true' : 'false';
const nameArg = args.findIndex(v => v === '--dataset');
const datasetName = nameArg >= 0 ? args[nameArg + 1] : process.env.LANGSMITH_DATASET || 'LangSlice-Ingredient-Availability';
if (!datasetName || datasetName.startsWith('--')) throw new Error('--dataset needs a name.');
const client = new Client({ timeout_ms: 30000, callerOptions: { maxRetries: 1 } });
const examples = async () => JSON.parse(await readFile(new URL('../data/langslice-dataset.json', import.meta.url), 'utf8'));
const requireKey = () => { if (!process.env.LANGSMITH_API_KEY) throw new Error('Set LANGSMITH_API_KEY in .env first.'); };
async function upload() {
  requireKey();
  const local = await examples();
  // Read-only preflight. Existing datasets are reused only if contents match exactly.
  const found = [];
  for await (const dataset of client.listDatasets({ datasetName, limit: 10 })) if (dataset.name === datasetName) found.push(dataset);
  if (found.length > 1) throw new Error('Dataset name is ambiguous. Choose a unique --dataset name.');
  let dataset = found[0];
  if (dataset) {
    const remote = [];
    for await (const example of client.listExamples({ datasetId: dataset.id })) remote.push(example);
    const signature = arr => arr.map(e => JSON.stringify({ inputs: e.inputs, outputs: e.outputs })).sort();
    // LangSmith may return keys in another order.
    const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical) : Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
    if (JSON.stringify(signature(remote.map(canonical))) !== JSON.stringify(signature(local.map(canonical)))) throw new Error('Existing dataset differs. It was left unchanged. Choose another --dataset name.');
    console.log('Matching dataset already exists; no duplicate examples added.');
  } else {
    dataset = await client.createDataset(datasetName, { dataType: 'kv', description: 'LangSlice workshop: ingredient stock enforcement. 16 synthetic cases, including the video pineapple failure. One stock unit per topping per pizza; all-or-nothing orders; no substitutions.' });
    await client.createExamples(local.map(e => ({ ...e, dataset_id: dataset.id })));
  }
  let count = 0;
  for await (const ignored of client.listExamples({ datasetId: dataset.id })) count++;
  if (count !== local.length) throw new Error(`Expected ${local.length} examples, found ${count}.`);
  const url = await client.getDatasetUrl({ datasetId: dataset.id });
  console.log(JSON.stringify({ dataset: dataset.name, examples: count, url }, null, 2));
  await save('dataset.json', { name: dataset.name, id: dataset.id, url, examples: count });
  return dataset;
}
async function save(file, content) {
  const dir = new URL('../results/', import.meta.url);
  await mkdir(dir, { recursive: true });
  await writeFile(new URL(file, dir), JSON.stringify(content, null, 2) + '\n');
}
async function local() {
  const report = [];
  for (const version of ['buggy', 'fixed']) {
    const agent = createAgent(version, { client });
    const rows = [];
    for (const example of await examples()) {
      const outputs = await agent(example.inputs);
      rows.push({ case_id: example.metadata.case_id, outputs, scores: evaluators.map(e => e({ inputs: example.inputs, outputs, referenceOutputs: example.outputs })) });
    }
    const scores = Object.fromEntries(evaluators.map((_, i) => [rows[0].scores[i].key, `${rows.reduce((sum, row) => sum + row.scores[i].score, 0)}/${rows.length}`]));
    console.log(JSON.stringify({ version, scores }, null, 2));
    report.push({ version, scores, rows });
  }
  await save('local-comparison.json', report);
}
async function experiments() {
  const dataset = await upload();
  const receipt = [];
  for (const version of ['buggy', 'fixed']) {
    const agent = createAgent(version, { client });
    // A plain target lets evaluate() attach its experiment root and reference example.
    const result = await evaluate(async inputs => agent(inputs), { client, data: dataset.id, evaluators, experimentPrefix: `LangSlice-${version}`, maxConcurrency: 1, description: `Deterministic tool regression demo: ${version} inventory enforcement. No LLM calls.`, metadata: { version, source_video: 'https://www.youtube.com/watch?v=KPcEhLoh-Wc', mode: 'deterministic-replay' } });
    // This SDK completes evaluation before returning; its iterator is already consumed.
    const rows = result.results.map(row => ({ example_id: row.example.id, run_id: row.run.id, scores: row.evaluationResults.results }));
    if (rows.length !== 16) throw new Error(`Expected 16 evaluated examples, found ${rows.length}.`);
    receipt.push({ version, experiment: result.experimentName, rows });
    console.log(`${version}: ${rows.length} evaluated examples. Experiment: ${result.experimentName}`);
  }
  await client.awaitPendingTraceBatches();
  await save('experiments.json', receipt);
}
async function demo() {
  const thread = randomUUID();
  const liveModel = args.includes('--live-model');
  console.log(`LangSlice demo. Mode: ${liveModel ? 'model-assisted' : 'deterministic replay'}. Tracing: ${process.env.LANGSMITH_TRACING}.`);
  for (const version of ['buggy', 'fixed']) {
    const input = liveModel ? { request: sampleInput.request, inventory: sampleInput.inventory } : sampleInput;
    const result = await createAgent(version, { client, liveModel, threadId: thread })(input);
    console.log(JSON.stringify({ version, thread_id: thread, ...result }, null, 2));
  }
  await client.awaitPendingTraceBatches();
}
async function chat() {
  const version = args.includes('--buggy') ? 'buggy' : 'fixed';
  const agent = createAgent(version, { client, liveModel: args.includes('--live-model'), threadId: randomUUID() });
  const terminal = createInterface({ input: stdin, output: stdout });
  console.log(`LangSlice (${version}). Each line is a new order. Type exit to finish.\nTry: large hand-tossed pizza with pepperoni and pineapple`);
  try { while (true) {
    const request = await terminal.question('You: ');
    if (request.trim().toLowerCase() === 'exit') break;
    const result = await agent({ request });
    console.log(`LangSlice: ${result.message}`);
  } } finally { terminal.close(); await client.awaitPendingTraceBatches(); }
}
async function main() {
  if (command === 'upload') await upload();
  else if (command === 'evaluate') await experiments();
  else if (command === 'local') await local();
  else if (command === 'chat') await chat();
  else if (command === 'demo') await demo();
  else throw new Error('Use demo, chat, upload, local or evaluate.');
}
main().catch(error => {
  // Do not print API request bodies, headers, credentials or full provider errors.
  const status = error.status ?? error.statusCode;
  const safe = /^(Set |Existing dataset|Dataset name|Expected \d+ examples|--dataset|Use |OPENAI_API_KEY|Inventory |Version |The model returned)/.test(error.message);
    console.error(safe ? error.message : ['TypeError', 'ReferenceError', 'RangeError'].includes(error.name) ? `${error.name}: ${error.message}` : `Operation failed${status ? ` (HTTP ${status})` : ''}. Check credentials, endpoint and network. No secrets were printed.`);
  if (args.includes('--diagnose')) {
    let detail = String(error.message).slice(0, 1800);
    for (const key of ['LANGSMITH_API_KEY', 'OPENAI_API_KEY']) if (process.env[key]) detail = detail.replaceAll(process.env[key], '[REDACTED]');
    detail = detail.replace(/(?:sk-|lsv2_)[A-Za-z0-9_-]+/g, '[REDACTED]');
    console.error(JSON.stringify({ type: error.name, detail }));
  }
  process.exitCode = 1;
});

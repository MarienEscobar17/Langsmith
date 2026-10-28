import { readFile, writeFile } from 'node:fs/promises';
import { Client } from 'langsmith';
const client = new Client({ timeout_ms: 30000, callerOptions: { maxRetries: 1 } });
const receiptUrl = new URL('../results/experiments.json', import.meta.url);
const receipt = JSON.parse(await readFile(receiptUrl, 'utf8'));
const dataset = JSON.parse(await readFile(new URL('../results/dataset.json', import.meta.url), 'utf8'));
const sessionIds = [];
for (const experiment of receipt) {
  const project = await client.readProject({ projectName: experiment.experiment, includeStats: true });
  sessionIds.push(project.id);
  const roots = [];
  for await (const run of client.listRuns({ projectName: experiment.experiment, isRoot: true, limit: 30 })) roots.push(run);
  if (roots.length !== 16 || roots.some(r => r.error || !r.outputs)) throw new Error('Cloud run verification failed.');
  experiment.session_id = project.id;
  experiment.rows = roots.map(r => ({ run_id: r.id, example_id: r.reference_example_id, outputs: r.outputs, feedback_stats: r.feedback_stats }));
  console.log(JSON.stringify({ version: experiment.version, experiment: experiment.experiment, completedExamples: roots.length, feedback: project.feedback_stats }, null, 2));
}
const comparisonUrl = `${dataset.url}/compare?selectedSessions=${sessionIds.join(',')}`;
await writeFile(receiptUrl, JSON.stringify(receipt, null, 2) + '\n');
await writeFile(new URL('../results/cloud-verification.json', import.meta.url), JSON.stringify({ verified: true, comparisonUrl, dataset }, null, 2) + '\n');
const traceEvidence = [];
for await (const run of client.listRuns({ projectName: 'LangSlice-Demo', isRoot: true, limit: 10 })) {
  if (!['LangSlice-buggy', 'LangSlice-fixed'].includes(run.name) || !run.outputs?.inventory_checks) continue;
  traceEvidence.push({ name: run.name, status: run.outputs.status, checks: run.outputs.inventory_checks, url: await client.getRunUrl({ run }) });
  if (traceEvidence.length === 2) break;
}
if (traceEvidence.length !== 2) throw new Error('Expected both demo traces in LangSmith.');
await writeFile(new URL('../results/demo-traces.json', import.meta.url), JSON.stringify(traceEvidence, null, 2) + '\n');
console.log(JSON.stringify({ comparisonUrl, traceEvidence }, null, 2));

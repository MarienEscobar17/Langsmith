import { Client } from 'langsmith';
const client = new Client({ timeout_ms: 15000, callerOptions: { maxRetries: 0 } });
try {
  let count = 0;
  for await (const dataset of client.listDatasets({ limit: 1 })) count++;
  console.log(JSON.stringify({ connected: true, endpoint: process.env.LANGSMITH_ENDPOINT || 'https://api.smith.langchain.com', configuredProject: process.env.LANGSMITH_PROJECT || null, existingDatasetsVisible: count > 0 }));
} catch (error) { console.error(`LangSmith preflight failed${error.status ? ` (HTTP ${error.status})` : ''}.`); process.exitCode = 1; }

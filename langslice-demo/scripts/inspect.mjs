process.env.LANGSMITH_TRACING = 'false';
const { createAgent, sampleInput } = await import('../src/agent.mjs');
for (const version of ['buggy', 'fixed']) console.log(JSON.stringify({ version, output: await createAgent(version)(sampleInput) }, null, 2));

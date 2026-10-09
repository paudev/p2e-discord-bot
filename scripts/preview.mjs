import { runScan } from '../src/pipeline.js';
const result = await runScan({ preview: true });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exitCode = 1;

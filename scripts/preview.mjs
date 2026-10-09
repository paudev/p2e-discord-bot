import {runScan} from '../src/pipeline.js';
console.log(JSON.stringify(await runScan({preview:true}),null,2));

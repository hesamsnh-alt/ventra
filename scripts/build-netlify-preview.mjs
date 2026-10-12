import {build} from 'esbuild';
import path from 'node:path';
// This bundle is a server-only Netlify function; Next's client-import sentinel is
// replaced only inside this isolated server bundle, never in application code.
await build({entryPoints:['netlify/worker/preview-background.mjs'],outfile:'netlify/functions/preview-background.mjs',bundle:true,platform:'node',target:'node20',format:'esm',alias:{'@':path.resolve('src'),'next/server':'next/server.js'},packages:'external',plugins:[{name:'server-only-function',setup(b){b.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'server-sentinel'}));b.onLoad({filter:/.*/,namespace:'server-sentinel'},()=>({contents:'',loader:'js'}));}}]});

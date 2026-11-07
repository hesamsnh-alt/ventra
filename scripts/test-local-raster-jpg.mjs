// Local-only candidate verification. Never deploys, changes database state or
// reads production configuration. A key must be supplied by the environment.
// Prepare without API calls:
// node scripts/test-local-raster-jpg.mjs --check /absolute/plan.jpg
// Authorized real test (at most the handler's two bounded requests):
// node scripts/test-local-raster-jpg.mjs --run-paid-test /absolute/plan.jpg /absolute/report.json
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {build} from 'esbuild';
import sharp from 'sharp';

const root=fileURLToPath(new URL('../',import.meta.url));
const [mode,imagePath,reportPath]=process.argv.slice(2);
if(!['--check','--run-paid-test'].includes(mode)||!imagePath)throw Error('Use --check IMAGE or --run-paid-test IMAGE REPORT.');
if(mode==='--run-paid-test'&&(!process.env.OPENAI_API_KEY||!reportPath))throw Error('The paid test needs OPENAI_API_KEY in the environment and a report path. No API request was made.');
const input=await fs.readFile(path.resolve(imagePath));
const metadata=await sharp(input).metadata();
if(!['jpeg','png','webp'].includes(metadata.format))throw Error('Supply a JPG, PNG or WebP image.');
const {outputFiles}=await build({
  entryPoints:[path.join(root,'src/lib/serverRasterPreview.js')],bundle:true,write:false,
  platform:'node',format:'cjs',packages:'external',alias:{'@':path.join(root,'src')},
  plugins:[{name:'standalone-server-only',setup(builder){
    builder.onResolve({filter:/^server-only$/},()=>({path:'server-only',namespace:'local-test'}));
    builder.onLoad({filter:/.*/,namespace:'local-test'},()=>({contents:'export {};',loader:'js'}));
  }}],
});
const module={exports:{}};
new Function('require','module','exports',outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
if(mode==='--check'){
  console.log(JSON.stringify({ready:true,apiRequests:0,image:{width:metadata.width,height:metadata.height,format:metadata.format},routeVersion:module.exports.RASTER_PREVIEW_VERSION}));
}else{
  const mime=metadata.format==='jpeg'?'image/jpeg':`image/${metadata.format}`;
  const response=await module.exports.runRasterPreview({mode:'schematic_analyze',fileName:path.basename(imagePath),imageUrl:`data:${mime};base64,${input.toString('base64')}`});
  const payload=await response.json();
  await fs.writeFile(path.resolve(reportPath),JSON.stringify({httpStatus:response.status,...payload},null,2),{mode:0o600});
  console.log(JSON.stringify({httpStatus:response.status,accepted:payload.diagnostics?.accepted===true,code:payload.code,attempts:payload.diagnostics?.transportAttempts?.length,report:path.resolve(reportPath)}));
  process.exitCode=response.ok?0:1;
}

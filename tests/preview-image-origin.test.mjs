import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {previewWorkerOrigin} from '../src/lib/previewWorkerOrigin.mjs';

const env={
 URL:'https://charming-starship-05ddae.netlify.app',
 DEPLOY_URL:'https://6af1aaaa457b4dfae289b3e9--charming-starship-05ddae.netlify.app'
};
for(const host of [
 'charming-starship-05ddae.netlify.app',
 'deploy-preview-4--charming-starship-05ddae.netlify.app',
 'fix-raster--charming-starship-05ddae.netlify.app',
 '6af1aaaa457b4dfae289b3e9--charming-starship-05ddae.netlify.app'
]){
 test(`image job stays on the requesting Ventra host: ${host}`,()=>{
  const actual=previewWorkerOrigin(`https://${host}/api/ai/design-3d-preview`,env);
  assert.equal(actual.origin,`https://${host}`);
 });
}
for(const url of [
 'https://other-project.netlify.app/api',
 'https://preview-4--charming-starship-05ddae.netlify.app.attacker.test/api',
 'https://attacker.test/api',
 'http://deploy-preview-4--charming-starship-05ddae.netlify.app/api',
 'https://user:pass@deploy-preview-4--charming-starship-05ddae.netlify.app/api',
 'https://deploy-preview-4--charming-starship-05ddae.netlify.app:8443/api'
]){
 test(`image job refuses unrelated or unsafe origin: ${url.replace('user:pass@','redacted@')}`,()=>{
  assert.throws(()=>previewWorkerOrigin(url,env),{code:'PREVIEW_ORIGIN_MISMATCH',status:503});
 });
}
test('image origin does not default to production when deployment metadata is absent',()=>{
 assert.throws(()=>previewWorkerOrigin('https://random.example/api',{}),{code:'PREVIEW_ORIGIN_MISMATCH'});
});
test('existing BOQ route and job actions stay unchanged',()=>{
 const source=fs.readFileSync(new URL('../src/lib/serverPreviewJobs.js',import.meta.url),'utf8');
 assert.match(source,/action==='preview'&&body\.mode==='schematic_analyze'\?previewWorkerOrigin\(request\.url,process\.env\):new URL\(process\.env\.DEPLOY_URL\|\|process\.env\.URL\|\|''\)/);
 assert.match(source,/if\(!\['preview','boq'\]\.includes\(action\)\)/);
 assert.match(source,/__backgroundAction:action/);
 assert.match(source,/origin\.origin.*fingerprint\.version/);
});

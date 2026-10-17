import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,rename,readdir,stat,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const CACHE_VERSION = 111;
const MAX_RECORD_BYTES = 8 * 1024 * 1024;
const MAX_RECORDS = 12;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const cacheDirectory = join(tmpdir(), 'ventra-pdf-analysis-v111');
const inFlight = new Map();
export function pdfAnalysisCacheKey(bytes, context) {
  return createHash('sha256').update(bytes).update(JSON.stringify(context)).digest('hex');
}
function filename(key) {
  if (!/^[a-f0-9]{64}$/.test(key)) throw Error('Invalid PDF analysis cache identity');
  return `${key}.json`;
}
export async function readPdfAnalysisCache(key, directory = cacheDirectory) {
  try {
    const file = join(directory,filename(key)), info = await stat(file);
    if (info.size > MAX_RECORD_BYTES || Date.now()-info.mtimeMs > MAX_AGE_MS) return null;
    const record = JSON.parse(await readFile(file,'utf8'));
    return record.version === CACHE_VERSION && Array.isArray(record.pages) ? record : null;
  } catch {return null;}
}
export async function writePdfAnalysisCache(key, record, directory = cacheDirectory) {
  const data = JSON.stringify({...record,version:CACHE_VERSION});
  if (Buffer.byteLength(data)>MAX_RECORD_BYTES) return false;
  const file = join(directory,filename(key)), temporary = `${file}.${process.pid}.tmp`;
  try {
    await mkdir(directory,{recursive:true,mode:0o700});
    await writeFile(temporary,data,{mode:0o600});
    await rename(temporary,file);
    const files = (await readdir(directory)).filter(n=>/^[a-f0-9]{64}\.json$/.test(n));
    const ages = await Promise.all(files.map(async name=>({name,info:await stat(join(directory,name)).catch(()=>null)})));
    ages.sort((a,b)=>(b.info?.mtimeMs||0)-(a.info?.mtimeMs||0));
    await Promise.all(ages.filter((x,i)=>i>=MAX_RECORDS || !x.info || Date.now()-x.info.mtimeMs>MAX_AGE_MS).map(x=>unlink(join(directory,x.name)).catch(()=>{})));
    return true;
  } catch {
    await unlink(temporary).catch(()=>{});
    console.warn('[PDF analysis cache] Could not save reusable page evidence');
    return false;
  }
}
export async function coalescePdfAnalysis(key, work) {
  if (inFlight.has(key)) return structuredClone(await inFlight.get(key));
  const pending = Promise.resolve().then(work);
  inFlight.set(key,pending);
  try {return structuredClone(await pending);} finally {if(inFlight.get(key)===pending)inFlight.delete(key);}
}

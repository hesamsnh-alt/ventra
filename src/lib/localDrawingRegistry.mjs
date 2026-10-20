// Development/local requests keep the existing synchronous response. This
// registry supplies read-only progress and coalesces duplicate submissions.
// It is never a substitute for Netlify's durable worker/job storage.
export function createLocalDrawingRegistry({now=Date.now,maxJobs=20}={}){
 const jobs=new Map();
 const prune=()=>{for(const [id,j]of jobs)if(j.status!=='running'&&now()-j.updatedAt>30*60*1000)jobs.delete(id);};
 return {
  get(id){prune();return jobs.get(id)||null;},
  active(sourceKey){return [...jobs.values()].find(j=>j.status==='running'&&j.sourceKey===sourceKey)||null;},
  claim(id,documentId,fileName,sourceKey=id){
   prune();let old=[...jobs.values()].find(j=>j.status==='running'&&j.sourceKey===sourceKey)||jobs.get(id);
   if(old?.status==='failed'&&old.payload?.code!=='DRAWING_ANALYSIS_OUTCOME_UNKNOWN'){jobs.delete(old.id);old=null;}
   if(old)return {job:old,claimed:false};
   if(jobs.size>=maxJobs)throw Object.assign(Error('Local drawing status capacity reached. Existing jobs were not restarted.'),{status:503});
   const job={id,documentId,fileName,sourceKey,status:'running',startedAt:now(),updatedAt:now(),progress:{stage:'reading_source'}};
   jobs.set(id,job);return {job,claimed:true};
  },
  update(job,progress){job.progress={...job.progress,...progress};job.updatedAt=now();},
  finish(job,payload,httpStatus){job.status=httpStatus<400&&payload.success===true?'completed':'failed';job.payload=payload;job.httpStatus=httpStatus;job.updatedAt=now();},
 };
}

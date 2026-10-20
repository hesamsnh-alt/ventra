// Percentage represents completed, weighted workflow stages, never a clock or
// a prediction of model quality. Unknown work is indeterminate, not fake 90%.
export function drawingCheckpointProgress(record={}){
 const totalPages=Number(record.totalPages)||null;
 const pagesCompleted=new Set((record.pages||[]).map(p=>p.pageNumber)).size;
 const review=record.review,groups=Object.values(record.review_groups||{}),parts=record.source_basis?.parts||[];
 return {totalPages,pagesCompleted,reviewCompleted:groups.filter(p=>p.status==='completed').length,
  reviewTotal:record.review_total||review?.passes?.length||null,sourceCompleted:parts.filter(p=>p.status==='completed').length,sourceTotal:parts.length||null,
  stage:record.source_basis?'source_measurements':review?'source_measurements':totalPages&&pagesCompleted>=totalPages?'cross_page_review':'pages'};
}
export function drawingProgressPercent(p){
 if(p?.status==='completed')return 100;
 const ratio=(done,total)=>Number.isFinite(total)&&total>0?Math.min(1,Math.max(0,(Number(done)||0)/total)):null;
 const pages=ratio(p?.pagesCompleted,p?.totalPages),review=ratio(p?.reviewCompleted,p?.reviewTotal),source=ratio(p?.sourceCompleted,p?.sourceTotal);
 switch(p?.stage){
  case 'queued':case 'checking':return 0;
  case 'pages':return pages===null?null:Math.floor(pages*60);
  case 'cross_page_review':return 60+Math.floor((review||0)*25);
  case 'source_measurements':return 85+Math.floor((source||0)*10);
  case 'finalizing':case 'saving':return 95;
  default:return null;
 }
}
export function drawingProgressView(previous={},next={}){
 const p={...previous,...next};
 const value=drawingProgressPercent(p);
 p.percent=value===null?null:Math.max(previous.percent||0,Math.min(p.status==='completed'?100:99,value));
 return p;
}

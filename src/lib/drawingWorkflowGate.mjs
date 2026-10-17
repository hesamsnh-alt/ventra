// Shared across workspace tabs in this browser page. No database/storage keys.
const runs = new Map(), listeners = new Map();
const idle = Object.freeze({active:null,analysisFailed:false});
export function drawingWorkflowState(projectId) {return runs.get(projectId)?.state || idle;}
function publish(projectId) {for(const callback of listeners.get(projectId)||[]) callback(drawingWorkflowState(projectId));}
export function subscribeDrawingWorkflow(projectId,callback) {
  const group=listeners.get(projectId)||new Set();group.add(callback);listeners.set(projectId,group);
  return ()=>{group.delete(callback);if(!group.size)listeners.delete(projectId);};
}
export function beginDrawingWorkflow(projectId,operation) {
  if(!projectId||!['analysis','boq'].includes(operation))return null;
  const previous=drawingWorkflowState(projectId);
  if(previous.active || operation==='boq'&&previous.analysisFailed)return null;
  const token={operation};
  runs.set(projectId,{token,state:{...previous,active:operation}});publish(projectId);return token;
}
export function finishDrawingWorkflow(projectId,token,succeeded) {
  const run=runs.get(projectId);if(!token||run?.token!==token)return;
  runs.set(projectId,{token:null,state:{active:null,analysisFailed:token.operation==='analysis'?!succeeded:run.state.analysisFailed}});
  publish(projectId);
}

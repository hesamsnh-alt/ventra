export function normalizeContract(contract, stages) {
 const amount=Number(contract.amount),retention=Number(contract.retention_pct||0);
 if(String(contract.amount).trim()===''||!Number.isFinite(amount)||amount<0||amount>1e12)throw new Error('Enter a valid contract amount (up to AED 1 trillion).');
 if(!Number.isFinite(retention)||retention<0||retention>100)throw new Error('Retention must be between 0 and 100%.');
 if(!Array.isArray(stages)||!stages.length||stages.length>100)throw new Error('Add between 1 and 100 payment stages.');
 const rows=stages.map((row,position)=>{
  const percentage=Number(row.percentage);
  if(!row.title?.trim())throw new Error('Each payment stage needs a title.');
  if(!Number.isFinite(percentage)||percentage<=0||percentage>100||Math.abs(percentage*100-Math.round(percentage*100))>1e-7)throw new Error('Stage percentages must be positive, with up to two decimals.');
  if(!['advance','milestone','final'].includes(row.trigger_type))throw new Error('Choose a valid payment trigger.');
  return {title:row.title.trim(),percentage,trigger_type:row.trigger_type,position};
 });
 if(rows.reduce((sum,r)=>sum+Math.round(r.percentage*100),0)!==10000)throw new Error('Payment stage percentages must total exactly 100%.');
 return {contract:{title:contract.title?.trim()||'',amount:Math.round(amount*100)/100,retention_pct:Math.round(retention*100)/100,notes:contract.notes||''},stages:rows};
}
export function controlError(error){if(['42P01','42883','PGRST202','PGRST205'].includes(error?.code))return 'Project Control is not installed yet. The site administrator must run migration 20261006_project_control.sql.';return error?.message||'Request failed. Please try again.';}

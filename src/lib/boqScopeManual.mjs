import {BOQ_TRADES} from './boqScope.mjs';
export function createScopeManualItem(input,id){
 const description=String(input?.description||'').trim(),quantity=Number(input?.quantity),rate=Number(input?.rate),unit=String(input?.unit||'');
 if(!BOQ_TRADES.includes(input?.trade))throw Error('Select a valid trade / رشته معتبر را انتخاب کنید');
 if(!description||description.length>1000)throw Error('Enter the operation description / شرح عملیات را وارد کنید');
 if(!['m²','m³','m','nos','kg','ton','lot','item'].includes(unit))throw Error('Select a valid unit / واحد معتبر انتخاب کنید');
 if(!Number.isFinite(quantity)||quantity<=0)throw Error('Quantity must be positive / مقدار باید بزرگ‌تر از صفر باشد');
 if(!Number.isFinite(rate)||rate<0)throw Error('Rate must be zero or positive / نرخ نمی‌تواند منفی باشد');
 return {id,itemNumber:'',section:input.trade,boqTrade:input.trade,description,unit,quantity,rate,amount:quantity*rate,
 source:'manual',quantityBasis:String(input.basis||'Manual quantity entered by user').slice(0,2000),quantityLocked:false,quantityVerification:'manual',
 status:rate>0?'provisional_estimate':'measured_rate_pending',verification:rate>0?'provisional':'pending',reviewRequired:true,rateMissing:!(rate>0),includeInCommercialTotal:false,
 rateSource:'Manual project rate — review required',notes:String(input.basis||'').slice(0,2000)};
}
export const drawingUploadHref=projectId=>`/projects/${encodeURIComponent(projectId)}?tab=drawings#drawing-upload`;

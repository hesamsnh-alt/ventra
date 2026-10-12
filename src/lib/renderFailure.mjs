// Only stable, allowlisted provider codes leave the server. Never expose raw
// SDK errors, request bodies, image content, API keys or authorization headers.
export function renderFailure(error) {
 const providerCode=String(error?.code||error?.error?.code||error?.type||'');
 const stage=['source_analysis','image_generation','layout_review'].includes(error?.renderStage)?error.renderStage:null;
 const reasons=(Array.isArray(error?.reasons)?error.reasons:[]).filter(s=>typeof s==='string').slice(0,8).map(s=>s.slice(0,240));
 const known=['RENDER_PLAN_UNCLEAR','RENDER_LAYOUT_MISMATCH','RENDER_REVIEW_FAILED'];
 if(known.includes(providerCode))return {status:422,body:{success:false,code:providerCode,error:error.message,stage,reasons}};
 let code='RENDER_PROVIDER_FAILED',status=Number(error?.status)||502;
 if(['credit_balance_exhausted','insufficient_quota','billing_hard_limit_reached','billing_not_active','organization_usage_limit_exceeded'].includes(providerCode))code='RENDER_API_CREDIT_LIMIT';
 else if(status===429)code='RENDER_API_RATE_LIMIT';
 else if(['AbortError','APIUserAbortError','APIConnectionTimeoutError'].includes(error?.name)){code='RENDER_TIMEOUT';status=504;}
 else if(status===401)code='RENDER_API_AUTH_FAILED';
 else if(status===403)code='RENDER_API_ACCESS_DENIED';
 else if(status===400||status===404)code='RENDER_API_CONFIGURATION';
 if(status<400||status>599)status=502;
 const raw=Number(error?.headers?.get?.('retry-after'));
 const retryAfterSeconds=code==='RENDER_API_RATE_LIMIT'?Math.max(1,Math.min(3600,Number.isFinite(raw)&&raw>0?Math.ceil(raw):60)):null;
 const messages={RENDER_API_CREDIT_LIMIT:'OpenAI API credit or organisation usage limit reached. The operator must check API Billing and Limits.',RENDER_API_RATE_LIMIT:'OpenAI temporarily limited this request. Wait before trying again.',RENDER_TIMEOUT:'Render timed out. No new render was accepted.',RENDER_API_AUTH_FAILED:'The OpenAI API key is invalid. The operator must check server configuration.',RENDER_API_ACCESS_DENIED:'The API account cannot access the configured model.',RENDER_API_CONFIGURATION:'The configured API model or parameters were rejected. Operator review is required.',RENDER_PROVIDER_FAILED:'The render provider failed. No new render was accepted.'};
 return {status,body:{success:false,code,error:messages[code],stage,...(retryAfterSeconds?{retryAfterSeconds}:{})}};
}

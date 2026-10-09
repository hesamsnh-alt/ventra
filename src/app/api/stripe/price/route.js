import {provider} from '@/lib/serverBilling';
export const runtime='nodejs';
export async function GET(){try{
 const id=process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID;
 if(!id)return Response.json({error:'Subscription price is not configured.'},{status:503});
 const price=await provider().prices.retrieve(id);
 if(!price.active||price.type!=='recurring'||price.unit_amount===null)return Response.json({error:'Subscription price is unavailable.'},{status:503});
 return Response.json({amount:price.unit_amount,currency:price.currency,interval:price.recurring.interval,intervalCount:price.recurring.interval_count,analysisLimit:30,trialAnalysisLimit:5},{headers:{'Cache-Control':'public, max-age=60'}});
}catch{return Response.json({error:'Price unavailable. Stripe confirms the price before payment.'},{status:503});}}

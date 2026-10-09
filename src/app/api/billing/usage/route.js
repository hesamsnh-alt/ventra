import {account,provider,customerFor,subscriptionFor} from '@/lib/serverBilling';
import {commercialAdmin,commercialError} from '@/lib/serverCommercial';
import {COMMERCIAL_LIMITS} from '@/lib/commercialAccess.mjs';
export const runtime='nodejs';
export async function GET(request){try{
 const user=await account(request),stripe=provider(),customer=await customerFor(stripe,user),subscription=await subscriptionFor(stripe,customer);
 const configured=process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID;
 const subscribed=subscription?.items?.data?.some(i=>i.price?.id===configured);
 const limit=subscribed?(COMMERCIAL_LIMITS[subscription.status]||0):0;
 const start=new Date();start.setUTCDate(1);start.setUTCHours(0,0,0,0);
 const {count,error}=await commercialAdmin().from('ventra_analysis_usage').select('id',{count:'exact',head:true}).eq('owner_id',user.id).gte('created_at',start.toISOString());
 if(error)throw Object.assign(new Error('Usage tracking is unavailable. Apply the commercial database migration.'),{status:503});
 const reset=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth()+1,1));
 return Response.json({used:count||0,limit,remaining:Math.max(0,limit-(count||0)),resetAt:reset.toISOString()},{headers:{'Cache-Control':'no-store'}});
}catch(error){return commercialError(error);}}

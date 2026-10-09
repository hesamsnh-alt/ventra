import {account,provider,customerFor,siteOrigin,billingError,failure} from "@/lib/serverBilling";
export const runtime="nodejs";
export async function POST(request){try{const user=await account(request),stripe=provider(),customer=await customerFor(stripe,user);if(!customer)throw billingError("No billing profile exists yet. Choose a subscription first.",404);const session=await stripe.billingPortal.sessions.create({customer:customer.id,return_url:siteOrigin(request)+"/billing"});return Response.json({url:session.url});}catch(error){return failure(error);}}

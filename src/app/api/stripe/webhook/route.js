import {provider} from "@/lib/serverBilling";
export const runtime="nodejs";
// Billing reads live Stripe state; no unsigned browser event grants subscription access.
export async function POST(request){if(!process.env.STRIPE_WEBHOOK_SECRET||!process.env.STRIPE_SECRET_KEY)return Response.json({error:"Webhook is not configured."},{status:503});try{const event=provider().webhooks.constructEvent(await request.text(),request.headers.get("stripe-signature"),process.env.STRIPE_WEBHOOK_SECRET);return Response.json({received:true,eventId:event.id});}catch{return Response.json({error:"Invalid webhook signature."},{status:400});}}

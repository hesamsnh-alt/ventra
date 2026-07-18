import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function unixToIso(timestamp) {
  if (!timestamp) {
    return null;
  }

  return new Date(timestamp * 1000).toISOString();
}

function createSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY;

  if (!supabaseUrl) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is missing from .env.local"
    );
  }

  if (!supabaseSecretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY is missing from .env.local"
    );
  }

  return createClient(supabaseUrl, supabaseSecretKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

async function saveSubscription({
  stripe,
  supabaseAdmin,
  subscription,
}) {
  const supabaseUserId =
    subscription.metadata?.supabase_user_id;

  if (!supabaseUserId) {
    throw new Error(
      "Supabase user ID is missing from Stripe subscription metadata."
    );
  }

  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;

  const priceId =
    subscription.items?.data?.[0]?.price?.id || null;

  const { error } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        user_id: supabaseUserId,

        stripe_customer_id: customerId || null,

        stripe_subscription_id: subscription.id,

        stripe_price_id: priceId,

        plan_name:
          subscription.metadata?.ventra_plan || "starter",

        status: subscription.status,

        trial_start: unixToIso(subscription.trial_start),

        trial_end: unixToIso(subscription.trial_end),

        current_period_start: unixToIso(
          subscription.current_period_start
        ),

        current_period_end: unixToIso(
          subscription.current_period_end
        ),

        cancel_at_period_end:
          subscription.cancel_at_period_end || false,
      },
      {
        onConflict: "user_id",
      }
    );

  if (error) {
    throw error;
  }
}

export async function POST(request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!stripeSecretKey) {
    return new Response(
      "STRIPE_SECRET_KEY is missing from .env.local",
      {
        status: 500,
      }
    );
  }

  if (!webhookSecret) {
    return new Response(
      "STRIPE_WEBHOOK_SECRET is missing from .env.local",
      {
        status: 500,
      }
    );
  }

  const stripe = new Stripe(stripeSecretKey);
  const supabaseAdmin = createSupabaseAdmin();

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return new Response("Stripe signature is missing.", {
      status: 400,
    });
  }

  let event;

  try {
    const rawBody = await request.text();

    event = stripe.webhooks.constructEvent(
      rawBody,
      signature,
      webhookSecret
    );
  } catch (error) {
    console.error(
      "Stripe webhook signature error:",
      error
    );

    return new Response(
      `Webhook signature verification failed: ${
        error?.message || "Unknown error"
      }`,
      {
        status: 400,
      }
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const checkoutSession = event.data.object;

        if (
          checkoutSession.mode !== "subscription" ||
          !checkoutSession.subscription
        ) {
          break;
        }

        const subscription =
          await stripe.subscriptions.retrieve(
            checkoutSession.subscription
          );

        await saveSubscription({
          stripe,
          supabaseAdmin,
          subscription,
        });

        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object;

        await saveSubscription({
          stripe,
          supabaseAdmin,
          subscription,
        });

        break;
      }

      default: {
        console.log(
          `Unhandled Stripe event: ${event.type}`
        );
      }
    }

    return Response.json({
      received: true,
    });
  } catch (error) {
    console.error(
      "Stripe webhook processing error:",
      error
    );

    return Response.json(
      {
        error:
          error?.message ||
          "Webhook could not be processed.",
      },
      {
        status: 500,
      }
    );
  }
}
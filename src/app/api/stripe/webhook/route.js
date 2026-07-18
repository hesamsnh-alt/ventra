import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request) {
  try {
    const stripeSecretKey =
      process.env.STRIPE_SECRET_KEY;

    const supabaseUrl =
      process.env.NEXT_PUBLIC_SUPABASE_URL;

    const supabasePublicKey =
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    const priceId =
      process.env.NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID;

    if (!stripeSecretKey) {
      return Response.json(
        {
          error:
            "STRIPE_SECRET_KEY is missing from the environment variables.",
        },
        {
          status: 500,
        }
      );
    }

    if (!supabaseUrl) {
      return Response.json(
        {
          error:
            "NEXT_PUBLIC_SUPABASE_URL is missing from the environment variables.",
        },
        {
          status: 500,
        }
      );
    }

    if (!supabasePublicKey) {
      return Response.json(
        {
          error:
            "Supabase publishable or anon key is missing from the environment variables.",
        },
        {
          status: 500,
        }
      );
    }

    if (!priceId) {
      return Response.json(
        {
          error:
            "NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID is missing from the environment variables.",
        },
        {
          status: 500,
        }
      );
    }

    const authorizationHeader =
      request.headers.get("authorization");

    const accessToken =
      authorizationHeader?.startsWith("Bearer ")
        ? authorizationHeader.substring(7).trim()
        : null;

    if (!accessToken) {
      return Response.json(
        {
          error:
            "You must be signed in to start the trial.",
        },
        {
          status: 401,
        }
      );
    }

    const supabaseServer = createClient(
      supabaseUrl,
      supabasePublicKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
          detectSessionInUrl: false,
        },

        global: {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        },
      }
    );

    const {
      data: { user },
      error: userError,
    } = await supabaseServer.auth.getUser(accessToken);

    if (userError || !user) {
      console.error(
        "Supabase Checkout authentication error:",
        userError
      );

      return Response.json(
        {
          error:
            "Your login session is invalid. Please sign in again.",
        },
        {
          status: 401,
        }
      );
    }

    if (!user.email) {
      return Response.json(
        {
          error:
            "Your Ventra account does not have a valid email address.",
        },
        {
          status: 400,
        }
      );
    }

    const stripe = new Stripe(stripeSecretKey);

    const requestOrigin =
      request.headers.get("origin");

    const configuredSiteUrl =
      process.env.NEXT_PUBLIC_SITE_URL;

    const origin =
      requestOrigin ||
      configuredSiteUrl ||
      "http://localhost:3000";

    const checkoutSession =
      await stripe.checkout.sessions.create({
        mode: "subscription",

        customer_email: user.email,

        client_reference_id: user.id,

        line_items: [
          {
            price: priceId,
            quantity: 1,
          },
        ],

        subscription_data: {
          trial_period_days: 7,

          metadata: {
            supabase_user_id: user.id,
            ventra_plan: "starter",
          },
        },

        metadata: {
          supabase_user_id: user.id,
          ventra_plan: "starter",
        },

        success_url:
          `${origin}/pricing/success` +
          "?session_id={CHECKOUT_SESSION_ID}",

        cancel_url: `${origin}/pricing?canceled=1`,

        billing_address_collection: "auto",

        allow_promotion_codes: true,
      });

    if (!checkoutSession.url) {
      return Response.json(
        {
          error:
            "Stripe did not return a checkout URL.",
        },
        {
          status: 500,
        }
      );
    }

    return Response.json({
      url: checkoutSession.url,
    });
  } catch (error) {
    console.error(
      "Stripe Checkout API error:",
      error
    );

    return Response.json(
      {
        error:
          error?.message ||
          "Checkout session could not be created.",
      },
      {
        status: 500,
      }
    );
  }
}
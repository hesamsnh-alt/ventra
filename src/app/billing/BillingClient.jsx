"use client";
import LocalizedLink from "@/app/components/i18n/LocalizedLink";

import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import {useEffect,useState} from "react";
import Link from "next/link";
import {CreditCard,FileText,ShieldCheck,ArrowUpRight,RefreshCw,LoaderCircle} from "lucide-react";
import {supabase} from "@/lib/supabase";
import "./Billing.css";

export default function BillingClient({sessionId=null}) {
  const [data,setData]=useState(null);
  const [usage,setUsage]=useState(null),[usageError,setUsageError]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState("");
  const [revision,setRevision]=useState(0);
  async function call(path,method="GET") {
    const {data:{session},error:sessionError}=await supabase.auth.getSession();
    if(sessionError) throw sessionError;
    if(!session) throw new Error("Please sign in to manage billing.");
    const response=await fetch(path,{method,headers:{Authorization:`Bearer ${session.access_token}`},cache:"no-store"});
    const result=await response.json();
    if(!response.ok) throw new Error(result.error||"Billing request failed.");
    return result;
  }
  useEffect(()=>{
    let live=true;
    call("/api/stripe/status"+(sessionId?"?session_id="+encodeURIComponent(sessionId):""))
      .then(result=>{if(live)setData(result);})
      .catch(e=>{if(live)setError(e.message);});
    call("/api/billing/usage").then(value=>{if(live){setUsage(value);setUsageError("");}}).catch(e=>{if(live)setUsageError(e.message);});
    return ()=>{live=false;};
  },[sessionId,revision]);
  async function redirect(path) {
    if(busy) return;
    setBusy(path);setError("");
    try {
      const result=await call(path,"POST");
      if(!result.url) throw new Error("The payment provider did not return a URL.");
      window.location.assign(result.url);
    } catch(e) {setError(e.message);setBusy("");}
  }
  function refresh(){setData(null);setError("");setRevision(value=>value+1);}
  const status=data?.status;
  const label=status?status.replaceAll("_"," "):"Checking";
  const canSubscribe=data&&["none","canceled","incomplete_expired"].includes(status);
  const trialDate=data?.trialEnd?new Date(data.trialEnd*1000):null;
  const showTrial=status==="trialing"&&trialDate&&!Number.isNaN(trialDate.getTime());
  return <LocalizedElement as="section" className="vb-billing" aria-label="Subscription and payments">
    <LocalizedElement as="div" className="vb-intro"><LocalizedElement as="span" className="vb-eyebrow">YOUR ACCOUNT</LocalizedElement><LocalizedElement as="p">Manage your subscription, payment method and invoices in one place.</LocalizedElement></LocalizedElement>
    {error&&<LocalizedElement as="div" className="vb-alert" role="alert"><LocalizedElement as="strong">We could not complete this request.</LocalizedElement><LocalizedElement as="p">{error}</LocalizedElement><LocalizedLink  href="/support">Contact billing support</LocalizedLink></LocalizedElement>}
    <LocalizedElement as="div" className="vb-grid">
      <LocalizedElement as="article" className="vb-card vb-subscription">
        <LocalizedElement as="div" className="vb-card-top"><LocalizedElement as="div" className="vb-icon"><CreditCard size={24}/></LocalizedElement><LocalizedElement as="span" className={`vb-status ${["active","trialing"].includes(status)?"vb-status-live":""}`}>{label}</LocalizedElement></LocalizedElement>
        <LocalizedElement as="h2">Your subscription</LocalizedElement>
        {!data&&!error&&<LocalizedElement as="p" className="vb-loading"><LoaderCircle size={18}/>Checking your account with Stripe…</LocalizedElement>}
        {data&&<><LocalizedElement as="p" className="vb-detail">{status==="active"?"Your subscription is active. Manage billing details securely through Stripe.":status==="trialing"?"Your subscription is currently in its trial period.":status==="none"?"You do not have a subscription yet.":"Review your subscription status and payment details in Stripe."}</LocalizedElement>
          {showTrial&&<LocalizedElement as="div" className="vb-date"><LocalizedElement as="span">Trial end date</LocalizedElement><LocalizedElement as="strong">{trialDate.toLocaleDateString("en-GB",{day:"numeric",month:"short",year:"numeric"})}</LocalizedElement></LocalizedElement>}
          {data.cancelAtPeriodEnd&&<LocalizedElement as="p" className="vb-notice">Cancellation is scheduled at the end of the billing period.</LocalizedElement>}
          {sessionId&&<LocalizedElement as="p" className="vb-notice">{data.checkoutStatus==="complete"&&["active","trialing"].includes(status)?"Checkout verified. Your subscription is active.":"Checkout has not yet been confirmed as an active subscription."}</LocalizedElement>}
          {canSubscribe&&<LocalizedElement as="button" className="vb-primary" disabled={!!busy} onClick={()=>redirect("/api/stripe/create-checkout-session")}>{busy?"Opening Stripe…":"Choose subscription & enter card"}<ArrowUpRight size={18}/></LocalizedElement>}
        </>}
        <LocalizedElement as="button" className="vb-secondary" disabled={!!busy||(!data&&!error)} onClick={refresh}><RefreshCw size={16}/>Refresh status</LocalizedElement>
      </LocalizedElement>
      <LocalizedElement as="article" className="vb-card">
        <LocalizedElement as="div" className="vb-icon"><FileText size={24}/></LocalizedElement><LocalizedElement as="h2">Cards & invoices</LocalizedElement>
        <LocalizedElement as="p" className="vb-detail">Add or update your card, download invoices and manage renewal or cancellation in the secure Stripe portal.</LocalizedElement>
        {data?.hasCustomer?<LocalizedElement as="button" className="vb-primary" disabled={!!busy} onClick={()=>redirect("/api/stripe/portal")}>{busy?"Opening Stripe…":"Manage card & invoices"}<ArrowUpRight size={18}/></LocalizedElement>:<LocalizedElement as="p" className="vb-notice">{data?"A billing profile is created when you start checkout.":"Sign in and load your billing status to access payment settings."}</LocalizedElement>}
        <LocalizedElement as="div" className="vb-security"><ShieldCheck size={18}/><LocalizedElement as="span">Card details are handled by Stripe.</LocalizedElement></LocalizedElement>
      </LocalizedElement>
    </LocalizedElement>
    <LocalizedElement as="article" className="vb-card" style={{marginTop:20}}><LocalizedElement as="h2">AI analysis allowance</LocalizedElement>{usage?<><LocalizedElement as="p">{usage.used} / {usage.limit} submissions used · {usage.remaining} remaining</LocalizedElement><LocalizedElement as="p">Resets {new Date(usage.resetAt).toLocaleDateString("en-GB")} (UTC). Drawing analysis and 3D requests share the allowance, including failed submissions. BOQ generation does not consume it.</LocalizedElement></>:<LocalizedElement as="p">{usageError||"Loading usage…"}</LocalizedElement>}</LocalizedElement>
    <LocalizedElement as="nav" className="vb-links" aria-label="Billing navigation"><LocalizedLink  href="/pricing">View pricing</LocalizedLink><LocalizedLink  href="/dashboard">Back to dashboard</LocalizedLink><LocalizedLink  href="/support">Billing support</LocalizedLink>{!data&&<LocalizedLink  href="/login">Sign in</LocalizedLink>}</LocalizedElement>
  </LocalizedElement>;
}

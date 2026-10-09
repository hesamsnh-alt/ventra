"use client";
import LocalizedElement, {OriginalText} from "@/app/components/i18n/LocalizedElement";

import {useRouter} from "next/navigation";
import {useState} from "react";import {signOutUser} from "@/services/authService";
export default function SignOutButton(){const router=useRouter();const [busy,setBusy]=useState(false),[error,setError]=useState("");async function logout(){if(busy)return;setBusy(true);setError("");try{const result=await signOutUser();if(result?.error)throw result.error;router.replace("/login");router.refresh();}catch(e){setError(e.message||"Sign out failed. Please try again.");setBusy(false);}}return <LocalizedElement as="span" style={{display:"inline-flex",gap:8,alignItems:"center",flexWrap:"wrap"}}><LocalizedElement as="button" type="button" onClick={logout} disabled={busy} style={{background:"transparent",color:"inherit",border:"1px solid #777",borderRadius:8,padding:"8px 12px",cursor:"pointer"}}>{busy?"Signing out…":"Sign out"}</LocalizedElement>{error&&<LocalizedElement as="span" role="alert">{error}</LocalizedElement>}</LocalizedElement>}

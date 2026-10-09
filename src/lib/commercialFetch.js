import {supabase} from '@/lib/supabase';
export async function commercialHeaders(initial={}){
 const {data,error}=await supabase.auth.getSession();
 if(error||!data?.session?.access_token)throw new Error('Please sign in before using project analysis.');
 const headers=new Headers(initial);headers.set('Authorization','Bearer '+data.session.access_token);return headers;
}
export async function commercialFetch(url,options={}){
 if(!/^\/api\/(?:ai|aps)(?:\/|$)|^\/api\/aps-auth(?:\?|$)/.test(String(url)))return fetch(url,options);
 return fetch(url,{...options,headers:await commercialHeaders(options.headers)});
}

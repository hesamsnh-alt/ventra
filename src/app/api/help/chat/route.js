import {commercialAdmin} from '@/lib/serverCommercial';
import OpenAI from 'openai';
import {createClient} from '@supabase/supabase-js';
import {parseHelpInput,helpInstructions} from '@/lib/ventraHelpServer.mjs';
export const runtime='nodejs';
const quota=new Map();
const reply=(error,status)=>Response.json({error},{status});
export async function POST(request){
 const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1];
 if(!token)return reply('Sign in to use AI help.',401);
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 if(!url||!key)return reply('AI help authentication is not configured. Use Quick guide.',503);
 let user;
 try{const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});const {data,error}=await db.auth.getUser(token);if(error||!data.user)return reply('Your session expired. Please sign in again.',401);user=data.user;}catch{return reply('Authentication service unavailable. Use Quick guide.',503);}
 let input;
 try{const raw=await request.text();if(raw.length>36000)return reply('Message is too large.',413);input=parseHelpInput(JSON.parse(raw));}catch{return reply('Invalid message. Keep the question under 1200 characters.',400);}
 if(!process.env.OPENAI_API_KEY)return reply('AI help is not configured on the server. Use Quick guide.',503);
 const now=Date.now();for(const [id,row] of quota)if(row.until<=now)quota.delete(id);
 const row=quota.get(user.id)||{count:0,until:now+86400000,busy:false};
 if(row.busy||row.count>=30)return reply('AI help limit reached or a reply is already in progress. Use Quick guide.',429);
 row.busy=true;row.count++;quota.set(user.id,row);
 try{
  const usage=await commercialAdmin().rpc('ventra_consume_help',{p_actor:user.id});
  if(usage.error)return reply('AI help usage tracking is unavailable. Use Quick guide.',503);
  if(!usage.data)return reply('Daily AI help allowance reached (10 requests). Use Quick guide.',429);
  const client=new OpenAI({apiKey:process.env.OPENAI_API_KEY,maxRetries:0,timeout:55000});
  const response=await client.responses.create({model:process.env.OPENAI_HELP_MODEL||'gpt-4.1-mini',store:false,max_output_tokens:900,instructions:helpInstructions(input.language),input:[...input.history,{role:'user',content:input.message}]});
  if(response.status!=='completed'||!response.output_text?.trim())return reply('AI did not finish its reply. Use Quick guide or try later.',502);
  return Response.json({text:response.output_text.trim()});
 }catch(error){return reply(error.status===429?'AI quota or rate limit reached. Use Quick guide.':'AI help is temporarily unavailable. Use Quick guide.',error.status===429?429:502);}finally{row.busy=false;}
}

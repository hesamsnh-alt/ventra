// Local configuration inspection. Never prints secret values or invokes paid APIs.
import fs from 'node:fs';
try{process.loadEnvFile('.env.local');}catch{}
const required=['NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','SUPABASE_SERVICE_ROLE_KEY','OPENAI_API_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','NEXT_PUBLIC_STRIPE_STARTER_PRICE_ID','NEXT_PUBLIC_SITE_URL'];
let missing=0;
for(const name of required){const ready=!!process.env[name]?.trim();console.log(`${ready?'OK':'MISSING'} ${name}`);if(!ready)missing++;}
const url=process.env.NEXT_PUBLIC_SITE_URL;
if(url){try{const parsed=new URL(url);if(parsed.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(parsed.hostname)){console.log('ERROR site URL must use HTTPS');missing++;}}catch{console.log('ERROR site URL is invalid');missing++;}}
if(fs.existsSync('supabase/migrations/20261007_commercial_foundation.sql'))console.log('SQL migration present locally. This does not mean it has been applied to Supabase.');
console.log(missing?'Configuration needs attention.':'Required configuration names are present. Live services still need verification.');
process.exitCode=missing?1:0;

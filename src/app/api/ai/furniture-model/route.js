import {commercialError} from '@/lib/serverCommercial';
import {startFurnitureModel,pollFurnitureModel,readAssetBody,personalAssetAccount} from '@/lib/serverPersonalAssets';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function POST(request){try{await personalAssetAccount(request);return Response.json(await startFurnitureModel(request,await readAssetBody(request)));}catch(e){return commercialError(e);}}
export async function GET(request){try{return Response.json(await pollFurnitureModel(request,new URL(request.url).searchParams.get('jobId')),{headers:{'Cache-Control':'no-store'}});}catch(e){return commercialError(e);}}

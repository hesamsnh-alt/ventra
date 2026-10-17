import {commercialError} from '@/lib/serverCommercial';
import {libraryList,libraryAsset,linkLibraryAsset,uploadLibraryMaterial,editLibraryAsset,readAssetBody,personalAssetAccount,beginLibraryGlbUpload,finishLibraryGlbUpload} from '@/lib/serverPersonalAssets';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const maxDuration=60;
export async function GET(request){try{const q=new URL(request.url).searchParams;return Response.json(q.get('assetId')?await libraryAsset(request,q.get('assetId'),q.get('projectId')):await libraryList(request),{headers:{'Cache-Control':'no-store'}});}catch(e){return commercialError(e);}}
export async function POST(request){try{await personalAssetAccount(request);const body=await readAssetBody(request);return Response.json(body.action==='link'?await linkLibraryAsset(request,body):body.action==='begin-glb'?await beginLibraryGlbUpload(request,body):body.action==='finish-glb'?await finishLibraryGlbUpload(request,body):await uploadLibraryMaterial(request,body));}catch(e){return commercialError(e);}}
export async function PATCH(request){try{await personalAssetAccount(request);return Response.json(await editLibraryAsset(request,await readAssetBody(request)));}catch(e){return commercialError(e);}}

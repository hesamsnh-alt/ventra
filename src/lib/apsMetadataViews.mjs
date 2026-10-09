const name=value=>String(value||'').trim().replace(/\s+/g,' ').toLowerCase();
export function selectApsMetadataViews(metadata,{viewGuid,viewName,viewRole}={}){
 const views=(Array.isArray(metadata)?metadata:[]).filter(v=>v?.guid);
 const exact=views.find(v=>String(v.guid)===String(viewGuid));
 if(exact)return {views:[exact],match:'guid',safe:true};
 const named=viewName?views.filter(v=>name(v.name)===name(viewName)&&(!viewRole||!v.role||v.role===viewRole)):[];
 if(named.length===1)return {views:named,match:'unique_name',safe:true};
 // The viewer's geometry GUID can differ from the sole metadata model GUID.
 // Do not guess between sheets, even if only one sheet has the requested role.
 if(views.length===1&&(!viewRole||!views[0].role||views[0].role===viewRole))return {views,match:'single_model',safe:true};
 if(viewGuid)return {views:[],match:'ambiguous',safe:false};
 return {views:[],match:'view_required',safe:false};
}

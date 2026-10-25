import {SURFACE_MIME,findSurfaceMaterial,surfaceMaterialAllowed} from './surfaceMaterials.mjs';

export function bindSurfaceMaterialInputs(host,{getState,getRenderer,onApply,onHover=()=>{}}){
  const owns=e=>Array.from(e.dataTransfer?.types||[]).includes(SURFACE_MIME);
  const over=e=>{
    if(!owns(e))return;
    e.preventDefault();e.stopPropagation();
    const s=getState(),hit=!s.disabled&&getRenderer()?.pickSurface?.(e);
    const id=e.dataTransfer.getData(SURFACE_MIME)||s.materialId;
    const target=surfaceMaterialAllowed(id,hit)?hit:null;
    e.dataTransfer.dropEffect=target?'copy':'none';onHover(target||null);
  };
  const leave=e=>{if(!host.contains?.(e.relatedTarget))onHover(null);};
  const drop=e=>{
    if(!owns(e))return;
    e.preventDefault();e.stopPropagation();onHover(null);
    const s=getState();if(s.disabled)return;
    const id=e.dataTransfer.getData(SURFACE_MIME);
    if(findSurfaceMaterial(id)){host.focus?.({preventScroll:true});onApply(getRenderer()?.pickSurface?.(e)||null,id);}
  };
  const down=e=>{
    const s=getState();if(!s.paintMode||s.disabled||e.button!==0)return;
    e.preventDefault();e.stopImmediatePropagation();
    host.focus?.({preventScroll:true});
    onApply(getRenderer()?.pickSurface?.(e)||null,s.materialId);
  };
  host.addEventListener('dragover',over,true);host.addEventListener('dragleave',leave,true);
  host.addEventListener('drop',drop,true);host.addEventListener('pointerdown',down,true);
  return ()=>{host.removeEventListener('dragover',over,true);host.removeEventListener('dragleave',leave,true);
    host.removeEventListener('drop',drop,true);host.removeEventListener('pointerdown',down,true);onHover(null);};
}

export function bindSurfaceMaterialUndo(host,panel,getState,onUndo,eventTarget=globalThis.document){
  if(!eventTarget)return ()=>{};
  const handler=event=>{
    const target=event.target,state=getState();
    const editable=target?.isContentEditable||target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""],[contenteditable="plaintext-only"],[role="textbox"]');
    if(editable||event.defaultPrevented||event.isComposing||event.repeat||event.shiftKey||event.altKey||
      !(event.ctrlKey||event.metaKey)||!(event.code==='KeyZ'||String(event.key).toLowerCase()==='z'))return;
    const inScope=panel?.contains(target)||(state.paintMode&&host.contains(target));
    if(!inScope||state.disabled||!state.canUndo)return;
    event.preventDefault();event.stopImmediatePropagation();onUndo();
  };
  eventTarget.addEventListener('keydown',handler,true);
  return ()=>eventTarget.removeEventListener('keydown',handler,true);
}

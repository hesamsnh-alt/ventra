'use client';

import {useEffect,useRef,useState} from 'react';
import {FURNITURE_CATALOG} from '@/lib/furnitureEditor.mjs';
import {ROOM_LAYOUTS} from '@/lib/planStudio/roomLayout.mjs';
import {planAssetSymbol} from '@/lib/planStudio/furnitureSymbols.mjs';
import {pathData} from '@/lib/planStudio/render2d.mjs';

const models=new Map(FURNITURE_CATALOG.map(model=>[model.id,model]));
// The card drawings use the same furniture symbols as the plan canvas.
const poses={
  living:[['sofa-modern',2,2.35],['tv-console-oak',2,.45],['coffee-low',2,1.5]],
  dining:[['dining-oak',2,1.5],['chair',.85,1.5,90],['chair',3.15,1.5,90],['chair',2,.45],['chair',2,2.55]],
  bedroom:[['bed-modern',2,1.6],['wardrobe',.42,1.55,90],['nightstand',3.35,.55]],
  office:[['desk',2,2.3],['chair',2,1.35]],
  kitchen:[['counter',1.6,2.45],['cooker',.6,2.45],['basin',2.5,2.45],['fridge',3.4,2.35]],
  bathroom:[['bath',1,2.43],['toilet',2.95,2.35],['basin',3.3,.65]],
};
const wetRoom=kind=>kind==='kitchen'||kind==='bathroom';

function LayoutThumbnail({kind}){
  const tile=wetRoom(kind);
  return <svg viewBox="0 0 4 3" aria-hidden="true" className="ps-room-thumbnail">
    <rect x=".1" y=".1" width="3.8" height="2.8" rx=".05" className="ps-room-outline"/>
    {tile&&<path className="ps-room-tile" d="M.5 .1V2.9M1 .1V2.9M1.5 .1V2.9M2 .1V2.9M2.5 .1V2.9M3 .1V2.9M3.5 .1V2.9M.1 .5H3.9M.1 1H3.9M.1 1.5H3.9M.1 2H3.9M.1 2.5H3.9"/>}
    {poses[kind].map(([catalogId,x,y,rotation],index)=>{
      const model=models.get(catalogId);
      return <g key={index}>{planAssetSymbol({catalogId,center:{x,y},width:model.width,depth:model.depth,rotation})
        .map((shape,j)=><path key={j} d={pathData(shape)} className={j===0?'ps-room-fixture':''}/>)}</g>;
    })}
  </svg>;
}

export default function PlanRoomLayoutPicker({t,onConfirm,onCancel}){
  const dialog=useRef(null);
  const [kind,setKind]=useState('');
  const [tiles,setTiles]=useState(true);
  useEffect(()=>{
    const node=dialog.current;
    node.showModal();
    return ()=>{if(node.open)node.close();};
  },[]);
  return <dialog ref={dialog} className="ps-room-picker" aria-labelledby="ps-af-title"
    onKeyDown={event=>event.stopPropagation()}
    onCancel={event=>{event.preventDefault();onCancel();}}>
    <form onSubmit={event=>{event.preventDefault();if(kind)onConfirm(kind,tiles);}}>
      <h2 id="ps-af-title">{t('Arrange room · AF','چیدمان فضا · AF')}</h2>
      <p>{t('Choose a layout, then mark two opposite corners on the plan.','نوع چیدمان را انتخاب کن، بعد دو گوشهٔ مقابل را روی پلان بزن.')}</p>
      <fieldset className="ps-room-options" aria-label={t('Room type','نوع فضا')}>
        {ROOM_LAYOUTS.map(([value,en,fa])=><label key={value} className="ps-room-option">
          <input type="radio" name="af-room-type" value={value} checked={kind===value} onChange={()=>setKind(value)}/>
          <LayoutThumbnail kind={value}/>
          <span>{t(en,fa)}</span>
        </label>)}
      </fieldset>
      {wetRoom(kind)&&<label className="ps-room-tiles"><input type="checkbox" checked={tiles}
        onChange={event=>setTiles(event.target.checked)}/>{t('Add tile floor','افزودن کف کاشی')}</label>}
      <div className="ps-room-actions">
        <button type="button" onClick={onCancel}>{t('Cancel','لغو')}</button>
        <button type="submit" disabled={!kind}>{t('Select room corners','انتخاب گوشه‌های فضا')}</button>
      </div>
    </form>
  </dialog>;
}

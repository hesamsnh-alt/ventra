'use client';
import {useState} from 'react';
export default function PlanLengthControl({fa,length,onApply,onClear,offset=false,radius=false}){
 const [value,setValue]=useState(offset?'20':'2'),[unit,setUnit]=useState(offset?'cm':'m');
 const t=(en,ps)=>fa?ps:en;
 return <form className="ps-length-control" aria-label={offset?t('Offset distance','فاصلهٔ آفست'):t('Exact drawing length','طول دقیق ترسیم')} onSubmit={e=>{e.preventDefault();onApply(value,unit);}}>
  <label htmlFor="ps-exact-length">{offset?t('Offset','آفست'):radius?t('Exact radius','شعاع دقیق'):t('Exact length','طول دقیق')}</label>
  <input id="ps-exact-length" inputMode="decimal" autoComplete="off" dir="ltr" value={value} onChange={e=>setValue(e.target.value)} placeholder="2"/>
  <select aria-label={t('Length unit','واحد طول')} value={unit} onChange={e=>setUnit(e.target.value)}>
   <option value="m">{t('m','متر')}</option><option value="cm">{t('cm','سانتی‌متر')}</option><option value="mm">{t('mm','میلی‌متر')}</option><option value="in">{t('inch','اینچ')}</option>
  </select>
  <button type="submit">{offset?t('Set distance','ثبت فاصله'):radius?t('Lock radius','قفل شعاع'):t('Lock length','قفل طول')}</button>
  {!offset&&<button type="button" disabled={!length} onClick={onClear}>{t('Free','آزاد')}</button>}
  <output aria-live="polite">{offset?(length?t(`Offset: ${Number(length.toFixed(6))} m · pick object, then side`, `آفست: ${Number(length.toFixed(6))} متر · جسم و سپس سمت را انتخاب کن`):t('Enter offset distance first','ابتدا فاصلهٔ آفست را ثبت کن')):length?t(`Locked: ${Number(length.toFixed(6))} m · pick start, then direction`, `قفل: ${Number(length.toFixed(6))} متر · شروع و سپس جهت را انتخاب کن`):t('Free length · lock a value before picking direction','طول آزاد · برای رسم دقیق، مقدار را قفل کن')}</output>
 </form>;
}

export const selectionText=(language)=>(en,fa,ar)=>language==='fa'?fa:language==='ar'?ar:en;
export const selectionMoney=value=>new Intl.NumberFormat('en-AE',{style:'currency',currency:'AED',maximumFractionDigits:2}).format(Number(value)||0);

// Reconcile generated pending-rate messages with the current editable rows.
// Source conflicts and other evidence warnings must remain visible.
export function currentBoqWarnings(warnings=[],items=[]){
  const metric=i=>i.imageEvidence?.metricKey||i.pdfEvidence?.metricKey;
  const pending=i=>!(Number(i.rate)>0)||i.rateMissing===true;
  return warnings.filter(w=>{
    const surface=String(w).match(/m2 of (floor|ceiling|wall) finish remains unselected/);
    if(surface)return items.some(i=>i.measurementPlaceholder?.surface===surface[1]&&pending(i));
    const quantity=String(w).match(/^(?:Image|PDF) quantity (\w+) retained as an unpriced row;/);
    if(quantity)return items.some(i=>metric(i)===quantity[1]&&pending(i));
    return true;
  });
}

// Relative positions are in metres around the click point. Every piece remains
// an independently editable object after this all-or-nothing placement.
export const SOFA_SET_LAYOUTS=Object.freeze(Object.fromEntries(['modern','comfort','classic'].flatMap(style=>[6,7].map(seats=>{
 const sofa=style==='classic'?'sofa-classic':style==='comfort'?'sofa-comfort':'sofa-modern';
 const small=style==='classic'?'sofa-classic-two':style==='comfort'?'sofa-comfort-two':'sofa-modern-two';
 const chair=style==='classic'?'armchair-classic':style==='comfort'?'armchair-comfort':'armchair-soft';
 return [`sofa-set-${style}-${seats}`,Object.freeze([
  {catalogId:sofa,x:0,y:-1.5,rotation:0,seats:3},
  {catalogId:small,x:-1.8,y:.05,rotation:-90,seats:2},
  {catalogId:seats===7?small:chair,x:1.8,y:.05,rotation:90,seats:seats===7?2:1},
  {catalogId:style==='classic'?'coffee-walnut':'coffee-low',x:0,y:.1,rotation:0,seats:0},
 ])];
}))));

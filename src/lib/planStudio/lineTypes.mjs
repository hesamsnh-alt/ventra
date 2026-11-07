export const LINE_TYPES=[
 {id:'solid',en:'Solid',fa:'پیوسته',sample:'━━━━━━',dxf:'CONTINUOUS',cad:[],screen:''},
 {id:'dashed',en:'Dashed',fa:'خط‌چین',sample:'━ ━ ━ ━',dxf:'DASHED',cad:[.15,-.09],screen:'8 5'},
 {id:'dotted',en:'Dotted',fa:'نقطه‌چین',sample:'● ● ● ●',dxf:'DOT',cad:[0,-.06],screen:'.01 5'},
 {id:'center',en:'Centre',fa:'خط محور',sample:'━━ ━ ━━',dxf:'CENTER',cad:[.3,-.08,.04,-.08],screen:'14 4 3 4'},
];
export const lineType=id=>LINE_TYPES.find(t=>t.id===id)||LINE_TYPES[0];
export function lineDash(id,screen=false){const type=lineType(id);return screen?type.screen:type.cad.map(Math.abs).join(' ');}

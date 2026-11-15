export function buildBedCover(THREE,width,depth,material,{height=.463,depthStart=-.18,foldDepth=.19,foldWeight=1}={}){
  const columns=32,rows=36;
  const legacy=Boolean(THREE.Geometry);
  const geometry=legacy?new THREE.Geometry():new THREE.BufferGeometry();
  const positions=[],uvs=[],indices=[];
  const start=depth*depthStart,end=depth*.49;
  for(let row=0;row<=rows;row++){
    const v=row/rows;
    for(let column=0;column<=columns;column++){
      const u=column/columns;
      const x=(u-.5)*width*.98;
      const y=start+(end-start)*v;
      const side=Math.max(0,(Math.abs(u-.5)*2-.83)/.17);
      const foot=Math.max(0,(v-.85)/.15);
      const fold=Math.sin(v*9-u*14)+.55*Math.sin(u*26+v*12)+.4*Math.sin(u*39-v*23);
      const drape=Math.max(side,foot);
      const fall=Math.pow(drape,1.7)*(foldDepth+.017*fold);
      const vertex=[
        x+Math.sign(x)*side*.003*fold,
        y+foot*.003*fold,
        height+.0075*fold*foldWeight+.009*Math.exp(-v*25)-fall
      ];
      if(legacy)geometry.vertices.push(new THREE.Vector3(...vertex));
      else{positions.push(...vertex);uvs.push(u,v);}
    }
  }
  function triangle(a,b,c){
    if(!legacy){indices.push(a,b,c);return;}
    geometry.faces.push(new THREE.Face3(a,b,c));
    geometry.faceVertexUvs[0].push([a,b,c].map(index=>new THREE.Vector2(
      (index%(columns+1))/columns,Math.floor(index/(columns+1))/rows
    )));
  }
  for(let row=0;row<rows;row++)for(let column=0;column<columns;column++){
    const a=row*(columns+1)+column,b=a+1,c=a+columns+1,d=c+1;
    triangle(a,b,d);
    triangle(a,d,c);
  }
  if(legacy)geometry.computeFaceNormals();
  else{
    geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
    geometry.setAttribute('uv',new THREE.Float32BufferAttribute(uvs,2));
    geometry.setIndex(indices);
  }
  geometry.computeVertexNormals();
  const cover=new THREE.Mesh(geometry,material);
  cover.castShadow=cover.receiveShadow=true;
  cover.userData={ventraComponent:'bed_fabric'};
  return cover;
}

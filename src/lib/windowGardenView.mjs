const source='/images/window-garden.webp';

export function outdoorWindowNormal(start,end,interior){
  const dx=end.x-start.x,dy=end.y-start.y,length=Math.hypot(dx,dy);
  if(!length)return null;
  const nx=-dy/length,ny=dx/length;
  const inside=(interior.x-(start.x+end.x)/2)*nx+(interior.y-(start.y+end.y)/2)*ny;
  const sign=inside>0?-1:1;
  return {x:nx*sign,y:ny*sign};
}

export function createGardenView({THREE,opening,normal,wallThickness,material}){
  const {start,end}=opening;
  const width=Math.hypot(end.x-start.x,end.y-start.y);
  const height=Number(opening.height),sill=Number(opening.sillHeight);
  if(!normal||!Number.isFinite(sill)||!(height>0&&width>0))return null;
  const depth=Math.max(4.5,wallThickness*.70);
  const viewHeight=Math.max(height+depth*2,(width+depth*3)/1.5);
  const viewWidth=viewHeight*1.5;
  const backdrop=new THREE.Mesh(new THREE.PlaneGeometry(viewWidth,viewHeight),material);
  backdrop.rotation.set(Math.PI/2,0,Math.atan2(-normal.x,normal.y),'ZYX');
  backdrop.position.set((start.x+end.x)/2+normal.x*depth,(start.y+end.y)/2+normal.y*depth,sill+height*.47);
  backdrop.visible=false;
  backdrop.userData={ventraType:'schematic_window_outdoor_view',nonSelectable:true};
  return backdrop;
}

export function loadGardenMaterial(THREE,onReady){
  if(typeof Image==='undefined')return null;
  const map=new THREE.Texture();
  const image=new Image();
  const material=new THREE.MeshBasicMaterial({map,side:THREE.FrontSide});
  material.userData={ventraOutdoorView:true};
  image.onload=()=>{
    map.image=image;
    map.needsUpdate=true;
    onReady();
  };
  material.addEventListener('dispose',()=>{image.onload=null;});
  image.src=source;
  return material;
}

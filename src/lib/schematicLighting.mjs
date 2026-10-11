export function configureSchematicLighting(THREE,renderer,scene,width,depth){
 const span=Math.max(4,Math.hypot(Number(width)||12,Number(depth)||8));
 if('gammaInput' in renderer)renderer.gammaInput=false;
 if('gammaOutput' in renderer)renderer.gammaOutput=false;
 if(THREE.ACESFilmicToneMapping!==undefined){renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;}
 const ambient=new THREE.AmbientLight(0xffffff);ambient.color.multiplyScalar(.25);scene.add(ambient);
 if(THREE.HemisphereLight){const sky=new THREE.HemisphereLight(0xeaf1ff,0xb3a28d,.15);sky.up?.set(0,0,1);sky.position.set(0,0,span);scene.add(sky);}
 const key=new THREE.DirectionalLight(0xfff4e6,.48);key.position.set(span*.5,-span*.65,span*1.25);key.castShadow=true;
 const extent=span*.65+2,far=span*4;
 Object.assign(key,{shadowMapWidth:2048,shadowMapHeight:2048,shadowCameraLeft:-extent,shadowCameraRight:extent,shadowCameraTop:extent,shadowCameraBottom:-extent,shadowCameraNear:.1,shadowCameraFar:far,shadowBias:-.00015,shadowDarkness:.28});
 if(key.shadow){key.shadow.mapSize?.set(2048,2048);if(key.shadow.camera){Object.assign(key.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:.1,far});key.shadow.camera.updateProjectionMatrix?.();}key.shadow.bias=-.00015;key.shadow.radius=3;}
 scene.add(key);
 const fill=new THREE.DirectionalLight(0xddeaff,.12);fill.position.set(-span*.65,span*.55,span*.65);scene.add(fill);
 return {key,span};
}

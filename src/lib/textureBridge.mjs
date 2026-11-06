// THREE r71 does not increment Texture.version. Track our async canvas edits
// explicitly, while preserving modern Texture.version-based updates.
export function textureSourceStamp(source){return `${source.version??0}:${source.userData?.ventraResourceRevision??0}`;}
export function syncTextureSource(target,source){
 const stamp=textureSourceStamp(source);
 if(target.userData.ventraSourceVersion===stamp&&target.image===source.image)return false;
 target.userData.ventraSourceVersion=stamp;target.image=source.image;
 if(source.repeat)target.repeat.copy(source.repeat);if(source.offset)target.offset.copy(source.offset);
 target.needsUpdate=true;return true;
}
export function markTextureResourceReady(texture){
 texture.userData={...texture.userData,ventraResourceRevision:(texture.userData?.ventraResourceRevision||0)+1};texture.needsUpdate=true;
}

export const textureSourceResized=(target,source)=>target.userData.ventraSourceWidth!==source.image?.width||target.userData.ventraSourceHeight!==source.image?.height;

// Raw textile pixels must remain a DataTexture across the r71 → modern bridge.
// A generic Texture cannot upload an {data,width,height} source as a DOM image.
export function bridgeTextureSource(THREE,source){
 const image=source.image;
 const next=ArrayBuffer.isView(image?.data)?new THREE.DataTexture(image.data,image.width,image.height,THREE.RGBAFormat):new THREE.Texture(image);
 next.flipY=source.flipY;next.generateMipmaps=source.generateMipmaps;
 next.minFilter=source.minFilter;next.magFilter=source.magFilter;
 return next;
}

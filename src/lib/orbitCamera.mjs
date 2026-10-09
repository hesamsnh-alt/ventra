export function orbitOffset(offset, yaw, pitch = 0) {
 const radius = Math.max(0.0001, Math.hypot(offset.x,offset.y,offset.z));
 const theta = Math.atan2(offset.x,offset.y) + yaw;
 const phi = Math.max(0.03,Math.min(Math.PI-0.03,Math.acos(Math.max(-1,Math.min(1,offset.z/radius)))+pitch));
 return {x:radius*Math.sin(phi)*Math.sin(theta),y:radius*Math.sin(phi)*Math.cos(theta),z:radius*Math.cos(phi)};
}
export function cameraFitDistance(size, fovDegrees, aspect) {
 const radius = Math.hypot(size.x,size.y,size.z)/2;
 const vertical = fovDegrees*Math.PI/360;
 const horizontal = Math.atan(Math.tan(vertical)*Math.max(0.01,aspect));
 return Math.max(0.1,radius/Math.sin(Math.min(vertical,horizontal))*1.12);
}
export function namedCameraOffset(view, distance) {
 const d=distance;
 return {front:{x:0,y:-d,z:0},back:{x:0,y:d,z:0},left:{x:-d,y:0,z:0},right:{x:d,y:0,z:0},top:{x:0,y:0,z:d},bottom:{x:0,y:0,z:-d},iso:{x:d/Math.sqrt(3),y:-d/Math.sqrt(3),z:d/Math.sqrt(3)}}[view]||{x:d/Math.sqrt(3),y:-d/Math.sqrt(3),z:d/Math.sqrt(3)};
}

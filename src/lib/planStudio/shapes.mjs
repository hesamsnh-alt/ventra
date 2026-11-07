import {point,dist,validPolygon,TAU} from './geometry.mjs';
export function triangleShape(points){
 if(points.length!==3||points.some(p=>!point(p))||!validPolygon(points))throw Error('Choose three distinct, non-collinear triangle points. / سه نقطهٔ متفاوت و غیرهم‌خط انتخاب کن.');
 return{type:'polyline',points:points.map(p=>({...p})),closed:true,role:'line'};
}
export function regularPolygonShape(center,vertex,sides=6){
 if(!Number.isInteger(sides)||sides<3||sides>24)throw Error('Polygon sides must be an integer from 3 to 24. / تعداد ضلع باید عدد صحیح بین ۳ تا ۲۴ باشد.');
 if(!point(center)||!point(vertex)||dist(center,vertex)<.0001)throw Error('Specify a positive polygon radius. / شعاع چندضلعی باید مثبت باشد.');
 const radius=dist(center,vertex),angle=Math.atan2(vertex.y-center.y,vertex.x-center.x),points=Array.from({length:sides},(_,i)=>({x:center.x+radius*Math.cos(angle+TAU*i/sides),y:center.y+radius*Math.sin(angle+TAU*i/sides)}));
 if(points.some(p=>!point(p)))throw Error('Polygon is outside the drawing range.');
 return{type:'polyline',points,closed:true,role:'line'};
}

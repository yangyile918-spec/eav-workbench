import * as T from './vendor--three.module.js';
import {syncVoxelCloud,disposeVoxelCloud} from './voxel-cloud.js';

const matrix=t=>new T.Matrix4().compose(new T.Vector3(...t.p),new T.Quaternion(...t.q),new T.Vector3(1,1,1));
function cloudMaterial(layer){
 if(!['height','contour','fine'].includes(layer.appearance))return new T.PointsMaterial({color:layer.color,size:2,sizeAttenuation:false,transparent:true,opacity:.75,depthWrite:false});
 const contour=layer.appearance==='contour',fine=layer.appearance==='fine';
 return new T.ShaderMaterial({transparent:true,depthWrite:contour,uniforms:{low:{value:0},high:{value:1},alpha:{value:1},diameter:{value:layer.pointDiameter??.22},pixels:{value:2},viewport:{value:800},contour:{value:contour?1:0},fine:{value:fine?1:0},relief:{value:0},pixelRatio:{value:1},colorMode:{value:0},solid:{value:new T.Color('#c0cfff')},palette:{value:['#537bff','#9b6bfa','#ed7fb3','#ffae60','#fff3aa'].map(c=>new T.Color(c))}},
  vertexShader:`
   uniform float low,high,diameter,pixels,viewport,contour,fine,colorMode,relief,pixelRatio;
   uniform vec3 solid;uniform vec3 palette[5];varying vec3 tint;varying float eyeDepth;
   void main(){
    vec4 world=modelMatrix*vec4(position,1.0);vec4 eye=viewMatrix*world;eyeDepth=max(0.,-eye.z);
    float h=clamp((world.y-low)/max(high-low,0.1),0.0,1.0);float band=h*4.;
    tint=band<1.?mix(palette[0],palette[1],band):band<2.?mix(palette[1],palette[2],band-1.):band<3.?mix(palette[2],palette[3],band-2.):mix(palette[3],palette[4],band-3.);
    if(colorMode>.5)tint=solid;gl_Position=projectionMatrix*eye;
    float projected=diameter*viewport*.5*projectionMatrix[1][1]/max(.1,-eye.z);
    // Small opaque splats preserve gaps and foreground occlusion; no invented surfaces.
    gl_PointSize=relief>.5?clamp(projected,.85*pixelRatio,max(1.4,pixels*2.8)*pixelRatio):contour>.5?clamp(projected,1.,30.):clamp(pixels*(fine>.5?1.:1.5),.7,18.);
   }`,
  fragmentShader:`
   uniform float alpha,contour,fine,relief;varying vec3 tint;varying float eyeDepth;
   void main(){
    vec2 p=gl_PointCoord*2.-1.;float r=dot(p,p);if(r>1.)discard;
    float shade=contour>.5?.48+.52*sqrt(max(0.,1.-r)):1.;
    if(relief>.5){
     vec3 normal=vec3(p.x,-p.y,sqrt(max(0.,1.-r)));
     shade=.44+.56*max(0.,dot(normal,normalize(vec3(-.45,.65,1.))));
     // Bounded depth shading keeps distant sparse returns visible.
     shade*=.48+.52*exp(-eyeDepth/90.);
    }
    gl_FragColor=vec4(tint*shade,relief>.5?1.:contour>.5?max(.9,alpha):(fine>.5?max(.85,alpha):alpha));
    #include <colorspace_fragment>
   }`});
}
export function applyCloudStyle(item,layer){
 if(item.userData.appearance!==layer.appearance){item.material.dispose();item.material=cloudMaterial(layer);item.userData.appearance=layer.appearance;}
 const u=item.material.uniforms;
 if(u){const relief=layer.colorMode==='relief';u.relief.value=relief?1:0;item.material.depthWrite=relief||layer.appearance==='contour';u.alpha.value=(layer.opacity??1)*.95;u.diameter.value=layer.pointDiameter??.22;u.pixels.value=layer.pointPixels??2;u.colorMode.value=layer.colorMode==='solid'?1:0;u.solid.value.set(layer.solidColor||layer.color||'#c0cfff');
  if(layer.colorMode==='custom'){const lo=new T.Color(layer.gradientLow),hi=new T.Color(layer.gradientHigh);u.palette.value.forEach((c,i)=>c.copy(lo).lerp(hi,i/4));}
  else if(layer.palette)u.palette.value.forEach((c,i)=>c.set(layer.palette[i]));
 }else{item.material.opacity=(layer.opacity??1)*.8;item.material.size=layer.pointPixels??2;item.material.color.set(layer.solidColor||layer.color||'#c0cfff');}
}
// Raw sensor -> recorded world -> recorded map -> DAT display coordinates.
export function fusionMatrix(layer,origin,axes='ENU'){
 if(!layer.transform||!layer.worldToMap)return null;
 const mapToDisplay=axes==='ENU'?new T.Matrix4().set(1,0,0,-origin[1],0,0,1,0,0,-1,0,origin[0],0,0,0,1):new T.Matrix4().set(0,1,0,-origin[1],0,0,1,0,-1,0,0,origin[0],0,0,0,1);
 return mapToDisplay.multiply(matrix(layer.worldToMap)).multiply(matrix(layer.transform));
}
export class FusionOverlay{
 constructor(scene){this.scene=scene;this.group=new T.Group();this.group.name='Synchronized radar';scene.add(this.group);this.items=new Map();}
 update(layers,origin,axes){
  const keep=new Set();let points=0;
  for(const layer of layers){const transform=fusionMatrix(layer,origin,axes);if(!transform)continue;keep.add(layer.id);let item=this.items.get(layer.id);
   if(!item){const a=layer.points.positions||new Float32Array(layer.points.flat());const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(a,3));g.computeBoundingBox();g.computeBoundingSphere();item=new T.Points(g,cloudMaterial(layer));item.userData.appearance=layer.appearance;item.matrixAutoUpdate=false;const size=new T.Vector2();item.onBeforeRender=renderer=>{if(item.material.uniforms?.viewport){item.material.uniforms.viewport.value=renderer.getDrawingBufferSize(size).y;item.material.uniforms.pixelRatio.value=renderer.getPixelRatio?.()||1;}};this.group.add(item);this.items.set(layer.id,item);}
   applyCloudStyle(item,layer);syncVoxelCloud(item,layer);
   if(!item.userData.heights||!item.matrix.equals(transform)){const a=item.geometry.attributes.position,heights=[];const p=new T.Vector3();for(let i=0;i<a.count;i+=Math.max(1,Math.ceil(a.count/96)))heights.push(p.fromBufferAttribute(a,i).applyMatrix4(transform).y);item.userData.heights=heights;}
   item.matrix.copy(transform);item.matrixWorldNeedsUpdate=true;points+=layer.points.length;
  }
  for(const [id,item] of this.items)if(!keep.has(id)){this.group.remove(item);disposeVoxelCloud(item);item.geometry.dispose();item.material.dispose();this.items.delete(id);}
  const heightKey=[...this.items.values()].map(i=>i.userData.heights);if(!this.heightKey||heightKey.length!==this.heightKey.length||heightKey.some((h,i)=>h!==this.heightKey[i])){this.heightKey=heightKey;const h=heightKey.flat().filter(Number.isFinite).sort((a,b)=>a-b);const trim=h.length<20?0:Math.floor(h.length*.02);this.heightRange=h.length?[h[trim],h[h.length-1-trim]]:[0,1];}
  for(const item of this.items.values())if(item.material.uniforms){item.material.uniforms.low.value=this.heightRange[0];item.material.uniforms.high.value=Math.max(this.heightRange[1],this.heightRange[0]+.1);}
  return points;
 }
 bounds(){const bounds=new T.Box3();for(const item of this.items.values())if(item.geometry.boundingBox)bounds.union(item.geometry.boundingBox.clone().applyMatrix4(item.matrix));return bounds;}
 inspectionBounds(center){
  // Bounded sampling only frames the camera. Every measured point remains rendered.
  const samples=[[],[],[]],p=new T.Vector3();
  for(const item of this.items.values()){
   const a=item.geometry.attributes.position;
   for(let i=0;i<a.count;i+=Math.max(1,Math.ceil(a.count/128))){
    p.fromBufferAttribute(a,i).applyMatrix4(item.matrix);
    if(![p.x,p.y,p.z].every(Number.isFinite)||center&&Math.hypot(p.x-center.x,p.z-center.z)>25)continue;
    samples[0].push(p.x);samples[1].push(p.y);samples[2].push(p.z);
   }
  }
  if(samples[0].length<12)return this.bounds();
  for(const axis of samples)axis.sort((a,b)=>a-b);
  const trim=Math.floor(samples[0].length*.03);
  return new T.Box3(new T.Vector3(...samples.map(a=>a[trim])),new T.Vector3(...samples.map(a=>a[a.length-1-trim])));
 }
 clear(){this.update([],[],null);}
}

export function frameCloudInspection(camera,controls,overlay,center){
 const bounds=overlay?.inspectionBounds(center);if(!bounds||bounds.isEmpty())return false;
 const target=bounds.getCenter(new T.Vector3());
 const vf=T.MathUtils.degToRad(camera.fov),hf=2*Math.atan(Math.tan(vf/2)*camera.aspect);
 const direction=camera.position.clone().sub(controls.target);direction.y=0;
 if(direction.lengthSq()<.001)direction.set(1,0,1);
 direction.normalize();direction.y=.48;direction.normalize();
 const right=new T.Vector3().crossVectors(new T.Vector3(0,1,0),direction).normalize(),up=new T.Vector3().crossVectors(direction,right),delta=new T.Vector3();
 let distance=4;
 // Fit the box in camera axes rather than a sphere: long rows of obstacles should
 // fill a wide window instead of shrinking into a thin strip when maximized.
 for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z]){
  delta.set(x,y,z).sub(target);const depth=delta.dot(direction);
  distance=Math.max(distance,depth+Math.abs(delta.dot(right))/Math.tan(hf/2)*1.12,depth+Math.abs(delta.dot(up))/Math.tan(vf/2)*1.12);
 }
 controls.maxDistance=Math.max(controls.maxDistance||0,distance*2);controls.target.copy(target);camera.position.copy(target).addScaledVector(direction,distance);controls.update();return true;
}

import * as T from './vendor--three.module.js';

// A display grid in DAT display coordinates. Scan rotation must not rotate the
// cubes: transform each measured centre first, then place the world-aligned box.
export const HOME_VOXEL_SIZE=.16;
// Keep display blocks inside their occupied cells so increasing size cannot
// bridge an otherwise unmeasured gap between terrain and a recorded wire.
export const blockFill=scale=>Math.max(.25,Math.min(.96,.8*scale));
export const blockSurfaceGLSL=`
 float blockSurfaceShade(vec3 p,vec3 n){
  vec3 a=abs(n);vec2 face=a.x>.5?p.yz:a.y>.5?p.xz:p.xy;
  float rim=smoothstep(.42,.5,max(abs(face.x),abs(face.y)));
  float light=.32+.68*max(0.,dot(n,normalize(vec3(-.45,.85,.55))));
  return light*mix(1.,.6,rim);
 }`;
export function syncVoxelCloud(item,layer){
 const enabled=layer.pointShape==='blocks'&&!!item.material.uniforms;
 let mesh=item.userData.voxelCloud;
 if(enabled&&!mesh){
  const box=new T.BoxGeometry(1,1,1),geometry=new T.InstancedBufferGeometry();
  geometry.index=box.index;geometry.setAttribute('position',box.getAttribute('position'));geometry.setAttribute('normal',box.getAttribute('normal'));
  const points=item.geometry.getAttribute('position');geometry.instanceCount=Math.min(points.count,item.geometry.drawRange.count);
  geometry.setAttribute('offset',new T.InstancedBufferAttribute(points.array,3));
  const vertex=item.material.vertexShader
   .replace('uniform float low,high','attribute vec3 offset;uniform float voxelSize,blockSize;varying vec3 faceNormal,facePosition;uniform float low,high')
   .replace('vec4 world=modelMatrix*vec4(position,1.0);vec4 eye=viewMatrix*world;',
    'vec4 world=modelMatrix*vec4(offset,1.0);world.xyz=(floor(world.xyz/voxelSize)+.5)*voxelSize;vec4 eye=viewMatrix*vec4(world.xyz+position*blockSize,1.);faceNormal=normal;facePosition=position;');
  const material=new T.ShaderMaterial({depthWrite:true,uniforms:{voxelSize:{value:HOME_VOXEL_SIZE},blockSize:{value:HOME_VOXEL_SIZE*.94}},vertexShader:vertex,
   fragmentShader:`varying vec3 tint,faceNormal,facePosition;varying float eyeDepth;
    ${blockSurfaceGLSL}
    void main(){float light=blockSurfaceShade(facePosition,faceNormal);
     gl_FragColor=vec4(tint*light*(.75+.25*exp(-eyeDepth/150.)),1.);
     #include <colorspace_fragment>
    }`});
  mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;item.add(mesh);item.userData.voxelCloud=mesh;
 }
 // Hiding the Points object would also hide its cube child. Only hide its material.
 item.material.visible=!enabled;
 if(mesh){mesh.visible=enabled;if(enabled){
  Object.assign(mesh.material.uniforms,item.material.uniforms);
  mesh.material.uniforms.blockSize.value=HOME_VOXEL_SIZE*blockFill((layer.pointPixels??1.6)/1.6);
 }}
}
export function disposeVoxelCloud(item){
 const mesh=item.userData.voxelCloud;if(!mesh)return;
 item.remove(mesh);mesh.geometry.dispose();mesh.material.dispose();delete item.userData.voxelCloud;
}

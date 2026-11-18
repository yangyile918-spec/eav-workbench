import * as T from './vendor--three.module.js';

// Screen-space width improves legibility without moving or extending measured endpoints.
export function wireSegments(row){
 const starts=[],ends=[];
 for(let i=0;i+1<row.points.length;i+=row.type===5?2:1){const a=row.points[i],b=row.points[i+1];if(a.every((v,j)=>v===b[j]))continue;starts.push(...a);ends.push(...b);}
 return {starts,ends};
}
export function makeWire(row){
 const {starts,ends}=wireSegments(row),geometry=new T.InstancedBufferGeometry();
 geometry.setAttribute('position',new T.Float32BufferAttribute([0,-1,0,1,-1,0,0,1,0,1,1,0],3));
 geometry.setIndex([0,1,2,2,1,3]);geometry.setAttribute('start',new T.InstancedBufferAttribute(new Float32Array(starts),3));geometry.setAttribute('end',new T.InstancedBufferAttribute(new Float32Array(ends),3));geometry.instanceCount=starts.length/3;
 const bounds=new T.Box3();for(let i=0;i<starts.length;i+=3){bounds.expandByPoint(new T.Vector3(...starts.slice(i,i+3)));bounds.expandByPoint(new T.Vector3(...ends.slice(i,i+3)));}geometry.boundingBox=bounds;geometry.boundingSphere=bounds.getBoundingSphere(new T.Sphere());
 const material=new T.ShaderMaterial({transparent:true,depthTest:true,depthWrite:false,toneMapped:false,side:T.DoubleSide,
  uniforms:{viewport:{value:new T.Vector2(1,1)},width:{value:9},near:{value:.05}},
  vertexShader:`attribute vec3 start;attribute vec3 end;uniform vec2 viewport;uniform float width;uniform float near;varying float edge;varying float valid;
  void main(){vec4 a=modelViewMatrix*vec4(start,1.);vec4 b=modelViewMatrix*vec4(end,1.);valid=1.;float plane=-near*1.01;
   if(a.z>plane&&b.z>plane){valid=0.;gl_Position=vec4(2.,2.,2.,1.);edge=0.;return;}
   if(a.z>plane)a=mix(a,b,(plane-a.z)/(b.z-a.z));
   if(b.z>plane)b=mix(b,a,(plane-b.z)/(a.z-b.z));
   vec4 ca=projectionMatrix*a;vec4 cb=projectionMatrix*b;
   vec2 direction=(cb.xy/cb.w-ca.xy/ca.w)*viewport;float len=length(direction);
   vec2 normal=len>.001?vec2(-direction.y,direction.x)/len:vec2(0.,1.);
   vec4 clip=mix(ca,cb,position.x);clip.xy+=normal*position.y*width/viewport*clip.w;
   edge=position.y;gl_Position=clip;
  }`,
  fragmentShader:`varying float edge;varying float valid;void main(){if(valid<.5)discard;float r=abs(edge);float border=smoothstep(.55,.72,r);vec3 core=mix(vec3(1.,.80,.09),vec3(1.,.98,.62),1.-smoothstep(.0,.28,r));vec3 color=mix(core,vec3(.015,.035,.055),border);gl_FragColor=vec4(color,1.-smoothstep(.84,1.,r));}`});
 const mesh=new T.Mesh(geometry,material);mesh.frustumCulled=false;mesh.renderOrder=4;mesh.userData.recordedWire=true;
 const size=new T.Vector2();mesh.onBeforeRender=(renderer,scene,camera)=>{renderer.getDrawingBufferSize(size);material.uniforms.viewport.value.copy(size);material.uniforms.width.value=(mesh.userData.displayWidth??9)*renderer.getPixelRatio();material.uniforms.near.value=camera.near;};
 return mesh;
}

export function sizeWireLabel(sprite,renderer,camera){
 const size=renderer.getSize(new T.Vector2()),height=58;
 const unit=camera.isPerspectiveCamera?2*Math.tan(T.MathUtils.degToRad(camera.fov)/2)/Math.max(1,size.y):(camera.top-camera.bottom)/camera.zoom/Math.max(1,size.y);
 sprite.scale.set(unit*184,unit*height,1);sprite.updateMatrix();sprite.updateMatrixWorld(true);
}

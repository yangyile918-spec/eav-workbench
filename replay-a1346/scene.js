import {GroundReference,followGroundGrid,frameGroundHeight} from './ground-reference.js';
import {rotorPhases,rotorPhase} from './rotor-time.js';
import * as T from './vendor--three.module.js';
import {OrbitControls} from './vendor--OrbitControls.js';
import {createAircraft,aircraftModel} from './aircraft.js';
import {finite,worldPosition,interpolate} from './math.js';
import {FusionOverlay,frameCloudInspection} from './fusion-overlay.js';
import {MemoryOverlay} from './memory-overlay.js';

export class ReplayScene{
 constructor(host,options={}){
  this.options=options;
  this.host=host;this.data=null;this.view='preview';this.needsRender=true;this.current=new T.Vector3();this.lastPosition=new T.Vector3();this.origin=[0,0];this.trackObjects=[];this.groundObjects=[];this.rpms=[0,0,0,0];this.labels=[];
  this.renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true});
  this.renderer.setPixelRatio(Math.min(devicePixelRatio,options.inspection?2:1.5));this.renderer.setClearColor(options.inspection?0xe8edf3:0x081625);this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=options.inspection?1:1.4;
  host.append(this.renderer.domElement);this.scene=new T.Scene();this.scene.fog=new T.FogExp2(0x081625,.007);
  this.camera=new T.PerspectiveCamera(42,1,.05,20000);this.camera.position.set(5.2,3.4,6.2);
  this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.minDistance=1.8;this.controls.maxDistance=5000;this.controls.maxPolarAngle=Math.PI*.88;this.controls.target.set(0,0,0);
  this.controls.addEventListener('change',()=>{this.needsRender=true;});
  this.controls.addEventListener('start',()=>{this.interacting=true;});this.controls.addEventListener('end',()=>{this.interacting=false;this.resumePreview=performance.now()+8000;});
  this.scene.add(new T.HemisphereLight(0xd6edff,0x183141,3.2));const sun=new T.DirectionalLight(0xf0f8ff,4.1);sun.position.set(5,10,5);this.scene.add(sun);
  const rim=new T.DirectionalLight(0x52ecff,2.2);rim.position.set(-5,2,-6);this.scene.add(rim);
  const fill=new T.DirectionalLight(0x628fff,1.3);fill.position.set(1,1,6);this.scene.add(fill);
  if(options.inspection){this.scene.fog=null;this.scene.children.filter(o=>o.isLight).forEach(o=>this.scene.remove(o));this.scene.add(new T.HemisphereLight(0xffffff,0x8893a2,2.6));for(const [x,y,z,intensity]of [[-3,6,-4,3],[4,2,3,1.8]]){const light=new T.DirectionalLight(0xffffff,intensity);light.position.set(x,y,z);this.scene.add(light);}}
  this.setAircraft(options.model||'J160');
  this.groundReference=new GroundReference(this.scene,host);this.shadowMarker=this.groundReference.marker;this.heightLine=this.groundReference.line;
  this.makeGrid(60);this.makeNorth();this.makePlatform();
  if(options.inspection){this.groundObjects.forEach(o=>o.visible=false);this.north.visible=false;this.platform.visible=false;this.groundReference.setVisible(false);}
  const parent=options.secondary?document.createElement('div'):document.getElementById('motorLabels');['#0 右前','#1 左后','#2 左前','#3 右后'].forEach(label=>{const e=document.createElement('span');e.className='motor-label';e.textContent=label;e.hidden=true;parent.append(e);this.labels.push(e);});
  new ResizeObserver(()=>this.resize()).observe(host);globalThis.addEventListener?.('resize',()=>this.resize());this.resize();this.tick(0);
 }
 setAircraft(model){
  model=aircraftModel(model);
  if(this.aircraft?.model===model&&!this.modelError)return this.aircraft.ready;
  const old=this.aircraft,aircraft=createAircraft(model);this.aircraft=aircraft;this.modelError=null;
  if(old){aircraft.root.position.copy(old.root.position);aircraft.root.quaternion.copy(old.root.quaternion);aircraft.root.visible=old.root.visible;this.scene.remove(old.root);old.dispose();}
  this.scene.add(aircraft.root);this.labels.forEach(label=>label.hidden=true);this.needsRender=true;
  const status=this.options.secondary?null:document.getElementById('modelStatus');
  if(status){status.hidden=false;status.classList.remove('error');status.title='';status.textContent=`正在载入 ${model} 三维模型…`;}
  aircraft.ready.then(()=>{
   if(this.aircraft!==aircraft)return;
   if(status)status.hidden=true;
   this.controls.minDistance=Math.max(.6,aircraft.size.length()*.2);
   if(this.lastFrame)this.update(this.lastFrame,this.lastAlerts);
   this.setView(this.data?this.view:'preview');
  }).catch(error=>{
   if(this.aircraft!==aircraft)return;this.modelError=error.message;
   if(status){status.hidden=false;status.classList.add('error');status.textContent=`${model} 模型载入失败，请完整解压软件后刷新页面。`;status.title=error.message;}
  });
  return aircraft.ready;
 }
 resize(){const w=this.host.clientWidth,h=this.host.clientHeight,ratio=Math.min(globalThis.devicePixelRatio||1,this.options.inspection?2:1.5);if(!w||!h)return;const dpiChanged=this.pixelRatio!==ratio;if(dpiChanged){this.pixelRatio=ratio;this.renderer.setPixelRatio(ratio);}if(!dpiChanged&&this.renderWidth===w&&this.renderHeight===h)return;this.renderWidth=w;this.renderHeight=h;this.camera.aspect=w/h;this.camera.updateProjectionMatrix();this.renderer.setSize(w,h,false);this.needsRender=true;if(this.view==='cloud')this.fitRadar();else if(this.view==='obstacles')this.inspectRadar();else if(['preview','follow','close','environment','heading','height'].includes(this.view))this.setView(this.view);}
 makePlatform(){
  this.platform=new T.Group();this.scene.add(this.platform);
  for(const [radius,opacity]of [[2.35,.45],[2.5,.18],[3.15,.1]]){const ring=new T.Mesh(new T.RingGeometry(radius,radius+.012,96),new T.MeshBasicMaterial({color:0x48dff0,transparent:true,opacity,side:T.DoubleSide,depthWrite:false}));ring.rotation.x=-Math.PI/2;ring.position.y=.012;this.platform.add(ring);}
  const ticks=[];for(let i=0;i<72;i++){const a=i*Math.PI/36,r=i%6===0?2.72:2.58;ticks.push(new T.Vector3(Math.sin(a)*2.5,.015,Math.cos(a)*2.5),new T.Vector3(Math.sin(a)*r,.015,Math.cos(a)*r));}this.platform.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(ticks),new T.LineBasicMaterial({color:0x3ab6cf,transparent:true,opacity:.35})));
 }
 makeGrid(size){
  for(const o of this.groundObjects){this.scene.remove(o);o.geometry.dispose();o.material.dispose();}this.groundObjects=[];
  const gridSize=Math.max(30,Math.ceil(size/10)*10),divisions=Math.min(100,Math.ceil(gridSize/2));
  const grid=new T.GridHelper(gridSize,divisions,0x3b6574,0x234353);grid.userData.cellSize=gridSize/divisions;grid.material.transparent=true;grid.material.opacity=.45;grid.visible=this.displayFlags?.grid!==false;this.scene.add(grid);this.groundObjects.push(grid);
 }
 makeNorth(){const arrow=new T.ArrowHelper(new T.Vector3(0,0,-1),new T.Vector3(-4,0,3),2.5,0x4ee5c1,.4,.23);this.scene.add(arrow);this.north=arrow;}
 position(index){const s=this.data.series;return worldPosition(s.Fc_local_position_x?.[index],s.Fc_local_position_y?.[index],s.Fc_local_position_z?.[index],...this.origin);}
 load(data,segment){
  this.clearRadar();this.radarFraming=false;
  this.clearOverlay('planner');this.clearOverlay('obstacles');
  this.labels.forEach((label,i)=>{label.textContent=data.model==='J100'?`#${i} 通道（示意）`:['#0 右前','#1 左后','#2 左前','#3 右后'][i];});
  this.data=data;this.segment=segment;this.lastFrame=null;this.setAircraft(data.model);this.spinPhases=rotorPhases(data,segment);
  const s=data.series;this.origin=[s.Fc_local_position_x?.[segment.start_index]??0,s.Fc_local_position_y?.[segment.start_index]??0];
  for(const obj of this.trackObjects){this.scene.remove(obj);obj.geometry.dispose();obj.material.dispose();}this.trackObjects=[];
  const gaps=new Set(segment.gaps_after),coordinates=new Float32Array(segment.count*3),groups=[];let runStart=-1,minX=Infinity,minY=Infinity,minZ=Infinity,maxX=-Infinity,maxY=-Infinity,maxZ=-Infinity,pointCount=0;
  const closeRun=end=>{if(runStart>=0&&end-runStart>=2)groups.push([runStart,end]);runStart=-1;};
  for(let i=segment.start_index;i<=segment.end_index;i++){
   const local=i-segment.start_index,n=s.Fc_local_position_x?.[i],e=s.Fc_local_position_y?.[i],d=s.Fc_local_position_z?.[i];
   if(finite(n)&&finite(e)&&finite(d)){
    const x=e-this.origin[1],y=-d,z=-(n-this.origin[0]),offset=local*3;coordinates[offset]=x;coordinates[offset+1]=y;coordinates[offset+2]=z;
    minX=Math.min(minX,x);minY=Math.min(minY,y);minZ=Math.min(minZ,z);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);maxZ=Math.max(maxZ,z);pointCount++;if(runStart<0)runStart=local;
   }else closeRun(local);
   if(gaps.has(i))closeRun(local+1);
  }closeRun(segment.count);
  this.bounds=new T.Box3();if(pointCount){this.bounds.min.set(minX,minY,minZ);this.bounds.max.set(maxX,maxY,maxZ);}else this.bounds.setFromCenterAndSize(new T.Vector3(),new T.Vector3(10,10,10));
  const center=this.bounds.getCenter(new T.Vector3()),extent=this.bounds.getSize(new T.Vector3());this.extent=Math.max(extent.x,extent.z,extent.y,10);this.trackCenter=center;
  for(const [start,end]of groups){const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(coordinates.subarray(start*3,end*3),3));const line=new T.Line(geometry,new T.LineBasicMaterial({color:0x4ee5c1,transparent:true,opacity:.65}));this.scene.add(line);this.trackObjects.push(line);}
  let first;for(let i=segment.start_index;i<=segment.end_index;i++){if(['Fc_local_position_x','Fc_local_position_y','Fc_local_position_z'].every(k=>finite(s[k]?.[i]))){first=i;break;}}this.groundReference.reset(first===undefined?null:-s.Fc_local_position_z[first]);
  this.showTracks(this.displayFlags?.tracks!==false);this.makeGrid(Math.max(this.extent*2.7,40));followGroundGrid(this.groundObjects[0],center,this.groundReference.baseline??0);this.north.position.set(center.x-this.extent*.6,0,center.z+this.extent*.5);
  this.scene.fog.density=Math.min(.007,1/(this.extent*6));this.controls.maxDistance=Math.max(500,this.extent*8);
  this.platform.visible=false;this.setView('follow');
 }
 setView(view){
  this.view=view;this.aircraft.root.updateMatrixWorld(true);const p=this.aircraft.bounds?this.aircraft.root.localToWorld(this.aircraft.bounds.getCenter(new T.Vector3())):this.current.clone();
  if(this.options.inspection&&this.aircraft.bounds){
   const direction=new T.Vector3(-1,.85,-1.2).normalize(),box=this.aircraft.bounds;
   this.camera.position.copy(p).add(direction);this.camera.lookAt(p);
   const inverse=this.camera.quaternion.clone().invert(),tanV=Math.tan(T.MathUtils.degToRad(this.camera.fov)/2),tanH=tanV*this.camera.aspect;let distance=0;
   const c=new T.Vector3();this.aircraft.root.children[0].traverse(o=>{if(!o.isMesh)return;const positions=o.geometry.attributes.position;for(let i=0;i<positions.count;i++){c.fromBufferAttribute(positions,i).applyMatrix4(o.matrixWorld).sub(p).applyQuaternion(inverse);distance=Math.max(distance,c.z+Math.max(Math.abs(c.x)/tanH,Math.abs(c.y)/tanV)/.86);}});
   this.controls.target.copy(p);this.camera.position.copy(p).addScaledVector(direction,distance);
  }else if(view==='height'&&frameGroundHeight(this.camera,this.controls,this.current,this.groundReference.baseline)){
  }else if(view==='heading'){this.headingCamera();
  }else if(view==='overview'){
   const c=this.trackCenter||p,k=this.extent||12;this.controls.target.copy(c);this.camera.position.copy(c).add(new T.Vector3(k*.8,k*.75,k*.95));
  }else if(view==='top'){
   const c=this.trackCenter||p,k=this.extent||12;this.controls.target.copy(c);this.camera.position.copy(c).add(new T.Vector3(.001,k*1.6,.001));
  }else if(view==='side'){
   const c=this.trackCenter||p,k=this.extent||12;this.controls.target.copy(c);this.camera.position.copy(c).add(new T.Vector3(k*1.7,k*.15,0));
  }else{
   const radius=this.aircraft.size?.length()/2||2.4;
   const vFov=T.MathUtils.degToRad(this.camera.fov),hFov=2*Math.atan(Math.tan(vFov/2)*this.camera.aspect);
   const distance=radius/Math.sin(Math.min(vFov,hFov)/2)*(view==='environment'?3.2:view==='follow'?1.18:1.04);
   this.controls.target.copy(p);this.camera.position.copy(p).add(new T.Vector3(1,.65,-1.2).normalize().multiplyScalar(distance));
  }
  this.controls.update();this.needsRender=true;
 }
 headingCamera(){const center=this.aircraft.root.position,q=this.aircraft.root.quaternion;this.camera.position.copy(center).add(new T.Vector3(0,1.2,3.5).applyQuaternion(q));this.controls.target.copy(center).add(new T.Vector3(0,0,-18).applyQuaternion(q));}
 update(frame,motorAlerts=[]){
  if(!this.data)return;this.needsRender=true;this.lastFrame=frame;this.lastAlerts=motorAlerts;const s=this.data.series,{index:i,next:j,alpha:a}=frame;
  const p0=this.position(i),p1=this.position(j),p=p0.map((v,k)=>interpolate(v,p1[k],a));
  this.aircraft.root.visible=p.every(finite)&&this.displayFlags?.aircraft!==false;
  if(p.every(finite)){
   this.lastPosition.copy(this.current);this.current.set(...p);this.aircraft.root.position.copy(this.current);
   if(this.view==='follow'||this.view==='close'||this.view==='environment'){const delta=new T.Vector3().subVectors(this.current,this.lastPosition);this.camera.position.add(delta);this.controls.target.add(delta);}
   followGroundGrid(this.groundObjects[0],this.current,this.groundReference.baseline??0);
   this.groundReference.update(this.current);this.groundReference.setVisible(this.displayFlags?.guides!==false);
   if(this.view==='height'&&!this.interacting)frameGroundHeight(this.camera,this.controls,this.current,this.groundReference.baseline);
  }else{this.groundReference.update(null);}
  const angle=k=>s[k]?.[i],angles=['Fc_attitude_pitch','Fc_attitude_yaw','Fc_attitude_roll'];
  if(angles.every(k=>finite(s[k]?.[i]))){
   const q0=new T.Quaternion().setFromEuler(new T.Euler(T.MathUtils.degToRad(angle(angles[0])),-T.MathUtils.degToRad(angle(angles[1])),-T.MathUtils.degToRad(angle(angles[2])),'YXZ'));
   const q1=new T.Quaternion().setFromEuler(new T.Euler(T.MathUtils.degToRad(s[angles[0]]?.[j]??angle(angles[0])),-T.MathUtils.degToRad(s[angles[1]]?.[j]??angle(angles[1])),-T.MathUtils.degToRad(s[angles[2]]?.[j]??angle(angles[2])),'YXZ'));
   this.aircraft.root.quaternion.copy(q0.slerp(q1,a));
  }else this.aircraft.root.quaternion.identity();
  if(this.view==='heading'&&!this.interacting)this.headingCamera();
  this.rpms=Array.from({length:4},(_,k)=>s[`Fc_esc_rpm_${k}`]?.[i]??null);this.aircraft.rotors.forEach((r,k)=>{r.userData.recordBase??=r.quaternion.clone();r.quaternion.copy(r.userData.recordBase).multiply(new T.Quaternion().setFromAxisAngle(r.userData.spinAxis,(r.userData.spin_direction||1)*rotorPhase(this.spinPhases,this.data,this.segment,frame,k)));});
  this.aircraft.rings.forEach((m,k)=>{const alert=motorAlerts.includes(k);m.color.set(alert?0xff666e:0x517882);m.emissive.set(alert?0xbb152c:0x0b3b35);this.labels[k].classList.toggle('alert',alert);});
 }
 showTracks(visible){this.setDisplay('tracks',visible);}
 setDisplay(key,visible){
  this.displayFlags??={};this.displayFlags[key]=!!visible;
  if(key==='tracks'){this.trackVisible=!!visible;this.trackObjects.forEach(o=>o.visible=!!visible);const input=document.getElementById('trajectoryToggle');if(input)input.checked=!!visible;}
  if(key==='planner'&&this.plannerGroup)this.plannerGroup.visible=!!visible;
  if(key==='grid')this.groundObjects.forEach(o=>o.visible=!!visible);
  if(key==='guides'){this.groundReference?.setVisible(visible);if(this.north)this.north.visible=!!visible;const valid=!!this.lastFrame&&this.current.toArray().every(finite);if(this.heightLine)this.heightLine.visible=!!visible&&valid;if(this.shadowMarker)this.shadowMarker.visible=!!visible&&valid;}
  if(key==='aircraft')this.aircraft.root.visible=!!visible&&(!this.data||!!this.lastFrame&&this.position(this.lastFrame.index).every(finite));
  if(key==='labels'){this.labelsVisible=!!visible;const input=document.getElementById('motorLabelsToggle');if(input)input.checked=!!visible;}
  this.needsRender=true;this.onDisplayChange?.(key,!!visible);
 }
 fitRadar(){const box=this.radarOverlay?.bounds();if(!box||box.isEmpty())return;this.view='cloud';const center=box.getCenter(new T.Vector3()),radius=Math.max(1,box.getSize(new T.Vector3()).length()/2),vf=T.MathUtils.degToRad(this.camera.fov),hf=2*Math.atan(Math.tan(vf/2)*this.camera.aspect),distance=radius/Math.sin(Math.min(vf,hf)/2)*1.08;this.controls.maxDistance=Math.max(this.controls.maxDistance,distance*2);this.controls.target.copy(center);this.camera.position.copy(center).add(new T.Vector3(1,.65,1).normalize().multiplyScalar(distance));this.controls.update();this.needsRender=true;}
 showRadar(layers,axes){this.homeVoxelBlocks=layers.some(l=>l.pointShape==='blocks');this.radarOverlay??=new FusionOverlay(this.scene);const count=this.radarOverlay.update(layers,this.origin,axes);if(count&&!this.radarFraming){this.radarFraming=true;if(this.view==='follow')this.setView('environment');}this.needsRender=true;return count;}
 showMemory(markers,axes){this.memoryOverlay??=new MemoryOverlay(this.scene);this.memoryOverlay.setBlockContext(!!this.homeVoxelBlocks);const count=this.memoryOverlay.update(markers,this.origin,axes);this.needsRender=true;return count;}
 inspectRadar(){if(frameCloudInspection(this.camera,this.controls,this.radarOverlay,this.current)){this.view='obstacles';this.needsRender=true;}}
 fitMemory(){const box=this.memoryOverlay?.bounds();if(!box||box.isEmpty())return;const saved=this.radarOverlay;try{this.radarOverlay={bounds:()=>box};this.fitRadar();}finally{this.radarOverlay=saved;}}
 clearRadar(){this.radarOverlay?.clear();this.memoryOverlay?.clear();if(this.data&&['cloud','obstacles'].includes(this.view))this.setView('follow');this.needsRender=true;}
 showLabels(visible){this.setDisplay('labels',visible);}
 setPlaying(playing){this.playing=!!playing;}
 clearOverlay(key){this.needsRender=true;const group=this[key+'Group'];if(!group)return;group.traverse(o=>{o.geometry?.dispose();if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material?.dispose();});this.scene.remove(group);this[key+'Group']=null;}
 clearFlightData(){this.clearRadar();this.radarFraming=false;this.clearOverlay('planner');this.clearOverlay('obstacles');for(const obj of this.trackObjects){this.scene.remove(obj);obj.geometry.dispose();obj.material.dispose();}this.trackObjects=[];this.data=null;this.segment=null;this.spinPhases=null;this.lastFrame=null;this.lastAlerts=[];this.groundReference?.reset();this.trackCenter=null;this.extent=10;this.platform.visible=true;this.aircraft.root.visible=false;this.shadowMarker.visible=false;this.heightLine.visible=false;this.makeGrid(60);this.needsRender=true;}
 overlayPosition(p,transform='ENU'){const n=transform==='ENU'?p[1]:p[0],e=transform==='ENU'?p[0]:p[1];return new T.Vector3(e-this.origin[1],p[2],-(n-this.origin[0]));}
 showPlanner(points=[],command=null,transform='ENU'){
  this.clearOverlay('planner');const group=new T.Group();group.visible=this.displayFlags?.planner!==false;this.plannerGroup=group;this.scene.add(group);
  if(points.length>1){const line=new T.Line(new T.BufferGeometry().setFromPoints(points.map(p=>this.overlayPosition(p,transform))),new T.LineBasicMaterial({color:0xffb75e}));group.add(line);}
  if(command){const mark=new T.Mesh(new T.SphereGeometry(.32,12,8),new T.MeshBasicMaterial({color:0xed8fd5}));mark.position.copy(this.overlayPosition(command,transform));group.add(mark);}
 }
 showObstacles(points=[],transform='ENU'){
  this.clearOverlay('obstacles');if(!points.length)return;
  const geometry=new T.BufferGeometry().setFromPoints(points.map(p=>this.overlayPosition(p,transform)));const material=new T.PointsMaterial({color:0x88bfff,size:.14,sizeAttenuation:true,transparent:true,opacity:.7});const group=new T.Group();group.add(new T.Points(geometry,material));this.obstaclesGroup=group;this.scene.add(group);
 }
 tick(now){
  requestAnimationFrame(t=>this.tick(t));this.previousTime=now;
  if(document.hidden||!this.host.clientWidth||!this.host.clientHeight)return;
  if(!this.data&&!this.interacting&&now>=(this.resumePreview||0)&&this.options.autoRotate!==false&&now-(this.lastPreview||0)>40){this.lastPreview=now;this.aircraft.root.position.y=-(this.aircraft.bounds?.min.y??-.2)+.05+Math.sin(now*.0006)*.025;this.aircraft.root.rotation.y+=.002;this.shadowMarker.visible=false;this.heightLine.visible=false;this.needsRender=true;}
  this.controls.update();if(!this.needsRender)return;this.needsRender=false;this.renderer.render(this.scene,this.camera);this.onRender?.();
  const compass=this.options.secondary?null:document.querySelector('.compass span');
  if(compass){const center=this.controls.target.clone().project(this.camera),north=this.controls.target.clone().add(new T.Vector3(0,0,-1)).project(this.camera);const dx=north.x-center.x,dy=north.y-center.y;if(Math.hypot(dx,dy)>1e-8)compass.style.transform=`rotate(${Math.atan2(dx,dy)}rad)`;}
  const position=new T.Vector3();this.aircraft.anchors.forEach((anchor,i)=>{anchor.getWorldPosition(position);position.project(this.camera);const show=this.labelsVisible!==false&&this.aircraft.root.visible&&position.z<1&&position.z>-1;this.labels[i].hidden=!show;if(show){this.labels[i].style.left=`${(position.x*.5+.5)*this.host.clientWidth}px`;this.labels[i].style.top=`${(-position.y*.5+.5)*this.host.clientHeight}px`;}});
 }
 screenshot(){this.renderer.render(this.scene,this.camera);const a=document.createElement('a');a.download='三维回放-'+new Date().toISOString().replace(/[:.]/g,'-')+'.png';a.href=this.renderer.domElement.toDataURL('image/png');a.click();}
}

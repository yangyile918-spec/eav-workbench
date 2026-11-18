import * as T from './vendor--three.module.js';

// Move the finite grid by whole cells: world grid lines stay stationary while
// coverage follows the aircraft. Never move the reference plane vertically.
export function followGroundGrid(grid,position,baseline=0){
 if(!grid||!position?.toArray().every(Number.isFinite)||!Number.isFinite(baseline))return;
 const step=grid.userData.cellSize||2;
 grid.position.set(Math.round(position.x/step)*step,baseline,Math.round(position.z/step)*step);
}

export function frameGroundHeight(camera,controls,position,baseline){
 if(!Number.isFinite(baseline)||!position?.toArray().every(Number.isFinite))return false;
 const center=new T.Vector3(position.x,(position.y+baseline)/2,position.z);
 const radius=Math.max(4,Math.abs(position.y-baseline)/2+2.5),vf=T.MathUtils.degToRad(camera.fov),hf=2*Math.atan(Math.tan(vf/2)*camera.aspect);
 const distance=radius/Math.sin(Math.min(vf,hf)/2)*1.1;
 controls.maxDistance=Math.max(controls.maxDistance||0,distance*2);controls.target.copy(center);
 camera.position.copy(center).add(new T.Vector3(1,.45,1).normalize().multiplyScalar(distance));controls.update();return true;
}

export class GroundReference{
 constructor(parent,host){
  this.group=new T.Group();parent.add(this.group);this.enabled=true;this.baseline=null;
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.BufferAttribute(new Float32Array(6),3));geometry.setAttribute('lineDistance',new T.BufferAttribute(new Float32Array(2),1));
  this.line=new T.Line(geometry,new T.LineDashedMaterial({color:0xffdb89,dashSize:.5,gapSize:.25,transparent:true,opacity:.9}));this.line.frustumCulled=false;
  this.marker=new T.Mesh(new T.RingGeometry(.35,.48,32),new T.MeshBasicMaterial({color:0xffdb89,side:T.DoubleSide,transparent:true,opacity:.85,depthWrite:false}));this.marker.rotation.x=-Math.PI/2;
  this.group.add(this.line,this.marker);this.group.visible=false;
  this.label=document.createElement('div');this.label.className='ground-reference-label';this.label.hidden=true;
  this.value=document.createElement('strong');const caption=document.createElement('span');caption.textContent='相对记录起点';const hint=document.createElement('small');hint.textContent='网格固定于起点高度';this.label.append(caption,this.value,hint);host.append(this.label);
  this.label.title='基准取本段第一条有效位置记录；仅表示相对起点高度，不代表实时离地距离。';
 }
 reset(baseline=null){this.baseline=Number.isFinite(baseline)?baseline:null;this.valid=false;this.group.visible=false;this.label.hidden=true;}
 update(position){
  this.valid=this.baseline!==null&&!!position?.toArray().every(Number.isFinite);
  if(this.valid){
   const height=position.y-this.baseline,p=this.line.geometry.getAttribute('position'),d=this.line.geometry.getAttribute('lineDistance');
   p.setXYZ(0,position.x,this.baseline,position.z);p.setXYZ(1,position.x,position.y,position.z);p.needsUpdate=true;d.setX(0,0);d.setX(1,Math.abs(height));d.needsUpdate=true;
   this.marker.position.set(position.x,this.baseline+.015,position.z);
   const text=`${height>=0?'+':''}${height.toFixed(1)} m`;if(this.value.textContent!==text)this.value.textContent=text;
  }
  this.setVisible(this.enabled);
 }
 setVisible(visible){this.enabled=!!visible;this.group.visible=this.enabled&&!!this.valid;this.line.visible=this.marker.visible=this.group.visible;this.label.hidden=!this.group.visible;}
}

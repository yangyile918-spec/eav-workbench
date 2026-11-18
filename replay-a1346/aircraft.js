import * as T from './vendor--three.module.js';
import {prepareEvo} from './engineering-aircraft.js';
import {GLTFLoader} from './vendor--GLTFLoader.js';

// Geometry is immutable and shared between views; materials and rotor transforms
// belong to each instance so a motor alert never colours another view.
const sourcePromises=new Map();
export function aircraftModel(model){return ['J150','J150EVO'].includes(model)?model:'J160';}
function aircraftSource(model){
 if(!sourcePromises.has(model))sourcePromises.set(model,new GLTFLoader().loadAsync(new URL(model==='J150EVO'?'./models/j150evo-viewer/model.glb':`./models/${model.toLowerCase()}.glb`,import.meta.url).href).then(gltf=>model==='J150EVO'?prepareEvo(gltf):gltf).catch(error=>{sourcePromises.delete(model);throw error;}));
 return sourcePromises.get(model);
}

// Aircraft coordinates: right +X, up +Y, nose -Z. Log motion belongs to root.
export function createAircraft(requestedModel='J160'){
 const aircraft={root:new T.Group(),model:aircraftModel(requestedModel),motors:[],rotors:[],rings:[],anchors:[],loaded:false,disposed:false};
 aircraft.dispose=()=>{aircraft.disposed=true;aircraft.root.traverse(o=>{if(o.isMesh){if(o.userData.instanceGeometry)o.geometry.dispose();for(const m of Array.isArray(o.material)?o.material:[o.material])m?.dispose();}});aircraft.root.clear();aircraft.loaded=false;};
 aircraft.ready=aircraftSource(aircraft.model).then(gltf=>{
  if(aircraft.disposed)return aircraft;
  const model=gltf.scene.clone(true);
  model.traverse(o=>{if(o.isMesh&&o.material)o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();});
  model.updateMatrixWorld(true);
  const bounds=new T.Box3().setFromObject(model),size=bounds.getSize(new T.Vector3());
  if(bounds.isEmpty()||!Number.isFinite(size.length())||size.length()<=0)throw Error('模型尺寸无效');
  const pivots=Array.from({length:4},(_,i)=>{
   const pivot=model.getObjectByName(`Rotor_${i}`);
   if(!pivot)throw Error(`模型缺少电机 #${i} 的旋翼部件`);
   const up=Array.isArray(pivot.userData.spin_axis)?new T.Vector3(...pivot.userData.spin_axis):new T.Vector3(0,1,0);
   pivot.userData.spinAxis=up.normalize().applyQuaternion(pivot.getWorldQuaternion(new T.Quaternion()).invert());
   return pivot;
  });
  const locations=pivots.map(p=>p.getWorldPosition(new T.Vector3()));
  model.traverse(o=>{if(o.isMesh){o.castShadow=true;o.receiveShadow=true;}});
  aircraft.root.add(model);
  const ringRadius=Math.min(.19,Math.max(.09,size.x*.045));
  locations.forEach((p,i)=>{
   const group=new T.Group();group.position.copy(p);aircraft.root.add(group);
   const material=new T.MeshStandardMaterial({color:0x517882,emissive:0x0b3b35,emissiveIntensity:.75,transparent:true,opacity:.92,depthTest:false});
   const ring=new T.Mesh(new T.TorusGeometry(ringRadius,.013,6,40),material);ring.userData.instanceGeometry=true;ring.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(...(pivots[i].userData.spin_axis||[0,1,0])).normalize());ring.position.y=.025;ring.renderOrder=2;group.add(ring);
   const anchor=new T.Object3D();anchor.position.copy(p).add(new T.Vector3(0,.15,0));aircraft.root.add(anchor);
   aircraft.motors.push(group);aircraft.rotors.push(pivots[i]);aircraft.rings.push(material);aircraft.anchors.push(anchor);
  });
  aircraft.bounds=bounds;aircraft.size=size;aircraft.loaded=true;
  return aircraft;
 });
 return aircraft;
}

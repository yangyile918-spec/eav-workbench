import * as T from './vendor--three.module.js';
import {applyGeometry} from './evo-geometry.js';
import {mergeGeometries} from './vendor--BufferGeometryUtils.js';

// Source coordinates are metres, Blender (x,y,z) -> glTF (x,z,-y).
export async function prepareEvo(gltf){
 const root=gltf.scene;
 const response=await fetch(new URL('./models/evo-replay-edits.json',import.meta.url));
 if(!response.ok)throw Error('EVO 装配修正数据读取失败');
 const edits=await response.json(),index=new Map();
 root.traverse(o=>{const name=o.userData.name||o.name;if(!index.has(name))index.set(name,[]);index.get(name).push(o);});
 const find=name=>index.get(name)||[...index].filter(([key])=>key.endsWith(' / '+name)).flatMap(([,objects])=>objects);
 const point=p=>new T.Vector3(p[0],p[2],-p[1]);
 for(const step of edits.steps){
  if(step.orientation){const e=step.orientation,o=find(e.node_name)[0];if(!o)throw Error('EVO 电机朝向节点缺失');root.updateMatrixWorld(true);const p=point(e.pivot_blender_m),m=new T.Matrix4().makeTranslation(...p.toArray()).multiply(new T.Matrix4().makeRotationAxis(point(e.axis_blender).normalize(),Math.PI)).multiply(new T.Matrix4().makeTranslation(...p.clone().negate().toArray()));o.applyMatrix4(o.parent.matrixWorld.clone().invert().multiply(m).multiply(o.parent.matrixWorld));}
  const missing=applyGeometry(root,step.overrides||[],find);if(missing.length)throw Error('EVO 修正节点缺失：'+missing[0]);
 }
 for(const name of edits.hidden)for(const o of find(name))o.visible=false;
 root.traverse(o=>{if((o.userData.name||o.name).startsWith('HARNESS_'))o.visible=false;});
 root.updateMatrixWorld(true);
 // Replay needs rigid modules, while the separate atlas retains every CAD part.
 // Batch equal materials inside each module to avoid thousands of draw calls.
 for(const module of root.children.filter(o=>o.name.startsWith('EVO_'))){
  const batches=new Map(),inverse=module.matrixWorld.clone().invert();
  module.traverseVisible(mesh=>{if(!mesh.isMesh)return;if(Array.isArray(mesh.material))throw Error('EVO 模块材质结构未适配');const geometry=mesh.geometry.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld));const key=mesh.material.uuid+':'+Object.keys(geometry.attributes).sort().join(',')+':'+!!geometry.index;let batch=batches.get(key);if(!batch)batches.set(key,batch={material:mesh.material,geometries:[]});batch.geometries.push(geometry);});
  module.clear();
  for(const {material,geometries}of batches.values()){const geometry=mergeGeometries(geometries,false);if(!geometry)throw Error('EVO 回放几何合并失败');const mesh=new T.Mesh(geometry,material);module.add(mesh);geometries.forEach(g=>g.dispose());}
 }
 root.updateMatrixWorld(true);
 const positions=[];
 for(const [i,side]of ['rf','lr','lf','rr'].entries()){
  const prop=root.getObjectByName('EVO_drive-'+side+'-prop');if(!prop)throw Error('EVO 桨叶模块缺失');
  const center=new T.Box3().setFromObject(prop).getCenter(new T.Vector3());positions.push(center);
  const pivot=new T.Group();pivot.name='Rotor_'+i;pivot.position.copy(center);root.add(pivot);pivot.attach(prop);
  pivot.userData.spin_axis=[0,1,0];pivot.userData.spin_direction=i<2?1:-1;
 }
 const origin=positions.reduce((a,p)=>a.add(p),new T.Vector3()).multiplyScalar(.25);
 root.rotation.y=Math.PI;root.position.set(origin.x,-origin.y,origin.z);root.updateMatrixWorld(true);
 return gltf;
}

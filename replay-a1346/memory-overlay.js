import * as T from './vendor--three.module.js';
import {fusionMatrix} from './fusion-overlay.js';
import {makeWire,sizeWireLabel} from './wire-display.js';
const identity={p:[0,0,0],q:[0,0,0,1]};
function release(group){group.traverse(o=>{if(o.isInstancedMesh)o.dispose();o.geometry?.dispose();if(o.material){o.material.map?.dispose();o.material.dispose();}});}
function makeMarker(row){
 const group=new T.Group(),color=new T.Color(...row.color.slice(0,3)),opacity=row.color[3];
 if(row.kind==='wire'){
  group.add(makeWire(row));
 }else if(row.kind==='terrain'){
  const geometry=new T.BufferGeometry();geometry.setAttribute('position',new T.Float32BufferAttribute(row.points.flat(),3));group.add(new T.Mesh(geometry,new T.MeshBasicMaterial({color,transparent:true,opacity:Math.min(.25,opacity),side:T.DoubleSide,depthWrite:false})));
 }else if(row.kind==='label'){
  const canvas=document.createElement('canvas');canvas.width=736;canvas.height=232;const ctx=canvas.getContext('2d');if(!ctx)return group;
  ctx.fillStyle='rgba(4,14,24,.96)';ctx.fillRect(0,0,736,232);ctx.fillStyle='#ffe15b';ctx.fillRect(0,0,8,232);ctx.strokeStyle='#9b8637';ctx.lineWidth=3;ctx.strokeRect(1,1,734,230);
  const lines=row.text.split('\n').slice(0,4);ctx.fillStyle='#fff0a6';ctx.font='bold 46px Consolas, Microsoft YaHei';ctx.fillText((lines[0]||'设备电线').slice(0,28),24,60,688);
  ctx.fillStyle='#d3e8ee';ctx.font='36px Consolas, Microsoft YaHei';ctx.fillText(lines.slice(1).join('  ·  ').slice(0,65),24,116,688);ctx.fillStyle='#99bac5';ctx.font='32px Microsoft YaHei';ctx.fillText('设备识别 · 电线',24,180,688);
  const texture=new T.CanvasTexture(canvas),sprite=new T.Sprite(new T.SpriteMaterial({map:texture,transparent:true,depthWrite:false,sizeAttenuation:false,toneMapped:false}));sprite.center.set(0,0);sprite.renderOrder=5;sprite.onBeforeRender=(renderer,scene,camera)=>sizeWireLabel(sprite,renderer,camera);group.add(sprite);
 }
 return group;
}
export class MemoryOverlay{
 constructor(scene){this.group=new T.Group();this.group.name='Recorded recognition memory';scene.add(this.group);this.items=new Map();}
 update(markers,origin,axes,world=false){
  const keep=new Set();let wires=0;
  for(const row of markers){if(row.color[3]<=0)continue;const matrix=fusionMatrix({transform:row.transform,worldToMap:world?identity:row.world_to_map},origin,axes);if(!matrix)continue;
   const signature=JSON.stringify([row.kind,row.type,row.points,row.color,row.width,row.text]);let item=this.items.get(row.id);
   if(item&&item.userData.signature!==signature){this.group.remove(item);release(item);this.items.delete(row.id);item=null;}
   if(!item){item=makeMarker(row);item.userData.signature=signature;item.matrixAutoUpdate=false;item.traverse(o=>{if(o.userData.recordedWire)o.userData.displayWidth=this.blockContext?5:9;});this.group.add(item);this.items.set(row.id,item);}
   item.matrix.copy(matrix);item.matrixWorldNeedsUpdate=true;keep.add(row.id);if(row.kind==='wire')wires++;
  }
  for(const [id,item]of this.items)if(!keep.has(id)){this.group.remove(item);release(item);this.items.delete(id);}
  return wires;
 }
 bounds(){this.group.updateMatrixWorld(true);return new T.Box3().setFromObject(this.group);}
 setBlockContext(enabled){if(this.blockContext===enabled)return;this.blockContext=enabled;this.group.traverse(o=>{if(o.userData.recordedWire)o.userData.displayWidth=enabled?5:9;});}
 clear(){this.update([],[],null);}
}

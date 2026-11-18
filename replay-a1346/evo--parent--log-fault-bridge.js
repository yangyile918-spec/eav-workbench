/* Same-origin bridge for the preserved engineering viewers. No log upload. */
window.installLogFaultBridge=function({root,scene,camera,canvas,anchors,selectChannel,setMode,setExplode,restore,tick}){
 if(window.parent===window)return;
 const names=['右前','左后','左前','右后'],colors={recorded:0xef445a,inferred:0xffab39,unknown:0x8f9ba8,clear:0x46b8bc};
 const group=new THREE.Group();scene.add(group);
 let current=null,playing=false,lastMode='',explode=0,active=true;
 const tags=anchors.map((_,i)=>{const n=document.createElement('button');n.className='log-fault-pin';n.onclick=()=>parent.postMessage({type:'log-fault-picked',channel:i,name:names[i]+'动力组件'},location.origin);document.body.append(n);return n;});
 const spheres=anchors.map((anchor,i)=>{
  const m=new THREE.Mesh(new THREE.SphereGeometry(.065,16,12),new THREE.MeshBasicMaterial({color:colors.unknown,transparent:true,opacity:.85,depthTest:false}));m.renderOrder=1000;m.userData.channel=i;group.add(m);return m;
 });
 const badge=document.createElement('div');badge.className='log-fault-badge';badge.textContent='等待日志时刻';document.body.append(badge);
 function refresh(){
  root.updateMatrixWorld(true);
  spheres.forEach((mesh,i)=>{const p=anchors[i]();if(p)mesh.position.copy(p);mesh.visible=!!p&&!!current;const status=current?.motors[i]?.status||'unknown';mesh.material.color.set(colors[status]);mesh.scale.setScalar(status==='recorded'?1.5:status==='inferred'?1.25:1);});
  projectTags();
 }
 function projectTags(){const r=canvas.getBoundingClientRect();spheres.forEach((mesh,i)=>{const p=mesh.position.clone().project(camera),n=tags[i];n.hidden=!current||!active||p.z< -1||p.z>1||Math.abs(p.x)>1||Math.abs(p.y)>1;n.style.left=(r.left+(p.x+1)*r.width/2)+'px';n.style.top=(r.top+(1-p.y)*r.height/2)+'px';const status=current?.motors[i]?.status||'unknown';n.dataset.status=status;n.textContent=`#${i} ${names[i]} · ${{recorded:'已记录',inferred:'推测',unknown:'不足',clear:'未触发'}[status]}`;});}
 window.addEventListener('log-part-picked',event=>{window.parent.postMessage({type:'log-fault-picked',...event.detail},location.origin);});
 window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==parent)return;
  if(event.data?.type==='log-fault-active'){active=!!event.data.active;return;}
  if(event.data?.type!=='log-fault-state')return;
  const d=event.data;current=d.snapshot;playing=!!d.playing;
  for(const control of document.querySelectorAll('#explode,#animate-explode'))control.disabled=playing;
  const mode=d.transparent?'transparent':'solid';if(mode!==lastMode){setMode(mode);lastMode=mode;}
  const next=playing?0:Number(d.explode)||0;if(next!==explode){setExplode?.(next);explode=next;}
  if(Number.isInteger(d.select)&&d.select>=0&&d.select<4)selectChannel(d.select,d.path||'signal');
  if(d.reset)restore?.();
  badge.textContent=current?`${current.model} · T+${current.time.toFixed(3)}s · ${current.gap?'记录空档':current.outside?'无对应记录':'原始样本 '+(current.index+1)}　红：已记录　橙：推测　灰：不足`:'等待日志时刻';refresh();
 });
 const ray=new THREE.Raycaster();let down;
 canvas.addEventListener('pointerdown',e=>down=[e.clientX,e.clientY]);
 canvas.addEventListener('pointerup',e=>{if(!down||Math.hypot(e.clientX-down[0],e.clientY-down[1])>5)return;const r=canvas.getBoundingClientRect();ray.setFromCamera(new THREE.Vector2((e.clientX-r.left)/r.width*2-1,-(e.clientY-r.top)/r.height*2+1),camera);const hit=ray.intersectObjects(spheres).find(h=>h.object.visible);if(hit)parent.postMessage({type:'log-fault-picked',channel:hit.object.userData.channel,name:names[hit.object.userData.channel]+'动力组件'},location.origin);});
 tick?.(refresh);
 window.logFaultBridge={refresh,projectTags,get active(){return active;},get snapshot(){return current;},get playing(){return playing;}};
 parent.postMessage({type:'log-fault-ready'},location.origin);
};

window.installEvoInspection=function({assembly,camera,canvas}){
 if(parent===window)return;
 document.documentElement.dataset.inspection='true';
 let config=null,active=true,targets=[],tags=[];
 const tray=document.createElement('div');tray.className='inspection-targets';document.body.append(tray);
 const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');svg.classList.add('inspection-leaders');document.body.append(svg);
 const status=document.createElement('div');status.className='inspection-status';document.body.append(status);
 const send=(type,extra={})=>parent.postMessage({type,...extra},location.origin);
 function rebuild(next){targets=next;tray.replaceChildren();svg.replaceChildren();tags=targets.map((target,i)=>{
  const button=document.createElement('button');button.textContent=target.label;button.dataset.part=target.id;button.className=(target.priority||config?.target!=='battery'&&target.id.endsWith('-esc'))?'priority':'';
  button.onclick=()=>{assembly.focusInspection(target.id);tags.forEach(t=>t.button.classList.toggle('selected',t.target.id===target.id));};tray.append(button);
  const line=document.createElementNS('http://www.w3.org/2000/svg','polyline');svg.append(line);return {target,button,line,i};
 });}
 function project(){
  if(!active)return;const rect=canvas.getBoundingClientRect(),w=innerWidth,h=innerHeight;svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
  for(const tag of tags){const p=new THREE.Vector3(...tag.target.point).project(camera),left=config?.target==='battery'?tag.i<4:tag.i<2||tag.i===6,row=config?.target==='battery'?tag.i%4:tag.i===6?3:left?tag.i:tag.i-2;
   tag.button.style.left=left?'12px':'auto';tag.button.style.right=left?'auto':'12px';tag.button.style.top=(58+row*Math.min(55,(h-120)/4))+'px';
   const r=tag.button.getBoundingClientRect(),x=left?r.right:r.left,y=r.top+r.height/2,px=rect.left+(p.x+1)*rect.width/2,py=rect.top+(1-p.y)*rect.height/2;
   tag.line.style.display=Math.abs(p.x)>1||Math.abs(p.y)>1||p.z< -1||p.z>1?'none':'';tag.line.setAttribute('points',`${x},${y} ${x+(left?14:-14)},${y} ${px},${py}`);tag.line.setAttribute('stroke',tag.target.priority||config?.target!=='battery'&&tag.i===6?'#df243a':'#af860e');
  }
 }
 window.addEventListener('message',event=>{
  if(event.source!==parent||event.origin!==location.origin)return;const d=event.data;
  if(d?.type==='evo-inspection-active'){active=!!d.active;return;}
  if(d?.type==='evo-inspection-focus'){assembly.focusInspection(d.id);return;}
  if(d?.type!=='evo-inspection-state')return;
  const changed=JSON.stringify(config)!==JSON.stringify(d.config);if(!changed)return;config=d.config;
  const result=assembly.setInspection(config);rebuild(result.targets);
  status.textContent=`${config?.target==='battery'?'电池优先 · 整体供电线束 ｜ ':''}J150 EVO 结构参考 · ${result.parts} 个部件 / ${result.loadedRoutes} 段线束已载入 · 当前显示 ${result.shownRoutes} 段`;
  send('evo-inspection-loaded',result);project();
 });
 window.addEventListener('log-part-picked',event=>{tags.forEach(t=>{const selected=t.target.id===event.detail.id;t.button.classList.toggle('selected',selected);t.button.setAttribute('aria-pressed',String(selected));});send('evo-inspection-picked',event.detail);});
 window.addEventListener('keydown',event=>{if(event.key==='Escape')send('evo-inspection-escape');});
 window.logFaultBridge={projectTags:project,refresh:project,get active(){return active;}};
 send('evo-inspection-ready');
};

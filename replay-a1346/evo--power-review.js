(async()=>{
'use strict';
const $=s=>document.querySelector(s),stage=$('.stage'),canvas=$('canvas'),overlay=$('#overlay'),labels=$('#labels');
const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setClearColor(0xeaf0f2);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.autoClear=false;
renderer.localClippingEnabled=true;
const sprayFrontSection=[new THREE.Plane(new THREE.Vector3(0,0,1),-.223),new THREE.Plane(new THREE.Vector3(0,1,0),.030)];
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(32,1,.001,50),controls=new OrbitControls(camera,canvas);
const wireGroup=new THREE.Group();
scene.add(wireGroup);
controls.enableDamping=true;
controls.dampingFactor=.14;
controls.rotateSpeed=.68;
controls.minPolarAngle=Math.PI/30;
controls.maxPolarAngle=Math.PI-controls.minPolarAngle;
const ambient=new THREE.HemisphereLight(0xffffff,0x8b9da8,2.4);scene.add(ambient);const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(2,4,3);scene.add(light);
ambient.layers.enable(1);light.layers.enable(1);
const fill=new THREE.DirectionalLight(0xdbe7ff,1.3);
fill.position.set(-5,2,-3);fill.visible=false;scene.add(fill);
let rows=[],root,ready=false,selected=null,currentView='wiring-all',solidCheck=false,wiresVisible=true,wholeAngle='top',valveFocus=false;
let systemView=false,systemWireOverlay=false,catalog,assemblyHidden;
let waterFlow, assembly;
const sourceMaterials=new WeakMap(),sourceVisibility=new WeakMap(),updatedGeometry=new Set();
let sprayWorkReview;
let controllerClipReview;
const controllerClipOverrides=new Map();
const controllerClipView=mode=>mode==='controller-clips';
const controllerPeripheralView=mode=>mode==='controller-peripheral';
const controllerFocus=mode=>controllerClipReview?.peripheral?.focus_views?.[mode];
const rfFocus=mode=>mode==='pending-rf'||mode.startsWith('rf-');
const controllerDetailView=mode=>controllerClipView(mode)||controllerPeripheralView(mode)||Boolean(controllerFocus(mode));
const controllerClipSection=[
 new THREE.Plane(new THREE.Vector3(0,0,1),-.220),
 new THREE.Plane(new THREE.Vector3(0,1,0),-.058)
];
const routes=[],armSleeves=[],loadWarnings=[],missingNodes=[],objectIndex=new Map(),originallyHidden=new Set();
const partEndpointUpdates=new Map();
const rearEscs=[],detailMaterials=new Map(),valveHubReview={};
const rearArms={
 m3:{side:'left',suffix:'lr',name:'M3 左后机臂'},
 m4:{side:'right',suffix:'rr',name:'M4 右后机臂'},
};
const hasSpray=arm=>routes.some(r=>r.data.system==='spray'&&r.kind==='arm-'+arm);
const rearArm=mode=>/^rear-esc:(m[34])$/.exec(mode)?.[1]||null;
const sprayView=mode=>Boolean(rearArm(mode)&&hasSpray(rearArm(mode)));
const sprayModules=arm=>{
 const {side,suffix}=rearArms[arm];
 return ['EVO_structure-'+suffix,...['inner','outer','pipes'].map(item=>'EVO_spray-'+side+'-'+item)];
};
const tailSignalView=mode=>mode==='tail-signal'||mode==='tail-signal-port'||mode==='fc205';
const sprayPortView=mode=>mode==='spray-work-port';
const sprayFrontView=mode=>mode==='spray-work-front';
const sprayTankView=mode=>mode==='spray-work-tank';
const sprayWorkView=mode=>mode==='spray-work'||sprayPortView(mode)||sprayFrontView(mode)||sprayTankView(mode);
const isSprayWork=route=>route.kind==='spray-work'||route.name.startsWith('喷洒电源');
const is205Harness=route=>route.harness?.id==='tail-205-signal-harness';
const is205Trunk=route=>route.data.circuit==='fc205-trunk';
const isTailSignalRun=route=>route.data.circuit==='battery-signal'||is205Trunk(route);
const useWireOverlay=()=>Boolean(controllerFocus(currentView)?.route_ids.length)||controllerPeripheralView(currentView)||['wiring-all','arm-m3-beam','arm-m4-beam','arm-m4-tail-a'].includes(currentView)||tailSignalView(currentView)||sprayView(currentView)||(sprayWorkView(currentView)&&!sprayPortView(currentView)&&!sprayFrontView(currentView));
const armReviews={};const baseContext=new Set(['EVO_structure-frame','EVO_power-distribution','EVO_power-tail-connectors','EVO_power-battery-rail']);
const coverNames=new Set(['1550102-E70-·Öµç°å¸ÇV7.0-A0-20250612.003']);let coverTransparent=false;
function isCover(name){return [...coverNames].some(n=>name===n||name?.endsWith(' / '+n));}
function applyCover(){for(const name of coverNames)for(const object of findObjects(name)){object.visible=true;originallyHidden.delete(object);object.traverse(mesh=>{mesh.visible=true;if(mesh.isMesh)mesh.material=mat(0x444b4d,coverTransparent,coverTransparent?.18:1);});}const button=$('#cover-toggle');if(button){button.textContent=coverTransparent?'盖板：透视':'盖板：实体';button.setAttribute('aria-pressed',coverTransparent);}}
function sharedRoute(mode){return routes.find(r=>mode==='shared-negative'?r.name.includes('485')&&r.name.includes('负极'):r.name.includes('喷洒')&&r.name.includes('正极'));}
const armCloseups={
 'tail-signal':{fitTailSignal:true,direction:[-.62,1,-.08],margin:1.34,minSize:.27,title:'尾插信号 · A 负极尾插经右纵梁接主控 205'},
 'fc205':{fitTailSignal:true,direction:[-1.02,.58,-.10],margin:1.37,minSize:.27,title:'主控 205 · 红黑供电与尾插通讯'},
 'tail-signal-port':{code:'205',radius:.046,direction:[-.22,.83,-.67],margin:1.42,minSize:.092,title:'主控 205 · 单根护套接入弯头'},
 'arm-m1-port':{code:'Q5',radius:.086,direction:[-.69,.69,-.23],title:'Q5 电调 · P3 红正、黑负 · P4 8P 信号'},
 'arm-m1-signal':{code:'P4',fitNodes:true,circuit:'signal',direction:[-.827,.56,-.612],offset:[0,-.009,0],margin:1.18,minSize:.060,title:'P4 电调 8P · 原插头与信号线接合'},
 'arm-m1-controller':{code:'P2',radius:.065,direction:[-.32,.95,-.92],title:'P2 主控 208 · 12P 弯头插头'},
 'arm-m1-root':{code:'P5',fitNodes:true,circuit:'presence',direction:[-.67,.12,-.75],offset:[.0054,0,-.0045],margin:1.60,minSize:.10,title:'P5 在位传感器 · 下端直线贴槽'},
 'arm-m1-seat':{code:'P5 侧视',fitNodes:true,circuit:'presence',direction:[-.045,-.997,-.053],offset:[.0054,0,-.0045],margin:1.55,minSize:.10,title:'P5 侧视 · 下端直线与原线槽贴合'},
 'arm-m1-fasteners':{code:'P5 固定',fitNodes:true,circuit:'presence',direction:[.65,.13,.75],margin:1.26,minSize:.057,title:'P5 机臂外侧 · 两颗支架锁付螺丝'},
 'arm-m1-phase':{codes:['M1 电调三相','M1 电机入口'],fitCircuit:true,circuit:'phase',direction:[-.83,.11,-.53],margin:1.38,minSize:.117,title:'M1 电调到电机 · 黄、橙、蓝三相线'},
 'arm-m2-rear':{codes:['M2-1','M2-2'],direction:[-.66,.74,-.47],margin:1.45,minSize:.097,title:'M2 后端 · 红黑续接端与左纵梁开口'},
 'arm-m2-root':{codes:['M2-3','M2-4'],direction:[-.40,.92,.22],margin:1.80,minSize:.17,title:'M2 前端 · 左纵梁开口与折叠座／碳管'},
 'arm-m2-signal':{code:'M2 P4',fitNodes:true,circuit:'signal',direction:[-.395,-.242,-.886],margin:1.27,minSize:.081,title:'M2 电调 P4 · 原 8P 插头与信号线接合'},
 'arm-m2-controller':{code:'M2 201',radius:.064,direction:[.38,.91,-.85],title:'M2 主控 201 · 12P 弯头插头'},
 'arm-m2-presence':{code:'M2 P5',fitNodes:true,circuit:'presence',direction:[.67,.12,-.75],offset:[-.010,0,-.008],margin:1.68,minSize:.10,title:'M2 在位传感器 · 直线贴原支架槽'},
 'arm-m2-phase':{codes:['M2 电调三相','M2 电机入口'],fitCircuit:true,circuit:'phase',direction:[.83,.24,-.53],margin:1.44,minSize:.132,title:'M2 电调到电机 · 黄、橙、蓝三相线'},
 'arm-m2-port':{codes:['M2 上口','M2 下口'],direction:[.302,.208,-.930],margin:1.30,minSize:.126,title:'M2 动力电调 · 上口红正、下口黑负'},
 'arm-m3-tail':{codes:['M3-1','M3-2'],direction:[.08,.72,.56],margin:1.47,minSize:.215,title:'M3 红黑供电 · 两侧尾插接点'},
 'arm-m3-beam':{codes:['M3-3R','M3-3L','M3-3S'],direction:[0,.78,-1],margin:1.36,minSize:.205,title:'M3 后横梁 · 黑线从右侧进梁，沿内腔通向左后角'},
 'arm-m3-fold':{codes:['M3-3S','M3-4','M3-5'],direction:[.12,.63,-.77],margin:1.44,minSize:.130,title:'M3 左后角 · 侧向孔、折叠座与碳管管口'},
 'arm-m3-port':{codes:['M3 上口','M3 下口'],direction:[.25,.32,.93],margin:1.40,minSize:.138,title:'M3 动力电调 · 上口红正、下口黑负'},
 'arm-m3-signal':{code:'M3 P4',radius:.106,circuit:'signal',direction:[-.53,-.42,-.74],margin:1.34,minSize:.134,title:'M3 P4 · 通过原护圈接入动力电调'},
 'arm-m3-presence':{code:'M3 P6',fitNodes:true,circuit:'presence',direction:[-.72,-.35,-.57],margin:1.46,minSize:.112,title:'M3 P6 · 在位传感器与支架槽'},
 'arm-m3-phase':{fitCircuit:true,circuit:'phase',direction:[-.70,.32,-.64],margin:1.55,minSize:.143,title:'M3 动力电调到电机 · 黄、橙、蓝三相线'},
 'arm-m4-tail':{codes:['B M4','B M3','B 主配电','A M4','A M3','A 主配电','尾插信号'],direction:[0,.74,.62],margin:1.34,minSize:.235,title:'电池尾插 · M4 正极上位、负极下位'},
 'arm-m4-tail-b':{codes:['B M4','B 主配电','B M3'],direction:[-.94,.17,.30],margin:1.38,minSize:.075,title:'B 正极尾插 · M4 上位、M3 下位'},
 'arm-m4-tail-a':{codes:['A M3','A 主配电','A M4','尾插信号'],direction:[.95,.18,.27],margin:1.42,minSize:.086,title:'A 负极尾插 · M3 上位、M4 下位'},
 'arm-m4-beam':{codes:['M4 进梁','M4 出梁'],direction:[0,.85,-.88],margin:1.42,minSize:.19,title:'M4 · 后横梁两端原开口'},
 'arm-m4-port':{codes:['P3上','P3下'],direction:[-.39,.21,.87],margin:1.34,minSize:.113,title:'M4 P3 · 动力电调供电口'},
 'arm-m4-spray-power':{codes:['P7上','P7下'],direction:[.57,.37,-.67],margin:1.40,minSize:.115,title:'M4 P7 · 喷头电调供电口'},
 'arm-m4-controller':{code:'206',radius:.080,direction:[-.30,.89,.39],margin:1.44,minSize:.093,title:'M4 主控 206 · 右后机臂 12P'},
 'arm-m4-signal':{code:'M4 P4',radius:.105,circuit:'signal',direction:[.53,.43,-.74],margin:1.34,minSize:.134,title:'M4 P4 · 右后动力电调原插头'},
 'arm-m4-presence':{code:'M4 P6',fitNodes:true,circuit:'presence',direction:[.72,.35,-.57],margin:1.46,minSize:.112,title:'M4 P6 · 在位传感器与原线槽'},
 'arm-m4-phase':{codes:['M4 电调三相','M4 电机入口'],fitCircuit:true,circuit:'phase',direction:[.70,.35,-.64],margin:1.48,minSize:.138,title:'M4 动力电调到电机 · 黄、橙、蓝三相线'},
};
const armForView=mode=>/^arm-(m[1-4])(?:-|$)/.exec(mode)?.[1]||null;
const isArmView=mode=>Boolean(armForView(mode));
const toWeb=p=>new THREE.Vector3(p[0],p[2],-p[1]);
const mat=(color,transparent=false,opacity=1)=>new THREE.MeshStandardMaterial({color,transparent,opacity,depthWrite:!transparent,roughness:.5,metalness:.15});
function findObjects(name){if(!name)return[];const exact=objectIndex.get(name);if(exact)return exact;const found=[];root.traverse(o=>{if(o.name.endsWith(' / '+name))found.push(o);});return found;}
function styleObjects(names,material,route=null){for(const name of Array.isArray(names)?names:[names])for(const o of findObjects(name)){o.traverse(mesh=>{if(mesh.isMesh){mesh.material=mesh.userData.armNativeMaterial||material;if(route)route.stubs.push(mesh);}});}}
function applyGeometryOverrides(entries=[]){
 for(const entry of entries){
  if(isCover(entry.object_name))throw new Error('盖板外形禁止替换');
  updatedGeometry.add(entry.object_name);
 }
 const missing=applyEvoComponentGeometry(root,entries,findObjects);
 for(const name of missing)missingNodes.push(name);
}
function applyMotorOrientation(edit){
 if(!edit)return;
 const node=root.getObjectByName(edit.node_name);
 if(!node)throw new Error('缺少电机模型：'+edit.node_name);
 root.updateMatrixWorld(true);
 const pivot=toWeb(edit.pivot_blender_m);
 const rotation=new THREE.Matrix4().makeRotationAxis(toWeb(edit.axis_blender).normalize(),Math.PI);
 const world=new THREE.Matrix4().makeTranslation(pivot.x,pivot.y,pivot.z)
  .multiply(rotation).multiply(new THREE.Matrix4().makeTranslation(-pivot.x,-pivot.y,-pivot.z));
 const parent=node.parent.matrixWorld;
 node.applyMatrix4(parent.clone().invert().multiply(world).multiply(parent));
 root.updateMatrixWorld(true);
}
function addArmReview(data,arm){
 armReviews[arm]=data;
 addArmMarkers(data.markers||[],arm);
}
function addArmMarkers(markers,arm){
 for(const d of markers){
  const r=makeMarker(d.code,d.title,toWeb(d.point_blender_m).toArray());r.review=true;r.arm=arm;r.detail=d.note;r.nodes=d.nodes||[];r.detailView=d.detail_view;r.focusView=d.focus_view;rows.push(r);
  if(d.polarity||d.pending){
   r.markerColor=d.pending?'#a96518':d.polarity==='positive'?'#af3733':'#343b43';
   r.label.querySelector('b').style.background=r.markerColor;
  }
  if(r.detailView&&!d.shortcut)continue;
  for(const o of r.nodes.flatMap(findObjects))o.traverse(m=>{if(m.isMesh)r.meshes.push(m);});
  if(!r.meshes.length)missingNodes.push(r.code);
  r.mat=mat(d.code==='Q5'?0x277e72:0x7b949c,d.code!=='Q5',d.code==='Q4'?.3:.5);r.dim=mat(0x95aaa6,true,.12);
  r.button=document.createElement('button');r.button.textContent=d.code+' · '+d.title+(d.pending?'（待确认）':'');r.button.onclick=()=>select(d.code);$(arm==='m1'?'#next-items':'#'+arm+'-items').append(r.button);
 }
}
function addRearEscs(entries){
 for(const d of entries){
  const r=makeMarker(d.arm+'-'+d.type,d.title,toWeb(d.point_blender_m).toArray());
  Object.assign(r,{rearEsc:true,arm:d.arm,node:d.node,escType:d.type,detail:d.note});
  r.label.querySelector('b').textContent=d.arm.toUpperCase();
  r.label.querySelector('b').style.background=d.type==='spray'?'#12756b':'#425764';
  rows.push(r);rearEscs.push(r);
  if(!findObjects(d.node).length)missingNodes.push(d.code);
  if(d.type==='spray'){
   r.button=document.createElement('button');
   r.button.textContent=d.arm.toUpperCase()+' '+d.title;
   r.button.onclick=()=>view('rear-esc:'+d.arm);
   $('#rear-esc-items').append(r.button);
  }
 }
}
function addSprayMarkers(markers,arm){
 for(const item of markers){
  const marker=makeMarker(item.code,item.title,toWeb(item.point_blender_m).toArray(),item.route_id);
  marker.sprayMarker=true;marker.arm=arm;
  rows.push(marker);
 }
}
function addTailSignalMarkers(markers){
 for(const data of markers){
  const marker=makeMarker(data.code,data.title,toWeb(data.point_blender_m).toArray());
  Object.assign(marker,{tailSignalMarker:true,detail:data.note,powerOnly:data.power_only===true});
  if(data.polarity){
   marker.markerColor=data.polarity==='positive'?'#af3733':'#343b43';
   marker.label.querySelector('b').style.background=marker.markerColor;
  }
  rows.push(marker);
 }
}
function applyReviewContext(mode){
 const whole=mode==='wiring-all',rearSide=mode.startsWith('rear-esc:')?mode.slice(9):null;
 const focus=controllerFocus(mode);
 renderer.clippingPlanes=controllerClipView(mode)?controllerClipSection:sprayFrontView(mode)?sprayFrontSection:[];
 if(whole){
  const ghost=mat(0xa2b0b8,true,.075),prop=mat(0xb2bdc4,true,.050);
  root.traverse(o=>{
   if(o.name.startsWith('EVO_'))o.visible=true;
   if(o.isMesh){
    if(!detailMaterials.has(o))detailMaterials.set(o,o.material);
    o.material=o.userData.armNativeMaterial||ghost;
   }
  });
  for(const side of ['rf','lf','rr','lr'])styleObjects('EVO_drive-'+side+'-prop',prop);
  for(const esc of rearEscs)styleObjects(esc.node,mat(esc.escType==='spray'?0x218b80:0x5f7681,true,.30));
  return;
 }
 for(const [mesh,material] of detailMaterials)mesh.material=material;
 detailMaterials.clear();
 const arm=armForView(mode),review=armReviews[arm];
 const phaseCloseup=armCloseups[mode]?.circuit==='phase';
 const rearModules=rearSide?rearEscs.filter(r=>r.arm===rearSide).map(r=>r.node):[];
 if(sprayView(mode))rearModules.push(...sprayModules(rearSide));
 const rear=rearArms[arm];
 const modules=focus?focus.modules:controllerPeripheralView(mode)?['EVO_power-controller','EVO_structure-frame','EVO_sense-front-rotating',
  'EVO_sense-front-lidar','EVO_nav-fpv','EVO_nav-gnss-main','EVO_nav-gnss-secondary','EVO_power-backup-battery']:controllerClipView(mode)?['EVO_power-controller','EVO_structure-frame']:sprayPortView(mode)?['EVO_nav-fpv']:sprayFrontView(mode)?['EVO_power-controller','EVO_nav-fpv']:sprayWorkView(mode)?['EVO_power-controller','EVO_spray-tank','EVO_spray-flowmeter','EVO_spray-level','EVO_spray-pump-a','EVO_spray-pump-b','EVO_nav-fpv']:tailSignalView(mode)?['EVO_power-controller']:phaseCloseup&&rear?['EVO_drive-'+rear.suffix+'-esc','EVO_drive-'+rear.suffix+'-motor']
  :(review?.context_module_nodes||rearModules).filter(name=>!phaseCloseup||name!=='EVO_power-controller');
 root.traverse(o=>{
  if(!o.name.startsWith('EVO_'))return;
  o.visible=modules.includes(o.name)||(!controllerDetailView(mode)&&!phaseCloseup&&baseContext.has(o.name));
 });
 for(const name of modules){
  const esc=name.includes('esc');
  const spray=name.startsWith('EVO_spray-')&&esc;
  const escCloseup=rearSide||armCloseups[mode]?.circuit==='signal'||mode.endsWith('-port')||mode==='arm-m4-spray-power';
  const signalDetail=Boolean(rear&&mode.endsWith('-signal'));
  const ghostSpray=spray&&Boolean(rear&&(mode.endsWith('-port')||signalDetail));
  const sprayCloseup=sprayView(mode);
  const solidEsc=esc&&escCloseup&&mode!=='arm-m2-signal'&&!signalDetail&&!ghostSpray&&!sprayCloseup;
  const opacity=focus ? (focus.context_opacity ?? (focus.route_ids.length ? .18 : .29)) : controllerClipView(mode)?.27:sprayWorkView(mode)?(name==='EVO_spray-tank'?.09:.20):sprayCloseup?(valveFocus?(spray?.07:.18):(spray?.27:.14)):ghostSpray?.045:phaseCloseup?(esc?.23:name.includes('motor')?.20:.08):esc?(signalDetail?.15:solidEsc?1:.75):escCloseup?.06:armCloseups[mode]?.circuit==='presence'?.12:.28;
  const tint=spray?0x47877e:esc?0x68787f:0x899da5;
  styleObjects(name,mat(tint,!solidEsc,opacity));
 }
 if(tailSignalView(mode)||sprayWorkView(mode)){
  for(const name of baseContext){
   for(const node of findObjects(name))node.traverse(o=>{if(o.isMesh)detailMaterials.set(o,o.material);});
   styleObjects(name,mat(0x899da5,true,mode==='tail-signal-port'?.14:.10));
  }
 }
 if(focus){
  if(rfFocus(mode)){
   const ghost=mat(0x899da5,true,focus.context_opacity??.14);
   for(const name of modules)for(const node of findObjects(name))node.traverse(mesh=>{
    if(!mesh.isMesh||!mesh.userData.armNativeMaterial)return;
    if(!detailMaterials.has(mesh))detailMaterials.set(mesh,mesh.material);
    mesh.material=ghost;
   });
  }
  const highlightOpacity=focus.highlight_opacity??1;
  styleObjects(focus.highlights,mat(focus.route_ids.length?0x5e8478:0xb38852,highlightOpacity<1,highlightOpacity));
  if(mode==='battery-106-seat')styleObjects(sprayWorkReview.mount.clip_mesh_names,mat(0x6d8580,false,1));
 }
 if(controllerPeripheralView(mode)){
  const endpoints=controllerClipReview.peripheral.routes.flatMap(r=>r.endpoint_objects);
  styleObjects(endpoints,mat(0x5e8478));
 }
 if(controllerClipView(mode)){
  const {main,left,right}=controllerClipReview.structure;
  styleObjects(main,mat(0x77878d));
  styleObjects([left,right],mat(0x5e8478));
 }
 if(sprayPortView(mode))styleObjects(sprayWorkReview.mount.clip_mesh_names,mat(0x58646c));
 if(sprayFrontView(mode)){
  styleObjects(sprayWorkReview.mount.clip_mesh_names,mat(0x576a72,true,.58));
  styleObjects(sprayWorkReview.front_routing.outlet_object_name,mat(0x62767e,true,.76));
 }
 if(rear&&mode.endsWith('-presence')){
  const holder=rows.find(r=>r.code===arm.toUpperCase()+' P6');
  styleObjects(holder.nodes,mat(0x536574,true,.52));
 }
 if(sprayView(mode)){
  if(valveFocus)styleObjects(valveHubReview[rearSide]?.bracket_object_name,mat(0x6d8790,true,.48));
  const plugs=routes.filter(r=>r.data.arm===rearSide&&r.data.system==='spray'&&r.data.circuit!=='spray-phase'&&r.data.spray_connection?.route_end)
    .map(r=>r.data.spray_connection.object_name);
  styleObjects(plugs,mat(0x384448,true,.80));
  const nozzleSockets=routes.filter(r=>r.data.arm===rearSide&&r.data.nozzle_phase_socket)
    .map(r=>r.data.nozzle_phase_socket.object);
  styleObjects([...new Set(nozzleSockets)],mat(0x657279,true,.85));
 }
 if(mode==='arm-m1-fasteners')styleObjects(review.sensor_mount_tube,mat(0x566169,true,.40));
}
function makeMarker(code,title,point,routeId=null){const el=document.createElement('div');el.className='marker';const b=document.createElement('b');b.textContent=code;el.append(b,document.createTextNode(title));labels.append(el);return{code,title,point,routeId,meshes:[],label:el,button:null};}
function wholeToolbarClearance(height){
 return Math.min(height*.42,$('.toolbar').offsetHeight+22);
}
function updateProjection(){
 const w=stage.clientWidth,h=stage.clientHeight;
 if(!w||!h)return;
 camera.aspect=w/h;
 if(systemView)camera.clearViewOffset();
 else if(currentView==='wiring-all')camera.setViewOffset(w,h,0,wholeToolbarClearance(h)/2,w,h);
 else if(currentView==='tail-signal'||currentView==='fc205'||sprayWorkView(currentView))camera.setViewOffset(w,h,0,h*.055,w,h);
 else camera.clearViewOffset();
}
function resize(){renderer.setSize(stage.clientWidth,stage.clientHeight,false);updateProjection();}
new ResizeObserver(resize).observe(stage);

const sidebarButton=$('#evo-sidebar-toggle');
function setSidebarOpen(open){
 document.body.classList.toggle('sidebar-open',open);
 sidebarButton.setAttribute('aria-expanded',String(open));
}
sidebarButton.onclick=()=>setSidebarOpen(!document.body.classList.contains('sidebar-open'));
document.addEventListener('keydown',event=>{if(event.key==='Escape')setSidebarOpen(false);});

function mountWireMesh(mesh){
 if(mesh.parent===wireGroup)return;
 mesh.updateWorldMatrix(true,false);
 const pose=mesh.matrixWorld.clone();
 wireGroup.add(mesh);
 mesh.matrix.copy(pose);
 mesh.matrixAutoUpdate=false;
}

function makeSystemWireDisplay(){
 const items=new Map();
 const materialCache=new WeakMap();
 const outlines=new Map();
 let displayedIds=new Set(),highlightedIds=new Set();
 const width={value:0};
 const outlineMaterial=new THREE.MeshBasicMaterial({
  color:0xffba35,side:THREE.BackSide,depthWrite:false,toneMapped:false
 });
 outlineMaterial.onBeforeCompile=shader=>{
  shader.uniforms.outlineWidth=width;
  shader.vertexShader='uniform float outlineWidth;\n'+shader.vertexShader.replace(
   '#include <begin_vertex>',
   '#include <begin_vertex>\n transformed += normalize(normal) * max(0.00015, -(modelViewMatrix * vec4(position, 1.0)).z * outlineWidth);'
  );
 };
 function wireMaterial(original){
  if(!materialCache.has(original)){
   const focus=original.clone();
   if(focus.emissive&&focus.color){
    focus.emissive.copy(focus.color);
    focus.emissiveIntensity=.36;
   }
   materialCache.set(original,{normal:original,focus});
  }
  return materialCache.get(original);
 }
 function add(mesh,ids,all=false){
  for(let node=mesh;node;node=node.parent){
   if(originallyHidden.has(node)||assemblyHidden.has(node))return;
  }
  if(!items.has(mesh)){
   mountWireMesh(mesh);
   const materials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
   items.set(mesh,{mesh,ids:new Set(),all,materials:materials.map(wireMaterial),array:Array.isArray(mesh.material)});
  }
  for(const id of ids)items.get(mesh).ids.add(id);
 }
 for(const route of routes){
  add(route.mesh,[route.id]);
  for(const stub of route.stubs)add(stub,[route.id]);
  const outline=new THREE.Mesh(route.mesh.geometry,outlineMaterial);
  outline.visible=false;outline.renderOrder=-1;
  outlines.set(route.id,outline);
  wireGroup.add(outline);
 }
 for(const {mesh,memberIds} of fixedHarnessParts)add(mesh,memberIds);
 for(const {mesh,memberIds} of armSleeves){
  const ids=memberIds||routes.filter(route=>route.kind==='arm-m1'&&route.data.circuit!=='presence').map(route=>route.id);
  add(mesh,ids,true);
 }
 function sync({visible,focus,show,overlay}){
  displayedIds=show?visible:new Set();
  highlightedIds=focus;
  systemWireOverlay=show&&(overlay||focus.size>0);
  const layer=systemWireOverlay?1:0;
  width.value=2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))*1.75/Math.max(stage.clientHeight,1);
  for(const {mesh,ids,all,materials,array} of items.values()){
   const members=[...ids];
   const belongs=all?members.every(id=>visible.has(id)):members.some(id=>visible.has(id));
   mesh.visible=show&&belongs;
   if(!mesh.visible)continue;
   const active=members.some(id=>focus.has(id));
   const style=active?'focus':'normal';
   mesh.material=array?materials.map(material=>material[style]):materials[0][style];
   mesh.layers.set(layer);
  }
  for(const [id,outline] of outlines){
   outline.visible=show&&visible.has(id)&&focus.has(id);
   outline.layers.set(layer);
  }
  return routes.filter(route=>route.mesh.visible).length;
 }
 function pick(raycaster,opaqueDistance){
  if(!displayedIds.size)return null;
  const limit=systemWireOverlay?Infinity:opaqueDistance;
  const targets=[...items.keys()].filter(mesh=>mesh.visible);
  const mask=raycaster.layers.mask;
  raycaster.layers.enable(1);
  const hit=raycaster.intersectObjects(targets,false).find(item=>item.distance<=limit);
  raycaster.layers.mask=mask;
  if(hit){
   const ids=[...items.get(hit.object).ids].filter(id=>displayedIds.has(id));
   if(ids.length)return {id:ids.find(id=>highlightedIds.has(id))||ids[0],point:hit.point};
  }
  // A narrow screen-space tolerance makes fine wires selectable at overview scale.
  const tolerance=6*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/Math.max(1,stage.clientHeight);
  const ray=raycaster.ray,along=new THREE.Vector3(),onWire=new THREE.Vector3();
  let best=tolerance*tolerance,result=null;
  for(const route of routes){
   if(!route.mesh.visible)continue;
   const sphere=route.mesh.geometry.boundingSphere;
   if(sphere&&ray.distanceToPoint(sphere.center)>sphere.radius+
      (ray.origin.distanceTo(sphere.center)+sphere.radius)*tolerance)continue;
   for(let i=1;i<route.points.length;i++){
    const a=route.points[i-1],b=route.points[i];
    if(a.distanceToSquared(b)<1e-14)continue;
    const gap=ray.distanceSqToSegment(a,b,along,onWire),depth=ray.origin.distanceTo(along);
    if(depth<camera.near||depth>camera.far||depth>limit)continue;
    const relative=gap/(depth*depth);
    if(relative<best){best=relative;result={id:route.id,point:onWire.clone()};}
   }
  }
  return result;
 }
 return {sync,pick};
}

function openSystems(){
 const connections=makeEvoConnections(catalog,routes);
 systemView=true;
 $('#wiring-panel').hidden=true;$('#wiring-tools').hidden=true;
 $('#parts-panel').hidden=false;$('#parts-tools').hidden=false;
 $('#return-system-view').hidden=true;
 renderer.clippingPlanes=[];
 renderer.toneMapping=THREE.ACESFilmicToneMapping;
 renderer.toneMappingExposure=1.15;
 fill.visible=true;
 root.traverse(node=>{
  node.visible=sourceVisibility.get(node)!==false&&!node.name.startsWith('HARNESS_')&&
   !assemblyHidden.has(node)&&!originallyHidden.has(node);
  node.layers.set(0);
  node.renderOrder=0;
 });
 const {sync:syncWires,pick:pickWire}=makeSystemWireDisplay();
 assembly=createEvoAssembly({
  root,camera,controls,canvas,catalog,routes,connections,syncWires,pickWire,resize,waterFlow,
  solidMaterial:mesh=>mesh.userData.armNativeMaterial||sourceMaterials.get(mesh)||mesh.material,
  closeSidebar:()=>setSidebarOpen(false)
 });
}

// 直接使用核对后的采样点生成圆管。逐段传播截面方向，避免样条插值偏离孔口和卡槽。
function sampledTube(points,radius,sides=12,radii=null){
 const path=[],sectionRadii=[];
 points.forEach((p,i)=>{
  if(path.length&&p.distanceToSquared(path[path.length-1])<=1e-14)return;
  path.push(p);sectionRadii.push(radii?.[i]??radius);
 });
 if(path.length<2)throw new Error('线路至少需要两个不同采样点');
 const vertices=[],normals=[],indices=[];let previousTangent=null,normal=null;
 for(let i=0;i<path.length;i++){
  const tangent=path[Math.min(i+1,path.length-1)].clone().sub(path[Math.max(i-1,0)]).normalize();
  if(!normal){const axis=Math.abs(tangent.y)<.85?new THREE.Vector3(0,1,0):new THREE.Vector3(1,0,0);normal=new THREE.Vector3().crossVectors(tangent,axis).normalize();}
  else normal.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(previousTangent,tangent)).normalize();
  const binormal=new THREE.Vector3().crossVectors(tangent,normal).normalize();normal.crossVectors(binormal,tangent).normalize();
  for(let j=0;j<sides;j++){const angle=2*Math.PI*j/sides,n=normal.clone().multiplyScalar(Math.cos(angle)).addScaledVector(binormal,Math.sin(angle)),p=path[i].clone().addScaledVector(n,sectionRadii[i]);vertices.push(p.x,p.y,p.z);normals.push(n.x,n.y,n.z);}
  if(i)for(let j=0;j<sides;j++){const a=(i-1)*sides+j,b=(i-1)*sides+(j+1)%sides,c=i*sides+j,d=i*sides+(j+1)%sides;indices.push(a,c,b,b,c,d);}
  previousTangent=tangent;
 }
 const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));geometry.setIndex(indices);geometry.computeBoundingBox();geometry.computeBoundingSphere();return geometry;
}
function addRoute(data,kind,index=0){
 data=controllerClipOverrides.get(data.id)||data;
 if(!data||!Array.isArray(data.points_blender_m)||data.points_blender_m.length<2){loadWarnings.push((data?.name||kind)+'：没有有效采样点，未创建线路');return null;}
 const raw=data.points_blender_m;if(raw.some(p=>!Array.isArray(p)||p.length<3||!p.slice(0,3).every(Number.isFinite)))throw new Error('线路采样坐标无效');
 const polarity=kind==='positive'?'positive':kind==='negative'?'negative':data.polarity;
 const color=Array.isArray(data.color_rgba)?new THREE.Color(...data.color_rgba.slice(0,3)):polarity==='positive'?0xb6140e:polarity==='negative'?0x15191c:(data.color||0x576970);
 const name=data.name||data.title||(kind==='positive'?'B 正极尾插 → D 正极铜排':kind==='negative'?'A 负极尾插 → C 负极铜排':'周边供电线 '+(index+1));
 const points=raw.map(toWeb),radius=Number(data.radius_m)||.0035;
 const mesh=new THREE.Mesh(sampledTube(points,radius,data.radii_m?24:12,data.radii_m),mat(color));mesh.name=name;wireGroup.add(mesh);
 const route={id:data.id||kind+'-'+index,kind,polarity,name,data,points,mesh,enabled:true,stubs:[],button:null};routes.push(route);
 if(data.terminal_geometry){const t=data.terminal_geometry,g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(t.vertices_blender_m.flatMap(p=>[p[0],p[2],-p[1]]),3));const idx=[];for(const f of t.faces)for(let j=1;j<f.length-1;j++)idx.push(f[0],f[j],f[j+1]);g.setIndex(idx);g.computeVertexNormals();const terminal=new THREE.Mesh(g,mat(0xb6b7b5));terminal.material.side=THREE.DoubleSide;wireGroup.add(terminal);route.stubs.push(terminal);}
 // 仅处理数据明确列出的旧线段、端子和线卡，不自动添补其他线路。
 for(const name of (data.hide_original_objects||[]).filter(n=>!isCover(n)))for(const o of findObjects(name)){o.visible=false;originallyHidden.add(o);}
 const stub=data.C_stub||data.D_stub||data.stub;
 if(stub?.preserve_existing!==false&&stub?.object_name)styleObjects(stub.object_name,mesh.material,route);
 const terminals=[data.retained_terminal_object_name,data.terminal_object_name,stub?.retained_terminal_object_name,stub?.terminal_object_name].filter(Boolean);
 styleObjects(terminals,mat(0xb6b7b5));styleObjects(data.clip_object_name,mat(0x3c484b));styleObjects(data.housing_clip_object_name,mat(0x22282c));styleObjects(data.housing_object_name,mat(0x444b4d));
 for(const entry of data.objects||[]){if(!entry||typeof entry!=='object')continue;styleObjects(entry.object_name||entry.name,mat(entry.color||0x444b4d));}
 const markDefs=kind==='positive'?[['E','entry_blender_m','正极梁后端入口'],['F','exit_blender_m','正极内侧出线孔'],['G','clip_blender_m','正极梁侧卡线槽'],['H','housing_clip_blender_m','正极壳体线卡']]:kind==='negative'?[['N1','entry_blender_m','负极梁后端入口'],['N2','exit_blender_m','负极内侧出线孔'],['N3','clip_blender_m','负极梁侧卡线槽'],['N4','housing_clip_blender_m','负极壳体线卡']]:[];
 for(const[code,key,title]of markDefs)if(Array.isArray(data[key]))rows.push(makeMarker(code,title,toWeb(data[key]).toArray(),route.id));
 const item=document.createElement('div');item.className='route-item';const check=document.createElement('input');check.type='checkbox';check.checked=true;check.setAttribute('aria-label','显示'+name);check.onchange=()=>{setRouteEnabled(route,check.checked);syncWires();};const button=document.createElement('button');button.textContent=name;button.onclick=()=>viewRoute(route);item.append(check,button);const arm=armForView(kind);const list=$(arm?(arm==='m1'?'#arm-route-items':'#'+arm+(data.system==='spray'?'-spray':'')+'-route-items'):'#route-items');list.append(item);route.button=button;route.checkbox=check;
 return route;
}
function armMaterial(spec,sleeve=false){return new THREE.MeshStandardMaterial({
 color:new THREE.Color(...spec.color_rgba.slice(0,3)),metalness:spec.metalness??0,roughness:spec.roughness??.48,
 transparent:sleeve,opacity:sleeve?.18:1,depthWrite:!sleeve,
});}
function applyArmNativeStyles(entries=[]){
 for(const {object_name,material} of entries){
  const objects=findObjects(object_name),style=armMaterial(material);
  if(!objects.length)missingNodes.push(object_name);
  for(const object of objects)object.traverse(mesh=>{
   if(mesh.isMesh)mesh.material=mesh.userData.armNativeMaterial=style;
  });
 }
}
const fixedHarnessParts=[];
function addArmPart(data){
 const geometry=new THREE.BufferGeometry();
 const update=partEndpointUpdates.get(data.id);
 const positions=data.vertices_blender_m.flatMap((vertex,index)=>{
  const [x,y,z]=update?.get(index)||vertex;
  return [x,z,-y];
 });
 geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));
 const batches=data.materials.map(()=>[]);
 data.faces.forEach((face,index)=>{const batch=batches[data.material_indices[index]];for(let j=1;j<face.length-1;j++)batch.push(face[0],face[j],face[j+1]);});
 const indices=[];
 batches.forEach((batch,index)=>{geometry.addGroup(indices.length,batch.length,index);for(const value of batch)indices.push(value);});
 geometry.setIndex(indices);geometry.computeVertexNormals();
 const sleeve=data.display==='sleeve';
 const materials=data.materials.map(spec=>armMaterial(spec,sleeve));
 if(data.object_name){
  const targets=findObjects(data.object_name);
  if(!targets.length)missingNodes.push(data.object_name);
  for(const target of targets){
   target.updateWorldMatrix(true,true);
   target.traverse(mesh=>{
    if(!mesh.isMesh)return;
    mesh.geometry=geometry.clone().applyMatrix4(mesh.matrixWorld.clone().invert());
    mesh.material=mesh.userData.armNativeMaterial=materials;
   });
  }
  return;
 }
 const mesh=new THREE.Mesh(geometry,materials);
 mesh.name=data.name;
 mesh.userData.harnessPartId=data.id;
 wireGroup.add(mesh);
 if(sleeve)armSleeves.push({mesh,memberIds:data.member_route_ids});
 else if(data.display==='fixture')fixedHarnessParts.push({mesh,memberIds:data.member_route_ids});
 else routes.find(route=>route.id===data.route_id).stubs.push(mesh);
}
function addHarnessAssemblies(entries=[]){
 const byId=new Map(routes.flatMap(route=>[[route.id,route],[route.name,route]]));
 for(const entry of entries){
  const members=entry.route_ids.map(id=>byId.get(id));
  if(!members.length||members.some(route=>!route)){
   loadWarnings.push(entry.name+'：线束总成缺少线段');
   continue;
  }
  const harness={...entry,members};
  for(const member of members)member.harness=harness;
  const [primary,...secondary]=members;
  primary.button.textContent=entry.name;
  primary.checkbox.setAttribute('aria-label','显示'+entry.name);
  for(const member of secondary)member.checkbox.parentElement.remove();
  for(const part of entry.native_parts||[]){
   const objects=findObjects(part.object_name);
   if(!objects.length)missingNodes.push(part.object_name);
   const meshes=new Set();
   for(const object of objects)object.traverse(mesh=>{if(mesh.isMesh)meshes.add(mesh);});
   for(const mesh of meshes){
    const original=mesh.userData.armNativeMaterial||mesh.material;
    const material=part.material?armMaterial(part.material):Array.isArray(original)?original.map(item=>item.clone()):original.clone();
    mesh.material=mesh.userData.armNativeMaterial=material;
    mountWireMesh(mesh);
    const stubs=byId.get(part.route_id).stubs;
    if(!stubs.includes(mesh))stubs.push(mesh);
   }
  }
 }
}
function setRouteEnabled(route,enabled){
 for(const member of route.harness?.members||[route])member.enabled=enabled;
}
function syncWires(){
 const arm=armForView(currentView);
 const whole=currentView==='wiring-all';
 const rearSide=currentView.startsWith('rear-esc:')?currentView.slice(9):null;
 const sprayCloseup=sprayView(currentView);
 const phaseCloseup=armCloseups[currentView]?.circuit==='phase';
 const showMateDetail=sprayFrontView(currentView)||sprayPortView(currentView);
 const mate=showMateDetail?toWeb(sprayWorkReview.mount.center_blender_m):null;
 const tankOutward = mate && sprayWorkReview.mount.tank_side === 'right' ? -1 : 1;
 const tankMateSection=mate?[
  new THREE.Plane(new THREE.Vector3(tankOutward,0,0),-tankOutward*mate.x-.030),
  new THREE.Plane(new THREE.Vector3(-tankOutward,0,0),tankOutward*mate.x+.054),
  new THREE.Plane(new THREE.Vector3(0,0,1),-mate.z+.014),
  new THREE.Plane(new THREE.Vector3(0,0,-1),mate.z+.014),
  new THREE.Plane(new THREE.Vector3(0,1,0),-mate.y+.014),
  new THREE.Plane(new THREE.Vector3(0,-1,0),mate.y+.014)
 ]:null;
 const existingSegments=armReviews[arm]?.existing_segment_names;
 const focus=controllerFocus(currentView);
 const inView=r=>{
  if(whole)return true;
  if(focus)return focus.route_ids.includes(r.id);
  if(controllerPeripheralView(currentView))return r.kind==='controller-peripheral';
  if(r.kind==='controller-peripheral')return false;
  if(controllerClipView(currentView))return controllerClipOverrides.has(r.id)||controllerClipReview.related_route_ids.includes(r.id);
  if(sprayTankView(currentView))return r.harness?.id==='spray-tank-24p-harness';
  if(sprayWorkView(currentView))return isSprayWork(r);
  if(r.kind==='spray-work')return false;
  if(currentView==='tail-signal')return isTailSignalRun(r);
  if(currentView==='fc205')return is205Harness(r);
  if(currentView==='tail-signal-port')return routes.some(is205Trunk)?is205Trunk(r):is205Harness(r);
  if(r.data.circuit==='fc205-power'||is205Trunk(r))return false;
  if(r.data.circuit==='battery-signal')return currentView==='arm-m4-tail-a'||currentView==='arm-m4-tail';
  const routeArm=armForView(r.harness?.members[0]?.kind||r.kind);
  if(rearSide)return routeArm===rearSide&&(valveFocus?r.data.circuit==='spray-valve':(!sprayCloseup||r.data.system==='spray'));
  if(currentView.startsWith('arm-m4-tail')){
   const polarity=currentView.endsWith('-a')?'negative':currentView.endsWith('-b')?'positive':null;
   if(polarity)return r.kind===polarity||(r.id.startsWith('tail-M')&&r.id.endsWith('-'+polarity));
   return r.id.startsWith('tail-M')||['positive','negative'].includes(r.kind);
  }
  if(currentView==='arm-m4-beam')return ['tail-M4-positive','tail-M3-negative'].includes(r.id);
  if(currentView==='arm-m4-spray-power')return routeArm==='m4'&&r.data.circuit==='spray-power';
  if(phaseCloseup)return routeArm===arm&&r.data.circuit==='phase';
  if(routeArm)return routeArm===arm&&(r.data.system!=='spray'||r.harness?.shared);
  return !existingSegments||existingSegments.includes(r.name);
 };
 for(const r of routes){
  const groupInView=(r.harness?.members||[r]).some(inView);
  r.checkbox.checked=r.enabled;r.checkbox.disabled=!groupInView;
  if(r.checkbox.parentElement)r.checkbox.parentElement.hidden=!groupInView&&(controllerDetailView(currentView)||tailSignalView(currentView)||sprayWorkView(currentView)||Boolean(rearSide&&rearArms[armForView(r.kind)]));
  r.mesh.visible=inView(r)&&wiresVisible&&r.enabled;
  const tankRoute=r.harness?.id==='spray-tank-24p-harness';
  if(tankRoute)r.mesh.material.clippingPlanes=tankMateSection;
  r.mesh.layers.set(useWireOverlay()?1:0);
  for(const stub of r.stubs){
   const referenceMate=currentView==='battery-106-seat'&&wiresVisible&&
      ['work-24p-body-half','work-24p-tank-half'].includes(stub.userData.harnessPartId);
   const contextPart=wiresVisible&&r.enabled&&focus?.context_part_ids?.includes(stub.userData.harnessPartId);
   stub.visible=Boolean(contextPart)||referenceMate||(r.mesh.visible&&(!showMateDetail||!tankRoute||stub.userData.harnessPartId==='work-24p-tank-half'));
   stub.layers.set(r.mesh.layers.isEnabled(1)?1:0);
  }
 }
 for(const {mesh,memberIds} of fixedHarnessParts){
  mesh.visible=whole||Boolean(focus?.route_ids.some(id=>memberIds.includes(id)));
 }
 for(const {mesh,memberIds} of armSleeves){
  const covered=memberIds
   ?memberIds.every(id=>routes.some(r=>r.id===id&&r.mesh.visible))
   :routes.some(r=>r.kind==='arm-m1'&&r.data.circuit!=='presence'&&r.mesh.visible);
  mesh.visible=covered&&!armCloseups[currentView]?.circuit;
 }
 for(const marker of rows.filter(r=>r.sprayMarker&&r.routeId)){
  marker.label.hidden=!sprayCloseup||marker.arm!==rearSide||(valveFocus&&!marker.code.endsWith('集线'))||!routes.some(r=>r.id===marker.routeId&&r.mesh.visible);
 }
 for(const o of originallyHidden)o.visible=false;
 $('#wire-toggle').textContent=wiresVisible?'线路：显示':'线路：隐藏';$('#wire-toggle').setAttribute('aria-pressed',wiresVisible);
 updateStatus();
}
function updateStatus(){
 const visible=routes.filter(r=>r.mesh.visible).length;
 const baseline=routes.filter(r=>!armForView(r.kind)&&!['tail-signal','spray-work'].includes(r.kind)).length;
 const m1Count=routes.filter(r=>r.kind==='arm-m1').length;
 const m2=armForView(currentView)==='m2';
 let status;
 if(currentView==='wiring-all')status=`显示 ${visible} / ${routes.length} 段线束`;
 else if(controllerFocus(currentView)?.route_ids.includes('fc101-gps'))status=visible?'101 GPS 已接至主天线板端。':'线路已隐藏。';
 else if(currentView==='pending-105'||currentView.startsWith('weight-105'))status=visible?'105 已接通 · 三路在主控下方汇束。':'线路已隐藏。';
 else if(currentView==='pending-207'||currentView.startsWith('radar-207')){
  const radarVisible=routes.some(route=>route.data.port==='207'&&route.mesh.visible);
  status=radarVisible?'207 已贯通主控至后旋转雷达。':'207 线路已隐藏。';
 }
 else if(currentView==='fan-202'||currentView==='pending-fan')status=visible?'P3 已对插，上下两台风扇均已接入。':'线路已隐藏。';
 else if(currentView==='fan-202-lower')status=visible?'下方尾线已接入外壳。':'线路已隐藏。';
 else if(currentView==='led-202')status=visible?'202 主线、P4 封口及 P3 风扇支路。':'线路已隐藏。';
 else if(currentView.startsWith('rf-gps-')&&currentView.endsWith('-seat'))status=visible?'馈线已直插天线壳内圆形座。':'线路已隐藏。';
 else if(currentView==='rf-gps-link'||currentView==='rf-gps-mate')status=visible?'GPS-M 与 GPS-S 已对插。':'线路已隐藏。';
 else if(currentView.startsWith('rf-gps-'))status=visible?'GPS 馈线 · 出线到对插。':'线路已隐藏。';
 else if(currentView==='rf-controller-lead')status='由左至右：2.4G、2.4G、4G、4G、Wi‑Fi。';
 else if(currentView==='rf-wifi-main')status=visible?'第 5 路 Wi‑Fi 已接 GPS 主天线。':'线路已隐藏。';
 else if(rfFocus(currentView))status=visible?'射频馈线 · '+visible+' 段显示。':'线路已隐藏。';
 else if(currentView==='tail-signal-p3')status=visible?'P3 已对插 · 位于右纵梁后段。':'线路已隐藏。';
 else if(controllerFocus(currentView))status=controllerFocus(currentView).route_ids.length?
    (visible?'显示 '+visible+' 段线束。':'线路已隐藏。'):'接口位置';
 else if(controllerPeripheralView(currentView)){
  const accepted=routes.filter(r=>r.kind==='controller-peripheral');
  const ids=list=>new Set(list.map(r=>r.harness?.id||r.id)).size;
  status=visible?'显示 '+ids(accepted.filter(r=>r.mesh.visible))+' / '+ids(accepted)+' 组已建线束。':'线路已隐藏。';
 }
 else if(controllerClipView(currentView))status=visible?'两侧红黑供电各用一个原槽。':'线路已隐藏。';
 else if(sprayWorkView(currentView))status=visible?(sprayPortView(currentView)?'机尾朝机头看 · 左机体线束与右喷洒总线对插。':sprayFrontView(currentView)?'204 信号与红黑供电从左前穿出，左侧并束接 24 针。':sprayTankView(currentView)?'药箱侧 · 左泵、右泵、流量计、气压计。':'喷洒总线 · 机体侧接 204 与铜排，药箱侧分四路。'):'喷洒线路已隐藏。';
 else if(currentView==='fc205'||currentView==='tail-signal-port')status=visible?'主控 205 · 红黑供电和尾插通讯并为一束，由黑色护套接入弯头。':'205 线束总成已隐藏。';
 else if(tailSignalView(currentView))status=visible?'尾插信号线 · A 负极尾插 → 右纵梁 → 主控 205。':'尾插信号线已隐藏。';
 else if(valveFocus)status=visible?rearArm(currentView).toUpperCase()+' 电磁阀集线器 · 1 路输入、2 路阀线。':'电磁阀线束已隐藏。';
 else if(sprayView(currentView)){
  const shown=new Set(routes.filter(r=>r.mesh.visible).map(r=>r.harness?.id||r.id));
  status=`${rearArm(currentView).toUpperCase()} 喷头电调 · 显示 ${shown.size} 项线束。`;
 }
 else if(currentView.startsWith('rear-esc:'))status='已标出同侧两类电调。';
 else if(armCloseups[currentView]?.circuit==='phase')status=`${armForView(currentView).toUpperCase()} 电调至电机 · 显示 ${visible} 根相线。`;
 else if(rearArms[armForView(currentView)])status=`${rearArms[armForView(currentView)].name} · 显示 ${visible} 段线路。`;
 else if(m2)status=`M2 左前线束 · 当前显示 ${visible} 段。`;
 else status=`M1 线束 ${m1Count} 段 · 供电周边 ${baseline} 段 · 当前显示 ${visible} 段。`;
 $('#status').textContent=status;
 $('#negative').disabled=!routes.some(r=>r.kind==='negative');$('#route').disabled=!routes.some(r=>r.kind==='positive');
}
function framingPoints(mode,route){
 const focus=controllerFocus(mode);
 if(focus)return focus.points_blender_m.map(toWeb);
 if(controllerPeripheralView(mode)){
  const {markers,pending}=controllerClipReview.peripheral;
  return [...markers,...pending].map(item=>toWeb(item.point_blender_m))
    .concat([toWeb([0,-.452,.275]),toWeb([.095,-.347,.100])]);
 }
 if(controllerClipView(mode)){
  const marked=controllerClipReview.markers.map(m=>toWeb(m.point_blender_m));
  return marked.concat([toWeb([-.166,-.282,.198]),toWeb([.178,-.262,.073])]);
 }
 if(valveFocus){
  const arm=rearArm(mode),hub=valveHubReview[arm],bbox=new THREE.Box3();
  for(const obj of findObjects(hub?.bracket_object_name))bbox.expandByObject(obj);
  const points=routes.filter(r=>r.data.arm===arm&&r.data.circuit==='spray-valve').flatMap(r=>r.points);
  if(!bbox.isEmpty())points.push(bbox.min,bbox.max);
  return points;
 }
 if(sprayPortView(mode)){
  const center=toWeb(sprayWorkReview.mount.center_blender_m);
  const points=routes.filter(isSprayWork).flatMap(r=>r.points.filter(p=>p.distanceTo(center)<.074));
  return [center,...points];
 }
 if(sprayFrontView(mode))return [
  ...rows.filter(r=>r.sprayWorkMarker&&r.frontRoute).map(r=>new THREE.Vector3(...r.point)),
  ...routes.filter(r=>sprayWorkReview.front_routing.route_ids.includes(r.id)).flatMap(r=>r.points)
 ];
 if(sprayTankView(mode))return routes.filter(r=>r.harness?.id==='spray-tank-24p-harness').flatMap(r=>r.points);
 if(sprayWorkView(mode))return rows.filter(r=>r.sprayWorkMarker&&!r.closeOnly).map(r=>new THREE.Vector3(...r.point)).concat(routes.filter(isSprayWork).flatMap(r=>r.points));
 if(mode==='wiring-all')return routes.flatMap(r=>r.points).concat(rearEscs.map(r=>new THREE.Vector3(...r.point)));
 if(mode.startsWith('rear-esc:')){
  const box=new THREE.Box3();
  const nodes=rearEscs.filter(r=>r.arm===mode.slice(9)).map(r=>r.node);
  if(sprayView(mode))nodes.push(...sprayModules(rearArm(mode)).filter(n=>n.endsWith('inner')||n.endsWith('outer')));
  for(const node of nodes)for(const object of findObjects(node))box.expandByObject(object);
  if(sprayView(mode)){
   for(const phase of routes.filter(r=>r.data.arm===rearArm(mode)&&['spray-phase','spray-valve','valve'].includes(r.data.circuit))){
    box.union(phase.mesh.geometry.boundingBox);
   }
  }
  return box.isEmpty()?[]:[box.min,box.max];
 }
 const detail=armCloseups[mode];
 if(detail?.fitTailSignal)return routes.filter(r=>mode==='fc205'?is205Harness(r):isTailSignalRun(r)).flatMap(r=>r.points);
 if(detail?.fitCircuit)return routes.filter(r=>r.kind==='arm-'+armForView(mode)&&r.data.circuit===detail.circuit).flatMap(r=>r.points);
 if(detail?.codes)return rows.filter(r=>detail.codes.includes(r.code)).map(r=>new THREE.Vector3(...r.point));
 if(detail){
  const marker=rows.find(r=>r.code===detail.code),center=new THREE.Vector3(...marker.point);
  if(tailSignalView(mode)){
   const wires=routes.filter(is205Harness),box=new THREE.Box3();
   for(const wire of wires)for(const stub of wire.stubs){
    const bounds=new THREE.Box3().setFromObject(stub);
    if(!bounds.isEmpty()&&bounds.distanceToPoint(center)<detail.radius)box.union(bounds);
   }
   return [center,...(box.isEmpty()?[]:[box.min,box.max]),...wires.flatMap(wire=>wire.points.filter(p=>p.distanceTo(center)<detail.radius))];
  }
  if(detail.fitNodes){
   const box=new THREE.Box3();
   for(const object of marker.nodes.flatMap(findObjects))box.expandByObject(object);
   if(!box.isEmpty()){
    if(detail.offset)box.translate(new THREE.Vector3(...detail.offset));
    return [box.min,box.max];
   }
  }
  return [center,...routes.filter(r=>armForView(r.kind)===armForView(mode)&&(!detail.circuit||r.data.circuit===detail.circuit)).flatMap(r=>r.points.filter(p=>p.distanceTo(center)<detail.radius))];
 }
 if(mode==='arm-m3'||mode==='arm-m4'){
  const arm=armForView(mode);
  return rows.filter(r=>r.arm===arm&&(!r.detailView||mode==='arm-m4')).map(r=>new THREE.Vector3(...r.point))
   .concat(routes.filter(r=>r.kind===mode&&r.data.circuit==='phase').flatMap(r=>r.points));
 }
 if(mode==='arm-m1'||mode==='arm-m2'){const arm=armForView(mode),p=rows.filter(r=>r.arm===arm&&!r.detailView).map(r=>new THREE.Vector3(...r.point));for(const o of findObjects(arm==='m2'?'EVO_drive-lf-esc':'EVO_drive-rf-esc')){const b=new THREE.Box3().setFromObject(o);if(!b.isEmpty())for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z])p.push(new THREE.Vector3(x,y,z));}return p;}
 if(route&&mode.startsWith('shared-')){const ring=route.data.terminal_geometry?.ring_center_blender_m||route.data.ring_center_blender_m||route.data.points_blender_m[0],clip=route.data.housing_clip_blender_m||route.data.clip_blender_m;return [ring,clip].filter(Boolean).map(toWeb);}
 if(route){
  const codes=route.kind==='positive'?['B','D']:route.kind==='negative'?['A','C']:['C','D'];
  const points=route.points.concat(rows.filter(r=>r.routeId===route.id||codes.includes(r.code)).map(r=>new THREE.Vector3(...r.point)));
  const objects=rows.filter(r=>codes.includes(r.code)).flatMap(r=>r.meshes).concat(findObjects(route.data.housing_object_name));
  for(const object of objects){const box=new THREE.Box3().setFromObject(object);if(!box.isEmpty())for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z));}
  return points;
 }
 if(mode==='side')return rows.filter(r=>['C','D'].includes(r.code)).map(r=>new THREE.Vector3(...r.point));
 const points=rows.filter(r=>!r.review&&!r.tailSignalMarker&&!r.sprayWorkMarker&&!['L','R'].includes(r.code)).map(r=>new THREE.Vector3(...r.point));for(const r of routes)if(!armForView(r.kind)&&!['tail-signal','spray-work'].includes(r.kind))points.push(...r.points);return points;
}
function frame(points,direction,margin=1.45,minSize=.14){
 const box=new THREE.Box3().setFromPoints(points);
 if(box.isEmpty()){box.min.set(-.25,-.1,-.48);box.max.set(.25,.15,-.18);}
 const center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
 if(currentView==='wiring-all'){
  const fuselage=new THREE.Box3();
  for(const part of findObjects('EVO_structure-frame'))fuselage.expandByObject(part);
  if(!fuselage.isEmpty()){
   const pivot=fuselage.getCenter(new THREE.Vector3());
   size.x+=2*Math.abs(center.x-pivot.x);size.z+=2*Math.abs(center.z-pivot.z);
   center.x=pivot.x;center.z=pivot.z;
  }
 }
 let vertical=Math.max(size.y,size.x/camera.aspect,size.z,minSize);
 if((currentView==='tail-signal'||currentView==='fc205'||sprayWorkView(currentView))&&points.length){
  const normal=direction.clone().normalize(),right=new THREE.Vector3(0,1,0).cross(normal).normalize(),up=normal.clone().cross(right);
  let halfW=0,halfH=0;
  for(const p of points){
   const d=p.clone().sub(center);
   halfW=Math.max(halfW,Math.abs(d.dot(right)));
   halfH=Math.max(halfH,Math.abs(d.dot(up)));
  }
  vertical=Math.max(2*halfH/.75,2*halfW/camera.aspect,minSize);
 }
 const distance=vertical/(2*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)))*margin;
 // Flush pending rotation and pan before switching to a preset.
 controls.enableDamping=false;controls.update();
 camera.position.copy(center).addScaledVector(direction.clone().normalize(),distance);
 controls.target.copy(center);controls.minDistance=.025;controls.maxDistance=5;controls.update();
 controls.enableDamping=true;
}
function activeRoute(){if(currentView.startsWith('shared-'))return sharedRoute(currentView);return currentView.startsWith('route:')?routes.find(r=>r.id===currentView.slice(6)):null;}
function showSelection(text=''){
 const selection=$('#route-selection');
 selection.textContent=text;
 selection.hidden=!text;
}
function viewRoute(route){
 if(!route)return;
 if(route.kind==='controller-peripheral'){
  const isFanHarness=route.harness?.id==='fc202-fan-harness';
  const rfView=route.id.includes('-l-')?'rf-left':'rf-right';
  const peripheralViews={
   '101':'gps-101','102':'audit-fpv','103':'lidar-103','104':'audit-front-radar',
   '105':'weight-105','106':'battery-106','202':'led-202','207':'radar-207'
  };
  let mode=peripheralViews[route.data.port];
  if(route.id.startsWith('rf-gps-'))mode='rf-gps-link';
  else if(route.id==='rf-wifi-main')mode='rf-wifi-main';
  else if(route.id.startsWith('rf-24g-')&&route.id.endsWith('-antenna'))mode='rf-underframe';
  else if(route.data.port==='RF')mode=rfView;
  else if(isFanHarness)mode='fan-202';
  view(controllerFocus(mode)?mode:'controller-peripheral',route);return;
 }
 setRouteEnabled(route,true);wiresVisible=true;
 if(currentView==='wiring-all'){
  highlightRoute(route);
  showSelection(route.harness?.name||route.name);
  syncWires();
  return;
 }
 if(isSprayWork(route)&&sprayWorkReview){view('spray-work');return;}
 if(is205Harness(route)){
  const mode=tailSignalView(currentView)?currentView:routes.some(r=>r.data.circuit==='fc205-power')?'fc205':'tail-signal';
  view(mode,route);
  return;
 }
 if(route.data.system==='spray'&&rearArms[armForView(route.kind)]){view('rear-esc:'+armForView(route.kind),route);return;}
 if(route.harness?.shared&&sprayView(currentView)){view(currentView,route);return;}
 const arm=armForView(route.kind);
 if(!arm){
  if(armForView(currentView)==='m3'&&armReviews.m3.existing_segment_names?.includes(route.name)){
   view('arm-m3-tail',route);
  }else view('route:'+route.id);
  return;
 }
 const closeup=Object.keys(armCloseups).find(key=>armForView(key)===arm&&armCloseups[key].circuit===route.data.circuit);
 view(closeup||({m2:'arm-m2-port',m3:'arm-m3',m4:'arm-m4'})[arm]||'arm-m1',route);
}
function highlightRoute(route){
 for(const r of routes){
  const linked=currentView==='wiring-all'&&route&&(r.name===route.data.continued_from||r.data.continued_from===route.name);
  const sameHarness=Boolean(route?.harness&&r.harness===route.harness);
  const active=r===route||linked||sameHarness;
  r.button?.classList.toggle('active',active);
  r.mesh.material.emissive.copy(r.mesh.material.color);
  r.mesh.material.emissiveIntensity=active?.36:0;
  r.mesh.material.roughness=active?.3:.5;
  if(r.harness){
   for(const stub of r.stubs)for(const material of [].concat(stub.material)){
    if(!material.emissive)continue;
    material.emissive.copy(material.color);
    material.emissiveIntensity=active?.36:0;
   }
  }
 }
}
function view(mode,armRoute=null,focusValve=false){
 if(systemView)return;
 currentView=mode;valveFocus=focusValve&&Boolean(valveHubReview[rearArm(mode)]);selected=null;applyReviewContext(mode);solidCheck=false;$('#solid-check').textContent='纵梁：透视';const route=armRoute||activeRoute();
 const detail=armCloseups[mode],arm=armForView(mode),whole=mode==='wiring-all';
 const focus=controllerFocus(mode);
 const focusPanel=$('#controller-focus-tools');
 const rfReview=rfFocus(mode);
 const auditView=mode.startsWith('audit-')||mode==='tail-signal-p3';
 document.body.classList.toggle('external-audit-view',auditView);
 focusPanel.hidden=rfReview||auditView||!(focus||controllerPeripheralView(mode));
 const rfPanel=$('#rf-focus-tools');
 rfPanel.hidden=!rfReview;
 document.body.classList.toggle('rf-review',rfReview);
 for(const button of rfPanel.querySelectorAll('button[data-view]')){
  if('gpsRfFocus' in button.dataset)button.hidden=!mode.startsWith('rf-gps-');
  button.classList.toggle('active',button.dataset.view===(mode==='pending-rf'?'rf-feeders':mode));
 }
 for(const b of focusPanel.querySelectorAll('button[data-view]')){
  b.classList.toggle('active',b.dataset.view===mode);
  if(b.dataset.view==='controller-peripheral')b.hidden=!focus;
  if('gpsFocus' in b.dataset)b.hidden=!focus?.route_ids.includes('fc101-gps');
  if('weightFocus' in b.dataset)b.hidden=currentView.startsWith('radar-207')||!focus?.route_ids.some(id=>id.startsWith('fc105-weight-'));
  if('radarFocus' in b.dataset)b.hidden=!focus?.route_ids.some(id=>id.startsWith('fc207-rear-radar-'));
 }
 const rearSide=mode.startsWith('rear-esc:')?mode.slice(9):null;
 document.body.classList.toggle('whole-wiring',whole);
 document.body.classList.toggle('tail-signal-view',tailSignalView(mode));
 document.body.classList.toggle('spray-work-view',sprayWorkView(mode));
 document.body.classList.toggle('controller-clip-view',controllerDetailView(mode));
 $('#controller-peripheral').classList.toggle('active',controllerPeripheralView(mode));
 $('#controller-rf-review').hidden=!controllerPeripheralView(mode);
 $('#battery106-view').classList.toggle('active',mode==='battery-106'||mode==='battery-106-seat');
 $('#rf-feeders-view').classList.toggle('active',rfFocus(mode));
 $('#power-base-panel').hidden=Boolean(focus&&!focus.route_ids.length);
 $('#controller-clips').classList.toggle('active',controllerClipView(mode));
 document.body.classList.toggle('rear-esc-view',Boolean(rearSide));
 document.body.classList.toggle('rear-arm-view',Boolean(rearArms[arm]));
 $('#wiring-all').classList.toggle('active',whole);
 const valveButton=$('#valve-focus-toggle');
 valveButton.hidden=!sprayView(mode)||!valveHubReview[rearSide];
 valveButton.textContent=valveFocus?'返回喷头电调':'集线器定位';
 valveButton.classList.toggle('active',valveFocus);
 valveButton.onclick=()=>view(mode,null,!valveFocus);
 $('#tail-signal-view').classList.toggle('active',mode==='tail-signal');
 $('#fc205-view').classList.toggle('active',mode==='fc205');
 $('#spray-work-view').classList.toggle('active',mode==='spray-work');
 $('#spray-work-port').hidden=!sprayWorkView(mode);
 $('#spray-work-front').hidden=!sprayWorkView(mode);
 $('#spray-work-front').classList.toggle('active',sprayFrontView(mode));
 $('#spray-work-tank').hidden=!sprayWorkView(mode);
 $('#spray-work-tank').classList.toggle('active',sprayTankView(mode));
 $('#spray-work-port').classList.toggle('active',sprayPortView(mode));
 $('#tail-signal-port').hidden=!tailSignalView(mode);
 $('#tail-signal-port').classList.toggle('active',mode==='tail-signal-port');
 $('#tail-signal-p3').hidden=!tailSignalView(mode);
 $('#wiring-legend').hidden=!whole;
 $('#power-base-panel h2').textContent=controllerDetailView(mode)?'主控相关线束':sprayWorkView(mode)?'机体与药箱线束':tailSignalView(mode)?'205 线束总成':'铜排与尾插线路';
 $('#rear-esc-items').hidden=!(whole||rearSide||rearArms[arm])||!rearEscs.length;
 for(const key of Object.keys(rearArms)){
  $('#'+key+'-review-panel').hidden=!(whole||arm===key||rearSide===key)||!armReviews[key];
  $('#'+key+'-spray-group').hidden=!(whole||rearSide===key||mode==='arm-'+key+'-spray-power')||!hasSpray(key);
  $('#arm-'+key).classList.toggle('active',arm===key&&mode!=='arm-'+key+'-phase');
  $('#arm-'+key+'-phase').classList.toggle('active',mode==='arm-'+key+'-phase');
 }
 $('#m2-review-panel').hidden=!(whole||arm==='m2')||!armReviews.m2;
 $('#m1-review-panel').hidden=Boolean(rearSide)||arm==='m2'||Boolean(rearArms[arm])||tailSignalView(mode)||sprayWorkView(mode)||controllerDetailView(mode);
 $('#arm-review-title').textContent=focus?focus.title:whole?'整机走线':controllerPeripheralView(mode)?'主控接口总览':controllerClipView(mode)?'主控后侧线卡':sprayWorkView(mode)?(sprayFrontView(mode)?'机头前侧走线':'喷洒总线'):mode==='fc205'||mode==='tail-signal-port'?'主控 205 线束':tailSignalView(mode)?'尾插信号线':rearSide?rearSide.toUpperCase()+(sprayView(mode)?' 喷头电调线束':' 电调位置'):rearArms[arm]?.name||(arm==='m2'?'M2 左前机臂':'M1 右前机臂');
 $('#arm-m2').classList.toggle('active',arm==='m2'&&mode!=='arm-m2-phase');$('#arm-m2-phase').classList.toggle('active',mode==='arm-m2-phase');$('#arm-m1').classList.toggle('active',arm==='m1'&&mode!=='arm-m1-phase');
 $('#arm-m1-phase').classList.toggle('active',mode==='arm-m1-phase');
 let direction=new THREE.Vector3(0,.9,-1.2),points=framingPoints(mode,route),margin=1.45;
 if(focus){
  direction.set(...focus.direction);
  margin=focus.margin;
 }
 if(controllerPeripheralView(mode)){
  direction.set(.10,1,.84);
  margin=1.47;
 }
 if(controllerClipView(mode)){
  direction.set(0,.065,-1);
  margin=1.31;
 }
 if(mode==='front'){points=rows.filter(x=>['C','D','G','H','N3','N4'].includes(x.code)).map(x=>new THREE.Vector3(...x.point));direction.set(0,.08,1);margin=1.5;}
 if(mode==='top'||mode==='arm-'+arm){direction.set(0,1,-.20);if(isArmView(mode))margin=rearArms[arm]?1.93:1.65;}
 if(whole){
  direction.set(...(wholeAngle==='rear'?[-.24,1,-.54]:[0,1,-.22]));
  const height=stage.clientHeight;
  if(height)margin=Math.max(1.34,1.12*height/(height-wholeToolbarClearance(height)));
  else margin=1.34;
 }
 if(sprayWorkView(mode)){
  direction.set(...(sprayPortView(mode)?[.012,-.88,-.47]:sprayFrontView(mode)?[.025,.16,-.99]:sprayTankView(mode)?[.21,.31,1]:[.80,.55,.50]));
  margin=sprayPortView(mode)?1.34:1.42;
 }
 if(rearSide){direction.set(rearSide==='m3'?.60:-.60,.73,-.27);margin=1.30;}
 if(sprayView(mode)){direction.set(rearSide==='m3'?.68:-.68,.35,.79);margin=1.30;}
 if(valveFocus){direction.set(...valveHubReview[rearSide].review_camera_direction);margin=1.38;}
 if(mode==='rear')direction.set(-.4,.8,-1);
 if(mode==='side'){direction.set(.8,.25,-1);margin=2.1;}
 if(detail){direction.set(...detail.direction);margin=detail.margin??1.75;}
 if(route&&!focus&&!isArmView(mode)&&!whole&&!rearSide&&!tailSignalView(mode)){direction.set(route.kind==='negative'?.45:-.45,.9,-1);margin=1.85;}
 if(mode==='clip'){const r=routes.find(r=>r.kind==='positive');points=rows.filter(x=>['D','F','G','H'].includes(x.code)).map(x=>new THREE.Vector3(...x.point));direction.set(0,.15,1);margin=1.7;if(!r)return;}
 if(mode.startsWith('shared-')){if(!route)return;direction.set(.32,mode==='shared-negative'?.45:-.35,1);margin=1.75;setRouteEnabled(route,true);wiresVisible=true;syncWires();}
 const closeUp=mode.startsWith('shared-')||Boolean(detail)||sprayPortView(mode);
 updateProjection();
 frame(points,direction,margin,detail?.minSize??focus?.minSize??(closeUp ? .055 : .14));
 const allowed=mode.startsWith('shared-')?[]:mode==='front'?['C','D','G','H','N3','N4']:mode==='side'?['C','D']:mode==='clip'?['D','F','G','H']:route?(route.kind==='positive'?['B','D','L']:route.kind==='negative'?['A','C','R']:['A','B','C','D']):null;
 const hasDetailLabels=rows.some(r=>r.detailView===mode);
 for(const r of rows){
  if(r.rearEsc){r.label.hidden=valveFocus||!(whole||rearSide===r.arm)||Boolean(sprayView(mode)&&r.escType==='drive');r.button?.classList.toggle('active',rearSide===r.arm);continue;}
  if(r.sprayMarker){r.label.hidden=!sprayView(mode)||r.arm!==rearSide||(valveFocus&&!r.code.endsWith('集线'));continue;}
  if(r.controllerFocus){
   r.label.hidden=r.controllerFocus!==mode;
   continue;
  }
  if(r.controllerPeripheralMarker){
   r.label.hidden=!controllerPeripheralView(mode);
   continue;
  }
  if(r.controllerClipMarker){
   r.label.hidden=!controllerClipView(mode);
   continue;
  }
  if(controllerDetailView(mode)){r.label.hidden=true;continue;}
  if(r.sprayWorkMarker){r.label.hidden=!sprayWorkView(mode)||(sprayPortView(mode)?!(r.closeOnly||r.code==='24 针'):sprayFrontView(mode)?!r.frontRoute:r.closeOnly||r.frontOnly||(sprayTankView(mode)&&!['24 针','左泵','右泵','流量计','气压计'].includes(r.code)));continue;}
  if(r.tailSignalMarker){r.label.hidden=!tailSignalView(mode)||(mode==='tail-signal-port'&&r.code!=='205')||(r.powerOnly&&mode!=='fc205');continue;}
  if(tailSignalView(mode)||sprayWorkView(mode)){r.label.hidden=true;continue;}
  if(whole||rearSide){r.label.hidden=true;continue;}
  if(r.review&&detail?.codes)r.label.hidden=r.arm!==arm||!detail.codes.includes(r.code);
  else if(r.detailView)r.label.hidden=r.detailView!==mode&&r.code!==detail?.code;
  else if(r.review)r.label.hidden=r.arm!==arm||Boolean(detail&&(hasDetailLabels||r.code!==detail.code));
  else r.label.hidden=isArmView(mode)||Boolean(allowed&&!allowed.includes(r.code)&&r.routeId!==route?.id);
  r.label.style.opacity='1';r.button?.classList.remove('active');
  if(r.review&&(r.arm!==arm||detail?.circuit||(detail?.codes&&!detail.codes.includes(r.code))))continue;
  const markerMaterial=['L','R'].includes(r.code)||allowed&&!allowed.includes(r.code)?r.dim:r.mat;
  for(const mesh of r.meshes)mesh.material=mesh.userData.armNativeMaterial||markerMaterial;
 }
 highlightRoute(route);
 for(const r of routes){
  if(!armForView(r.kind))continue;
  const sharedTrunk=rearArms[arm]&&mode.endsWith('-signal')&&r.data.circuit==='spray-signal'&&r.harness?.shared;
  const dim=Boolean(detail?.circuit&&detail.circuit!==r.data.circuit&&!sharedTrunk);
  for(const mesh of [r.mesh,...r.stubs])for(const material of [].concat(mesh.material)){
   if(material.transparent!==dim)material.needsUpdate=true;
   material.transparent=dim;material.opacity=dim?.18:1;material.depthWrite=!dim;
  }
 }
 front.hidden=!whole&&(controllerDetailView(mode)||sprayWorkView(mode)||tailSignalView(mode)||!!route||Boolean(rearSide)||mode==='side'||mode==='clip'||mode==='front'||isArmView(mode));
 showSelection(route?.harness?.name||route?.name);
 applyCover();
 $('.note').textContent=focus?.title||detail?.title||(controllerPeripheralView(mode)?'主控接口定位':controllerClipView(mode)?'机尾朝机头看 · 主控后沿卡位与胶布':sprayWorkView(mode)?(sprayPortView(mode)?'机尾朝机头看 · 左机体线束 · 右喷洒总线':sprayFrontView(mode)?'机尾朝机头看 · 左前出线与左右对插':sprayTankView(mode)?'药箱侧 · 24 针分出四路':'喷洒总线 · 铜排及 204 至 24 针 · 药箱侧四路'):valveFocus?rearSide.toUpperCase()+' 电磁阀集线器':whole?'整机透视 · 拖动旋转 · 滚轮缩放':sprayView(mode)?rearSide.toUpperCase()+' 喷头电调 · 三相与电磁阀集线器':rearSide?rearSide.toUpperCase()+' · 动力电调与喷头电调':rearArms[arm]&&mode==='arm-'+arm?rearArms[arm].name+' · 线路与接口':mode==='arm-m2'?'M2 左前机臂线束 · 透视 · 机头朝上':mode==='arm-m1'?'M1 前机臂线束 · 透视 · 机头朝上':mode.startsWith('shared-')?(mode==='shared-negative'?'负极共享端子 · 上层线卡与同层走线':'正极共享端子 · 下层线卡与同层走线'):route?route.name:'铜排周边总览 · 两尾插、铜排及两侧固定点');
 syncWires();
}
function select(code){
 selected=code;const r=rows.find(x=>x.code===code);if(!r)return;
 if(r.review){
  const mode=r.focusView||r.detailView||Object.keys(armCloseups).find(key=>armCloseups[key].code===code);
  view(mode||'arm-'+r.arm);selected=code;showSelection(r.title);
 }
 if(code==='C'||code==='D')view('side');
 const detail=armCloseups[currentView];
 for(const item of rows){
  item.label.style.opacity=code===item.code||item.detailView===currentView?'1':'.5';
  item.button?.classList.toggle('active',code===item.code);
  if(item.review&&(item.arm!==armForView(currentView)||detail?.circuit||(detail?.codes&&!detail.codes.includes(item.code))))continue;
  for(const mesh of item.meshes)mesh.material=mesh.userData.armNativeMaterial||(code!==item.code?item.dim:item.mat);
 }
}
function markerLayout(visible,w,h){
 if(currentView==='rf-controller-lead'){
  const order=[...visible].sort((a,b)=>new THREE.Vector3(...a.point).project(camera).x-new THREE.Vector3(...b.point).project(camera).x);
  return new Map(order.map((r,i)=>[r.code,[.30+.10*i,.70*h,'center']]));
 }
 if(controllerFocus(currentView)){
  const projected=new Map(visible.map(r=>[r.code,new THREE.Vector3(...r.point).project(camera)]));
  const order=[...visible].sort((a,b)=>projected.get(a.code).x-projected.get(b.code).x);
  const half=Math.ceil(order.length/2),slots=new Map();
  const rightEdge=(rfFocus(currentView)||currentView==='pending-207'||currentView.startsWith('radar-207')) ? .935 : .98;
  for(const [side,x] of [[order.slice(0,half),.025],[order.slice(half),rightEdge]]){
   side.sort((a,b)=>projected.get(b.code).y-projected.get(a.code).y);
   side.forEach((r,i)=>slots.set(r.code,[x,(.25+.19*i)*h]));
  }
  return slots;
 }
 if(controllerPeripheralView(currentView))return new Map([
  ['207',[.025,.20*h]],['106',[.025,.31*h]],['105',[.025,.43*h]],
  ['104',[.025,.55*h]],['雷达端',[.025,.67*h]],
  ['202',[.98,.20*h]],['101',[.98,.31*h]],['102',[.98,.43*h]],['103',[.98,.55*h]],
  ['FPV端',[.98,.65*h]],['激光雷达端',[.98,.75*h]]
 ]);
 if(controllerClipView(currentView))return new Map([
  ['左侧四槽',[.025,.23*h]],['右侧三槽',[.98,.23*h]],
  ['左前线卡',[.025,.755*h]],['右前线卡',[.98,.755*h]]
 ]);
 if(currentView==='wiring-all'){
  const driveLabels=visible.filter(r=>r.escType==='drive');
  const screenX=r=>new THREE.Vector3(...r.point).project(camera).x;
  driveLabels.sort((a,b)=>screenX(a)-screenX(b));
  const leftArm=driveLabels[0]?.arm;
  return new Map(visible.map(r=>[r.code,[r.arm===leftArm ? .025 : .98,(r.escType==='spray' ? .64 : .76)*h]]));
 }
 if(currentView.startsWith('rear-esc:')){
  const hub=visible.find(marker=>marker.code.endsWith('集线'));
  const byScreenX=visible.filter(marker=>marker!==hub)
    .sort((a,b)=>new THREE.Vector3(...a.point).project(camera).x-new THREE.Vector3(...b.point).project(camera).x);
  const slots=sprayView(currentView)?[[.025,.62],[.98,.22],[.98,.70]]:[[.025,.35],[.98,.27],[.98,.58]];
  const positions=new Map(byScreenX.map((r,i)=>[r.code,[slots[i%slots.length][0],slots[i%slots.length][1]*h]]));
  if(hub)positions.set(hub.code,[.025,.15*h]);
  return positions;
 }
 if(sprayPortView(currentView))return new Map([
  ['24 针',[.44,.18*h]],['左半插',[.025,.50*h]],['右半插',[.98,.50*h]],
  ['机体侧',[.98,.50*h]],['药箱侧',[.025,.50*h]]
 ]);
 if(sprayFrontView(currentView))return new Map([
  ['204',[.98,.22*h]],['左纵梁前口',[.025,.42*h]],['左侧并束',[.025,.61*h]],
  ['前侧并束',[.025,.61*h]],['24 针',[.98,.67*h]]
 ]);
 if(sprayTankView(currentView))return new Map([['24 针',[.025,.44*h]],['气压计',[.98,.19*h]],['流量计',[.98,.55*h]],['左泵',[.98,.70*h]],['右泵',[.025,.69*h]]]);
 if(sprayWorkView(currentView))return new Map([
  ['204',[.025,.18*h]],['气压计',[.025,.29*h]],['24 针',[.025,.43*h]],['流量计',[.025,.54*h]],
  ['右泵',[.025,.68*h]],['左泵',[.98,.70*h]],['左纵梁前口',[.98,.51*h]],['C 喷洒',[.98,.30*h]],['D 喷洒',[.98,.41*h]]
 ]);
 if(currentView==='tail-signal')return new Map([['A 焊接',[.025,.24*h]],['P3',[.025,.43*h]],['右纵梁',[.43,.53*h]],['205',[.98,.25*h]]]);
 if(currentView==='fc205')return new Map([
  ['A 焊接',[.025,.24*h]],['P3',[.025,.39*h]],['C 485',[.025,.53*h]],['D 485',[.025,.62*h]],
  ['右纵梁',[.44,.63*h]],['并束',[.62,.27*h]],['205',[.98,.24*h]]
 ]);
 if(currentView==='tail-signal-port')return new Map([['205',[.98,.25*h]]]);
 if(currentView==='arm-m1-port'&&visible.some(r=>r.detailView))return new Map([['P3.1',[.025,.20*h]],['P3.2',[.025,.65*h]],['P4',[.98,.59*h]]]);
 const detail=armCloseups[currentView];
 if(currentView==='arm-m2-phase')return new Map([['M2 电调三相',[.025,.64*h]],['M2 电机入口',[.98,.25*h]]]);
 if(currentView==='arm-m1-phase')return new Map([['M1 电调三相',[.025,.63*h]],['M1 电机入口',[.98,.23*h]]]);
 if(currentView==='arm-m3-tail')return new Map([['M3-2',[.025,.22*h]],['M3-1',[.98,.22*h]]]);
 if(currentView==='arm-m4-tail')return new Map([
  ['B M4',[.98,.25*h]],['B 主配电',[.98,.44*h]],['B M3',[.98,.62*h]],
  ['A M3',[.025,.25*h]],['A 主配电',[.025,.44*h]],['A M4',[.025,.62*h]],['尾插信号',[.025,.10*h]]
 ]);
 if(currentView==='arm-m4-tail-b')return new Map([['B M4',[.025,.20*h]],['B 主配电',[.98,.34*h]],['B M3',[.025,.66*h]]]);
 if(currentView==='arm-m4-tail-a')return new Map([['A M3',[.025,.24*h]],['A 主配电',[.98,.33*h]],['A M4',[.025,.66*h]],['尾插信号',[.98,.54*h]]]);
 if(currentView==='arm-m3-beam')return new Map([['M3-3R',[.98,.26*h]],['M3-3L',[.025,.27*h]],['M3-3S',[.025,.62*h]]]);
 if(currentView==='arm-m3-fold')return new Map([['M3-3S',[.025,.60*h]],['M3-4',[.98,.50*h]],['M3-5',[.025,.19*h]]]);
 if(detail?.codes)return new Map(detail.codes.map((code,i)=>[code,i===0?[.025,.24*h]:[.98,(.26+i*.15)*h]]));
 if(detail)return new Map([[detail.code,[.025,.26*h]]]);
 if(currentView==='arm-m1')return new Map([['Q5',[.025,.12*h]],['Q4',[.025,.35*h]],['P5',[.98,.32*h]],['Q3',[.98,.50*h]],['P2',[.025,.54*h]],['Q2',[.98,.73*h]],['Q1',[.025,.73*h]]]);
 if(currentView==='arm-m3')return new Map([
  ['M3-1',[.025,.10*h]],['M3-2',[.98,.10*h]],['M3-3L',[.025,.28*h]],['M3-3R',[.98,.28*h]],
  ['M3-3S',[.025,.46*h]],['M3-4',[.98,.46*h]],['M3-5',[.98,.64*h]],['M3-6',[.025,.65*h]]
 ]);
 if(currentView==='arm-m2')return new Map([['M2-5',[.98,.17*h]],['M2-4',[.98,.39*h]],['M2-3',[.025,.44*h]],['M2-2',[.98,.68*h]],['M2-1',[.025,.68*h]]]);
 if(currentView==='front')return new Map([['C',[.37,.20*h]],['D',[.37,.72*h]],['G',[.98,.40*h]],['H',[.98,.62*h]],['N3',[.02,.40*h]],['N4',[.02,.62*h]]]);
 const positive=['B','E','F','G','H','L'],negative=['A','N1','N2','N3','N4','R'],slots=new Map();
 const left=visible.filter(r=>positive.includes(r.code)),right=visible.filter(r=>negative.includes(r.code)),middle=visible.filter(r=>!positive.includes(r.code)&&!negative.includes(r.code));
 for(const[items,x]of [[left,.025],[right,.97]])items.forEach((r,i)=>slots.set(r.code,[x,(.18+(i+.5)*.59/Math.max(items.length,1))*h]));
 middle.forEach((r,i)=>slots.set(r.code,[.39+i*.18,.085*h]));return slots;
}
const front=document.createElement('div');front.className='marker';front.textContent='↑ 机头';labels.append(front);
function loop(now){
 requestAnimationFrame(loop);
 if(window.logFaultBridge?.active===false)return;
 if(systemView)assembly?.update(now);
 controls.update();window.logFaultBridge?.projectTags();renderer.clear();renderer.render(scene,camera);
 if(!ready)return;
 // Keep wiring visible through the ghosted body in the transparent view.
 if(systemView?systemWireOverlay:useWireOverlay()){
  renderer.clearDepth();camera.layers.set(1);renderer.render(scene,camera);camera.layers.set(0);
 }
 if(systemView){waterFlow?.render(renderer);return;}
 overlay.replaceChildren();const w=stage.clientWidth,h=stage.clientHeight,visible=rows.filter(r=>!r.label.hidden),layout=markerLayout(visible,w,h);
 for(const r of visible){let point=r.point;if(['L','R'].includes(r.code)){const route=routes.find(x=>x.kind===(r.code==='L'?'positive':'negative'));if(route?.data.entry_blender_m){const p=toWeb(route.data.entry_blender_m);point=[p.x,p.y,p.z+.025];}}
  const p=new THREE.Vector3(...point).project(camera);if(p.z>1||p.z< -1){r.label.style.visibility='hidden';continue;}r.label.style.visibility='visible';const slot=layout.get(r.code),center=slot[2]==='center',right=!center&&slot[0]>.7,left=Math.max(5,Math.min(w-r.label.offsetWidth-5,slot[0]*w-(center?r.label.offsetWidth/2:right?r.label.offsetWidth:0))),top=Math.max(45,Math.min(h-$('.toolbar').offsetHeight-34-r.label.offsetHeight,slot[1]));r.label.style.left=left+'px';r.label.style.top=top+'px';const x=(p.x+1)*w/2,y=(1-p.y)*h/2,tx=left+(center?r.label.offsetWidth/2:right?0:r.label.offsetWidth),ty=top+(center?0:r.label.offsetHeight/2);
  const line=document.createElementNS('http://www.w3.org/2000/svg','line');for(const[k,v]of Object.entries({x1:x,y1:y,x2:tx,y2:ty,stroke:'#738e98','stroke-width':1,'stroke-dasharray':'3 3'}))line.setAttribute(k,v);overlay.append(line);const dot=document.createElementNS('http://www.w3.org/2000/svg','circle');dot.setAttribute('cx',x);dot.setAttribute('cy',y);dot.setAttribute('r',3);dot.setAttribute('fill',r.markerColor||'#177965');overlay.append(dot);
 }
 if(currentView==='wiring-all'){
  const center=new THREE.Vector3().project(camera),nose=new THREE.Vector3(0,0,.54).project(camera);
  const angle=Math.atan2((nose.x-center.x)*w,(nose.y-center.y)*h);
  const arrows=['↑','↗','→','↘','↓','↙','←','↖'];
  front.textContent=arrows[(Math.round(angle/(Math.PI/4))+8)%8]+' 机头';
  front.style.left=(w-80)+'px';front.style.top='14px';
 }
 else{const f=new THREE.Vector3(.006,.05,.48).project(camera);front.style.left=((f.x+1)*w/2-28)+'px';front.style.top=((1-f.y)*h/2-12)+'px';}}
loop();
async function fetchOptional(file,options){const response=await fetch(file,options);if(response.status===404)return null;if(!response.ok)throw new Error(file+'读取失败');return response.json();}
try{
 const [baseRows,parts,assemblyEdits,waterData,model]=await Promise.all([
  fetchOptional('power-review.json'),fetchOptional('catalog.json?v=20261112-opening'),fetchOptional('assembly-geometry.json'),
  fetchOptional('spray-water.json?v=20261112-spray-supply'),fetch('model.glb')
 ]);
 if(!baseRows||!parts||!assemblyEdits||!model.ok)throw new Error('缺少模型或零件清单');
 catalog=parts;
 root=await makeJ150Parser(renderer)(await model.arrayBuffer());scene.add(root);
 root.traverse(o=>{
  if(!objectIndex.has(o.name))objectIndex.set(o.name,[]);
  objectIndex.get(o.name).push(o);
  sourceVisibility.set(o,o.visible);
  if(o.name.startsWith('HARNESS_'))o.visible=false;
  if(o.name.startsWith('EVO_'))o.visible=baseContext.has(o.name);
  if(o.isMesh){sourceMaterials.set(o,o.material);o.material=mat(0x98a8af,true,.14);}
 });
 assemblyHidden=new Set(assemblyEdits.hidden.flatMap(findObjects));
 for(const data of baseRows){const r=makeMarker(data.code,data.title,data.point);r.nodes=data.nodes;const matches=data.nodes.flatMap(findObjects);if(matches.length!==data.nodes.length)missingNodes.push(r.code);for(const o of matches)o.traverse(m=>{if(m.isMesh)r.meshes.push(m);});r.mat=mat(0x277e72);r.dim=mat(0x95aaa6,true,.22);for(const mesh of r.meshes){mesh.material=r.mat;mesh.renderOrder=2;}r.button=document.createElement('button');r.button.textContent=r.code+' · '+r.title;r.button.onclick=()=>select(r.code);$('#items').append(r.button);rows.push(r);}
 const liveData={cache:'no-store'};
 const [positive,negative,peripheral,tail,m3Power,m4Harness]=await Promise.all(
  ['positive-route.json','negative-route.json','peripheral-routes.json','tail-peripheral-routes.json','m3-power-routes.json','m4-arm-harness.json']
   .map(file=>fetchOptional(file,liveData).catch(error=>{loadWarnings.push(error.message);return null;}))
 );
 if(positive)addRoute(positive,'positive');
 if(negative)addRoute(negative,'negative');
 const replacements=new Map([...(m3Power?.routes||[]),...(m4Harness?.routes||[]).filter(route=>route.replaces)].map(route=>[route.id,route]));
 for(const data of [peripheral,tail]){
  if(!data)continue;
  if(data.status==='candidate_not_geometry_approved')loadWarnings.push('尾插支线为核验中的候选');
  applyGeometryOverrides(data.component_geometry_overrides||[]);
  if(data.cover_object_name)coverNames.add(data.cover_object_name);
  if(data.closed_cover_status){
   loadWarnings.push(['pass','passed'].includes(data.closed_cover_status)?'闭盖几何检查通过（数据结果）':'闭盖检查：两处共享端子干涉待修复，需核对壳体出线口');
  }else if(data.assembly_state==='open_cover_inspection')loadWarnings.push('闭盖干涉尚待核对；盖板已恢复显示');
  for(const name of [...(data.pending_hide_original_objects||[]),...(data.inspection_hide_original_objects||[])]){
   if(!isCover(name))for(const object of findObjects(name)){object.visible=false;originallyHidden.add(object);}
  }
  for(const entry of Array.isArray(data)?data:data.routes||[]){
   const replacement=replacements.get(entry.id);
   if(replacement&&replacement.replaces===entry.name){
    addRoute(replacement,'arm-'+replacement.arm,routes.length);
    replacements.delete(entry.id);
   }else addRoute(entry,entry.id?.startsWith('tail-M4')?'arm-m4':'peripheral',routes.length);
  }
 }
 if(replacements.size)loadWarnings.push('部分后机臂供电数据未与尾插基准对应');
 const [next,armRoutes,m2Review,motorRoutes,m2Harness,m3Review,m3Spray,m3Drive,m4Review,tailSignal,workReview,clipReview]=await Promise.all([
  fetchOptional('arm-power-review.json',liveData),fetchOptional('m1-arm-routes.json',liveData),
  fetchOptional('m2-arm-review.json',liveData),fetchOptional('motor-arm-extensions.json',liveData),
  fetchOptional('m2-arm-harness.json',liveData),fetchOptional('m3-arm-review.json',liveData),
  fetchOptional('m3-spray-harness.json',liveData),fetchOptional('m3-drive-harness.json',liveData),fetchOptional('m4-arm-review.json',liveData),fetchOptional('tail-signal-harness.json',liveData),fetchOptional('spray-work-review.json',liveData),
  fetchOptional('controller-clip-review.json',liveData)
 ]);
 if(clipReview){
  controllerClipReview=clipReview;
  for(const route of clipReview.routes)controllerClipOverrides.set(route.id,route);
 }
 if(next)addArmReview(next,'m1');
 if(m2Review)addArmReview(m2Review,'m2');
 if(m3Review){addArmReview(m3Review,'m3');addRearEscs(m3Review.rear_escs||[]);}
 if(m4Review)addArmReview(m4Review,'m4');
 for(const [arm,doc] of [['m3',m3Spray],['m4',m4Harness]])if(doc?.valve_hub?.review_camera_direction)valveHubReview[arm]=doc.valve_hub;
 for(const update of m3Drive?.part_endpoint_updates||[]){
  partEndpointUpdates.set(update.part_id,new Map(update.vertices.map(([index,...point])=>[index,point])));
 }
 for(const part of m3Power?.parts||[]){
  if(routes.some(r=>r.id===part.route_id&&r.kind==='arm-m3'))addArmPart(part);
 }
 if(m3Spray){
  applyGeometryOverrides(m3Spray.component_geometry_overrides);
  applyArmNativeStyles(m3Spray.native_styles);
  for(const route of m3Spray.routes)addRoute(route,'arm-m3',routes.length);
  for(const part of m3Spray.parts||[])addArmPart(part);
  addSprayMarkers(m3Spray.markers||[],'m3');
 }
 if(armRoutes){applyArmNativeStyles(armRoutes.native_styles);for(const route of armRoutes.routes)addRoute(route,'arm-m1',routes.length);for(const part of armRoutes.parts||[])addArmPart(part);}
 for(const [doc,arm] of [[motorRoutes,'m1'],[m2Harness,'m2'],[m3Drive,'m3'],[m4Harness,'m4']]){
  if(!doc)continue;
  applyMotorOrientation(doc.motor_orientation);
  applyGeometryOverrides(doc.component_geometry_overrides);
  applyArmNativeStyles(doc.native_styles);
  for(const data of doc.routes){
   if(data.replaces)continue;
   const route=addRoute(data,'arm-'+data.arm,routes.length);
   if(data.phase_terminal)styleObjects(data.phase_terminal.esc_output_object,route.mesh.material,route);
  }
  for(const part of doc.parts||[])addArmPart(part);
  addArmMarkers(doc.phase_markers||doc.markers||[],arm);
  addSprayMarkers(doc.spray_markers||[],arm);
  const phaseButton=$('#arm-'+arm+'-phase');
  phaseButton.hidden=!routes.some(r=>r.kind==='arm-'+arm&&r.data.circuit==='phase');
  phaseButton.onclick=()=>view('arm-'+arm+'-phase');
 }
 if(tailSignal){
  for(const wire of tailSignal.routes)addRoute(wire,'tail-signal',routes.length);
  for(const part of tailSignal.parts||[])addArmPart(part);
  addTailSignalMarkers(tailSignal.markers||[]);
  $('#tail-signal-view').hidden=false;
  $('#tail-signal-view').onclick=()=>view('tail-signal');
  $('#fc205-view').hidden=!tailSignal.routes.some(route=>route.circuit==='fc205-power');
  $('#fc205-view').onclick=()=>view('fc205');
  $('#tail-signal-port').onclick=()=>view('tail-signal-port');
  $('#tail-signal-p3').onclick=()=>view('tail-signal-p3');
 }
 if(workReview){
  sprayWorkReview=workReview;
  for(const wire of workReview.routes)addRoute(wire,'spray-work',routes.length);
  for(const part of workReview.parts||[])addArmPart(part);
  for(const data of workReview.markers){
   const marker=makeMarker(data.code,data.title,toWeb(data.point_blender_m).toArray());
   marker.sprayWorkMarker=true;
   marker.closeOnly=data.close_only===true;
   marker.frontRoute=data.front===true;
   marker.frontOnly=data.front_only===true;
   if(data.polarity||data.pending){
    marker.markerColor=data.pending?'#a96518':data.polarity==='positive'?'#af3733':'#343b43';
    marker.label.querySelector('b').style.background=marker.markerColor;
   }
   rows.push(marker);
  }
  $('#spray-work-view').hidden=false;
  $('#spray-work-view').onclick=()=>view('spray-work');
  $('#spray-work-port').onclick=()=>view('spray-work-port');
  $('#spray-work-front').onclick=()=>view('spray-work-front');
  $('#spray-work-tank').onclick=()=>view('spray-work-tank');
 }
 const harnesses=new Map();
 if(controllerClipReview){
  for(const part of controllerClipReview.parts)addArmPart(part);
  for(const data of controllerClipReview.markers){
   const marker=makeMarker(data.code,data.title,toWeb(data.point_blender_m).toArray());
   marker.controllerClipMarker=true;
   rows.push(marker);
  }
  const peripheral=controllerClipReview.peripheral;
  if(peripheral){
   applyGeometryOverrides(peripheral.component_geometry_overrides);
   for(const route of peripheral.routes)addRoute(route,'controller-peripheral');
   for(const part of peripheral.parts)addArmPart(part);
   for(const part of peripheral.device_parts||[])addArmPart(part);
   for(const data of [...peripheral.markers,...peripheral.pending]){
    const marker=makeMarker(data.code||data.port,data.title||data.name,toWeb(data.point_blender_m).toArray());
    marker.controllerPeripheralMarker=true;
    if(data.detail){
     marker.markerColor='#9a621d';
     marker.label.querySelector('b').style.background=marker.markerColor;
     marker.label.title=data.detail;
    }
    rows.push(marker);
   }
   const focusTools=$('#controller-focus-tools');
   for(const [mode,viewData] of Object.entries(peripheral.focus_views||{})){
    for(const data of viewData.markers){
     const marker=makeMarker(data.code,data.title,toWeb(data.point_blender_m).toArray());
     marker.controllerFocus=mode;
     if(data.confirmed===false||(mode.startsWith('pending-')&&data.confirmed!==true)){
      marker.markerColor='#9a621d';
      marker.label.querySelector('b').style.background=marker.markerColor;
     }
     rows.push(marker);
    }
   }
   for(const button of focusTools.querySelectorAll('button[data-view]')){
    button.hidden=button.dataset.view!=='controller-peripheral'&&!controllerFocus(button.dataset.view);
    button.onclick=()=>{view(button.dataset.view);if('gpsFocus' in button.dataset||'weightFocus' in button.dataset||'radarFocus' in button.dataset)$('aside').scrollTop=0;};
   }
   const batteryButton=$('#battery106-view');
   batteryButton.hidden=!controllerFocus('battery-106');
   batteryButton.onclick=()=>view('battery-106');
   const rfButton=$('#rf-feeders-view');
   rfButton.hidden=!controllerFocus('rf-feeders');
   rfButton.onclick=()=>{view('rf-feeders');$('aside').scrollTop=0;};
   for(const button of document.querySelectorAll('#rf-focus-tools button[data-view],#controller-rf-review button[data-view]')){
    button.onclick=()=>{view(button.dataset.view);$('aside').scrollTop=0;};
   }
   const tab=$('#controller-peripheral');
   tab.hidden=false;
   tab.onclick=()=>view('controller-peripheral');
   for(const harness of peripheral.harness_assemblies)harnesses.set(harness.id,harness);
  }
  const button=$('#controller-clips');
  button.hidden=false;
  button.onclick=()=>view('controller-clips');
 }
 for(const doc of [m3Spray,m3Drive,m4Harness,tailSignal,workReview]){
  for(const item of doc?.harness_assemblies||[])harnesses.set(item.id,item);
 }
 for(const id of workReview?.merged_harness_ids||[])harnesses.delete(id);
 applyGeometryOverrides(assemblyEdits.overrides.filter(edit=>!updatedGeometry.has(edit.object_name)));
 if(waterData){
  applyGeometryOverrides(waterData.component_geometry_overrides);
  waterFlow=createEvoSprayFlow({
   data:waterData,root,camera,stage,toWeb,tube:sampledTube,findObjects,
   getMaterial:mesh=>sourceMaterials.get(mesh),
   registerMaterial:(mesh,material)=>sourceMaterials.set(mesh,material)
  });
 }
 addHarnessAssemblies([...harnesses.values()]);
 applyCover();root.updateMatrixWorld(true);resize();ready=true;
 const params=new URLSearchParams(location.search);
 const requestedView=params.get('view');
 const legacyViews=new Map([
  ['cpu-20p','controller-peripheral'],['pending-cpu','controller-peripheral'],
  ['pending-103','lidar-103'],['pending-audit-207','radar-207-controller'],
  ['pending-audit-tail','tail-signal-p3'],['pending-audit-m3','rear-esc:m3']
 ]);
 const initialView=legacyViews.get(requestedView)||requestedView;
 const overviewModes=new Set(['wiring-all','overview']);
 if(clipReview)overviewModes.add('controller-clips');
 if(clipReview?.peripheral)overviewModes.add('controller-peripheral');
 if(tailSignal){overviewModes.add('tail-signal');overviewModes.add('fc205');}
 if(workReview){
  for(const mode of ['spray-work','spray-work-front','spray-work-port','spray-work-tank'])overviewModes.add(mode);
 }
 for(const arm of Object.keys(armReviews))overviewModes.add('arm-'+arm);
 for(const closeup of Object.keys(armCloseups))overviewModes.add(closeup);
 for(const arm of Object.keys(rearArms))if(hasSpray(arm))overviewModes.add('rear-esc:'+arm);
 const directMode=initialView==='spray-front'?'spray-work-front':initialView;
 const legacy=directMode&&directMode!=='wiring-all'&&(overviewModes.has(directMode)||controllerFocus(directMode));
 if(legacy){
  $('#wiring-panel').hidden=false;$('#wiring-tools').hidden=false;$('#return-system-view').hidden=false;
  view(directMode,null,requestedView==='pending-audit-m3');
 }else openSystems();
 $('#loading').hidden=true;
 $('#wiring-all').onclick=()=>{wholeAngle='top';view('wiring-all');$('aside').scrollTop=0;};
 $('#arm-m1').disabled=!armReviews.m1;$('#arm-m1').onclick=()=>view('arm-m1');
 $('#arm-m2').disabled=!armReviews.m2;$('#arm-m2').onclick=()=>view('arm-m2');
 for(const key of Object.keys(rearArms)){
  const button=$('#arm-'+key);
  button.hidden=!armReviews[key];button.onclick=()=>view('arm-'+key);
 }
 $('#cover-toggle').onclick=()=>{coverTransparent=!coverTransparent;applyCover();};$('#shared-negative').onclick=()=>view('shared-negative');$('#shared-positive').onclick=()=>view('shared-positive');$('#shared-negative').disabled=!sharedRoute('shared-negative');$('#shared-positive').disabled=!sharedRoute('shared-positive');
 $('#overview').onclick=()=>view('overview');$('#front').onclick=()=>view('front');$('#route').onclick=()=>viewRoute(routes.find(r=>r.kind==='positive'));$('#negative').onclick=()=>viewRoute(routes.find(r=>r.kind==='negative'));$('#clip').onclick=()=>view('clip');
 for(const angle of ['top','rear'])$('#'+angle).onclick=()=>{
  if(currentView==='wiring-all'){wholeAngle=angle;view('wiring-all');}
  else view(angle);
 };
 $('#side').onclick=()=>view('side');$('#all').onclick=()=>view('overview');$('#wire-toggle').onclick=()=>{wiresVisible=!wiresVisible;syncWires();};$('#solid-check').onclick=()=>{solidCheck=!solidCheck;for(const row of rows.filter(r=>['L','R'].includes(r.code)))for(const mesh of row.meshes)mesh.material=solidCheck?row.mat:row.dim;$('#solid-check').textContent=solidCheck?'纵梁：实体':'纵梁：透视';};
 if(params.has('inspection'))window.installEvoInspection({assembly,camera,canvas});
 else window.installLogFaultBridge?.({root,scene,camera,canvas,anchors:['rf','lr','lf','rr'].map(side=>()=>{const n=root.getObjectByName('EVO_drive-'+side+'-esc');return n?new THREE.Box3().setFromObject(n).getCenter(new THREE.Vector3()):null;}),selectChannel:(i,p)=>assembly.selectChannel(i,p),setMode:m=>assembly.setMode(m),setExplode:v=>assembly.setExplode(v),restore:()=>assembly.restore()});
 window.PowerReview={routes,rows,view,viewRoute,addRoute,sampledTube,syncWires,missingNodes,loadWarnings,get currentView(){return currentView;}};
}catch(e){$('#loading').textContent='模型加载失败：'+e.message;console.error(e);}
})();

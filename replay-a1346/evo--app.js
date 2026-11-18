'use strict';

window.createEvoAssembly = function ({
  root, camera, controls, canvas, catalog, routes, connections,
  solidMaterial, syncWires, pickWire, resize, closeSidebar, waterFlow
}) {
  const $ = selector => document.querySelector(selector);
  const state = {
    system: 'all', query: '', harnessQuery: '', selected: null, context: true,
    channel: null, step: -1, harness: null, explode: 0, mode: 'transparent'
  };
  const modules = new Map();
  const partIds = new Map();
  const materialsCache = new Map();
  const byRoute = new Map(routes.map(route => [route.id, route]));
  const controlsForDisplay = [...document.querySelectorAll('[data-display]')];
  const range = $('#explode');
  const details = $('#details');
  const wireToggle = $('#system-wire-toggle');
  const contextToggle = $('#chain-context-toggle');
  const explodeButton = $('#animate-explode');
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let foreground = new Set();
  let explodeFrame = 0, explodeDestination = 100, openingAt = null;
  let pointerStart, shownWires = 0;
  let flowSettings, cameraMove, followMove;
  let inspection=null;
  const inspectionMaterials=new Map();
  const cameraDirection = new THREE.Vector3();
  const cameraTurn = new THREE.Quaternion();
  const homeDirection = [.75, .95, 1.4];
  const waterDirections = {
    all: [.14, .99, -1], supply: [.16, -.04, 1],
    arms: [.035, 1.3, -.95], outlets: [.035, .26, -1],
    left: [-.60, .27, -1], right: [.60, .27, -1]
  };
  const waterStatus = {
    all: '两侧 · 4 个喷头', supply: '箱底供水 · 双泵双通道',
    arms: '左右后机臂 · 内部水管', outlets: '两侧三通 · 4 个喷头',
    left: '左后 · 2 个喷头', right: '右后 · 2 个喷头'
  };

  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function button(text, onClick, className = '') {
    const node = element('button', className, text);
    node.type = 'button';
    node.onclick = onClick;
    return node;
  }

  function systemName(id) {
    return catalog.systems.find(system => system.id === id)?.name || '整机总览';
  }

  function systemParts() {
    return catalog.components.filter(part => state.system === 'all' || part.system === state.system);
  }

  function selectedPath() {
    return connections.byPart.get(state.selected)?.[state.channel];
  }

  function pathItems() {
    const steps = selectedPath()?.steps || [];
    return state.step < 0 ? steps : [steps[state.step]];
  }

  function routeScope() {
    return connections.bySystem.get(state.system);
  }

  function focusRouteIds() {
    return state.harness?.routeIds || pathItems().flatMap(step => step.routeIds);
  }

  function hasSelection() {
    return Boolean(state.selected || state.harness);
  }

  function showsReference() {
    return state.context && (state.system !== 'all' || hasSelection());
  }

  function visibleRoutes() {
    return hasSelection() ? connections.completeHarnesses(focusRouteIds()) : routeScope();
  }

  function focusPartIds() {
    if (state.harness) return new Set(state.harness.routeIds.flatMap(id => [...(connections.routeParts.get(id) || [])]));
    const related = new Set(pathItems().flatMap(step => step.partIds));
    if (state.selected && (state.step < 0 || !related.size)) related.add(state.selected);
    return related;
  }

  function renderSystems() {
    const choices = [{id: 'all', name: '整机总览'}, ...catalog.systems];
    $('#systems').replaceChildren(...choices.map(system => {
      const item = button(system.name, () => filterSystem(system.id));
      item.dataset.system = system.id;
      item.setAttribute('aria-pressed', String(system.id === state.system));
      return item;
    }));
  }

  function renderList() {
    const results = systemParts().filter(part => !state.query ||
      (part.name + ' ' + (part.description || '')).toLowerCase().includes(state.query));
    $('#parts-count').textContent = results.length;
    const items = results.map(part => {
      const active = part.id === state.selected;
      const item = button('', () => select(part.id), active ? 'item selected' : 'item');
      item.dataset.id = part.id;
      item.setAttribute('aria-pressed', String(active));
      item.append(element('span', 'item-title', part.name), element('span', 'item-meta', systemName(part.system)));
      return item;
    });
    $('#list').replaceChildren(...(items.length ? items : [element('p', 'no-results', '没有匹配的部件。')]));
  }

  function renderHarnesses() {
    const names = new Set([...routeScope()].map(id => connections.wireNames.get(id)));
    if (state.harness) names.add(state.harness.name);
    const groups = [...names].map(name => connections.harnesses.get(name))
      .filter(group => group.name.toLowerCase().includes(state.harnessQuery));
    $('#system-route-count').textContent = names.size + ' 组';
    $('#system-route-list').replaceChildren(...(groups.length ? groups.map(group => {
      const item = button(group.name, () => selectHarness(group.name), 'system-route');
      const branches = connections.branchesByName.get(group.name);
      const count = element('span', 'bundle-route-count', branches ? branches.length + ' 路' : group.routeIds.length + ' 段');
      count.setAttribute('aria-hidden', 'true');
      item.append(count);
      item.setAttribute('aria-pressed', String(state.harness?.key === group.key));
      return item;
    }) : [element('p', '', names.size ? '没有匹配的线束。' : '此系统没有单独的电气线束。')]));
  }

  function fitHarness() {
    moveTo(frame([], visibleRoutes(), [], {margin: 1.28}));
  }

  function selectHarness(name, hit) {
    const group = connections.harnesses.get(name);
    if (!group) return;
    if(inspection){moveTo(frame([],group.routeIds,[],{margin:1.3}));window.dispatchEvent(new CustomEvent('log-part-picked',{detail:{id:group.key,name:group.name,channel:inspection.channel}}));return;}
    cameraMove = null;
    stopWater();
    stopAnimation();
    const wasExploded = state.explode > 0;
    clearSelection();
    state.harness = group;
    wireToggle.checked = true;
    if (wasExploded) setExplode(0);
    explodeDestination = 100;
    updateAnimationButton();
    renderList();
    renderHarnesses();
    renderDetails();
    applyDisplay();
    closeSidebar();
    if (hit && !wasExploded) keepPickedPoint(hit);
    else fitHarness();
  }

  function prepareMaterials(node) {
    const meshes = [];
    node.traverse(mesh => {
      if (!mesh.isMesh) return;
      const material = solidMaterial(mesh);
      const array = Array.isArray(material);
      const materials = [material].flat().map(original => {
        if (!materialsCache.has(original)) {
          const transparent = original.clone();
          transparent.color?.set(0xa4b5bc);
          transparent.transparent = true;
          transparent.opacity = Math.min(original.opacity, .13);
          transparent.depthWrite = false;
          const reference = transparent.clone();
          reference.opacity = Math.min(original.opacity, .075);
          const selected = original.clone();
          selected.color?.set(0xffb52b);
          selected.emissive?.set(0x8c4300);
          selected.emissiveIntensity = .38;
          selected.transparent = false;
          selected.opacity = 1;
          selected.depthWrite = true;
          const selectedGhost = selected.clone();
          selectedGhost.transparent = true;
          selectedGhost.opacity = .29;
          selectedGhost.depthWrite = false;
          materialsCache.set(original, {solid: original, transparent, reference, selected, selectedGhost});
        }
        return materialsCache.get(original);
      });
      meshes.push({mesh, materials, array});
    });
    return meshes;
  }

  function applyDisplay() {
    if(inspection){applyInspection();return;}
    const primary = new Set(systemParts().map(part => part.id));
    const focused = hasSelection();
    const showingWater = waterFlow?.active;
    foreground = showingWater ? new Set(waterFlow.partIds) : focused ? focusPartIds() : primary;
    const transparent = state.mode === 'transparent';
    const reference = showsReference();
    for (const [id, module] of modules) {
      const active = foreground.has(id);
      module.node.visible = active || reference;
      if (!module.node.visible) continue;
      const mode = id === state.selected && active
        ? (transparent ? 'selectedGhost' : 'selected')
        : active ? (transparent ? 'transparent' : 'solid') : 'reference';
      for (const {mesh, materials, array} of module.meshes) {
        const style = showingWater && waterFlow.ghostTank.has(mesh) && active ? 'transparent' : mode;
        mesh.material = array ? materials.map(material => material[style]) : materials[0][style];
      }
    }
    const focus = new Set(focusRouteIds());
    shownWires = syncWires({
      visible: visibleRoutes(),
      focus,
      show: wireToggle.checked,
      overlay: transparent
    });
    for (const control of controlsForDisplay) {
      control.setAttribute('aria-pressed', String(control.dataset.display === state.mode));
    }
    const channel = state.channel === 'power' ? '电源链路' : state.channel === 'signal' ? '信号链路' : '';
    $('#view-label').textContent = showingWater ? '喷洒系统 · ' + (waterFlow.following ? '跟随水流' : '液体流向') :
      state.harness?.name || [systemName(state.system), channel].filter(Boolean).join(' · ');
    $('#visible-count').textContent = showingWater
      ? waterStatus[waterFlow.scope]
      : foreground.size + (reference ? ' 个相关部件' : ' 个部件') + ' · ' + shownWires + ' 段线束';
    contextToggle.hidden = !focused && state.system === 'all';
    contextToggle.setAttribute('aria-pressed', String(state.context));
    $('#explode-note').hidden = state.explode === 0 || shownWires === 0;
    if (state.explode) positionModules();
  }

  function partPoints(partKeys) {
    const points = [];
    for (const id of partKeys) {
      const node = modules.get(id)?.node;
      if (!node) continue;
      if(inspection){node.updateWorldMatrix(true,true);node.traverseVisible(mesh=>{if(!mesh.isMesh)return;if(!mesh.geometry.boundingBox)mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox;if(!box||box.isEmpty())return;for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])points.push(new THREE.Vector3(x,y,z).applyMatrix4(mesh.matrixWorld));});continue;}
      const box = new THREE.Box3().setFromObject(node);
      if (box.isEmpty()) continue;
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) points.push(new THREE.Vector3(x, y, z));
        }
      }
    }
    return points;
  }

  function cameraPose() {
    const offset = camera.position.clone().sub(controls.target);
    const distance = offset.length();
    const direction = distance ? offset.multiplyScalar(1 / distance) : new THREE.Vector3(...homeDirection).normalize();
    return {target: controls.target.clone(), direction, distance: Math.max(.017, distance)};
  }

  function frame(partKeys, routeIds, extraPoints = [], {margin = 1.19, heading} = {}) {
    resize();
    const points = [...extraPoints, ...partPoints(partKeys)];
    for (const id of routeIds) {
      const route = byRoute.get(id);
      if (!route) continue;
      for (let i = 0; i < route.points.length; i += 5) points.push(route.points[i]);
      points.push(route.points.at(-1));
    }
    if (!points.length) return;

    const direction = heading ? new THREE.Vector3(...heading).normalize() : cameraPose().direction;
    const right = new THREE.Vector3(0, 1, 0).cross(direction).normalize();
    const up = direction.clone().cross(right);
    const projected = points.map(p => new THREE.Vector3(p.dot(right), p.dot(up), p.dot(direction)));
    const middle = new THREE.Box3().setFromPoints(projected).getCenter(new THREE.Vector3());
    const center = right.clone().multiplyScalar(middle.x).addScaledVector(up, middle.y)
      .addScaledVector(direction, middle.z);
    const vertical = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const horizontal = vertical * Math.max(camera.aspect, .1);
    let distance = .08;
    for (const p of projected) {
      distance = Math.max(distance, p.z - middle.z + Math.max(
        Math.abs(p.x - middle.x) / horizontal, Math.abs(p.y - middle.y) / vertical
      ));
    }
    return {target: center, direction, distance: distance * margin};
  }

  function placeCamera(pose) {
    controls.target.copy(pose.target);
    camera.position.copy(pose.target).addScaledVector(pose.direction, pose.distance);
  }

  function flight(from, to) {
    return {from, to, turn: new THREE.Quaternion().setFromUnitVectors(from.direction, to.direction)};
  }

  function glide({from, to, turn}, progress) {
    if (progress >= 1) {
      placeCamera(to);
      return;
    }
    const eased = progress * progress * (3 - 2 * progress);
    cameraTurn.identity().slerp(turn, eased);
    cameraDirection.copy(from.direction).applyQuaternion(cameraTurn);
    const distance = from.distance * (to.distance / from.distance) ** eased;
    controls.target.lerpVectors(from.target, to.target, eased);
    camera.position.copy(controls.target).addScaledVector(cameraDirection, distance);
  }

  function moveTo(destination, {duration = 760, instant = false} = {}) {
    cameraMove = null;
    if (!destination) return;
    if (instant || reducedMotion.matches) {
      placeCamera(destination);
      controls.update();
      return;
    }
    cameraMove = {flight: flight(cameraPose(), destination), start: performance.now(), duration};
  }

  function waterFrame(heading) {
    const scope = waterFlow.scope;
    const parts = scope === 'all' && showsReference() ? modules.keys()
      : scope === 'supply' ? ['spray-pump-a', 'spray-pump-b', 'spray-flowmeter'] : [];
    const margin = scope === 'supply' ? 1.46 : scope === 'outlets' ? 1.30 : 1.19;
    return frame(parts, [], waterFlow.fitPoints(), {heading, margin});
  }

  function currentFrame(includeReference = true, heading) {
    if (waterFlow?.active) return waterFrame(heading);
    const parts = includeReference && showsReference() && !hasSelection() ? modules.keys() : foreground;
    return frame(parts, wireToggle.checked ? visibleRoutes() : [], [], {heading});
  }

  function fitCurrent(includeReference = true) {
    moveTo(currentFrame(includeReference));
  }

  function showWaterView(next) {
    cameraMove = followMove = null;
    waterFlow.choose(next);
    applyDisplay();
    if (next !== 'follow') moveTo(waterFrame(waterDirections[next]));
  }

  function releaseCamera() {
    stopAnimation();
    cameraMove = followMove = null;
    if (waterFlow?.active && waterFlow.releaseFollow()) applyDisplay();
  }

  function update(now) {
    if (openingAt !== null && now >= openingAt) {
      openingAt = null;
      if (!reducedMotion.matches) playAnimation();
    }
    const cue = waterFlow?.tick(now);
    if (cue) {
      if (!followMove || followMove.run !== cue.run || followMove.scope !== cue.scope) {
        cameraMove = null;
        const destination = waterFrame(waterDirections[cue.scope]);
        followMove = {...cue, flight: flight(cameraPose(), destination), done: false};
        applyDisplay();
      }
      if (!followMove.done) {
        const progress = reducedMotion.matches ? 1 : cue.progress;
        glide(followMove.flight, progress);
        followMove.done = progress >= 1;
      }
      return;
    }
    followMove = null;
    if (!cameraMove) return;
    const progress = Math.max(0, Math.min(1, (now - cameraMove.start) / cameraMove.duration));
    glide(cameraMove.flight, progress);
    if (progress >= 1) cameraMove = null;
  }

  function stopWater() {
    if (!waterFlow?.active) return;
    cameraMove = followMove = null;
    waterFlow.exit();
    state.mode = flowSettings.mode;
    state.context = flowSettings.context;
    wireToggle.checked = flowSettings.wires;
    flowSettings = null;
  }

  function toggleWater(next = 'all') {
    if (waterFlow.active) {
      stopWater();
      applyDisplay();
      return;
    }
    flowSettings = {mode: state.mode, context: state.context, wires: wireToggle.checked};
    filterSystem('spray', {reframe: false});
    setExplode(0);
    state.context = true;
    wireToggle.checked = false;
    waterFlow.enter();
    showWaterView(next);
    closeSidebar();
  }

  function positionModules() {
    const amount = state.explode / 100;
    for (const [id, module] of modules) {
      module.node.position.copy(module.origin).addScaledVector(module.offset, foreground.has(id) ? amount : 0);
    }
    root.updateMatrixWorld(true);
  }

  function setExplode(value) {
    state.explode = Number(value);
    const rounded = Math.round(state.explode);
    range.value = rounded;
    $('#explode-value').textContent = rounded + '%';
    positionModules();
    window.logFaultBridge?.refresh();
    $('#explode-note').hidden = state.explode === 0 || shownWires === 0;
  }

  function updateAnimationButton() {
    explodeButton.textContent = explodeFrame ? '暂停动画' : explodeDestination === 0 ? '播放合拢' : '播放拆解';
  }

  function stopAnimation() {
    openingAt = null;
    if (explodeFrame) cancelAnimationFrame(explodeFrame);
    explodeFrame = 0;
    updateAnimationButton();
  }

  function playAnimation() {
    openingAt = null;
    cameraMove = null;
    if (waterFlow?.active) {
      stopWater();
      applyDisplay();
    }
    if (explodeFrame) {
      stopAnimation();
      return;
    }
    const from = state.explode;
    if (from === 100) explodeDestination = 0;
    if (from === 0) explodeDestination = 100;
    const to = explodeDestination;
    if (reducedMotion.matches) {
      setExplode(to);
      fitCurrent();
      explodeDestination = to === 100 ? 0 : 100;
      updateAnimationButton();
      return;
    }
    const startPose = cameraPose();
    setExplode(to);
    const cameraFlight = flight(startPose, currentFrame() || startPose);
    setExplode(from);
    const start = performance.now();
    const duration = Math.max(430, Math.abs(to - from) * 15);
    function frame(now) {
      const time = Math.min((now - start) / duration, 1);
      const progress = time * time * (3 - 2 * time);
      setExplode(from + (to - from) * progress);
      glide(cameraFlight, time);
      controls.update();
      if (time < 1) {
        explodeFrame = requestAnimationFrame(frame);
      } else {
        explodeFrame = 0;
        explodeDestination = to === 100 ? 0 : 100;
        updateAnimationButton();
      }
    }
    explodeFrame = requestAnimationFrame(frame);
    updateAnimationButton();
  }

  function showPathStep(index) {
    stopAnimation();
    state.step = index;
    wireToggle.checked = true;
    if (state.explode) setExplode(0);
    explodeDestination = 100;
    updateAnimationButton();
    renderDetails();
    applyDisplay();
    fitCurrent(false);
  }

  function renderBranches(host, names, includeName = true) {
    for (const name of names) {
      const labels = connections.branchesByName.get(name);
      if (!labels) continue;
      const group = element('div', 'bundle-branches');
      group.dataset.harness = name;
      const title = (includeName ? name + ' · ' : '') + labels.length + ' 路支线';
      const list = element('ul', 'bundle-branch-list');
      list.append(...labels.map(label => element('li', '', label)));
      group.append(element('h3', 'bundle-branches-title', title), list);
      host.append(group);
    }
  }

  function renderDetails() {
    const part = modules.get(state.selected)?.component;
    const harness = state.harness;
    details.hidden = !part && !harness;
    if (details.hidden) return;
    const section = $('#detail-paths');
    section.replaceChildren();
    if (harness) {
      $('#detail-system').textContent = '线束总成';
      $('#detail-name').textContent = harness.name;
      $('#detail-description').textContent = harness.summary || harness.routeIds.length + ' 段';
      section.append(button('定位整根线束', fitHarness, 'chain-all'));
      renderBranches(section, [harness.name], false);
      if (harness.steps.length) {
        section.append(element('h3', 'harness-connection-title', '接线和走向'));
        const list = element('ul', 'harness-connection-list');
        for (const step of harness.steps) {
          const item = element('li', '');
          item.append(element('strong', '', step.label));
          if (step.note) item.append(element('p', '', step.note));
          list.append(item);
        }
        section.append(list);
      }
      return;
    }
    $('#detail-system').textContent = systemName(part.system);
    $('#detail-name').textContent = part.name;
    $('#detail-description').textContent = part.description || '';
    const paths = connections.byPart.get(part.id);
    if (!paths) return;

    const tabs = element('div', 'chain-tabs');
    tabs.setAttribute('role', 'group');
    tabs.setAttribute('aria-label', '控制链路类型');
    for (const [id, label] of [['power', '电源链路'], ['signal', '信号链路']]) {
      if (!paths[id]) continue;
      const tab = button(label, () => {
        state.channel = id;
        showPathStep(-1);
        $('#detail-paths [data-channel="' + id + '"]')?.focus();
      });
      tab.dataset.channel = id;
      tab.setAttribute('aria-pressed', String(state.channel === id));
      tabs.append(tab);
    }
    section.append(tabs);
    const path = selectedPath();
    if (!path) return;
    section.append(element('p', 'chain-summary', path.title));
    if (path.steps.length > 1) {
      const all = button('显示整条链路', () => showPathStep(-1), 'chain-all');
      all.setAttribute('aria-pressed', String(state.step < 0));
      section.append(all);
    }
    const harnessNames = new Set(path.steps.flatMap(item => item.routeIds.map(id => connections.wireNames.get(id))));
    renderBranches(section, harnessNames);
    const list = element('ol', 'chain-steps');
    path.steps.forEach((item, index) => {
      const li = element('li');
      const link = button('', () => showPathStep(index), 'chain-step');
      link.setAttribute('aria-pressed', String(state.step === index));
      const names = [...new Set(item.routeIds.map(id => connections.wireNames.get(id)))];
      const caption = element('span', 'chain-caption');
      if (names.length) caption.append(element('strong', 'chain-harness-name', names.join('、')));
      caption.append(element('span', 'chain-label', item.label));
      link.append(element('span', 'chain-number', String(index + 1)), caption);
      li.append(link);
      if (item.note) li.append(element('p', 'chain-note', item.note));
      list.append(li);
    });
    section.append(list);
  }

  function clearSelection() {
    state.selected = null;
    state.channel = null;
    state.step = -1;
    state.harness = null;
  }

  const inView = p => Math.abs(p.x) < .93 && Math.abs(p.y) < .87 && Math.abs(p.z) < 1;

  function keepPickedPoint(hit) {
    resize();
    camera.updateMatrixWorld();
    // Preserve a useful angle and scale when a 3D point is already in view.
    if (!inView(hit.clone().project(camera))) {
      moveTo({...cameraPose(), target: hit.clone()}, {duration: 630});
    }
  }

  function frameSelected(id, hit) {
    if (hit) {
      keepPickedPoint(hit);
      return;
    }
    resize();
    camera.updateMatrixWorld();
    const points = partPoints([id]);
    if (!points.length) return;
    const screen = points.map(point => point.clone().project(camera));
    const span = new THREE.Box3().setFromPoints(screen).getSize(new THREE.Vector3());
    if (screen.every(inView) && Math.max(span.x, span.y) > .32) return;
    const destination = frame([id], [], [], {margin: 1.52});
    const change = Math.abs(Math.log(destination.distance / cameraPose().distance));
    moveTo(destination, {duration: 640 + Math.min(400, change * 135)});
  }

  function select(id, hit) {
    const module = modules.get(id);
    if (!module) return;
    if(inspection){focusInspection(id);return;}
    cameraMove = null;
    stopWater();
    stopAnimation();
    if (state.system !== 'all' && state.system !== module.component.system) {
      state.system = module.component.system;
      state.query = '';
      state.harnessQuery = '';
      $('#search').value = '';
      $('#system-route-search').value = '';
      renderSystems();
    }
    clearSelection();
    state.selected = id;
    window.dispatchEvent(new CustomEvent('log-part-picked',{detail:{id,name:module.component.name,channel:['rf','lr','lf','rr'].findIndex(side=>id.includes('-'+side+'-'))}}));
    const paths = connections.byPart.get(id);
    state.channel = paths?.signal ? 'signal' : paths?.power ? 'power' : null;
    if (paths) wireToggle.checked = true;
    renderList();
    renderHarnesses();
    renderDetails();
    applyDisplay();
    closeSidebar();
    frameSelected(id, hit);
  }

  function filterSystem(id, {reframe = true} = {}) {
    cameraMove = null;
    stopWater();
    stopAnimation();
    state.system = id;
    state.mode = id === 'all' ? 'transparent' : 'solid';
    state.query = '';
    state.harnessQuery = '';
    $('#search').value = '';
    $('#system-route-search').value = '';
    clearSelection();
    renderSystems();
    renderList();
    renderHarnesses();
    renderDetails();
    applyDisplay();
    $('#list').scrollTop = 0;
    if (reframe) fitCurrent(false);
  }

  const nodes = catalog.components.map(part => root.getObjectByName(part.nodeName));
  if (nodes.some(node => !node)) throw new Error('分类节点与模型不匹配');
  const bounds = new THREE.Box3();
  for (const node of nodes) bounds.expandByObject(node);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  catalog.components.forEach((component, index) => {
    const node = nodes[index];
    const middle = new THREE.Box3().setFromObject(node).getCenter(new THREE.Vector3());
    const direction = middle.clone().sub(center);
    if (direction.length() < extent * .03) direction.set(0, 1, 0);
    const delta = direction.normalize().multiplyScalar(extent * .45);
    const offset = node.parent.worldToLocal(middle.clone().add(delta)).sub(node.parent.worldToLocal(middle.clone()));
    partIds.set(node, component.id);
    modules.set(component.id, {node, component, origin: node.position.clone(), offset, meshes: prepareMaterials(node)});
  });

  $('#search').oninput = event => {
    state.query = event.target.value.trim().toLowerCase();
    renderList();
  };
  $('#system-route-search').oninput = event => {
    state.harnessQuery = event.target.value.trim().toLowerCase();
    renderHarnesses();
  };
  for (const control of controlsForDisplay) {
    control.onclick = () => { state.mode = control.dataset.display; applyDisplay(); };
  }
  $('#detail-close').onclick = () => {
    cameraMove = null;
    stopAnimation();
    clearSelection();
    renderDetails();
    renderList();
    renderHarnesses();
    applyDisplay();
  };
  $('#fit').onclick = () => { releaseCamera(); fitCurrent(); };
  $('#reset').onclick = () => {
    stopWater();
    stopAnimation();
    explodeDestination = 100;
    state.context = true;
    state.mode = 'transparent';
    wireToggle.checked = true;
    setExplode(0);
    filterSystem('all', {reframe: false});
    moveTo(currentFrame(false, homeDirection), {duration: 850});
  };
  range.oninput = event => {
    cameraMove = null;
    if (waterFlow?.active) {
      stopWater();
      applyDisplay();
    }
    stopAnimation();
    setExplode(event.target.value);
    explodeDestination = state.explode === 100 ? 0 : 100;
    updateAnimationButton();
  };
  range.onchange = () => fitCurrent();
  explodeButton.onclick = playAnimation;
  wireToggle.onchange = applyDisplay;
  contextToggle.onclick = () => {
    state.context = !state.context;
    applyDisplay();
  };
  if (waterFlow) {
    $('#spray-flow-toggle').onclick = () => toggleWater();
    for (const choice of document.querySelectorAll('[data-spray-view]')) {
      choice.onclick = () => showWaterView(choice.dataset.sprayView);
    }
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !details.hidden) $('#detail-close').click();
  });

  const raycaster = new THREE.Raycaster();
  controls.addEventListener('start', releaseCamera);
  canvas.addEventListener('pointerdown', event => {
    stopAnimation();
    if (event.isPrimary && event.button === 0) {
      pointerStart = {id: event.pointerId, x: event.clientX, y: event.clientY, time: performance.now()};
    }
  });
  canvas.addEventListener('pointercancel', () => { pointerStart = null; });
  canvas.addEventListener('pointerup', event => {
    const start = pointerStart;
    pointerStart = null;
    if (!start || event.pointerId !== start.id || event.button !== 0 || performance.now() - start.time > 700 ||
        Math.hypot(event.clientX - start.x, event.clientY - start.y) > 5) return;
    const rect = canvas.getBoundingClientRect();
    const pointer = new THREE.Vector2(
      (event.clientX - rect.left) / rect.width * 2 - 1,
      -(event.clientY - rect.top) / rect.height * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const targets = [...modules.values()].map(module => module.node).filter(node => node.visible);
    let partPick, referencePick, opaqueDistance = Infinity;
    for (const {object, point, distance, face} of raycaster.intersectObjects(targets, true)) {
      let node = object;
      while (node?.visible && !partIds.has(node)) node = node.parent;
      if (node?.visible && partIds.has(node)) {
        const id = partIds.get(node);
        const material = Array.isArray(object.material) ? object.material[face?.materialIndex || 0] : object.material;
        if (material && !material.transparent && material.depthWrite) opaqueDistance = Math.min(opaqueDistance, distance);
        if (foreground.has(id)) partPick ??= {id, point};
        else referencePick ??= {id, point};
      }
    }
    const wire = pickWire(raycaster, opaqueDistance);
    if (wire) selectHarness(connections.wireNames.get(wire.id), wire.point);
    else {
      const part = partPick || referencePick;
      if (part) select(part.id, part.point);
    }
  });

  controls.minDistance = .017;
  controls.maxDistance = Math.max(8, extent * 5);
  camera.position.copy(center).add(new THREE.Vector3(...homeDirection));
  controls.target.copy(center);
  filterSystem('all', {reframe: false});
  moveTo(currentFrame(false, homeDirection), {instant: true});
  const entry = new URLSearchParams(location.search);
  const water = entry.get('water');
  if (waterFlow && ['1', 'supply', 'follow'].includes(water)) toggleWater(water === '1' ? 'all' : water);
  else if (!entry.has('view') && !entry.has('log')) {
    state.mode = 'solid';
    applyDisplay();
    if (!reducedMotion.matches) openingAt = performance.now() + 240;
  }
  function inspectionPaths(){
    if(inspection?.target==='battery')return [...connections.byPart.values()].flatMap(paths=>paths.power?.steps||[]);
    if(!Number.isInteger(inspection?.channel))return [];
    const side=['rf','lr','lf','rr'][inspection.channel],paths=connections.byPart.get('drive-'+side+'-motor');
    return (inspection.path==='both'?['signal','power']:[inspection.path]).flatMap(key=>paths?.[key]?.steps||[]);
  }
  function applyInspection(){
    const side=['rf','lr','lf','rr'][inspection.channel],esc=inspection.target==='battery'?'power-battery':'drive-'+side+'-esc';
    const ids=new Set(inspectionPaths().flatMap(s=>s.routeIds)),complete=inspection.path==='both'?connections.completeHarnesses([...ids]):ids;
    foreground=new Set(inspectionPaths().flatMap(s=>s.partIds));
    for(const [id,module]of modules){module.node.visible=true;for(const {mesh,materials,array}of module.meshes){const styled=materials.map(material=>{
      if(id===esc){if(!inspectionMaterials.has(material)){const red=material.solid.clone();red.color?.set(0xf0243d);red.emissive?.set(0x650615);red.emissiveIntensity=.24;red.transparent=false;red.opacity=1;red.depthWrite=true;inspectionMaterials.set(material,red);}return inspectionMaterials.get(material);}
      if(id===inspection.focusPart)return material.solid;
      return inspection.transparent?material.transparent:material.solid;
    });mesh.material=array?styled:styled[0];}}
    shownWires=syncWires({visible:inspection.allHarness?new Set(routes.map(r=>r.id)):complete,focus:ids,show:true,overlay:true});
    $('#view-label').textContent='EVO 原工程模型 · 完整线束';$('#visible-count').textContent=`${catalog.components.length} 个部件 · 已载入 ${routes.length} 段线束 · 当前显示 ${shownWires} 段`;
    for(const control of controlsForDisplay)control.setAttribute('aria-pressed',String(control.dataset.display===(inspection.transparent?'transparent':'solid')));
  }
  function inspectionTargets(){
    if(inspection?.target==='battery')return [['power-battery','① 电池 · 优先排查'],['power-tail-connectors','② 电池尾插 / 接插件'],['power-distribution','③ 正负极主供电 / 配电'],['power-controller','④ 飞控供电支路'],...['rf','lr','lf','rr'].map((side,i)=>['drive-'+side+'-esc',['右前 #0','左后 #1','左前 #2','右后 #3'][i]+'电调供电支路'])].filter(([id])=>modules.has(id)).map(([id,label])=>({id,label,priority:id==='power-battery',point:new THREE.Box3().setFromObject(modules.get(id).node).getCenter(new THREE.Vector3()).toArray()}));
    if(!Number.isInteger(inspection?.channel))return [];
    const side=['rf','lr','lf','rr'][inspection.channel],name=['右前','左后','左前','右后'][inspection.channel];
    return [['power-controller','主控 · 信号接口'],['structure-'+side+'-arm',name+'机臂 · 完整线束'],['power-battery','主电池'],['power-tail-connectors','电池尾插'],['power-distribution','配电铜排'],['drive-'+side+'-motor',name+'电机 · 三相线'],['drive-'+side+'-esc','① '+name+'电调 · 优先检查']].map(([id,label])=>({id,label,point:new THREE.Box3().setFromObject(modules.get(id).node).getCenter(new THREE.Vector3()).toArray()}));
  }
  function focusInspection(id='esc'){
    if(!inspection)return;stopAnimation();cameraMove=null;const side=['rf','lr','lf','rr'][inspection.channel];
    if(id==='overview'){inspection.focusPart=null;applyInspection();moveTo(frame([...modules.keys()],[],[],{margin:1.14,heading:homeDirection}));return;}
    if(id==='esc')id='drive-'+side+'-esc';
    if(!modules.has(id))return;
    inspection.focusPart=id;applyInspection();
    const routeIds=id.includes('-arm')?inspectionPaths().flatMap(s=>s.routeIds):[];
    const heading=id.includes('-esc')||id.includes('-motor')?[side.startsWith('r')?-.8:.8,.45,side.endsWith('f')?1:-1]:id==='power-controller'?[.4,.9,1]:[.55,-.45,1];
    moveTo(frame([id],routeIds,[],{margin:id.includes('-arm')?1.35:1.8,heading}));
    window.dispatchEvent(new CustomEvent('log-part-picked',{detail:{id,name:modules.get(id).component.name,channel:inspection.channel}}));
  }
  function setInspection(value){
    const initial=!inspection||inspection.channel!==value.channel||inspection.target!==value.target;
    inspection={...inspection,...value};stopAnimation();if(state.explode)setExplode(0);applyInspection();
    if(initial)focusInspection('overview');
    return {targets:inspectionTargets(),loadedRoutes:routes.length,shownRoutes:shownWires,parts:catalog.components.length,routeIds:inspection.allHarness?routes.map(r=>r.id):inspection.path==='both'?[...connections.completeHarnesses(inspectionPaths().flatMap(s=>s.routeIds))]:[...new Set(inspectionPaths().flatMap(s=>s.routeIds))]};
  }
  return {update,setInspection,focusInspection,inspectionTargets,selectChannel(i,path){select('drive-'+['rf','lr','lf','rr'][i]+'-esc');state.channel=path;renderDetails();applyDisplay();},setMode(mode){state.mode=mode;applyDisplay();},setExplode(value){stopAnimation();setExplode(value);moveTo(currentFrame(false));},restore(){filterSystem('all');},get modules(){return modules;}};
};

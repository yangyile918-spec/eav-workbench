'use strict';

window.createEvoSprayFlow = function ({data, root, camera, stage, toWeb, tube, findObjects, getMaterial, registerMaterial}) {
  const $ = selector => document.querySelector(selector);
  const button = $('#spray-flow-toggle');
  const panel = $('#spray-flow-controls');
  const layer = $('#spray-flow-markers');
  const play = $('#spray-flow-play');
  const replay = $('#spray-flow-replay');
  const caption = $('#spray-flow-caption');
  const overviewCaption = caption.textContent;
  const views = [...panel.querySelectorAll('[data-spray-view]')];
  const waterScene = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(1, 8, 6);
  const matte = (color, opacity = 1) => new THREE.MeshBasicMaterial({
    color, transparent: opacity < 1, opacity, depthWrite: false, toneMapped: false
  });
  const lineMaterial = matte(0x177b9a, .68);
  const passageMaterial = matte(0x156788, .86);
  const pulseMaterial = matte(0x50e9ff);
  const mistMaterial = matte(0x209ec5, .73);
  const axisY = new THREE.Vector3(0, 1, 0);
  const pose = new THREE.Object3D();
  const scratch = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const labelPoint = new THREE.Vector3();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const PARTICLE_SPACING = .28;
  const PULSE_STEPS = 5;
  const PULSE_GAP = .007;
  const SPEED = .56;
  const FOLLOW_RATE = .42;
  const INTRO = .43;
  const SPRAY_TIME = .85;
  const JETS = 42;
  let active = false, playing = false, view = 'all', scope = 'all';
  let elapsed = 0, lastFrame = null, followRun = 0;

  function path(raw) {
    const points = raw.map(toWeb), distances = [0];
    for (let i = 1; i < points.length; i++) {
      distances.push(distances[i - 1] + points[i].distanceTo(points[i - 1]));
    }
    return {points, distances, length: distances.at(-1)};
  }

  function locate(route, at) {
    const {points, distances} = route;
    let lo = 0, hi = points.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (distances[mid] <= at) lo = mid;
      else hi = mid;
    }
    direction.subVectors(points[hi], points[lo]).normalize();
    scratch.lerpVectors(points[lo], points[hi], (at - distances[lo]) / (distances[hi] - distances[lo]));
  }

  function instances(group, material, size) {
    const mesh = new THREE.InstancedMesh(geometry, material, size);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    group.add(mesh);
    return mesh;
  }

  function addPath(group, route, radius, material) {
    const line = new THREE.Mesh(tube(route.points, radius, 10), material);
    group.add(line);
  }

  function track(group, raw, tubeRadius, pulseRadius) {
    const route = path(raw);
    addPath(group, route, tubeRadius, lineMaterial);
    const count = (Math.ceil(route.length / PARTICLE_SPACING) + 2) * PULSE_STEPS;
    return {...route, pulseRadius, pulses: instances(group, pulseMaterial, count)};
  }

  function label(point, title, kind, shiftX = 0, shiftY = -14) {
    const node = document.createElement('span');
    node.className = 'flow-marker flow-marker-' + kind;
    node.classList.toggle('flow-marker-below', shiftY > 0);
    node.style.setProperty('--flow-leader-length', Math.hypot(shiftX, shiftY) + 'px');
    node.style.setProperty('--flow-leader-angle', -Math.sign(shiftY) * Math.atan2(shiftX, Math.abs(shiftY)) + 'rad');
    node.textContent = title;
    node.hidden = true;
    layer.append(node);
    return {node, point, kind, shiftX, shiftY};
  }

  function fitShell(side) {
    const parent = root.getObjectByName('EVO_' + side.part_id);
    let stock;
    findObjects(side.stem_object)[0]?.traverse(node => { if (node.isMesh) stock ??= node; });
    if (!parent || !stock) throw new Error('找不到' + side.id + '侧原供水管');
    const points = side.shell.map(toWeb);
    const shape = tube(points, side.shell_radius_m, 16);
    shape.applyMatrix4(parent.matrixWorld.clone().invert());
    const material = getMaterial(stock);
    const pipe = new THREE.Mesh(shape, material);
    pipe.name = (side.id === 'left' ? '左后' : '右后') + '机臂内穿供水管';
    parent.add(pipe);
    registerMaterial(pipe, material);
  }

  root.updateMatrixWorld(true);
  const supply = data.supply;
  const ghostTank = new WeakSet();
  for (const object of supply.tank_context.flatMap(findObjects)) object.traverse(node => {
    if (node.isMesh) ghostTank.add(node);
  });
  const supplyParts = ['spray-tank', 'spray-pump-a', 'spray-pump-b', 'spray-flowmeter', 'unresolved-body-parts'];
  const supplyGroup = new THREE.Group();
  supplyGroup.name = '水箱及双泵供水';
  waterScene.add(supplyGroup);
  const common = track(supplyGroup, supply.common, .0037, .006);
  const meterCenter = toWeb(supply.sides.left.meter).lerp(toWeb(supply.sides.right.meter), .5);
  const supplyMarkers = [
    label(toWeb(supply.filter), '水箱出水 · 箱底滤网', 'filter', -42, -14),
    label(toWeb(supply.split), '双泵共用进水件', 'split', 0, 22),
    label(meterCenter, '双通道流量计 ↑', 'meter', 0, -18),
    label(toWeb(supply.sides.left.pump), '左水泵', 'pump', 31, 16),
    label(toWeb(supply.sides.right.pump), '右水泵', 'pump', -31, 16)
  ];
  const circuits = data.sides.map(side => {
    fitShell(side);
    const sideName = side.id === 'left' ? '左后' : '右后';
    const group = new THREE.Group();
    group.name = sideName + '水路';
    waterScene.add(group);
    const {feed, front_count: frontCount} = supply.sides[side.id];
    const front = track(supplyGroup, feed.slice(0, frontCount), .0031, .0055);
    const bodyGroup = new THREE.Group();
    bodyGroup.name = sideName + '机身供水管';
    waterScene.add(bodyGroup);
    const body = track(bodyGroup, feed.slice(frontCount - 1), .003, .006);
    const trunk = track(group, side.trunk, .003, .006), bore = path(side.bore);
    addPath(group, bore, .005, passageMaterial);
    const branches = side.branches.map(branch => {
      const route = track(group, branch.line, .0025, .004);
      const outlet = toWeb(branch.outlet), axis = toWeb(branch.axis).normalize();
      const radial = new THREE.Vector3(0, 0, 1).cross(axis).normalize();
      const tangent = axis.clone().cross(radial);
      return {
        route, outlet, axis, radial, tangent,
        spray: instances(group, mistMaterial, JETS)
      };
    });
    const markers = [
      label(toWeb(side.inlet), '折叠座进管', 'inlet', 0, 16),
      label(toWeb(side.passage), '穿过' + sideName + '机臂', 'bore'),
      label(toWeb(side.tee), sideName + '三通', 'tee', 0, -16),
      ...side.branches.map(branch => label(toWeb(branch.outlet), branch.id === 'inner' ? '内喷头' : '外喷头', 'outlet', 0, 18))
    ];
    const inlet = toWeb(side.inlet);
    let entry = 0;
    for (let i = 1; i < trunk.points.length; i++) {
      if (inlet.distanceToSquared(trunk.points[i]) < inlet.distanceToSquared(trunk.points[entry])) entry = i;
    }
    const inletTime = (common.length + front.length + body.length + trunk.distances[entry]) / SPEED;
    const teeTime = (common.length + front.length + body.length + trunk.length) / SPEED;
    return {id: side.id, group, bodyGroup, front, body, trunk, branches, markers, inletTime, teeTime};
  });
  const filledTime = Math.max(...circuits.map(({front, body, trunk, branches}) =>
    (common.length + front.length + body.length + trunk.length + Math.max(...branches.map(b => b.route.length))) / SPEED
  )) + SPRAY_TIME;
  const followShots = [
    {scope: 'supply', start: -INTRO, move: INTRO},
    {scope: 'arms', start: Math.min(...circuits.map(c => c.inletTime)) - .62, move: .58},
    {scope: 'outlets', start: Math.min(...circuits.map(c => c.teeTime)) - .62, move: .57}
  ];
  const captions = {
    all: overviewCaption,
    supply: '箱底出水分到左右泵，再分别从下往上通过流量计，接入同侧供水管。',
    arms: '两路液体沿机身水管到后横梁，经折叠座穿过左右后机臂。',
    outlets: '左右三通各分成两路，经电磁阀流向内、外喷头。'
  };

  function renderLabels(markers, width, height, show) {
    for (const {node, point, kind, shiftX, shiftY} of markers) {
      if (!show(kind)) { node.hidden = true; continue; }
      labelPoint.copy(point).project(camera);
      const x = (labelPoint.x + 1) * width / 2, y = (1 - labelPoint.y) * height / 2;
      node.hidden = labelPoint.z > 1 || labelPoint.z < -1 || x + shiftX < 45 || x + shiftX > width - 45 ||
        y + shiftY < 87 || y + shiftY > height - 76;
      if (!node.hidden) node.style.transform = 'translate(' + (x + shiftX) + 'px,' +
        (y + shiftY) + 'px) translate(-50%,' + (shiftY < 0 ? '-100%' : '0') + ')';
    }
  }

  function pulse(route, age) {
    const {pulses, pulseRadius} = route;
    let index = 0;
    if (age >= 0) {
      const start = (age * SPEED) % PARTICLE_SPACING;
      const end = Math.min(route.length + (PULSE_STEPS - 1) * PULSE_GAP, age * SPEED);
      for (let distance = start; distance <= end; distance += PARTICLE_SPACING) {
        for (let step = 0; step < PULSE_STEPS; step++) {
          const position = distance - step * PULSE_GAP;
          if (position < 0) break;
          if (position > route.length) continue;
          locate(route, position);
          pose.position.copy(scratch);
          pose.quaternion.setFromUnitVectors(axisY, direction);
          const radius = pulseRadius * (1 - step * .12);
          pose.scale.set(radius, PULSE_GAP * .78, radius);
          pose.updateMatrix();
          pulses.setMatrixAt(index++, pose.matrix);
        }
      }
    }
    pulses.count = index;
    pulses.instanceMatrix.needsUpdate = true;
  }

  function updateWater(circuit, time) {
    const {front, body, bodyGroup, trunk, branches} = circuit;
    const atSplit = time - common.length / SPEED;
    const atBody = atSplit - front.length / SPEED;
    const atTrunk = atBody - body.length / SPEED;
    if (supplyGroup.visible) pulse(front, atSplit);
    if (bodyGroup.visible) pulse(body, atBody);
    if (!circuit.group.visible) return;
    pulse(trunk, atTrunk);
    const atTee = atTrunk - trunk.length / SPEED;
    for (const branch of branches) {
      pulse(branch.route, atTee);
      const sprayAge = atTee - branch.route.length / SPEED;
      const spray = branch.spray;
      let index = 0;
      for (let i = 0; i < JETS; i++) {
        const offset = i * SPRAY_TIME / JETS;
        if (sprayAge < offset) continue;
        const age = ((sprayAge - offset) % SPRAY_TIME) / SPRAY_TIME;
        const angle = i * 2.3999632297 + Math.floor((sprayAge - offset) / SPRAY_TIME) * .51;
        const reach = .041 + age * (.105 + .023 * Math.sin(i * 3.13));
        pose.position.copy(branch.outlet).addScaledVector(branch.axis, .003 + .22 * age * age)
          .addScaledVector(branch.radial, Math.cos(angle) * reach)
          .addScaledVector(branch.tangent, Math.sin(angle) * reach);
        pose.quaternion.identity();
        pose.scale.setScalar(.0034 * (1 - age * .65));
        pose.updateMatrix();
        spray.setMatrixAt(index++, pose.matrix);
      }
      spray.count = index;
      spray.instanceMatrix.needsUpdate = true;
    }
  }

  function setScope(next) {
    scope = next;
    const rear = scope === 'all' || scope === 'arms' || scope === 'outlets';
    supplyGroup.visible = scope === 'all' || scope === 'supply';
    for (const circuit of circuits) {
      circuit.group.visible = rear || circuit.id === scope;
      circuit.bodyGroup.visible = scope === 'all' || scope === 'arms';
    }
    const stage = followShots.findIndex(shot => shot.scope === scope);
    caption.textContent = (view === 'follow' ? (stage + 1) + ' / 3 · ' : '') + (captions[scope] || overviewCaption);
    for (const choice of views) choice.setAttribute('aria-pressed', String(choice.dataset.sprayView === view));
  }

  function startFollow() {
    view = 'follow';
    followRun++;
    elapsed = -INTRO;
    playing = true;
    lastFrame = null;
    setScope('supply');
    syncControls();
  }

  function choose(next) {
    if (next === 'follow') {
      startFollow();
      return;
    }
    view = next;
    elapsed = Math.max(0, elapsed);
    setScope(next);
  }

  function syncControls() {
    panel.hidden = layer.hidden = !active;
    button.setAttribute('aria-pressed', String(active));
    play.textContent = playing ? '暂停流动' : '播放流动';
    play.setAttribute('aria-pressed', String(playing));
  }

  play.onclick = () => { playing = !playing; lastFrame = null; syncControls(); };
  replay.onclick = () => {
    if (view === 'follow') startFollow();
    else {
      elapsed = 0; playing = true; lastFrame = null; syncControls();
    }
  };
  button.hidden = false;

  return {
    get active() { return active; },
    get following() { return view === 'follow'; },
    get scope() { return scope; },
    ghostTank,
    get partIds() {
      return [
        ...(supplyGroup.visible ? supplyParts : []),
        ...circuits.filter(circuit => circuit.group.visible).flatMap(({id}) =>
          ['pipes', 'inner', 'outer'].map(part => 'spray-' + id + '-' + part))
      ];
    },
    enter() {
      active = true;
      playing = !reducedMotion.matches;
      elapsed = playing ? 0 : filledTime;
      lastFrame = null;
      choose('all');
      syncControls();
    },
    exit() { active = playing = false; lastFrame = null; syncControls(); },
    choose,
    releaseFollow() {
      if (view !== 'follow') return false;
      view = 'free';
      elapsed = Math.max(0, elapsed);
      setScope(scope);
      return true;
    },
    fitPoints() {
      return [
        ...(supplyGroup.visible ? [...common.points, ...circuits.flatMap(c => c.front.points)] : []),
        ...circuits.filter(circuit => circuit.group.visible).flatMap(circuit => [
          ...(scope === 'arms' ? circuit.body.points.filter(p => p.z < .1) : []),
          ...(scope === 'all' || scope === 'arms' ? circuit.trunk.points
            : circuit.trunk.points.filter(p => p.z < (scope === 'outlets' ? -.76 : -.66))),
          ...circuit.branches.flatMap(branch => [
            ...branch.route.points,
            branch.outlet.clone().addScaledVector(branch.axis, scope === 'outlets' ? .21 : .16)
          ])
        ])
      ];
    },
    tick(now) {
      if (!active) return;
      if (playing && lastFrame !== null) elapsed += Math.min(.08, (now - lastFrame) / 1000) *
        (view === 'follow' ? FOLLOW_RATE : 1);
      lastFrame = now;
      if (view !== 'follow') return;
      const shot = followShots.findLast(item => elapsed >= item.start);
      if (scope !== shot.scope) setScope(shot.scope);
      return {scope, run: followRun, progress: Math.min(1, (elapsed - shot.start) / shot.move)};
    },
    render(renderer) {
      if (!active) return;
      const w = stage.clientWidth, h = stage.clientHeight;
      if (supplyGroup.visible) pulse(common, elapsed);
      renderLabels(supplyMarkers, w, h, kind => scope === 'supply' || (scope === 'all' && kind === 'filter'));
      for (const circuit of circuits) {
        updateWater(circuit, elapsed);
        renderLabels(circuit.markers, w, h, kind => circuit.group.visible &&
          (scope === 'all' ? kind !== 'outlet' : scope === 'arms' ? kind === 'inlet' || kind === 'bore'
            : kind === 'tee' || kind === 'outlet'));
      }
      renderer.clearDepth();
      renderer.render(waterScene, camera);
    }
  };
};

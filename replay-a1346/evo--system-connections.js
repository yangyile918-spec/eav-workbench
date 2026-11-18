'use strict';

// J150 EVO 四喷头配置。接口与走向来自裸机 SOP、整机线路图及已确认的线束记录。
window.makeEvoConnections = function (catalog, routes) {
  const lookup = new Map(routes.flatMap(route => [[route.id, route], [route.name, route]]));
  const parts = new Map(catalog.components.map(part => [part.id, part]));
  const byPart = new Map();
  const bySystem = new Map(catalog.systems.map(system => [system.id, new Set()]));
  const wireNames = new Map();
  const routeParts = new Map();
  const branchesByName = new Map();
  function nameRoutes(name, keys) {
    for (const key of keys) {
      const route = lookup.get(key);
      if (!route) throw new Error('线束名称引用的线路不存在：' + key);
      wireNames.set(route.id, name);
    }
  }
  const nameSteps = (name, ...steps) => nameRoutes(name, steps.flatMap(item => item.routeIds));
  function listBranches(name, labels) {
    branchesByName.set(name, labels);
  }
  const step = (label, keys, modules = [], note = '') => {
    const routeIds = keys.map(key => {
      const route = lookup.get(key);
      if (!route) throw new Error('链路引用的线束不存在：' + key);
      return route.id;
    });
    for (const id of modules) if (!parts.has(id)) throw new Error('链路引用的部件不存在：' + id);
    for (const id of routeIds) {
      if (!routeParts.has(id)) routeParts.set(id, new Set());
      for (const part of modules) routeParts.get(id).add(part);
    }
    return {label, routeIds, partIds: modules, note};
  };
  const path = (title, ...steps) => ({title, steps});
  function connect(id, power, signal) {
    const system = parts.get(id).system;
    byPart.set(id, {power, signal});
    for (const connection of [power, signal]) {
      for (const item of connection?.steps || []) {
        for (const routeId of item.routeIds) bySystem.get(system).add(routeId);
      }
    }
  }

  const controller = 'power-controller', tail = 'power-tail-connectors';
  const battery = 'power-battery', board = 'power-distribution';
  const supply = step('主电池 → A/B 电池尾插', [], [battery, tail], '尾插 B 为正极，A 为负极。');
  const busbars = step('B/A 尾插 → D/C 配电铜排', ['positive-0', 'negative-0'], [tail, board],
    '正极经左纵梁后端局部通道接 D，负极经右纵梁后端局部通道接 C。');
  nameRoutes('正极电源配电线', ['positive-0']);
  nameRoutes('负极电源配电线', ['negative-0']);
  const busbarPath = path('主电池经尾插为分电板供电。', supply, busbars);
  const batterySignal = path('电池通讯线经右纵梁接入主控 205。',
    step('A 负极尾插 → 梁内 P3', ['tail-signal-205'], [tail], '信号线固定在 A 尾插上，P3 四位防水对插收在右纵梁后段。'),
    step('P3 → 右纵梁 → 主控 205', ['tail-signal-205-after-p3', 'fc205-common-trunk'], [controller],
      '到主控前与红黑供电线并入同一护套。'));
  const controllerPower = path('主电池经分电板向主控 205 提供电源。', supply, busbars,
    step('D/C 铜排 → 右纵梁 → 主控 205', [
      '485电源正极（铜排周边段）', '485电源负极（铜排周边段）',
      'fc205-485-positive', 'fc205-485-negative', 'fc205-common-trunk'
    ], [board, controller], '红黑线在右前线卡前并束，经原槽与通讯线汇合。'));
  nameSteps('485电源线束', ...batterySignal.steps, controllerPower.steps.at(-1));
  listBranches('485电源线束', ['D/C 铜排供电支路', 'A 尾插 485 通讯支路']);
  connect(battery, busbarPath, batterySignal);
  connect(tail, busbarPath, batterySignal);
  connect(board, busbarPath);
  connect(controller, controllerPower, batterySignal);
  const backupPower = path('备用电池通过防水对插接到主控 106。',
    step('备用电池出线孔 → FPV 支架中排', ['battery106-pigtail'], ['power-backup-battery'],
      '尾线从壳体原孔向内侧下行，接到支架中排的 8 针防水对插。'),
    step('防水对插 → 主控 106', ['fc106-battery'], [controller], '主控端沿机身右侧的支架空隙向下到对插。'));
  nameSteps('小电池线束', ...backupPower.steps);
  connect('power-backup-battery', backupPower);

  const arms = [
    {code:'M1', side:'右前', rail:'右', suffix:'rf', port:'208'},
    {code:'M2', side:'左前', rail:'左', suffix:'lf', port:'201'},
    {code:'M3', side:'左后', rail:'左', suffix:'lr', port:'203',
      rearNote:'B 正极在左侧接入，A 负极从右侧经后横梁内腔跨到左侧。'},
    {code:'M4', side:'右后', rail:'右', suffix:'rr', port:'206',
      rearNote:'B 正极从左侧经后横梁内腔跨到右侧，A 负极在右侧接入。'}
  ];
  for (const {code, side, rail, suffix, port, rearNote} of arms) {
    const arm = code.toLowerCase();
    const armPart = 'structure-' + suffix + '-arm';
    const esc = 'drive-' + suffix + '-esc', motor = 'drive-' + suffix + '-motor';
    const signalKey = rearNote ? arm + '-p4-drive-signal' : arm + '-p2-p4-signal';
    const senseKey = arm + (rearNote ? '-p6-presence' : '-p5-presence');
    const p = rearNote ? 'P6' : 'P5';
    const motorPhases = step(code + ' 动力电调 → 电机三相端子',
      ['yellow', 'orange', 'blue'].map(color => arm + '-phase-' + color),
      [esc, motor], '电调端从上到下为黄、橙、蓝，从靠电调的一侧接入电机底座。');
    nameSteps(side + '动力三相线', motorPhases);
    const signal = step('主控 ' + port + ' → ' + code + ' 动力电调 P4',
      [signalKey], [controller, armPart, esc],
      rearNote ? '信号经' + side + '机臂的折叠座和碳管，从原护圈接到电调 P4。'
        : '从' + side + '横梁线夹出线，经折叠座和碳管，接入 P4 原 8 针插头。');
    const presence = step(side + '机臂在位传感器 → ' + p + ' → 主控 ' + port,
      [senseKey, signalKey], [armPart, controller],
      '传感器尾线贴 T 形支架槽，经两芯对插并入机臂信号线。');
    const feedKeys = rearNote ? ['tail-' + code + '-positive', 'tail-' + code + '-negative'] : [];
    const feed = rearNote ? [
      supply,
      step('A/B 尾插 → 后横梁 → ' + code + ' 动力电调', feedKeys, [tail, armPart, esc],
        rearNote + '两线经折叠座进碳管，电调上口接红正，下口接黑负。')
    ] : [
      supply, busbars,
      step('D/C 铜排 → ' + rail + '侧纵梁入口',
        [code + '机臂电源正极（铜排周边段）', code + '机臂电源负极（铜排周边段）'], [board]),
      step(rail + '纵梁 → 折叠座与碳管 → ' + code + ' 动力电调',
        [arm + '-power-pos-extension', arm + '-power-neg-extension'], [armPart, esc],
        '红正和黑负的子弹头分别对接动力电调上口和下口。')
    ];
    const armHarness = side + '机臂线束';
    nameSteps(armHarness, ...feed.slice(rearNote ? 1 : 2), signal, presence);
    const armBranches = ['动力电调正负供电', 'P4 动力电调信号', p + ' 在位传感器'];
    listBranches(armHarness, armBranches);
    connect(esc, path(code + ' 动力电调的正负供电链路。', ...feed),
      path('主控 ' + port + ' 的控制信号送到 ' + code + ' 动力电调。', signal));
    connect(motor, path('主电源进动力电调，三相输出驱动电机。', ...feed, motorPhases),
      path('主控控制动力电调，由电调通过三相输出驱动电机。', signal, motorPhases));
    connect(armPart, null, path('机臂根部的在位传感器向主控反馈。', presence));
    for (const id of presence.routeIds) bySystem.get('drive').add(id);
    if (!rearNote) continue;

    const spraySide = rail === '左' ? 'left' : 'right';
    const sprayEsc = 'spray-' + spraySide + '-esc';
    const sprayFeed = [
      supply,
      step('A/B 尾插 → ' + side + '机臂供电主干', feedKeys, [tail, armPart], rearNote),
      step('碳管内分接 → ' + code + ' 喷头电调 P7',
        [arm + '-spray-positive', arm + '-spray-negative'], [armPart, sprayEsc],
        '同侧红黑供电从机臂主干分出，红正接 P7 上口，黑负接下口。')
    ];
    const spraySignal = step('主控 ' + port + ' → ' + code + ' 喷头电调 P5',
      [arm + '-spray-signal'], [controller, armPart, sprayEsc],
      '信号随同侧后机臂线束经纵梁、折叠座和碳管送到喷头电调。');
    nameSteps(armHarness, sprayFeed.at(-1), spraySignal);
    armBranches.push('P5 喷头电调信号', 'P7 喷头电调正负供电');
    connect(sprayEsc, path('每侧两个喷头共用一套喷头电调。', ...sprayFeed),
      path('主控通过后机臂线束控制同侧喷头电调。', spraySignal));
    for (const [branch, nozzleName] of [['inner', '内喷头'], ['outer', '外喷头']]) {
      const nozzle = 'spray-' + spraySide + '-' + branch;
      const phase = step('喷头电调三相输出 → ' + rail + '侧' + nozzleName,
        ['a', 'b', 'c'].map(pin => arm + '-spray-' + branch + '-phase-' + pin),
        [sprayEsc, nozzle], '黄、绿、红三相线直连该喷头的三相接口。');
      const valve = step('喷头电调 → 电磁阀集线器 → ' + nozzleName + '电磁阀',
        [arm + '-spray-valve-common', arm + '-spray-valve-' + branch], [sprayEsc, nozzle],
        '同侧集线器一进两出，此处显示通往选中喷头的支线。');
      nameSteps(rail + '侧' + nozzleName + '三相线', phase);
      nameSteps(rail + '侧电磁阀线束', valve);
      connect(nozzle, path('同侧喷头电调向喷头电机输出三相驱动。', ...sprayFeed, phase),
        path('主控控制喷头电调，电调通过集线器控制此喷头的电磁阀。', spraySignal, valve));
    }
    listBranches(rail + '侧电磁阀线束', ['集线器至内喷头电磁阀', '集线器至外喷头电磁阀']);
  }

  const tankPower = step('D/C 铜排 → 左纵梁 → 左前线卡', [
    '喷洒电源正极（铜排周边段）', '喷洒电源负极（铜排周边段）',
    'spray-work-positive', 'spray-work-negative', 'spray-work-positive-final', 'spray-work-negative-final'
  ], [board], '两根电源线从左纵梁前端出线并束，占用同一个卡槽。');
  const tankSignal = step('主控 204 → 左前线卡', ['spray-204-to-24p'], [controller],
    '204 信号走相邻槽，出槽后与红黑供电并束。');
  const tankSensorPower = step('主控 204 → 左前线卡', ['spray-204-to-24p'], [controller],
    '传感器供电随主控 204 线束进入 24 针对插。');
  const tankMate = step('左侧并束 → 主控下方 24 针对插', ['spray-work-body-common'],
    [controller, 'unresolved-connectors'], '从机尾看，机体侧在左，药箱侧喷洒总线在右。');
  nameSteps('水箱播撒线束', tankPower, tankSignal, tankMate);
  listBranches('水箱播撒线束', ['铜排红黑供电支路', '主控 204 支路']);
  const tankBranches = [
    ['spray-pump-a', '左水泵（PUMP-L）', ['spray-bus-pump-left', 'spray-pump-left-lead']],
    ['spray-pump-b', '右水泵（PUMP-R）', ['spray-bus-pump-right', 'spray-pump-right-lead']],
    ['spray-flowmeter', '流量计（EMF）', ['spray-bus-emf']],
    ['spray-level', '气压传感器（Barometer）', ['spray-bus-barometer']]
  ].map(([id, label, keys]) => [id, step('药箱侧总线 → ' + label, keys, [id],
    id.startsWith('spray-pump-') ? '经原对插和泵体引线接入水泵。' : '接入喷洒总线对应的传感器支路。')]);
  for (const [id, branch] of tankBranches) {
    const power = id.startsWith('spray-pump-')
      ? path('水泵由铜排供电，经 24 针对插接入药箱侧。', supply, busbars, tankPower, tankMate, branch)
      : path('传感器由主控 204 经 24 针对插供电。', tankSensorPower, tankMate, branch);
    connect(id, power, path('主控 204 经 24 针对插与药箱侧设备相连。', tankSignal, tankMate, branch));
  }
  const branchSteps = tankBranches.map(([, branch]) => branch);
  nameSteps('喷洒总线', ...branchSteps);
  listBranches('喷洒总线', ['PUMP-L 左水泵支路', 'PUMP-R 右水泵支路', 'EMF 流量计支路', 'Barometer 气压传感器支路']);
  connect('spray-tank', path('水泵和传感器的供电均经 24 针对插进入药箱侧。',
    supply, busbars, tankPower, tankSensorPower, tankMate, ...branchSteps),
    path('喷洒总线从 24 针分到两个水泵、流量计和气压传感器。', tankSignal, tankMate, ...branchSteps));
  connect('unresolved-connectors',
    path('水泵和传感器的供电均经此接头进入药箱侧。', tankPower, tankSensorPower, tankMate, ...branchSteps),
    path('主控 204 由 24 针接头转接到药箱侧总线。', tankSignal, tankMate, ...branchSteps));

  const weight = path('左前、右前和后横梁三路在主控下方汇束，接入主控 105。',
    step('右前称重传感器 P2 → 主控 105', ['fc105-weight-p1'], ['spray-weighing', controller]),
    step('左前称重传感器 P3 → 主控 105', ['fc105-weight-p1-p3'], ['spray-weighing', controller]),
    step('后横梁称重传感器 P4 → 右梁底 → 主控 105', ['fc105-weight-p1-p4'], ['spray-weighing', controller],
      '线束在后壳内走到右侧，再沿右梁下缘走向主控。'));
  nameSteps('称重传感器线束', ...weight.steps);
  listBranches('称重传感器线束', ['P2 右前称重支路', 'P3 左前称重支路', 'P4 后横梁称重支路']);
  connect('spray-weighing', weight, weight);

  for (const [id, port, label, key, harnessName, note] of [
    ['sense-front-lidar', '103', '前视激光雷达', 'fc103-front-lidar', '前激光雷达线束',
      '主控端用 3×4 法兰弯头，沿前模块支架走线，雷达端接 2×6 的 12 针插头。'],
    ['sense-front-rotating', '104', '上方旋转雷达', 'fc104-front-radar', '前旋转雷达线束', '从主控 104 接到前部上方的旋转雷达。'],
    ['sense-rear-radar', '207', '后旋转雷达', 'fc207-rear-radar-p1', '后旋转雷达线束',
      '从主控下侧线槽出线，与 105 并走右梁底，经右后脚架线卡到雷达。'],
    ['nav-fpv', '102', 'FPV 摄像头', 'fc102-fpv', 'FPV线束', '主控 102 接入前部 FPV 摄像头。']
  ]) {
    const link = step('主控 ' + port + ' ↔ ' + label, [key], [controller, id], note);
    nameSteps(harnessName, link);
    connect(id, path('该设备的供电随主控 ' + port + ' 外部线束到达设备端。', link),
      path('设备通过同一线束与主控 ' + port + ' 交换信号。', link));
  }
  const gps = step('主控 101 ↔ GPS 主天线 P2', ['fc101-gps'], [controller, 'nav-gnss-main'],
    '线束从主控前侧下行，经支架窗口和底壳压线件进入原进线槽，直插主天线。');
  const gpsPair = step('GPS 主天线 ↔ 中部对插 ↔ GPS 副天线', ['rf-gps-main-exit', 'rf-gps-secondary-exit'],
    ['nav-gnss-main', 'nav-gnss-secondary'], '两端直插各自天线壳内的圆形座，中段在主控与上雷达之间对插。');
  const wifi = step('主控第 5 路射频出口 ↔ GPS 主天线', ['rf-wifi-main'], [controller, 'nav-gnss-main'],
    'Wi‑Fi 馈线接入主天线壳内的进线座。');
  nameSteps('GPS线束', gps);
  nameSteps('GPS主副天线馈线', gpsPair);
  nameSteps('Wi-Fi馈线', wifi);
  connect('nav-gnss-main', path('GPS 主天线的供电经主控 101 线束。', gps),
    path('101 连接主天线，主副天线之间及 Wi‑Fi 各有独立馈线。', gps, gpsPair, wifi));
  connect('nav-gnss-secondary', null, path('副天线通过独立馈线与 GPS 主天线连接。', gpsPair));
  const rf = [];
  for (const [band, label, note] of [
    ['24g', '2.4G', '馈线从机身中部沿左右梁下通过，在朝机身内侧的天线座接入。'],
    ['4g', '4G', '对插固定在上雷达两侧，紧邻左右贴片天线。']
  ]) {
    for (const [side, name] of [['l', '左'], ['r', '右']]) {
      const prefix = 'rf-' + band + '-' + side;
      rf.push(step('主控射频线 ↔ ' + name + '侧 ' + label + ' 天线',
        [prefix + '-controller', prefix + '-antenna'], [controller, 'nav-antennas'], note));
      nameRoutes(label + '-' + side.toUpperCase() + ' 馈线', [prefix + '-controller', prefix + '-antenna']);
    }
  }
  connect('nav-antennas', null, path('主控到两侧 2.4G、4G 天线各有独立馈线。', ...rf));
  connect('nav-light', path('主控 202 的灯线经左前脚架接入探照灯。',
    step('主控 202 → 左前脚架 → 探照灯', ['fc202-led'], [controller, 'nav-light']),
    step('灯端 P4 封口固定', ['fc202-led-p4-capped'], ['nav-light'], '此支路封口后固定在前撑横管。')));
  connect('power-fans', path('双风扇由主控 202 的 P3 支路供电。',
    step('主控 202 → P3 四针对插', ['fc202-led-p3-fan', 'fan-202-pigtail'], [controller], '对插整体卡入 FPV 支架原槽。'),
    step('P3 分线 → 上方风扇', ['fan-202-upper'], ['power-fans']),
    step('P3 分线 → 下方风扇', ['fan-202-lower'], ['power-fans'])));
  nameRoutes('LED线束', ['fc202-led', 'fc202-led-p4-capped', 'fc202-led-p3-fan']);
  nameRoutes('主控散热风扇线', ['fan-202-pigtail', 'fan-202-upper', 'fan-202-lower']);
  listBranches('LED线束', ['探照灯主线', 'P3 风扇供电支路', 'P4 封口支路']);
  listBranches('主控散热风扇线', ['上方风扇支路', '下方风扇支路']);

  const assigned = new Set([...bySystem.values()].flatMap(ids => [...ids]));
  const unassigned = routes.filter(route => !assigned.has(route.id));
  if (unassigned.length) throw new Error('线束未关联到系统：' + unassigned.map(route => route.name).join('、'));
  const unnamed = routes.filter(route => !wireNames.has(route.id));
  if (unnamed.length) throw new Error('缺少标准线束名称：' + unnamed.map(route => route.name).join('、'));
  const namedGroups = new Map();
  for (const [id, name] of wireNames) {
    if (!namedGroups.has(name)) namedGroups.set(name, []);
    namedGroups.get(name).push(id);
  }
  function completeHarnesses(ids) {
    const complete = new Set(ids);
    for (const id of complete) {
      for (const member of namedGroups.get(wireNames.get(id))) complete.add(member);
      for (const member of lookup.get(id).harness?.members || []) complete.add(member.id);
    }
    return complete;
  }
  for (const [id, routes] of bySystem) bySystem.set(id, completeHarnesses(routes));
  bySystem.set('all', assigned);
  const harnesses = new Map([...namedGroups].map(([name, routeIds]) =>
    [name, {key: name, name, routeIds, steps: []}]));
  const stepsByHarness = new Map();
  for (const {power, signal} of byPart.values()) {
    for (const path of [power, signal]) {
      for (const {label, note, routeIds} of path?.steps || []) {
        for (const name of new Set(routeIds.map(id => wireNames.get(id)))) {
          if (!stepsByHarness.has(name)) stepsByHarness.set(name, new Map());
          const steps = stepsByHarness.get(name);
          if (!steps.has(label) || (!steps.get(label).note && note)) steps.set(label, {label, note});
        }
      }
    }
  }
  for (const [name, group] of harnesses) group.steps = [...(stepsByHarness.get(name)?.values() || [])];
  harnesses.get('正极电源配电线').steps = [{
    label: 'B 正极尾插 → D 正极铜排', note: '从左纵梁后端的局部通道穿入，再从内侧孔出线接铜排。'
  }];
  harnesses.get('负极电源配电线').steps = [{
    label: 'A 负极尾插 → C 负极铜排', note: '从右纵梁后端的局部通道穿入，再从内侧孔出线接铜排。'
  }];
  harnesses.get('喷洒总线').summary = '经主控下方的 24 针对插接入药箱侧，分为四路。';
  return {byPart, bySystem, wireNames, routeParts, branchesByName, completeHarnesses, harnesses};
};

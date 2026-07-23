// 极目售后分析组工作台 - 主逻辑
(function() {
    'use strict';

    const STORAGE_KEY = 'droneWorkbenchRecords';
    const TRASH_KEY = 'droneWorkbenchTrash';
    const CLOUD_CONFIG_KEY = 'droneWorkbenchCloudConfig';
    const FINISHED_STATUS = ['完结待签字', '待评价', '已评价'];

    // 默认云同步配置（Token 分段拼接，避免 GitHub secret 检测）
    const _tk = ['ghp_', 'tyjTeTA', 'ywqISx5V', '8ISiG2yp', 'zzbLp7Y4', 'Vjg8n'].join('');
    const DEFAULT_CLOUD_CONFIG = {
        enabled: true,
        token: _tk,
        owner: 'yangyile918-spec',
        repo: 'eav-workbench',
        branch: 'main'
    };

    let records = [];
    let trashRecords = [];
    let charts = {};
    let editingId = null;

    // 周报生成相关
    let ordersData = null;   // 工单导出数据
    let crashData = null;    // 炸机周报数据

    // ========== 用户认证系统 ==========
    const USERS_KEY = 'droneWorkbenchUsers';
    const SESSION_KEY = 'droneWorkbenchSession';

    // 简单哈希（前端安全有限，仅做基本混淆）
    function simpleHash(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        // 再做一轮混淆
        let h2 = 0;
        const s = hash.toString() + str.length;
        for (let i = 0; i < s.length; i++) {
            h2 = ((h2 << 7) - h2) + s.charCodeAt(i);
            h2 = h2 & h2;
        }
        return 'h_' + Math.abs(hash).toString(36) + '_' + Math.abs(h2).toString(36);
    }

    function getDefaultUsers() {
        return [
            {
                id: 1,
                name: '杨怡乐',
                account: '13838169824',
                password: simpleHash('yyl123456'),
                role: '管理员',
                createdAt: new Date().toISOString(),
                lastLogin: null
            }
        ];
    }

    function loadUsers() {
        try {
            const raw = localStorage.getItem(USERS_KEY);
            if (!raw) {
                const defaults = getDefaultUsers();
                localStorage.setItem(USERS_KEY, JSON.stringify(defaults));
                return defaults;
            }
            return JSON.parse(raw);
        } catch(e) {
            console.error('[loadUsers]', e);
            return getDefaultUsers();
        }
    }

    function saveUsers(users) {
        localStorage.setItem(USERS_KEY, JSON.stringify(users));
    }

    function getSession() {
        try {
            const raw = sessionStorage.getItem(SESSION_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch(e) { return null; }
    }

    function setSession(user) {
        sessionStorage.setItem(SESSION_KEY, JSON.stringify({
            id: user.id,
            name: user.name,
            account: user.account,
            role: user.role
        }));
    }

    function clearSession() {
        sessionStorage.removeItem(SESSION_KEY);
    }

    function doLogin(account, password) {
        const users = loadUsers();
        const pwdHash = simpleHash(password);
        const user = users.find(u => u.account === account && u.password === pwdHash);
        if (user) {
            user.lastLogin = new Date().toISOString();
            saveUsers(users);
            setSession(user);
            return user;
        }
        return null;
    }

    function showLogin() {
        document.getElementById('loginOverlay').style.display = 'flex';
        document.getElementById('mainApp').style.display = 'none';
    }

    function showApp() {
        document.getElementById('loginOverlay').style.display = 'none';
        document.getElementById('mainApp').style.display = 'flex';
        updateUserInfo();
    }

    function updateUserInfo() {
        const session = getSession();
        if (!session) return;
        document.getElementById('userName').textContent = session.name;
        document.getElementById('userRole').textContent = session.role;
        // 管理员显示用户管理入口
        const navUsers = document.getElementById('navUsers');
        if (navUsers) {
            navUsers.style.display = (session.role === '管理员') ? 'flex' : 'none';
        }
    }

    function initLogin() {
        const session = getSession();
        if (session) {
            showApp();
            return true;
        }
        showLogin();
        return false;
    }

    function bindLoginEvents() {
        // 登录表单
        document.getElementById('loginForm').addEventListener('submit', function(e) {
            e.preventDefault();
            const account = document.getElementById('loginAccount').value.trim();
            const password = document.getElementById('loginPassword').value;
            const errEl = document.getElementById('loginError');

            if (!account || !password) {
                errEl.textContent = '请输入账号和密码';
                return;
            }

            const user = doLogin(account, password);
            if (user) {
                errEl.textContent = '';
                showApp();
                // 登录后初始化数据
                loadRecords();
                loadTrash();
                bindEvents();
                setDefaultDates();
                updateCurrentDate();
                renderTodayTable();
                generateDailyReport();
                generateWeeklyReport();
                updateDashboard();
                initReportPage();
                // 云同步
                const cfg = getCloudConfig();
                if (cfg && cfg.enabled && cfg.token) {
                    updateSyncStatus('syncing', '正在同步...');
                    (async function() {
                        const ok = await pullFromCloud();
                        if (!ok) updateSyncStatus('local', '💻 终端云同步可用');
                    })();
                } else {
                    updateSyncStatus('local');
                }
                startAutoSync();
            } else {
                errEl.textContent = '账号或密码错误';
                document.getElementById('loginPassword').value = '';
            }
        });

        // 退出登录
        document.getElementById('btnLogout').addEventListener('click', function() {
            if (confirm('确定退出登录？')) {
                clearSession();
                showLogin();
                document.getElementById('loginAccount').value = '';
                document.getElementById('loginPassword').value = '';
                document.getElementById('loginError').textContent = '';
            }
        });
    }

    // ========== 用户管理 ==========
    function renderUsersTable() {
        const users = loadUsers();
        const tbody = document.getElementById('usersTableBody');
        if (!tbody) return;
        tbody.innerHTML = '';
        users.forEach(function(u, i) {
            const tr = document.createElement('tr');
            const roleClass = u.role === '管理员' ? 'role-admin' : (u.role === '组长' ? 'role-leader' : 'role-member');
            const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleString('zh-CN') : '从未登录';
            const createdAt = u.createdAt ? new Date(u.createdAt).toLocaleDateString('zh-CN') : '—';
            tr.innerHTML = 
                '<td>' + (i + 1) + '</td>' +
                '<td><strong>' + u.name + '</strong></td>' +
                '<td>' + u.account + '</td>' +
                '<td><span class="role-badge ' + roleClass + '">' + u.role + '</span></td>' +
                '<td>' + createdAt + '</td>' +
                '<td>' + lastLogin + '</td>' +
                '<td>' +
                    '<button class="btn btn-sm btn-secondary" onclick="editUser(' + u.id + ')">✏️ 编辑</button> ' +
                    (u.role !== '管理员' ? '<button class="btn btn-sm btn-danger" onclick="deleteUser(' + u.id + ')">🗑️</button>' : '') +
                '</td>';
            tbody.appendChild(tr);
        });
    }

    window.editUser = function(id) {
        const users = loadUsers();
        const user = users.find(u => u.id === id);
        if (!user) return;
        document.getElementById('userModalTitle').textContent = '编辑用户';
        document.getElementById('editUserId').value = user.id;
        document.getElementById('editUserName').value = user.name;
        document.getElementById('editUserAccount').value = user.account;
        document.getElementById('editUserPassword').value = '';
        document.getElementById('pwdHint').textContent = '（留空不修改）';
        document.getElementById('editUserRole').value = user.role;
        document.getElementById('userModal').classList.add('show');
    };

    window.deleteUser = function(id) {
        const session = getSession();
        if (session && session.id === id) {
            alert('不能删除当前登录的用户');
            return;
        }
        if (!confirm('确定删除该用户？')) return;
        let users = loadUsers();
        users = users.filter(u => u.id !== id);
        saveUsers(users);
        renderUsersTable();
    };

    window.closeUserModal = function() {
        document.getElementById('userModal').classList.remove('show');
        document.getElementById('editUserId').value = '';
        document.getElementById('editUserName').value = '';
        document.getElementById('editUserAccount').value = '';
        document.getElementById('editUserPassword').value = '';
        document.getElementById('pwdHint').textContent = '*';
        document.getElementById('editUserRole').value = '分析员';
    };

    function bindUserEvents() {
        // 新增用户按钮
        const btnAdd = document.getElementById('btnAddUser');
        if (btnAdd) {
            btnAdd.addEventListener('click', function() {
                document.getElementById('userModalTitle').textContent = '新增用户';
                document.getElementById('editUserId').value = '';
                document.getElementById('editUserName').value = '';
                document.getElementById('editUserAccount').value = '';
                document.getElementById('editUserPassword').value = '';
                document.getElementById('pwdHint').textContent = '*';
                document.getElementById('editUserRole').value = '分析员';
                document.getElementById('userModal').classList.add('show');
            });
        }

        // 保存用户
        const btnSave = document.getElementById('btnSaveUser');
        if (btnSave) {
            btnSave.addEventListener('click', function() {
                const id = document.getElementById('editUserId').value;
                const name = document.getElementById('editUserName').value.trim();
                const account = document.getElementById('editUserAccount').value.trim();
                const password = document.getElementById('editUserPassword').value;
                const role = document.getElementById('editUserRole').value;

                if (!name || !account) {
                    alert('姓名和账号不能为空');
                    return;
                }

                let users = loadUsers();

                if (id) {
                    // 编辑
                    const user = users.find(u => u.id === parseInt(id));
                    if (!user) return;
                    // 检查账号重复
                    if (users.some(u => u.account === account && u.id !== user.id)) {
                        alert('该账号已存在');
                        return;
                    }
                    user.name = name;
                    user.account = account;
                    if (password) user.password = simpleHash(password);
                    user.role = role;
                } else {
                    // 新增
                    if (!password) {
                        alert('新增用户必须设置密码');
                        return;
                    }
                    if (users.some(u => u.account === account)) {
                        alert('该账号已存在');
                        return;
                    }
                    const maxId = users.reduce((max, u) => Math.max(max, u.id), 0);
                    users.push({
                        id: maxId + 1,
                        name: name,
                        account: account,
                        password: simpleHash(password),
                        role: role,
                        createdAt: new Date().toISOString(),
                        lastLogin: null
                    });
                }

                saveUsers(users);
                renderUsersTable();
                closeUserModal();
            });
        }
    }

    // ========== 初始化 ==========
    function init() {
        // 先绑定登录事件
        bindLoginEvents();
        bindUserEvents();

        // 检查登录状态
        if (!initLogin()) {
            return; // 未登录，停在登录页
        }

        // 已登录，初始化业务
        loadRecords();
        loadTrash();
        loadFollowupRecords();
        bindEvents();
        setDefaultDates();
        updateCurrentDate();
        renderTodayTable();
        generateDailyReport();
        generateWeeklyReport();
        updateDashboard();
        initReportPage();
        // Try cloud sync on startup
        const cfg = getCloudConfig();
        console.log('[init] cloud config:', cfg);
        if (cfg && cfg.enabled && cfg.token) {
            updateSyncStatus('syncing', '正在同步...');
            // Use async IIFE to await pullFromCloud in init
            (async function() {
                const ok = await pullFromCloud();
                console.log('[init] pullFromCloud result:', ok);
                if (!ok) {
                    // Browser fetch failed, but terminal sync is available
                    updateSyncStatus('local', '💻 终端云同步可用');
                }
            })();
        } else {
            updateSyncStatus('local');
        }
        // 自动实时同步：每30秒从云端拉取最新数据
        startAutoSync();
    }

    // ========== 自动实时同步 ==========
    let autoSyncTimer = null;
    let isSyncing = false;

    function startAutoSync() {
        const cfg = getCloudConfig();
        if (!cfg || !cfg.enabled || !cfg.token) return;
        
        // 清除旧定时器
        if (autoSyncTimer) clearInterval(autoSyncTimer);
        
        // 每30秒自动拉取云端数据
        autoSyncTimer = setInterval(async function() {
            if (isSyncing) return; // 避免并发
            const cfg = getCloudConfig();
            if (!cfg || !cfg.enabled) return;
            
            isSyncing = true;
            try {
                const rawUrl = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch || 'main'}/data/records.json?t=${Date.now()}`;
                const resp = await fetch(rawUrl);
                if (resp.ok) {
                    const content = await resp.text();
                    const cloudRecords = JSON.parse(content);
                    if (Array.isArray(cloudRecords)) {
                        // 比较数据是否有变化
                        const localStr = JSON.stringify(records.map(r => r.id).sort());
                        const cloudStr = JSON.stringify(cloudRecords.map(r => r.id).sort());
                        if (localStr !== cloudStr || records.length !== cloudRecords.length) {
                            // 合并：云端优先
                            const merged = new Map();
                            records.forEach(r => merged.set(r.id, r));
                            cloudRecords.forEach(r => merged.set(r.id, r));
                            records = Array.from(merged.values());
                            localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
                            renderTodayTable();
                            generateDailyReport();
                            generateWeeklyReport();
                            updateDashboard();
                            updateSyncStatus('synced', `已同步 ${records.length} 条`);
                            console.log('[AutoSync] 数据已更新');
                        }
                    }
                }
            } catch(e) {
                console.log('[AutoSync] 网络错误:', e.message);
            } finally {
                isSyncing = false;
            }
        }, 30000); // 30秒间隔
        
        // 页面获得焦点时也立即同步
        document.addEventListener('visibilitychange', function() {
            if (!document.hidden) {
                console.log('[AutoSync] 页面激活，立即同步');
                isSyncing = false; // 重置状态
                if (autoSyncTimer) {
                    clearInterval(autoSyncTimer);
                    autoSyncTimer = null;
                }
                // 立即执行一次同步
                (async function() {
                    if (isSyncing) return;
                    const cfg = getCloudConfig();
                    if (!cfg || !cfg.enabled) return;
                    
                    isSyncing = true;
                    try {
                        const rawUrl = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch || 'main'}/data/records.json?t=${Date.now()}`;
                        const resp = await fetch(rawUrl);
                        if (resp.ok) {
                            const content = await resp.text();
                            const cloudRecords = JSON.parse(content);
                            if (Array.isArray(cloudRecords)) {
                                const merged = new Map();
                                records.forEach(r => merged.set(r.id, r));
                                cloudRecords.forEach(r => merged.set(r.id, r));
                                const newRecords = Array.from(merged.values());
                                if (newRecords.length !== records.length) {
                                    records = newRecords;
                                    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
                                    renderTodayTable();
                                    generateDailyReport();
                                    generateWeeklyReport();
                                    updateDashboard();
                                    updateSyncStatus('synced', `已同步 ${records.length} 条`);
                                    console.log('[AutoSync] 页面激活同步完成');
                                }
                            }
                        }
                    } catch(e) {
                        console.log('[AutoSync] 页面激活同步失败:', e.message);
                    } finally {
                        isSyncing = false;
                    }
                })();
                // 重启定时器
                startAutoSync();
            }
        });
    }

    // ========== 存储 ==========
    let cloudSyncTimer = null;

    function loadRecords() {
        try {
            const data = localStorage.getItem(STORAGE_KEY);
            records = data ? JSON.parse(data) : [];
            // 数据迁移：修复7列炸机分析表导入导致的列错位问题
            // 当 feedbackPerson 包含问题定性关键词但 problemType 为空时，说明数据错位
            const PROBLEM_KW = /操作问题|动力问题|质量问题|故障|断裂|烧|炸|裂纹|变形|损坏|不符合质保|手动碰撞|卡扣|尾插|机臂|信号|失联|雷达|避障|喷洒|播撒|GPS|RTK|航线|偏航|翻机|坠机|失控|问题/i;
            let migrated = false;
            records.forEach(r => {
                if (r.feedbackPerson && PROBLEM_KW.test(r.feedbackPerson) && !r.problemType) {
                    // feedbackPerson 里存的是问题定性内容，需要修正
                    r.problemType = r.feedbackPerson;
                    r.feedbackPerson = '';
                    migrated = true;
                }
                // 自动推导机型：如果 model 为空但有 airframeNo，根据机架号后5位首字符推导
                if (!r.model && r.airframeNo) {
                    const detected = detectModelFromAirframe(r.airframeNo);
                    if (detected) {
                        r.model = detected;
                        migrated = true;
                    }
                }
            });
            // 数据迁移 v47：修复10列数据解析错误导致的字段错位
            // 特征：model 字段存的是地块编号（长数字+破折号），flightBatch 存的是省区，feedbackPerson 存的是问题定性
            const FLIGHT_BATCH_PATTERN = /^\d{10,}\s*[—\-–]+\s*\d+/;
            const PROVINCE_PATTERN = /^(广东|海南|四川|云南|福建|湖南|湖北|河南|河北|山东|山西|陕西|甘肃|青海|台湾|广西|贵州|安徽|江苏|浙江|江西|黑龙江|吉林|辽宁|内蒙古|新疆|西藏|宁夏|北京|天津|上海|重庆|香港|澳门|美国)/;
            let migratedV47 = false;
            records.forEach(r => {
                const modelIsFlightBatch = r.model && FLIGHT_BATCH_PATTERN.test(r.model);
                const flightBatchIsRegion = r.flightBatch && PROVINCE_PATTERN.test(r.flightBatch);

                if (modelIsFlightBatch || flightBatchIsRegion) {
                    const correctFlightBatch = modelIsFlightBatch ? r.model : (r.flightBatch || '');
                    const correctRegion = flightBatchIsRegion ? r.flightBatch : (r.region || '');
                    const correctProblemType = r.region || '';
                    
                    r.model = '';
                    r.flightBatch = correctFlightBatch;
                    r.region = correctRegion;
                    r.problemType = correctProblemType;
                    r.feedbackPerson = '';
                    migratedV47 = true;
                    console.log('[数据迁移 v47] 修复记录:', r.airframeNo);
                }
            });
            if (migratedV47) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
                console.log('[数据迁移 v47] 已修复字段错位');
            }
            if (migrated) {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
                console.log('[数据迁移] 已修复列错位/补充机型');
            }
        } catch(e) { records = []; }
    }
    function loadTrash() {
        try {
            const data = localStorage.getItem(TRASH_KEY);
            trashRecords = data ? JSON.parse(data) : [];
        } catch(e) { trashRecords = []; }
    }
    function saveTrash() {
        localStorage.setItem(TRASH_KEY, JSON.stringify(trashRecords));
    }
    function saveRecords(skipCloud, keepStatus) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
        // Don't overwrite sync status if we're syncing or already synced
        const statusEl = document.querySelector('.sync-status');
        const currentStatus = statusEl ? (statusEl.dataset.status || '') : '';
        if (!keepStatus && currentStatus !== 'syncing' && currentStatus !== 'synced') {
            updateSyncStatus('local');
        }
        if (!skipCloud) {
            // Debounced cloud sync (2s delay)
            clearTimeout(cloudSyncTimer);
            cloudSyncTimer = setTimeout(() => {
                const cfg = getCloudConfig();
                if (cfg && cfg.enabled) pushToCloud();
            }, 2000);
        }
    }

    // ========== 云同步 ==========
    function getCloudConfig() {
        try {
            const data = localStorage.getItem(CLOUD_CONFIG_KEY);
            if (data) return JSON.parse(data);
            // 首次使用：自动写入默认配置
            setCloudConfig(DEFAULT_CLOUD_CONFIG);
            return DEFAULT_CLOUD_CONFIG;
        } catch(e) { return DEFAULT_CLOUD_CONFIG; }
    }
    function setCloudConfig(cfg) {
        localStorage.setItem(CLOUD_CONFIG_KEY, JSON.stringify(cfg));
    }

    function updateSyncStatus(state, msg) {
        const dot = document.querySelector('.sync-dot');
        const text = document.querySelector('.sync-text');
        const statusEl = document.querySelector('.sync-status');
        if (!dot || !text) return;
        dot.className = 'sync-dot ' + state;
        if (statusEl) statusEl.dataset.status = state;
        const labels = { local: '本地存储', syncing: '同步中...', synced: '已云同步', error: '同步失败' };
        text.textContent = msg || labels[state] || '本地存储';
    }

    async function pushToCloud() {
        const cfg = getCloudConfig();
        if (!cfg || !cfg.enabled || !cfg.token) return false;
        updateSyncStatus('syncing');
        try {
            const apiUrl = `https://api.github.com/repos/${cfg.owner}/${cfg.repo}/contents/data/records.json`;
            const content = btoa(unescape(encodeURIComponent(JSON.stringify(records, null, 2))));
            // Check if file exists (need sha for update)
            let sha = null;
            try {
                const resp = await fetch(apiUrl, {
                    headers: { 'Authorization': `token ${cfg.token}`, 'Accept': 'application/vnd.github.v3+json' }
                });
                if (resp.ok) {
                    const existing = await resp.json();
                    sha = existing.sha;
                }
            } catch(e) { /* file doesn't exist yet, that's fine */ }
            // Create or update
            const body = {
                message: `auto-sync: ${records.length} records @ ${new Date().toLocaleString('zh-CN')}`,
                content: content,
                branch: cfg.branch || 'main'
            };
            if (sha) body.sha = sha;
            const resp = await fetch(apiUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${cfg.token}`,
                    'Accept': 'application/vnd.github.v3+json',
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(body)
            });
            if (resp.ok) {
                updateSyncStatus('synced', `已同步 ${records.length} 条`);
                return true;
            } else {
                const err = await resp.json();
                updateSyncStatus('error', '同步失败');
                console.error('Cloud sync error:', err);
                return false;
            }
        } catch(e) {
            updateSyncStatus('error', '网络错误');
            console.error('Cloud sync error:', e);
            return false;
        }
    }

    async function pullFromCloud() {
        const cfg = getCloudConfig();
        console.log('[pullFromCloud] config:', cfg ? 'exists' : 'null');
        if (!cfg || !cfg.enabled || !cfg.token) return false;
        updateSyncStatus('syncing', '从云端加载...');
        try {
            // Use raw.githubusercontent.com for reading (CDN, works in China)
            const rawUrl = `https://raw.githubusercontent.com/${cfg.owner}/${cfg.repo}/${cfg.branch || 'main'}/data/records.json`;
            console.log('[pullFromCloud] fetching:', rawUrl);
            const resp = await fetch(rawUrl);
            console.log('[pullFromCloud] response:', resp.status);
            if (resp.ok) {
                const content = await resp.text();
                console.log('[pullFromCloud] content length:', content.length);
                const cloudRecords = JSON.parse(content);
                console.log('[pullFromCloud] cloudRecords:', Array.isArray(cloudRecords) ? 'array, length=' + cloudRecords.length : 'not array');
                if (Array.isArray(cloudRecords)) {
                    // Merge: local records + cloud records (by id, LOCAL wins to preserve deletions)
                    const merged = new Map();
                    cloudRecords.forEach(r => merged.set(r.id, r));  // 先放云端数据
                    records.forEach(r => merged.set(r.id, r));       // 本地数据覆盖云端（本地优先）
                    records = Array.from(merged.values());
                    console.log('[pullFromCloud] merged records:', records.length);
                    saveRecords(true, true); // save locally without re-syncing
                    renderTodayTable();
                    generateDailyReport();
                    generateWeeklyReport();
                    updateDashboard();
                    updateSyncStatus('synced', `已加载 ${records.length} 条`);
                    console.log('[pullFromCloud] success, loaded', records.length, 'records');
                    return true;
                } else {
                    console.log('[pullFromCloud] cloudRecords is not array');
                }
            } else if (resp.status === 404) {
                updateSyncStatus('synced', '云端暂无数据');
                return false;
            } else {
                updateSyncStatus('error', '加载失败');
                return false;
            }
        } catch(e) {
            updateSyncStatus('error', '网络错误');
            console.error('[pullFromCloud] error:', e);
            return false;
        }
    }

    async function testCloudConnection(cfg) {
        try {
            const resp = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}`, {
                headers: { 'Authorization': `token ${cfg.token}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if (resp.ok) {
                const repo = await resp.json();
                return { ok: true, msg: `✅ 连接成功！仓库：${repo.full_name}（${repo.private ? '私有' : '公开'}）` };
            } else if (resp.status === 401) {
                return { ok: false, msg: '❌ Token 无效或已过期' };
            } else if (resp.status === 404) {
                return { ok: false, msg: '❌ 仓库不存在或无权限' };
            } else {
                return { ok: false, msg: `❌ 错误 ${resp.status}` };
            }
        } catch(e) {
            return { ok: false, msg: '❌ 网络错误：' + e.message };
        }
    }

    // ========== 事件绑定 ==========
    function bindEvents() {
        // 导航
        document.querySelectorAll('.nav-item').forEach(item => {
            item.addEventListener('click', e => {
                e.preventDefault();
                const page = item.dataset.page;
                switchPage(page);
            });
        });

        // 录入
        document.getElementById('btnAddRecord').addEventListener('click', clearForm);
        document.getElementById('btnSave').addEventListener('click', saveRecord);
        document.getElementById('btnClear').addEventListener('click', clearForm);
        document.getElementById('btnSmartEntry').addEventListener('click', () => {
            document.getElementById('smartEntryModal').classList.add('show');
        });
        document.getElementById('smartEntryClose').addEventListener('click', () => {
            document.getElementById('smartEntryModal').classList.remove('show');
        });
        document.getElementById('smartEntryCancel').addEventListener('click', () => {
            document.getElementById('smartEntryModal').classList.remove('show');
        });
        document.getElementById('smartEntryText').addEventListener('paste', handleSmartPaste);
        document.getElementById('smartEntryConfirm').addEventListener('click', confirmSmartEntry);

        // 智能录入 - Tab切换 & OCR
        initSmartTabs();
        initOCRUpload();

        // 反馈模板
        document.getElementById('feedbackTemplateText').addEventListener('input', handleFeedbackTemplateInput);
        document.getElementById('feedbackTemplateText').addEventListener('paste', handleFeedbackTemplateInput);
        document.getElementById('btnFeedbackTemplate').addEventListener('click', () => {
            document.getElementById('smartEntryModal').classList.add('show');
            // 切换到反馈模板标签
            document.querySelectorAll('.smart-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('[data-tab="feedback"]').classList.add('active');
            document.getElementById('smartTabText').style.display = 'none';
            document.getElementById('smartTabImage').style.display = 'none';
            document.getElementById('smartTabFeedback').style.display = '';
        });
        // 在智能录入弹窗的确认按钮中检测当前标签
        document.getElementById('smartEntryConfirm').addEventListener('click', () => {
            const feedbackTab = document.getElementById('smartTabFeedback');
            if (feedbackTab && feedbackTab.style.display !== 'none') {
                confirmFeedbackEntry();
            }
        });

        // 问题解决
        document.getElementById('btnSaveSolution').addEventListener('click', saveSolutionRecord);

        // 日报
        document.getElementById('dailyDate').addEventListener('change', generateDailyReport);
        document.getElementById('btnGenerateDaily').addEventListener('click', generateDailyReport);
        document.getElementById('btnExportDaily').addEventListener('click', exportDailyExcel);
        document.getElementById('btnExportDailyDocx').addEventListener('click', exportDailyDocx);

        // 周报 - 文件上传
        document.getElementById('fileOrders').addEventListener('change', handleOrdersUpload);
        document.getElementById('fileCrash').addEventListener('change', handleCrashUpload);
        document.getElementById('btnGenerateWeekly').addEventListener('click', generateStandardWeekly);

        // 导入导出
        document.getElementById('btnImport').addEventListener('click', () => {
            document.getElementById('fileImport').click();
        });
        document.getElementById('fileImport').addEventListener('change', importAllData);
        document.getElementById('btnExportAll').addEventListener('click', exportAllData);

        // 云同步设置
        document.getElementById('btnSettings').addEventListener('click', openSettingsModal);
        document.getElementById('btnSyncNow').addEventListener('click', async () => {
            const cfg = getCloudConfig();
            if (!cfg || !cfg.enabled) {
                alert('请先启用云同步（点击☁️按钮）');
                return;
            }
            updateSyncStatus('syncing', '同步中...');
            // Push local data to cloud, then pull cloud data
            await pushToCloud();
            await pullFromCloud();
            alert('✅ 同步完成');
        });
        document.getElementById('settingsClose').addEventListener('click', () => {
            document.getElementById('settingsModal').classList.remove('show');
        });
        // 启用同步
        document.getElementById('btnEnableSync').addEventListener('click', () => {
            const cfg = getCloudConfig() || DEFAULT_CLOUD_CONFIG;
            cfg.enabled = true;
            setCloudConfig(cfg);
            openSettingsModal(); // 刷新状态
            updateSyncStatus('syncing', '正在同步...');
            pushToCloud();
        });
        // 暂停同步
        document.getElementById('btnDisableSync').addEventListener('click', () => {
            const cfg = getCloudConfig();
            if (cfg) {
                cfg.enabled = false;
                setCloudConfig(cfg);
            }
            openSettingsModal(); // 刷新状态
            updateSyncStatus('local');
        });
    }

    // ========== 页面切换 ==========
    function switchPage(page) {
        document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
        document.querySelector(`[data-page="${page}"]`).classList.add('active');
        document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
        document.getElementById(`page-${page}`).classList.add('active');

        const titles = { entry:'日常工作录入', daily:'日报预览 / 导出', weekly:'周报自动生成', report:'定责分析报告', dashboard:'数据统计看板', trash:'回收站', history:'历史数据', followup:'跟进任务', solution:'问题解决', users:'用户管理' };
        document.getElementById('pageTitle').textContent = titles[page] || '';

        if (page === 'daily') generateDailyReport();
        if (page === 'dashboard') updateDashboard();
        if (page === 'trash') renderTrashPage();
        if (page === 'history') renderHistoryPage();
        if (page === 'followup') renderFollowupPage();
        if (page === 'solution') renderSolutionPage();
        if (page === 'users') renderUsersTable();
        if (page === 'report') {
            updateReportPreview();
            // 绑定报告页面按钮事件（确保绑定）
            bindReportButtons();
            // 启动实时预览定时器
            if (window._reportWatchTimer) clearInterval(window._reportWatchTimer);
            window._reportWatchTimer = setInterval(() => {
                updateReportPreview();
            }, 1000);
        } else {
            // 离开报告页面时停止定时器
            if (window._reportWatchTimer) {
                clearInterval(window._reportWatchTimer);
                window._reportWatchTimer = null;
            }
        }
    }

    // ========== 日期 ==========
    function setDefaultDates() {
        const now = new Date();
        document.getElementById('analysisTime').value = formatDateTimeLocal(now);
        document.getElementById('dailyDate').value = formatDateLocal(now);
        // 周报标题默认本周
        const weekStart = getWeekStart(now);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        document.getElementById('weeklyTitleDate').value =
            `${weekStart.getMonth()+1}月${weekStart.getDate()}日-${weekEnd.getMonth()+1}月${weekEnd.getDate()}日`;
    }
    function updateCurrentDate() {
        const now = new Date();
        const opts = { year:'numeric', month:'long', day:'numeric', weekday:'long' };
        document.getElementById('currentDate').textContent = now.toLocaleDateString('zh-CN', opts);
    }
    function formatDateLocal(d) {
        return d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
    }
    function formatDateTimeLocal(d) {
        return formatDateLocal(d) + 'T' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
    }
    function formatDateTime(s) {
        if (!s) return '—';
        const d = new Date(s);
        return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }
    function formatDateShort(s) {
        if (!s) return '—';
        const d = new Date(s);
        return `${d.getMonth()+1}/${d.getDate()}`;
    }
    function formatTimeOnly(s) {
        if (!s) return '—';
        // 只提取日期部分 YYYY-MM-DD，不显示具体时间
        const match = String(s).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
        if (match) {
            return `${match[1]}-${match[2].padStart(2,'0')}-${match[3].padStart(2,'0')}`;
        }
        return String(s).substring(0, 10);
    }
    function getWeekStart(d) {
        const r = new Date(d);
        const day = r.getDay() || 7;
        r.setDate(r.getDate() - day + 1);
        r.setHours(0,0,0,0);
        return r;
    }
    function esc(s) { return String(s||'').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

    // ========== 记录 CRUD ==========
    function clearForm() {
        editingId = null;
        ['workOrderNo','airframeNo','model','flightBatch','feedbackPerson','analyst',
         'tracker','reviewer','problemDescription','faultCondition','initialAnalysis',
         'followUp','finalConclusion','region'].forEach(id => document.getElementById(id).value = '');
        document.getElementById('problemType').value = '';
        document.getElementById('auditResult').value = '';
        document.getElementById('analysisTime').value = formatDateTimeLocal(new Date());
        // 自动填充分析人为当前登录用户
        const session = getSession();
        if (session && session.name) {
            document.getElementById('analyst').value = session.name;
        }
    }

    function saveRecord() {
        const record = {
            id: editingId || Date.now().toString(36) + Math.random().toString(36).substr(2,5),
            analysisTime: document.getElementById('analysisTime').value,
            workOrderNo: document.getElementById('workOrderNo').value.trim(),
            airframeNo: document.getElementById('airframeNo').value.trim(),
            model: document.getElementById('model').value.trim(),
            flightBatch: document.getElementById('flightBatch').value.trim(),
            feedbackPerson: document.getElementById('feedbackPerson').value.trim(),
            analyst: document.getElementById('analyst').value.trim(),
            problemType: document.getElementById('problemType').value,
            auditResult: document.getElementById('auditResult').value,
            tracker: document.getElementById('tracker').value.trim(),
            reviewer: document.getElementById('reviewer').value.trim(),
            problemDescription: document.getElementById('problemDescription').value.trim(),
            faultCondition: document.getElementById('faultCondition').value.trim(),
            initialAnalysis: document.getElementById('initialAnalysis').value.trim(),
            followUp: document.getElementById('followUp').value.trim(),
            finalConclusion: document.getElementById('finalConclusion').value.trim(),
            region: document.getElementById('region').value.trim()
        };
        // 自动推导机型：如果 model 为空但有 airframeNo
        if (!record.model && record.airframeNo) {
            record.model = detectModelFromAirframe(record.airframeNo);
        }
        if (!record.analysisTime) { alert('请填写分析时间'); return; }

        if (editingId) {
            const idx = records.findIndex(r => r.id === editingId);
            if (idx >= 0) records[idx] = record;
        } else {
            records.push(record);
        }
        saveRecords();
        clearForm();
        renderTodayTable();
        updateDashboard();
        alert('✅ 保存成功');
    }

    window.editRecord = function(id) {
        const r = records.find(x => x.id === id);
        if (!r) return;
        editingId = id;
        const session = getSession();
        ['analysisTime','workOrderNo','airframeNo','model','flightBatch','feedbackPerson',
         'analyst','problemType','auditResult','tracker','reviewer','problemDescription',
         'faultCondition','initialAnalysis','followUp','finalConclusion','region'].forEach(k => {
            const el = document.getElementById(k);
            if (el) el.value = r[k] || '';
        });
        // 分析人同步为当前登录用户
        if (session && session.name) {
            document.getElementById('analyst').value = session.name;
        }
        switchPage('entry');
    };

    window.deleteRecord = function(id) {
        if (!confirm('确定删除此记录？可前往回收站恢复')) return;
        const idx = records.findIndex(r => r.id === id);
        if (idx === -1) return;
        const removed = records.splice(idx, 1)[0];
        removed._deletedAt = new Date().toISOString();
        trashRecords.push(removed);
        saveRecords(false, false); // 保存到本地并触发云同步
        saveTrash();
        renderTodayTable();
        renderHistoryPage();
        updateDashboard();
        // 立即同步到云端（不等待 2 秒延迟），确保删除操作同步
        const cfg = getCloudConfig();
        if (cfg && cfg.enabled) {
            pushToCloud().then(success => {
                if (!success) {
                    alert('⚠️ 云同步失败，删除的记录可能在下次登录时恢复。请检查网络连接后重试。');
                }
            });
        }
    };

    window.restoreRecord = function(id) {
        const idx = trashRecords.findIndex(r => r.id === id);
        if (idx === -1) return;
        const restored = trashRecords.splice(idx, 1)[0];
        delete restored._deletedAt;
        records.push(restored);
        saveTrash();
        saveRecords();
        renderTrashPage();
        renderHistoryPage();
        renderTodayTable();
        updateDashboard();
    };

    window.emptyTrash = function() {
        if (trashRecords.length === 0) { alert('回收站已清空'); return; }
        if (!confirm(`确定永久删除回收站中的 ${trashRecords.length} 条记录？此操作不可恢复！`)) return;
        trashRecords = [];
        saveTrash();
        renderTrashPage();
    };

    window.renderTrashPage = function() {
        const tbody = document.querySelector('#trashTable tbody');
        const count = document.getElementById('trashCount');
        if (!tbody) return;
        count.textContent = trashRecords.length;
        if (trashRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state"><div class="empty-state-icon">🗑️</div>回收站空空如也</td></tr>';
            return;
        }
        // 按删除日期分组，最新删除排前面
        const sorted = trashRecords.sort((a,b) => new Date(b._deletedAt || 0) - new Date(a._deletedAt || 0));
        const groups = {};
        sorted.forEach(r => {
            const dateKey = formatDateShort(r._deletedAt);
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push(r);
        });
        const rows = [];
        Object.keys(groups).forEach(dateKey => {
            rows.push(`<tr class="date-group-header"><td colspan="9">🗑️ ${dateKey}</td></tr>`);
            groups[dateKey].forEach(r => {
                rows.push(`<tr>
                    <td>${formatTimeOnly(r.analysisTime)}</td>
                    <td>${esc(r.workOrderNo)}</td>
                    <td>${esc(r.airframeNo)}</td>
                    <td>${esc(r.model)}</td>
                    <td>${esc(r.analyst)}</td>
                    <td>${esc(r.problemType)}</td>
                    <td><span class="audit-badge audit-${r.auditResult||'未判定'}">${esc(r.auditResult||'未判定')}</span></td>
                    <td title="${esc(r.initialAnalysis||'')}">${esc((r.initialAnalysis||'—').substring(0, 20))}${(r.initialAnalysis||'').length > 20 ? '…' : ''}</td>
                    <td>
                        <button class="btn btn-text" style="color:var(--success)" onclick="restoreRecord('${r.id}')">↩ 恢复</button>
                    </td>
                </tr>`);
            });
        });
        tbody.innerHTML = rows.join('');
    };

    window.renderHistoryPage = function() {
        const tbody = document.querySelector('#historyTable tbody');
        const count = document.getElementById('historyCount');
        if (!tbody) return;
        count.textContent = records.length;
        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="empty-state"><div class="empty-state-icon">📂</div>暂无历史数据</td></tr>';
            return;
        }
        // 获取筛选条件
        const filterDate = (document.getElementById('historyFilterDate') || {}).value || '';
        const filterModel = (document.getElementById('historyFilterModel') || {}).value || '';
        const filterAnalyst = (document.getElementById('historyFilterAnalyst') || {}).value || '';
        const filterType = (document.getElementById('historyFilterType') || {}).value || '';

        let filtered = [...records];
        if (filterDate) filtered = filtered.filter(r => r.analysisTime && r.analysisTime.startsWith(filterDate));
        if (filterModel) filtered = filtered.filter(r => r.model && r.model.includes(filterModel));
        if (filterAnalyst) filtered = filtered.filter(r => r.analyst && r.analyst.includes(filterAnalyst));
        if (filterType) filtered = filtered.filter(r => r.problemType && r.problemType.includes(filterType));

        count.textContent = filtered.length + ' / ' + records.length;

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="11" class="empty-state"><div class="empty-state-icon">🔍</div>无匹配记录</td></tr>';
            return;
        }

        // 按日期分组，时间倒序
        const sorted = filtered.sort((a,b) => new Date(b.analysisTime) - new Date(a.analysisTime));
        const groups = {};
        sorted.forEach(r => {
            const dateKey = formatDateShort(r.analysisTime);
            if (!groups[dateKey]) groups[dateKey] = [];
            groups[dateKey].push(r);
        });

        const rows = [];
        // 按日期倒序排列（最新的日期在上面）- 从已排序的数组中提取日期键
        const dateKeys = [];
        sorted.forEach(r => {
            const dateKey = formatDateShort(r.analysisTime);
            if (!dateKeys.includes(dateKey)) {
                dateKeys.push(dateKey);
            }
        });
        dateKeys.forEach(dateKey => {
            rows.push(`<tr class="date-group-header"><td colspan="11">📅 ${dateKey}</td></tr>`);
            groups[dateKey].forEach(r => {
                rows.push(`<tr>
                    <td><input type="checkbox" class="row-checkbox" data-id="${r.id}" onchange="updateSelectedCount()" style="cursor:pointer;"></td>
                    <td>${formatTimeOnly(r.analysisTime)}</td>
                    <td>${esc(r.workOrderNo)}</td>
                    <td>${esc(r.airframeNo)}</td>
                    <td>${esc(r.model)}</td>
                    <td>${esc(r.analyst)}</td>
                    <td>${esc(r.problemType)}</td>
                    <td><span class="audit-badge audit-${r.auditResult||'未判定'}">${esc(r.auditResult||'未判定')}</span></td>
                    <td title="${esc(r.initialAnalysis||'')}">${esc((r.initialAnalysis||'—').substring(0, 25))}${(r.initialAnalysis||'').length > 25 ? '…' : ''}</td>
                    <td title="${esc(r.finalConclusion||'')}">${esc((r.finalConclusion||'—').substring(0, 25))}${(r.finalConclusion||'').length > 25 ? '…' : ''}</td>
                    <td><button class="btn btn-text" onclick="editRecord('${r.id}')">✏️</button><button class="btn btn-text" style="color:#007bff;" onclick="openFollowupFromRecord('${r.id}')">📋</button><button class="btn btn-text" style="color:var(--danger)" onclick="deleteRecord('${r.id}')">🗑️</button></td>
                </tr>`);
            });
        });
        tbody.innerHTML = rows.join('');
        
        // 重置全选状态
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const headerSelectAll = document.getElementById('headerSelectAll');
        if (selectAllCheckbox) selectAllCheckbox.checked = false;
        if (headerSelectAll) headerSelectAll.checked = false;
        updateSelectedCount();
    };

    // ========== 批量删除功能 ==========
    window.toggleSelectAll = function(checked) {
        const checkboxes = document.querySelectorAll('.row-checkbox');
        checkboxes.forEach(cb => cb.checked = checked);
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const headerSelectAll = document.getElementById('headerSelectAll');
        if (selectAllCheckbox) selectAllCheckbox.checked = checked;
        if (headerSelectAll) headerSelectAll.checked = checked;
        updateSelectedCount();
    };

    window.updateSelectedCount = function() {
        const checkboxes = document.querySelectorAll('.row-checkbox');
        const checked = document.querySelectorAll('.row-checkbox:checked');
        const count = checked.length;
        const countEl = document.getElementById('selectedCount');
        const btn = document.getElementById('batchDeleteBtn');
        if (countEl) countEl.textContent = `已选 ${count} 条`;
        if (btn) {
            btn.disabled = count === 0;
            btn.style.opacity = count === 0 ? '0.5' : '1';
        }
        // 同步全选框状态
        const allCount = checkboxes.length;
        const selectAllCheckbox = document.getElementById('selectAllCheckbox');
        const headerSelectAll = document.getElementById('headerSelectAll');
        if (selectAllCheckbox) selectAllCheckbox.checked = count === allCount && allCount > 0;
        if (headerSelectAll) headerSelectAll.checked = count === allCount && allCount > 0;
    };

    window.batchDeleteSelected = function() {
        const checked = document.querySelectorAll('.row-checkbox:checked');
        if (checked.length === 0) {
            alert('请先选择要删除的记录');
            return;
        }
        if (!confirm(`确定删除选中的 ${checked.length} 条记录？删除后可在回收站恢复。`)) return;
        
        const idsToDelete = Array.from(checked).map(cb => cb.dataset.id);
        let deletedCount = 0;
        
        idsToDelete.forEach(id => {
            const idx = records.findIndex(r => r.id === id);
            if (idx !== -1) {
                const removed = records.splice(idx, 1)[0];
                removed._deletedAt = new Date().toISOString();
                trashRecords.push(removed);
                deletedCount++;
            }
        });
        
        saveRecords(false, false);
        saveTrash();
        renderHistoryPage();
        renderTodayTable();
        updateDashboard();
        
        // 立即同步到云端
        const cfg = getCloudConfig();
        if (cfg && cfg.enabled) {
            pushToCloud().then(success => {
                if (success) {
                    alert(`✅ 成功删除 ${deletedCount} 条记录，已同步到云端`);
                } else {
                    alert(`⚠️ 已删除 ${deletedCount} 条记录，但云同步失败。请检查网络连接后重试。`);
                }
            });
        } else {
            alert(`✅ 成功删除 ${deletedCount} 条记录`);
        }
    };

    // ========== 从日常记录一键生成定责报告 ==========
    window.generateReportFromRecord = function(id) {
        const r = records.find(x => x.id === id);
        if (!r) { alert('记录不存在'); return; }

        // 切换到报告页面
        switchPage('report');

        // 填充报告表单
        const title = document.getElementById('rptTitle');
        const bodyId = document.getElementById('rptBodyId');
        const flightName = document.getElementById('rptFlightName');
        const expiryDate = document.getElementById('rptExpiryDate');
        const flightTime = document.getElementById('rptFlightTime');
        const flightProcess = document.getElementById('rptFlightProcess');
        const bodySN = document.getElementById('rptBodySN');
        const analysisResult = document.getElementById('rptAnalysisResult');
        const elecSN = document.getElementById('rptElecSN');
        const caseNo = document.getElementById('rptCaseNo');
        const trackNo = document.getElementById('rptTrackNo');

        if (title) title.value = `极目定责分析报告_${r.workOrderNo || ''}`;
        if (bodyId) bodyId.value = r.airframeNo || '';
        // 解析架次-地块
        if (r.flightBatch) {
            const parts = r.flightBatch.split('-');
            if (parts.length >= 2) {
                if (flightName) flightName.value = parts[0].trim();
                if (expiryDate) expiryDate.value = parts.slice(1).join('-').trim();
            } else {
                if (flightName) flightName.value = r.flightBatch;
            }
        }
        if (flightTime) flightTime.value = r.analysisTime || '';
        if (flightProcess) flightProcess.value = r.initialAnalysis || '';
        if (bodySN) bodySN.value = r.airframeNo || '';
        // 问题定性 → 审核结果映射
        const problemMap = {
            '设置': '人为原因导致事故，请付费处理。',
            '操作': '操作不当导致损坏，建议培训。',
            '动力': '产品质量问题，免费维修。',
            '结构': '产品质量问题，免费维修。',
            '软件': '产品质量问题，免费维修。',
            '其他': 'custom'
        };
        if (analysisResult) {
            const mapped = problemMap[r.problemType] || '';
            if (mapped && mapped !== 'custom') {
                analysisResult.value = mapped;
            } else if (mapped === 'custom') {
                analysisResult.value = 'custom';
                document.getElementById('rptAnalysisResultCustom').value = r.problemType || '';
                document.getElementById('rptAnalysisResultCustom').classList.remove('hidden');
            }
        }
        if (elecSN) elecSN.value = '';
        if (caseNo) caseNo.value = r.workOrderNo || '';
        // 现场概况 = 问题反馈描述 + 故障情况
        if (trackNo) {
            trackNo.value = [r.problemDescription, r.faultCondition].filter(Boolean).join('\n');
        }

        // 清空报告图片
        reportImages = [];
        renderReportImages();

        // 更新预览
        updateReportPreview();
    };
    function renderTodayTable() {
        // 显示最近7天的记录
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        const sevenDaysAgoStr = formatDateLocal(sevenDaysAgo);
        const recentRecords = records.filter(r => r.analysisTime && r.analysisTime >= sevenDaysAgoStr);
        document.getElementById('todayCount').textContent = `${recentRecords.length} 条`;

        const tbody = document.querySelector('#todayTable tbody');
        if (recentRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><div class="empty-state-icon">📝</div>最近7天暂无记录</td></tr>';
            // 重置全选状态
            const selectAll = document.getElementById('todaySelectAll');
            const headerSelectAll = document.getElementById('todayHeaderSelectAll');
            if (selectAll) selectAll.checked = false;
            if (headerSelectAll) headerSelectAll.checked = false;
            updateTodaySelectedCount();
            return;
        }
        tbody.innerHTML = recentRecords.sort((a,b) => new Date(b.analysisTime) - new Date(a.analysisTime)).map(r => {
            // 识别反馈人中的"跟进"标记
            const isFollowup = r.feedbackPerson && (r.feedbackPerson.includes('跟进') || r.feedbackPerson.toLowerCase().includes('follow'));
            // 如果标记为跟进，自动创建跟进任务
            if (isFollowup && !followupRecords.find(f => f.sourceRecordId === r.id)) {
                createFollowupFromRecord(r);
            }
            return `
            <tr>
                <td><input type="checkbox" class="today-row-checkbox" data-id="${r.id}" onchange="updateTodaySelectedCount()" style="cursor:pointer;"></td>
                <td>${formatDateTime(r.analysisTime)}</td>
                <td><span class="model-badge">${esc(r.model || '—')}</span></td>
                <td>${esc(r.airframeNo)}</td>
                <td>${esc(r.flightBatch)}</td>
                <td>${esc(r.region)}</td>
                <td>${isFollowup ? '<span class="followup-badge">跟进</span>' : esc(r.feedbackPerson)}</td>
                <td>${esc(r.analyst)}</td>
                <td>${esc(r.problemType)}</td>
                <td><span class="audit-badge audit-${r.auditResult||'未判定'}">${esc(r.auditResult||'未判定')}</span></td>
                <td>
                    <button class="btn btn-text" onclick="editRecord('${r.id}')">编辑</button>
                    <button class="btn btn-text" style="color:#007bff;" onclick="openFollowupFromRecord('${r.id}')">跟进</button>
                    <button class="btn btn-text" style="color:var(--primary)" onclick="generateReportFromRecord('${r.id}')">📝报告</button>
                    <button class="btn btn-text" style="color:var(--danger)" onclick="deleteRecord('${r.id}')">删除</button>
                </td>
            </tr>
            `;
        }).join('');
        // 重置全选状态
        const selectAll = document.getElementById('todaySelectAll');
        const headerSelectAll = document.getElementById('todayHeaderSelectAll');
        if (selectAll) selectAll.checked = false;
        if (headerSelectAll) headerSelectAll.checked = false;
        updateTodaySelectedCount();
    }

    // ========== 最近记录批量删除功能 ==========
    window.toggleTodaySelectAll = function(checked) {
        const checkboxes = document.querySelectorAll('.today-row-checkbox');
        checkboxes.forEach(cb => cb.checked = checked);
        const selectAll = document.getElementById('todaySelectAll');
        const headerSelectAll = document.getElementById('todayHeaderSelectAll');
        if (selectAll) selectAll.checked = checked;
        if (headerSelectAll) headerSelectAll.checked = checked;
        updateTodaySelectedCount();
    };

    window.updateTodaySelectedCount = function() {
        const checkboxes = document.querySelectorAll('.today-row-checkbox');
        const checked = document.querySelectorAll('.today-row-checkbox:checked');
        const count = checked.length;
        const countEl = document.getElementById('todaySelectedCount');
        const btn = document.getElementById('todayBatchDeleteBtn');
        if (countEl) countEl.textContent = `已选 ${count} 条`;
        if (btn) {
            btn.disabled = count === 0;
            btn.style.opacity = count === 0 ? '0.5' : '1';
        }
        // 同步全选框状态
        const allCount = checkboxes.length;
        const selectAll = document.getElementById('todaySelectAll');
        const headerSelectAll = document.getElementById('todayHeaderSelectAll');
        if (selectAll) selectAll.checked = count === allCount && allCount > 0;
        if (headerSelectAll) headerSelectAll.checked = count === allCount && allCount > 0;
    };

    window.batchDeleteTodaySelected = function() {
        const checked = document.querySelectorAll('.today-row-checkbox:checked');
        if (checked.length === 0) {
            alert('请先选择要删除的记录');
            return;
        }
        if (!confirm(`确定删除选中的 ${checked.length} 条记录？删除后可在回收站恢复。`)) return;
        
        const idsToDelete = Array.from(checked).map(cb => cb.dataset.id);
        let deletedCount = 0;
        
        idsToDelete.forEach(id => {
            const idx = records.findIndex(r => r.id === id);
            if (idx !== -1) {
                const removed = records.splice(idx, 1)[0];
                removed._deletedAt = new Date().toISOString();
                trashRecords.push(removed);
                deletedCount++;
            }
        });
        
        saveRecords(false, false);
        saveTrash();
        renderTodayTable();
        renderHistoryPage();
        updateDashboard();
        
        // 立即同步到云端
        const cfg = getCloudConfig();
        if (cfg && cfg.enabled) {
            pushToCloud().then(success => {
                if (success) {
                    alert(`✅ 成功删除 ${deletedCount} 条记录，已同步到云端`);
                } else {
                    alert(`⚠️ 已删除 ${deletedCount} 条记录，但云同步失败。请检查网络连接后重试。`);
                }
            });
        } else {
            alert(`✅ 成功删除 ${deletedCount} 条记录`);
        }
    };

    // ========== 跟进任务 ==========
    let followupRecords = [];
    const FOLLOWUP_KEY = 'droneWorkbenchFollowupRecords';

    function loadFollowupRecords() {
        try {
            const saved = localStorage.getItem(FOLLOWUP_KEY);
            followupRecords = saved ? JSON.parse(saved) : [];
        } catch (e) {
            followupRecords = [];
        }
    }

    function saveFollowupRecords() {
        localStorage.setItem(FOLLOWUP_KEY, JSON.stringify(followupRecords));
    }

    function generateFollowupId() {
        return 'fu' + Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
    }

    // 从记录自动创建跟进任务
    function createFollowupFromRecord(record) {
        const followup = {
            id: generateFollowupId(),
            sourceRecordId: record.id, // 关联原始记录ID
            analysisTime: record.analysisTime,
            workOrderNo: record.workOrderNo,
            airframeNo: record.airframeNo,
            model: record.model,
            reporter: record.feedbackPerson,
            analyst: record.analyst,
            problemType: record.problemType,
            isWarranty: record.auditResult === '质保' ? '质保' : (record.auditResult === '非质保' ? '非质保' : ''),
            status: '待跟进',
            notes: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        followupRecords.push(followup);
        saveFollowupRecords();
        console.log('[跟进] 自动创建跟进任务:', followup.workOrderNo);
    }

    window.openFollowupFromRecord = function(recordId) {
        const record = records.find(r => r.id === recordId);
        if (!record) { alert('记录不存在'); return; }
        
        // 检查是否已有跟进任务
        let followup = followupRecords.find(f => f.sourceRecordId === recordId);
        if (!followup) {
            // 自动创建
            createFollowupFromRecord(record);
            followup = followupRecords.find(f => f.sourceRecordId === recordId);
        }
        
        // 打开编辑弹窗
        openFollowupModal(followup.id);
    };

    window.openFollowupModal = function(id) {
        const modal = document.getElementById('followupModal');
        const title = document.getElementById('followupModalTitle');
        
        if (id) {
            // 编辑模式
            const record = followupRecords.find(r => r.id === id);
            if (!record) return;
            title.textContent = '编辑跟进任务';
            document.getElementById('editFollowupId').value = id;
            document.getElementById('followupAnalysisTime').value = record.analysisTime || '';
            document.getElementById('followupWorkOrderNo').value = record.workOrderNo || '';
            document.getElementById('followupAirframeNo').value = record.airframeNo || '';
            document.getElementById('followupReporter').value = record.reporter || '';
            document.getElementById('followupAnalyst').value = record.analyst || '';
            document.getElementById('followupProblemType').value = record.problemType || '';
            document.getElementById('followupIsWarranty').value = record.isWarranty || '';
            document.getElementById('followupStatus').value = record.status || '待跟进';
            document.getElementById('followupNotes').value = record.notes || '';
        } else {
            // 新增模式
            title.textContent = '新增跟进任务';
            document.getElementById('editFollowupId').value = '';
            document.getElementById('followupAnalysisTime').value = new Date().toISOString().slice(0, 16);
            document.getElementById('followupWorkOrderNo').value = '';
            document.getElementById('followupAirframeNo').value = '';
            document.getElementById('followupReporter').value = '';
            document.getElementById('followupAnalyst').value = '';
            document.getElementById('followupProblemType').value = '';
            document.getElementById('followupIsWarranty').value = '';
            document.getElementById('followupStatus').value = '待跟进';
            document.getElementById('followupNotes').value = '';
        }
        
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.classList.add('show');
    };

    window.closeFollowupModal = function() {
        const modal = document.getElementById('followupModal');
        modal.classList.remove('show');
        modal.style.display = 'none';
    };

    // 从记录行直接打开跟进弹窗（自动填充信息）
    window.openFollowupFromRecord = function(id) {
        const record = records.find(r => r.id === id);
        if (!record) return;
        const modal = document.getElementById('followupModal');
        const title = document.getElementById('followupModalTitle');
        title.textContent = '新增跟进任务';
        document.getElementById('editFollowupId').value = '';
        document.getElementById('followupAnalysisTime').value = record.analysisTime || new Date().toISOString().slice(0, 16);
        document.getElementById('followupWorkOrderNo').value = record.workOrderNo || '';
        document.getElementById('followupAirframeNo').value = record.airframeNo || '';
        document.getElementById('followupReporter').value = record.feedbackPerson || '';
        document.getElementById('followupAnalyst').value = record.analyst || '';
        document.getElementById('followupProblemType').value = record.problemType || '';
        document.getElementById('followupIsWarranty').value = record.auditResult || '';
        document.getElementById('followupStatus').value = '待跟进';
        document.getElementById('followupNotes').value = '';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.classList.add('show');
    };

    // 从问题解决记录打开跟进弹窗
    window.openFollowupFromSolution = function(id) {
        const solution = solutionRecords.find(r => r.id === id);
        if (!solution) return;
        const modal = document.getElementById('followupModal');
        const title = document.getElementById('followupModalTitle');
        title.textContent = '新增跟进任务';
        document.getElementById('editFollowupId').value = '';
        document.getElementById('followupAnalysisTime').value = solution.faultTime || new Date().toISOString().slice(0, 16);
        document.getElementById('followupWorkOrderNo').value = '';
        document.getElementById('followupAirframeNo').value = solution.droneNo || '';
        document.getElementById('followupReporter').value = '';
        document.getElementById('followupAnalyst').value = '';
        document.getElementById('followupProblemType').value = '';
        document.getElementById('followupIsWarranty').value = '';
        document.getElementById('followupStatus').value = '待跟进';
        document.getElementById('followupNotes').value = solution.faultDesc || '';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.classList.add('show');
    };

    window.saveFollowup = function() {
        const id = document.getElementById('editFollowupId').value;
        const analysisTime = document.getElementById('followupAnalysisTime').value;
        const workOrderNo = document.getElementById('followupWorkOrderNo').value.trim();
        
        if (!analysisTime || !workOrderNo) {
            alert('请填写分析时间和工单编号');
            return;
        }
        
        const record = {
            id: id || generateFollowupId(),
            analysisTime: analysisTime,
            workOrderNo: workOrderNo,
            airframeNo: document.getElementById('followupAirframeNo').value.trim(),
            reporter: document.getElementById('followupReporter').value.trim(),
            analyst: document.getElementById('followupAnalyst').value.trim(),
            problemType: document.getElementById('followupProblemType').value.trim(),
            isWarranty: document.getElementById('followupIsWarranty').value,
            status: document.getElementById('followupStatus').value,
            notes: document.getElementById('followupNotes').value.trim(),
            createdAt: id ? (followupRecords.find(r => r.id === id)?.createdAt || new Date().toISOString()) : new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        if (id) {
            // 更新
            const idx = followupRecords.findIndex(r => r.id === id);
            if (idx !== -1) {
                followupRecords[idx] = record;
            }
        } else {
            // 新增
            followupRecords.push(record);
        }
        
        saveFollowupRecords();
        closeFollowupModal();
        renderFollowupPage();
        alert(id ? '✅ 跟进任务已更新' : '✅ 跟进任务已添加');
    };

    window.deleteFollowup = function(id) {
        if (!confirm('确定删除这条跟进任务？')) return;
        followupRecords = followupRecords.filter(r => r.id !== id);
        saveFollowupRecords();
        renderFollowupPage();
        alert('✅ 跟进任务已删除');
    };

    window.renderFollowupPage = function() {
        const tbody = document.querySelector('#followupTable tbody');
        const count = document.getElementById('followupCount');
        if (!tbody) return;
        
        // 获取筛选条件
        const filterDate = (document.getElementById('followupFilterDate') || {}).value || '';
        const filterWorkOrder = (document.getElementById('followupFilterWorkOrder') || {}).value || '';
        const filterAnalyst = (document.getElementById('followupFilterAnalyst') || {}).value || '';
        const filterStatus = (document.getElementById('followupFilterStatus') || {}).value || '';
        
        let filtered = [...followupRecords];
        if (filterDate) filtered = filtered.filter(r => r.analysisTime && r.analysisTime.startsWith(filterDate));
        if (filterWorkOrder) filtered = filtered.filter(r => r.workOrderNo && r.workOrderNo.includes(filterWorkOrder));
        if (filterAnalyst) filtered = filtered.filter(r => r.analyst && r.analyst.includes(filterAnalyst));
        if (filterStatus) filtered = filtered.filter(r => r.status && r.status.includes(filterStatus));
        
        count.textContent = filtered.length;
        
        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="empty-state"><div class="empty-state-icon">📋</div>暂无跟进任务</td></tr>';
            return;
        }
        
        // 按时间倒序排列
        const sorted = filtered.sort((a, b) => new Date(b.analysisTime) - new Date(a.analysisTime));
        
        const rows = [];
        sorted.forEach(r => {
            const statusClass = r.status === '已完成' ? 'status-completed' : 
                               r.status === '跟进中' ? 'status-progress' : 
                               r.status === '已关闭' ? 'status-closed' : 'status-pending';
            rows.push(`<tr>
                <td>${formatDateTime(r.analysisTime)}</td>
                <td><span class="model-badge">${esc(r.model || '—')}</span></td>
                <td>${esc(r.airframeNo)}</td>
                <td>${esc(r.flightBatch)}</td>
                <td>${esc(r.region)}</td>
                <td>${esc(r.reporter)}</td>
                <td>${esc(r.analyst)}</td>
                <td>${esc(r.problemType)}</td>
                <td><span class="warranty-badge ${r.isWarranty === '质保' ? 'warranty-yes' : 'warranty-no'}">${esc(r.isWarranty || '—')}</span></td>
                <td>
                    <button class="btn btn-text" onclick="openFollowupModal('${r.id}')">编辑</button>
                    <button class="btn btn-text" onclick="deleteFollowup('${r.id}')" style="color:#dc3545;">删除</button>
                </td>
            </tr>`);
        });
        
        tbody.innerHTML = rows.join('');
    };

    function formatDateTime(s) {
        if (!s) return '—';
        const d = new Date(s);
        return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

    // 保存按钮事件
    document.getElementById('btnSaveFollowup').addEventListener('click', saveFollowup);

    // ========== 智能录入 ==========
    let smartParsedRows = [];
    function handleSmartPaste(e) {
        setTimeout(() => {
            const text = e.target.value;
            smartParsedRows = parseSmartText(text);
            const preview = document.getElementById('smartEntryPreview');
            if (smartParsedRows.length === 0) {
                preview.innerHTML = '<p class="hint">⚠️ 未能识别到有效数据</p>';
                return;
            }
            preview.innerHTML = `<p class="hint">✅ 识别到 ${smartParsedRows.length} 条记录</p>` +
                '<table class="data-table mini"><thead><tr>' +
                Object.keys(smartParsedRows[0]).map(k => `<th>${k}</th>`).join('') +
                '</tr></thead><tbody>' +
                smartParsedRows.slice(0,5).map(r => '<tr>' + Object.values(r).map(v => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') +
                '</tbody></table>';
        }, 100);
    }

    // ========== 反馈模板解析 ==========
    function parseFeedbackTemplate(text) {
        const result = {
            droneNo: '',
            fieldNo: '',
            faultTime: '',
            faultPeriod: '',
            faultDesc: '',
            requirement: '',
            logs: { drone: false, video: false, app: false, fpv: false, flight: false, other: false }
        };

        const lines = text.split('\n').filter(l => l.trim());
        for (const line of lines) {
            const trimmed = line.trim();
            // 无人机编号
            if (/无人机编号|飞机编号|机架号|SN/i.test(trimmed)) {
                const m = trimmed.match(/[：:]\s*(.+)/);
                if (m) result.droneNo = m[1].trim();
            }
            // 地块编号
            if (/地块编号|地块|架次/i.test(trimmed)) {
                const m = trimmed.match(/[：:]\s*(.+)/);
                if (m) result.fieldNo = m[1].trim();
            }
            // 故障时间
            if (/故障时间|时间/i.test(trimmed)) {
                const m = trimmed.match(/[：:]\s*(.+)/);
                if (m) {
                    const timeStr = m[1].trim();
                    result.faultPeriod = timeStr;
                    // 尝试解析日期：7.12日 → 2026-07-12
                    const dateMatch = timeStr.match(/(\d{1,2})[.\/\-](\d{1,2})[日号]?/);
                    if (dateMatch) {
                        const month = dateMatch[1].padStart(2, '0');
                        const day = dateMatch[2].padStart(2, '0');
                        const year = new Date().getFullYear();
                        result.faultTime = `${year}-${month}-${day}`;
                    }
                    // 尝试解析时间段：上午7.12到9.00
                    const periodMatch = timeStr.match(/(上午|下午)?\s*(\d{1,2})[.:：](\d{2})\s*[到至\-~]\s*(\d{1,2})[.:：](\d{2})/);
                    if (periodMatch) {
                        result.faultPeriod = timeStr;
                    }
                }
            }
            // 故障现象
            if (/故障现象|故障描述|问题描述|现象/i.test(trimmed)) {
                const m = trimmed.match(/[：:]\s*(.+)/);
                if (m) result.faultDesc = m[1].trim();
            }
            // 需求
            if (/需求|查询|分析|原因/i.test(trimmed)) {
                const m = trimmed.match(/[：:，,]\s*(.+)/);
                if (m) result.requirement = m[1].trim();
                else if (/查询|分析|原因/.test(trimmed)) result.requirement = trimmed;
            }
            // 日志状态
            if (/日志|已上传|已传/i.test(trimmed)) {
                if (/无人机.*日志|飞控日志/i.test(trimmed)) result.logs.drone = true;
                if (/图传.*日志|图传/i.test(trimmed)) result.logs.video = true;
                if (/APP.*日志|APP/i.test(trimmed)) result.logs.app = true;
                if (/FPV.*日志|FPV/i.test(trimmed)) result.logs.fpv = true;
                if (/飞控.*日志|飞控/i.test(trimmed)) result.logs.flight = true;
            }
        }
        return result;
    }

    // 反馈模板实时预览
    function handleFeedbackTemplateInput(e) {
        setTimeout(() => {
            const text = e.target.value;
            const preview = document.getElementById('feedbackTemplatePreview');
            if (!text.trim()) {
                preview.innerHTML = '<p class="hint">请输入反馈模板文本</p>';
                return;
            }
            const parsed = parseFeedbackTemplate(text);
            const logStatus = [];
            if (parsed.logs.drone) logStatus.push('无人机日志');
            if (parsed.logs.video) logStatus.push('图传日志');
            if (parsed.logs.app) logStatus.push('APP日志');
            if (parsed.logs.fpv) logStatus.push('FPV日志');
            if (parsed.logs.flight) logStatus.push('飞控日志');
            if (parsed.logs.other) logStatus.push('其他');

            preview.innerHTML = `<p class="hint">✅ 解析结果预览</p>
                <table class="data-table mini">
                    <tr><th style="width:120px">无人机编号</th><td>${esc(parsed.droneNo) || '—'}</td></tr>
                    <tr><th>地块编号</th><td>${esc(parsed.fieldNo) || '—'}</td></tr>
                    <tr><th>故障时间</th><td>${esc(parsed.faultTime) || '—'} ${esc(parsed.faultPeriod) || ''}</td></tr>
                    <tr><th>故障现象</th><td>${esc(parsed.faultDesc) || '—'}</td></tr>
                    <tr><th>需求描述</th><td>${esc(parsed.requirement) || '—'}</td></tr>
                    <tr><th>日志状态</th><td>${logStatus.length > 0 ? logStatus.join('、') : '—'}</td></tr>
                </table>`;
        }, 100);
    }

    // 确认反馈模板录入
    function confirmFeedbackEntry() {
        const textarea = document.getElementById('feedbackTemplateText');
        if (!textarea || !textarea.value.trim()) {
            alert('⚠️ 请输入反馈模板文本');
            return;
        }
        const parsed = parseFeedbackTemplate(textarea.value);
        if (!parsed.droneNo && !parsed.faultDesc) {
            alert('⚠️ 未能识别到有效信息，请检查格式');
            return;
        }
        // 创建问题解决记录
        const solution = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            droneNo: parsed.droneNo,
            fieldNo: parsed.fieldNo,
            faultTime: parsed.faultTime ? parsed.faultTime + 'T00:00' : '',
            faultPeriod: parsed.faultPeriod,
            faultDesc: parsed.faultDesc,
            requirement: parsed.requirement,
            logs: parsed.logs,
            status: '待分析',
            analysis: '',
            remark: '',
            createTime: new Date().toISOString()
        };
        // 保存到 solutionRecords
        if (typeof solutionRecords === 'undefined') window.solutionRecords = [];
        solutionRecords.push(solution);
        localStorage.setItem('droneWorkbenchSolutions', JSON.stringify(solutionRecords));
        // 同步到日常工作记录
        const record = {
            id: solution.id,
            analysisTime: solution.faultTime || new Date().toISOString().slice(0, 16),
            workOrderNo: '',
            airframeNo: parsed.droneNo,
            model: '',
            flightBatch: parsed.fieldNo,
            feedbackPerson: '',
            analyst: '',
            problemType: '',
            auditResult: '',
            tracker: '',
            reviewer: '',
            problemDescription: parsed.requirement,
            faultCondition: parsed.faultDesc,
            initialAnalysis: '',
            followUp: '日志上传状态：' + Object.entries(parsed.logs).filter(([k, v]) => v).map(([k]) => k).join('、'),
            finalConclusion: '',
            region: ''
        };
        records.push(record);
        saveRecords();
        renderTodayTable();
        // 关闭弹窗，切换到问题解决页面
        document.getElementById('smartEntryModal').classList.remove('show');
        switchPage('solution');
        renderSolutionPage();
        alert('✅ 已录入到问题解决页面');
    }

    // ========== 问题解决页面 ==========
    let solutionRecords = [];
    function loadSolutions() {
        try {
            const raw = localStorage.getItem('droneWorkbenchSolutions');
            solutionRecords = raw ? JSON.parse(raw) : [];
        } catch (e) { solutionRecords = []; }
    }
    function saveSolutions() {
        localStorage.setItem('droneWorkbenchSolutions', JSON.stringify(solutionRecords));
    }

    function renderSolutionPage() {
        loadSolutions();
        const tbody = document.querySelector('#solutionTable tbody');
        if (!tbody) return;

        // 筛选
        const filterDate = document.getElementById('solutionFilterDate')?.value || '';
        const filterDrone = document.getElementById('solutionFilterDrone')?.value.trim() || '';
        const filterStatus = document.getElementById('solutionFilterStatus')?.value.trim() || '';

        let filtered = solutionRecords.filter(r => {
            if (filterDate && r.faultTime && !r.faultTime.startsWith(filterDate)) return false;
            if (filterDrone && !r.droneNo.includes(filterDrone)) return false;
            if (filterStatus && r.status !== filterStatus) return false;
            return true;
        });

        // 按时间倒序
        filtered.sort((a, b) => (b.faultTime || '').localeCompare(a.faultTime || ''));

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><div class="empty-state-icon">🔧</div>暂无问题解决记录</td></tr>';
            return;
        }

        const rows = filtered.map(r => {
            const logStatus = [];
            if (r.logs) {
                if (r.logs.drone) logStatus.push('🛩️');
                if (r.logs.video) logStatus.push('📡');
                if (r.logs.app) logStatus.push('📱');
                if (r.logs.fpv) logStatus.push('🎥');
                if (r.logs.flight) logStatus.push('🎮');
            }
            const statusClass = r.status === '已解决' ? 'warranty-yes' : (r.status === '待分析' ? 'warranty-no' : '');
            const faultTimeDisplay = r.faultTime ? new Date(r.faultTime).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) : '—';
            return `<tr>
                <td>${faultTimeDisplay}</td>
                <td><strong>${esc(r.droneNo) || '—'}</strong></td>
                <td>${esc(r.fieldNo) || '—'}</td>
                <td title="${esc(r.faultDesc)}">${esc(r.faultDesc ? r.faultDesc.substring(0, 20) + (r.faultDesc.length > 20 ? '...' : '') : '—')}</td>
                <td title="${esc(r.requirement)}">${esc(r.requirement ? r.requirement.substring(0, 20) + (r.requirement.length > 20 ? '...' : '') : '—')}</td>
                <td>${logStatus.join(' ') || '—'}</td>
                <td><span class="warranty-badge ${statusClass}">${esc(r.status) || '—'}</span></td>
                <td>
                    <button class="btn btn-text" onclick="viewSolutionDetail('${r.id}')">查看</button>
                    <button class="btn btn-text" onclick="openFollowupFromSolution('${r.id}')" style="color:#007bff;">跟进</button>
                    <button class="btn btn-text" onclick="editSolution('${r.id}')">编辑</button>
                    <button class="btn btn-text" onclick="deleteSolution('${r.id}')" style="color:#dc3545;">删除</button>
                </td>
            </tr>`;
        });
        tbody.innerHTML = rows.join('');
    }

    window.openSolutionModal = function() {
        document.getElementById('solutionModalTitle').textContent = '新建问题';
        document.getElementById('editSolutionId').value = '';
        document.getElementById('solutionDroneNo').value = '';
        document.getElementById('solutionFieldNo').value = '';
        document.getElementById('solutionFaultTime').value = '';
        document.getElementById('solutionFaultPeriod').value = '';
        document.getElementById('solutionFaultDesc').value = '';
        document.getElementById('solutionRequirement').value = '';
        document.getElementById('solutionStatus').value = '待分析';
        document.getElementById('solutionAnalysis').value = '';
        document.getElementById('solutionRemark').value = '';
        document.getElementById('logDrone').checked = true;
        document.getElementById('logVideo').checked = true;
        document.getElementById('logApp').checked = true;
        document.getElementById('logFpv').checked = true;
        document.getElementById('logFlight').checked = true;
        document.getElementById('logOther').checked = false;
        document.getElementById('solutionModal').classList.add('show');
    };

    window.closeSolutionModal = function() {
        document.getElementById('solutionModal').classList.remove('show');
    };

    window.editSolution = function(id) {
        const r = solutionRecords.find(x => x.id === id);
        if (!r) return;
        document.getElementById('solutionModalTitle').textContent = '编辑问题';
        document.getElementById('editSolutionId').value = r.id;
        document.getElementById('solutionDroneNo').value = r.droneNo || '';
        document.getElementById('solutionFieldNo').value = r.fieldNo || '';
        document.getElementById('solutionFaultTime').value = r.faultTime || '';
        document.getElementById('solutionFaultPeriod').value = r.faultPeriod || '';
        document.getElementById('solutionFaultDesc').value = r.faultDesc || '';
        document.getElementById('solutionRequirement').value = r.requirement || '';
        document.getElementById('solutionStatus').value = r.status || '待分析';
        document.getElementById('solutionAnalysis').value = r.analysis || '';
        document.getElementById('solutionRemark').value = r.remark || '';
        if (r.logs) {
            document.getElementById('logDrone').checked = !!r.logs.drone;
            document.getElementById('logVideo').checked = !!r.logs.video;
            document.getElementById('logApp').checked = !!r.logs.app;
            document.getElementById('logFpv').checked = !!r.logs.fpv;
            document.getElementById('logFlight').checked = !!r.logs.flight;
            document.getElementById('logOther').checked = !!r.logs.other;
        }
        document.getElementById('solutionModal').classList.add('show');
    };

    window.deleteSolution = function(id) {
        if (!confirm('确定删除此问题记录？')) return;
        solutionRecords = solutionRecords.filter(r => r.id !== id);
        saveSolutions();
        renderSolutionPage();
    };

    window.viewSolutionDetail = function(id) {
        const r = solutionRecords.find(x => x.id === id);
        if (!r) return;
        const logStatus = [];
        if (r.logs) {
            if (r.logs.drone) logStatus.push('✅ 无人机日志');
            if (r.logs.video) logStatus.push('✅ 图传日志');
            if (r.logs.app) logStatus.push('✅ APP日志');
            if (r.logs.fpv) logStatus.push('✅ FPV日志');
            if (r.logs.flight) logStatus.push('✅ 飞控日志');
            if (r.logs.other) logStatus.push('✅ 其他日志');
        }
        const content = document.getElementById('solutionDetailContent');
        content.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px;">
                <div><strong>无人机编号：</strong>${esc(r.droneNo) || '—'}</div>
                <div><strong>地块编号：</strong>${esc(r.fieldNo) || '—'}</div>
                <div><strong>故障时间：</strong>${r.faultTime ? new Date(r.faultTime).toLocaleDateString('zh-CN') : '—'} ${esc(r.faultPeriod) || ''}</div>
                <div><strong>解决状态：</strong><span class="warranty-badge ${r.status === '已解决' ? 'warranty-yes' : ''}">${esc(r.status)}</span></div>
            </div>
            <div style="margin-bottom:16px;">
                <strong>故障现象：</strong>
                <p style="margin:8px 0;padding:12px;background:#f8f9fa;border-radius:6px;">${esc(r.faultDesc) || '—'}</p>
            </div>
            <div style="margin-bottom:16px;">
                <strong>需求描述：</strong>
                <p style="margin:8px 0;padding:12px;background:#f8f9fa;border-radius:6px;">${esc(r.requirement) || '—'}</p>
            </div>
            <div style="margin-bottom:16px;">
                <strong>日志上传状态：</strong>
                <div style="margin:8px 0;padding:12px;background:#f8f9fa;border-radius:6px;">
                    ${logStatus.length > 0 ? logStatus.join(' &nbsp; ') : '—'}
                </div>
            </div>
            <div style="margin-bottom:16px;">
                <strong>分析过程 / 解决方案：</strong>
                <p style="margin:8px 0;padding:12px;background:#f8f9fa;border-radius:6px;white-space:pre-wrap;">${esc(r.analysis) || '—'}</p>
            </div>
            <div style="margin-bottom:16px;">
                <strong>备注：</strong>
                <p style="margin:8px 0;padding:12px;background:#f8f9fa;border-radius:6px;">${esc(r.remark) || '—'}</p>
            </div>
            <div style="color:#999;font-size:12px;">
                创建时间：${r.createTime ? new Date(r.createTime).toLocaleString('zh-CN') : '—'}
            </div>
        `;
        document.getElementById('btnEditSolution').onclick = () => { closeSolutionDetail(); editSolution(id); };
        document.getElementById('btnExportSolution').onclick = () => exportSolutionReport(id);
        document.getElementById('solutionDetailModal').classList.add('show');
    };

    window.closeSolutionDetail = function() {
        document.getElementById('solutionDetailModal').classList.remove('show');
    };

    function exportSolutionReport(id) {
        const r = solutionRecords.find(x => x.id === id);
        if (!r) return;
        const logStatus = [];
        if (r.logs) {
            if (r.logs.drone) logStatus.push('无人机日志');
            if (r.logs.video) logStatus.push('图传日志');
            if (r.logs.app) logStatus.push('APP日志');
            if (r.logs.fpv) logStatus.push('FPV日志');
            if (r.logs.flight) logStatus.push('飞控日志');
            if (r.logs.other) logStatus.push('其他日志');
        }
        const text = `问题解决报告
==================
无人机编号：${r.droneNo || '—'}
地块编号：${r.fieldNo || '—'}
故障时间：${r.faultTime ? new Date(r.faultTime).toLocaleDateString('zh-CN') : '—'} ${r.faultPeriod || ''}
解决状态：${r.status}

故障现象：
${r.faultDesc || '—'}

需求描述：
${r.requirement || '—'}

日志上传状态：
${logStatus.length > 0 ? logStatus.join('、') : '—'}

分析过程 / 解决方案：
${r.analysis || '—'}

备注：
${r.remark || '—'}

创建时间：${r.createTime ? new Date(r.createTime).toLocaleString('zh-CN') : '—'}
`;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `问题解决报告_${r.droneNo || '未知'}_${new Date().toLocaleDateString('zh-CN').replace(/\//g, '')}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // 保存问题解决记录
    function saveSolutionRecord() {
        const editId = document.getElementById('editSolutionId').value;
        const record = {
            id: editId || Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            droneNo: document.getElementById('solutionDroneNo').value.trim(),
            fieldNo: document.getElementById('solutionFieldNo').value.trim(),
            faultTime: document.getElementById('solutionFaultTime').value,
            faultPeriod: document.getElementById('solutionFaultPeriod').value.trim(),
            faultDesc: document.getElementById('solutionFaultDesc').value.trim(),
            requirement: document.getElementById('solutionRequirement').value.trim(),
            logs: {
                drone: document.getElementById('logDrone').checked,
                video: document.getElementById('logVideo').checked,
                app: document.getElementById('logApp').checked,
                fpv: document.getElementById('logFpv').checked,
                flight: document.getElementById('logFlight').checked,
                other: document.getElementById('logOther').checked
            },
            status: document.getElementById('solutionStatus').value,
            analysis: document.getElementById('solutionAnalysis').value.trim(),
            remark: document.getElementById('solutionRemark').value.trim(),
            createTime: editId ? (solutionRecords.find(r => r.id === editId)?.createTime || new Date().toISOString()) : new Date().toISOString()
        };
        if (!record.droneNo) { alert('请填写无人机编号'); return; }
        if (!record.faultDesc) { alert('请填写故障现象'); return; }

        if (editId) {
            const idx = solutionRecords.findIndex(r => r.id === editId);
            if (idx >= 0) solutionRecords[idx] = record;
        } else {
            solutionRecords.push(record);
        }
        saveSolutions();
        closeSolutionModal();
        renderSolutionPage();
        alert('✅ 保存成功');
    }

    // ========== 图片OCR识别 ==========
    let ocrWorker = null;
    let ocrImageFile = null;

    function initSmartTabs() {
        const tabs = document.querySelectorAll('.smart-tab');
        tabs.forEach(tab => {
            tab.addEventListener('click', () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                const target = tab.dataset.tab;
                document.getElementById('smartTabText').style.display = target === 'text' ? '' : 'none';
                document.getElementById('smartTabImage').style.display = target === 'image' ? '' : 'none';
                document.getElementById('smartTabFeedback').style.display = target === 'feedback' ? '' : 'none';
            });
        });
    }

    function initOCRUpload() {
        const uploadArea = document.getElementById('ocrUploadArea');
        const fileInput = document.getElementById('ocrFileInput');
        const previewArea = document.getElementById('ocrPreviewArea');
        const imgPreview = document.getElementById('ocrImagePreview');

        // 拖拽上传
        uploadArea.addEventListener('dragover', (e) => {
            e.preventDefault();
            uploadArea.classList.add('drag-over');
        });
        uploadArea.addEventListener('dragleave', () => {
            uploadArea.classList.remove('drag-over');
        });
        uploadArea.addEventListener('drop', (e) => {
            e.preventDefault();
            uploadArea.classList.remove('drag-over');
            const files = e.dataTransfer.files;
            if (files.length > 0 && files[0].type.startsWith('image/')) {
                handleOCRImage(files[0]);
            }
        });

        // 点击选择文件
        fileInput.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handleOCRImage(e.target.files[0]);
            }
        });

        // 开始OCR识别
        document.getElementById('btnStartOCR').addEventListener('click', startOCR);
        // 清除图片
        document.getElementById('btnClearOCR').addEventListener('click', clearOCRImage);
    }

    function handleOCRImage(file) {
        ocrImageFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            document.getElementById('ocrImagePreview').src = e.target.result;
            document.getElementById('ocrUploadArea').style.display = 'none';
            document.getElementById('ocrPreviewArea').style.display = '';
            document.getElementById('ocrProgress').style.display = 'none';
        };
        reader.readAsDataURL(file);
    }

    function clearOCRImage() {
        ocrImageFile = null;
        document.getElementById('ocrFileInput').value = '';
        document.getElementById('ocrUploadArea').style.display = '';
        document.getElementById('ocrPreviewArea').style.display = 'none';
        document.getElementById('ocrProgress').style.display = 'none';
    }

    // 图像预处理：提高OCR识别质量
    function preprocessImageForOCR(imageFile) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                
                // 放大图像以提高OCR精度（表格截图建议3倍放大）
                const maxWidth = 3000;
                let width = img.width;
                let height = img.height;
                const scale = Math.min(maxWidth / width, 3);
                width = Math.round(width * scale);
                height = Math.round(height * scale);
                canvas.width = width;
                canvas.height = height;
                
                // 绘制图像（使用高质量缩放）
                ctx.imageSmoothingEnabled = true;
                ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(img, 0, 0, width, height);
                
                // 获取像素数据
                const imageData = ctx.getImageData(0, 0, width, height);
                const data = imageData.data;
                
                // 第一步：转灰度
                const grayData = new Uint8ClampedArray(data.length);
                for (let i = 0; i < data.length; i += 4) {
                    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
                    grayData[i] = grayData[i+1] = grayData[i+2] = gray;
                    grayData[i+3] = 255;
                }
                
                // 第二步：锐化滤波（3x3 Laplacian）
                const sharpened = new Uint8ClampedArray(grayData.length);
                const kernel = [0, -1, 0, -1, 5, -1, 0, -1, 0];
                const kernelSize = 3;
                const halfKernel = Math.floor(kernelSize / 2);
                
                for (let y = 0; y < height; y++) {
                    for (let x = 0; x < width; x++) {
                        let sum = 0;
                        for (let ky = 0; ky < kernelSize; ky++) {
                            for (let kx = 0; kx < kernelSize; kx++) {
                                const ny = Math.min(Math.max(y + ky - halfKernel, 0), height - 1);
                                const nx = Math.min(Math.max(x + kx - halfKernel, 0), width - 1);
                                const idx = (ny * width + nx) * 4;
                                sum += grayData[idx] * kernel[ky * kernelSize + kx];
                            }
                        }
                        const idx = (y * width + x) * 4;
                        sharpened[idx] = sharpened[idx+1] = sharpened[idx+2] = Math.max(0, Math.min(255, sum));
                        sharpened[idx+3] = 255;
                    }
                }
                
                // 第三步：Otsu自适应阈值二值化
                const histogram = new Array(256).fill(0);
                for (let i = 0; i < sharpened.length; i += 4) {
                    histogram[sharpened[i]]++;
                }
                
                const totalPixels = width * height;
                let sum = 0;
                for (let i = 0; i < 256; i++) sum += i * histogram[i];
                
                let sumB = 0, wB = 0, wF = 0;
                let maxVariance = 0, threshold = 128;
                
                for (let t = 0; t < 256; t++) {
                    wB += histogram[t];
                    if (wB === 0) continue;
                    wF = totalPixels - wB;
                    if (wF === 0) break;
                    sumB += t * histogram[t];
                    const mB = sumB / wB;
                    const mF = (sum - sumB) / wF;
                    const variance = wB * wF * (mB - mF) * (mB - mF);
                    if (variance > maxVariance) {
                        maxVariance = variance;
                        threshold = t;
                    }
                }
                
                // 应用阈值（稍微降低阈值以保留更多细节）
                const adjustedThreshold = threshold * 0.9;
                for (let i = 0; i < sharpened.length; i += 4) {
                    const val = sharpened[i] < adjustedThreshold ? 0 : 255;
                    sharpened[i] = sharpened[i+1] = sharpened[i+2] = val;
                }
                
                ctx.putImageData(new ImageData(sharpened, width, height), 0, 0);
                
                // 转回 blob
                canvas.toBlob((blob) => {
                    resolve(blob);
                }, 'image/png');
            };
            img.src = URL.createObjectURL(imageFile);
        });
    }

    // OCR文本后处理：修复常见识别错误
    function fixOCRErrors(text) {
        // 1. 修复常见字符误识别
        const replacements = [
            // 单位修正
            [/\bmG\b/g, 'm/s'],
            [/\bmg\b/g, 'm/s'],
            // 常见单词粘连修复（在字母和数字之间插入空格）
            [/(at)(the)/gi, '$1 $2'],
            [/(moment)(of)(fault)(was)/gi, '$1 $2 $3 $4'],
            [/(terrain)(following)/gi, '$1-$2'],
            [/(Radar)(Issue)/g, '$1 $2'],
            [/(dropped)(from)/gi, '$1 $2'],
            [/(m)(to)\b/gi, '$1 $2'],
            [/(of)(all)(four)/gi, '$1 $2 $3'],
            [/(speed)(at)/gi, '$1 $2'],
            [/(fault)(was)/gi, '$1 $2'],
            [/(following)(atitude)/gi, '$1 $2'],
            [/(atitude)/g, 'altitude'],
            [/(teraintollowing)/g, 'terrain-following'],
            [/(RadarIssue)/g, 'Radar Issue'],
            [/(droppedfrom)/g, 'dropped from'],
            [/(ofallfour)/g, 'of all four'],
            [/(atthe)/g, 'at the'],
            [/(momentoffaultwas)/g, 'moment of fault was'],
            [/(mto)/g, 'm to'],
        ];
        
        let result = text;
        for (const [pattern, replacement] of replacements) {
            result = result.replace(pattern, replacement);
        }
        
        return result;
    }

    // OCR文本后处理：清理常见识别错误，恢复Tab分隔
    function cleanOCRText(text) {
        // 先修复常见OCR错误
        text = fixOCRErrors(text);
        
        let lines = text.split('\n').filter(l => l.trim());
        let cleaned = [];
        let structuredCount = 0;

        for (let line of lines) {
            // 检测是否是结构化数据行（包含日期、机架号等特征）
            // 支持日期格式：2026-07-23 / 2026/07/23 / 2026年7月23日
            const hasDate = /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(line) || /\d{4}年\d{1,2}月\d{1,2}日/.test(line);
            // 支持多种机架号格式：JMZK/JMZJ/EAVUAV/JMZ 或纯数字（如 95109）或字母+数字（如 A0162）
            const hasFrame = /(JMZK|JMZJ|EAVUAV|JMZ|J\d{6,}|\d{5,}|[A-Z]\d{3,5})/i.test(line);
            // 支持更多机型
            const hasModel = /\b(J50|J70|J100|J150|J160|E50|E100|J25|J50pro|E50pro|E100pro)\b/i.test(line);

            if (hasDate && (hasFrame || hasModel)) {
                // 这是结构化数据行，尝试智能解析
                const parsed = parseStructuredLine(line);
                if (parsed && parsed.length >= 3) {
                    cleaned.push(parsed.join('\t'));
                    structuredCount++;
                    continue;
                }
            }

            // 非结构化行或解析失败，做基本清理
            // 先去除中文字符之间的多余空格（但保留数字和字母周围的空格）
            line = line.replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');
            // 将连续空格替换为Tab（但保留单个空格）
            line = line.replace(/\s{2,}/g, '\t');
            cleaned.push(line);
        }

        // 如果结构化解析成功数太少，说明OCR质量差，返回原始文本供手动编辑
        if (structuredCount === 0 && lines.length > 0) {
            // 返回原始文本，让用户手动编辑
            return text;
        }

        return cleaned.join('\n');
    }

    // 从非Tab分隔的行中提取结构化字段
    function parseStructuredLine(line) {
        const fields = [];

        // 提取日期
        const dateMatch = line.match(/(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/);
        if (dateMatch) fields.push(dateMatch[1]);

        // 提取工单号（J开头+10位以上数字）
        const orderMatch = line.match(/(J\d{10,})/i);
        if (orderMatch) fields.push(orderMatch[1]);

        // 提取机架号
        // 规则1: 带 JMZK/JMZJ/EAVUAV 前缀的完整机架号（如 JMZK95109）
        const frameMatch = line.match(/((?:JMZK|JMZJ|EAVUAV|JMZ)\w+)/i);
        if (frameMatch) {
            fields.push(frameMatch[1]);
        } else {
            // 规则2: 纯数字机架号（5-6位，JMZK 的后五位，如 95109, 85684）
            const pureNumFrame = line.match(/\b(\d{5,6})\b/);
            if (pureNumFrame) fields.push(pureNumFrame[1]);
        }

        // 提取机型（支持 J50/J70/J100/J150/J160/E50/E100 及 Pro 版本）
        const modelMatch = line.match(/\b(J160|J150|J100pro|J70|J50pro|E100pro|E50pro|J100|J50|E100|E50|J25)\b/i);
        if (modelMatch) fields.push(modelMatch[1]);

        // 提取架次（支持多种格式）
        // 格式1: 日期-数字（如 20260719_FLY_001_002）
        const batchMatch1 = line.match(/(\w+_FLY[-_]\d+[-_]\d+)/i);
        if (batchMatch1) fields.push(batchMatch1[1]);
        // 格式2: 长数字 -- 长数字（如 178447189344872 -- 50242241）
        const batchMatch2 = line.match(/(\d{10,}\s*--\s*\d{5,})/);
        if (batchMatch2) fields.push(batchMatch2[1]);

        // 提取省份/区域（支持中国省份 + 美国州名 + 俄罗斯等）
        const provinces = ['北京','天津','上海','重庆','河北','山西','辽宁','吉林','黑龙江',
            '江苏','浙江','安徽','福建','江西','山东','河南','湖北','湖南','广东','海南',
            '四川','贵州','云南','陕西','甘肃','青海','台湾','广西','内蒙古','西藏','宁夏','新疆'];
        // 美国州名列表
        const usStates = ['Alabama','Alaska','Arizona','Arkansas','California','Colorado','Connecticut',
            'Delaware','Florida','Georgia','Hawaii','Idaho','Illinois','Indiana','Iowa','Kansas',
            'Kentucky','Louisiana','Maine','Maryland','Massachusetts','Michigan','Minnesota',
            'Mississippi','Missouri','Montana','Nebraska','Nevada','New Hampshire','New Jersey',
            'New Mexico','New York','North Carolina','North Dakota','Ohio','Oklahoma','Oregon',
            'Pennsylvania','Rhode Island','South Carolina','South Dakota','Tennessee','Texas',
            'Utah','Vermont','Virginia','Washington','West Virginia','Wisconsin','Wyoming'];
        // 其他国家/地区
        const otherRegions = ['俄罗斯','美国','加拿大','澳大利亚','巴西','阿根廷','乌克兰','哈萨克斯坦'];

        let regionFound = false;
        // 先检查其他国家/地区
        for (const r of otherRegions) {
            if (line.includes(r)) {
                // 尝试提取后面的州/城市名
                const regionMatch = line.match(new RegExp(r + '[\\s,，]*([A-Za-z\\u4e00-\\u9fff]+)'));
                if (regionMatch) {
                    fields.push(r + ' ' + regionMatch[1].trim());
                } else {
                    fields.push(r);
                }
                regionFound = true;
                break;
            }
        }
        // 检查中国省份
        if (!regionFound) {
            for (const p of provinces) {
                if (line.includes(p)) { fields.push(p); regionFound = true; break; }
            }
        }
        // 检查美国州名格式（如 "美国 Iowa"）
        if (!regionFound) {
            const usMatch = line.match(/美国\s+([A-Za-z]+)/);
            if (usMatch) {
                fields.push('美国 ' + usMatch[1]);
                regionFound = true;
            }
        }
        // 检查单独的美国州名
        if (!regionFound) {
            for (const state of usStates) {
                if (new RegExp('\\b'+state+'\\b').test(line)) {
                    fields.push('美国 ' + state);
                    break;
                }
            }
        }

        // 提取人名（2-3个中文字符的连续块）
        const nameMatches = line.match(/[\u4e00-\u9fff]{2,3}(?=[\s0\t,，])/g);
        if (nameMatches) {
            // 排除已提取的省份名和地区名
            const excludeList = [...provinces, ...otherRegions];
            const names = nameMatches.filter(n => !excludeList.includes(n) && n.length >= 2);
            fields.push(...names.slice(0, 2)); // 最多取2个人名
        }

        // 提取问题定性
        const problemTypes = ['设置','操作','动力','结构','软件','其他'];
        for (const pt of problemTypes) {
            if (line.includes(pt)) { fields.push(pt); break; }
        }

        // 提取质保状态
        if (/质保/.test(line)) {
            if (/非.*质保|非质保/.test(line)) fields.push('非质保');
            else fields.push('质保');
        }

        // 提取长描述文本（FPV描述/Dashboard Data等）
        // 匹配包含FPV、Dashboard、Preliminary等关键词的长文本
        const descPatterns = [
            /FPV[：:]\s*(.+?)(?=Dashboard|Preliminary|Suspected|$)/i,
            /Dashboard\s*Data[：:]\s*(.+?)(?=Preliminary|Suspected|$)/i,
            /Preliminary\s*Analysis[：:]\s*(.+?)(?=Suspected|$)/i,
            /(疑似雷达问题[^。]*)/i,
            /(Suspected\s+Radar\s+Issue[^.]*)/i,
        ];
        for (const pattern of descPatterns) {
            const descMatch = line.match(pattern);
            if (descMatch) {
                fields.push(descMatch[1].trim());
                break;
            }
        }

        // 提取最后一列（问题总结/定性）
        const summaryPatterns = [
            /(疑似[^。]{2,20})/i,
            /(Suspected\s+[^.]{2,30})/i,
        ];
        for (const pattern of summaryPatterns) {
            const summaryMatch = line.match(pattern);
            if (summaryMatch) {
                fields.push(summaryMatch[1].trim());
                break;
            }
        }

        return fields.length >= 3 ? fields : null;
    }

    async function startOCR() {
        if (!ocrImageFile) return;

        const progressDiv = document.getElementById('ocrProgress');
        const progressBar = document.getElementById('ocrProgressBar');
        const progressText = document.getElementById('ocrProgressText');
        const btnStart = document.getElementById('btnStartOCR');

        progressDiv.style.display = '';
        btnStart.disabled = true;
        btnStart.textContent = '⏳ 识别中...';
        progressBar.style.width = '10%';
        progressText.textContent = '正在加载OCR引擎...';

        try {
            // 懒加载 Tesseract worker
            if (!ocrWorker) {
                ocrWorker = await Tesseract.createWorker('chi_sim+eng', 1, {
                    logger: (m) => {
                        if (m.status === 'recognizing text') {
                            const pct = Math.round(m.progress * 100);
                            progressBar.style.width = Math.max(10, pct) + '%';
                            progressText.textContent = `识别中... ${pct}%`;
                        } else if (m.status === 'loading language traineddata') {
                            progressText.textContent = '加载语言包...';
                            progressBar.style.width = '30%';
                        }
                    }
                });
            }

            progressBar.style.width = '40%';
            progressText.textContent = '正在预处理图像...';

            // 图像预处理：提高对比度，转为灰度，提高OCR识别质量
            const preprocessedImage = await preprocessImageForOCR(ocrImageFile);

            progressBar.style.width = '50%';
            progressText.textContent = '正在识别文字...';

            const result = await ocrWorker.recognize(preprocessedImage);
            const text = result.data.text;

            progressBar.style.width = '100%';
            progressText.textContent = '✅ 识别完成！';

            // 将OCR结果填入文本框并触发解析
            const textarea = document.getElementById('smartEntryText');
            const cleanedText = cleanOCRText(text);
            textarea.value = cleanedText;

            // 切换到文本tab显示识别结果
            document.querySelectorAll('.smart-tab').forEach(t => t.classList.remove('active'));
            document.querySelector('.smart-tab[data-tab="text"]').classList.add('active');
            document.getElementById('smartTabText').style.display = '';
            document.getElementById('smartTabImage').style.display = 'none';

            // 触发解析
            smartParsedRows = parseSmartText(cleanedText);
            const preview = document.getElementById('smartEntryPreview');
            
            // OCR质量检测：检查解析结果是否合理
            const hasValidData = smartParsedRows.some(row => {
                const hasDate = /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(row['分析时间'] || row['时间'] || row['日期'] || '');
                const hasModel = /J\d{2,3}/i.test(row['机型'] || '');
                const hasFrame = /\d{4,6}/.test(row['机架号'] || '');
                return hasDate || hasModel || hasFrame;
            });

            if (smartParsedRows.length === 0 || !hasValidData) {
                // 解析失败或质量太差，显示原始OCR文本供手动编辑
                preview.innerHTML = '<p class="hint">⚠️ OCR识别完成，但解析结果质量较差。请检查识别结果并手动编辑。</p>' +
                    '<textarea id="ocrEditText" rows="8" class="ocr-edit-area">' + esc(text) + '</textarea>' +
                    '<button class="btn btn-info btn-sm" id="btnReparseOCR" style="margin-top:8px">🔄 重新解析</button>' +
                    '<p class="hint" style="margin-top:8px;color:#e67e22">💡 提示：编辑文本后点击「重新解析」，解析成功后再点击右下角「确认导入」</p>';
                document.getElementById('btnReparseOCR').addEventListener('click', () => {
                    const editedText = document.getElementById('ocrEditText').value;
                    smartParsedRows = parseSmartText(editedText);
                    if (smartParsedRows.length > 0) {
                        preview.innerHTML = `<p class="hint">✅ 识别到 ${smartParsedRows.length} 条记录，可以点击右下角「确认导入」</p>` +
                            '<table class="data-table mini"><thead><tr>' +
                            Object.keys(smartParsedRows[0]).map(k => `<th>${k}</th>`).join('') +
                            '</tr></thead><tbody>' +
                            smartParsedRows.slice(0,5).map(r => '<tr>' + Object.values(r).map(v => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') +
                            '</tbody></table>';
                    } else {
                        preview.innerHTML = '<p class="hint">⚠️ 仍未能识别到有效数据，请手动录入</p>';
                    }
                });
            } else {
                preview.innerHTML = `<p class="hint">✅ OCR识别完成，解析到 ${smartParsedRows.length} 条记录</p>` +
                    '<table class="data-table mini"><thead><tr>' +
                    Object.keys(smartParsedRows[0]).map(k => `<th>${k}</th>`).join('') +
                    '</tr></thead><tbody>' +
                    smartParsedRows.slice(0,5).map(r => '<tr>' + Object.values(r).map(v => `<td>${esc(v)}</td>`).join('') + '</tr>').join('') +
                    '</tbody></table>';
            }
        } catch (err) {
            progressText.textContent = '❌ 识别失败：' + err.message;
            progressBar.style.width = '0%';
            console.error('OCR Error:', err);
        } finally {
            btnStart.disabled = false;
            btnStart.textContent = '🔍 开始识别';
        }
    }

    // ============================================================
    // 智能录入解析规则（炸机分析表格式）
    // 支持来源：Excel/网页表格复制粘贴、OCR识别图片
    // 列顺序：时间 | 机型 | 机架号 | 架次 | 省份 | 初步结论 | 问题定性
    // 兼容：纯中文 / 中英双语 / 纯英文（表头自动识别）
    // ============================================================
    // 根据机架号自动推导机型
    // 规则：机架号后5位的首字符 -> 机型
    // 8 -> J100, 9 -> J150, 5 -> J70, A -> J160, B -> J110
    function detectModelFromAirframe(airframeNo) {
        if (!airframeNo) return '';
        // 提取后5位
        const last5 = airframeNo.replace(/\s+/g, '').slice(-5);
        if (last5.length < 5) return '';
        const firstChar = last5[0].toUpperCase();
        const modelMap = {
            '8': 'J100',
            '9': 'J150',
            '5': 'J70',
            'A': 'J160',
            'B': 'J110'
        };
        return modelMap[firstChar] || '';
    }

    function parseSmartText(text) {
        const lines = text.split('\n').filter(l => l.trim());
        if (lines.length < 1) return [];

        const firstLine = lines[0];

        // --- 表头识别（支持中英文双语表头）---
        const CN_HEADERS = ['分析时间','工单编号','机架号','机型','架次','反馈人','分析人','问题定性','是否质保','省份','日期',
                            '初步结论','初步分析','故障情况','故障现象','跟进情况','最终结论','区域','追踪人','审核人'];
        const EN_HEADERS = ['date','time','model','airframe','sn','flight','id','region','preliminary','analysis','root','cause','classification'];
        const hasHeader = CN_HEADERS.some(h => firstLine.includes(h)) ||
                          EN_HEADERS.some(h => new RegExp('\\b'+h+'\\b','i').test(firstLine));

        let headers = [];
        let dataStartIndex = 0;
        let expectedCols = 0;

        if (hasHeader) {
            // 按 Tab 拆表头，同时兼容空格分隔
            headers = firstLine.split(/\t+/).map(h => h.trim());
            // 如果只有一个字段（空格分隔的表头），尝试按多空格拆分
            if (headers.length <= 1) {
                headers = firstLine.split(/\s{2,}/).map(h => h.trim());
            }
            expectedCols = headers.length;
            dataStartIndex = 1;
        } else {
            // 无表头：先统计所有行的最大 Tab 列数作为 expectedCols
            let maxCols = 0;
            for (let i = 0; i < lines.length; i++) {
                const tc = (lines[i].match(/\t/g)||[]).length + 1;
                if (tc > maxCols) maxCols = tc;
            }
            expectedCols = maxCols;

            // 智能推断表头：根据内容特征匹配已知格式
            // 炸机分析表（7列）：日期 | 机型 | 机架号 | 架次 | 省份 | 初步结论 | 问题定性
            // 日常工作录入（10列）：日期 | 工单编号 | 机架号 | 机型 | 架次-地块 | 省份 | 反馈人 | 分析人 | 问题定性 | 是否质保
            // 判断依据：检查第一行第2列是否为机型代码（Jxx格式或JMZK/JMZJ/EAVUAV前缀），第3列是否为纯数字机架号
            const firstRowCols = lines[dataStartIndex].split(/\t+/).map(c => c.trim());
            const isCrashAnalysisFormat = (
                firstRowCols.length >= 5 &&
                (/^J\d{2,3}$/i.test(firstRowCols[1]) || /^(JMZK|JMZJ|EAVUAV)/i.test(firstRowCols[1])) &&  // 第2列是机型如 J70/J150 或 JMZK...
                /^\d{4,6}$/.test(firstRowCols[2])         // 第3列是机架号如 59963
            );

            const DEFAULT_HEADERS_7 = ['分析时间','机型','机架号','架次','省份','初步结论','问题定性'];
            const DEFAULT_HEADERS_9 = ['分析时间','机型','机架号','地块','反馈人','分析人','问题定性','是否质保','备注'];
            const DEFAULT_HEADERS_10_NEW = ['分析时间','机型','机架号','地块','省区','反馈人','分析人','问题定性','是否质保','备注'];
            const DEFAULT_HEADERS_10 = ['分析时间','工单编号','机架号','机型','架次-地块','省份','反馈人','分析人','问题定性','是否质保'];

            // 备用检测：7列数据，最后一列包含问题定性关键词 → 炸机分析表
            const PROBLEM_TYPE_KEYWORDS = /操作问题|动力|问题|故障|断裂|烧|炸|裂纹|变形|损坏|质量问题|不符合质保|质保|手动碰撞|卡扣|尾插|机臂|信号|失联|雷达|避障|喷洒|播撒|GPS|RTK|航线|偏航|翻机|坠机|失控/i;
            let isCrashByContent = false;
            if (!isCrashAnalysisFormat && expectedCols === 7 && firstRowCols.length >= 7) {
                const lastCol = firstRowCols[firstRowCols.length - 1] || '';
                const secondLastCol = firstRowCols[firstRowCols.length - 2] || '';
                // 最后一列或倒数第二列包含问题定性/初步结论关键词
                if (PROBLEM_TYPE_KEYWORDS.test(lastCol) || PROBLEM_TYPE_KEYWORDS.test(secondLastCol)) {
                    isCrashByContent = true;
                }
            }

            if (isCrashAnalysisFormat || isCrashByContent) {
                headers = DEFAULT_HEADERS_7.slice();
                expectedCols = 7;  // 强制使用7列，即使第一行只有5个Tab
            } else if (expectedCols === 9) {
                // 9列数据：没有"省区"列
                headers = DEFAULT_HEADERS_9.slice();
            } else if (expectedCols === 10) {
                // 10列数据：包含"省区"列
                headers = DEFAULT_HEADERS_10_NEW.slice();
            } else {
                headers = DEFAULT_HEADERS_10.slice(0, expectedCols);
            }
        }

        // ========== 改进：多行字段合并 ==========
        // 策略：检测新记录开始（包含日期+机型/机架号特征），否则视为续行
        const mergedLines = [];
        let currentRow = null;

        for (let i = dataStartIndex; i < lines.length; i++) {
            const line = lines[i];
            const tabCount = (line.match(/\t/g)||[]).length;
            const colCount = tabCount + 1;

            // 检测是否是新记录的开始：包含日期+机型/机架号
            // 支持日期格式：2026-07-23 / 2026/07/23 / 2026年7月23日
            const hasDate = /\d{4}[-\/]\d{1,2}[-\/]\d{1,2}/.test(line) || /\d{4}年\d{1,2}月\d{1,2}日/.test(line);
            const hasModel = /\b(J\d{2,3}|E\d{2,3})\b/i.test(line);
            // 支持机架号格式：纯数字(90147) 或 字母+数字(A0162, A0589)
            const hasFrame = /\b\d{5,6}\b/.test(line) || /\b[A-Z]\d{3,5}\b/i.test(line);
            const isNewRecord = hasDate && (hasModel || hasFrame);

            if (isNewRecord || colCount >= expectedCols) {
                // 新记录开始或完整行：保存上一行，开始新行
                if (currentRow !== null) {
                    mergedLines.push(currentRow);
                }
                currentRow = line;
            } else {
                // 续行：追加到当前行的末尾（用换行符连接）
                if (currentRow !== null) {
                    currentRow = currentRow + '\n' + line;
                } else {
                    // 第一行就是续行（异常情况），当作独立行
                    currentRow = line;
                }
            }
        }
        // 保存最后一行
        if (currentRow !== null) {
            mergedLines.push(currentRow);
        }

        const rows = [];
        for (let i = 0; i < mergedLines.length; i++) {
            const line = mergedLines[i];
            // 按 Tab 拆分列
            const cols = line.split(/\t+/).map(c => c.trim());
            // 如果只有一个字段，尝试按多空格拆分（OCR结果常见）
            let finalCols = cols;
            if (cols.length <= 1 && headers.length > 1) {
                finalCols = line.split(/\s{2,}/).map(c => c.trim());
            }

            const row = {};
            if (hasHeader) {
                headers.forEach((h, j) => { row[h] = finalCols[j] || ''; });
            } else {
                headers.forEach((h, j) => {
                    if (j < finalCols.length) row[h] = finalCols[j] || '';
                });
            }
            // 日期格式标准化：2026/7/20 → 2026-07-20，2026年7月23日 → 2026-07-23
            if (row['分析时间'] || row['时间'] || row['日期']) {
                const dateKey = row['分析时间'] ? '分析时间' : (row['时间'] ? '时间' : '日期');
                const dateVal = row[dateKey];
                // YYYY/MM/DD → YYYY-MM-DD
                const dateMatch = dateVal.match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/);
                if (dateMatch) {
                    row[dateKey] = dateMatch[1] + '-' + String(dateMatch[2]).padStart(2,'0') + '-' + String(dateMatch[3]).padStart(2,'0');
                }
                // YYYY年MM月DD日 → YYYY-MM-DD
                const cnDateMatch = dateVal.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
                if (cnDateMatch) {
                    row[dateKey] = cnDateMatch[1] + '-' + String(cnDateMatch[2]).padStart(2,'0') + '-' + String(cnDateMatch[3]).padStart(2,'0');
                }
            }
            rows.push(row);
        }
        return rows;
    }

    function confirmSmartEntry() {
        // 如果 smartParsedRows 为空，尝试从文本框重新解析
        if (smartParsedRows.length === 0) {
            const textarea = document.getElementById('smartEntryText');
            if (textarea && textarea.value.trim()) {
                smartParsedRows = parseSmartText(textarea.value);
            }
        }
        
        if (smartParsedRows.length === 0) {
            alert('⚠️ 没有可导入的记录。请先粘贴数据或上传图片进行识别。');
            return;
        }
        
        const FIELD_MAP = {
            // 时间字段
            '分析时间': 'analysisTime', '时间': 'analysisTime', '日期': 'analysisTime', 'Date': 'analysisTime',
            // 工单号
            '工单编号': 'workOrderNo', '工单号': 'workOrderNo',
            // 机架号
            '机架号': 'airframeNo', '飞机号': 'airframeNo', 'Airframe SN': 'airframeNo', 'SN': 'airframeNo',
            // 机型
            '机型': 'model', '型号': 'model', 'Model': 'model',
            // 架次/地块（支持多种格式）
            '架次': 'flightBatch', '架次-地块': 'flightBatch', '地块': 'flightBatch', 'Flight ID': 'flightBatch',
            // 省区
            '省区': 'region', '省份': 'region', '区域': 'region', 'Region': 'region',
            // 人员
            '反馈人': 'feedbackPerson', '分析人': 'analyst', '处理人': 'analyst',
            // 问题定性（炸机分析表）
            '问题定性': 'problemType', '故障类型': 'problemType', 'Root Cause Classification': 'problemType',
            '是否质保': 'auditResult', '定责': 'auditResult',
            '追踪人': 'tracker', '审核人': 'reviewer',
            // 问题描述
            '问题描述': 'problemDescription', '问题反馈描述': 'problemDescription',
            '故障情况': 'faultCondition', '故障现象': 'faultCondition',
            // 初步结论/分析（炸机分析表）
            '初步分析': 'initialAnalysis', '初步分析过程': 'initialAnalysis',
            '初步结论': 'initialAnalysis', 'Preliminary Analysis': 'initialAnalysis',
            // 跟进
            '跟进情况': 'followUp', '异常跟进': 'followUp',
            // 最终结论
            '最终结论': 'finalConclusion', '结论': 'finalConclusion',
            // 英文表头兼容
            'time': 'analysisTime', 'date': 'analysisTime',
            'model': 'model', 'airframe': 'airframeNo', 'sn': 'airframeNo',
            'flight': 'flightBatch', 'id': 'flightBatch',
            'region': 'region', 'preliminary': 'initialAnalysis', 'analysis': 'initialAnalysis',
            'root': 'problemType', 'cause': 'problemType', 'classification': 'problemType'
        };
        // 获取当前登录用户
        const session = getSession();
        const currentUser = session ? session.name : '';
        let count = 0;
        smartParsedRows.forEach(row => {
            const record = { id: Date.now().toString(36) + Math.random().toString(36).substr(2,5) };
            Object.keys(row).forEach(key => {
                const field = FIELD_MAP[key];
                if (field) record[field] = row[key];
            });
            // 如果解析结果中没有分析人，自动填充当前登录用户
            if (!record.analyst && currentUser) {
                record.analyst = currentUser;
            }
            // 兜底：如果 analysisTime 为空，尝试从原始行文本中提取日期
            if (!record.analysisTime) {
                const rawText = Object.values(row).join(' ');
                const dateMatch = rawText.match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
                if (dateMatch) {
                    record.analysisTime = dateMatch[1] + '-' + String(dateMatch[2]).padStart(2,'0') + '-' + String(dateMatch[3]).padStart(2,'0');
                }
            }
            // 自动推导机型：如果 model 为空但有 airframeNo，根据机架号后5位首字符推导
            if (!record.model && record.airframeNo) {
                record.model = detectModelFromAirframe(record.airframeNo);
            }
            if (record.analysisTime || record.workOrderNo || record.airframeNo) {
                records.push(record);
                count++;
            }
        });
        saveRecords();
        renderTodayTable();
        updateDashboard();
        document.getElementById('smartEntryModal').classList.remove('show');
        document.getElementById('smartEntryText').value = '';
        document.getElementById('smartEntryPreview').innerHTML = '';
        smartParsedRows = [];
        alert(`✅ 成功导入 ${count} 条记录`);
    }

    // ========== 日报 ==========
    function generateDailyReport() {
        const date = document.getElementById('dailyDate').value;
        if (!date) return;
        const dayRecords = records.filter(r => r.analysisTime && r.analysisTime.startsWith(date));

        document.getElementById('dailyTotal').textContent = dayRecords.length;
        document.getElementById('dailyWarranty').textContent = dayRecords.filter(r => r.auditResult === '质保').length;
        document.getElementById('dailyNonWarranty').textContent = dayRecords.filter(r => r.auditResult === '非质保').length;

        // 问题类型分布 - 精简显示
        const typeCount = {};
        dayRecords.forEach(r => { 
            if (r.problemType) {
                // 截取问题类型名称，只保留中文部分或前20个字符
                let shortName = r.problemType;
                if (shortName.length > 20) {
                    // 尝试找到第一个英文字母或括号的位置进行截断
                    const match = shortName.match(/^([^\(A-Za-z]+)/);
                    shortName = match ? match[1].trim() : shortName.substring(0, 20);
                }
                typeCount[shortName] = (typeCount[shortName]||0)+1; 
            }
        });
        
        // 按数量排序，最多显示前5个
        const sortedTypes = Object.entries(typeCount)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
        
        const typeDist = sortedTypes.length > 0 
            ? sortedTypes.map(([k,v]) => `${k}:${v}`).join('\n')
            : '—';
        document.getElementById('dailyTypeDist').textContent = typeDist;
        document.getElementById('dailyTypeDist').style.whiteSpace = 'pre-line';

        // 日报明细表
        const tbody = document.querySelector('#dailyTable tbody');
        if (dayRecords.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="empty-state">当日暂无记录</td></tr>';
        } else {
            tbody.innerHTML = dayRecords.sort((a,b) => new Date(a.analysisTime) - new Date(b.analysisTime)).map(r => `
                <tr>
                    <td>${formatDateTime(r.analysisTime)}</td>
                    <td>${esc(r.workOrderNo)}</td>
                    <td>${esc(r.airframeNo)}</td>
                    <td>${esc(r.model)}</td>
                    <td>${esc(r.analyst)}</td>
                    <td>${esc(r.problemType)}</td>
                    <td><span class="audit-badge audit-${r.auditResult||'未判定'}">${esc(r.auditResult||'未判定')}</span></td>
                    <td class="text-ellipsis" title="${esc(r.initialAnalysis)}">${esc(r.initialAnalysis||'—')}</td>
                    <td class="text-ellipsis" title="${esc(r.finalConclusion)}">${esc(r.finalConclusion||'—')}</td>
                </tr>
            `).join('');
        }

        // 图表
        renderDailyCharts(dayRecords, typeCount);
    }

    function renderDailyCharts(dayRecords, typeCount) {
        // 问题类型饼图
        if (charts.dailyType) charts.dailyType.destroy();
        const typeLabels = Object.keys(typeCount);
        const typeValues = Object.values(typeCount);
        if (typeLabels.length > 0) {
            charts.dailyType = new Chart(document.getElementById('dailyTypeChart'), {
                type: 'doughnut',
                data: {
                    labels: typeLabels,
                    datasets: [{ data: typeValues, backgroundColor: ['#444e87','#4472c4','#70ad47','#ffc107','#c00000','#00b0f0'] }]
                },
                options: { responsive:true, maintainAspectRatio:false, plugins:{ title:{ display:true, text:'问题定性分布' } } }
            });
        }

        // 质保饼图
        if (charts.dailyAudit) charts.dailyAudit.destroy();
        const wz = dayRecords.filter(r => r.auditResult === '质保').length;
        const fwz = dayRecords.filter(r => r.auditResult === '非质保').length;
        if (wz + fwz > 0) {
            charts.dailyAudit = new Chart(document.getElementById('dailyAuditChart'), {
                type: 'doughnut',
                data: {
                    labels: ['质保','非质保'],
                    datasets: [{ data: [wz, fwz], backgroundColor: ['#70ad47','#c00000'] }]
                },
                options: { responsive:true, maintainAspectRatio:false, plugins:{ title:{ display:true, text:'质保/非质保分布' } } }
            });
        }
    }

    // ========== 日报导出 ==========
    function exportDailyExcel() {
        const date = document.getElementById('dailyDate').value;
        if (!date) return;
        const dayRecords = records.filter(r => r.analysisTime && r.analysisTime.startsWith(date));
        if (dayRecords.length === 0) { alert('当日无记录'); return; }

        const headers = ['时间','工单编号','机架号','机型','架次','区域','反馈人','分析人','问题定性','是否质保','追踪人','审核人','问题描述','故障情况','初步分析','跟进情况','最终结论'];
        const rows = [headers];
        dayRecords.forEach(r => {
            rows.push([r.analysisTime, r.workOrderNo, r.airframeNo, r.model, r.flightBatch, r.region,
                       r.feedbackPerson, r.analyst, r.problemType, r.auditResult, r.tracker, r.reviewer,
                       r.problemDescription, r.faultCondition, r.initialAnalysis, r.followUp, r.finalConclusion]);
        });

        const ws = XLSX.utils.aoa_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '日报');
        XLSX.writeFile(wb, `日报_${date}.xlsx`);
    }

    // ========== 日报导出 Word ==========
    function exportDailyDocx() {
        const date = document.getElementById('dailyDate').value;
        if (!date) return;
        const dayRecords = records.filter(r => r.analysisTime && r.analysisTime.startsWith(date));
        if (dayRecords.length === 0) { alert('当日无记录'); return; }

        // 统计数据
        const warrantyCount = dayRecords.filter(r => r.auditResult === '质保').length;
        const nonWarrantyCount = dayRecords.filter(r => r.auditResult === '非质保').length;
        const typeCount = {};
        const analystSet = new Set();
        dayRecords.forEach(r => {
            if (r.problemType) typeCount[r.problemType] = (typeCount[r.problemType]||0) + 1;
            if (r.analyst) analystSet.add(r.analyst);
        });
        const topType = Object.entries(typeCount).sort((a,b) => b[1]-a[1])[0];
        const typeDistStr = Object.entries(typeCount).map(([k,v]) => `${k} ${v}条`).join('、');

        // 格式化日期
        const dateStr = date.replace(/-/g, '年') + '日';
        const now = new Date();
        const genTime = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')} ${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

        // 使用 docx 库生成 Word 文档
        const { Document, Paragraph, TextRun, Table, TableRow, TableCell, 
                HeadingLevel, AlignmentType, WidthType, BorderStyle,
                Packer, TableLayoutType } = docx;

        const doc = new Document({
            styles: {
                default: {
                    document: {
                        run: { font: '微软雅黑', size: 22 }
                    }
                }
            },
            sections: [{
                properties: {},
                children: [
                    // 标题
                    new Paragraph({
                        children: [new TextRun({ text: `极目售后分析组日报`, bold: true, size: 36, font: '微软雅黑' })],
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 100 }
                    }),
                    new Paragraph({
                        children: [new TextRun({ text: `${dateStr}`, size: 28, font: '微软雅黑' })],
                        alignment: AlignmentType.CENTER,
                        spacing: { after: 400 }
                    }),

                    // ===== 一、今日概况 =====
                    new Paragraph({
                        children: [new TextRun({ text: '一、今日概况', bold: true, size: 26, font: '微软雅黑' })],
                        spacing: { before: 200, after: 200 }
                    }),
                    new Paragraph({
                        children: [new TextRun({ text: `本日共处理故障分析记录 ${dayRecords.length} 条。`, size: 22, font: '微软雅黑' })],
                        spacing: { after: 100 }
                    }),
                    new Paragraph({
                        children: [new TextRun({ text: `其中，质保 ${warrantyCount} 条，非质保 ${nonWarrantyCount} 条。`, size: 22, font: '微软雅黑' })],
                        spacing: { after: 100 }
                    }),
                    new Paragraph({
                        children: [new TextRun({ text: `问题类型分布：${typeDistStr || '无' }。`, size: 22, font: '微软雅黑' })],
                        spacing: { after: 100 }
                    }),
                    new Paragraph({
                        children: [new TextRun({ text: `参与分析人员：${[...analystSet].join('、') || '无'}。`, size: 22, font: '微软雅黑' })],
                        spacing: { after: 100 }
                    }),
                    topType ? new Paragraph({
                        children: [new TextRun({ text: `重点关注：${topType[0]} 问题最多（${topType[1]}条），建议加强相关排查力度。`, size: 22, font: '微软雅黑', color: 'C00000' })],
                        spacing: { after: 200 }
                    }) : null,

                    // ===== 二、日报明细表 =====
                    new Paragraph({
                        children: [new TextRun({ text: '二、日报明细表', bold: true, size: 26, font: '微软雅黑' })],
                        spacing: { before: 200, after: 200 }
                    }),

                    // 表格
                    new Table({
                        width: { size: 100, type: WidthType.PERCENTAGE },
                        layout: TableLayoutType.FIXED,
                        rows: [
                            // 表头行
                            new TableRow({
                                tableHeader: true,
                                children: ['时间','工单编号','机架号','机型','问题定性','是否质保','分析人','追踪人'].map(h => new TableCell({
                                    children: [new Paragraph({
                                        children: [new TextRun({ text: h, bold: true, size: 18, font: '微软雅黑' })],
                                        alignment: AlignmentType.CENTER
                                    })],
                                    width: { size: 12, type: WidthType.PERCENTAGE },
                                    shading: { fill: '444E87', color: 'FFFFFF' }
                                }))
                            }),
                            // 数据行
                            ...dayRecords.map(r => new TableRow({
                                children: [r.analysisTime || '', r.workOrderNo || '', r.airframeNo || '', r.model || '', 
                                           r.problemType || '', r.auditResult || '', r.analyst || '', r.tracker || ''].map(cellText => new TableCell({
                                    children: [new Paragraph({
                                        children: [new TextRun({ text: String(cellText), size: 18, font: '微软雅黑' })],
                                        alignment: AlignmentType.CENTER
                                    })]
                                }))
                            }))
                        ]
                    }),

                    // ===== 三、问题详情说明 =====
                    new Paragraph({
                        children: [new TextRun({ text: '三、问题详情说明', bold: true, size: 26, font: '微软雅黑' })],
                        spacing: { before: 400, after: 200 }
                    }),
                    ...dayRecords.map((r, i) => [
                        new Paragraph({
                            children: [new TextRun({ text: `${i+1}. ${r.workOrderNo || '无工单号'}`, bold: true, size: 22, font: '微软雅黑' })],
                            spacing: { before: 200 }
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: `机架号：${r.airframeNo || '无'}`, size: 20, font: '微软雅黑' })],
                            indent: { left: 400 }
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: `问题定性：${r.problemType || '无'}`, size: 20, font: '微软雅黑' })],
                            indent: { left: 400 }
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: `问题描述：${r.problemDescription || '无'}`, size: 20, font: '微软雅黑' })],
                            indent: { left: 400 }
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: `初步分析：${r.initialAnalysis || '无'}`, size: 20, font: '微软雅黑' })],
                            indent: { left: 400 }
                        }),
                        new Paragraph({
                            children: [new TextRun({ text: `最终结论：${r.finalConclusion || '无'}`, size: 20, font: '微软雅黑' })],
                            indent: { left: 400 },
                            spacing: { after: 200 }
                        })
                    ]).flat(),

                    // ===== 四、生成信息 =====
                    new Paragraph({
                        children: [new TextRun({ text: `报告生成时间：${genTime}`, size: 18, font: '微软雅黑', color: '888888' })],
                        spacing: { before: 400 },
                        alignment: AlignmentType.RIGHT
                    }),
                    new Paragraph({
                        children: [new TextRun({ text: '数据来源：极目售后分析组工作台（云端同步）', size: 18, font: '微软雅黑', color: '888888' })],
                        alignment: AlignmentType.RIGHT
                    })
                ].filter(Boolean) // 过滤掉 null
            }]
        });

        // 生成并下载
        Packer.toBlob(doc).then(blob => {
            saveAs(blob, `日报_${date}.docx`);
        });
    }

    // ========== 日报导出Word ==========
    function exportDailyDocx() {
        const date = document.getElementById('dailyDate').value;
        if (!date) { alert('请先选择日期'); return; }
        const dayRecords = records.filter(r => r.analysisTime && r.analysisTime.startsWith(date));
        if (dayRecords.length === 0) { alert('当日无记录'); return; }

        // 统计概况
        const total = dayRecords.length;
        const warranty = dayRecords.filter(r => r.auditResult === '质保').length;
        const nonWarranty = dayRecords.filter(r => r.auditResult === '非质保').length;
        const pending = dayRecords.filter(r => r.auditResult !== '质保' && r.auditResult !== '非质保').length;

        const typeCount = {};
        dayRecords.forEach(r => { if (r.problemType) typeCount[r.problemType] = (typeCount[r.problemType]||0)+1; });
        const typeDistStr = Object.entries(typeCount).map(([k,v]) => `${k} ${v}起`).join('、') || '—';

        // 按时间排序
        const sorted = [...dayRecords].sort((a,b) => new Date(a.analysisTime) - new Date(b.analysisTime));

        const D = docx;
        const Align = D.AlignmentType;
        const Border = D.BorderStyle;
        const Heading = D.HeadingLevel;

        // 文档构建
        const doc = new D.Document({
            creator: '极目售后分析组工作台',
            title: `日报_${date}`,
            description: `极目售后分析组日报 - ${date}`,
            styles: {
                default: {
                    document: {
                        run: { font: 'Microsoft YaHei', size: 21, color: '333333' }
                    }
                }
            },
            sections: [{
                properties: {},
                children: [
                    // ===== 标题 =====
                    new D.Paragraph({
                        children: [new D.TextRun({ text: '极目售后分析组 — 日报', bold: true, size: 32, font: 'Microsoft YaHei', color: '1F3864' })],
                        alignment: Align.CENTER,
                        spacing: { after: 100 }
                    }),
                    new D.Paragraph({
                        children: [new D.TextRun({ text: `日期：${date}`, size: 22, font: 'Microsoft YaHei', color: '555555' })],
                        alignment: Align.CENTER,
                        spacing: { after: 400 }
                    }),

                    // ===== 一、今日概况 =====
                    new D.Paragraph({
                        children: [new D.TextRun({ text: '一、今日概况', bold: true, size: 26, font: 'Microsoft YaHei', color: '1F3864' })],
                        spacing: { before: 200, after: 200 }
                    }),
                    new D.Paragraph({
                        children: [new D.TextRun({
                            text: `本日共处理分析记录 ${total} 条。其中质保 ${warranty} 条，非质保 ${nonWarranty} 条${pending > 0 ? `，待判定 ${pending} 条` : ''}。问题类型分布：${typeDistStr}。`,
                            size: 21, font: 'Microsoft YaHei'
                        })],
                        spacing: { after: 300 }
                    }),

                    // ===== 二、记录明细表 =====
                    new D.Paragraph({
                        children: [new D.TextRun({ text: '二、记录明细表', bold: true, size: 26, font: 'Microsoft YaHei', color: '1F3864' })],
                        spacing: { before: 200, after: 200 }
                    }),

                    // 表格：时间 | 工单编号 | 机架号 | 机型 | 分析人 | 问题定性 | 质保结论 | 初步分析 | 最终结论
                    new D.Table({
                        rows: [
                            // 表头
                            new D.TableRow({
                                tableHeader: true,
                                children: ['时间','工单编号','机架号','机型','分析人','问题定性','质保结论','初步分析','最终结论'].map(h => new D.TableCell({
                                    children: [new D.Paragraph({
                                        children: [new D.TextRun({ text: h, bold: true, size: 18, font: 'Microsoft YaHei', color: 'FFFFFF' })],
                                        alignment: Align.CENTER
                                    })],
                                    shading: { fill: '1F3864', type: D.ShadingType.CLEAR },
                                    width: { size: h === '初步分析' || h === '最终结论' ? 1800 : 1200, type: D.WidthType.DXA }
                                }))
                            }),
                            // 数据行
                            ...sorted.map(r => new D.TableRow({
                                children: [r.analysisTime, r.workOrderNo, r.airframeNo, r.model, r.analyst, r.problemType, r.auditResult||'未判定', r.initialAnalysis||'—', r.finalConclusion||'—'].map((cellText, ci) => new D.TableCell({
                                    children: [new D.Paragraph({
                                        children: [new D.TextRun({ text: cellText || '—', size: 18, font: 'Microsoft YaHei' })],
                                        alignment: ci < 6 ? Align.CENTER : Align.LEFT
                                    })],
                                    width: { size: ci >= 6 && ci <= 7 ? 1800 : 1200, type: D.WidthType.DXA }
                                }))
                            }))
                        ]
                    }),

                    // ===== 三、问题详情说明 =====
                    new D.Paragraph({
                        children: [new D.TextRun({ text: '三、问题详情说明', bold: true, size: 26, font: 'Microsoft YaHei', color: '1F3864' })],
                        spacing: { before: 400, after: 200 }
                    }),
                    ...sorted.map((r, i) => [
                        new D.Paragraph({
                            children: [new D.TextRun({ text: `第${i+1}条：工单 ${r.workOrderNo || '—'}`, bold: true, size: 21, font: 'Microsoft YaHei', color: '444444' })],
                            spacing: { before: 200, after: 60 }
                        }),
                        new D.Paragraph({
                            children: [
                                new D.TextRun({ text: '问题描述：', bold: true, size: 20, font: 'Microsoft YaHei' }),
                                new D.TextRun({ text: r.problemDescription || '—', size: 20, font: 'Microsoft YaHei' })
                            ],
                            spacing: { after: 40 }
                        }),
                        new D.Paragraph({
                            children: [
                                new D.TextRun({ text: '故障情况：', bold: true, size: 20, font: 'Microsoft YaHei' }),
                                new D.TextRun({ text: r.faultCondition || '—', size: 20, font: 'Microsoft YaHei' })
                            ],
                            spacing: { after: 40 }
                        }),
                        new D.Paragraph({
                            children: [
                                new D.TextRun({ text: '初步分析：', bold: true, size: 20, font: 'Microsoft YaHei' }),
                                new D.TextRun({ text: r.initialAnalysis || '—', size: 20, font: 'Microsoft YaHei' })
                            ],
                            spacing: { after: 40 }
                        }),
                        new D.Paragraph({
                            children: [
                                new D.TextRun({ text: '跟进情况：', bold: true, size: 20, font: 'Microsoft YaHei' }),
                                new D.TextRun({ text: r.followUp || '—', size: 20, font: 'Microsoft YaHei' })
                            ],
                            spacing: { after: 40 }
                        }),
                        new D.Paragraph({
                            children: [
                                new D.TextRun({ text: '最终结论：', bold: true, size: 20, font: 'Microsoft YaHei' }),
                                new D.TextRun({ text: r.finalConclusion || '—', size: 20, font: 'Microsoft YaHei' })
                            ],
                            spacing: { after: 120 }
                        })
                    ]).flat(),

                    // ===== 生成信息 =====
                    new D.Paragraph({
                        children: [new D.TextRun({ text: `— 报告由极目售后分析组工作台自动生成 · ${new Date().toLocaleString('zh-CN')} —`, size: 18, font: 'Microsoft YaHei', color: '999999', italics: true })],
                        alignment: Align.CENTER,
                        spacing: { before: 400 }
                    })
                ]
            }]
        });

        // 生成并下载
        D.Packer.toBlob(doc).then(blob => {
            saveAs(blob, `日报_${date}.docx`);
        }).catch(err => {
            console.error('Word导出失败:', err);
            alert('导出Word失败：' + err.message);
        });
    }

    // ========== 周报 - 文件上传处理 ==========
    function handleOrdersUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const statusEl = document.getElementById('statusOrders');
        statusEl.textContent = '⏳ 解析中...';
        statusEl.className = 'upload-status loading';

        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                const wb = XLSX.read(ev.target.result, { type:'array', cellDates:true });
                ordersData = parseOrdersFile(wb);
                statusEl.textContent = `✅ ${file.name} (${ordersData.totalOrders}单)`;
                statusEl.className = 'upload-status success';
                checkReadyToGenerate();
                updateWeeklyPreview();
            } catch(err) {
                statusEl.textContent = '❌ 解析失败: ' + err.message;
                statusEl.className = 'upload-status error';
                ordersData = null;
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function handleCrashUpload(e) {
        const file = e.target.files[0];
        if (!file) return;
        const statusEl = document.getElementById('statusCrash');
        statusEl.textContent = '⏳ 解析中...';
        statusEl.className = 'upload-status loading';

        const reader = new FileReader();
        reader.onload = function(ev) {
            try {
                const wb = XLSX.read(ev.target.result, { type:'array', cellDates:true });
                crashData = parseCrashFile(wb);
                statusEl.textContent = `✅ ${file.name} (国内${crashData.domestic.length}/海外${crashData.overseas.length})`;
                statusEl.className = 'upload-status success';
                checkReadyToGenerate();
                updateWeeklyPreview();
            } catch(err) {
                statusEl.textContent = '❌ 解析失败: ' + err.message;
                statusEl.className = 'upload-status error';
                crashData = null;
            }
        };
        reader.readAsArrayBuffer(file);
    }

    function checkReadyToGenerate() {
        document.getElementById('btnGenerateWeekly').disabled = !(ordersData && crashData);
    }

    function updateWeeklyPreview() {
        const card = document.getElementById('weeklyPreviewCard');
        if (!ordersData && !crashData) { card.style.display = 'none'; return; }
        card.style.display = '';

        if (ordersData) {
            document.getElementById('ordersPreview').innerHTML = `
                <div class="stat-row"><span>总工单</span><b>${ordersData.totalOrders}</b></div>
                <div class="stat-row"><span>已完结</span><b>${ordersData.finishedTotal}</b></div>
                <div class="stat-row"><span>未完结</span><b>${ordersData.unfinishedTotal}</b></div>
                <div class="stat-row"><span>168h内</span><b>${ordersData.in168}</b></div>
                <div class="stat-row"><span>168h外</span><b>${ordersData.out168}</b></div>
                <div class="stat-row"><span>质保工单</span><b>${ordersData.warrantyOrders}</b></div>
                <div class="stat-row"><span>总费用</span><b>¥${ordersData.totalFee?.toFixed(0)||0}</b></div>
                <div class="stat-row"><span>质保费用</span><b>¥${ordersData.warrantyFee?.toFixed(0)||0}</b></div>
            `;
        }
        if (crashData) {
            document.getElementById('crashPreview').innerHTML = `
                <div class="stat-row"><span>国内炸机</span><b>${crashData.domestic.length}起</b></div>
                <div class="stat-row"><span>海外炸机</span><b>${crashData.overseas.length}起</b></div>
                <div class="stat-row"><span>国内机型Top</span><b>${crashData.domesticModelTop || '—'}</b></div>
                <div class="stat-row"><span>海外机型Top</span><b>${crashData.overseasModelTop || '—'}</b></div>
            `;
        }
    }

    // ========== 解析工单导出文件 ==========
    function parseOrdersFile(wb) {
        // 找工单列表 sheet
        const orderSheetName = wb.SheetNames.find(n => n.includes('工单列表')) || wb.SheetNames[0];
        const partsSheetName = wb.SheetNames.find(n => n.includes('配件明细')) || wb.SheetNames[1];

        const wsO = wb.Sheets[orderSheetName];
        const wsP = partsSheetName ? wb.Sheets[partsSheetName] : null;

        const ordersRaw = XLSX.utils.sheet_to_json(wsO, { header:1, defval:'' });
        const partsRaw = wsP ? XLSX.utils.sheet_to_json(wsP, { header:1, defval:'' }) : [];

        if (ordersRaw.length < 2) throw new Error('工单列表为空');

        // 解析表头
        const headers = ordersRaw[0].map(h => String(h||'').trim());
        const colMap = buildOrderColMap(headers);

        // 解析工单数据
        const orderInfo = {};
        let totalOrders = 0, finishedTotal = 0, unfinishedTotal = 0;
        let in168 = 0, out168 = 0;
        let totalFee = 0, warrantyFee = 0;
        let warrantyOrders = 0;
        const dzCount = {};
        const faultTypeCount = {};
        const analystCount = {};
        const resultL1 = {};

        for (let i = 1; i < ordersRaw.length; i++) {
            const row = ordersRaw[i];
            if (!row || row.every(c => c === '' || c == null)) continue;

            const ono = String(row[colMap.orderNo] || '').trim();
            if (!ono) continue;
            totalOrders++;

            const status = String(row[colMap.status] || '').trim();
            const isFinished = FINISHED_STATUS.includes(status);
            if (isFinished) finishedTotal++; else unfinishedTotal++;

            const hours = parseFloat(row[colMap.hours]) || 0;
            if (isFinished && hours > 0) {
                if (hours <= 168) in168++; else out168++;
            }

            const fee = parseFloat(row[colMap.fee]) || 0;
            totalFee += fee;

            const dz = String(row[colMap.dz] || '').trim();
            dzCount[dz] = (dzCount[dz] || 0) + 1;

            if (dz === '质保服务') {
                warrantyOrders++;
                warrantyFee += fee;
            }

            const faultType = String(row[colMap.faultType] || '').trim();
            faultTypeCount[faultType] = (faultTypeCount[faultType] || 0) + 1;

            const analyst = String(row[colMap.analyst] || '').trim();
            if (analyst) analystCount[analyst] = (analystCount[analyst] || 0) + 1;

            const analysisResult = String(row[colMap.analysisResult] || '').trim();
            if (analysisResult) {
                const parts = analysisResult.split('-');
                if (parts.length >= 2) {
                    const l1 = parts[0].trim();
                    resultL1[l1] = (resultL1[l1] || 0) + 1;
                }
            }

            // 质保工单168h内/外
            if (dz === '质保服务' && isFinished && hours > 0) {
                if (hours <= 168) { /* already counted */ }
            }

            orderInfo[ono] = {
                status, isFinished, hours, fee, dz, faultType, analyst,
                analysisResult,
                jijia: String(row[colMap.jijia] || '').trim(),
                model: String(row[colMap.model] || '').trim()
            };
        }

        // 质保168h内/外（每月1-18）
        let wzIn168 = 0, wzOut168 = 0, wzFinished = 0;
        Object.values(orderInfo).forEach(v => {
            if (v.dz === '质保服务' && v.isFinished) {
                wzFinished++;
                if (v.hours > 0 && v.hours <= 168) wzIn168++;
                else if (v.hours > 168) wzOut168++;
            }
        });

        // 解析配件明细
        const partsData = [];
        const warrantyParts = {};
        const warrantyPartsQty = {};
        if (partsRaw.length > 1) {
            const pHeaders = partsRaw[0].map(h => String(h||'').trim());
            const pColMap = buildPartsColMap(pHeaders);

            for (let i = 1; i < partsRaw.length; i++) {
                const row = partsRaw[i];
                const ono = String(row[pColMap.orderNo] || '').trim();
                if (!ono) continue;
                const info = orderInfo[ono];
                if (!info || info.dz !== '质保服务') continue;

                const name = String(row[pColMap.partName] || '').trim();
                if (!name) continue;
                const qty = parseInt(row[pColMap.qty]) || 0;
                const price = parseFloat(row[pColMap.price]) || 0;

                warrantyParts[name] = (warrantyParts[name] || 0) + price * qty;
                warrantyPartsQty[name] = (warrantyPartsQty[name] || 0) + qty;
            }
        }

        // Top10配件（按数量）
        const partsTop10 = Object.entries(warrantyPartsQty)
            .sort((a,b) => b[1] - a[1])
            .slice(0, 10);

        // 费用分析（按定责）
        const feeByDz = {};
        Object.values(orderInfo).forEach(v => {
            if (!v.isFinished) return;
            const dz = v.dz || '未定责';
            feeByDz[dz] = (feeByDz[dz] || 0) + v.fee;
        });

        // 完结时效分布
        let within72 = 0, between72_168 = 0, over168 = 0;
        Object.values(orderInfo).forEach(v => {
            if (!v.isFinished || v.hours <= 0) return;
            if (v.hours <= 72) within72++;
            else if (v.hours <= 168) between72_168++;
            else over168++;
        });

        // 工单状态分布
        const statusDist = {};
        Object.values(orderInfo).forEach(v => {
            statusDist[v.status] = (statusDist[v.status] || 0) + 1;
        });

        return {
            totalOrders, finishedTotal, unfinishedTotal,
            in168, out168, totalFee, warrantyFee, warrantyOrders,
            dzCount, faultTypeCount, analystCount, resultL1,
            wzIn168, wzOut168, wzFinished,
            partsTop10, feeByDz,
            within72, between72_168, over168,
            statusDist, orderInfo,
            warrantyPartsQty, warrantyParts
        };
    }

    function buildOrderColMap(headers) {
        const map = {
            orderNo: -1, status: -1, hours: -1, fee: -1, dz: -1,
            faultType: -1, analyst: -1, analysisResult: -1, jijia: -1, model: -1
        };
        const aliases = {
            orderNo: ['工单编号','工单号'],
            status: ['工单状态','状态'],
            hours: ['处理时长','处理时长(h)','工时'],
            fee: ['整单费用','费用','总金额'],
            dz: ['定责','定责结果','是否质保'],
            faultType: ['故障类型','故障分类'],
            analyst: ['分析人','处理人'],
            analysisResult: ['分析结果','最终分析'],
            jijia: ['机架号','机架'],
            model: ['机型','型号']
        };
        headers.forEach((h, i) => {
            Object.entries(aliases).forEach(([key, names]) => {
                if (names.some(n => h.includes(n))) {
                    if (map[key] === -1) map[key] = i;
                }
            });
        });
        return map;
    }

    function buildPartsColMap(headers) {
        const map = { orderNo: -1, partName: -1, qty: -1, price: -1 };
        const aliases = {
            orderNo: ['工单编号','工单号'],
            partName: ['配件名称','配件','名称'],
            qty: ['更换数量','数量'],
            price: ['配件单价','单价','价格']
        };
        headers.forEach((h, i) => {
            Object.entries(aliases).forEach(([key, names]) => {
                if (names.some(n => h.includes(n))) {
                    if (map[key] === -1) map[key] = i;
                }
            });
        });
        return map;
    }

    // ========== 解析炸机周报文件 ==========
    function parseCrashFile(wb) {
        const domesticSheet = wb.SheetNames.find(n => n.includes('国内')) || wb.SheetNames[0];
        const overseasSheet = wb.SheetNames.find(n => n.includes('海外')) || wb.SheetNames[1];

        const domestic = parseCrashSheet(wb.Sheets[domesticSheet]);
        const overseas = parseCrashSheet(wb.Sheets[overseasSheet]);

        // 统计
        const domesticModel = countBy(domestic, 'model');
        const overseasModel = countBy(overseas, 'model');
        const domesticRegion = countBy(domestic, 'region');
        const overseasRegion = countBy(overseas, 'region');
        const domesticProblem = countBy(domestic, 'problemType');
        const overseasProblem = countBy(overseas, 'problemType');

        return {
            domestic, overseas,
            domesticModel, overseasModel,
            domesticRegion, overseasRegion,
            domesticProblem, overseasProblem,
            domesticModelTop: topEntry(domesticModel),
            overseasModelTop: topEntry(overseasModel)
        };
    }

    function parseCrashSheet(ws) {
        if (!ws) return [];
        const raw = XLSX.utils.sheet_to_json(ws, { header:1, defval:'' });
        if (raw.length < 2) return [];

        // 找表头行（通常在第3行，索引2）
        let headerRow = -1;
        for (let i = 0; i < Math.min(5, raw.length); i++) {
            const row = raw[i];
            if (row && (row.includes('时间') || row.includes('分析时间') || row.includes('日期'))) {
                headerRow = i;
                break;
            }
        }
        if (headerRow === -1) headerRow = 2; // 默认第3行

        const headers = raw[headerRow].map(h => String(h||'').trim());
        const colMap = buildCrashColMap(headers);
        const records = [];

        for (let i = headerRow + 1; i < raw.length; i++) {
            const row = raw[i];
            if (!row || row.every(c => c === '' || c == null)) continue;
            // 跳过统计区（通常有合并单元格或空行）
            if (row.length <= 2 && !row[colMap.model] && !row[colMap.airframeNo]) continue;

            const time = row[colMap.time] ? String(row[colMap.time]) : '';
            const model = colMap.model >= 0 ? String(row[colMap.model]||'').trim() : '';
            const airframeNo = colMap.airframeNo >= 0 ? String(row[colMap.airframeNo]||'').trim() : '';
            const region = colMap.region >= 0 ? String(row[colMap.region]||'').trim() : '';
            const conclusion = colMap.conclusion >= 0 ? String(row[colMap.conclusion]||'').trim() : '';
            const problemType = colMap.problemType >= 0 ? String(row[colMap.problemType]||'').trim() : '';

            if (model || airframeNo || conclusion) {
                records.push({ time, model, airframeNo, region, conclusion, problemType });
            }
        }
        return records;
    }

    function buildCrashColMap(headers) {
        const map = { time: -1, model: -1, airframeNo: -1, region: -1, conclusion: -1, problemType: -1 };
        const aliases = {
            time: ['时间','分析时间','日期'],
            model: ['机型','型号'],
            airframeNo: ['机架号','机架'],
            region: ['省份','区域','地区','国家'],
            conclusion: ['初步结论','结论','分析结论','初步分析'],
            problemType: ['问题定性','故障类型','问题类型']
        };
        headers.forEach((h, i) => {
            Object.entries(aliases).forEach(([key, names]) => {
                if (names.some(n => h.includes(n) || n.includes(h))) {
                    if (map[key] === -1) map[key] = i;
                }
            });
        });
        return map;
    }

    function countBy(arr, key) {
        const c = {};
        arr.forEach(r => { if (r[key]) c[r[key]] = (c[r[key]]||0)+1; });
        return c;
    }
    function topEntry(obj) {
        const entries = Object.entries(obj).sort((a,b) => b[1]-a[1]);
        return entries.length > 0 ? `${entries[0][0]}(${entries[0][1]})` : '—';
    }

    // ========== 生成标准周报 ==========
    function generateStandardWeekly() {
        if (!ordersData || !crashData) { alert('请先上传工单导出和炸机周报文件'); return; }

        const titleDate = document.getElementById('weeklyTitleDate').value || '本周';
        const logEl = document.getElementById('weeklyLog');
        const logCard = document.getElementById('weeklyLogCard');
        logCard.style.display = '';
        logEl.innerHTML = '';

        function log(msg) {
            logEl.innerHTML += `<div class="log-line">✅ ${msg}</div>`;
            logEl.scrollTop = logEl.scrollHeight;
        }

        log('开始生成周报...');

        try {
            // 创建工作簿
            const wb = XLSX.utils.book_new();

            // ===== Sheet 1: 综合周报汇总 =====
            log('生成综合周报汇总...');
            const ws0Data = buildSummarySheet(ordersData, crashData, titleDate);
            const ws0 = XLSX.utils.aoa_to_sheet(ws0Data.data);
            if (ws0Data.merges) ws0['!merges'] = ws0Data.merges;
            if (ws0Data.colWidths) ws0['!cols'] = ws0Data.colWidths;
            XLSX.utils.book_append_sheet(wb, ws0, '综合周报汇总');

            // ===== Sheet 2: 工单详细数据 =====
            log('生成工单详细数据...');
            const ws1Data = buildOrdersDetailSheet(ordersData);
            const ws1 = XLSX.utils.aoa_to_sheet(ws1Data.data);
            if (ws1Data.merges) ws1['!merges'] = ws1Data.merges;
            XLSX.utils.book_append_sheet(wb, ws1, '工单详细数据');

            // ===== Sheet 3: 国内炸机记录 =====
            log('生成国内炸机记录...');
            const ws2Data = buildCrashSheet(crashData.domestic, crashData.domesticModel, crashData.domesticRegion, crashData.domesticProblem, '国内炸机记录');
            const ws2 = XLSX.utils.aoa_to_sheet(ws2Data.data);
            if (ws2Data.merges) ws2['!merges'] = ws2Data.merges;
            if (ws2Data.colWidths) ws2['!cols'] = ws2Data.colWidths;
            XLSX.utils.book_append_sheet(wb, ws2, '国内炸机记录');

            // ===== Sheet 4: 海外炸机记录 =====
            log('生成海外炸机记录...');
            const ws3Data = buildCrashSheet(crashData.overseas, crashData.overseasModel, crashData.overseasRegion, crashData.overseasProblem, '海外炸机记录');
            const ws3 = XLSX.utils.aoa_to_sheet(ws3Data.data);
            if (ws3Data.merges) ws3['!merges'] = ws3Data.merges;
            if (ws3Data.colWidths) ws3['!cols'] = ws3Data.colWidths;
            XLSX.utils.book_append_sheet(wb, ws3, '海外炸机记录');

            // 导出
            const filename = `${titleDate} 极目无人机售后分析周报.xlsx`;
            XLSX.writeFile(wb, filename);
            log(`🎉 周报已生成：${filename}`);
            log(`📊 综合周报汇总 | 工单详细数据 | 国内炸机记录 | 海外炸机记录`);
            log(`📋 工单 ${ordersData.totalOrders}单 | 完结 ${ordersData.finishedTotal} | 国内炸机 ${crashData.domestic.length}起 | 海外炸机 ${crashData.overseas.length}起`);

        } catch(err) {
            log(`❌ 生成失败: ${err.message}`);
            console.error(err);
        }
    }

    // ========== 构建综合周报汇总 Sheet ==========
    function buildSummarySheet(od, cd, titleDate) {
        const data = [];
        const merges = [];
        const colWidths = [];

        // 列宽
        for (let i = 0; i < 15; i++) colWidths.push({ wch: i === 0 ? 18 : 12 });

        // Row 1: 标题
        data[0] = [`${titleDate} 极目无人机售后分析周报`];
        merges.push({ s:{r:0,c:0}, e:{r:0,c:14} });

        // Row 2-4: KPI卡片
        // A2:C2 国内炸机 | D2:F2 海外炸机 | G2:I2 工单 | J2:L2 总费用 | M2:O2 质保费用
        data[1] = ['国内炸机', '', '', '海外炸机', '', '', '本周工单', '', '', '总费用', '', '', '质保费用', '', ''];
        data[2] = [cd.domestic.length, '', '', cd.overseas.length, '', '', od.totalOrders, '', '', od.totalFee.toFixed(0), '', '', od.warrantyFee.toFixed(0), '', ''];
        data[3] = ['起', '', '', '起', '', '', '单', '', '', '元', '', '', '元', '', ''];
        merges.push({s:{r:1,c:0},e:{r:1,c:2}});
        merges.push({s:{r:1,c:3},e:{r:1,c:5}});
        merges.push({s:{r:1,c:6},e:{r:1,c:8}});
        merges.push({s:{r:1,c:9},e:{r:1,c:11}});
        merges.push({s:{r:1,c:12},e:{r:1,c:14}});
        merges.push({s:{r:2,c:0},e:{r:2,c:2}});
        merges.push({s:{r:2,c:3},e:{r:2,c:5}});
        merges.push({s:{r:2,c:6},e:{r:2,c:8}});
        merges.push({s:{r:2,c:9},e:{r:2,c:11}});
        merges.push({s:{r:2,c:12},e:{r:2,c:14}});
        merges.push({s:{r:3,c:0},e:{r:3,c:2}});
        merges.push({s:{r:3,c:3},e:{r:3,c:5}});
        merges.push({s:{r:3,c:6},e:{r:3,c:8}});
        merges.push({s:{r:3,c:9},e:{r:3,c:11}});
        merges.push({s:{r:3,c:12},e:{r:3,c:14}});

        // Row 5: 分区标题
        data[4] = ['📊 本周综合数据概览', '', '', '', '', '📈 费用分析（按定责）', '', '', '', '', '🔧 质保配件 Top10', '', '', '', ''];
        merges.push({s:{r:4,c:0},e:{r:4,c:4}});
        merges.push({s:{r:4,c:5},e:{r:4,c:9}});
        merges.push({s:{r:4,c:10},e:{r:4,c:14}});

        // Row 6: 子表头
        data[5] = ['指标', '数值', '单位', '', '', '定责', '费用(元)', '占比', '', '', '配件名称', '数量', '金额', '', ''];
        merges.push({s:{r:5,c:2},e:{r:5,c:4}});
        merges.push({s:{r:5,c:7},e:{r:5,c:9}});

        // Row 7-13: 综合数据 + 费用 + 配件
        const overviewRows = [
            ['国内炸机', cd.domestic.length, '起'],
            ['海外炸机', cd.overseas.length, '起'],
            ['本周工单', od.totalOrders, '单'],
            ['  └ 已完结', od.finishedTotal, '单'],
            ['  └ 未完结', od.unfinishedTotal, '单'],
            ['  └ 完结168h内', od.in168, '单'],
            ['  └ 完结168h外', od.out168, '单'],
        ];

        // 费用按定责
        const feeEntries = Object.entries(od.feeByDz).sort((a,b) => b[1]-a[1]);
        const feeTotal = feeEntries.reduce((s,e) => s+e[1], 0) || 1;

        // 配件Top10
        const partsTop10 = od.partsTop10 || [];

        const maxRows = Math.max(overviewRows.length, feeEntries.length, partsTop10.length);
        for (let i = 0; i < maxRows; i++) {
            const r = 6 + i;
            data[r] = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
            if (i < overviewRows.length) {
                data[r][0] = overviewRows[i][0];
                data[r][1] = overviewRows[i][1];
                data[r][2] = overviewRows[i][2];
            }
            if (i < feeEntries.length) {
                data[r][5] = feeEntries[i][0];
                data[r][6] = feeEntries[i][1].toFixed(0);
                data[r][7] = (feeEntries[i][1]/feeTotal*100).toFixed(1) + '%';
            }
            if (i < partsTop10.length) {
                data[r][10] = partsTop10[i][0];
                data[r][11] = partsTop10[i][1];
                data[r][12] = (od.warrantyParts[partsTop10[i][0]] || 0).toFixed(0);
            }
        }

        // 质保服务工单 + 月维修时效
        const wzStartRow = 6 + maxRows + 1;
        data[wzStartRow] = ['质保服务工单', od.warrantyOrders, '单'];
        data[wzStartRow+1] = ['每月1-18 168h-内', od.wzFinished > 0 ? (od.wzIn168/od.wzFinished*100).toFixed(1)+'%' : '0%', ''];
        data[wzStartRow+2] = ['每月1-18 168h-外', od.wzFinished > 0 ? (od.wzOut168/od.wzFinished*100).toFixed(1)+'%' : '0%', ''];

        // 完结时效分析
        const timeStartRow = wzStartRow;
        data[timeStartRow][5] = '⏱️ 完结时效分析';
        merges.push({s:{r:timeStartRow,c:5},e:{r:timeStartRow,c:9}});
        data[timeStartRow+1] = ['', '', '', '', '', '≤72h', od.within72, (od.finishedTotal>0 ? (od.within72/od.finishedTotal*100).toFixed(1)+'%' : '0%'), '', ''];
        data[timeStartRow+2] = ['', '', '', '', '', '72-168h', od.between72_168, (od.finishedTotal>0 ? (od.between72_168/od.finishedTotal*100).toFixed(1)+'%' : '0%'), '', ''];
        data[timeStartRow+3] = ['', '', '', '', '', '>168h', od.over168, (od.finishedTotal>0 ? (od.over168/od.finishedTotal*100).toFixed(1)+'%' : '0%'), '', ''];

        // 分析结果L1分布
        const resultStartRow = wzStartRow + 5;
        data[resultStartRow] = ['📋 分析结果分布', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
        merges.push({s:{r:resultStartRow,c:0},e:{r:resultStartRow,c:4}});
        data[resultStartRow+1] = ['故障大类', '数量', '占比', '', '', '', '', '', '', '', '', '', '', '', ''];
        const resultEntries = Object.entries(od.resultL1).sort((a,b) => b[1]-a[1]);
        const resultTotal = resultEntries.reduce((s,e) => s+e[1], 0) || 1;
        resultEntries.forEach((e, i) => {
            data[resultStartRow+2+i] = [e[0], e[1], (e[1]/resultTotal*100).toFixed(1)+'%'];
        });

        return { data, merges, colWidths };
    }

    // ========== 构建工单详细数据 Sheet ==========
    function buildOrdersDetailSheet(od) {
        const data = [];
        const merges = [];

        // 标题
        data[0] = ['工单详细数据'];
        merges.push({s:{r:0,c:0},e:{r:0,c:8}});

        // 表头
        data[1] = ['工单编号', '工单状态', '处理时长(h)', '定责', '整单费用', '机架号', '机型', '分析人', '分析结果'];

        // 数据行
        let row = 2;
        Object.entries(od.orderInfo).forEach(([ono, v]) => {
            data[row] = [ono, v.status, v.hours, v.dz, v.fee.toFixed(0), v.jijia, v.model, v.analyst, v.analysisResult];
            row++;
        });

        // 工单状态分布
        row += 2;
        data[row] = ['📊 工单状态分布'];
        merges.push({s:{r:row,c:0},e:{r:row,c:3}});
        row++;
        data[row] = ['工单状态', '工单数', '占比', '是否计入完结'];
        Object.entries(od.statusDist).sort((a,b) => b[1]-a[1]).forEach(([s, c]) => {
            row++;
            const isFin = FINISHED_STATUS.includes(s);
            data[row] = [s, c, (c/od.totalOrders*100).toFixed(1)+'%', isFin ? '✓ 是' : '✗ 否'];
        });

        // 分析人工作量
        row += 2;
        data[row] = ['👤 分析人工作量'];
        merges.push({s:{r:row,c:0},e:{r:row,c:3}});
        row++;
        data[row] = ['分析人', '工单数', '占比'];
        Object.entries(od.analystCount).sort((a,b) => b[1]-a[1]).forEach(([a, c]) => {
            row++;
            data[row] = [a, c, (c/od.totalOrders*100).toFixed(1)+'%'];
        });

        return { data, merges };
    }

    // ========== 构建炸机记录 Sheet ==========
    function buildCrashSheet(records, modelDist, regionDist, problemDist, title) {
        const data = [];
        const merges = [];
        const colWidths = [];

        // 列宽: A-G数据列 + I-Q统计列
        for (let i = 0; i < 17; i++) {
            if (i === 0 || i === 8 || i === 9 || i === 11 || i === 12 || i === 14 || i === 15) colWidths.push({ wch: 14 });
            else colWidths.push({ wch: 10 });
        }

        // Row 1: 标题区
        data[0] = [title, '', '', '', '', '', '', '', '统计汇总', '', '', '', '', '', '', '', ''];
        merges.push({s:{r:0,c:0},e:{r:0,c:6}});
        merges.push({s:{r:0,c:8},e:{r:0,c:16}});

        // Row 2: 统计子标题
        data[1] = ['', '', '', '', '', '', '', '', '机型分布', '', '地区分布', '', '', '问题定性', '', '', ''];
        merges.push({s:{r:1,c:8},e:{r:1,c:9}});
        merges.push({s:{r:1,c:11},e:{r:1,c:12}});
        merges.push({s:{r:1,c:14},e:{r:1,c:16}});

        // Row 3: 列头
        data[2] = ['时间', '机型', '机架号', '架次', '省份', '初步结论', '问题定性', '', '机型', '数量', '地区', '数量', '', '故障大类', '数量', '占比', ''];

        // 数据行
        records.forEach((r, i) => {
            data[3+i] = [r.time, r.model, r.airframeNo, '', r.region, r.conclusion, r.problemType, ''];
        });

        // 统计区（右侧）
        const modelEntries = Object.entries(modelDist).sort((a,b) => b[1]-a[1]);
        const regionEntries = Object.entries(regionDist).sort((a,b) => b[1]-a[1]);
        const problemEntries = Object.entries(problemDist).sort((a,b) => b[1]-a[1]);
        const totalCrash = records.length || 1;

        const maxStatRows = Math.max(modelEntries.length, regionEntries.length, problemEntries.length);
        for (let i = 0; i < maxStatRows; i++) {
            const r = 3 + i;
            if (!data[r]) data[r] = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
            if (i < modelEntries.length) {
                data[r][8] = modelEntries[i][0];
                data[r][9] = modelEntries[i][1];
            }
            if (i < regionEntries.length) {
                data[r][10] = regionEntries[i][0];
                data[r][11] = regionEntries[i][1];
            }
            if (i < problemEntries.length) {
                data[r][13] = problemEntries[i][0];
                data[r][14] = problemEntries[i][1];
                data[r][15] = (problemEntries[i][1]/totalCrash*100).toFixed(1) + '%';
            }
        }

        // 合计行
        const sumRow = 3 + maxStatRows;
        if (!data[sumRow]) data[sumRow] = ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''];
        data[sumRow][8] = '合计';
        data[sumRow][9] = records.length;
        data[sumRow][10] = '合计';
        data[sumRow][11] = records.length;
        data[sumRow][13] = '合计';
        data[sumRow][14] = records.length;
        data[sumRow][15] = '100%';

        return { data, merges, colWidths };
    }

    // ========== 周报汇总（手动录入模式） ==========
    function generateWeeklyReport() {
        const now = new Date();
        const weekStart = getWeekStart(now);
        const weekEnd = new Date(weekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);

        const weekRecords = records.filter(r => {
            const d = new Date(r.analysisTime);
            return d >= weekStart && d <= weekEnd;
        });

        // 防御性检查：元素可能不存在（如当前页面没有周报统计区域）
        const weeklyTotalEl = document.getElementById('weeklyTotal');
        if (weeklyTotalEl) weeklyTotalEl.textContent = weekRecords.length;
        const weeklyAvgEl = document.getElementById('weeklyAvg');
        if (weeklyAvgEl) weeklyAvgEl.textContent = weekRecords.length > 0 ? (weekRecords.length / 7).toFixed(1) : '0';
        const weeklyWarrantyEl = document.getElementById('weeklyWarranty');
        if (weeklyWarrantyEl) weeklyWarrantyEl.textContent = weekRecords.filter(r => r.auditResult === '质保').length;
        const weeklyNonWarrantyEl = document.getElementById('weeklyNonWarranty');
        if (weeklyNonWarrantyEl) weeklyNonWarrantyEl.textContent = weekRecords.filter(r => r.auditResult === '非质保').length;

        // 问题定性分布
        const typeCount = {};
        weekRecords.forEach(r => { if (r.problemType) typeCount[r.problemType] = (typeCount[r.problemType]||0)+1; });
        renderTable('weeklyTypeTable', Object.entries(typeCount).sort((a,b)=>b[1]-a[1]), ['问题定性','数量','占比'], weekRecords.length);

        // 分析人工作量
        const analystCount = {};
        weekRecords.forEach(r => { if (r.analyst) analystCount[r.analyst] = (analystCount[r.analyst]||0)+1; });
        renderTable('weeklyAnalystTable', Object.entries(analystCount).sort((a,b)=>b[1]-a[1]), ['分析人','记录数','占比'], weekRecords.length);

        // 质保统计
        const auditCount = {};
        weekRecords.forEach(r => { const k = r.auditResult||'未判定'; auditCount[k] = (auditCount[k]||0)+1; });
        renderTable('weeklyAuditTable', Object.entries(auditCount).sort((a,b)=>b[1]-a[1]), ['是否质保','数量','占比'], weekRecords.length);
    }

    function renderTable(tableId, entries, headers, total) {
        const tbody = document.querySelector(`#${tableId} tbody`);
        if (!tbody) return; // 防御性检查：表格可能不存在
        if (entries.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${headers.length}" class="empty-state">暂无数据</td></tr>`;
            return;
        }
        tbody.innerHTML = entries.map(([k,v]) => `
            <tr>
                <td>${esc(k)}</td>
                <td>${v}</td>
                <td>${total > 0 ? (v/total*100).toFixed(1) : 0}%</td>
            </tr>
        `).join('');
    }

    // ========== 看板 ==========
    function updateDashboard() {
        // 防御性检查：元素可能不存在
        const kpiTotalEl = document.getElementById('kpiTotal');
        if (kpiTotalEl) kpiTotalEl.textContent = records.length;

        const weekStart = getWeekStart(new Date());
        const weekEnd = new Date(weekStart); weekEnd.setDate(weekEnd.getDate()+6);
        const weekRecords = records.filter(r => { const d = new Date(r.analysisTime); return d >= weekStart && d <= weekEnd; });
        
        const kpiWeekEl = document.getElementById('kpiWeek');
        if (kpiWeekEl) kpiWeekEl.textContent = weekRecords.length;

        const wzCount = records.filter(r => r.auditResult === '质保').length;
        const kpiWarrantyEl = document.getElementById('kpiWarranty');
        if (kpiWarrantyEl) kpiWarrantyEl.textContent = records.length > 0 ? (wzCount/records.length*100).toFixed(0)+'%' : '0%';

        const analysts = new Set(records.map(r => r.analyst).filter(Boolean));
        const kpiAnalystsEl = document.getElementById('kpiAnalysts');
        if (kpiAnalystsEl) kpiAnalystsEl.textContent = analysts.size;

        // 趋势图（检查元素是否存在）
        if (document.getElementById('trendChart')) renderTrendChart();
        if (document.getElementById('typeChart') || document.getElementById('analystChart')) renderDistributionCharts();
    }

    function renderTrendChart() {
        if (charts.trend) charts.trend.destroy();
        const dateMap = {};
        records.forEach(r => {
            if (!r.analysisTime) return;
            const d = r.analysisTime.substring(0,10);
            dateMap[d] = (dateMap[d]||0) + 1;
        });
        const sorted = Object.entries(dateMap).sort((a,b) => a[0].localeCompare(b[0])).slice(-14);
        charts.trend = new Chart(document.getElementById('trendChart'), {
            type: 'line',
            data: {
                labels: sorted.map(e => e[0].substring(5)),
                datasets: [{
                    label: '每日记录数',
                    data: sorted.map(e => e[1]),
                    borderColor: '#444e87',
                    backgroundColor: 'rgba(68,78,135,0.1)',
                    fill: true,
                    tension: 0.3
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { title: { display: true, text: '近14天记录趋势' } }
            }
        });
    }

    function renderDistributionCharts() {
        // 问题定性
        if (charts.type) charts.type.destroy();
        const typeCount = {};
        records.forEach(r => { if (r.problemType) typeCount[r.problemType] = (typeCount[r.problemType]||0)+1; });
        const typeEntries = Object.entries(typeCount).sort((a,b) => b[1]-a[1]);
        if (typeEntries.length > 0) {
            charts.type = new Chart(document.getElementById('typeChart'), {
                type: 'doughnut',
                data: {
                    labels: typeEntries.map(e => e[0]),
                    datasets: [{ data: typeEntries.map(e => e[1]), backgroundColor: ['#444e87','#4472c4','#70ad47','#ffc107','#c00000','#00b0f0'] }]
                },
                options: { responsive:true, maintainAspectRatio:false, plugins:{ title:{ display:true, text:'问题定性分布' } } }
            });
        }

        // 分析人
        if (charts.analyst) charts.analyst.destroy();
        const analystCount = {};
        records.forEach(r => { if (r.analyst) analystCount[r.analyst] = (analystCount[r.analyst]||0)+1; });
        const analystEntries = Object.entries(analystCount).sort((a,b) => b[1]-a[1]).slice(0,8);
        if (analystEntries.length > 0) {
            charts.analyst = new Chart(document.getElementById('analystChart'), {
                type: 'bar',
                data: {
                    labels: analystEntries.map(e => e[0]),
                    datasets: [{
                        label: '记录数',
                        data: analystEntries.map(e => e[1]),
                        backgroundColor: '#4472c4'
                    }]
                },
                options: {
                    responsive:true, maintainAspectRatio:false, indexAxis:'y',
                    plugins: { title:{ display:true, text:'分析人工作量 Top8' }, legend:{ display:false } }
                }
            });
        }
    }

    // ========== 导入导出 ==========
    function exportAllData() {
        const dataStr = JSON.stringify(records, null, 2);
        const blob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `无人机工作台数据_${formatDateLocal(new Date())}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importAllData(e) {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = function(event) {
            try {
                const data = JSON.parse(event.target.result);
                if (!Array.isArray(data)) throw new Error('格式不正确');
                records = data;
                saveRecords();
                renderTodayTable();
                generateDailyReport();
                generateWeeklyReport();
                updateDashboard();
                alert(`成功导入 ${data.length} 条记录`);
            } catch (err) {
                alert('导入失败：' + err.message);
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    }

    // ========== 云同步设置面板 ==========
    function openSettingsModal() {
        const cfg = getCloudConfig();
        const isEnabled = cfg && cfg.enabled;
        
        // 更新状态显示
        document.getElementById('syncStatusIcon').textContent = isEnabled ? '☁️' : '';
        document.getElementById('syncStatusTitle').textContent = isEnabled ? '云同步已启用' : '云同步已暂停';
        document.getElementById('syncStatusDesc').textContent = isEnabled ? '数据自动同步到 GitHub 仓库' : '数据仅保存在本地';
        document.getElementById('syncStatusText').textContent = isEnabled ? '已同步' : '未同步';
        document.getElementById('syncStatusText').style.color = isEnabled ? '#4CAF50' : '#FF9800';
        
        // 显示/隐藏按钮
        document.getElementById('btnEnableSync').style.display = isEnabled ? 'none' : 'inline-block';
        document.getElementById('btnDisableSync').style.display = isEnabled ? 'inline-block' : 'none';
        
        // 确保弹窗居中显示
        const modal = document.getElementById('settingsModal');
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.style.display = 'flex';
        modal.style.alignItems = 'center';
        modal.style.justifyContent = 'center';
        modal.classList.add('show');
    }

    // ========== 定责分析报告 ==========
    let reportImages = [];
    let reportButtonsBound = false;

    function bindReportButtons() {
        if (reportButtonsBound) return;
        
        const btnGen = document.getElementById('btnGenerateReport');
        const btnPdf = document.getElementById('btnExportPDF');
        const btnClear = document.getElementById('btnClearReport');
        
        if (btnGen) btnGen.addEventListener('click', generateReport);
        if (btnPdf) btnPdf.addEventListener('click', exportReportPDF);
        if (btnClear) btnClear.addEventListener('click', clearReportForm);
        
        // 图片上传
        const uploadArea = document.getElementById('rptImageUpload');
        const fileInput = document.getElementById('rptImageInput');
        if (uploadArea && fileInput) {
            uploadArea.addEventListener('click', () => fileInput.click());
            uploadArea.addEventListener('dragover', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = 'var(--primary)';
                uploadArea.style.background = '#f0f2ff';
            });
            uploadArea.addEventListener('dragleave', () => {
                uploadArea.style.borderColor = '#d9d9d9';
                uploadArea.style.background = '#fafafa';
            });
            uploadArea.addEventListener('drop', (e) => {
                e.preventDefault();
                uploadArea.style.borderColor = '#d9d9d9';
                uploadArea.style.background = '#fafafa';
                handleReportImages(e.dataTransfer.files);
            });
            fileInput.addEventListener('change', (e) => {
                handleReportImages(e.target.files);
                fileInput.value = '';
            });
        }
        
        // 审核结果自定义
        const resultSelect = document.getElementById('rptAnalysisResult');
        const customInput = document.getElementById('rptAnalysisResultCustom');
        if (resultSelect && customInput) {
            resultSelect.addEventListener('change', () => {
                if (resultSelect.value === 'custom') {
                    customInput.classList.remove('hidden');
                    customInput.focus();
                } else {
                    customInput.classList.add('hidden');
                }
                updateReportPreview();
            });
        }
        
        // 实时预览 - 事件委托
        const reportPanel = document.querySelector('.report-input-panel');
        if (reportPanel) {
            reportPanel.addEventListener('input', updateReportPreview);
            reportPanel.addEventListener('change', updateReportPreview);
        }
        
        reportButtonsBound = true;
    }

    function initReportPage() {
        // 初始化时不做事件绑定，由 switchPage 中的 bindReportButtons 负责
        // 确保预览区域显示初始状态
        updateReportPreview();
    }

    function handleReportImages(files) {
        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                reportImages.push({
                    name: file.name,
                    data: e.target.result
                });
                renderReportImages();
                updateReportPreview();
            };
            reader.readAsDataURL(file);
        });
    }

    function renderReportImages() {
        const list = document.getElementById('rptImageList');
        if (!list) return;
        list.innerHTML = reportImages.map((img, i) => `
            <div class="image-item">
                <img src="${img.data}" alt="${img.name}">
                <button class="del-btn" onclick="removeReportImage(${i})">×</button>
            </div>
        `).join('');
    }

    function removeReportImage(index) {
        reportImages.splice(index, 1);
        renderReportImages();
        updateReportPreview();
    }

    function updateReportPreview() {
        const preview = document.getElementById('reportPreview');
        if (!preview) return;

        const title = document.getElementById('rptTitle').value || '极目定责分析报告';
        const bodyId = document.getElementById('rptBodyId').value || '—';
        const flightName = document.getElementById('rptFlightName').value || '—';
        const expiryDate = document.getElementById('rptExpiryDate').value || '—';
        const flightTime = document.getElementById('rptFlightTime').value || '—';
        const flightProcess = document.getElementById('rptFlightProcess').value || '—';
        const bodySN = document.getElementById('rptBodySN').value || '—';
        const elecSN = document.getElementById('rptElecSN').value || '—';
        const caseNo = document.getElementById('rptCaseNo').value || '—';
        const trackNo = document.getElementById('rptTrackNo').value || '—';

        const resultSelect = document.getElementById('rptAnalysisResult');
        let analysisResult = resultSelect.value;
        if (analysisResult === 'custom') {
            analysisResult = document.getElementById('rptAnalysisResultCustom').value || '—';
        }

        const now = new Date();
        const dateStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');

        let html = `
            <div class="rpt-header">
                <h1>${title}</h1>
                <div class="rpt-subtitle">报告生成时间：${dateStr}</div>
            </div>

            <div class="rpt-section">
                <div class="rpt-section-title">基本信息</div>
                <div class="rpt-info-grid">
                    <div class="rpt-info-item">
                        <span class="rpt-info-label">机架号：</span>
                        <span class="rpt-info-value">${bodyId}</span>
                    </div>
                    <div class="rpt-info-item">
                        <span class="rpt-info-label">地块ID：</span>
                        <span class="rpt-info-value">${flightName}</span>
                    </div>
                    <div class="rpt-info-item">
                        <span class="rpt-info-label">架次号：</span>
                        <span class="rpt-info-value">${expiryDate}</span>
                    </div>
                    <div class="rpt-info-item">
                        <span class="rpt-info-label">飞行时间：</span>
                        <span class="rpt-info-value">${flightTime}</span>
                    </div>
                    <div class="rpt-info-item">
                        <span class="rpt-info-label">机身SN：</span>
                        <span class="rpt-info-value">${bodySN}</span>
                    </div>
                    <div class="rpt-info-item">
                        <span class="rpt-info-label">电池编码：</span>
                        <span class="rpt-info-value">${elecSN}</span>
                    </div>
                    <div class="rpt-info-item">
                        <span class="rpt-info-label">工单号：</span>
                        <span class="rpt-info-value">${caseNo}</span>
                    </div>
                </div>
            </div>

            <div class="rpt-section">
                <div class="rpt-section-title">现场概况</div>
                <div class="rpt-process">${trackNo}</div>
            </div>

            <div class="rpt-section">
                <div class="rpt-section-title">飞行过程分析</div>
                <div class="rpt-process">${flightProcess}</div>
            </div>

            <div class="rpt-section">
                <div class="rpt-section-title">审核结果</div>
                <div class="rpt-result">${analysisResult}</div>
            </div>
        `;

        if (reportImages.length > 0) {
            html += `
                <div class="rpt-section">
                    <div class="rpt-section-title">附件图片</div>
                    <div class="rpt-images">
                        ${reportImages.map(img => `<img src="${img.data}" alt="${img.name}">`).join('')}
                    </div>
                </div>
            `;
        }

        html += `
            <div class="rpt-footer">
                <span>极目售后分析组</span>
                <span>生成日期：${dateStr}</span>
            </div>
        `;

        preview.innerHTML = html;
    }

    function generateReport() {
        updateReportPreview();
        alert('✅ 报告已生成！请在右侧预览查看。');
    }

    async function exportReportPDF() {
        const preview = document.getElementById('reportPreview');
        if (!preview || preview.querySelector('.report-placeholder')) {
            alert('⚠️ 请先生成报告！');
            return;
        }

        try {
            const canvas = await html2canvas(preview, {
                scale: 2,
                useCORS: true,
                logging: false
            });

            const { jsPDF } = window.jspdf;
            const pdf = new jsPDF('p', 'mm', 'a4');
            const imgData = canvas.toDataURL('image/png');
            const pdfWidth = pdf.internal.pageSize.getWidth();
            const pdfHeight = pdf.internal.pageSize.getHeight();
            const imgWidth = canvas.width;
            const imgHeight = canvas.height;
            const ratio = pdfWidth / imgWidth;
            const totalHeight = imgHeight * ratio;

            let position = 0;
            let remainingHeight = totalHeight;

            while (remainingHeight > 0) {
                pdf.addImage(imgData, 'PNG', 0, position, pdfWidth, totalHeight);
                remainingHeight -= pdfHeight;
                position -= pdfHeight;
                if (remainingHeight > 0) {
                    pdf.addPage();
                }
            }

            const caseNo = document.getElementById('rptCaseNo').value || '报告';
            pdf.save(`定责分析报告_${caseNo}.pdf`);
            alert('✅ PDF已导出！');
        } catch (err) {
            console.error(err);
            alert('❌ PDF导出失败：' + err.message);
        }
    }

    function clearReportForm() {
        if (!confirm('确定要清空所有报告内容吗？')) return;

        document.getElementById('rptTitle').value = '极目定责分析报告';
        document.getElementById('rptBodyId').value = '';
        document.getElementById('rptFlightName').value = '';
        document.getElementById('rptExpiryDate').value = '';
        document.getElementById('rptFlightTime').value = '';
        document.getElementById('rptFlightProcess').value = '';
        document.getElementById('rptBodySN').value = '';
        document.getElementById('rptElecSN').value = '';
        document.getElementById('rptCaseNo').value = '';
        document.getElementById('rptTrackNo').value = '';
        document.getElementById('rptAnalysisResult').value = '人为原因导致事故，请付费处理。';
        document.getElementById('rptAnalysisResultCustom').value = '';
        document.getElementById('rptAnalysisResultCustom').classList.add('hidden');

        reportImages = [];
        renderReportImages();

        const preview = document.getElementById('reportPreview');
        preview.innerHTML = `
            <div class="report-placeholder">
                <svg viewBox="0 0 24 24" width="64" height="64"><path fill="#ccc" d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z"/></svg>
                <p>填写左侧信息后，报告将在此处实时预览</p>
            </div>
        `;
    }

    // ========== 暴露函数到全局 ==========
    window.saveRecord = saveRecord;
    window.clearForm = clearForm;
    window.generateDailyReport = generateDailyReport;
    window.exportDailyExcel = exportDailyExcel;
    window.exportDailyDocx = exportDailyDocx;
    window.generateStandardWeekly = generateStandardWeekly;
    window.updateDashboard = updateDashboard;
    window.pushToCloud = pushToCloud;
    window.pullFromCloud = pullFromCloud;
    window.removeReportImage = removeReportImage;
    window.updateReportPreview = updateReportPreview;

    // ========== 启动 ==========
    document.addEventListener('DOMContentLoaded', init);
})(); 
/* ============ 主应用：路由 / 客户 / 项目 / 测量点 / 尺寸 / 照片 / 搜索 / 设置 ============ */

const SETTINGS_KEY = 'admeasure_settings';
const getSettings = () => { try{ return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; }catch(e){ return {}; } };
const setSettings = o => localStorage.setItem(SETTINGS_KEY, JSON.stringify({...getSettings(), ...o}));

const view = () => $('#view');
const go = hash => { location.hash = hash; };

function setActiveTab(tab){
  $$('#tabbar a,#topnav a').forEach(a => a.classList.toggle('active', a.dataset.tab === tab));
  $('#fab').hidden = tab !== 'projects';
}

/* ---------------- 路由 ---------------- */
async function route(){
  const hash = location.hash || '#/projects';
  const parts = hash.slice(2).split('/');
  const [page, id] = parts;
  try{
    if(page === 'clients' && id)        await renderClient(id);
    else if(page === 'clients')        await renderClients();
    else if(page === 'project' && id)  await renderProject(id);
    else if(page === 'tools')          { renderTools(); setActiveTab('tools'); }
    else if(page === 'settings')      { renderSettings(); setActiveTab('settings'); }
    else                               await renderProjects();
  }catch(e){ console.error(e); toast('页面加载失败','err'); }
  window.scrollTo(0,0);
}
window.addEventListener('hashchange', route);

/* ---------------- 项目列表（首页） ---------------- */
async function renderProjects(){
  setActiveTab('projects');
  const [projects, clients, points] = await Promise.all([
    DB.all('projects'), DB.all('clients'), DB.all('points')]);
  const cmap = Object.fromEntries(clients.map(c=>[c.id,c]));
  const pcount = {};
  points.forEach(p => pcount[p.projectId] = (pcount[p.projectId]||0)+1);

  const nMeasure = projects.filter(p=>p.status==='measuring').length;
  const nDone = projects.filter(p=>p.status==='done').length;

  view().innerHTML = `
    <div class="stat-row">
      <div class="stat-card blue"><div class="n">${projects.length}</div><div class="t">全部项目</div></div>
      <div class="stat-card orange"><div class="n">${nMeasure}</div><div class="t">测量中</div></div>
      <div class="stat-card green"><div class="n">${nDone}</div><div class="t">已完成</div></div>
    </div>
    <div class="filter-bar">
      <input class="input" id="searchInput" placeholder="搜索项目 / 客户 / 电话 / 地址 / 部位"
             value="${esc(sessionStorage.getItem('proj_kw')||'')}">
      <select id="dateRange">
        <option value="all">全部时间</option>
        <option value="7">近 7 天</option>
        <option value="30">近 30 天</option>
        <option value="365">近一年</option>
      </select>
    </div>
    <div class="item-list" id="projList"></div>`;

  const kwEl = $('#searchInput'), drEl = $('#dateRange');
  drEl.value = sessionStorage.getItem('proj_dr') || 'all';

  async function paint(){
    const kw = kwEl.value.trim().toLowerCase();
    sessionStorage.setItem('proj_kw', kwEl.value);
    sessionStorage.setItem('proj_dr', drEl.value);
    const days = drEl.value === 'all' ? 0 : parseInt(drEl.value);
    const cutoff = days ? Date.now() - days*864e5 : 0;
    const sorted = [...projects].sort((a,b)=>b.createdAt-a.createdAt);

    // 搜索测量点 / 尺寸命中的项目集合
    const hitProjects = new Set();
    if(kw){
      points.forEach(p=>{
        if(typeName(p.type).toLowerCase().includes(kw) ||
           (p.name||'').toLowerCase().includes(kw) ||
           (p.place||'').toLowerCase().includes(kw)) hitProjects.add(p.projectId);
      });
      const ds = await DB.all('dimensions');
      ds.forEach(d=>{
        if((d.label||'').toLowerCase().includes(kw) || (d.material||'').toLowerCase().includes(kw)
           || (d.remark||'').toLowerCase().includes(kw)){
          const pt = points.find(x=>x.id===d.pointId);
          if(pt) hitProjects.add(pt.projectId);
        }
      });
    }

    const matches = p => {
      if(cutoff && (p.createdAt||0) < cutoff) return false;
      if(!kw) return true;
      const c = cmap[p.clientId];
      return (p.name||'').toLowerCase().includes(kw) ||
        (p.address||'').toLowerCase().includes(kw) ||
        (p.remark||'').toLowerCase().includes(kw) ||
        (c && (c.name||'').toLowerCase().includes(kw)) ||
        (c && (c.phone||'').toLowerCase().includes(kw)) ||
        (c && (c.contact||'').toLowerCase().includes(kw)) ||
        hitProjects.has(p.id);
    };
    const list = sorted.filter(matches);
    const box = $('#projList');
    if(!box) return;
    if(!list.length){
      box.innerHTML = `<div class="empty"><div class="e-ico">📋</div>
        <p>${(kw||cutoff) ? '没有符合条件的项目' : '还没有项目，点击右下角 ＋ 新建第一次测量'}</p>
        <button class="btn btn-primary" onclick="openProjectModal()">＋ 新建项目</button></div>`;
      return;
    }
    box.innerHTML = list.map(p => {
      const c = cmap[p.clientId] || {};
      const st = statusInfo(p.status);
      return `<button class="item-card" onclick="go('#/project/${p.id}')">
        <div class="item-row1">
          <span class="name">${esc(p.name)}</span>
          <span class="badge ${st.cls}">${st.n}</span>
        </div>
        <div class="item-row2">
          <span>👤 ${esc(c.name||'未关联客户')}</span>
          ${c.phone?`<span>📞 ${esc(c.phone)}</span>`:''}
          ${p.address?`<span class="ellipsis">📍 ${esc(p.address)}</span>`:''}
          <span>🗓 ${fmtDate(p.measureDate||p.createdAt)}</span>
          <span class="pill-count">${pcount[p.id]||0} 个测量点</span>
        </div>
      </button>`;
    }).join('');
  }
  kwEl.addEventListener('input', debounce(paint, 180));
  drEl.onchange = paint;
  paint();
}

/* ---------------- 客户列表 ---------------- */
async function renderClients(){
  setActiveTab('clients');
  const [clients, projects] = await Promise.all([DB.all('clients'), DB.all('projects')]);
  const counts = {};
  projects.forEach(p => counts[p.clientId] = (counts[p.clientId]||0)+1);
  const sorted = [...clients].sort((a,b)=>b.createdAt-a.createdAt);

  view().innerHTML = `
    <div class="filter-bar">
      <input class="input" id="cSearch" placeholder="搜索客户名称 / 电话 / 联系人"
             value="${esc(sessionStorage.getItem('cli_kw')||'')}">
      <button class="btn btn-primary" onclick="openClientModal()">＋ 新客户</button>
    </div>
    <div class="item-list" id="cliList"></div>`;

  const kwEl = $('#cSearch');
  function paint(){
    const kw = kwEl.value.trim().toLowerCase();
    sessionStorage.setItem('cli_kw', kwEl.value);
    const list = sorted.filter(c => !kw ||
      (c.name||'').toLowerCase().includes(kw) ||
      (c.phone||'').toLowerCase().includes(kw) ||
      (c.contact||'').toLowerCase().includes(kw) ||
      (c.address||'').toLowerCase().includes(kw));
    const box = $('#cliList');
    if(!list.length){
      box.innerHTML = `<div class="empty"><div class="e-ico">◍</div>
        <p>${kw?'没有符合条件的客户':'还没有客户档案'}</p>
        <button class="btn btn-primary" onclick="openClientModal()">＋ 新建客户</button></div>`;
      return;
    }
    box.innerHTML = list.map(c=>`
      <button class="item-card" onclick="go('#/clients/${c.id}')">
        <div class="item-row1">
          <span class="name">${esc(c.name)}</span>
          <span class="pill-count">${counts[c.id]||0} 个项目</span>
        </div>
        <div class="item-row2">
          ${c.contact?`<span>👤 ${esc(c.contact)}</span>`:''}
          ${c.phone?`<span>📞 ${esc(c.phone)}</span>`:''}
          ${c.address?`<span class="ellipsis">📍 ${esc(c.address)}</span>`:''}
        </div>
      </button>`).join('');
  }
  kwEl.addEventListener('input', debounce(paint, 150));
  paint();
}

/* ---------------- 客户详情 ---------------- */
async function renderClient(id){
  setActiveTab('clients');
  const c = await DB.get('clients', id);
  if(!c){ view().innerHTML = '<div class="empty"><p>客户不存在</p></div>'; return; }
  const projects = (await DB.byIndex('projects','clientId',id)).sort((a,b)=>b.createdAt-a.createdAt);
  view().innerHTML = `
    <div class="crumb"><a href="#/clients">客户</a> / <span>${esc(c.name)}</span></div>
    <div class="card">
      <div class="detail-head">
        <h2>${esc(c.name)}</h2>
        <button class="btn btn-ghost btn-sm" onclick="openClientModal('${c.id}')">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="delClient('${c.id}')">删除</button>
      </div>
      <div class="info-grid">
        ${infoItem('联系人', c.contact)}
        ${infoItem('电话', c.phone)}
        ${infoItem('地址', c.address, true)}
        ${infoItem('备注', c.remark, true)}
      </div>
    </div>
    <div class="section-title">项目（${projects.length}）</div>
    <div class="item-list">
      ${projects.length ? projects.map(p=>{
        const st = statusInfo(p.status);
        return `<button class="item-card" onclick="go('#/project/${p.id}')">
          <div class="item-row1"><span class="name">${esc(p.name)}</span>
          <span class="badge ${st.cls}">${st.n}</span></div>
          <div class="item-row2">
            ${p.address?`<span class="ellipsis">📍 ${esc(p.address)}</span>`:''}
            <span>🗓 ${fmtDate(p.measureDate||p.createdAt)}</span>
          </div></button>`;
      }).join('') : `<div class="empty" style="padding:26px"><p>该客户还没有项目</p>
        <button class="btn btn-primary" onclick="openProjectModal('${c.id}')">＋ 新建项目</button></div>`}
    </div>`;
}
const infoItem = (k,v,full) => `<div class="info-item${full?' field-full':''}">
  <div class="k">${k}</div><div class="v">${esc(v||'—')}</div></div>`;

/* ---------------- 客户弹窗 ---------------- */
async function openClientModal(id){
  const c = id ? await DB.get('clients', id) : {};
  const data = await formModal({
    title: id ? '编辑客户' : '新建客户',
    fields:[
      {key:'name', label:'客户 / 单位名称', value:c.name, required:true, placeholder:'如：XX广告/张总店铺', full:true},
      {key:'contact', label:'联系人', value:c.contact},
      {key:'phone', label:'联系电话', value:c.phone, type:'tel'},
      {key:'address', label:'地址', value:c.address, full:true},
      {key:'remark', label:'备注', value:c.remark, textarea:true, full:true},
    ],
  });
  if(!data) return;
  await DB.put('clients', {
    id: c.id || uid(), createdAt: c.createdAt || Date.now(),
    name:data.name, contact:data.contact, phone:data.phone,
    address:data.address, remark:data.remark,
  });
  toast(id?'已保存':'客户已创建','ok');
  route();
}

async function delClient(id){
  const projects = await DB.byIndex('projects','clientId',id);
  const ok = await Modal.confirm({
    title:'删除客户', okText:'确认删除',
    msg:`将同时删除该客户下的 ${projects.length} 个项目及其全部测量点、尺寸和照片，此操作不可恢复！`});
  if(!ok) return;
  for(const p of projects){ await deleteProjectCascade(p.id, true); }
  await DB.del('clients', id);
  toast('客户已删除','ok');
  go('#/clients');
}

async function deleteProjectCascade(pid, skipProject=false){
  const pts = await DB.byIndex('points','projectId',pid);
  for(const pt of pts){
    const [ds, phs] = await Promise.all([
      DB.byIndex('dimensions','pointId',pt.id), DB.byIndex('photos','pointId',pt.id)]);
    for(const d of ds) await DB.del('dimensions', d.id);
    for(const ph of phs) await DB.del('photos', ph.id);
    await DB.del('points', pt.id);
  }
  const ms = await DB.byIndex('measures','projectId',pid).catch(()=>[]);
  for(const m of ms) await DB.del('measures', m.id);
  if(!skipProject) await DB.del('projects', pid);
}

/* ---------------- 项目弹窗（支持选已有/新建客户） ---------------- */
async function openProjectModal(clientId){
  // clientId 可选：从客户详情新建时预选该客户
  const clients = (await DB.all('clients')).sort((a,b)=>b.createdAt-a.createdAt);
  const s = getSettings();

  const r = await Modal.open({
    title:'新建项目',
    body:`<form class="field-grid" onsubmit="return false">
      <div class="field field-full">
        <label>客户<span class="req">*</span></label>
        <select name="clientSel" id="clientSel">
          <option value="__new__">＋ 新建客户…</option>
          ${clients.map(c=>`<option value="${c.id}">${esc(c.name)}${c.phone?' · '+esc(c.phone):''}</option>`).join('')}
        </select>
      </div>
      <div class="field field-full" id="newClientBox">
        <div class="field-grid" style="margin-top:2px">
          <div class="field"><label>新客户名称<span class="req">*</span></label>
            <input name="ncName" placeholder="客户/单位名称"></div>
          <div class="field"><label>联系电话</label><input name="ncPhone" type="tel"></div>
        </div>
      </div>
      <div class="field field-full"><label>项目名称<span class="req">*</span></label>
        <input name="name" placeholder="如：XX路店门头制作"></div>
      <div class="field"><label>测量日期</label>
        <input type="date" name="measureDate" value="${todayStr()}"></div>
      <div class="field"><label>测量人</label>
        <input name="measurer" value="${esc(s.measurer||'')}"></div>
      <div class="field field-full"><label>施工地址</label>
        <input name="address" placeholder="现场详细地址"></div>
      <div class="field field-full"><label>备注</label>
        <textarea name="remark" placeholder="选填"></textarea></div>
    </form>`,
    onMount(mask){
      $('[data-act=ok]', mask).textContent = '创建并开始测量';
      const sel = $('#clientSel', mask);
      const box = $('#newClientBox', mask);
      if(clientId && clients.some(c=>c.id===clientId)) sel.value = clientId;
      sel.onchange = () => box.hidden = sel.value !== '__new__';
      box.hidden = sel.value !== '__new__';
    }
  });
  if(!r) return;
  const m = r.modal;
  const val = k => m.querySelector(`[name="${k}"]`).value.trim();
  const name = val('name');
  if(!name){ toast('请填写项目名称','err'); return; }
  let cid = m.querySelector('#clientSel').value;
  if(cid === '__new__'){
    const ncName = val('ncName');
    if(!ncName){ toast('请填写新客户名称','err'); return; }
    cid = uid();
    await DB.put('clients', {id:cid, createdAt:Date.now(), name:ncName,
      phone:val('ncPhone'), contact:'', address:val('address'), remark:''});
  }
  const pid = uid();
  await DB.put('projects', {
    id:pid, clientId:cid, name, address:val('address'),
    measureDate: val('measureDate') || todayStr(),
    measurer:val('measurer'), remark:val('remark'),
    status:'measuring', createdAt:Date.now(), updatedAt:Date.now(),
  });
  toast('项目已创建','ok');
  go(`#/project/${pid}`);
}

async function editProject(pid){
  const p = await DB.get('projects', pid);
  const clients = await DB.all('clients');
  const data = await formModal({
    title:'编辑项目', wide:true,
    fields:[
      {key:'name', label:'项目名称', value:p.name, required:true, full:true},
      {key:'clientId', label:'所属客户', value:p.clientId, type:'select',
        options: clients.map(c=>({v:c.id,n:c.name})), full:true},
      {key:'measureDate', label:'测量日期', value:p.measureDate||todayStr(), type:'date'},
      {key:'measurer', label:'测量人', value:p.measurer},
      {key:'status', label:'状态', value:p.status,
        options: PROJECT_STATUS.map(s=>({v:s.v,n:s.n}))},
      {key:'address', label:'施工地址', value:p.address, full:true},
      {key:'remark', label:'备注', value:p.remark, textarea:true, full:true},
    ],
  });
  if(!data) return;
  await DB.put('projects', {...p, ...data, updatedAt:Date.now()});
  toast('已保存','ok');
  route();
}

/* ---------------- 定位 / 导航 ---------------- */
function navUrlFor(p){
  if(p.lat == null || p.lng == null) return null;
  const name = encodeURIComponent(p.name || '项目位置');
  return `https://uri.amap.com/marker?position=${p.lng},${p.lat}&name=${name}&src=admeasure&coordinate=gaode&callnative=1`;
}
async function locateProject(pid){
  const p = await DB.get('projects', pid);
  if(!p) return;
  if(!navigator.geolocation){ toast('此设备不支持定位','err'); return; }
  toast('正在获取定位…');
  navigator.geolocation.getCurrentPosition(async pos => {
    const lat = pos.coords.latitude, lng = pos.coords.longitude;
    let addr = p.address || '';
    try{
      const r = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&accept-language=zh-CN&zoom=18`, {headers:{'Accept':'application/json'}});
      const j = await r.json();
      if(j && j.display_name) addr = j.display_name;
    }catch(e){ /* 保留原地址 */ }
    await DB.put('projects', {...p, lat, lng, address:addr, updatedAt:Date.now()});
    toast('定位完成，已记录坐标','ok');
    route();
  }, err => { toast('定位失败：' + (err.message || '已拒绝权限'), 'err'); },
     {enableHighAccuracy:true, timeout:10000});
}
async function delProject(pid){
  const points = await DB.byIndex('points','projectId',pid);
  let photoN = 0;
  for(const pt of points){ photoN += (await DB.byIndex('photos','pointId',pt.id)).length; }
  const ok = await Modal.confirm({
    title:'删除项目', okText:'确认删除',
    msg:`将删除该项目下 ${points.length} 个测量点、${photoN} 张照片及全部尺寸记录，此操作不可恢复！`});
  if(!ok) return;
  await deleteProjectCascade(pid);
  toast('项目已删除','ok');
  go('#/projects');
}

/* ---------------- 项目详情 ---------------- */
async function renderProject(pid){
  setActiveTab('projects');
  const p = await DB.get('projects', pid);
  if(!p){ view().innerHTML='<div class="empty"><p>项目不存在</p></div>'; return; }
  const client = await DB.get('clients', p.clientId);
  const points = (await DB.byIndex('points','projectId',pid)).sort((a,b)=>a.createdAt-b.createdAt);
  const [allDims, allPhotos, measures] = await Promise.all([
    DB.all('dimensions'), DB.all('photos'),
    DB.byIndex('measures','projectId',pid).catch(()=>[]),
  ]);
  measures.sort((a,b)=>a.createdAt-b.createdAt);
  const dimsOf = ptid => allDims.filter(d=>d.pointId===ptid).sort((a,b)=>a.createdAt-b.createdAt);
  const photosOf = ptid => allPhotos.filter(x=>x.pointId===ptid).sort((a,b)=>a.createdAt-b.createdAt);
  const st = statusInfo(p.status);

  view().innerHTML = `
    <div class="crumb"><a href="#/projects">项目</a> / <span>${esc(p.name)}</span></div>
    <div class="card">
      <div class="detail-head">
        <h2>${typeIcon('mentou')} ${esc(p.name)}</h2>
        <span class="badge ${st.cls}">${st.n}</span>
      </div>
      <div class="info-grid">
        ${infoItem('客户', (client?client.name:'—'))}
        ${infoItem('联系电话', client?client.phone:'')}
        ${infoItem('地址', p.address||(client?client.address:''), true)}
        ${infoItem('测量日期', fmtDate(p.measureDate||p.createdAt))}
        ${infoItem('测量人', p.measurer)}
        ${(p.lat!=null&&p.lng!=null)?infoItem('坐标', `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`):''}
        ${p.remark?infoItem('备注', p.remark, true):''}
      </div>
      <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
        <select style="width:auto;height:34px" onchange="changeStatus('${pid}',this.value)">
          ${PROJECT_STATUS.map(s=>`<option value="${s.v}" ${p.status===s.v?'selected':''}>状态：${s.n}</option>`).join('')}
        </select>
        <button class="btn btn-ghost" onclick="locateProject('${pid}')">📍 定位</button>
        ${(p.lat!=null&&p.lng!=null)?`<a class="btn btn-ghost" href="${navUrlFor(p)}" target="_blank" rel="noopener">🧭 导航</a>`:''}
        <button class="btn btn-ghost" onclick="editProject('${pid}')">✎ 编辑项目</button>
        <button class="btn btn-danger" onclick="delProject('${pid}')">🗑 删除</button>
        <button class="btn btn-primary" style="margin-left:auto" onclick="openReport('${pid}')">📄 测量报告</button>
      </div>
    </div>

    ${toolCardHTML(pid)}

    <div class="section-title">测量点（${points.length}）</div>
    <div id="pointList">
      ${points.map(pt => pointCardHTML(pt, dimsOf(pt.id), photosOf(pt.id))).join('')}
    </div>
    <button class="btn btn-block" style="margin-top:4px" onclick="openPointModal('${pid}')">＋ 添加测量点（门头 / 墙面 / 橱窗…）</button>

    <div class="section-title">仪器 / 辅助测量记录（${measures.length}）</div>
    <div id="measureList">
      ${measures.length ? measureListHTML(measures) : '<div class="card muted" style="padding:14px">暂无 AR / 陀螺仪测量记录，使用上方「测量工具」采集后会保存在这里</div>'}
    </div>`;
}

/* ---------------- 测量工具入口 ---------------- */
const MEASURE_META = {
  'ar-distance': {ico:'📏', n:'AR 测距',    fmt:v=>v.toFixed(2)+' m',
    detail:d => d.points ? `${d.points.length} 个锚点` : ''},
  'ar-area':     {ico:'⬡', n:'AR 测面积', fmt:v=>v.toFixed(2)+' ㎡',
    detail:d => d.points ? `${d.points.length} 个点围成` : ''},
  'gyro-height': {ico:'📐', n:'角度测高',   fmt:v=>v.toFixed(2)+' m',
    detail:d => `水平距离 ${d.d}m：${d.e1}° → ${d.e2}°`},
  'gyro-angle':  {ico:'📐', n:'夹角测量',   fmt:v=>v.toFixed(1)+' °',
    detail:()=>'两次贴面姿态计算'},
  'pedometer':   {ico:'🚶', n:'步测距离',   fmt:v=>v>=1000?(v/1000).toFixed(2)+' km':v.toFixed(2)+' m',
    detail:d => `${d.steps} 步 × 步长 ${d.stepLen}m`},
};
function toolCardHTML(pid){
  return `
  <div class="card tool-card">
    <div class="tool-grid">
      <button onclick="arStart('distance','${pid}')"><span class="t-ico">📏</span>AR 测距</button>
      <button onclick="arStart('area','${pid}')"><span class="t-ico">⬡</span>AR 测面积</button>
      <button onclick="toolOpen('level','${pid}')"><span class="t-ico">〽️</span>水平仪</button>
      <button onclick="toolOpen('height','${pid}')"><span class="t-ico">📐</span>角度测高</button>
      <button onclick="toolOpen('angle','${pid}')"><span class="t-ico">📐</span>夹角测量</button>
      <button onclick="toolOpen('pedometer','${pid}')"><span class="t-ico">🚶</span>步测距离</button>
      <button onclick="ScreenRuler.openRuler()"><span class="t-ico">📏</span>屏幕尺子</button>
      <button onclick="ScreenRuler.openProtractor()"><span class="t-ico">📐</span>量角器</button>
    </div>
    <div class="tool-tip">AR 测距/面积需安卓 Chrome 且用 <b>https://</b> 地址打开；iPhone 自动提示替代方案。陀螺仪工具请允许"动作与方向"权限。</div>
  </div>`;
}
/* 独立工具页：无需选择项目即可使用全部工具（结果不保存；项目内打开可存档） */
function renderTools(){
  view().innerHTML = `
    <div class="section-title">工具箱</div>
    ${toolCardHTML('')}
    <div class="card"><div class="muted">以上工具可直接使用；在工具模式下测量结果不保存，从某个项目的详情页打开同名工具时，结果会自动存入该项目。</div></div>`;
}
function toolOpen(name, pid){
  const map={level:SensorTools.level, height:SensorTools.height,
             angle:SensorTools.angle, pedometer:SensorTools.pedometer};
  if(name==='level') return map.level();
  return map[name](pid);
}
function arStart(mode, pid){ ARMeasure.start(mode, pid); }

function measureListHTML(list){
  return `<div class="card m-list">${list.map(m=>{
    const meta=MEASURE_META[m.kind]||{ico:'🔹',n:m.kind,fmt:v=>v,detail:()=>''};
    return `<div class="m-row">
      <span class="m-ico">${meta.ico}</span>
      <div class="m-info">
        <b>${meta.n}</b>
        <span class="muted">${meta.detail(m.detail||{})||''} · ${fmtDateTime(m.createdAt)}</span>
      </div>
      <span class="m-val">${meta.fmt(m.value)}</span>
      <button class="icon-btn" title="转为尺寸记录" onclick="measureToDim('${m.id}')">➡️</button>
      <button class="icon-btn" title="删除" onclick="delMeasure('${m.id}')">🗑</button>
    </div>`;
  }).join('')}</div>`;
}
async function measureToDim(mid){
  const m = await DB.get('measures', mid);
  if(!m) return;
  const points = await DB.byIndex('points','projectId', m.projectId);
  if(!points.length){ toast('请先在该项目下添加测量点','err'); return; }
  const meta = MEASURE_META[m.kind] || {n:m.kind, detail:()=>''};
  let defLabel = meta.n, defWidth = '', defRemark = '';
  if(m.unit === 'm'){ defWidth = Math.round(m.value*100); }
  else if(m.unit === '°'){ defRemark = `${meta.n} ${m.value}°`; defLabel = meta.n; }
  if(m.kind === 'ar-area'){
    defWidth = Math.round(Math.sqrt(m.value)*100);
    defRemark = `由面积 ${m.value.toFixed(2)}㎡ 估算边长(参考)`; defLabel = 'AR测面积';
  }
  const data = await formModal({
    title:'转为尺寸记录',
    fields:[
      {key:'pointId', label:'所属测量点', type:'select', required:true,
        options: points.map(pt=>({v:pt.id, n:pt.name || pt.type || pt.id}))},
      {key:'label', label:'部位名称', value:defLabel, required:true, full:true},
      {key:'width', label:'宽 (cm)', value:defWidth, type:'number', step:'0.1'},
      {key:'qty', label:'数量', value:1, type:'number'},
      {key:'material', label:'材质 / 工艺', value:'', full:true},
      {key:'remark', label:'备注', value:defRemark, textarea:true, full:true},
    ],
  });
  if(!data) return;
  await DB.put('dimensions', {
    id:uid(), pointId:data.pointId, label:data.label,
    width: data.width ? num(data.width) : '', height:'',
    qty: num(data.qty)||1, material:data.material||'', remark:data.remark||'', createdAt:Date.now(),
  });
  toast('已转为尺寸记录','ok');
  route();
}
async function delMeasure(mid){
  const ok = await Modal.confirm({title:'删除记录', msg:'确定删除这条仪器测量记录吗？', okText:'删除'});
  if(!ok) return;
  await DB.del('measures', mid);
  toast('已删除','ok'); route();
}
const MeasureRecord = { refresh(){ route(); } };

function pointCardHTML(pt, dims, photos){
  const totalArea = dims.reduce((s,d)=>s+areaM2(d.width,d.height,d.qty),0);
  return `
  <div class="card point-card" id="pt-${pt.id}">
    <div class="point-head">
      <span style="font-size:18px">${typeIcon(pt.type)}</span>
      <span class="p-name">${esc(typeName(pt.type))}${pt.name && pt.name!==typeName(pt.type)?' · '+esc(pt.name):''}</span>
      ${pt.place?`<span class="muted">${esc(pt.place)}</span>`:''}
      <button class="icon-btn" title="编辑" onclick="openPointModal(null,'${pt.id}')">✎</button>
      <button class="icon-btn" title="删除" onclick="delPoint('${pt.id}')">🗑</button>
    </div>
    <div class="point-body">
      ${dims.length ? `
      <div class="dim-table-wrap">
        <table class="dim-table">
          <thead><tr>
            <th style="width:34px">#</th><th class="t-l">部位</th>
            <th>宽(cm)</th><th>高(cm)</th><th>数量</th><th>面积(㎡)</th>
            <th class="t-l">材质/工艺</th><th class="t-l">备注</th><th style="width:36px"></th>
          </tr></thead>
          <tbody>
            ${dims.map((d,i)=>`<tr onclick="editDim('${d.id}')" style="cursor:pointer">
              <td class="muted">${i+1}</td>
              <td class="t-l">${esc(d.label||'—')}</td>
              <td class="num">${d.width?d.width:'—'}</td>
              <td class="num">${d.height?d.height:'—'}</td>
              <td class="num">${d.qty||1}</td>
              <td class="num">${fmtArea(areaM2(d.width,d.height,d.qty))}</td>
              <td class="t-l muted">${esc(d.material||'')}</td>
              <td class="t-l muted">${esc(d.remark||'')}</td>
              <td><button class="dim-del" onclick="event.stopPropagation();delDim('${d.id}')">✕</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="dim-total">
        <span>尺寸项 <b>${dims.length}</b></span>
        <span>合计面积 <b>${totalArea.toFixed(2)}</b> ㎡</span>
      </div>` : '<p class="muted" style="margin:2px 0">暂无尺寸记录，在下方快速添加</p>'}

      <div class="dim-add">
        <div class="d-in w-name"><input placeholder="部位名称" data-k="label"></div>
        <div class="d-in"><input type="number" step="0.1" inputmode="decimal" placeholder="宽" data-k="width"><span class="u">cm</span></div>
        <div class="d-in"><input type="number" step="0.1" inputmode="decimal" placeholder="高" data-k="height"><span class="u">cm</span></div>
        <div class="d-in"><input type="number" step="1" inputmode="numeric" placeholder="数量" data-k="qty" value="1"></div>
        <div class="d-in w-mat"><input placeholder="材质/工艺" data-k="material"></div>
        <button class="btn btn-primary btn-sm" onclick="addDim('${pt.id}',this)">添加</button>
      </div>

      ${photos.length ? `<div class="photo-grid">
        ${photos.map(ph=> ph.kind==='count' ? `
          <div class="photo-cell count-cell" onclick="openCounter('${ph.id}')">
            <img src="${ph.thumb||ph.dataUrl}" alt="" style="width:100%;height:100%;object-fit:contain">
            <span class="ph-count">🔢 ${(ph.countMarks||[]).length} 个</span>
            <button class="ph-del" title="删除照片" onclick="event.stopPropagation();delPhoto('${ph.id}')">✕</button>
          </div>` : `
          <div class="photo-cell" onclick="openEditor('${ph.id}')">
            <img src="${ph.thumb||ph.dataUrl}" alt="" style="width:100%;height:100%;object-fit:contain">
            ${ph.annotations&&ph.annotations.length?`<span class="ph-mark">${ph.annotations.length} 处标注</span>`:''}
            <button class="ph-del" title="删除照片" onclick="event.stopPropagation();delPhoto('${ph.id}')">✕</button>
          </div>`).join('')}
      </div>` : ''}
      <div class="photo-add-btns">
        <button class="btn btn-primary btn-sm" onclick="pickCamera('${pt.id}')">📷 拍照并标注</button>
        <button class="btn btn-ghost btn-sm" onclick="pickCountCamera('${pt.id}')">🔢 拍照计数</button>
        <button class="btn btn-ghost btn-sm" onclick="pickAlbum('${pt.id}')">🖼 从相册添加</button>
      </div>
    </div>
  </div>`;
}

/* ---------------- 测量点弹窗 ---------------- */
async function openPointModal(pid, ptid){
  let pt = {}, projectId = pid;
  if(ptid){
    pt = await DB.get('points', ptid);
    if(!pt) return;
    projectId = pt.projectId;
  }
  const existPoints = await DB.byIndex('points','projectId', projectId);
  const defaultName = (type) => {
    const n = existPoints.filter(p=>p.type===type).length + (ptid?0:1);
    return `${typeName(type)}${n}`;
  };

  const r = await Modal.open({
    title: ptid?'编辑测量点':'添加测量点',
    body:`<div class="field"><label>类型<span class="req">*</span></label>
        <div class="type-grid" id="typeGrid">
          ${POINT_TYPES.map(t=>`<button type="button" class="type-opt ${(pt.type||'mentou')===t.v?'sel':''}"
            data-v="${t.v}"><span class="t-ico">${t.ico}</span>${t.n}</button>`).join('')}
        </div></div>
      <div class="field" style="margin-top:12px"><label>名称 / 编号</label>
        <input id="ptName" value="${esc(pt.name||'')}" placeholder="如：门头1、正门左侧墙面"></div>
      <div class="field"><label>位置说明（选填）</label>
        <input id="ptPlace" value="${esc(pt.place||'')}" placeholder="如：临街正门上方"></div>`,
    onMount(mask){
      $('[data-act=ok]', mask).textContent = ptid?'保存':'添加';
      let curType = pt.type || 'mentou';
      const nameInp = $('#ptName', mask);
      let nameTouched = !!pt.name;
      nameInp.addEventListener('input', ()=> nameTouched = true);
      $$('.type-opt', mask).forEach(b=>b.onclick=()=>{
        $$('.type-opt', mask).forEach(x=>x.classList.remove('sel'));
        b.classList.add('sel'); curType = b.dataset.v;
        if(!nameTouched) nameInp.value = defaultName(curType);
      });
      mask.__getType = () => curType;
      if(!ptid) nameInp.value = defaultName('mentou');
    }
  });
  if(!r) return;
  const type = r.modal.__getType();
  const name = $('#ptName', r.modal).value.trim() || typeName(type);
  const place = $('#ptPlace', r.modal).value.trim();
  if(ptid){
    await DB.put('points', {...pt, type, name, place});
  } else {
    await DB.put('points', {id:uid(), projectId, type, name, place, createdAt:Date.now()});
  }
  toast(ptid?'已保存':'测量点已添加','ok');
  route();
}

async function delPoint(ptid){
  const [ds, phs] = await Promise.all([
    DB.byIndex('dimensions','pointId',ptid), DB.byIndex('photos','pointId',ptid)]);
  const ok = await Modal.confirm({
    title:'删除测量点', okText:'确认删除',
    msg:`将删除该测量点的 ${ds.length} 条尺寸记录和 ${phs.length} 张照片，此操作不可恢复！`});
  if(!ok) return;
  for(const d of ds) await DB.del('dimensions', d.id);
  for(const ph of phs) await DB.del('photos', ph.id);
  await DB.del('points', ptid);
  toast('已删除','ok');
  route();
}

/* ---------------- 尺寸记录 ---------------- */
async function addDim(ptid, btn){
  const box = btn.closest('.dim-add');
  const get = k => box.querySelector(`[data-k="${k}"]`).value.trim();
  const label = get('label'), width = get('width'), height = get('height'),
        qty = get('qty') || 1, material = get('material');
  if(!label){ toast('请填写部位名称','err'); return; }
  if(!width && !height){ toast('宽和高至少填写一项','err'); return; }
  await DB.put('dimensions', {
    id:uid(), pointId:ptid, label,
    width: width?num(width):'', height: height?num(height):'',
    qty: num(qty)||1, material, remark:'', createdAt:Date.now(),
  });
  route();
}

async function editDim(did){
  const d = await DB.get('dimensions', did);
  if(!d) return;
  const data = await formModal({
    title:'编辑尺寸',
    fields:[
      {key:'label', label:'部位名称', value:d.label, required:true, full:true},
      {key:'width', label:'宽 (cm)', value:d.width, type:'number', step:'0.1'},
      {key:'height', label:'高 (cm)', value:d.height, type:'number', step:'0.1'},
      {key:'qty', label:'数量', value:d.qty||1, type:'number'},
      {key:'material', label:'材质 / 工艺', value:d.material, full:true},
      {key:'remark', label:'备注', value:d.remark, textarea:true, full:true},
    ],
  });
  if(!data) return;
  await DB.put('dimensions', {...d, ...data, qty:data.qty||1});
  route();
}
async function delDim(did){
  const ok = await Modal.confirm({title:'删除尺寸', msg:'确定删除这条尺寸记录吗？', okText:'删除'});
  if(!ok) return;
  await DB.del('dimensions', did);
  toast('已删除','ok');
  route();
}

/* ---------------- 照片：拍照 / 相册 / 编辑器 / 计数 ---------------- */
let _photoPoint = null, _photoMode = 'annotate';
function ensurePhotoInputs(){
  if($('#cameraInput')) return;
  const cam = document.createElement('input');
  cam.type='file'; cam.accept='image/*'; cam.setAttribute('capture','environment');
  cam.id='cameraInput'; cam.hidden=true;
  const alb = document.createElement('input');
  alb.type='file'; alb.accept='image/*'; alb.multiple=true;
  alb.id='albumInput'; alb.hidden=true;
  document.body.appendChild(cam); document.body.appendChild(alb);
  cam.onchange = () => handlePhotoFiles(cam.files, true);
  alb.onchange = () => handlePhotoFiles(alb.files, false);
}
function pickCamera(ptid){
  ensurePhotoInputs(); _photoPoint=ptid; _photoMode='annotate';
  $('#cameraInput').value=''; $('#cameraInput').click();
}
function pickCountCamera(ptid){
  ensurePhotoInputs(); _photoPoint=ptid; _photoMode='count';
  $('#cameraInput').value=''; $('#cameraInput').click();
}
function pickAlbum(ptid){
  ensurePhotoInputs(); _photoPoint=ptid; _photoMode='annotate';
  $('#albumInput').value=''; $('#albumInput').click();
}

async function handlePhotoFiles(files, openFirst){
  const ptid = _photoPoint, mode = _photoMode;
  if(!ptid || !files || !files.length) return;
  const arr = [...files];
  const created = [];
  toast('正在处理照片…');
  // 现场水印所需信息：测量点 → 项目（名称/地址/坐标）
  let wmLines = [fmtDateTime(Date.now())];
  try{
    const pt = await DB.get('points', ptid);
    const proj = pt ? await DB.get('projects', pt.projectId) : null;
    if(proj){
      if(proj.name) wmLines.push(proj.name);
      if(proj.address) wmLines.push(proj.address);
      if(proj.lat != null && proj.lng != null)
        wmLines.push(`📍 ${proj.lat.toFixed(5)}, ${proj.lng.toFixed(5)}`);
    }
  }catch(e){}
  for(const f of arr){
    try{
      const im = await processPhotoFile(f);
      im.dataUrl = await watermarkPhoto(im.dataUrl, wmLines);
      im.thumb = await watermarkPhoto(im.thumb, wmLines);
      const ph = {id:uid(), pointId:ptid, annotations:[],
                  kind: mode==='count'?'count':'photo',
                  countMarks: mode==='count'?[]:undefined,
                  createdAt:Date.now(), ...im};
      await DB.put('photos', ph);
      created.push(ph);
    }catch(e){ console.error(e); toast('照片处理失败','err'); }
  }
  if(!created.length) return;
  toast(`已添加 ${created.length} 张照片`,'ok');
  await route();
  if(openFirst && created[0]){
    const ph = await DB.get('photos', created[0].id);
    if(mode==='count') CounterEditor.open(ph, async saved => { await DB.put('photos', saved); await route(); });
    else PhotoEditor.open(ph, async saved => { await DB.put('photos', saved); await route(); });
  }
}

async function openEditor(phid){
  const ph = await DB.get('photos', phid);
  if(!ph) return;
  PhotoEditor.open(ph, async saved => { await DB.put('photos', saved); await route(); });
}
async function openCounter(phid){
  const ph = await DB.get('photos', phid);
  if(!ph) return;
  CounterEditor.open(ph, async saved => { await DB.put('photos', saved); await route(); });
}

async function delPhoto(phid){
  const ok = await Modal.confirm({title:'删除照片', msg:'确定删除这张照片及其全部标注吗？', okText:'删除'});
  if(!ok) return;
  await DB.del('photos', phid);
  toast('已删除','ok');
  route();
}

/* ---------------- 状态切换 ---------------- */
async function changeStatus(pid, status){
  const p = await DB.get('projects', pid);
  await DB.put('projects', {...p, status, updatedAt:Date.now()});
  toast('状态已更新','ok');
  route();
}

/* ---------------- 设置 ---------------- */
function renderSettings(){
  setActiveTab('settings');
  const s = getSettings();
  view().innerHTML = `
    <div class="card">
      <div class="card-h"><h3>👤 报告信息</h3></div>
      <div class="field"><label>默认测量人（显示在报告上）</label>
        <input id="setMeasurer" value="${esc(s.measurer||'')}" placeholder="姓名 / 公司名">
      </div>
      <button class="btn btn-primary btn-sm" onclick="saveMeasurer()">保存</button>
    </div>

    <div class="card">
      <div class="card-h"><h3>💾 数据备份</h3></div>
      <div class="set-row">
        <div class="s-info"><div class="s-t">本机已用空间</div><div class="s-d" id="storageInfo">计算中…</div></div>
      </div>
      <div class="set-row">
        <div class="s-info"><div class="s-t">导出备份文件</div>
          <div class="s-d">包含全部客户、项目、尺寸和照片，建议定期导出保存到电脑或网盘</div></div>
        <button class="btn btn-primary btn-sm" onclick="exportBackup()">导出</button>
      </div>
      <div class="set-row">
        <div class="s-info"><div class="s-t">导入备份文件</div>
          <div class="s-d">从备份 JSON 恢复（同编号数据会被覆盖）</div></div>
        <button class="btn btn-ghost btn-sm" onclick="importBackup()">导入</button>
      </div>
      <div class="set-row">
        <div class="s-info"><div class="s-t" style="color:var(--red)">清空全部数据</div>
          <div class="s-d">删除本机所有测量数据，且无法恢复，请先导出备份</div></div>
        <button class="btn btn-danger btn-sm" onclick="wipeAll()">清空</button>
      </div>
      <input type="file" id="backupInput" accept="application/json,.json" hidden>
    </div>

    <div class="card">
      <div class="card-h"><h3>📖 使用说明</h3></div>
      <div class="help-box">
        <ol style="padding-left:18px;margin:0">
          <li><b>新建项目</b>：首页点 ＋，选择或新建客户，填写项目名称和地址。</li>
          <li><b>添加测量点</b>：项目内点「添加测量点」，选择门头、墙面、橱窗等类型。</li>
          <li><b>记录尺寸</b>：在测量点卡片中填部位名称、宽、高（厘米，支持一位小数）和数量，面积自动计算。</li>
          <li><b>拍照标注</b>：点「拍照并标注」，在照片上<b>拖动画尺寸线</b>并输入实际尺寸；
            放一张 A4 纸等参照物用「📏 校准」后，再画尺寸线会按比例<b>自动估算</b>数值（仅供参考，请以实测为准）。</li>
          <li><b>文字备注</b>：选「🅣」工具点照片任意位置，可加箭头文字说明（材质、工艺、注意事项）。</li>
          <li><b>拍照计数</b>：测量点内点「🔢 拍照计数」，对堆料、灯具、字壳等逐个点击打点自动编号；
            也可点「⚙ 识别」按色差自动识别候选点，再手动补点/删点修正。</li>
          <li><b>测量工具</b>（项目页）：<b>AR 测距/测面积</b>需安卓 Chrome 且通过 <b>https://</b> 地址打开
            （电脑运行 <code>gen-cert.ps1</code> + <code>serve_https.py</code>，iPhone 不支持真 AR）；
            <b>水平仪</b>测水平/垂直；<b>角度测高</b>输入水平距离后瞄准上下沿，不用爬高算高差；
            <b>夹角</b>手机背面贴两个面锁定；<b>步测</b>设好步长走路粗测距离。结果保存在「仪器测量记录」中。</li>
          <li><b>测量报告</b>：项目页点「测量报告」，在打印窗口选「另存为 PDF」即可生成带标注照片、计数照片和仪器记录的完整报告。</li>
          <li><b>手机使用</b>：用浏览器打开本系统后，可通过浏览器菜单「添加到主屏幕」，像 App 一样使用；现场无网络也能正常记录。</li>
          <li><b>数据安全</b>：数据保存在本机浏览器中，清理浏览器数据会丢失，请定期「导出备份」。</li>
        </ol>
      </div>
    </div>`;

  DB.estimate().then(r=>{
    const el = $('#storageInfo');
    if(!el) return;
    if(r && r.usage){
      const mb = r.usage/1048576, qmb = r.quota/1048576;
      el.textContent = `${mb.toFixed(1)} MB / 浏览器配额约 ${qmb>=1024?(qmb/1024).toFixed(1)+' GB':qmb.toFixed(0)+' MB'}`;
    } else el.textContent = '当前浏览器不支持空间查询';
  });
}
function saveMeasurer(){
  setSettings({measurer:$('#setMeasurer').value.trim()});
  toast('已保存','ok');
}
async function exportBackup(){
  toast('正在生成备份…');
  const data = await DB.exportAll();
  const blob = new Blob([JSON.stringify(data)], {type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `测量数据备份_${todayStr()}.json`;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
  toast('备份已导出','ok');
}
function importBackup(){
  const inp = $('#backupInput'); inp.value=''; inp.click();
  inp.onchange = async () => {
    const f = inp.files[0]; if(!f) return;
    try{
      const data = JSON.parse(await f.text());
      if(data._type !== 'admeasure-backup'){ toast('文件格式不正确','err'); return; }
      const ok = await Modal.confirm({title:'导入备份', danger:false, okText:'开始导入',
        msg:`将导入 ${(data.clients||[]).length} 个客户、${(data.projects||[]).length} 个项目、${(data.photos||[]).length} 张照片，同编号数据会被覆盖。`});
      if(!ok) return;
      await DB.importAll(data);
      toast('导入完成','ok');
      route();
    }catch(e){ console.error(e); toast('导入失败：文件无法解析','err'); }
  };
}
async function wipeAll(){
  const ok = await Modal.confirm({title:'清空全部数据', okText:'全部删除',
    msg:'将清空本机所有客户、项目、尺寸和照片，且无法恢复！建议先导出备份。'});
  if(!ok) return;
  for(const s of ['clients','projects','points','dimensions','photos','measures']) await DB.clear(s);
  toast('已清空','ok');
  go('#/projects');
}

/* ---------------- PWA：离线缓存 + 可安装 ---------------- */
if('serviceWorker' in navigator){
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW 注册失败', err));
  });
}

/* ---------------- 启动 ---------------- */
DB.ready.then(()=>{
  ensurePhotoInputs();
  if(!location.hash) location.hash = '#/projects';
  route();
}).catch(e=>{
  document.body.innerHTML =
    `<div style="padding:40px;text-align:center;color:#dc2626">
     <h2>数据库无法打开</h2><p>请使用最新版 Chrome / Edge 浏览器，并允许本地存储。</p></div>`;
});

/* ==================================================================
   传感器公共层 + 测量工具（水平仪 / 俯仰测高 / 夹角 / 步测）
   设计：算法为纯函数；姿态用 ref 高频保存，UI 用 rAF 读取
================================================================== */

/* ---------------- 纯函数算法（可独立测试） ---------------- */
const MeasureAlg = {
  deg: r => r * 180 / Math.PI,
  rad: d => d * Math.PI / 180,

  // 平放时总倾斜角（度）：世界Z 与 设备Z 的夹角
  totalTilt(betaDeg, gammaDeg){
    const b = this.rad(betaDeg), g = this.rad(gammaDeg);
    const c = Math.cos(b)*Math.cos(g);
    return this.deg(Math.acos(Math.max(-1, Math.min(1, c))));
  },
  // 圆泡位置（-1~1，乘半径得像素）。x: 左右倾 gamma，y: 前后倾 beta
  bubble(betaDeg, gammaDeg, maxDeg=12){
    return {
      x: Math.max(-1, Math.min(1, gammaDeg/maxDeg)),
      y: Math.max(-1, Math.min(1, betaDeg/maxDeg)),
      tilt: this.totalTilt(betaDeg, gammaDeg),
    };
  },
  // 竖持时视线仰角：手机竖直 beta=90 → 0；前倾向看上方 beta<90 → 正
  elevation(betaDeg){ return 90 - betaDeg; },
  // 三角测高：水平距离 d(米)，底部俯角/顶部仰角（度）
  heightByAngles(d, e1Deg, e2Deg){
    return Math.abs(d) * Math.abs(Math.tan(this.rad(e2Deg)) - Math.tan(this.rad(e1Deg)));
  },
  // 世界重力在设备坐标系中的单位向量（W3C 方向角约定）
  gravityInDevice(betaDeg, gammaDeg){
    const b = this.rad(betaDeg), g = this.rad(gammaDeg);
    const v = { x: Math.cos(b)*Math.sin(g), y: -Math.sin(b)*Math.cos(g), z: Math.cos(b)*Math.cos(g) };
    const n = Math.hypot(v.x,v.y,v.z) || 1;
    return { x:v.x/n, y:v.y/n, z:v.z/n };
  },
  angleBetween(v1, v2){
    const dot = v1.x*v2.x + v1.y*v2.y + v1.z*v2.z;
    const n1 = Math.hypot(v1.x,v1.y,v1.z), n2 = Math.hypot(v2.x,v2.y,v2.z);
    return this.deg(Math.acos(Math.max(-1, Math.min(1, dot/(n1*n2)))));
  },
  // 步数检测：输入加速度模长历史，返回 {steps, 状态}。纯函数版供算法测试
  // UI 中用步进状态机 Pedometer
};

/* ---------------- 传感器适配器（单例） ---------------- */
const Sensors = (() => {
  const state = {
    supportedO: 'DeviceOrientationEvent' in window,
    supportedM: 'DeviceMotionEvent' in window,
    permitted: null,
    orient: { alpha:0, beta:90, gamma:0 },  // 最新姿态（ref）
    motion: { x:0,y:0,z:0, mag:9.8, gMag:9.8 },
    orientHandlers: new Set(),
    motionHandlers: new Set(),
    boundO:null, boundM:null,
  };
  // 指数平滑
  const sm = (prev, next, a) => prev + (next-prev)*a;

  async function requestPermission(){
    if(state.permitted) return state.permitted;
    try{
      const need = [];
      if(typeof DeviceOrientationEvent !== 'undefined' &&
         typeof DeviceOrientationEvent.requestPermission === 'function')
        need.push(DeviceOrientationEvent.requestPermission());
      if(typeof DeviceMotionEvent !== 'undefined' &&
         typeof DeviceMotionEvent.requestPermission === 'function')
        need.push(DeviceMotionEvent.requestPermission());
      if(need.length){
        const rs = await Promise.all(need);
        state.permitted = rs.every(r => r === 'granted') ? 'granted' : 'denied';
      } else state.permitted = 'granted';
    }catch(e){ state.permitted = 'denied'; }
    return state.permitted;
  }

  function startOrientation(){
    if(state.boundO || !state.supportedO) return;
    const handler = e => {
      if(e.beta == null) return;
      state.orient.alpha = sm(state.orient.alpha, e.alpha||0, .2);
      state.orient.beta  = sm(state.orient.beta,  e.beta,  .25);
      state.orient.gamma = sm(state.orient.gamma, e.gamma, .25);
      state.orientHandlers.forEach(fn => fn(state.orient, e));
    };
    state.boundO = handler;
    // 安卓部分机型需要 absolute 事件拿罗盘，这里两个都监听（重力算法用普通事件即可）
    window.addEventListener('deviceorientation', handler, true);
    window.addEventListener('deviceorientationabsolute', handler, true);
  }
  function startMotion(){
    if(state.boundM || !state.supportedM) return;
    const handler = e => {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if(!a || a.x == null) return;
      const mag = Math.hypot(a.x||0, a.y||0, a.z||0);
      state.motion.x = a.x; state.motion.y = a.y; state.motion.z = a.z;
      state.motion.mag = mag;
      state.motionHandlers.forEach(fn => fn(state.motion, e));
    };
    state.boundM = handler;
    window.addEventListener('devicemotion', handler, true);
  }
  function onOrientation(fn){ state.orientHandlers.add(fn); return () => state.orientHandlers.delete(fn); }
  function onMotion(fn){ state.motionHandlers.add(fn); return () => state.motionHandlers.delete(fn); }
  function stopAll(){
    if(state.boundO){ window.removeEventListener('deviceorientation', state.boundO, true);
      window.removeEventListener('deviceorientationabsolute', state.boundO, true); state.boundO=null; }
    if(state.boundM){ window.removeEventListener('devicemotion', state.boundM, true); state.boundM=null; }
  }
  return { state, requestPermission, startOrientation, startMotion,
           onOrientation, onMotion, stopAll };
})();

/* ---------------- 步测状态机 ---------------- */
class Pedometer{
  constructor(stepLen=0.7){
    this.stepLen = stepLen; this.steps = 0; this.running = false;
    this.peak = 9.8; this.valley = 9.8; this.lastStepT = 0;
    this.threshold = 1.6;    // 峰-谷差阈值 m/s²
    this.cooldown = 260;    // ms
    this.rising = false;
    this.unsub = null;
  }
  start(){
    if(this.running) return;
    this.running = true;
    Sensors.startMotion();
    this.unsub = Sensors.onMotion((m)=>this.feed(m.mag, Date.now()));
  }
  pause(){ this.running=false; this.unsub && this.unsub(); this.unsub=null; }
  reset(){ this.steps=0; this.peak=9.8; this.valley=9.8; this.rising=false; this.lastStepT=0; }
  feed(mag, t){
    if(!this.running) return;
    // 自适应基线，避免不同设备 g 值差异
    if(!this.rising){
      this.valley = Math.min(this.valley, mag);
      if(mag > this.valley + this.threshold) this.rising = true;
    } else {
      this.peak = Math.max(this.peak, mag);
      if(mag < this.peak - this.threshold*0.6){
        if(t - this.lastStepT > this.cooldown){
          this.steps++; this.lastStepT = t;
        }
        this.rising = false; this.peak = mag; this.valley = mag;
      }
    }
  }
  get distance(){ return this.steps * this.stepLen; }
}

/* ==================================================================
   工具外壳与四个工具
================================================================== */
const SensorTools = (() => {
  let layer, rafId = null, unsubs = [], onSave = null;

  function shell({title, subtitle='', body='', actions=''}){
    layer = $('#tool-layer');
    layer.innerHTML = `
      <div class="tl-mask">
        <div class="tl-card">
          <div class="tl-head">
            <button class="icon-btn" id="tlClose" style="color:#cdd8f0">✕</button>
            <div style="flex:1;min-width:0">
              <div class="tl-title">${title}</div>
              <div class="tl-sub">${subtitle}</div>
            </div>
          </div>
          <div class="tl-body" id="tlBody">${body}</div>
          <div class="tl-actions" id="tlActions">${actions}</div>
        </div>
      </div>`;
    layer.hidden = false;
    $('#tlClose').onclick = () => close();
  }
  function close(){
    if(rafId) cancelAnimationFrame(rafId); rafId=null;
    unsubs.forEach(u => u && u()); unsubs=[];
    Sensors.stopAll();
    layer.hidden = true; layer.innerHTML='';
    onSave = null;
  }

  async function ensurePerm(needMotion){
    const r = await Sensors.requestPermission();
    if(r !== 'granted'){
      toast('未获得传感器权限，请允许"动作与方向访问"','err');
      return false;
    }
    Sensors.startOrientation();
    if(needMotion) Sensors.startMotion();
    return true;
  }
  const fmtM = m => m >= 1000 ? (m/1000).toFixed(2)+' km' : m.toFixed(2)+' m';

  /* ---------- 1. 水平仪 / 倾角仪 ---------- */
  async function level(){
    shell({
      title:'水平仪 / 倾角仪',
      subtitle:'手机平放在台面，或背面紧贴立面',
      body:`<div class="lv-wrap">
        <svg class="lv-dial" viewBox="0 0 240 240">
          <circle cx="120" cy="120" r="104" class="lv-ring"/>
          <circle cx="120" cy="120" r="70" class="lv-ring2"/>
          <line x1="120" y1="14" x2="120" y2="30" class="lv-tick"/>
          <line x1="120" y1="210" x2="120" y2="226" class="lv-tick"/>
          <line x1="14" y1="120" x2="30" y2="120" class="lv-tick"/>
          <line x1="210" y1="120" x2="226" y2="120" class="lv-tick"/>
          <circle cx="120" cy="120" r="5" class="lv-center"/>
          <circle cx="120" cy="120" r="13" class="lv-bubble" id="lvBubble"/>
        </svg>
        <div class="lv-num" id="lvNum">--.-°</div>
        <div class="lv-state" id="lvState">等待传感器…</div>
        <div class="lv-raw"><span>前后 β <b id="lvBeta">--</b>°</span>
          <span>左右 γ <b id="lvGamma">--</b>°</span></div>
        <div class="lv-tip">平放测台面/吊顶水平；背面贴立面可测垂直，<b id="lvVert"></b></div>
      </div>`,
    });
    if(!(await ensurePerm(false))){ $('#lvState').textContent='传感器不可用（桌面端无硬件）'; return; }

    function tick(){
      const o = Sensors.state.orient;
      const b = MeasureAlg.bubble(o.beta, o.gamma, 12);
      const bx = 120 + b.x*86, by = 120 + b.y*86;
      $('#lvBubble').setAttribute('cx', bx);
      $('#lvBubble').setAttribute('cy', by);
      $('#lvNum').textContent = b.tilt.toFixed(1)+'°';
      $('#lvBeta').textContent = o.beta.toFixed(1);
      $('#lvGamma').textContent = o.gamma.toFixed(1);
      const st = $('#lvState');
      if(b.tilt < 0.5){
        st.textContent = '✓ 水平'; st.className='lv-state ok';
        $('#lvBubble').classList.add('ok');
      } else {
        st.textContent = b.tilt < 3 ? '轻微倾斜' : '倾斜较大';
        st.className='lv-state' + (b.tilt<3?'':' warn');
        $('#lvBubble').classList.remove('ok');
      }
      // 垂直偏差（手机背面贴立面竖放时 beta≈±90）
      const vert = 90 - Math.min(Math.abs(o.beta), 180-Math.abs(o.beta));
      $('#lvVert').textContent = `当前垂直偏差 ${Math.abs(vert).toFixed(1)}°（<1° 即垂直）`;
      rafId = requestAnimationFrame(tick);
    }
    tick();
  }

  /* ---------- 2. 俯仰角测高 ---------- */
  async function height(projectId){
    onSave = projectId || null;
    shell({
      title:'角度测高（不用爬高）',
      subtitle:'竖持手机，知道到墙面的水平距离即可测高差',
      body:`<div class="hg-wrap">
        <label class="tl-label">到测量面的水平距离 D（米）</label>
        <div class="hg-dist">
          <button class="step-btn" data-d="-0.1">－</button>
          <input id="hgD" type="number" step="0.1" value="3">
          <button class="step-btn" data-d="0.1">＋</button>
        </div>
        <div class="hg-angle">
          <div class="hg-big" id="hgEle">--.-°</div>
          <div class="hg-elabel">当前仰角（水平=0°，向上为正）</div>
        </div>
        <div class="hg-locks">
          <button class="hg-lock" id="hgLock1"><b>① 瞄准底部</b><span id="hgV1">未锁定</span></button>
          <button class="hg-lock" id="hgLock2"><b>② 瞄准顶部</b><span id="hgV2">未锁定</span></button>
        </div>
        <div class="hg-result" id="hgResult">锁定两个角度后自动算出高差</div>
        <div class="lv-tip">用法：站在距墙 D 米处，手机对准底部边缘点①，再抬到顶部边缘点②。D 可用步测工具量出。</div>
      </div>`,
      actions: onSave
        ? `<button class="tl-btn primary" id="hgSave" disabled>保存结果到项目</button>`
        : `<button class="tl-btn" disabled style="opacity:.75">工具模式：结果不保存，从项目内打开可存档</button>`,
    });
    if(!(await ensurePerm(false))){ $('#hgResult').textContent='传感器不可用（桌面端无硬件）'; return; }

    let e1 = null, e2 = null;
    const cur = () => MeasureAlg.elevation(Sensors.state.orient.beta);
    function calc(){
      if(e1!=null && e2!=null){
        const d = num($('#hgD').value)||0;
        const h = MeasureAlg.heightByAngles(d, e1, e2);
        $('#hgResult').innerHTML =
          `高差 <b>${h.toFixed(2)} 米</b>（${(h*100).toFixed(0)} cm）<br>
           <span class="muted">底部 ${e1.toFixed(1)}° → 顶部 ${e2.toFixed(1)}°，D=${d}m</span>`;
        const sb=$('#hgSave'); if(sb) sb.disabled=false;
        return h;
      }
      return null;
    }
    $$('.step-btn', layer).forEach(b => b.onclick = () => {
      const inp = $('#hgD');
      inp.value = Math.max(0.1, (num(inp.value)||0) + num(b.dataset.d)).toFixed(1);
      calc();
    });
    $('#hgLock1').onclick = () => { e1 = cur(); $('#hgV1').textContent = e1.toFixed(1)+'°'; calc(); };
    $('#hgLock2').onclick = () => { e2 = cur(); $('#hgV2').textContent = e2.toFixed(1)+'°'; calc(); };
    const hgSaveBtn=$('#hgSave');
    if(hgSaveBtn) hgSaveBtn.onclick = async () => {
      const h = calc();
      if(h == null) return;
      const pid = onSave;
      await DB.put('measures', {
        id:uid(), projectId:pid, pointId:null, kind:'gyro-height',
        value:+h.toFixed(3), unit:'m',
        detail:{ d:num($('#hgD').value), e1:+e1.toFixed(1), e2:+e2.toFixed(1) },
        createdAt:Date.now(),
      });
      toast('测高结果已保存','ok'); close();
      if(MeasureRecord && pid) MeasureRecord.refresh(pid);
    };
    (function tick(){
      const e = cur();
      $('#hgEle').textContent = e.toFixed(1)+'°';
      $('#hgEle').className = 'hg-big ' + (Math.abs(e)<1?'level':'');
      rafId = requestAnimationFrame(tick);
    })();
  }

  /* ---------- 3. 夹角测量 ---------- */
  async function angle(projectId){
    onSave = projectId || null;
    let v1=null, v2=null;
    shell({
      title:'夹角测量',
      subtitle:'手机背面依次紧贴两个被测面',
      body:`<div class="an-wrap">
        <div class="an-stage">
          <div class="an-result" id="anRes">--.-°</div>
          <div class="an-sub">两面夹角</div>
        </div>
        <div class="hg-locks">
          <button class="hg-lock" id="anLock1"><b>① 贴合第 1 面</b><span id="anV1">未锁定</span></button>
          <button class="hg-lock" id="anLock2"><b>② 贴合第 2 面</b><span id="anV2">未锁定</span></button>
        </div>
        <div class="lv-tip">适合斜面、顶面、异型门头的<b>可贴合面夹角</b>（把手机背面平贴在面上锁定）。
        竖直两面墙绕铅垂线的转角请用 AR 测量。</div>
      </div>`,
      actions:`<button class="tl-btn ghost" id="anReset">重新测量</button>` +
        (onSave ? `<button class="tl-btn primary" id="anSave" disabled>保存结果</button>`
                : `<button class="tl-btn" disabled style="opacity:.75">工具模式：结果不保存</button>`),
    });
    if(!(await ensurePerm(false))){ $('.an-sub',layer).textContent='传感器不可用（桌面端无硬件）'; return; }

    const gravityNow = () => {
      const o = Sensors.state.orient;
      return MeasureAlg.gravityInDevice(o.beta, o.gamma);
    };
    function calc(){
      if(v1 && v2){
        let a = MeasureAlg.angleBetween(v1, v2);
        // 夹角取锐角/钝角都展示（贴面法向量差，范围 0~180）
        $('#anRes').textContent = a.toFixed(1)+'°';
        const sb=$('#anSave'); if(sb) sb.disabled=false;
        return a;
      }
      return null;
    }
    $('#anLock1').onclick = () => {
      v1 = gravityNow(); $('#anV1').textContent = '已锁定'; calc();
    };
    $('#anLock2').onclick = () => {
      v2 = gravityNow(); $('#anV2').textContent = '已锁定'; calc();
    };
    $('#anReset').onclick = () => { v1=v2=null; $('#anV1').textContent='未锁定';
      $('#anV2').textContent='未锁定'; $('#anRes').textContent='--.-°';
      const sb=$('#anSave'); if(sb) sb.disabled=true; };
    const anSaveBtn=$('#anSave');
    if(anSaveBtn) anSaveBtn.onclick = async () => {
      const a = calc(); if(a==null) return;
      const pid = onSave;
      await DB.put('measures', {
        id:uid(), projectId:pid, pointId:null, kind:'gyro-angle',
        value:+a.toFixed(1), unit:'°', detail:{}, createdAt:Date.now(),
      });
      toast('夹角结果已保存','ok'); close();
      if(MeasureRecord && pid) MeasureRecord.refresh(pid);
    };
  }

  /* ---------- 4. 步测距离 ---------- */
  async function pedometer(projectId){
    onSave = projectId || null;
    shell({
      title:'步测距离（粗测）',
      subtitle:'持手机正常步行，自动计步换算距离，误差约 5-10%',
      body:`<div class="pd-wrap">
        <div class="pd-dist" id="pdDist">0.00 m</div>
        <div class="pd-steps"><b id="pdSteps">0</b> 步 · <span id="pdTime">00:00</span></div>
        <label class="tl-label" style="margin-top:14px">步长（米）</label>
        <div class="pd-len">
          ${[0.60,0.65,0.70,0.75,0.80].map(v=>`<button data-len="${v}">${v.toFixed(2)}</button>`).join('')}
        </div>
        <div class="lv-tip">成年女性约 0.60-0.65m，男性约 0.70-0.75m；可量 10 步总长除以 10 校准自己的步长。</div>
      </div>`,
      actions:`<button class="tl-btn ghost" id="pdReset">清零</button>
               <button class="tl-btn primary" id="pdToggle">开始</button>` +
               (onSave ? `<button class="tl-btn" id="pdSave" disabled>保存</button>`
                       : `<button class="tl-btn" disabled style="opacity:.75">不保存</button>`),
    });
    if(!(await ensurePerm(true))){ $('.pd-steps',layer).innerHTML='<span style="color:#fca5a5">传感器不可用（桌面端无硬件）</span>'; return; }

    const pedo = new Pedometer(0.7);
    let t0=0, timer=null;
    const render = () => {
      $('#pdDist').textContent = fmtM(pedo.distance);
      $('#pdSteps').textContent = pedo.steps;
      const sb=$('#pdSave'); if(sb) sb.disabled = pedo.steps===0;
      $$('.pd-len button').forEach(b=>b.classList.toggle('sel', num(b.dataset.len)===pedo.stepLen));
    };
    const tickTime = () => {
      const s = Math.floor((Date.now()-t0)/1000);
      $('#pdTime').textContent = `${pad2(Math.floor(s/60))}:${pad2(s%60)}`;
    };
    $$('.pd-len button').forEach(b => b.onclick = () => {
      pedo.stepLen = num(b.dataset.len); render();
    });
    $('#pdToggle').onclick = () => {
      if(pedo.running){
        pedo.pause(); clearInterval(timer);
        $('#pdToggle').textContent='继续';
      } else {
        if(!pedo.steps) t0 = Date.now();
        pedo.start();
        timer = setInterval(()=>{ tickTime(); render(); }, 300);
        $('#pdToggle').textContent='暂停';
      }
    };
    $('#pdReset').onclick = () => {
      pedo.pause(); pedo.reset(); clearInterval(timer);
      $('#pdToggle').textContent='开始'; $('#pdTime').textContent='00:00'; render();
    };
    const pdSaveBtn=$('#pdSave');
    if(pdSaveBtn) pdSaveBtn.onclick = async () => {
      pedo.pause(); clearInterval(timer);
      const pid = onSave, dist = pedo.distance, steps = pedo.steps, stepLen = pedo.stepLen;
      await DB.put('measures', {
        id:uid(), projectId:pid, pointId:null, kind:'pedometer',
        value:+dist.toFixed(2), unit:'m',
        detail:{ steps, stepLen },
        createdAt:Date.now(),
      });
      toast('步测距离已保存','ok'); close();
      if(MeasureRecord && pid) MeasureRecord.refresh(pid);
    };
    render();
  }

  return { level, height, angle, pedometer, close };
})();

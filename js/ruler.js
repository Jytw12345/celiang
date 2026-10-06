/* ==================================================================
   屏幕尺子 & 量角器（无需传感器，所有设备可用）
   原理：用已知实物（银行卡/硬币/A4）校准 CSS 像素/厘米，之后屏幕即尺子
================================================================== */
const ScreenRuler = (() => {
  const KEY = 'admeasure_px_per_cm';
  const CAL_OK = 'admeasure_px_cal';
  const DEF_PXCM = 96/2.54;            // 默认按 96 DPI 假设（与多数在线尺一致，近似刻度）
  let layer, raf=null;
  // 默认就有刻度（约 96 DPI），校准后才是真实厘米
  const getPxCm = () => num(localStorage.getItem(KEY)) || DEF_PXCM;
  const isCal = () => localStorage.getItem(CAL_OK)==='1' && num(localStorage.getItem(KEY))>0;
  const setPxCm = v => { localStorage.setItem(KEY, v); localStorage.setItem(CAL_OK,'1'); };

  function shell(title, sub, mode){
    layer = $('#tool-layer');
    layer.innerHTML = `
      <div class="tl-mask">
        <div class="tl-card">
          <div class="tl-head">
            <button class="icon-btn" id="tlClose" style="color:#cdd8f0">✕</button>
            <div style="flex:1;min-width:0">
              <div class="tl-title">${title}</div>
              <div class="tl-sub">${sub}</div>
            </div>
            <div class="sr-tabs">
              <button data-m="ruler" class="${mode==='ruler'?'sel':''}">尺子</button>
              <button data-m="measure" class="${mode==='measure'?'sel':''}">测距</button>
              <button data-m="prot" class="${mode==='prot'?'sel':''}">量角器</button>
              <button data-m="cal" class="${mode==='cal'?'sel':''}">校准</button>
            </div>
          </div>
          <div class="tl-body" id="srBody" style="padding:0"></div>
        </div>
      </div>`;
    layer.hidden = false;
    $('#tlClose').onclick = close;
    $$('.sr-tabs button').forEach(b=>b.onclick=()=>{
      if(b.dataset.m==='ruler') openRuler();
      else if(b.dataset.m==='measure') openMeasure();
      else if(b.dataset.m==='prot') openProtractor();
      else openCalibration();
    });
  }
  function close(){
    if(raf) cancelAnimationFrame(raf); raf=null;
    window.removeEventListener('resize', onResize);
    window.removeEventListener('resize', playout);
    window.removeEventListener('resize', mResize);
    layer.hidden=true; layer.innerHTML='';
  }

  /* ---------------- 尺子 ---------------- */
  let cv, cx, W=0, H=0, dpr=1;
  let orient='h';          // h: 横尺  v: 竖尺
  let p1=0, p2=0;          // 两个游标沿尺方向的 CSS px 位置
  let drag=null;           // 1 | 2 | null

  function openRuler(){
    const pxCm = getPxCm();
    shell('屏幕尺子', isCal()?`已校准真实值：${pxCm.toFixed(2)} px/cm`:'默认精度（约 96 DPI），点「校准」可更准', 'ruler');
    $('#srBody').innerHTML = `
      <div class="sr-rulerwrap">
        <canvas id="srCv"></canvas>
        <div class="sr-readout" id="srRead">-- cm</div>
        <div class="sr-bar">
          <button class="tl-btn" id="srOrient">↻ 切换竖尺</button>
          <button class="tl-btn ghost" id="srSwap">⇄ 游标归零</button>
          <button class="tl-btn primary" id="srCopy">复制数值</button>
        </div>
      </div>`;
    cv=$('#srCv'); cx=cv.getContext('2d');
    layout(pxCm);
    $('#srOrient').onclick=()=>{
      orient = orient==='h'?'v':'h';
      $('#srOrient').textContent = orient==='h'?'↻ 切换竖尺':'↻ 切换横尺';
      layout(pxCm);
    };
    $('#srSwap').onclick=()=>{ p1=0; p2=0; draw(pxCm); };
    $('#srCopy').onclick=()=>{
      const t=$('#srRead').textContent;
      if(navigator.clipboard) navigator.clipboard.writeText(t).then(()=>toast('已复制：'+t,'ok'));
    };
    bindPointer(pxCm);
    window.addEventListener('resize', onResize);
  }
  function onResize(){ layout(getPxCm()); }

  function layout(pxCm){
    const stage = cv.parentElement.getBoundingClientRect();
    const barH = 64;
    dpr = Math.min(window.devicePixelRatio||1, 2);
    W = stage.width; H = stage.height - barH - 64;   // 留出读数行
    cv.style.width=W+'px'; cv.style.height=H+'px';
    cv.width=Math.round(W*dpr); cv.height=Math.round(H*dpr);
    if(!p1 && !p2){ p1 = orient==='h'?W*0.2:H*0.2; p2 = orient==='h'?W*0.8:H*0.8; }
    p1=Math.min(p1,(orient==='h'?W:H)); p2=Math.min(p2,(orient==='h'?W:H));
    draw(pxCm);
  }

  function draw(pxCm){
    cx.setTransform(dpr,0,0,dpr,0,0);
    cx.clearRect(0,0,W,H);
    cx.fillStyle='#0d1628'; cx.fillRect(0,0,W,H);
    if(orient==='h'){
      drawScale(pxCm, W);
      drawHandleH(p1); drawHandleH(p2);
    } else {
      cx.save();
      cx.translate(0,H); cx.rotate(-Math.PI/2);
      drawScale(pxCm, H);
      cx.restore();
      drawHandleV(p1); drawHandleV(p2);
    }
    const dist = Math.abs(p2-p1);
    const txt = (isCal()?'':'≈ ') + `${(dist/pxCm).toFixed(2)} cm`;
    const el=$('#srRead'); if(el) el.textContent = txt;
  }

  /* 现代简约刻度尺：浅色尺身 + 品牌蓝数字 + 英寸行（贴屏量实物） */
  function drawScale(pxCm, len){
    const RH=84;
    // 尺身：浅灰白渐变 + 顶部品牌蓝细边
    const g=cx.createLinearGradient(0,0,0,RH);
    g.addColorStop(0,'#fbfdff'); g.addColorStop(.55,'#eef2f7'); g.addColorStop(1,'#e2e8f0');
    cx.fillStyle=g; cx.fillRect(0,0,len,RH);
    cx.fillStyle='#2563eb'; cx.fillRect(0,0,len,3);
    cx.strokeStyle='#cbd5e1'; cx.lineWidth=1;
    cx.beginPath(); cx.moveTo(0,RH-.5); cx.lineTo(len,RH-.5); cx.stroke();

    cx.textAlign='center'; cx.textBaseline='alphabetic';
    // 毫米刻度（自顶部蓝边向下）
    for(let cm=0; cm*pxCm<=len; cm++){
      for(let mm=0; mm<10 && (cm+mm/10)*pxCm<=len; mm++){
        const x=(cm+mm/10)*pxCm;
        const l = mm===0?26 : (mm===5?17:9);
        cx.strokeStyle = mm===0 ? '#1d4ed8' : '#475569';
        cx.lineWidth=mm===0?1.8:1;
        cx.beginPath(); cx.moveTo(x,3); cx.lineTo(x,3+l); cx.stroke();
      }
    }
    // 厘米数字（品牌蓝）
    cx.fillStyle='#1d4ed8'; cx.font='700 13px -apple-system,sans-serif';
    for(let cm=0; cm*pxCm<=len-8; cm++){
      cx.fillText(String(cm), cm*pxCm, 50);
    }
    // 英寸行（底部浅带 + 灰字）
    cx.fillStyle='#f1f5f9'; cx.fillRect(0,RH-18,len,18);
    cx.strokeStyle='#cbd5e1'; cx.lineWidth=1;
    cx.beginPath(); cx.moveTo(0,RH-18); cx.lineTo(len,RH-18); cx.stroke();
    const inPx=pxCm*2.54;
    cx.font='700 11px -apple-system,sans-serif'; cx.fillStyle='#64748b';
    for(let i=0; i*inPx<=len-6; i++){
      const x=i*inPx;
      cx.strokeStyle='#94a3b8'; cx.lineWidth=1;
      cx.beginPath(); cx.moveTo(x,RH-7); cx.lineTo(x,RH-1); cx.stroke();
      cx.fillText(String(i), x, RH-9);
      if((i+.5)*inPx<=len){
        cx.beginPath(); cx.moveTo((i+.5)*inPx,RH-4); cx.lineTo((i+.5)*inPx,RH-1); cx.stroke();
      }
    }
    // 单位标注
    cx.textAlign='left';
    cx.fillStyle='#64748b'; cx.font='10px -apple-system,sans-serif';
    cx.fillText(isCal()?'cm / inches':'cm / inches（默认 96DPI）', 6, 64);
    cx.textAlign='center';
  }
  const HR=20, RH=84;
  function drawHandleH(x){
    cx.beginPath(); cx.moveTo(x,0); cx.lineTo(x,H);
    cx.strokeStyle='rgba(110,168,255,.4)'; cx.lineWidth=1; cx.setLineDash([5,5]); cx.stroke(); cx.setLineDash([]);
    cx.beginPath(); cx.moveTo(x-7,RH); cx.lineTo(x+7,RH); cx.lineTo(x,RH-10); cx.closePath();
    cx.fillStyle='#6ea8ff'; cx.fill();
    cx.beginPath(); cx.arc(x,RH+26,HR,0,Math.PI*2); cx.fillStyle='#2563eb'; cx.fill();
    cx.strokeStyle='#fff'; cx.lineWidth=2; cx.stroke();
  }
  function drawHandleV(y){
    cx.beginPath(); cx.moveTo(0,y); cx.lineTo(W,y);
    cx.strokeStyle='rgba(110,168,255,.4)'; cx.lineWidth=1; cx.setLineDash([5,5]); cx.stroke(); cx.setLineDash([]);
    cx.beginPath(); cx.moveTo(RH,y-7); cx.lineTo(RH,y+7); cx.lineTo(RH-10,y); cx.closePath();
    cx.fillStyle='#6ea8ff'; cx.fill();
    cx.beginPath(); cx.arc(RH+26,y,HR,0,Math.PI*2); cx.fillStyle='#2563eb'; cx.fill();
    cx.strokeStyle='#fff'; cx.lineWidth=2; cx.stroke();
  }

  function pos(e){
    const rc=cv.getBoundingClientRect();
    return orient==='h' ? e.clientX-rc.left : e.clientY-rc.top;
  }
  function hitHandle(e){
    const q=pos(e);
    if(Math.abs(q-p1)<HR+8) return 1;
    if(Math.abs(q-p2)<HR+8) return 2;
    return null;
  }
  function bindPointer(pxCm){
    cv.onpointerdown=e=>{
      drag=hitHandle(e);
      if(!drag){ // 点空白：移动最近的游标
        const q=pos(e);
        drag = Math.abs(q-p1)<Math.abs(q-p2)?1:2;
      }
      try{cv.setPointerCapture(e.pointerId);}catch(_){}
      move(e,pxCm);
    };
    cv.onpointermove=e=>move(e,pxCm);
    cv.onpointerup=cv.onpointercancel=()=>drag=null;
  }
  function move(e,pxCm){
    if(!drag) return;
    const max = orient==='h'?W:H;
    let q=Math.max(0,Math.min(max,pos(e)));
    if(drag===1) p1=q; else p2=q;
    draw(pxCm);
  }

  /* ---------------- 两点测距（直接量屏幕上任意两点） ---------------- */
  let mcv, mcx, MW=0, MH=0, mdpr=1, mpts=[];
  function openMeasure(){
    const pxCm = getPxCm();
    shell('屏幕测距', isCal()?`已校准 ${pxCm.toFixed(2)} px/cm，点两点读间距`:'默认精度（约96DPI），点两点读间距；可校准更准', 'measure');
    $('#srBody').innerHTML = `
      <div class="sr-measurewrap">
        <canvas id="srMCv"></canvas>
        <div class="sr-readout" id="srMRead">👉 点第一点</div>
        <div class="sr-bar">
          <button class="tl-btn ghost" id="srMReset">重测</button>
          <button class="tl-btn primary" id="srMCopy">复制</button>
        </div>
      </div>`;
    mcv=$('#srMCv'); mcx=mcv.getContext('2d');
    mpts=[]; mLayout();
    mcv.onpointerdown=e=>{
      const rc=mcv.getBoundingClientRect();
      const x=e.clientX-rc.left, y=e.clientY-rc.top;
      if(mpts.length>=2) mpts=[];
      mpts.push({x,y});
      mDraw();
      try{mcv.setPointerCapture(e.pointerId);}catch(_){}
    };
    $('#srMReset').onclick=()=>{ mpts=[]; mDraw(); };
    $('#srMCopy').onclick=()=>{
      const t=$('#srMRead').textContent;
      if(navigator.clipboard) navigator.clipboard.writeText(t).then(()=>toast('已复制：'+t,'ok'));
    };
    window.addEventListener('resize', mResize);
  }
  function mResize(){ mLayout(); }
  function mLayout(){
    const r=mcv.parentElement.getBoundingClientRect();
    mdpr=Math.min(window.devicePixelRatio||1,2);
    MW=r.width; MH=r.height-64;
    mcv.style.width=MW+'px'; mcv.style.height=MH+'px';
    mcv.width=Math.round(MW*mdpr); mcv.height=Math.round(MH*mdpr);
    mDraw();
  }
  function mDraw(){
    if(!mcx) return;
    mcx.setTransform(mdpr,0,0,mdpr,0,0);
    mcx.clearRect(0,0,MW,MH);
    const pxCm=getPxCm();
    if(mpts.length>=2){
      const [a,b]=mpts;
      mcx.beginPath(); mcx.moveTo(a.x,a.y); mcx.lineTo(b.x,b.y);
      mcx.strokeStyle='#6ea8ff'; mcx.lineWidth=2; mcx.setLineDash([6,5]); mcx.stroke(); mcx.setLineDash([]);
      const dpx=Math.hypot(b.x-a.x,b.y-a.y);
      const mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      const txt = pxCm>0 ? `${(dpx/pxCm).toFixed(2)} cm` : `${Math.round(dpx)} px（校准后显示 cm）`;
      const w=mcx.measureText(txt).width+18;
      mcx.font='700 16px sans-serif';
      mcx.fillStyle='rgba(37,99,235,.92)';
      const rx=Math.max(2,Math.min(MW-w-2,mid.x-w/2)), ry=Math.max(2,mid.y-32);
      mcx.beginPath(); mcx.roundRect ? mcx.roundRect(rx,ry,w,24,12) : mcx.rect(rx,ry,w,24); mcx.fill();
      mcx.fillStyle='#fff'; mcx.textAlign='center'; mcx.textBaseline='middle';
      mcx.fillText(txt, rx+w/2, ry+12);
      const el=$('#srMRead'); if(el) el.textContent=txt;
    } else {
      const el=$('#srMRead'); if(el) el.textContent = mpts.length ? '👉 点第二点' : '👉 点第一点';
    }
    mpts.forEach((p,i)=>{
      mcx.beginPath(); mcx.arc(p.x,p.y,11,0,Math.PI*2);
      mcx.fillStyle=i===0?'#6ea8ff':'#ff8f7a'; mcx.fill();
      mcx.strokeStyle='#fff'; mcx.lineWidth=2; mcx.stroke();
    });
  }

  /* ---------------- 校准 ---------------- */
  function openCalibration(){
    shell('屏幕校准', '把实物平贴在屏幕上，拖动两端对齐后保存', 'cal');
    $('#srBody').innerHTML = `
      <div class="sr-cal">
        <div class="sr-presets">
          <button data-cm="8.56" class="sel">银行卡 / 身份证（宽 8.56cm）</button>
          <button data-cm="2.50">一元硬币（直径 2.5cm）</button>
          <button data-cm="21.0">A4 纸短边（21cm）</button>
        </div>
        <div class="sr-custom">或输入实物实际长度：
          <input id="srCm" type="number" step="0.01" value="8.56"> cm
        </div>
        <div class="sr-trackwrap">
          <div class="sr-track" id="srTrack">
            <div class="sr-seg" id="srSeg"></div>
            <div class="sr-grip" id="srG1"></div>
            <div class="sr-grip" id="srG2"></div>
          </div>
          <div class="sr-tracktip">将实物（如银行卡长边平贴屏幕）与蓝色线段<b>两端对齐</b></div>
        </div>
        <div class="sr-calinfo" id="srCalInfo"></div>
        <div class="tl-actions" style="position:static;background:transparent;padding:0 16px 18px">
          <button class="tl-btn primary" id="srSaveCal">保存校准</button>
        </div>
      </div>`;
    const track=$('#srTrack'), seg=$('#srSeg'), g1=$('#srG1'), g2=$('#srG2');
    let cm=8.56, dragging=null, frac1=.06, frac2=.94;
    function render(){
      const tw=track.clientWidth;
      g1.style.left=(frac1*tw-16)+'px';
      g2.style.left=(frac2*tw-16)+'px';
      seg.style.left=(frac1*tw)+'px';
      seg.style.width=((frac2-frac1)*tw)+'px';
      const spanPx=(frac2-frac1)*tw, pxcm=spanPx/cm;
      $('#srCalInfo').innerHTML = `线段长 <b>${Math.round(spanPx)}</b> px ÷ ${cm} cm = <b>${(cm?pxcm:0).toFixed(2)}</b> px/cm` +
        (getPxCm()?`<br><span class="muted">当前已存校准：${getPxCm().toFixed(2)} px/cm</span>`:'');
    }
    $$('.sr-presets button').forEach(b=>b.onclick=()=>{
      $$('.sr-presets button').forEach(x=>x.classList.remove('sel'));
      b.classList.add('sel'); cm=num(b.dataset.cm);
      $('#srCm').value=cm.toFixed(2); render();
    });
    $('#srCm').oninput=e=>{ cm=num(e.target.value)||0; render();
      $$('.sr-presets button').forEach(x=>x.classList.remove('sel')); };
    g1.onpointerdown=e=>{ dragging=1; try{track.setPointerCapture(e.pointerId);}catch(_){} };
    g2.onpointerdown=e=>{ dragging=2; try{track.setPointerCapture(e.pointerId);}catch(_){} };
    track.onpointermove=e=>{
      if(!dragging) return;
      const rc=track.getBoundingClientRect();
      let f=(e.clientX-rc.left)/rc.width; f=Math.max(0,Math.min(1,f));
      if(dragging===1) frac1=Math.min(f,frac2-.05);
      else frac2=Math.max(f,frac1+.05);
      render();
    };
    track.onpointerup=track.onpointercancel=()=>dragging=null;
    $('#srSaveCal').onclick=()=>{
      const span=(frac2-frac1)*track.clientWidth;
      if(!cm||cm<=0){ toast('请输入实物长度','err'); return; }
      if(span<40){ toast('线段太短，请拉开两端','err'); return; }
      setPxCm(span/cm);
      toast(`校准已保存：${(span/cm).toFixed(2)} px/cm`,'ok');
      openRuler();
    };
    requestAnimationFrame(render);
  }

  /* ---------------- 量角器 ---------------- */
  let pcv, pcx, PW=0, PH=0, pdpr=1;
  let a1=-Math.PI/2, a2=-Math.PI/2+Math.PI/3;  // 两臂角度（弧度）
  let pdrag=null;
  function openProtractor(){
    shell('量角器', '拖动两个蓝色端点测量夹角（0–180°）', 'prot');
    $('#srBody').innerHTML = `
      <div class="sr-protwrap">
        <canvas id="srProt"></canvas>
        <div class="sr-angle-read" id="srAng">60.0°</div>
      </div>`;
    pcv=$('#srProt'); pcx=pcv.getContext('2d');
    playout();
    pcv.onpointerdown=e=>{
      const p=protPos(e);
      pdrag = Math.hypot(p.x-Math.cos(a1)*p.r, p.y-Math.sin(a1)*p.r)
            < Math.hypot(p.x-Math.cos(a2)*p.r, p.y-Math.sin(a2)*p.r) ? 1:2;
      protMove(e);
      try{pcv.setPointerCapture(e.pointerId);}catch(_){}
    };
    pcv.onpointermove=protMove;
    pcv.onpointerup=pcv.onpointercancel=()=>pdrag=null;
    window.addEventListener('resize', playout);
  }
  function playout(){
    const r=pcv.parentElement.getBoundingClientRect();
    pdpr=Math.min(window.devicePixelRatio||1,2);
    PW=r.width; PH=r.height-76;
    pcv.style.width=PW+'px'; pcv.style.height=PH+'px';
    pcv.width=Math.round(PW*pdpr); pcv.height=Math.round(PH*pdpr);
    pdraw();
  }
  function protPos(e){
    const rc=pcv.getBoundingClientRect();
    const cx=PW/2, cy=PH/2;
    const x=e.clientX-rc.left-cx, y=e.clientY-rc.top-cy;
    return {x,y, ang:Math.atan2(y,x), r:Math.min(PW,PH)/2-40};
  }
  function protMove(e){
    if(!pdrag) return;
    const p=protPos(e);
    if(pdrag===1) a1=p.ang; else a2=p.ang;
    pdraw();
  }
  function pdraw(){
    pcx.setTransform(pdpr,0,0,pdpr,0,0);
    pcx.clearRect(0,0,PW,PH);
    pcx.fillStyle='#0d1628'; pcx.fillRect(0,0,PW,PH);
    const cx=PW/2, cy=PH/2, R=Math.min(PW,PH)/2-40;
    // 刻度盘
    pcx.strokeStyle='#2a3b60'; pcx.lineWidth=1;
    for(let d=0;d<360;d++){
      const a=d*Math.PI/180;
      const r1=R+6, r2=d%10===0?R+16:R+10;
      pcx.beginPath();
      pcx.moveTo(cx+Math.cos(a)*r1,cy+Math.sin(a)*r1);
      pcx.lineTo(cx+Math.cos(a)*r2,cy+Math.sin(a)*r2);
      pcx.stroke();
    }
    pcx.beginPath(); pcx.arc(cx,cy,R+6,0,Math.PI*2);
    pcx.strokeStyle='#33446c'; pcx.stroke();
    // 夹角扇形（取小角）
    let d=Math.abs(a2-a1); if(d>Math.PI) d=2*Math.PI-d;
    pcx.beginPath(); pcx.moveTo(cx,cy);
    pcx.arc(cx,cy,R*0.55,a1,a1+(a2>a1? (a2-a1>Math.PI?-(2*Math.PI-(a2-a1)):d) : (a1-a2>Math.PI?d:-d)));
    pcx.closePath(); pcx.fillStyle='rgba(110,168,255,.22)'; pcx.fill();
    // 两臂
    [a1,a2].forEach((a,i)=>{
      pcx.beginPath(); pcx.moveTo(cx,cy);
      pcx.lineTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R);
      pcx.strokeStyle=i===0?'#6ea8ff':'#ff8f7a'; pcx.lineWidth=3; pcx.stroke();
      pcx.beginPath(); pcx.arc(cx+Math.cos(a)*R,cy+Math.sin(a)*R,11,0,Math.PI*2);
      pcx.fillStyle=i===0?'#6ea8ff':'#ff8f7a'; pcx.fill();
      pcx.strokeStyle='#fff'; pcx.lineWidth=2; pcx.stroke();
    });
    pcx.beginPath(); pcx.arc(cx,cy,5,0,Math.PI*2); pcx.fillStyle='#fff'; pcx.fill();
    const deg=d*180/Math.PI;
    $('#srAng').textContent=deg.toFixed(1)+'°';
  }

  window.addEventListener('hashchange',()=>{ if(!layer.hidden) close(); });

  return { openRuler, openMeasure, openProtractor, openCalibration, close };
})();

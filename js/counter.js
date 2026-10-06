/* ==================================================================
   拍照计数：照片上打点编号 + OTSU 自动识别 + 手动修正
================================================================== */

/* 绘制计数编号点（编辑器 / 缩略图 / 报告共用） */
function drawCountMarks(ctx, W, H, marks, opts={}){
  const f = Math.max(W,H)/1000;
  const r = Math.max(10, 17*f);
  const fs = Math.max(10, 15*f);
  ctx.font = `700 ${fs}px -apple-system,"PingFang SC",sans-serif`;
  ctx.textAlign='center'; ctx.textBaseline='middle';
  marks.forEach((m,i)=>{
    const x=m.x*W, y=m.y*H;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fillStyle = 'rgba(37,99,235,.92)'; ctx.fill();
    ctx.lineWidth = Math.max(1.5, 2.5*f); ctx.strokeStyle='#fff'; ctx.stroke();
    ctx.fillStyle='#fff';
    ctx.fillText(String(i+1), x, y+0.5);
  });
}

/* OTSU 自动阈值 */
function otsuThreshold(gray, n){
  const hist = new Array(256).fill(0);
  for(let i=0;i<n;i++) hist[gray[i]]++;
  let sum=0; for(let t=0;t<256;t++) sum += t*hist[t];
  let sumB=0, wB=0, maxVar=0, threshold=128;
  for(let t=0;t<256;t++){
    wB += hist[t];
    if(wB===0) continue;
    const wF = n-wB;
    if(wF===0) break;
    sumB += t*hist[t];
    const mB = sumB/wB, mF = (sum-sumB)/wF;
    const between = wB*wF*(mB-mF)*(mB-mF);
    // 双峰间方差相等形成平台，取平台末值（阈值落在亮侧，暗/亮两种判定都不会吞掉目标像素）
    if(between>=maxVar){ maxVar=between; threshold=t; }
  }
  return threshold;
}

/* 连通域提取：返回各域 {x,y(归一化质心), areaPx} */
function extractBlobs(gray, w, h, threshold, dark, minAreaPx, maxAreaPx){
  const bin = new Uint8Array(w*h);
  for(let i=0;i<w*h;i++){
    const fg = dark ? gray[i] < threshold : gray[i] > threshold;
    bin[i] = fg ? 1 : 0;
  }
  const seen = new Uint8Array(w*h);
  const blobs = [];
  const stack = [];
  for(let i=0;i<w*h;i++){
    if(!bin[i] || seen[i]) continue;
    let sx=0, sy=0, cnt=0, minX=w,maxX=0,minY=h,maxY=0;
    stack.length=0; stack.push(i); seen[i]=1;
    while(stack.length){
      const p = stack.pop();
      const x=p%w, y=(p-x)/w;
      sx+=x; sy+=y; cnt++;
      if(x<minX)minX=x; if(x>maxX)maxX=x;
      if(y<minY)minY=y; if(y>maxY)maxY=y;
      // 4 邻域
      if(x>0){const q=p-1; if(bin[q]&&!seen[q]){seen[q]=1;stack.push(q);}}
      if(x<w-1){const q=p+1; if(bin[q]&&!seen[q]){seen[q]=1;stack.push(q);}}
      if(y>0){const q=p-w; if(bin[q]&&!seen[q]){seen[q]=1;stack.push(q);}}
      if(y<h-1){const q=p+w; if(bin[q]&&!seen[q]){seen[q]=1;stack.push(q);}}
    }
    const bw=maxX-minX, bh=maxY-minY;
    // 形状/大小过滤：细长噪线、过大连片、过小点都排除
    if(cnt >= minAreaPx && cnt <= maxAreaPx &&
       bw >= 3 && bh >= 3 && bw/bh < 6 && bh/bw < 6){
      blobs.push({ x:(sx/cnt+0.5)/w, y:(sy/cnt+0.5)/h, areaPx:cnt });
    }
  }
  // 按面积排序后返回（过大的连片已经被 maxArea 拦截）
  return blobs;
}

const CounterEditor = (() => {
  let el, cv, ctx, stage, img, photo, onSaved;
  let marks=[], mode='add', cssW=0, cssH=0, dpr=1, maskUrl=null;

  async function open(ph, cb){
    photo = ph; onSaved = cb;
    marks = JSON.parse(JSON.stringify(ph.countMarks || []));
    mode='add'; maskUrl=null;
    el = $('#editor-layer');
    el.innerHTML = `
      <div class="ed-top">
        <button class="ed-btn" data-act="back" title="退出">✕</button>
        <span class="ed-title">拍照计数</span>
        <div style="margin:0 auto;font-size:20px;font-weight:800;color:#fff">
          <span id="ctCount" style="color:#6ea8ff">0</span><span style="font-size:13px;color:#9fb0d0;font-weight:500"> 个</span>
        </div>
        <button class="ed-btn" data-act="auto" title="自动识别">⚙ 识别</button>
        <button class="ed-btn primary" data-act="save">保存</button>
      </div>
      <div class="ed-stage" id="edStage"><canvas class="ed-canvas"></canvas></div>
      <div class="ed-bottom">
        <div class="ed-hint">
          <span id="ctHint">点击每个物体打一个计数点，自动编号；点错可用「删点」模式点掉</span>
        </div>
        <div id="ctAutoPanel" hidden>
          <div class="ct-row">
            <label>阈值 <span id="ctThVal">128</span></label>
            <input type="range" id="ctTh" min="20" max="240" value="128" style="flex:1">
            <select id="ctMode" style="height:32px;width:84px;background:#1d2949;border:1px solid #2f3d63;color:#fff;border-radius:8px">
              <option value="dark">深色物体</option>
              <option value="light">浅色物体</option>
            </select>
          </div>
          <div class="ct-row">
            <label>最小点 <span id="ctMnVal">12</span>px</label>
            <input type="range" id="ctMin" min="3" max="120" value="12" style="flex:1">
            <button class="btn btn-sm" id="ctPreview">预览遮罩</button>
            <button class="btn btn-primary btn-sm" id="ctRun">执行识别</button>
          </div>
          <div class="ct-tip" id="ctDetected">对准背景单一、与背景反差明显的一堆物体（如堆放的成品、灯具、字壳），识别后可手动补点/删点</div>
        </div>
        <div class="ct-actions">
          <button class="btn btn-sm ${mode==='add'?'btn-primary':''}" id="ctModeAdd">＋ 打点</button>
          <button class="btn btn-sm ${mode==='del'?'btn-danger':''}" id="ctModeDel">✕ 删点</button>
          <button class="btn btn-sm" id="ctUndo">↶ 撤销</button>
          <button class="btn btn-sm btn-danger" id="ctClear">清空</button>
        </div>
      </div>`;
    el.hidden=false;
    stage=$('#edStage'); cv=stage.querySelector('canvas'); ctx=cv.getContext('2d');
    img = await loadImage(photo.dataUrl);
    bind(); layout(); draw();
  }

  function close(){
    window.removeEventListener('resize', layout);
    if(maskUrl) URL.revokeObjectURL(maskUrl);
    el.hidden=true; el.innerHTML=''; photo=null; img=null; maskUrl=null;
  }

  function bind(){
    el.addEventListener('click', onClick);
    cv.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', layout);
  }
  function layout(){
    dpr = Math.min(window.devicePixelRatio||1, 2);
    const r = stage.getBoundingClientRect();
    const scale = Math.min(r.width/photo.width, r.height/photo.height);
    cssW=Math.max(50,Math.floor(photo.width*scale));
    cssH=Math.max(50,Math.floor(photo.height*scale));
    cv.style.width=cssW+'px'; cv.style.height=cssH+'px';
    cv.width=Math.round(cssW*dpr); cv.height=Math.round(cssH*dpr);
    draw();
  }
  function draw(){
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cssW,cssH);
    ctx.drawImage(img,0,0,cssW,cssH);
    drawCountMarks(ctx, cssW, cssH, marks, {});
    $('#ctCount').textContent = marks.length;
  }
  function toRel(e){
    const rc=cv.getBoundingClientRect();
    return { x:Math.min(1,Math.max(0,(e.clientX-rc.left)/rc.width)),
             y:Math.min(1,Math.max(0,(e.clientY-rc.top)/rc.height)),
             px:e.clientX-rc.left, py:e.clientY-rc.top };
  }
  function hitMark(p){
    const tol = 24;
    for(let i=marks.length-1;i>=0;i--){
      const d = Math.hypot((p.x-marks[i].x)*cssW,(p.y-marks[i].y)*cssH);
      if(d<tol) return i;
    }
    return -1;
  }
  function onDown(e){
    const p=toRel(e);
    const hit = hitMark(p);
    if(mode==='add'){
      if(hit>=0) return;            // 点中已有点：忽略，避免重复
      marks.push({x:p.x,y:p.y});
    } else {
      if(hit>=0) marks.splice(hit,1);
      else toast('没有点中计数点');
    }
    draw();
  }

  function setMode(m){
    mode=m;
    $('#ctModeAdd').className='btn btn-sm '+(m==='add'?'btn-primary':'');
    $('#ctModeDel').className='btn btn-sm '+(m==='del'?'btn-danger':'');
    $('#ctHint').textContent = m==='add'
      ? '点击每个物体打一个计数点，自动编号'
      : '点击要删除的计数点';
  }

  /* 取小图灰度用于识别 */
  function getGray(edgeW=420){
    const scale=Math.min(1, edgeW/img.width);
    const w=Math.round(img.width*scale), h=Math.round(img.height*scale);
    const c=document.createElement('canvas'); c.width=w; c.height=h;
    const cx=c.getContext('2d'); cx.drawImage(img,0,0,w,h);
    const data=cx.getImageData(0,0,w,h).data;
    const gray=new Uint8Array(w*h);
    for(let i=0,j=0;i<data.length;i+=4,j++)
      gray[j]=(data[i]*0.299+data[i+1]*0.587+data[i+2]*0.114)|0;
    return {gray,w,h,scale,c,cx};
  }

  function runDetect(previewOnly){
    const g = getGray();
    const dark = $('#ctMode').value==='dark';
    const th = num($('#ctTh').value);
    const minPx = num($('#ctMin').value);
    const maxPx = Math.round(g.w*g.h*0.08);
    if(previewOnly){
      const imgd = g.cx.getImageData(0,0,g.w,g.h);
      for(let i=0,j=0;i<imgd.data.length;i+=4,j++){
        const fg = dark ? g.gray[j]<th : g.gray[j]>th;
        imgd.data[i]=fg?37:0; imgd.data[i+1]=fg?99:0; imgd.data[i+2]=fg?235:0;
        imgd.data[i+3]=fg?110:0;
      }
      g.cx.putImageData(imgd,0,0);
      if(maskUrl) URL.revokeObjectURL(maskUrl);
      maskUrl = g.c.toDataURL('image/png');
      const showPreview = () => {
        ctx.setTransform(dpr,0,0,dpr,0,0);
        ctx.clearRect(0,0,cssW,cssH);
        const im=new Image(); im.onload=()=>{ ctx.drawImage(im,0,0,cssW,cssH); drawCountMarks(ctx,cssW,cssH,marks); };
        im.src=maskUrl;
      };
      showPreview();
      return;
    }
    const blobs = extractBlobs(g.gray,g.w,g.h,th,dark,minPx,maxPx);
    marks = blobs.map(b=>({x:b.x,y:b.y}));
    $('#ctDetected').innerHTML = `识别到 <b style="color:#86d8a6">${blobs.length}</b> 个候选点，请核对后<b>手动补点/删点</b>修正`;
    draw();
  }

  function onClick(e){
    const t=e.target.closest('[data-act],[id]');
    if(!t) return;
    if(t.dataset.act==='back'){ close(); return; }
    if(t.dataset.act==='save'){ doSave(); return; }
    if(t.dataset.act==='auto'){
      const box=$('#ctAutoPanel');
      box.hidden=!box.hidden;
      if(!box.hidden && $('#ctTh').value==='128'){
        // 首次打开：自动算 OTSU
        const g=getGray();
        const ot=otsuThreshold(g.gray,g.w*g.h);
        $('#ctTh').value=ot; $('#ctThVal').textContent=ot;
      }
      return;
    }
    if(t.id==='ctModeAdd') setMode('add');
    if(t.id==='ctModeDel') setMode('del');
    if(t.id==='ctUndo'){ if(marks.length){ marks.pop(); draw(); } }
    if(t.id==='ctClear'){ if(marks.length){ marks=[]; draw(); } }
    if(t.id==='ctTh'){ /* 滑杆：仅更新数字 */ }
  }

  async function doSave(){
    photo.countMarks = marks;
    photo.kind = 'count';
    // 合成高清计数图（缩略图/下载共用）
    let dlUrl=null;
    try{
      const im=await loadImage(photo.dataUrl);
      const scale=Math.min(1,1400/Math.max(im.width,im.height));
      const W=Math.max(1,im.width*scale),H=Math.max(1,im.height*scale);
      const c=document.createElement('canvas'); c.width=W;c.height=H;
      const cx=c.getContext('2d'); cx.drawImage(im,0,0,W,H);
      drawCountMarks(cx,W,H,marks);
      dlUrl=c.toDataURL('image/jpeg',0.85);
      const ts=Math.min(1,400/Math.max(im.width,im.height));
      const c2=document.createElement('canvas');
      c2.width=Math.max(1,im.width*ts); c2.height=Math.max(1,im.height*ts);
      const cx2=c2.getContext('2d'); cx2.drawImage(im,0,0,c2.width,c2.height);
      drawCountMarks(cx2,c2.width,c2.height,marks);
      photo.thumb=c2.toDataURL('image/jpeg',0.62);
    }catch(_){}
    if(onSaved){
      toast(`已保存计数：${marks.length} 个`,'ok');
      await onSaved(photo);
      close();
    }else{
      // 独立工具模式：下载带编号的计数图
      if(dlUrl){
        const a=document.createElement('a');
        a.href=dlUrl; a.download=`拍照计数_${marks.length}个_${Date.now()}.jpg`;
        document.body.appendChild(a); a.click(); a.remove();
      }
      toast(`计数图已下载：${marks.length} 个`,'ok');
      close();
    }
  }

  // 滑杆事件（单独绑，避免冒泡到 onClick 影响）
  document.addEventListener('input', e=>{
    if(e.target.id==='ctTh') $('#ctThVal').textContent=e.target.value;
    if(e.target.id==='ctMin') $('#ctMnVal').textContent=e.target.value;
  });
  document.addEventListener('click', e=>{
    if(e.target.id==='ctRun') runDetect(false);
    if(e.target.id==='ctPreview') runDetect(true);
  });

  return { open, close };
})();

/* ============ 照片标注：纯绘制函数（编辑器 / 报告共用） ============ */
function roundRectPath(ctx, x, y, w, h, r){
  r = Math.min(r, Math.abs(w)/2, Math.abs(h)/2);
  ctx.beginPath();
  ctx.moveTo(x+r, y);
  ctx.arcTo(x+w, y,   x+w, y+h, r);
  ctx.arcTo(x+w, y+h, x,   y+h, r);
  ctx.arcTo(x,   y+h, x,   y,   r);
  ctx.arcTo(x,   y,   x+w, y,   r);
  ctx.closePath();
}

/* 在 ctx(W×H 像素) 上绘制全部标注。annos: [{id,kind,x1,y1,x2,y2,value,unit,text,color}] */
function drawPhotoAnnotations(ctx, W, H, annos, opts={}){
  const f = Math.max(W, H) / 1000;          // 尺寸随图片分辨率缩放
  const lw = Math.max(1.5, 3.2 * f);
  const fontSize = Math.max(11, 26 * f);
  const padX = 8 * f, padY = 5 * f, gap = 10 * f;
  const tickLen = 16 * f;

  ctx.font = `600 ${fontSize}px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const labelBox = (text, cx, cy, color) => {
    const lines = String(text).split('\n');
    const tw = Math.max(...lines.map(l => ctx.measureText(l).width));
    const bw = tw + padX*2, bh = fontSize*lines.length + padY*2 - 2*f;
    let bx = cx - bw/2, by = cy - bh/2;
    bx = Math.max(2*f, Math.min(W - bw - 2*f, bx));
    by = Math.max(2*f, Math.min(H - bh - 2*f, by));
    ctx.fillStyle = 'rgba(10,16,32,.72)';
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1, 1.6*f);
    roundRectPath(ctx, bx, by, bw, bh, 6*f);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = color === '#111111' ? '#ffffff' : color;
    lines.forEach((l, i) => {
      ctx.fillText(l, bx + bw/2, by + padY + fontSize/2 + i*fontSize);
    });
    return {x:bx, y:by, w:bw, h:bh};
  };

  for(const a of annos){
    const color = a.kind === 'ref' ? '#22c55e' : (a.color || '#ff3b30');
    const p1 = {x:a.x1*W, y:a.y1*H}, p2 = {x:a.x2*W, y:a.y2*H};
    const selected = opts.selectedId === a.id;

    if(a.kind === 'note'){
      const lines = String(a.text || '').split('\n');
      const tw = Math.max(...lines.map(l => ctx.measureText(l).width));
      const bw = tw + padX*2, bh = fontSize*lines.length + padY*2 - 2*f;
      let boxCx = p1.x, boxCy = p1.y - bh/2 - gap*2.2;   // 默认文字在点上方
      if(boxCy - bh/2 < 3*f) boxCy = p1.y + bh/2 + gap*2.2; // 靠顶则放下方
      const bx = Math.max(2*f, Math.min(W-bw-2*f, boxCx - bw/2));
      const by = boxCy - bh/2;
      // 引线 + 箭头
      const near = {x:boxCx, y: boxCy > p1.y ? by : by + bh};
      ctx.strokeStyle = color; ctx.fillStyle = color;
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(near.x, near.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(p1.x, p1.y, Math.max(3, 5*f), 0, Math.PI*2); ctx.fill();
      const ang = Math.atan2(near.y - p1.y, near.x - p1.x);
      const ah = 11*f, aw = 5*f;
      ctx.beginPath();
      ctx.moveTo(near.x, near.y);
      ctx.lineTo(near.x - ah*Math.cos(ang) + aw*Math.sin(ang),
                 near.y - ah*Math.sin(ang) - aw*Math.cos(ang));
      ctx.lineTo(near.x - ah*Math.cos(ang) - aw*Math.sin(ang),
                 near.y - ah*Math.sin(ang) + aw*Math.cos(ang));
      ctx.closePath(); ctx.fill();
      const box = labelBox(a.text, bx + bw/2, boxCy, color);
      a._hb = {x:box.x/W, y:box.y/H, w:box.w/W, h:box.h/H, ax:a.x1, ay:a.y1};
      if(selected){ ctx.save(); ctx.strokeStyle='#fff'; ctx.setLineDash([6*f,5*f]);
        ctx.lineWidth=2*f; roundRectPath(ctx, box.x-3*f, box.y-3*f, box.w+6*f, box.h+6*f, 8*f); ctx.stroke(); ctx.restore(); }
      continue;
    }

    // 尺寸线 / 参照线
    const dx = p2.x-p1.x, dy = p2.y-p1.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx/len, uy = dy/len;
    const nx = -uy, ny = ux;
    ctx.strokeStyle = color; ctx.fillStyle = color;
    ctx.lineWidth = lw;
    if(a.kind === 'ref') ctx.setLineDash([10*f, 7*f]);
    ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    ctx.setLineDash([]);
    // 端勾（垂直短线）
    ctx.beginPath();
    [p1,p2].forEach(p => {
      ctx.moveTo(p.x - nx*tickLen, p.y - ny*tickLen);
      ctx.lineTo(p.x + nx*tickLen, p.y + ny*tickLen);
    });
    ctx.stroke();
    const hasVal = a.value !== '' && a.value !== undefined && a.value !== null;
    if(hasVal){
      // 文字（沿法线偏移，始终偏向线的上方/右侧）
      let ox = nx*gap*2.4, oy = ny*gap*2.4;
      if(Math.abs(dx) > Math.abs(dy)){ if(oy > 0){oy=-oy;ox=-ox;} }
      else { if(ox < 0){ox=-ox;oy=-oy;} }
      const label = a.kind === 'ref' ? `参照 ${a.value}${a.unit||'cm'}` : `${a.value}${a.unit||'cm'}`;
      const box = labelBox(label, (p1.x+p2.x)/2 + ox, (p1.y+p2.y)/2 + oy, color);
      // 延长小引线：线中点到文字框
      ctx.strokeStyle = color; ctx.lineWidth = Math.max(1, 1.4*f);
      ctx.beginPath();
      ctx.moveTo((p1.x+p2.x)/2, (p1.y+p2.y)/2);
      ctx.lineTo((p1.x+p2.x)/2 + ox*.55, (p1.y+p2.y)/2 + oy*.55);
      ctx.stroke();
      a._hb = {x:box.x/W, y:box.y/H, w:box.w/W, h:box.h/H,
               ax:(p1.x/W+p2.x/W)/2, ay:(p1.y/H+p2.y/H)/2};
    } else {
      a._hb = null;
    }
    if(selected){
      ctx.save(); ctx.strokeStyle='#fff'; ctx.setLineDash([6*f,5*f]); ctx.lineWidth=2*f;
      ctx.beginPath(); ctx.arc(p1.x,p1.y,10*f,0,Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.arc(p2.x,p2.y,10*f,0,Math.PI*2); ctx.stroke(); ctx.restore();
    }
  }
}

/* 合成带标注的图片（报告/导出用） */
async function composeAnnotated(photo, maxEdge=1400){
  const img = await loadImage(photo.dataUrl);
  const scale = Math.min(1, maxEdge/Math.max(img.width, img.height));
  const W = Math.round(img.width*scale), H = Math.round(img.height*scale);
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0, 0, W, H);
  drawPhotoAnnotations(ctx, W, H, photo.annotations || []);
  return cv.toDataURL('image/jpeg', 0.8);
}

/* 生成带标注缩略图（照片墙用，400px） */
async function makeAnnotatedThumb(photo){
  const img = await loadImage(photo.dataUrl);
  const scale = Math.min(1, 400/Math.max(img.width, img.height));
  const W = Math.max(1, Math.round(img.width*scale)), H = Math.max(1, Math.round(img.height*scale));
  const cv = document.createElement('canvas');
  cv.width=W; cv.height=H;
  const ctx = cv.getContext('2d');
  ctx.drawImage(img, 0,0, W,H);
  drawPhotoAnnotations(ctx, W, H, photo.annotations || []);
  return cv.toDataURL('image/jpeg', 0.62);
}

/* 根据参照物估算长度（单位与参照物一致）。list 可传入编辑器中的最新标注集 */
function estimateByRef(photo, x1, y1, x2, y2, list){
  const ref = (list || photo.annotations || []).find(a => a.kind === 'ref');
  if(!ref || !num(ref.value)) return '';
  const L  = Math.hypot((x2-x1)*photo.width,  (y2-y1)*photo.height);
  const Lr = Math.hypot((ref.x2-ref.x1)*photo.width, (ref.y2-ref.y1)*photo.height) || 1;
  return (L * num(ref.value) / Lr).toFixed(1);
}

/* ============ 标注编辑器 ============ */
const PhotoEditor = (() => {
  let el, cv, ctx, stage, img;
  let photo = null, onSaved = null;
  let annos = [], undoStack = [];
  let tool = 'dim', color = '#ff3b30';
  let cur = null;             // 正在绘制的线
  let selectedId = null;
  let cssW = 0, cssH = 0, dpr = 1;
  let dirty = false;

  const HINTS = {
    dim:  '在照片上按住拖动画出尺寸线，松开后输入实际尺寸',
    ref:  '沿参照物（如 A4 纸长边）拖动画线，输入真实长度完成校准，之后画尺寸线会自动估算',
    note: '点击要备注的位置，输入文字，可用于标注材料、工艺等说明',
    sel:  '点击任意标注可修改数值 / 文字或删除',
  };
  const TOOLS = [
    {v:'dim', ico:'↔',  name:'尺寸线'},
    {v:'ref', ico:'📏', name:'参照物校准'},
    {v:'note',ico:'T',  name:'文字备注'},
    {v:'sel', ico:'☝', name:'选择/删除'},
  ];

  async function open(ph, cb){
    photo = ph; onSaved = cb;
    annos = JSON.parse(JSON.stringify(ph.annotations || []));
    undoStack = []; dirty = false; selectedId = null; cur = null;
    tool = 'dim';
    el = $('#editor-layer');
    el.innerHTML = `
      <div class="ed-top">
        <button class="ed-btn" data-act="back" title="退出">✕</button>
        <span class="ed-title">标注照片</span>
        <div class="ed-tools">
          ${TOOLS.map(t=>`<button class="ed-tool ${t.v==='dim'?'sel':''}" data-tool="${t.v}" title="${t.name}">${t.ico}</button>`).join('')}
        </div>
        <button class="ed-btn" data-act="undo" title="撤销">↶</button>
        <button class="ed-btn primary" data-act="save">保存</button>
      </div>
      <div class="ed-stage" id="edStage"><canvas class="ed-canvas"></canvas></div>
      <div class="ed-bottom">
        <div class="ed-hint">
          <span id="edHint">${HINTS.dim}</span>
          <span class="ed-colors" id="edColors">
            ${ANNO_COLORS.map(c=>`<button class="ed-color ${c.v===color?'sel':''}" data-color="${c.v}"
              style="background:${c.v}" title="${c.n}"></button>`).join('')}
          </span>
        </div>
        <div class="ed-ref" id="edRefInfo" hidden></div>
        <div id="edPanel"></div>
      </div>`;
    el.hidden = false;
    stage = $('#edStage'); cv = stage.querySelector('canvas'); ctx = cv.getContext('2d');
    img = await loadImage(photo.dataUrl);
    bind();
    layout();
    updateRefInfo();
  }

  function close(){
    window.removeEventListener('resize', layout);
    el.hidden = true; el.innerHTML='';
    photo = null; cur = null; img = null;
  }

  function bind(){
    el.addEventListener('click', onClick, { once:false });
    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', ()=>{ cur=null; draw(); });
    window.addEventListener('resize', layout);
  }

  function layout(){
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = stage.getBoundingClientRect();
    const scale = Math.min(r.width/photo.width, r.height/photo.height);
    cssW = Math.max(50, Math.floor(photo.width*scale));
    cssH = Math.max(50, Math.floor(photo.height*scale));
    cv.style.width = cssW+'px'; cv.style.height = cssH+'px';
    cv.width = Math.round(cssW*dpr); cv.height = Math.round(cssH*dpr);
    draw();
  }

  function draw(){
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,cssW,cssH);
    ctx.drawImage(img, 0,0, cssW, cssH);
    // 用 CSS 尺寸作为 W/H 绘制（坐标 0~1）
    drawPhotoAnnotations(ctx, cssW, cssH, annos, { selectedId });
    if(cur){
      const a = {x1:cur.x1,y1:cur.y1,x2:cur.x2,y2:cur.y2,kind:cur.kind,
                 value:'', color};
      ctx.save();
      ctx.globalAlpha = .9;
      drawPhotoAnnotations(ctx, cssW, cssH, [a], {});
      // 估算提示
      if(cur.kind==='dim'){
        const est = estimateByRef(photo, cur.x1,cur.y1,cur.x2,cur.y2, annos);
        if(est){
          const ref = annos.find(x=>x.kind==='ref');
          const fs = Math.max(11, 13*Math.max(cssW,cssH)/500);
          ctx.font = `600 ${fs}px sans-serif`;
          const tx2 = (cur.x2)*cssW, ty2 = (cur.y2)*cssH - 26;
          const t = `≈ ${est}${ref.unit||'cm'}`;
          const tw = ctx.measureText(t).width;
          ctx.fillStyle='rgba(34,197,94,.9)';
          roundRectPath(ctx, tx2-tw/2-8, ty2-fs/2-5, tw+16, fs+10, 6); ctx.fill();
          ctx.fillStyle='#fff'; ctx.textAlign='center'; ctx.textBaseline='middle';
          ctx.fillText(t, tx2, ty2+1);
        }
      }
      ctx.restore();
    }
  }

  function toRel(e){
    const rc = cv.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX-rc.left)/rc.width)),
      y: Math.min(1, Math.max(0, (e.clientY-rc.top)/rc.height)),
      px: e.clientX-rc.left, py: e.clientY-rc.top,
    };
  }

  function onDown(e){
    e.preventDefault();
    try{ cv.setPointerCapture(e.pointerId); }catch(_){ /* 部分环境无活跃指针，忽略 */ }
    const p = toRel(e);
    cur = {x1:p.x,y1:p.y,x2:p.x,y2:p.y,kind:tool,startPx:p.px,startPy:p.py,moved:false};
  }
  function onMove(e){
    if(!cur) return;
    const p = toRel(e);
    if(Math.hypot(p.px-cur.startPx, p.py-cur.startPy) > 7) cur.moved = true;
    cur.x2=p.x; cur.y2=p.y;
    draw();
  }
  function onUp(e){
    if(!cur) return;
    const c = cur; cur = null;
    const p = toRel(e);
    c.x2=p.x; c.y2=p.y;
    const dist = Math.hypot((c.x2-c.x1)*cssW, (c.y2-c.y1)*cssH);

    // 点击行为：优先命中已有标注 → 编辑
    if(!c.moved || dist < 8){
      const hit = hitTest(p);
      if(hit){ editAnno(hit); }
      else if(c.kind === 'note'){
        // 以点击点为锚点
        showInput({kind:'note', x1:p.x, y1:p.y, x2:p.x, y2:p.y});
      }
      draw();
      return;
    }
    if(c.kind === 'note'){ showInput({kind:'note', x1:c.x1,y1:c.y1,x2:c.x2,y2:c.y2}); return; }
    showInput(c);
  }

  /* 命中检测：先文字框，再线段，再锚点 */
  function hitTest(p){
    const tol = 16;
    let best = null, bestD = tol;
    for(const a of annos){
      const hb = a._hb;
      if(hb && p.x >= hb.x-0.01 && p.x <= hb.x+hb.w+0.01 &&
                p.y >= hb.y-0.01 && p.y <= hb.y+hb.h+0.01){
        return a; // 点中文字框最优先
      }
      if(a.kind !== 'note'){
        const d = pointToLine(p, {x:a.x1,y:a.y1},{x:a.x2,y:a.y2}, cssW, cssH);
        if(d < bestD){ bestD = d; best = a; }
      } else {
        const d = Math.hypot((p.x-a.x1)*cssW, (p.y-a.y1)*cssH);
        if(d < bestD){ bestD = d; best = a; }
      }
    }
    return best;
  }
  function pointToLine(p, a, b, W, H){
    const A={x:a.x*W,y:a.y*H}, B={x:b.x*W,y:b.y*H}, P={x:p.x*W,y:p.y*H};
    const dx=B.x-A.x, dy=B.y-A.y;
    const L2 = dx*dx+dy*dy || 1;
    let t = ((P.x-A.x)*dx+(P.y-A.y)*dy)/L2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(P.x-(A.x+t*dx), P.y-(A.y+t*dy));
  }

  /* 底部输入条：c={kind,x1,y1,x2,y2} 或已有 anno */
  function showInput(c, existing=null){
    selectedId = existing ? existing.id : null;
    const panel = $('#edPanel');
    const ref = annos.find(a=>a.kind==='ref');
    if(c.kind === 'note'){
      panel.innerHTML = `<div class="ed-inputbar">
        <input type="text" id="edVal" maxlength="40" placeholder="备注文字，如：包银色边、预留电源口">
        <button class="btn btn-primary" id="edOk">确定</button>
        ${existing?'<button class="btn btn-danger" id="edDel">删除</button>':''}
      </div>`;
      const inp = $('#edVal', panel);
      inp.value = existing ? (existing.text||'') : '';
      setTimeout(()=>inp.focus(), 60);
      const finish = () => {
        const v = inp.value.trim();
        if(v){
          pushUndo();
          if(existing){ existing.text = v; }
          else annos.push({id:uid(), kind:'note', x1:c.x1,y1:c.y1,x2:c.x2,y2:c.y2,text:v,color});
        }
        panel.innerHTML=''; draw();
      };
      $('#edOk',panel).onclick = finish;
      inp.onkeydown = e => { if(e.key==='Enter') finish(); };
      if(existing) $('#edDel',panel).onclick = () => { pushUndo(); removeAnno(existing.id); panel.innerHTML=''; draw(); };
      return;
    }
    const isRef = c.kind === 'ref';
    let estVal = '';
    if(!isRef && !existing) estVal = estimateByRef(photo, c.x1,c.y1,c.x2,c.y2, annos);
    const defUnit = (isRef ? 'cm' : (existing ? existing.unit : (estVal ? ref.unit : 'cm')));
    panel.innerHTML = `<div class="ed-inputbar">
      <input type="number" id="edVal" step="0.1" inputmode="decimal"
        placeholder="${isRef?'参照物真实长度':'实际尺寸数值'}">
      <select id="edUnit">
        ${['cm','mm','m'].map(u=>`<option value="${u}" ${u===defUnit?'selected':''}>${u}</option>`).join('')}
      </select>
      <button class="btn btn-primary" id="edOk">确定</button>
      ${existing?'<button class="btn btn-danger" id="edDel">删除</button>':''}
    </div>`;
    const inp = $('#edVal', panel);
    inp.value = existing ? existing.value : (estVal || '');
    setTimeout(()=>{ inp.focus(); inp.select(); }, 60);
    const finish = () => {
      const v = inp.value.trim();
      if(v === '' || !isFinite(num(v)) || num(v) <= 0){
        if(isRef){ toast('请输入参照物的真实长度','err'); return; }
        // 尺寸线允许取消（无值则放弃）
        panel.innerHTML=''; draw(); return;
      }
      pushUndo();
      const unit = $('#edUnit',panel).value;
      if(isRef){
        // 参照线全图唯一：替换旧的
        annos = annos.filter(a => a.kind !== 'ref');
        annos.push({id:uid(), kind:'ref', x1:c.x1,y1:c.y1,x2:c.x2,y2:c.y2, value:v, unit});
        toast('已校准，后续尺寸线将自动估算','ok');
      } else if(existing){
        existing.value = v; existing.unit = unit;
      } else {
        annos.push({id:uid(), kind:'dim', x1:c.x1,y1:c.y1,x2:c.x2,y2:c.y2, value:v, unit, color});
      }
      panel.innerHTML='';
      updateRefInfo(); draw();
    };
    $('#edOk',panel).onclick = finish;
    inp.onkeydown = e => { if(e.key==='Enter') finish(); };
    if(existing) $('#edDel',panel).onclick = () => {
      pushUndo(); removeAnno(existing.id); panel.innerHTML=''; updateRefInfo(); draw();
    };
  }

  function editAnno(a){
    selectedId = a.id;
    draw();
    showInput(a, a);
  }
  function removeAnno(id){
    annos = annos.filter(a => a.id !== id);
    if(selectedId === id) selectedId = null;
    updateRefInfo();
  }
  function pushUndo(){ undoStack.push(JSON.stringify(annos)); if(undoStack.length>30) undoStack.shift(); dirty=true; }

  function updateRefInfo(){
    const ref = annos.find(a=>a.kind==='ref');
    const box = $('#edRefInfo');
    if(ref && num(ref.value)){
      box.hidden = false;
      box.innerHTML = `🟢 已用参照物校准（${ref.value}${ref.unit}）
        <button class="btn btn-sm" style="margin-left:8px" id="edClearRef">清除校准</button>`;
      $('#edClearRef', box).onclick = () => { pushUndo(); annos = annos.filter(a=>a.kind!=='ref'); updateRefInfo(); draw(); };
    } else box.hidden = true;
  }

  function onClick(e){
    const t = e.target.closest('[data-act],[data-tool],[data-color]');
    if(!t) return;
    if(t.dataset.tool){
      tool = t.dataset.tool;
      $$('.ed-tool', el).forEach(b=>b.classList.toggle('sel', b.dataset.tool===tool));
      $('#edHint').textContent = HINTS[tool];
      $('#edPanel').innerHTML='';
      selectedId = null; draw();
    }
    if(t.dataset.color){
      color = t.dataset.color;
      $$('.ed-color', el).forEach(b=>b.classList.toggle('sel', b.dataset.color===color));
    }
    if(t.dataset.act === 'undo'){
      if(!undoStack.length){ toast('没有可撤销的操作'); return; }
      annos = JSON.parse(undoStack.pop());
      updateRefInfo(); $('#edPanel').innerHTML=''; draw();
    }
    if(t.dataset.act === 'back'){
      if(dirty){ Modal.confirm({title:'退出标注',msg:'有未保存的标注，确定退出吗？',okText:'退出'}).then(ok=>{ if(ok) close(); }); }
      else close();
    }
    if(t.dataset.act === 'save'){ doSave(); }
  }

  async function doSave(){
    photo.annotations = annos;
    // 重新生成带标注缩略图
    try{ photo.thumb = await makeAnnotatedThumb(photo); }catch(e){}
    dirty = false;
    toast('标注已保存','ok');
    if(onSaved) await onSaved(photo);
    close();
  }

  return { open, close };
})();

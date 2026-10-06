/* ============ 测量报告（A4 / 另存 PDF） ============ */
async function openReport(pid){
  const p = await DB.get('projects', pid);
  if(!p){ toast('项目不存在','err'); return; }
  const client = await DB.get('clients', p.clientId);
  const points = (await DB.byIndex('points','projectId',pid)).sort((a,b)=>a.createdAt-b.createdAt);
  const [allDims, allPhotos, measures] = await Promise.all([
    DB.all('dimensions'), DB.all('photos'),
    DB.byIndex('measures','projectId',pid).catch(()=>[]),
  ]);
  measures.sort((a,b)=>a.createdAt-b.createdAt);

  let grandArea = 0, dimN = 0, photoN = 0;

  const pointsHTML = points.map((pt, idx) => {
    const dims = allDims.filter(d=>d.pointId===pt.id).sort((a,b)=>a.createdAt-b.createdAt);
    const photos = allPhotos.filter(x=>x.pointId===pt.id).sort((a,b)=>a.createdAt-b.createdAt);
    dimN += dims.length; photoN += photos.length;
    const area = dims.reduce((s,d)=>s+areaM2(d.width,d.height,d.qty),0);
    grandArea += area;

    return `<section class="rp-point">
      <h3>${idx+1}. ${esc(typeName(pt.type))}${pt.name && pt.name!==typeName(pt.type)?' · '+esc(pt.name):''}
        ${pt.place?`<span style="font-weight:400;font-size:12px;opacity:.85">（${esc(pt.place)}）</span>`:''}
      </h3>
      <table class="rp-dim">
        <thead><tr>
          <th style="width:7%">序号</th><th style="width:18%">部位</th>
          <th style="width:10%">宽(cm)</th><th style="width:10%">高(cm)</th>
          <th style="width:8%">数量</th><th style="width:11%">面积(㎡)</th>
          <th style="width:16%">材质/工艺</th><th>备注</th>
        </tr></thead>
        <tbody>
          ${dims.length ? dims.map((d,i)=>`<tr>
            <td>${i+1}</td>
            <td>${esc(d.label||'—')}</td>
            <td class="num">${d.width?d.width:'—'}</td>
            <td class="num">${d.height?d.height:'—'}</td>
            <td class="num">${d.qty||1}</td>
            <td class="num">${fmtArea(areaM2(d.width,d.height,d.qty))}</td>
            <td>${esc(d.material||'')}</td>
            <td>${esc(d.remark||'')}</td>
          </tr>`).join('') :
          `<tr><td colspan="8" style="color:#888;padding:10px">暂无尺寸记录</td></tr>`}
        </tbody>
      </table>
      ${photos.length ? `<div class="rp-photos">
        ${photos.map((ph,i)=>`
          <figure>
            <img id="rpimg-${ph.id}" src="${ph.thumb||ph.dataUrl}" alt="照片${i+1}">
            <figcaption>${ph.kind==='count'?`计数照片 · ${(ph.countMarks||[]).length} 个`
              :`照片 ${idx+1}-${i+1}${ph.annotations&&ph.annotations.length?` · ${ph.annotations.length} 处标注`:''}`}
              · ${fmtDateTime(ph.createdAt)}</figcaption>
          </figure>`).join('')}
      </div>` : ''}
      <div style="margin-top:6px;font-size:12px;color:#555">本测量点合计面积：${area.toFixed(2)} ㎡</div>
    </section>`;
  }).join('');

  const cell = (k,v)=>`<td class="k">${k}</td><td>${esc(v||'—')}</td>`;

  const layer = $('#report-layer');
  layer.innerHTML = `
    <div class="report-actions">
      <button class="btn btn-ghost" onclick="closeReport()">✕ 返回</button>
      <span class="r-t">测量报告预览</span>
      <button class="btn btn-primary" id="rpPrintBtn" disabled
        style="opacity:.55;pointer-events:none">🖨 高清照片生成中…</button>
    </div>
    <div class="report-page" id="reportPage">
      <header class="rp-head">
        <h1>现场尺寸测量报告</h1>
        <div class="rp-sub">SITE MEASUREMENT REPORT</div>
      </header>

      <table class="rp-info">
        <tr>
          ${cell('客户名称', client?client.name:'')}
          ${cell('联系人', (client?client.contact:'')||'')}
        </tr>
        <tr>
          ${cell('联系电话', client?client.phone:'')}
          ${cell('测量日期', fmtDate(p.measureDate||p.createdAt))}
        </tr>
        <tr>
          ${cell('项目名称', p.name)}
          ${cell('测量人', p.measurer||'')}
        </tr>
        <tr>
          ${cell('施工地址', p.address || (client?client.address:''))}
          ${cell('报告生成', fmtDateTime(Date.now()))}
        </tr>
        ${p.remark?`<tr><td class="k">备注</td><td colspan="3">${esc(p.remark)}</td></tr>`:''}
      </table>

      ${points.length ? pointsHTML :
        '<p style="color:#888;text-align:center;padding:30px">该项目暂无测量点数据</p>'}

      ${measures.length ? `<section class="rp-point">
        <h3>附：仪器 / 辅助测量记录</h3>
        <table class="rp-dim">
          <thead><tr>
            <th style="width:7%">序号</th><th style="width:20%">类型</th>
            <th style="width:18%">结果</th><th style="width:35%">说明</th>
            <th>时间</th>
          </tr></thead>
          <tbody>
            ${measures.map((m,i)=>{
              const meta = MEASURE_META[m.kind]||{ico:'',n:m.kind,fmt:v=>v,detail:()=>''};
              return `<tr>
                <td>${i+1}</td>
                <td>${meta.ico} ${meta.n}</td>
                <td class="num"><b>${meta.fmt(m.value)}</b></td>
                <td>${esc(meta.detail(m.detail||{})||'—')}</td>
                <td>${fmtDateTime(m.createdAt)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </section>` : ''}

      ${points.length ? `
      <div style="display:flex;gap:10px;margin-top:14px;font-size:12.5px;color:#333;flex-wrap:wrap">
        <span>测量点：<b>${points.length}</b> 个</span>
        <span>尺寸项：<b>${dimN}</b> 条</span>
        <span>照片：<b>${photoN}</b> 张</span>
        <span>总面积：<b>${grandArea.toFixed(2)}</b> ㎡</span>
        ${measures.length?`<span>辅助测量：<b>${measures.length}</b> 项</span>`:''}
      </div>` : ''}

      <div class="rp-sign">
        <div>测量人签字：<div class="ln"></div></div>
        <div>客户确认签字：<div class="ln"></div></div>
      </div>
      <p style="font-size:11px;color:#999;margin-top:14px">
        说明：本报告尺寸由现场实测记录，标注照片中的参照估算法数据仅供参考；请以实测尺寸为准进行制作。</p>
    </div>`;
  layer.hidden = false;
  document.body.style.overflow = 'hidden';
  window.scrollTo(0,0);

  // 异步合成高清带标注/计数照片，全部就绪后启用打印
  const tasks = [];
  for(const pt of points){
    const photos = allPhotos.filter(x=>x.pointId===pt.id);
    for(const ph of photos){
      const composer = ph.kind==='count' ? composeCountPhoto : composeAnnotated;
      tasks.push(composer(ph, 1400).then(url=>{
        const img = $(`#rpimg-${ph.id}`);
        if(img) img.src = url;
      }).catch(()=>{}));
    }
  }
  const btn = $('#rpPrintBtn');
  Promise.all(tasks).then(()=>{
    if(!btn) return;
    btn.disabled = false;
    btn.style.opacity = '';
    btn.style.pointerEvents = '';
    btn.textContent = '🖨 打印 / 另存为 PDF';
    btn.onclick = () => window.print();
  });
}

function closeReport(){
  const layer = $('#report-layer');
  layer.hidden = true;
  layer.innerHTML = '';
  document.body.style.overflow = '';
}

/* 计数照片高清合成（原图 + 编号点） */
function composeCountPhoto(ph, maxEdge=1400){
  return loadImage(ph.dataUrl).then(im=>{
    const scale = Math.min(1, maxEdge/Math.max(im.width, im.height));
    const W = Math.max(1, Math.round(im.width*scale));
    const H = Math.max(1, Math.round(im.height*scale));
    const c = document.createElement('canvas');
    c.width=W; c.height=H;
    const cx = c.getContext('2d');
    cx.drawImage(im,0,0,W,H);
    drawCountMarks(cx, W, H, ph.countMarks||[]);
    return c.toDataURL('image/jpeg', 0.82);
  });
}

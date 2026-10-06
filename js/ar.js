/* ==================================================================
   AR 测量（WebXR + three.js r128）
   - 安卓 Chrome/Edge（ARCore）：真实空间平面 hit-test，放锚点测距/面积
   - iPhone / 非 HTTPS / 桌面：不支持时给出明确降级提示
================================================================== */

/* 3D 多边形面积：Newell 法向定平面 → 投影到平面 2D 基 → shoelace */
function polygonArea3D(pts){
  if(pts.length < 3) return 0;
  let nx=0,ny=0,nz=0;
  for(let i=0;i<pts.length;i++){
    const a=pts[i], b=pts[(i+1)%pts.length];
    nx += (a.y-b.y)*(a.z+b.z);
    ny += (a.z-b.z)*(a.x+b.x);
    nz += (a.x-b.x)*(a.y+b.y);
  }
  const nLen=Math.hypot(nx,ny,nz) || 1;
  const n={x:nx/nLen,y:ny/nLen,z:nz/nLen};
  // 选与 n 最不平行的世界轴构造基
  const ref = Math.abs(n.y) < 0.9 ? {x:0,y:1,z:0} : {x:1,y:0,z:0};
  const u = { // n × ref
    x:n.y*ref.z-n.z*ref.y, y:n.z*ref.x-n.x*ref.z, z:n.x*ref.y-n.y*ref.x
  };
  const ul=Math.hypot(u.x,u.y,u.z); u.x/=ul;u.y/=ul;u.z/=ul;
  const v={x:n.y*u.z-n.z*u.y, y:n.z*u.x-n.x*u.z, z:n.x*u.y-n.y*u.x};
  const c={x:0,y:0,z:0}; pts.forEach(p=>{c.x+=p.x;c.y+=p.y;c.z+=p.z;});
  c.x/=pts.length;c.y/=pts.length;c.z/=pts.length;
  const q = pts.map(p=>({
    x:(p.x-c.x)*u.x+(p.y-c.y)*u.y+(p.z-c.z)*u.z,
    y:(p.x-c.x)*v.x+(p.y-c.y)*v.y+(p.z-c.z)*v.z,
  }));
  let s=0;
  for(let i=0;i<q.length;i++){
    const a=q[i], b=q[(i+1)%q.length];
    s += a.x*b.y - b.x*a.y;
  }
  return Math.abs(s)/2;
}
function polylineLength3D(pts){
  let L=0;
  for(let i=1;i<pts.length;i++)
    L += Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y, pts[i].z-pts[i-1].z);
  return L;
}

const ARMeasure = (() => {
  let renderer, scene, camera, session, hitSource, reticle;
  let anchors=[], lineObj=null, fillObj=null;
  let mode='distance', projectId=null, layer, running=false;

  function supportStatus(){
    if(!window.isSecureContext)
      return {ok:false, msg:'AR 需要 HTTPS 安全连接。请用电脑生成的 https:// 地址访问（或部署到云服务器）'};
    if(!navigator.xr)
      return {ok:false, msg:'当前浏览器不支持 WebXR。\n安卓请用 Chrome/Edge 打开；iPhone 的 Safari 不支持真 AR，请使用拍照参照物测量'};
    return {ok:true, msg:''};
  }
  async function checkSupported(){
    const s = supportStatus();
    if(!s.ok) return s;
    try{
      const ok = await navigator.xr.isSessionSupported('immersive-ar');
      return ok ? {ok:true} :
        {ok:false, msg:'这台设备没有 ARCore 支持（或未安装 Google Play 服务 for AR），请用拍照参照物测量'};
    }catch(e){ return {ok:false, msg:'AR 检测失败：'+e.message}; }
  }

  function showUnsupported(msg, pid){
    layer = $('#ar-layer');
    layer.innerHTML = `
      <div class="ar-fallback">
        <div class="ar-fb-ico">🫧</div>
        <h3>AR 测量在当前环境不可用</h3>
        <p>${esc(msg).replace(/\n/g,'<br>')}</p>
        <div class="ar-fb-tip">
          <b>替代方案：</b><br>
          ① 安卓用户：用 Chrome 打开本系统的 <b>https://</b> 地址，点这里：
          <a href="#" id="arRetry">重新检测 AR</a><br>
          ② iPhone / 无 AR 设备：在照片上用「参照物校准」画线，可自动估算长度；面积用宽×高记录
        </div>
        <button class="btn btn-primary btn-block" id="arFbClose">我知道了</button>
      </div>`;
    layer.hidden=false;
    $('#arFbClose').onclick=()=>{ layer.hidden=true; layer.innerHTML=''; };
    $('#arRetry').onclick=async e=>{ e.preventDefault(); await start(mode, pid); };
  }

  async function start(m='distance', pid=null){
    mode=m; projectId=pid;
    const sup = await checkSupported();
    if(!sup.ok){ showUnsupported(sup.msg, pid); return; }

    layer = $('#ar-layer');
    layer.innerHTML = `
      <div id="arDom">
        <div class="ar-hud">
          <div class="ar-hud-title">${m==='distance'?'📏 AR 测距':'⬡ AR 测面积'}</div>
          <div class="ar-hud-main" id="arMain">0.00 ${m==='distance'?'m':'㎡'}</div>
          <div class="ar-hud-sub" id="arSub">移动手机扫描地面/墙面，看到光圈后点击屏幕放点</div>
        </div>
        <div class="ar-bar">
          <button class="ar-btn" id="arUndo">↶ 撤点</button>
          <button class="ar-btn" id="arClear">清空</button>
          ${pid?'<button class="ar-btn primary" id="arSave">完成保存</button>':''}
          <button class="ar-btn danger" id="arExit">退出</button>
        </div>
      </div>`;
    layer.hidden=false;

    try{
      renderer = new THREE.WebGLRenderer({antialias:true, alpha:true});
      renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled=true;
      renderer.xr.setReferenceSpaceType('local');
      layer.appendChild(renderer.domElement);

      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(70, innerWidth/innerHeight, .01, 50);

      reticle = new THREE.Mesh(
        new THREE.RingGeometry(.07,.09,32),
        new THREE.MeshBasicMaterial({color:0x6ea8ff, side:THREE.DoubleSide, transparent:true, opacity:.9})
      );
      reticle.matrixAutoUpdate=false; reticle.visible=false;
      const dot=new THREE.Mesh(new THREE.CircleGeometry(.018,24),
        new THREE.MeshBasicMaterial({color:0x6ea8ff, side:THREE.DoubleSide}));
      dot.position.z=.001; reticle.add(dot);
      scene.add(reticle);

      session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures:['hit-test','dom-overlay'],
        domOverlay:{ root: $('#arDom') },
      });
      renderer.xr.setSession(session);
      const viewerSpace = await session.requestReferenceSpace('viewer');
      hitSource = await session.requestHitTestSource({ space:viewerSpace });
      running=true;

      session.addEventListener('select', onSelect);
      session.addEventListener('end', cleanup);
      renderer.setAnimationLoop(tick);
      bindUI();
    }catch(e){
      console.error(e);
      toast('AR 启动失败：'+ (e.message||e),'err');
      cleanup();
    }
  }

  function bindUI(){
    $('#arUndo').onclick=()=>{ anchors.pop(); rebuild(); updateHUD(); };
    $('#arClear').onclick=()=>{ anchors=[]; rebuild(); updateHUD(); };
    $('#arExit').onclick=()=>session && session.end();
    const sb=$('#arSave'); if(sb) sb.onclick=doSave;
  }

  function makeLabel(text, p){
    const cv=document.createElement('canvas'); cv.width=96;cv.height=96;
    const c=cv.getContext('2d');
    c.beginPath();c.arc(48,48,30,0,Math.PI*2);
    c.fillStyle='rgba(37,99,235,.95)';c.fill();
    c.lineWidth=4;c.strokeStyle='#fff';c.stroke();
    c.fillStyle='#fff';c.font='700 32px sans-serif';c.textAlign='center';c.textBaseline='middle';
    c.fillText(String(text),48,50);
    const tex=new THREE.CanvasTexture(cv);
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:tex, depthTest:false, transparent:true}));
    sp.scale.set(.09,.09,1); sp.position.set(p.x,p.y+.06,p.z);
    sp.renderOrder=999;
    return sp;
  }

  function onSelect(){
    if(!reticle.visible){ toast('请先对准平面，等光圈出现'); return; }
    anchors.push(new THREE.Vector3().setFromMatrixPosition(reticle.matrix));
    rebuild(); updateHUD();
  }

  /* 锚点数量少，每次全量重建球/标签/线/面，简单可靠 */
  function rebuild(){
    [...scene.children].forEach(c=>{
      if(c.userData.isAnchor){ scene.remove(c);
        c.geometry?.dispose(); c.material?.dispose();
        if(c.material.map) c.material.map.dispose();
      }
    });
    anchors.forEach((p,i)=>{
      const m=new THREE.Mesh(new THREE.SphereGeometry(.022,16,16),
        new THREE.MeshBasicMaterial({color:0xff5a4d, depthTest:false}));
      m.position.copy(p); m.renderOrder=998; m.userData.isAnchor=true;
      scene.add(m);
      const sp=makeLabel(i+1, p);
      sp.userData.isAnchor=true;
      scene.add(sp);
    });
    if(lineObj){ scene.remove(lineObj); lineObj.geometry.dispose();
      lineObj.material.dispose(); lineObj=null; }
    if(fillObj){ scene.remove(fillObj); fillObj.geometry.dispose();
      fillObj.material.dispose(); fillObj=null; }

    if(anchors.length>=2){
      const pts = (mode==='area' && anchors.length>=3) ? [...anchors, anchors[0]] : anchors;
      const g=new THREE.BufferGeometry().setFromPoints(pts);
      lineObj=new THREE.Line(g, new THREE.LineBasicMaterial({color:0xff5a4d, depthTest:false}));
      lineObj.renderOrder=997; scene.add(lineObj);
    }
    // 面积填充（质心扇形，凸多边形准确）
    if(mode==='area' && anchors.length>=3){
      const c=new THREE.Vector3(); anchors.forEach(p=>c.add(p)); c.multiplyScalar(1/anchors.length);
      const pos=[];
      for(let i=0;i<anchors.length;i++){
        const a=anchors[i], b=anchors[(i+1)%anchors.length];
        pos.push(c.x,c.y,c.z, a.x,a.y,a.z, b.x,b.y,b.z);
      }
      const g=new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos,3));
      fillObj=new THREE.Mesh(g, new THREE.MeshBasicMaterial({
        color:0x6ea8ff, transparent:true, opacity:.22, side:THREE.DoubleSide, depthTest:false}));
      fillObj.renderOrder=996; scene.add(fillObj);
    }
  }

  function updateHUD(){
    const main=$('#arMain'), sub=$('#arSub'), save=$('#arSave');
    if(!main) return;
    if(mode==='distance'){
      const L=polylineLength3D(anchors);
      main.textContent = L.toFixed(2)+' m';
      sub.textContent = anchors.length<2
        ? '移动手机扫描平面，看到光圈后点击屏幕放起点'
        : `${anchors.length-1} 段 · 总长 ${L.toFixed(2)} m`;
      if(save) save.disabled = anchors.length<2;
    }else{
      const A=polygonArea3D(anchors);
      main.textContent = A.toFixed(2)+' ㎡';
      sub.textContent = anchors.length<3
        ? '沿被测区域边缘依次放点（≥3个），自动闭合算面积'
        : `${anchors.length} 个点 · 面积 ${A.toFixed(2)} ㎡，继续沿边缘放点`;
      if(save) save.disabled = anchors.length<3;
    }
  }

  function tick(time, frame){
    if(!running || !frame) return;
    const refSpace=renderer.xr.getReferenceSpace();
    if(hitSource){
      const hits=frame.getHitTestResults(hitSource);
      if(hits.length){
        const pose=hits[0].getPose(refSpace);
        if(pose){
          reticle.visible=true;
          reticle.matrix.fromArray(pose.transform.matrix);
        }
      } else reticle.visible=false;
    }
    renderer.render(scene, camera);
  }

  async function doSave(){
    const value = mode==='distance' ? polylineLength3D(anchors) : polygonArea3D(anchors);
    if(!projectId){ toast('请从项目内发起 AR 测量以保存结果','err'); return; }
    await DB.put('measures', {
      id:uid(), projectId, pointId:null,
      kind: mode==='distance'?'ar-distance':'ar-area',
      value:+value.toFixed(mode==='distance'?3:3),
      unit: mode==='distance'?'m':'㎡',
      detail:{ points:anchors.map(p=>({x:+p.x.toFixed(3),y:+p.y.toFixed(3),z:+p.z.toFixed(3)})) },
      createdAt:Date.now(),
    });
    toast('AR 测量结果已保存','ok');
    session.end();
    if(MeasureRecord) MeasureRecord.refresh(projectId);
  }

  function cleanup(){
    running=false;
    if(renderer) renderer.setAnimationLoop(null);
    if(session){ try{session.end();}catch(_){} session=null; }
    if(renderer){ renderer.dispose(); renderer.domElement.remove(); renderer=null; }
    const l=$('#ar-layer');
    l.hidden=true; l.innerHTML='';
    anchors=[];lineObj=fillObj=null;
  }

  return { start, checkSupported, supportStatus, cleanup,
           _poly: {polygonArea3D, polylineLength3D} };
})();

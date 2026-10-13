/* 现场测量标注 - 标注编辑器（canvas）
 * 标注数据全部使用归一化坐标(0~1)，与显示分辨率解耦：
 *   dim  { type:'dim',  p1:[x,y], p2:[x,y], value, unit }
 *   text { type:'text', p:[x,y], text, size }
 *   mark { type:'mark', p:[x,y], label }         label 自动连续编号
 *   pen  { type:'pen', points:[[x,y],...] }
 *   scale(参照比例) { p1, p2, real, unit } —— 测线据此自动换算实际长度
 */
window.CLEditor = (function () {
  'use strict';

  var LW = 0.0042;        /* 标注线宽（相对图宽） */
  var FONT = 0.0205;      /* 文字大小（相对图宽） */
  var MARK_R = 0.0155;    /* 标记圆半径（相对图宽） */
  var HIT = 12;           /* 擦除命中半径（css px） */
  var TAP_SLOP = 7;       /* 点击/拖动判定阈值（css px） */
  var MAX_HISTORY = 40;

  var DIM_COLOR = '#ef4444';
  var PEN_COLOR = '#ef4444';
  var MARK_COLOR = '#ef4444';
  var SCALE_COLOR = '#2563eb';

  function uid() {
    return 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function isTapTool(t) {
    return t === 'dim' || t === 'scale' || t === 'text' || t === 'mark' || t === 'erase';
  }

  /* ================= 图像工具 ================= */
  function loadBitmap(blob) {
    if (window.createImageBitmap) {
      return createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(function () {
        return loadViaImg(blob);
      });
    }
    return loadViaImg(blob);
  }
  function loadViaImg(blob) {
    return new Promise(function (res, rej) {
      var img = new Image();
      img.onload = function () { res(img); };
      img.onerror = function () { rej(new Error('图片加载失败')); };
      img.src = URL.createObjectURL(blob);
    });
  }

  /* 拍照/选图后统一压到 maxDim 以内，兼顾编辑性能与存储体积 */
  function downscaleBlob(blob, maxDim, quality) {
    return loadBitmap(blob).then(function (bmp) {
      var w = bmp.width, h = bmp.height;
      var m = Math.max(w, h);
      if (m > maxDim) {
        var k = maxDim / m;
        w = Math.round(w * k);
        h = Math.round(h * k);
      }
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(bmp, 0, 0, w, h);
      if (bmp.close) { try { bmp.close(); } catch (e) {} }
      return new Promise(function (res) { c.toBlob(res, 'image/jpeg', quality || 0.92); });
    });
  }

  /* ================= 绘制（编辑视图与导出共用） ================= */
  function fontStr(size) {
    return '600 ' + size + 'px -apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif';
  }
  function line(ctx, x1, y1, x2, y2) {
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }

  function drawAll(ctx, anns, scale, W, H) {
    var i, a;
    if (scale && scale.p1 && scale.p2) drawScaleRef(ctx, scale, W, H);
    for (i = 0; i < anns.length; i++) {
      a = anns[i];
      if (a.type === 'dim') drawDim(ctx, a, W, H);
      else if (a.type === 'text') drawText(ctx, a, W, H);
      else if (a.type === 'mark') drawMark(ctx, a, W, H);
      else if (a.type === 'pen') drawPen(ctx, a, W, H);
    }
  }

  function drawDim(ctx, a, W, H) {
    var x1 = a.p1[0] * W, y1 = a.p1[1] * H;
    var x2 = a.p2[0] * W, y2 = a.p2[1] * H;
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len;
    var nx = -uy, ny = ux;
    var lw = Math.max(1.4, LW * W);
    var tick = lw * 3.6;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = DIM_COLOR;
    ctx.lineWidth = lw;
    line(ctx, x1, y1, x2, y2);
    line(ctx, x1 + nx * tick, y1 + ny * tick, x1 - nx * tick, y1 - ny * tick);
    line(ctx, x2 + nx * tick, y2 + ny * tick, x2 - nx * tick, y2 - ny * tick);
    var fs = Math.max(10, FONT * W);
    var label = (a.value !== '' && a.value != null) ? (a.value + (a.unit || '')) : '?';
    var off = fs * 0.95;
    var lx = (x1 + x2) / 2 + nx * off;
    var ly = (y1 + y2) / 2 + ny * off;
    ctx.font = fontStr(fs);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, lw * 1.1);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = '#111827';
    ctx.fillText(label, lx, ly);
    ctx.restore();
  }

  function drawText(ctx, a, W, H) {
    var fs = Math.max(10, FONT * W * (a.size || 1));
    var lines = String(a.text || '').split('\n');
    var lh = fs * 1.28;
    var x = a.p[0] * W;
    var y0 = a.p[1] * H;
    ctx.save();
    ctx.font = fontStr(fs);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, fs * 0.16);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.fillStyle = '#ffffff';
    for (var i = 0; i < lines.length; i++) {
      var y = y0 + (i - (lines.length - 1) / 2) * lh;
      ctx.strokeText(lines[i], x, y);
      ctx.fillText(lines[i], x, y);
    }
    ctx.restore();
  }

  function drawMark(ctx, a, W, H) {
    var r = MARK_R * W;
    var x = a.p[0] * W;
    var y = a.p[1] * H;
    var fs = r * 1.15;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = MARK_COLOR;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, r * 0.14);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
    ctx.font = fontStr(fs);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(a.label != null ? a.label : ''), x, y + fs * 0.04);
    ctx.restore();
  }

  function drawPen(ctx, a, W, H) {
    var pts = a.points || [];
    ctx.save();
    ctx.strokeStyle = PEN_COLOR;
    ctx.lineWidth = Math.max(1.6, LW * 1.15 * W);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (pts.length === 1) {
      ctx.beginPath();
      ctx.arc(pts[0][0] * W, pts[0][1] * H, ctx.lineWidth / 2, 0, Math.PI * 2);
      ctx.fillStyle = PEN_COLOR;
      ctx.fill();
    } else if (pts.length > 1) {
      ctx.beginPath();
      ctx.moveTo(pts[0][0] * W, pts[0][1] * H);
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0] * W, pts[i][1] * H);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawScaleRef(ctx, s, W, H) {
    var x1 = s.p1[0] * W, y1 = s.p1[1] * H;
    var x2 = s.p2[0] * W, y2 = s.p2[1] * H;
    var dx = x2 - x1, dy = y2 - y1;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    var ux = dx / len, uy = dy / len;
    var nx = -uy, ny = ux;
    var lw = Math.max(1.4, LW * 0.9 * W);
    var tick = lw * 3.4;
    ctx.save();
    ctx.strokeStyle = SCALE_COLOR;
    ctx.lineWidth = lw;
    ctx.setLineDash([lw * 3, lw * 2.2]);
    line(ctx, x1, y1, x2, y2);
    ctx.setLineDash([]);
    line(ctx, x1 + nx * tick, y1 + ny * tick, x1 - nx * tick, y1 - ny * tick);
    line(ctx, x2 + nx * tick, y2 + ny * tick, x2 - nx * tick, y2 - ny * tick);
    var fs = Math.max(10, FONT * 0.85 * W);
    ctx.font = fontStr(fs);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var label = '参照 ' + s.real + (s.unit || '');
    var off = fs * 0.95;
    var lx = (x1 + x2) / 2 - nx * off;
    var ly = (y1 + y2) / 2 - ny * off;
    ctx.lineWidth = Math.max(2, lw);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeText(label, lx, ly);
    ctx.fillStyle = SCALE_COLOR;
    ctx.fillText(label, lx, ly);
    ctx.restore();
  }

  /* 导出/分享：照片 + 标注 拼合为单张图 */
  function flatten(blob, annotations, scale, opts) {
    opts = opts || {};
    return loadBitmap(blob).then(function (bmp) {
      var w = bmp.width, h = bmp.height;
      var m = Math.max(w, h);
      var maxDim = opts.maxDim || 0;
      if (maxDim && m > maxDim) {
        var k = maxDim / m;
        w = Math.round(w * k);
        h = Math.round(h * k);
      }
      var c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      var ctx = c.getContext('2d');
      ctx.drawImage(bmp, 0, 0, w, h);
      drawAll(ctx, annotations || [], scale || null, w, h);
      if (bmp.close) { try { bmp.close(); } catch (e) {} }
      return new Promise(function (res) {
        c.toBlob(res, opts.type || 'image/jpeg', opts.quality || 0.95);
      });
    });
  }

  /* ================= 编辑器 ================= */
  function createEditor(mount, opts) {
    opts = opts || {};
    var blob = opts.blob;

    var S = {
      tool: opts.tool || 'pan',
      img: null,
      iw: 0,
      ih: 0,
      anns: clone(opts.annotations || []),
      scale: opts.scale ? clone(opts.scale) : null,
      view: { zoom: 1, x: 0, y: 0 },
      fit: 1,
      cssW: 0,
      cssH: 0,
      dpr: Math.min(3, window.devicePixelRatio || 1),
      history: [],
      pending: null,      /* { type:'dim'|'scale', p1 } 等待第二点 */
      pointers: new Map(),
      pinch: null,
      penPts: null,
      down: null,
      last: null,
      moved: false,
      dirty: false
    };

    mount.classList.add('ed-mount');
    mount.innerHTML =
      '<div class="ed-wrap">' +
      '<canvas class="ed-canvas"></canvas>' +
      '<div class="ed-pending" style="display:none"></div>' +
      '</div>';
    var canvas = mount.querySelector('.ed-canvas');
    var pendingEl = mount.querySelector('.ed-pending');
    var ctx = canvas.getContext('2d');

    /* ---------- 尺寸适配 ---------- */
    function resize() {
      var r = mount.getBoundingClientRect();
      if (!r.width || !r.height) return;
      S.cssW = r.width;
      S.cssH = r.height;
      canvas.width = Math.round(S.cssW * S.dpr);
      canvas.height = Math.round(S.cssH * S.dpr);
      canvas.style.width = S.cssW + 'px';
      canvas.style.height = S.cssH + 'px';
      if (S.iw) {
        S.fit = Math.min(S.cssW / S.iw, S.cssH / S.ih);
        clampView();
      }
      render();
    }
    var ro = window.ResizeObserver ? new ResizeObserver(resize) : null;
    if (ro) ro.observe(mount);
    else window.addEventListener('resize', resize);

    function clampView() {
      var k = S.fit * S.view.zoom;
      var dw = S.iw * k;
      var dh = S.ih * k;
      if (dw <= S.cssW) S.view.x = (S.cssW - dw) / 2;
      else S.view.x = Math.min(0, Math.max(S.cssW - dw, S.view.x));
      if (dh <= S.cssH) S.view.y = (S.cssH - dh) / 2;
      else S.view.y = Math.min(0, Math.max(S.cssH - dh, S.view.y));
    }

    /* ---------- 坐标换算 ---------- */
    function evPos(e) {
      var r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    function toNorm(lx, ly) {
      var k = S.fit * S.view.zoom;
      return [(lx - S.view.x) / (S.iw * k), (ly - S.view.y) / (S.ih * k)];
    }
    function toScreen(n) {
      var k = S.fit * S.view.zoom;
      return [S.view.x + n[0] * S.iw * k, S.view.y + n[1] * S.ih * k];
    }

    /* ---------- 渲染 ---------- */
    function render() {
      if (!S.iw) return;
      ctx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      ctx.fillStyle = '#e5e7eb';
      ctx.fillRect(0, 0, S.cssW, S.cssH);
      var k = S.fit * S.view.zoom;
      ctx.save();
      ctx.translate(S.view.x, S.view.y);
      ctx.scale(k, k);
      ctx.drawImage(S.img, 0, 0);
      drawAll(ctx, S.anns, S.scale, S.iw, S.ih);
      ctx.restore();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(17,24,39,0.25)';
      ctx.strokeRect(S.view.x - 0.5, S.view.y - 0.5, S.iw * k + 1, S.ih * k + 1);
      if (S.pending) {
        var p = toScreen(S.pending.p1);
        ctx.strokeStyle = S.pending.type === 'scale' ? SCALE_COLOR : DIM_COLOR;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(p[0], p[1], 8, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(p[0] - 13, p[1]); ctx.lineTo(p[0] - 4, p[1]);
        ctx.moveTo(p[0] + 4, p[1]); ctx.lineTo(p[0] + 13, p[1]);
        ctx.moveTo(p[0], p[1] - 13); ctx.lineTo(p[0], p[1] - 4);
        ctx.moveTo(p[0], p[1] + 4); ctx.lineTo(p[0], p[1] + 13);
        ctx.stroke();
      }
      updatePendingInfo();
    }

    function updatePendingInfo() {
      var t = '';
      if (S.pending) {
        t = S.pending.type === 'scale' ? '参照：再点一点确定终点' : '测线：再点一点确定终点';
      } else if (S.scale) {
        t = '已设参照 ' + S.scale.real + (S.scale.unit || '') + '，测线自动换算';
      }
      pendingEl.textContent = t;
      pendingEl.style.display = t ? 'block' : 'none';
    }

    /* ---------- 参照比例 / 自动换算 ---------- */
    function pxPerUnit() {
      if (!S.scale) return 0;
      var dx = (S.scale.p2[0] - S.scale.p1[0]) * S.iw;
      var dy = (S.scale.p2[1] - S.scale.p1[1]) * S.ih;
      var px = Math.sqrt(dx * dx + dy * dy);
      return px / (S.scale.real || 1);
    }
    function autoValue(p1, p2) {
      var ppu = pxPerUnit();
      if (!ppu) return null;
      var dx = (p2[0] - p1[0]) * S.iw;
      var dy = (p2[1] - p1[1]) * S.ih;
      var v = Math.sqrt(dx * dx + dy * dy) / ppu;
      return Math.round(v * 10) / 10;
    }

    /* ---------- 历史 ---------- */
    function pushHistory() {
      S.history.push({ a: clone(S.anns), s: S.scale ? clone(S.scale) : null });
      if (S.history.length > MAX_HISTORY) S.history.shift();
    }
    function touch() {
      S.dirty = true;
      if (typeof opts.onChange === 'function') opts.onChange();
    }
    function renumberMarks() {
      var marks = S.anns.filter(function (a) { return a.type === 'mark'; });
      marks.sort(function (a, b) { return (a._t || 0) - (b._t || 0); });
      marks.forEach(function (m, i) { m.label = i + 1; });
    }

    /* ---------- 命中测试（擦除） ---------- */
    function distSeg(px, py, x1, y1, x2, y2) {
      var dx = x2 - x1, dy = y2 - y1;
      var L = dx * dx + dy * dy;
      var t = L ? ((px - x1) * dx + (py - y1) * dy) / L : 0;
      t = Math.max(0, Math.min(1, t));
      var cx = x1 + t * dx;
      var cy = y1 + t * dy;
      return Math.sqrt((px - cx) * (px - cx) + (py - cy) * (py - cy));
    }
    function hitTest(n) {
      var k = S.fit * S.view.zoom;
      var tol = HIT / k;
      var px = n[0] * S.iw;
      var py = n[1] * S.ih;
      for (var i = S.anns.length - 1; i >= 0; i--) {
        var a = S.anns[i];
        if (a.type === 'dim') {
          if (distSeg(px, py, a.p1[0] * S.iw, a.p1[1] * S.ih, a.p2[0] * S.iw, a.p2[1] * S.ih) < tol + LW * S.iw) return i;
        } else if (a.type === 'mark') {
          var mx = a.p[0] * S.iw;
          var my = a.p[1] * S.ih;
          if (Math.sqrt((px - mx) * (px - mx) + (py - my) * (py - my)) < MARK_R * S.iw + tol) return i;
        } else if (a.type === 'text') {
          var tx = a.p[0] * S.iw;
          var ty = a.p[1] * S.ih;
          var fs = FONT * S.iw * (a.size || 1);
          ctx.font = fontStr(fs);
          var lines = String(a.text || '').split('\n');
          var wmax = 0;
          for (var j = 0; j < lines.length; j++) {
            wmax = Math.max(wmax, ctx.measureText(lines[j]).width);
          }
          var hh = fs * 1.28 * lines.length;
          if (px >= tx - tol && px <= tx + wmax + tol && py >= ty - hh / 2 - tol && py <= ty + hh / 2 + tol) return i;
        } else if (a.type === 'pen') {
          var pts = a.points || [];
          for (var j2 = 0; j2 < pts.length - 1; j2++) {
            if (distSeg(px, py, pts[j2][0] * S.iw, pts[j2][1] * S.ih, pts[j2 + 1][0] * S.iw, pts[j2 + 1][1] * S.ih) < tol + LW * 1.15 * S.iw) return i;
          }
        }
      }
      return -1;
    }

    /* ---------- 点击处理 ---------- */
    function handleTap(n) {
      if (S.tool === 'dim' || S.tool === 'scale') {
        if (!S.pending) {
          S.pending = { type: S.tool, p1: n };
          render();
          return;
        }
        var type = S.pending.type;
        var p1 = S.pending.p1;
        var p2 = n;
        S.pending = null;
        if (type === 'dim') {
          var auto = autoValue(p1, p2);
          Promise.resolve(typeof opts.onDim === 'function' && opts.onDim({
            p1: p1,
            p2: p2,
            auto: auto,
            unit: S.scale ? S.scale.unit : 'mm'
          })).then(function (r) {
            if (r && r.value !== '' && r.value != null) {
              pushHistory();
              S.anns.push({
                type: 'dim',
                id: uid(),
                p1: p1,
                p2: p2,
                value: r.value,
                unit: r.unit || 'mm',
                _t: Date.now()
              });
              touch();
            }
            render();
          });
        } else {
          Promise.resolve(typeof opts.onScale === 'function' && opts.onScale({
            p1: p1,
            p2: p2
          })).then(function (r) {
            if (r && r.real !== '' && r.real != null) {
              pushHistory();
              S.scale = { p1: p1, p2: p2, real: r.real, unit: r.unit || 'mm' };
              touch();
            }
            render();
          });
        }
        render();
      } else if (S.tool === 'text') {
        Promise.resolve(typeof opts.onText === 'function' && opts.onText(n)).then(function (r) {
          if (r && r.text) {
            pushHistory();
            S.anns.push({
              type: 'text',
              id: uid(),
              p: n,
              text: r.text,
              size: r.size || 1,
              _t: Date.now()
            });
            touch();
          }
          render();
        });
      } else if (S.tool === 'mark') {
        pushHistory();
        S.anns.push({ type: 'mark', id: uid(), p: n, label: '', _t: Date.now() });
        renumberMarks();
        touch();
        render();
      } else if (S.tool === 'erase') {
        var idx = hitTest(n);
        if (idx >= 0) {
          pushHistory();
          S.anns.splice(idx, 1);
          renumberMarks();
          touch();
        }
        render();
      }
    }

    /* ---------- 指针事件 ---------- */
    canvas.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
      S.pointers.set(e.pointerId, evPos(e));
      if (S.pointers.size === 2) {
        var pts = Array.from(S.pointers.values());
        S.pinch = {
          d0: Math.sqrt(Math.pow(pts[0].x - pts[1].x, 2) + Math.pow(pts[0].y - pts[1].y, 2)) || 1,
          m0: [(pts[0].x + pts[1].x) / 2, (pts[0].y + pts[1].y) / 2],
          z0: S.view.zoom,
          x0: S.view.x,
          y0: S.view.y
        };
        S.penPts = null;
        return;
      }
      if (S.pointers.size === 1) {
        S.down = evPos(e);
        S.last = { x: S.down.x, y: S.down.y };
        S.moved = false;
        if (S.tool === 'pen') {
          S.penPts = [toNorm(S.down.x, S.down.y)];
        }
      }
    });

    canvas.addEventListener('pointermove', function (e) {
      if (!S.pointers.has(e.pointerId)) return;
      e.preventDefault();
      S.pointers.set(e.pointerId, evPos(e));
      var pos = S.pointers.get(e.pointerId);

      if (S.pinch && S.pointers.size >= 2) {
        var pts = Array.from(S.pointers.values());
        var d = Math.sqrt(Math.pow(pts[0].x - pts[1].x, 2) + Math.pow(pts[0].y - pts[1].y, 2)) || 1;
        var mx = (pts[0].x + pts[1].x) / 2;
        var my = (pts[0].y + pts[1].y) / 2;
        var z = Math.max(0.5, Math.min(8, S.pinch.z0 * d / S.pinch.d0));
        var k0 = S.fit * S.pinch.z0;
        var k1 = S.fit * z;
        var ix = (S.pinch.m0[0] - S.pinch.x0) / k0;
        var iy = (S.pinch.m0[1] - S.pinch.y0) / k0;
        S.view.zoom = z;
        S.view.x = mx - ix * k1;
        S.view.y = my - iy * k1;
        clampView();
        render();
        return;
      }

      if (!S.last) S.last = { x: pos.x, y: pos.y };
      var dx = pos.x - S.last.x;
      var dy = pos.y - S.last.y;
      S.last = { x: pos.x, y: pos.y };

      if (S.down && !S.moved) {
        var tdx = pos.x - S.down.x;
        var tdy = pos.y - S.down.y;
        if (Math.sqrt(tdx * tdx + tdy * tdy) > TAP_SLOP) S.moved = true;
      }

      if (S.tool === 'pen' && S.penPts) {
        var n = toNorm(pos.x, pos.y);
        var lastPt = S.penPts[S.penPts.length - 1];
        var k = S.fit * S.view.zoom;
        if (Math.abs(n[0] - lastPt[0]) * S.iw * k > 2 || Math.abs(n[1] - lastPt[1]) * S.ih * k > 2) {
          S.penPts.push(n);
          render();
        }
        return;
      }

      if (S.moved && (S.tool === 'pan' || isTapTool(S.tool))) {
        S.view.x += dx;
        S.view.y += dy;
        clampView();
        render();
      }
    });

    function endPointer(e) {
      var had = S.pointers.has(e.pointerId);
      S.pointers.delete(e.pointerId);
      if (S.pointers.size < 2) S.pinch = null;
      if (S.pointers.size !== 0 || !had) return;

      if (S.tool === 'pen' && S.penPts) {
        if (S.penPts.length >= 1) {
          pushHistory();
          S.anns.push({ type: 'pen', id: uid(), points: S.penPts, _t: Date.now() });
          touch();
        }
        S.penPts = null;
      } else if (!S.moved && S.down) {
        /* 不加双击判定：快速点两下是测线/比例的核心操作，不能被"双击重置"吞掉；
           视图复位请用工具栏「复位」按钮 */
        handleTap(toNorm(S.down.x, S.down.y));
      }
      S.down = null;
      S.last = null;
      S.moved = false;
      render();
    }
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    /* 桌面端滚轮缩放 */
    canvas.addEventListener('wheel', function (e) {
      e.preventDefault();
      var pos = evPos(e);
      var factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      zoomAt(pos.x, pos.y, factor);
    }, { passive: false });

    function zoomAt(mx, my, factor) {
      var z = Math.max(0.5, Math.min(8, S.view.zoom * factor));
      var k0 = S.fit * S.view.zoom;
      var k1 = S.fit * z;
      var ix = (mx - S.view.x) / k0;
      var iy = (my - S.view.y) / k0;
      S.view.zoom = z;
      S.view.x = mx - ix * k1;
      S.view.y = my - iy * k1;
      clampView();
      render();
    }

    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    function resetView() {
      S.view.zoom = 1;
      clampView();
      render();
    }

    /* ---------- 加载图片 ---------- */
    loadBitmap(blob).then(function (bmp) {
      S.img = bmp;
      S.iw = bmp.width;
      S.ih = bmp.height;
      resize();
      if (typeof opts.onReady === 'function') opts.onReady();
    }).catch(function () {
      if (typeof opts.onError === 'function') opts.onError();
    });

    /* ---------- 对外接口 ---------- */
    return {
      setTool: function (t) {
        S.tool = t;
        S.pending = null;
        S.penPts = null;
        render();
      },
      getTool: function () { return S.tool; },
      undo: function () {
        var h = S.history.pop();
        if (!h) return;
        S.anns = h.a;
        S.scale = h.s;
        S.pending = null;
        renumberMarks();
        touch();
        render();
      },
      resetView: resetView,
      getData: function () {
        return { annotations: clone(S.anns), scale: S.scale ? clone(S.scale) : null };
      },
      isDirty: function () { return S.dirty; },
      destroy: function () {
        if (ro) ro.disconnect();
        else window.removeEventListener('resize', resize);
        mount.innerHTML = '';
        mount.classList.remove('ed-mount');
      }
    };
  }

  return {
    createEditor: createEditor,
    loadBitmap: loadBitmap,
    downscaleBlob: downscaleBlob,
    flatten: flatten
  };
})();

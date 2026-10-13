/* 现场测量标注 v001 - 主程序
 * 单机版：拍照 → 标注 → 本地保存(IndexedDB) → 分享/导出
 * 后续可平滑升级： shots 表中的 image/annotations 字段原样同步到云端存储
 */
(function () {
  'use strict';

  var VERSION = 'v001';
  var app = document.getElementById('app');
  var modalRoot = document.getElementById('modal-root');
  var toastRoot = document.getElementById('toast-root');

  var state = {
    stack: [],
    projects: [],
    shotsCache: null,
    editor: null,
    editorShot: null,
    editorBlob: null,
    editorDirty: false,
    pendingProjectId: null
  };

  /* ================= 基础工具 ================= */
  function h(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstChild;
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function fmtTime(ts) {
    var d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }
  function toast(msg, ms) {
    var el = h('<div class="toast"></div>');
    el.textContent = msg;
    toastRoot.appendChild(el);
    setTimeout(function () { el.classList.add('show'); }, 10);
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { el.remove(); }, 300);
    }, ms || 2200);
  }

  /* 临时对象 URL 统一管理：render() 先替换 DOM、再回收旧 URL，避免误撤新图 */
  var _urls = [];
  var _domUrls = [];
  function objUrl(blob) {
    var u = URL.createObjectURL(blob);
    _urls.push(u);
    return u;
  }
  function render(html) {
    var stale = _domUrls;
    _domUrls = _urls;
    _urls = [];
    app.innerHTML = html;
    stale.forEach(function (u) { URL.revokeObjectURL(u); });
  }

  /* ================= 弹窗 ================= */
  function showModal(cfg) {
    return new Promise(function (resolve) {
      var fieldsHtml = '';
      (cfg.fields || []).forEach(function (f, i) {
        var val = f.value == null ? '' : f.value;
        if (f.type === 'select') {
          var opts = (f.options || []).map(function (o) {
            return '<option value="' + esc(o.value) + '"' + (String(o.value) === String(val) ? ' selected' : '') + '>' + esc(o.label) + '</option>';
          }).join('');
          fieldsHtml += '<label class="fld"><span>' + esc(f.label) + '</span><select data-i="' + i + '">' + opts + '</select></label>';
        } else if (f.type === 'textarea') {
          fieldsHtml += '<label class="fld"><span>' + esc(f.label) + '</span><textarea data-i="' + i + '" rows="3" placeholder="' + esc(f.placeholder || '') + '">' + esc(val) + '</textarea></label>';
        } else if (f.type === 'seg') {
          var segs = (f.options || []).map(function (o) {
            return '<button type="button" class="seg-btn' + (String(o.value) === String(val) ? ' on' : '') + '" data-v="' + esc(o.value) + '">' + esc(o.label) + '</button>';
          }).join('');
          fieldsHtml += '<div class="fld"><span>' + esc(f.label) + '</span><div class="seg">' + segs + '</div>' +
            '<input type="hidden" data-i="' + i + '" value="' + esc(val) + '"></div>';
        } else {
          fieldsHtml += '<label class="fld"><span>' + esc(f.label) + '</span>' +
            '<input type="' + (f.type || 'text') + '" data-i="' + i + '" value="' + esc(val) + '" placeholder="' + esc(f.placeholder || '') + '"' +
            (f.inputmode ? ' inputmode="' + f.inputmode + '"' : '') + '></label>';
        }
      });
      var el = h(
        '<div class="mask"><div class="dialog" role="dialog">' +
        '<div class="dlg-title">' + esc(cfg.title || '') + '</div>' +
        (cfg.desc ? '<div class="dlg-desc">' + esc(cfg.desc) + '</div>' : '') +
        (fieldsHtml ? '<div class="dlg-body">' + fieldsHtml + '</div>' : '') +
        '<div class="dlg-btns">' +
        '<button class="btn ghost" data-act="cancel">' + esc(cfg.cancelText || '取消') + '</button>' +
        '<button class="btn ' + (cfg.danger ? 'danger' : 'primary') + '" data-act="ok">' + esc(cfg.okText || '确定') + '</button>' +
        '</div></div></div>'
      );
      modalRoot.appendChild(el);
      var firstInput = el.querySelector('input:not([type=hidden]),textarea,select');
      if (firstInput && cfg.autofocus !== false) {
        setTimeout(function () { try { firstInput.focus(); } catch (e) {} }, 80);
      }
      el.addEventListener('click', function (e) {
        if (e.target === el) { close(null); return; }
        var seg = e.target.closest ? e.target.closest('.seg-btn') : null;
        if (seg) {
          var wrap = seg.parentElement;
          wrap.querySelectorAll('.seg-btn').forEach(function (x) { x.classList.remove('on'); });
          seg.classList.add('on');
          wrap.parentElement.querySelector('input[type=hidden]').value = seg.getAttribute('data-v');
          return;
        }
        var btn = e.target.closest ? e.target.closest('[data-act]') : null;
        if (!btn) return;
        if (btn.getAttribute('data-act') === 'cancel') { close(null); return; }
        var vals = {};
        el.querySelectorAll('[data-i]').forEach(function (inp) {
          var f = cfg.fields[+inp.getAttribute('data-i')];
          vals[f.name] = inp.value;
        });
        close(vals);
      });
      function close(v) {
        el.remove();
        resolve(v);
      }
    });
  }

  /* ================= 数据 ================= */
  function refreshData() {
    return Promise.all([CLDB.listProjects(), CLDB.listShots()]).then(function (r) {
      state.projects = r[0];
      state.shotsCache = r[1];
    });
  }
  function allShots() {
    if (state.shotsCache) return Promise.resolve(state.shotsCache);
    return CLDB.listShots().then(function (list) {
      state.shotsCache = list;
      return list;
    });
  }
  function projectName(id) {
    if (!id) return '未分组';
    var p = state.projects.find(function (x) { return x.id === id; });
    return p ? p.name : '未分组';
  }

  /* ================= 路由 ================= */
  function go(name, params) {
    state.stack.push({ name: name, params: params || {} });
    renderTop();
  }
  function back() {
    if (state.stack.length > 1) {
      state.stack.pop();
      renderTop();
    }
  }
  function replace(name, params) {
    state.stack[state.stack.length - 1] = { name: name, params: params || {} };
    renderTop();
  }
  function switchTab(name) {
    var cur = state.stack[state.stack.length - 1];
    if (cur.name === name) return;
    state.stack = [{ name: name, params: {} }];
    renderTop();
  }
  function renderTop() {
    var top = state.stack[state.stack.length - 1];
    if (top.name !== 'editor' && state.editor) destroyEditor();
    var fn = VIEWS[top.name] || VIEWS.home;
    fn(top.params);
  }

  function destroyEditor() {
    if (state.editor) {
      try { state.editor.destroy(); } catch (e) {}
    }
    state.editor = null;
    state.editorShot = null;
    state.editorBlob = null;
    state.editorDirty = false;
  }

  /* ================= 通用片段 ================= */
  function emptyBox(t, d) {
    return '<div class="empty"><div class="empty-t">' + esc(t) + '</div><div class="empty-d">' + esc(d) + '</div></div>';
  }
  function tabbar(active) {
    return '<nav class="tabbar">' +
      '<button class="tab' + (active === 'home' ? ' on' : '') + '" data-action="tab-home"><span class="tab-ico">⌂</span>首页</button>' +
      '<button class="tab' + (active === 'projects' ? ' on' : '') + '" data-action="tab-projects"><span class="tab-ico">▤</span>项目</button>' +
      '</nav>';
  }
  function shotCard(s) {
    var url = objUrl(s.thumb || s.image);
    return '<button class="card" data-action="open-shot" data-id="' + s.id + '">' +
      '<img class="card-img" src="' + url + '" alt="" loading="lazy">' +
      '<div class="card-name">' + esc(s.name) + '</div>' +
      '<div class="card-meta">' + esc(projectName(s.projectId)) + ' · ' + esc(fmtTime(s.updatedAt).slice(5)) + '</div>' +
      '</button>';
  }

  /* ================= 视图：首页 ================= */
  function viewHome() {
    allShots().then(function (shots) {
      var recent = shots.slice(0, 6);
      var projects = state.projects;
      var html =
        '<header class="topbar"><div class="topbar-title">现场测量标注</div><div class="topbar-sub">' + VERSION + ' · 本地版</div></header>' +
        '<main class="view">' +
        '<button class="big-cta" data-action="new-shot">' +
        '<span class="big-cta-ico">📷</span>' +
        '<span class="big-cta-txt">新建测量<small>拍照 → 标注尺寸 → 保存</small></span>' +
        '</button>';
      if (recent.length) {
        html += '<section class="sec"><div class="sec-head"><h2>最近测量</h2><button class="link" data-action="go-shots-all">全部 ' + shots.length + ' 条</button></div>' +
          '<div class="grid">' + recent.map(shotCard).join('') + '</div></section>';
      }
      if (projects.length) {
        html += '<section class="sec"><div class="sec-head"><h2>项目</h2><button class="link" data-action="go-projects">管理</button></div>' +
          '<div class="chips">' + projects.slice(0, 8).map(function (p) {
            return '<button class="chip" data-action="go-project" data-id="' + p.id + '">' + esc(p.name) + '</button>';
          }).join('') + '</div></section>';
      }
      if (!shots.length && !projects.length) {
        html += emptyBox('还没有测量记录', '点击上方按钮，拍下第一张现场照片开始标注');
      }
      html += '</main>' + tabbar('home');
      render(html);
    });
  }

  /* ================= 视图：项目 ================= */
  function viewProjects() {
    allShots().then(function (shots) {
      var counts = {};
      shots.forEach(function (s) {
        var k = s.projectId || '';
        counts[k] = (counts[k] || 0) + 1;
      });
      var projects = state.projects;
      var html =
        '<header class="topbar"><div class="topbar-title">项目</div>' +
        '<button class="btn primary sm" data-action="add-project">＋ 新建</button></header>' +
        '<main class="view">';
      if (projects.length) {
        html += '<div class="plist">' + projects.map(function (p) {
          return '<button class="prow" data-action="go-project" data-id="' + p.id + '">' +
            '<div class="prow-main"><div class="prow-name">' + esc(p.name) + '</div>' +
            '<div class="prow-meta">' + (counts[p.id] || 0) + ' 条测量 · ' + esc(fmtTime(p.createdAt).slice(5, 10)) + '创建</div></div>' +
            '<div class="prow-arrow">›</div></button>';
        }).join('') + '</div>';
      } else {
        html += emptyBox('还没有项目', '点击右上角「新建」创建第一个项目，方便按工地归类');
      }
      html += '</main>' + tabbar('projects');
      render(html);
    });
  }

  function viewProject(params) {
    CLDB.getProject(params.id).then(function (p) {
      if (!p) { toast('项目不存在'); back(); return; }
      return allShots().then(function (shots) {
        var mine = shots.filter(function (s) { return s.projectId === p.id; });
        var html =
          '<header class="topbar"><button class="icon-btn" data-action="back">‹</button>' +
          '<div class="topbar-title">' + esc(p.name) + '</div></header>' +
          '<main class="view">' +
          '<div class="pd-head">' +
          '<div class="pd-name">' + esc(p.name) + '</div>' +
          '<div class="pd-meta">' + mine.length + ' 条测量 · 创建于 ' + esc(fmtTime(p.createdAt)) + '</div>' +
          '<div class="pd-acts">' +
          '<button class="btn" data-action="project-rename" data-id="' + p.id + '">重命名</button>' +
          '<button class="btn danger-ghost" data-action="project-delete" data-id="' + p.id + '">删除项目</button>' +
          '</div></div>';
        if (mine.length) {
          html += '<div class="grid">' + mine.map(shotCard).join('') + '</div>';
        } else {
          html += emptyBox('项目还没有测量', '点击下方按钮，为本项目添加第一条测量');
        }
        html += '<button class="btn primary big" style="margin-top:14px" data-action="project-add-shot" data-id="' + p.id + '">＋ 添加测量</button>' +
          '</main>';
        render(html);
      });
    });
  }

  /* ================= 视图：全部测量 ================= */
  function viewShotsAll() {
    allShots().then(function (shots) {
      var html =
        '<header class="topbar"><button class="icon-btn" data-action="back">‹</button>' +
        '<div class="topbar-title">全部测量</div><div class="topbar-sub">' + shots.length + ' 条</div></header>' +
        '<main class="view">';
      if (shots.length) {
        html += '<div class="grid">' + shots.map(shotCard).join('') + '</div>';
      } else {
        html += emptyBox('还没有测量记录', '回到首页，点击「新建测量」开始');
      }
      html += '</main>';
      render(html);
    });
  }

  /* ================= 视图：测量详情 ================= */
  function viewShot(params) {
    CLDB.getShot(params.id).then(function (s) {
      if (!s) { toast('记录不存在'); back(); return; }
      return CLEditor.flatten(s.image, s.annotations, s.scale, { maxDim: 1600 }).then(function (blob) {
        var url = objUrl(blob);
        var html =
          '<header class="topbar"><button class="icon-btn" data-action="back">‹</button>' +
          '<div class="topbar-title">' + esc(s.name) + '</div></header>' +
          '<main class="view">' +
          '<img class="shot-img" src="' + url + '" alt="' + esc(s.name) + '">' +
          '<div class="meta-card">' +
          '<div class="meta-row"><span>所属项目</span><b>' + esc(projectName(s.projectId)) + '</b></div>' +
          '<div class="meta-row"><span>创建时间</span><b>' + esc(fmtTime(s.createdAt)) + '</b></div>' +
          '<div class="meta-row"><span>标注数量</span><b>' + (s.annotations ? s.annotations.length : 0) + ' 个</b></div>' +
          (s.scale ? '<div class="meta-row"><span>参照比例</span><b>' + esc(s.scale.real + (s.scale.unit || '')) + '</b></div>' : '') +
          '</div>' +
          (s.note ? '<div class="meta-card"><div class="meta-note">' + esc(s.note) + '</div></div>' : '') +
          '<div class="act-row">' +
          '<button class="btn primary" data-action="edit-shot" data-id="' + s.id + '">编辑标注</button>' +
          '<button class="btn" data-action="share-shot" data-id="' + s.id + '">分享</button>' +
          '<button class="btn" data-action="export-shot" data-id="' + s.id + '">导出图片</button>' +
          '<button class="btn danger-ghost" data-action="delete-shot" data-id="' + s.id + '">删除</button>' +
          '</div></main>';
        render(html);
      });
    });
  }

  /* ================= 视图：编辑器 ================= */
  function viewEditor() {
    var shot = state.editorShot;
    var html =
      '<header class="topbar">' +
      '<button class="icon-btn" data-action="editor-back">✕</button>' +
      '<div class="topbar-title">' + (shot ? '编辑标注' : '标注测量') + '</div>' +
      '<button class="btn primary sm" data-action="editor-save">保存</button>' +
      '</header>' +
      '<div class="ed-area" id="ed-area"></div>' +
      '<div class="toolbar" id="toolbar"></div>';
    render(html);

    state.editor = CLEditor.createEditor(document.getElementById('ed-area'), {
      blob: state.editorBlob,
      annotations: shot ? shot.annotations : [],
      scale: shot ? shot.scale : null,
      onChange: function () { state.editorDirty = true; },
      onDim: onDimModal,
      onScale: onScaleModal,
      onText: onTextModal,
      onError: function () { toast('图片加载失败'); back(); }
    });
    buildToolbar();
  }

  function buildToolbar() {
    var bar = document.getElementById('toolbar');
    var tools = [
      { t: 'pan', label: '移动', ico: '✥' },
      { t: 'dim', label: '测线', ico: '↔' },
      { t: 'scale', label: '比例', ico: '◺' },
      { t: 'text', label: '文字', ico: 'T' },
      { t: 'mark', label: '标记', ico: '①' },
      { t: 'pen', label: '画笔', ico: '✎' },
      { t: 'erase', label: '擦除', ico: '⌫' }
    ];
    var cur = state.editor.getTool();
    bar.innerHTML = tools.map(function (x) {
      return '<button class="tool' + (cur === x.t ? ' on' : '') + '" data-tool="' + x.t + '">' +
        '<span class="tool-ico">' + x.ico + '</span><span class="tool-label">' + x.label + '</span></button>';
    }).join('') +
      '<span class="tool-sep"></span>' +
      '<button class="tool" data-tact="undo"><span class="tool-ico">↺</span><span class="tool-label">撤销</span></button>' +
      '<button class="tool" data-tact="reset"><span class="tool-ico">⤢</span><span class="tool-label">复位</span></button>';
    bar.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      if (b.hasAttribute('data-tool')) {
        state.editor.setTool(b.getAttribute('data-tool'));
        bar.querySelectorAll('.tool').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
      } else if (b.getAttribute('data-tact') === 'undo') {
        state.editor.undo();
      } else if (b.getAttribute('data-tact') === 'reset') {
        state.editor.resetView();
      }
    });
  }

  /* ---------- 编辑器弹窗 ---------- */
  function unitOptions() {
    return [
      { value: 'mm', label: 'mm' },
      { value: 'cm', label: 'cm' },
      { value: 'm', label: 'm' }
    ];
  }

  function onDimModal(d) {
    return showModal({
      title: '标注尺寸',
      desc: d.auto != null ? '按参照比例自动换算，可手动修正' : '输入实测长度',
      fields: [
        { type: 'number', name: 'value', label: '长度', value: d.auto != null ? d.auto : '', placeholder: '如 3500', inputmode: 'decimal' },
        { type: 'seg', name: 'unit', label: '单位', value: d.unit || 'mm', options: unitOptions() }
      ],
      okText: '确定'
    }).then(function (v) {
      if (!v) return null;
      if (v.value === '' || v.value == null) { toast('请输入长度'); return null; }
      return { value: v.value, unit: v.unit };
    });
  }

  function onScaleModal() {
    return showModal({
      title: '设置参照比例',
      desc: '在已知长度的物体上画一条线（如 A4 纸长 297mm、银行卡宽 85.6mm、地砖 600mm），输入实际长度。设置后测线会自动换算实际尺寸。',
      fields: [
        { type: 'number', name: 'real', label: '参照实际长度', value: '', placeholder: '如 297', inputmode: 'decimal' },
        { type: 'seg', name: 'unit', label: '单位', value: 'mm', options: unitOptions() }
      ],
      okText: '设为参照'
    }).then(function (v) {
      if (!v) return null;
      if (v.real === '' || v.real == null) { toast('请输入参照长度'); return null; }
      return { real: v.real, unit: v.unit };
    });
  }

  function onTextModal() {
    return showModal({
      title: '添加文字',
      fields: [
        { type: 'textarea', name: 'text', label: '内容', placeholder: '如：墙面广告位 宽3.6m 高2.4m' },
        {
          type: 'seg', name: 'size', label: '字号', value: '1', options: [
            { value: '0.8', label: '小' },
            { value: '1', label: '中' },
            { value: '1.3', label: '大' }
          ]
        }
      ],
      okText: '添加'
    }).then(function (v) {
      if (!v || !v.text.trim()) return null;
      return { text: v.text.trim(), size: parseFloat(v.size) || 1 };
    });
  }

  /* ================= 拍照 / 选图 ================= */
  function chooseSource() {
    var el = h(
      '<div class="mask"><div class="dialog">' +
      '<div class="dlg-title">选择照片</div>' +
      '<div class="dlg-desc">现场拍照，或从相册选择已有照片</div>' +
      '<div class="dlg-body chooser">' +
      '<button class="btn primary big" data-src="camera">📷 拍照</button>' +
      '<button class="btn big" data-src="album">🖼 从相册选择</button>' +
      '</div>' +
      '<div class="dlg-btns"><button class="btn ghost" data-src="cancel">取消</button></div>' +
      '</div></div>'
    );
    modalRoot.appendChild(el);
    el.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-src]');
      if (!btn) {
        if (e.target === el) el.remove();
        return;
      }
      var src = btn.getAttribute('data-src');
      el.remove();
      if (src === 'camera') pickFile(true);
      else if (src === 'album') pickFile(false);
    });
  }

  function pickFile(camera) {
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    if (camera) inp.setAttribute('capture', 'environment');
    inp.onchange = function () {
      inp.remove();
      var f = inp.files && inp.files[0];
      if (!f) return;
      toast('处理中…', 4000);
      CLEditor.downscaleBlob(f, 2400, 0.92).then(function (blob) {
        state.editorBlob = blob;
        state.editorShot = null;
        state.editorDirty = false;
        go('editor', {});
      }).catch(function () {
        toast('图片处理失败，请重试');
      });
    };
    /* 挂到文档内：部分安卓 WebView 对脱离文档的 input 不触发 change */
    inp.style.display = 'none';
    document.body.appendChild(inp);
    inp.click();
  }

  /* ================= 保存 / 编辑 / 分享 / 删除 ================= */
  function saveEditor() {
    var ed = state.editor;
    if (!ed) return;
    var data = ed.getData();
    var shot = state.editorShot;

    var projOpts = state.projects.map(function (p) {
      return { value: p.id, label: p.name };
    });
    var defProject = shot && shot.projectId ? shot.projectId
      : (state.pendingProjectId || (projOpts[0] ? projOpts[0].value : ''));

    showModal({
      title: shot ? '保存修改' : '保存测量',
      fields: [
        { type: 'text', name: 'name', label: '名称', value: shot ? shot.name : ('测量 ' + fmtTime(Date.now()).slice(5)) },
        {
          type: 'select', name: 'projectId', label: '所属项目', value: defProject,
          options: [{ value: '', label: '未分组' }].concat(projOpts)
        },
        { type: 'textarea', name: 'note', label: '备注', value: shot ? (shot.note || '') : '', placeholder: '选填，如工地位置、尺寸说明' }
      ],
      okText: '保存'
    }).then(function (v) {
      if (!v) return;
      var name = (v.name || '').trim() || ('测量 ' + fmtTime(Date.now()).slice(5));
      var projectId = v.projectId || null;
      var note = (v.note || '').trim();
      state.pendingProjectId = null;

      toast('保存中…', 5000);
      var thumbP = CLEditor.flatten(state.editorBlob, data.annotations, data.scale, { maxDim: 480, quality: 0.8 });
      thumbP.then(function (thumb) {
        var now = Date.now();
        var rec = {
          id: shot ? shot.id : uid(),
          projectId: projectId,
          name: name,
          note: note,
          image: state.editorBlob,
          thumb: thumb,
          annotations: data.annotations,
          scale: data.scale,
          createdAt: shot ? shot.createdAt : now,
          updatedAt: now
        };
        return CLDB.putShot(rec).then(function () {
          state.editorDirty = false;
          state.shotsCache = null;
          toast('已保存');
          if (shot) {
            /* 重编辑保存：弹掉编辑器层，让底层 shot 视图带新数据重渲染，
               避免 replace 造成栈内重复的 shot 记录 */
            state.stack.pop();
            renderTop();
          } else {
            state.stack.pop();
            go('shot', { id: rec.id });
          }
        });
      }).catch(function () {
        toast('保存失败，请重试');
      });
    });
  }

  function editorBack() {
    var done = function () {
      destroyEditor();
      back();
    };
    if (state.editorDirty) {
      showModal({
        title: '放弃修改',
        desc: '当前标注尚未保存，确定放弃？',
        danger: true,
        okText: '放弃',
        fields: []
      }).then(function (v) {
        if (v) done();
      });
    } else {
      done();
    }
  }

  function editShot(id) {
    CLDB.getShot(id).then(function (s) {
      if (!s) { toast('记录不存在'); return; }
      state.editorBlob = s.image;
      state.editorShot = s;
      state.editorDirty = false;
      go('editor', {});
    });
  }

  function downloadBlob(blob, filename) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  }

  function exportShot(id) {
    CLDB.getShot(id).then(function (s) {
      if (!s) return;
      toast('生成图片中…', 4000);
      CLEditor.flatten(s.image, s.annotations, s.scale, { maxDim: 2400 }).then(function (blob) {
        downloadBlob(blob, s.name + '.jpg');
      });
    });
  }

  function shareShot(id) {
    CLDB.getShot(id).then(function (s) {
      if (!s) return;
      toast('生成图片中…', 4000);
      CLEditor.flatten(s.image, s.annotations, s.scale, { maxDim: 2000 }).then(function (blob) {
        var file = new File([blob], s.name + '.jpg', { type: 'image/jpeg' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          navigator.share({ files: [file], title: s.name, text: s.name }).catch(function () {});
        } else {
          downloadBlob(blob, s.name + '.jpg');
          toast('当前环境不支持直接分享，已改为下载图片');
        }
      });
    });
  }

  function deleteShot(id) {
    showModal({
      title: '删除测量',
      desc: '删除后无法恢复，确定删除这条测量记录？',
      danger: true,
      okText: '删除',
      fields: []
    }).then(function (v) {
      if (!v) return;
      CLDB.deleteShot(id).then(function () {
        state.shotsCache = null;
        toast('已删除');
        back();
      });
    });
  }

  /* ================= 项目操作 ================= */
  function addProject() {
    showModal({
      title: '新建项目',
      fields: [{ type: 'text', name: 'name', label: '项目名称', placeholder: '如：XX商场墙面广告' }],
      okText: '创建'
    }).then(function (v) {
      if (!v || !v.name.trim()) return;
      CLDB.addProject(v.name.trim()).then(function () {
        return refreshData();
      }).then(function () {
        toast('已创建');
        renderTop();
      });
    });
  }

  function projectRename(id) {
    CLDB.getProject(id).then(function (p) {
      if (!p) return;
      showModal({
        title: '重命名项目',
        fields: [{ type: 'text', name: 'name', label: '项目名称', value: p.name }],
        okText: '保存'
      }).then(function (v) {
        if (!v || !v.name.trim()) return;
        CLDB.updateProject({ id: p.id, name: v.name.trim(), createdAt: p.createdAt }).then(function () {
          return refreshData();
        }).then(function () {
          toast('已重命名');
          renderTop();
        });
      });
    });
  }

  function projectDelete(id) {
    showModal({
      title: '删除项目',
      desc: '项目内的所有测量记录也会一并删除，无法恢复。',
      danger: true,
      okText: '删除',
      fields: []
    }).then(function (v) {
      if (!v) return;
      CLDB.deleteProject(id).then(function () {
        return refreshData();
      }).then(function () {
        toast('已删除');
        back();
      });
    });
  }

  /* ================= 事件分发 ================= */
  var ACTIONS = {
    'new-shot': function () { chooseSource(); },
    'go-projects': function () { go('projects'); },
    'go-project': function (t, id) { go('project', { id: id }); },
    'go-shots-all': function () { go('shots-all'); },
    'open-shot': function (t, id) { go('shot', { id: id }); },
    'back': function () { back(); },
    'tab-home': function () { switchTab('home'); },
    'tab-projects': function () { switchTab('projects'); },
    'edit-shot': function (t, id) { editShot(id); },
    'share-shot': function (t, id) { shareShot(id); },
    'export-shot': function (t, id) { exportShot(id); },
    'delete-shot': function (t, id) { deleteShot(id); },
    'editor-save': function () { saveEditor(); },
    'editor-back': function () { editorBack(); },
    'add-project': function () { addProject(); },
    'project-rename': function (t, id) { projectRename(id); },
    'project-delete': function (t, id) { projectDelete(id); },
    'project-add-shot': function (t, id) {
      state.pendingProjectId = id;
      chooseSource();
    }
  };

  var VIEWS = {
    home: viewHome,
    projects: viewProjects,
    project: viewProject,
    'shots-all': viewShotsAll,
    shot: viewShot,
    editor: viewEditor
  };

  app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-action]');
    if (!t) return;
    var act = t.getAttribute('data-action');
    var id = t.getAttribute('data-id');
    if (ACTIONS[act]) ACTIONS[act](t, id, e);
  });

  /* ================= Service Worker（手动检查更新） ================= */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      function watch(w) {
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(reg);
        });
      }
      watch(reg.installing);
      reg.addEventListener('updatefound', function () { watch(reg.installing); });
      if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg);
    }).catch(function () { /* 本地 file:// 或非安全上下文下静默失败 */ });
  }

  function showUpdateBar(reg) {
    if (document.getElementById('update-bar')) return;
    var el = h('<div class="update-bar" id="update-bar">发现新版本 <button class="btn primary sm">立即更新</button></div>');
    document.body.appendChild(el);
    el.querySelector('button').addEventListener('click', function () {
      var w = reg.waiting;
      if (w) w.postMessage('skipWaiting');
    });
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      window.location.reload();
    });
  }

  /* ================= 启动 ================= */
  function boot() {
    if ('history' in window && window.history && 'scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual';
    }
    refreshData().catch(function () {
      toast('本地存储初始化失败（请退出无痕/隐私模式）', 4000);
    }).then(function () {
      state.stack = [{ name: 'home', params: {} }];
      renderTop();
      registerSW();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();

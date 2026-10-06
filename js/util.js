/* ============ 通用工具 ============ */
const $  = (s, el=document) => el.querySelector(s);
const $$ = (s, el=document) => [...el.querySelectorAll(s)];

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function pad2(n){ return String(n).padStart(2,'0'); }
function fmtDate(ts){
  if(!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function fmtDateTime(ts){
  if(!ts) return '';
  const d = new Date(ts);
  return `${fmtDate(ts)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function todayStr(){ return fmtDate(Date.now()); }
function debounce(fn, ms=300){
  let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); };
}
function num(v){ const n = parseFloat(v); return isFinite(n) ? n : 0; }
// 面积：宽cm × 高cm × 数量 → ㎡
function areaM2(w,h,qty){ return (num(w)*num(h)*num(qty||1))/10000; }
function fmtArea(v){ return v > 0 ? v.toFixed(2) : '—'; }

/* ============ 常量 ============ */
const POINT_TYPES = [
  {v:'mentou',  n:'门头',   ico:'🏪'},
  {v:'qiangmian',n:'墙面',   ico:'🧱'},
  {v:'chuchuang',n:'橱窗',   ico:'🪟'},
  {v:'dengxiang',n:'灯箱',   ico:'💡'},
  {v:'faguangzi',n:'发光字', ico:'🔤'},
  {v:'beijing',  n:'背景墙', ico:'🎨'},
  {v:'qita',     n:'其他',   ico:'📐'},
];
const typeName = v => (POINT_TYPES.find(t=>t.v===v)||{}).n || '其他';
const typeIcon = v => (POINT_TYPES.find(t=>t.v===v)||{}).ico || '📐';

const PROJECT_STATUS = [
  {v:'measuring', n:'测量中', cls:'badge-blue'},
  {v:'done',      n:'已完成', cls:'badge-green'},
  {v:'pending',   n:'待测量', cls:'badge-gray'},
];
const statusInfo = v => PROJECT_STATUS.find(s=>s.v===v) || PROJECT_STATUS[0];

const ANNO_COLORS = [
  {v:'#ff3b30', n:'红'},{v:'#ffcc00', n:'黄'},{v:'#ffffff', n:'白'},{v:'#111111', n:'黑'},
];

/* ============ Toast ============ */
let toastTimer = null;
function toast(msg, type=''){
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (type ? ' '+type : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.hidden = true; }, 2200);
}

/* ============ 自定义弹窗 ============ */
const Modal = (() => {
  const root = () => $('#modal-root');

  function open({title='', body='', footer=true, wide=false, onMount}={}){
    return new Promise(resolve => {
      const mask = document.createElement('div');
      mask.className = 'modal-mask';
      mask.innerHTML = `
        <div class="modal${wide?' wide':''}" role="dialog">
          <div class="modal-h"><h3>${esc(title)}</h3>
            <button class="icon-btn" data-act="close">✕</button></div>
          <div class="modal-b"></div>
          ${footer ? `<div class="modal-f">
              <button class="btn" data-act="cancel">取消</button>
              <button class="btn btn-primary" data-act="ok">确定</button>
            </div>` : ''}
        </div>`;
      const bodyEl = $('.modal-b', mask);
      if(typeof body === 'string') bodyEl.innerHTML = body;
      else if(body instanceof Node) bodyEl.appendChild(body);

      const close = val => { mask.remove(); resolve(val); };
      mask.addEventListener('click', e => {
        if(e.target === mask) close(null);
        const act = e.target.closest('[data-act]');
        if(!act) return;
        if(act.dataset.act === 'close' || act.dataset.act === 'cancel') close(null);
        if(act.dataset.act === 'ok') close({ ok:true, modal:mask });
      });
      root().appendChild(mask);
      if(onMount) onMount(mask);
      const first = mask.querySelector('input,select,textarea');
      if(first) setTimeout(()=>first.focus(), 60);
    });
  }

  // 确认框
  function confirm({title='提示', msg='', okText='确定', danger=true}={}){
    return open({
      title,
      body:`<p style="margin:6px 0 2px;font-size:14px;line-height:1.7">${esc(msg)}</p>`,
      onMount(mask){
        const okBtn = $('[data-act=ok]', mask);
        okBtn.textContent = okText;
        if(danger){ okBtn.classList.remove('btn-primary'); okBtn.classList.add('btn-danger'); }
      }
    }).then(r => !!r);
  }

  return { open, confirm };
})();

/* 表单弹窗：fields=[{key,label,value,type,placeholder,required,options,textarea,full}] */
async function formModal({title, fields=[], wide=false, okText='保存'}){
  const rows = fields.map(f => {
    const req = f.required ? '<span class="req">*</span>' : '';
    let ctl;
    if(f.textarea){
      ctl = `<textarea name="${f.key}" placeholder="${esc(f.placeholder||'')}">${esc(f.value??'')}</textarea>`;
    } else if(f.options){
      ctl = `<select name="${f.key}">${f.options.map(o=>{
        const v = typeof o==='object'?o.v:o, n = typeof o==='object'?o.n:o;
        return `<option value="${esc(v)}" ${String(f.value)===String(v)?'selected':''}>${esc(n)}</option>`;
      }).join('')}</select>`;
    } else {
      ctl = `<input type="${f.type||'text'}" name="${f.key}" value="${esc(f.value??'')}"
        placeholder="${esc(f.placeholder||'')}" ${f.step?`step="${f.step}"`:''} ${f.attrs||''}>`;
    }
    return `<div class="field${f.full?' field-full':''}">
      <label>${esc(f.label||'')}${req}</label>${ctl}</div>`;
  }).join('');

  const r = await Modal.open({
    title, wide,
    body:`<form class="field-grid" onsubmit="return false">${rows}</form>`,
    onMount(mask){ $('[data-act=ok]', mask).textContent = okText; },
  });
  if(!r) return null;
  const get = k => r.modal.querySelector(`[name="${k}"]`);
  const data = {};
  for(const f of fields){
    let v = get(f.key).value.trim();
    if(f.required && !v){ toast(`请填写${f.label}`,'err'); return null; }
    if(f.type === 'number') v = v === '' ? '' : num(v);
    data[f.key] = v;
  }
  return data;
}

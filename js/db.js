/* ============ IndexedDB 数据层 ============
stores: clients / projects / points / dimensions / photos */
const DB = (() => {
  const DB_NAME = 'admeasure_db', DB_VER = 2;
  let _db = null;

  const ready = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      const mk = (name, indexes=[]) => {
        const st = db.objectStoreNames.contains(name)
          ? e.target.transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath: 'id' });
        indexes.forEach(([name, keyPath]) => {
          if(!st.indexNames.contains(name)) st.createIndex(name, keyPath);
        });
      };
      mk('clients');
      mk('projects', [['clientId','clientId'],['createdAt','createdAt']]);
      mk('points',   [['projectId','projectId']]);
      mk('dimensions', [['pointId','pointId']]);
      mk('photos',   [['pointId','pointId']]);
      mk('measures', [['projectId','projectId']]);
    };
    req.onsuccess = () => { _db = req.result; resolve(); };
    req.onerror   = () => reject(req.error);
  });

  function reqP(r){
    return new Promise((res, rej)=>{ r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
  }
  function tx(store, mode, fn){
    return new Promise((resolve, reject) => {
      const t = _db.transaction(store, mode);
      t.onabort = t.onerror = () => reject(t.error || new Error('db error'));
      Promise.resolve()
        .then(()=>fn(t.objectStore(store)))
        .then(val => {
          if(mode === 'readwrite') t.oncomplete = () => resolve(val);
          else resolve(val);
        })
        .catch(reject);
    });
  }

  return {
    ready,
    async all(store){
      await ready;
      return tx(store, 'readonly', st => reqP(st.getAll()));
    },
    async get(store, id){
      await ready;
      return tx(store, 'readonly', st => reqP(st.get(id)));
    },
    async byIndex(store, indexName, value){
      await ready;
      return tx(store, 'readonly', st => reqP(st.index(indexName).getAll(value)));
    },
    async put(store, obj){
      await ready;
      await tx(store, 'readwrite', st => reqP(st.put(obj)));
      return obj;
    },
    async putMany(store, arr){
      await ready;
      await tx(store, 'readwrite', st => Promise.all(arr.map(o=>reqP(st.put(o)))));
      return arr;
    },
    async del(store, id){
      await ready;
      await tx(store, 'readwrite', st => reqP(st.delete(id)));
    },
    async clear(store){
      await ready;
      await tx(store, 'readwrite', st => reqP(st.clear()));
    },
    // 估算占用空间（字符串近似）
    async estimate(){
      if(navigator.storage && navigator.storage.estimate){
        const r = await navigator.storage.estimate();
        return { usage:r.usage, quota:r.quota };
      }
      return null;
    },
    async exportAll(){
      await ready;
      const data = { _type:'admeasure-backup', _ver:2, _at:Date.now() };
      for(const s of ['clients','projects','points','dimensions','photos','measures']){
        data[s] = await this.all(s);
      }
      return data;
    },
    async importAll(data){
      await ready;
      const stores = ['clients','projects','points','dimensions','photos','measures'];
      for(const s of stores){
        if(!Array.isArray(data[s])) continue;
        await this.putMany(s, data[s]);
      }
    },
  };
})();

/* ============ 图片处理 ============
读取照片 → 校正EXIF方向 → 压缩大图(最长边1600) 与缩略图(最长边400) */
async function loadOrientedBitmap(file){
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch(e) {
    // 回退：普通加载（不校正方向）
    return await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = reject;
      img.src = url;
    });
  }
}
function drawToDataUrl(src, maxEdge, quality){
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  const w = Math.round(src.width * scale), h = Math.round(src.height * scale);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(src, 0, 0, w, h);
  return { dataUrl: cv.toDataURL('image/jpeg', quality), width:w, height:h };
}
async function processPhotoFile(file){
  const bmp = await loadOrientedBitmap(file);
  const big = drawToDataUrl(bmp, 1600, 0.72);
  const thumb = drawToDataUrl(bmp, 400, 0.65);
  if(bmp.close) bmp.close();
  return { dataUrl:big.dataUrl, width:big.width, height:big.height,
           thumb:thumb.dataUrl, thumbW:thumb.width, thumbH:thumb.height };
}

/* 加载 dataUrl 为 Image */
function loadImage(src){
  return new Promise((res, rej)=>{
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = src;
  });
}

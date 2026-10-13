/* 现场测量标注 - IndexedDB 本地存储层
 * stores:
 *   projects { id, name, createdAt }
 *   shots    { id, projectId, name, note, image(Blob), thumb(Blob),
 *              annotations(Array), scale(Object|null), createdAt, updatedAt }
 */
window.CLDB = (function () {
  'use strict';

  var DB_NAME = 'celiang-db';
  var DB_VERSION = 1;
  var _db = null;

  function open() {
    if (_db) return Promise.resolve(_db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('shots')) {
          var st = db.createObjectStore('shots', { keyPath: 'id' });
          st.createIndex('by_project', 'projectId', { unique: false });
          st.createIndex('by_updated', 'updatedAt', { unique: false });
        }
      };
      req.onsuccess = function () { _db = req.result; resolve(_db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function reqP(r) {
    return new Promise(function (resolve, reject) {
      r.onsuccess = function () { resolve(r.result); };
      r.onerror = function () { reject(r.error); };
    });
  }

  /* ---------- 项目 ---------- */
  function listProjects() {
    return open().then(function (db) {
      return reqP(db.transaction('projects').objectStore('projects').getAll());
    }).then(function (all) {
      all.sort(function (a, b) { return b.createdAt - a.createdAt; });
      return all;
    });
  }

  function getProject(id) {
    return open().then(function (db) {
      return reqP(db.transaction('projects').objectStore('projects').get(id));
    });
  }

  function addProject(name) {
    var p = { id: uid(), name: name, createdAt: Date.now() };
    return open().then(function (db) {
      return reqP(db.transaction('projects', 'readwrite').objectStore('projects').put(p));
    }).then(function () { return p; });
  }

  function updateProject(p) {
    return open().then(function (db) {
      return reqP(db.transaction('projects', 'readwrite').objectStore('projects').put(p));
    });
  }

  /* 删除项目，并级联删除其下所有测量 */
  function deleteProject(id) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(['projects', 'shots'], 'readwrite');
        tx.objectStore('projects').delete(id);
        var idx = tx.objectStore('shots').index('by_project');
        var cur = idx.openCursor(IDBKeyRange.only(id));
        cur.onsuccess = function () {
          var c = cur.result;
          if (c) { c.delete(); c.continue(); }
        };
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
        tx.onabort = function () { reject(tx.error); };
      });
    });
  }

  /* ---------- 测量记录 ---------- */
  function listShots(projectId) {
    return open().then(function (db) {
      var st = db.transaction('shots').objectStore('shots');
      var r = projectId ? st.index('by_project').getAll(IDBKeyRange.only(projectId)) : st.getAll();
      return reqP(r);
    }).then(function (all) {
      all.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      return all;
    });
  }

  function getShot(id) {
    return open().then(function (db) {
      return reqP(db.transaction('shots').objectStore('shots').get(id));
    });
  }

  function putShot(shot) {
    return open().then(function (db) {
      return reqP(db.transaction('shots', 'readwrite').objectStore('shots').put(shot));
    });
  }

  function deleteShot(id) {
    return open().then(function (db) {
      return reqP(db.transaction('shots', 'readwrite').objectStore('shots').delete(id));
    });
  }

  function uid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
  }

  return {
    listProjects: listProjects,
    getProject: getProject,
    addProject: addProject,
    updateProject: updateProject,
    deleteProject: deleteProject,
    listShots: listShots,
    getShot: getShot,
    putShot: putShot,
    deleteShot: deleteShot
  };
})();

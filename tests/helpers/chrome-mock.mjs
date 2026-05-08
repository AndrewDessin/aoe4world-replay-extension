// Minimal chrome.* shim: storage with onChanged fan-out, runtime.sendMessage
// dispatched to a test-supplied handler, and getURL stub.
export function makeChromeMock({ initial = {}, sendMessageImpl } = {}) {
  const storageData = { ...initial };
  const storageListeners = [];
  const messageListeners = [];
  const messages = [];

  const fanout = (changes) => {
    for (const fn of storageListeners) {
      try { fn(changes, 'local'); } catch {}
    }
  };

  const chrome = {
    runtime: {
      id: 'test-extension-id',
      lastError: null,
      getURL: (p) => `chrome-extension://test/${p}`,
      sendMessage: (msg, cb) => {
        messages.push(msg);
        if (sendMessageImpl) {
          let resp;
          try { resp = sendMessageImpl(msg, chrome); } catch (e) { resp = { error: String(e) }; }
          if (resp && typeof resp.then === 'function') {
            resp.then(r => cb && cb(r));
          } else if (cb) {
            cb(resp ?? { ok: true });
          }
        } else if (cb) {
          cb({ ok: true });
        }
      },
      onMessage: { addListener: (fn) => messageListeners.push(fn), removeListener: () => {} },
    },
    storage: {
      local: {
        get: (keys, cb) => {
          let result = {};
          if (keys == null) result = { ...storageData };
          else if (typeof keys === 'string') result = (keys in storageData) ? { [keys]: storageData[keys] } : {};
          else if (Array.isArray(keys)) keys.forEach(k => { if (k in storageData) result[k] = storageData[k]; });
          else if (typeof keys === 'object') {
            for (const k of Object.keys(keys)) result[k] = (k in storageData) ? storageData[k] : keys[k];
          }
          if (cb) Promise.resolve().then(() => cb(result));
          return Promise.resolve(result);
        },
        set: (obj, cb) => {
          const changes = {};
          for (const k of Object.keys(obj)) {
            changes[k] = { oldValue: storageData[k], newValue: obj[k] };
            storageData[k] = obj[k];
          }
          fanout(changes);
          if (cb) cb();
          return Promise.resolve();
        },
        remove: (keys, cb) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          const changes = {};
          for (const k of arr) {
            if (k in storageData) {
              changes[k] = { oldValue: storageData[k], newValue: undefined };
              delete storageData[k];
            }
          }
          fanout(changes);
          if (cb) cb();
          return Promise.resolve();
        },
      },
      onChanged: {
        addListener: (fn) => storageListeners.push(fn),
        removeListener: (fn) => {
          const i = storageListeners.indexOf(fn);
          if (i >= 0) storageListeners.splice(i, 1);
        },
      },
    },
  };

  return { chrome, storageData, messages, fanout };
}

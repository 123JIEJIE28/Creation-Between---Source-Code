(() => {
  const dialog = document.querySelector('#login');
  const form = document.querySelector('#login-form');
  const error = document.querySelector('#login-error');
  const submit = form.querySelector('[type="submit"]');
  let state = null;
  let initialization = null;
  let pending = null;
  let submitting = false;

  async function rawRequest(url, options = {}) {
    try {
      return await fetch(url, {
        ...options,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...options.headers },
        signal: options.signal || AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error('连接失败，请检查网络后重试');
    }
  }

  async function json(response) {
    let value;
    try { value = await response.json(); } catch { throw new Error('服务暂时不可用，请稍后重试'); }
    if (!response.ok) throw new Error(value.error || '操作失败，请重试');
    return value;
  }

  function ready() {
    if (!initialization) {
      initialization = rawRequest('/api/auth/session').then(json).then(value => {
        state = value;
        return state;
      }).catch(error => { initialization = null; throw error; });
    }
    return initialization;
  }

  function finish(accepted) {
    if (!pending || submitting) return;
    const request = pending;
    pending = null;
    dialog.close();
    form.elements.password.value = '';
    if (request.opener?.isConnected) request.opener.focus({ preventScroll: true });
    request.resolve(accepted);
  }

  async function ensure() {
    const current = await ready();
    if (!current.authRequired || current.authenticated) return true;
    if (pending) return pending.promise;
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    pending = { promise, resolve, opener: document.activeElement };
    error.textContent = '';
    form.elements.password.value = '';
    dialog.showModal();
    (form.elements.username.value ? form.elements.password : form.elements.username).focus();
    return promise;
  }

  function expire() {
    state = { authRequired: true, authenticated: false };
    initialization = Promise.resolve(state);
  }

  async function authorizedFetch(url, options = {}) {
    let response = await rawRequest(url, options);
    if (response.status === 401) {
      expire();
      if (!await ensure()) throw new Error('请登录后重试，未保存的内容仍然保留');
      response = await rawRequest(url, options);
      if (response.status === 401) expire();
    }
    return response;
  }

  async function logout() {
    const response = await rawRequest('/api/auth/logout', { method: 'POST', body: '{}' });
    if (response.status !== 401) await json(response);
    expire();
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitting) return;
    const username = form.elements.username.value.trim();
    const password = form.elements.password.value;
    submitting = true;
    error.textContent = '';
    const controls = [...form.elements];
    controls.forEach(control => { control.disabled = true; });
    dialog.setAttribute('aria-busy', 'true');
    submit.textContent = '正在登录…';
    let accepted = false;
    try {
      const value = await json(await rawRequest('/api/auth/login', {
        method: 'POST', body: JSON.stringify({ username, password }),
      }));
      state = { authRequired: true, authenticated: true, username: value.username };
      initialization = Promise.resolve(state);
      accepted = true;
    } catch (problem) {
      error.textContent = problem.message;
      form.elements.password.value = '';
    } finally {
      submitting = false;
      controls.forEach(control => { control.disabled = false; });
      dialog.removeAttribute('aria-busy');
      submit.textContent = '登录 →';
      if (accepted) finish(true);
      else form.elements.password.focus();
    }
  });

  dialog.querySelector('[data-auth-cancel]').addEventListener('click', () => finish(false));
  dialog.addEventListener('cancel', event => { event.preventDefault(); finish(false); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const bounds = dialog.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) finish(false);
  });

  window.StudioAuth = {
    ready, ensure, logout,
    get state() { return state; },
    request: async (url, options) => json(await authorizedFetch(url, options)),
    async download(url, filename) {
      const response = await authorizedFetch(url);
      if (!response.ok) await json(response);
      const objectUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    },
  };
})();

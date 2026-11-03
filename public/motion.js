(() => {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const effects = new Map();
  const transitions = new Map();
  const frames = new Set();
  let observer;
  let controller;

  function cancelEffect(element) {
    const animation = effects.get(element);
    if (animation) animation.cancel();
    effects.delete(element);
  }

  function effect(element, transform, duration = 280) {
    if (!element?.isConnected || reduced.matches) return;
    const start = getComputedStyle(element).transform;
    cancelEffect(element);
    const animation = element.animate([{ transform: start }, { transform }], {
      duration,
      easing: 'cubic-bezier(.2,.8,.2,1)',
      fill: 'forwards',
    });
    // Filled effects stay tracked until replaced or destroyed.
    effects.set(element, animation);
  }

  function schedule(callback) {
    const id = requestAnimationFrame(() => {
      frames.delete(id);
      callback();
    });
    frames.add(id);
    return id;
  }

  function destroy() {
    observer?.disconnect();
    observer = undefined;
    controller?.abort();
    controller = undefined;
    frames.forEach(cancelAnimationFrame);
    frames.clear();
    effects.forEach(animation => animation.cancel());
    effects.clear();
    // Screen transitions deliberately survive refresh/destroy during a render.
  }

  function cancelTransitions() {
    transitions.forEach(animation => animation.cancel());
    transitions.clear();
    reduced.removeEventListener('change', onTransitionPreferenceChange);
  }

  function onTransitionPreferenceChange() {
    if (reduced.matches) cancelTransitions();
  }

  function refresh() {
    destroy();
    controller = new AbortController();
    const { signal } = controller;
    const reveal = [...document.querySelectorAll('[data-reveal]')];
    document.documentElement.classList.toggle('motion-enabled', !reduced.matches);
    reduced.addEventListener('change', () => {
      refresh();
    }, { signal });
    fine.addEventListener('change', refresh, { signal });

    if (reduced.matches) {
      reveal.forEach(element => element.classList.add('is-visible'));
      return;
    }

    if ('IntersectionObserver' in window) {
      observer = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('is-visible');
          observer?.unobserve(entry.target);
        });
      }, { threshold: 0.06, rootMargin: '0px 0px 25px 0px' });
      reveal.filter(element => !element.classList.contains('is-visible'))
        .forEach(element => observer.observe(element));
    } else {
      reveal.forEach(element => element.classList.add('is-visible'));
    }

    const progress = document.querySelector('.scroll-progress');
    if (progress) {
      let pending = false;
      const updateProgress = () => {
        pending = false;
        const range = document.documentElement.scrollHeight - innerHeight;
        const amount = range > 0 ? Math.min(1, Math.max(0, scrollY / range)) : 0;
        effect(progress, `scaleX(${amount})`, 1);
      };
      addEventListener('scroll', () => {
        if (pending || document.hidden) return;
        pending = true;
        schedule(updateProgress);
      }, { passive: true, signal });
      updateProgress();
    }

    if (!fine.matches) return;
    const title = document.querySelector('.gateway-title');
    if (title) {
      let pending = false;
      let x = 0;
      let y = 0;
      addEventListener('pointermove', event => {
        if (event.pointerType === 'touch' || document.hidden) return;
        x = Math.max(-5, Math.min(5, (event.clientX / innerWidth - 0.5) * 10));
        y = Math.max(-5, Math.min(5, (event.clientY / innerHeight - 0.5) * 10));
        if (pending) return;
        pending = true;
        schedule(() => {
          pending = false;
          effect(title, `translate(${x}px, ${y}px)`, 450);
        });
      }, { passive: true, signal });
      document.documentElement.addEventListener('pointerleave', () => {
        x = 0;
        y = 0;
        effect(title, 'translate(0, 0)', 450);
      }, { signal });
    }

    document.querySelectorAll('.magnetic').forEach(button => {
      let pending = false;
      let x = 0;
      let y = 0;
      button.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch' || document.hidden) return;
        const bounds = button.getBoundingClientRect();
        x = Math.max(-5, Math.min(5, (event.clientX - bounds.left - bounds.width / 2) * 0.07));
        y = Math.max(-4, Math.min(4, (event.clientY - bounds.top - bounds.height / 2) * 0.1));
        if (pending) return;
        pending = true;
        schedule(() => {
          pending = false;
          effect(button, `translate(${x}px, ${y}px)`);
        });
      }, { passive: true, signal });
      button.addEventListener('pointerleave', () => {
        x = 0;
        y = 0;
        effect(button, 'translate(0, 0)', 350);
      }, { signal });
    });
  }

  async function transition(element, entering, options = {}) {
    cancelTransitions();
    if (reduced.matches || !element?.isConnected) return;
    const wipe = document.getElementById('screen-wipe');
    const gateway = options.gateway === true && wipe?.isConnected;
    const target = gateway ? wipe : element;
    const keyframes = gateway
      ? (entering
        ? [{ transform: 'translateY(0)' }, { transform: 'translateY(-101%)' }]
        : [{ transform: 'translateY(101%)' }, { transform: 'translateY(0)' }])
      : (entering
        ? [{ opacity: 0, transform: 'translateY(8px)' }, { opacity: 1, transform: 'translateY(0)' }]
        : [{ opacity: 1, transform: 'translateY(0)' }, { opacity: 0, transform: 'translateY(-8px)' }]);
    if (gateway) keyframes.forEach(frame => { frame.visibility = 'visible'; });
    const animation = target.animate(keyframes, {
      duration: gateway ? (entering ? 520 : 430) : (entering ? 300 : 160),
      easing: gateway ? 'cubic-bezier(.76,0,.24,1)' : 'cubic-bezier(.2,.8,.2,1)',
      fill: 'forwards',
    });
    transitions.set(target, animation);
    // This listener belongs to the transition, so destroy cannot leave a
    // held curtain on screen if the motion preference changes between views.
    reduced.addEventListener('change', onTransitionPreferenceChange);
    try { await animation.finished; } catch { /* A newer transition or preference change superseded it. */ }
    if (entering && transitions.get(target) === animation) {
      cancelTransitions();
    }
    // Exit stays filled while the parent renders. A completed curtain enter
    // resets to its hidden CSS state, including in full-page captures.
  }

  window.StudioMotion = {
    refresh,
    destroy,
    exit: (element, options) => transition(element, false, options),
    enter: (element, options) => transition(element, true, options),
  };
})();

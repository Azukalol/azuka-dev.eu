/* ============================================================
   SHUTTERKIF OS — boot sequence, HUD, audio, navigation.
   Plain script; psp.js is the module and talks to us via
   window.SK (a tiny shared bus).
   ============================================================ */
(function () {
  'use strict';

  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* shared bus ------------------------------------------------ */
  var SK = window.SK = {
    ready: false,
    _onReady: [],
    onReady: function (fn) { this.ready ? fn() : this._onReady.push(fn); },
    fireReady: function () {
      this.ready = true;
      this._onReady.splice(0).forEach(function (f) { f(); });
    }
  };

  /* ---------------------------------------------------------- */
  /* BOOT SEQUENCE                                              */
  /* ---------------------------------------------------------- */
  var boot = document.getElementById('boot');
  var fillEl = document.getElementById('bootFill');
  var pctEl = document.getElementById('bootPct');

  var pct = 0, targetPct = 0;
  var bootDone = false;

  function setPct(v) {
    pct = v;
    if (fillEl) fillEl.style.right = (100 - v) + '%';
    if (pctEl) pctEl.textContent = String(Math.round(v)).padStart(3, '0');
  }

  /* creep toward 96 while the model streams in; finishBoot waits on the scene */
  function crawl() {
    targetPct = Math.min(96, targetPct + 6);
    if (targetPct < 96) setTimeout(crawl, reduce ? 30 : 90);
    else finishBoot();
  }

  function tickPct() {
    if (bootDone) return;
    setPct(pct + (targetPct - pct) * 0.14);
    requestAnimationFrame(tickPct);
  }

  function finishBoot() {
    // wait for the 3D scene (or bail after 9s so a slow CDN never traps anyone)
    var released = false;
    function release() {
      if (released) return; released = true;
      targetPct = 100; setPct(100);
      setTimeout(function () {
        bootDone = true;
        if (boot) boot.classList.add('is-done');
        document.body.classList.remove('is-booting');
        document.body.classList.add('is-lit');
      }, reduce ? 60 : 420);
    }
    SK.onReady(release);
    setTimeout(release, 9000);
  }

  requestAnimationFrame(tickPct);
  setTimeout(crawl, reduce ? 0 : 200);

  /* ---------------------------------------------------------- */
  /* AUDIO — on by default, remembered per session                */
  /*                                                              */
  /* Browsers will not let a page make noise before the visitor    */
  /* has interacted with it, so the music tries to start on load   */
  /* and, when the browser refuses, rolls muted until the first    */
  /* real gesture lifts the mute.                                 */
  /*                                                              */
  /*  1. `wheel` and `scroll` are NOT user-activation gestures.    */
  /*     This is a scroll-driven site, so the first thing almost   */
  /*     every visitor does is scroll. The arming never disarms    */
  /*     on a gesture that cannot grant activation — it just       */
  /*     keeps listening until a click/keypress succeeds.          */
  /*                                                              */
  /*  2. MUTED playback is always allowed. So the track is set     */
  /*     rolling silently from the very first frame and is fully   */
  /*     buffered by the time a gesture arrives — the gesture      */
  /*     only has to unmute, which cannot fail on a load or a      */
  /*     network stall the way a cold play() can.                  */
  /*                                                              */
  /*  The whole thing only touches `muted` and `paused`; volume    */
  /*  lives with the slider and is never zeroed as a mute trick,   */
  /*  so nothing can randomly go silent or fight the slider.       */
  /* ---------------------------------------------------------- */
  var audio = document.getElementById('bgAudio');
  var btn = document.getElementById('soundToggle');
  var vol = document.getElementById('volSlider');
  var wanted = false, live = false, armed = false;

  /* volume comes from the slider, remembered across visits */
  function getVol() {
    var v = vol ? parseFloat(vol.value) : 50;
    if (isNaN(v)) v = 50;
    return Math.max(0, Math.min(1, v / 100));
  }

  function reflect() { btn && btn.setAttribute('aria-pressed', wanted ? 'true' : 'false'); }

  function applyVol() { if (audio) audio.volume = getVol(); }

  /* Muted playback is always allowed, so the track is set rolling silently
     from the very first frame and fully buffered by the time a real gesture
     arrives. Unmuting + resume can then never be refused by autoplay policy,
     and the only states involved are `muted` and `paused` — no volume=0, no
     fades, no timestamp resets, nothing that can desync or randomly silence. */
  function warm() {
    if (!audio) return;
    audio.muted = true;
    applyVol();
    var p = audio.play();
    if (p && p.catch) p.catch(function () {});
  }

  function resume() {
    if (!audio) return;
    applyVol();
    var p = audio.play();
    if (p && p.catch) p.catch(function () {});
  }

  function tryUnmute() {
    if (!audio || !wanted || live) return;
    audio.muted = false;
    applyVol();
    var p = audio.play();
    if (p && p.then) {
      p.then(function () { live = true; disarm(); }, function () {});
    } else if (!audio.paused) {
      live = true;
      disarm();
    }
  }

  var ARM = ['pointerdown', 'pointerup', 'click', 'keydown', 'touchstart', 'touchend', 'wheel', 'scroll'];
  function kick() {
    if (!wanted) { disarm(); return; }
    tryUnmute();
  }
  function arm() {
    if (armed || !audio) return;
    armed = true;
    ARM.forEach(function (t) { window.addEventListener(t, kick, { capture: true, passive: true }); });
  }
  function disarm() {
    if (!armed) return;
    armed = false;
    ARM.forEach(function (t) { window.removeEventListener(t, kick, true); });
  }

  function setSound(on) {
    if (!audio) return;
    wanted = on;
    reflect();
    try { sessionStorage.setItem('sk_sound', on ? '1' : '0'); } catch (e) {}
    if (on) {
      /* the click is a real gesture — unmute and resume directly */
      live = false;
      audio.muted = false;
      applyVol();
      var p = audio.play();
      if (p && p.then) p.then(function () { live = true; disarm(); }, function () { warm(); arm(); });
      else { live = true; disarm(); }
    } else {
      live = false;
      disarm();
      audio.pause();
    }
  }

  if (btn) btn.addEventListener('click', function () { setSound(!wanted); });

  /* the volume slider drives the volume live; dragging it up also resumes the
     sound, dragging it to zero simply silences — the track keeps rolling */
  if (vol) {
    vol.addEventListener('input', function () {
      var v = getVol();
      try { localStorage.setItem('sk_vol', String(Math.round(v * 100))); } catch (e) {}
      if (!audio) return;
      audio.volume = v;
      if (v > 0) {
        if (!wanted) { wanted = true; reflect(); }
        live = false;
        audio.muted = false;
        var p = audio.play();
        if (p && p.then) p.then(function () { live = true; disarm(); }, function () { warm(); arm(); });
        else { live = true; disarm(); }
      }
    });
  }

  // pause when the tab is hidden, resume if it was wanted
  document.addEventListener('visibilitychange', function () {
    if (!audio) return;
    if (document.hidden) { audio.pause(); }
    else if (wanted) { resume(); }
  });

  var soundOnByDefault = true;
  try { if (sessionStorage.getItem('sk_sound') === '0') soundOnByDefault = false; } catch (e) {}
  /* restore the remembered volume, then try to play with sound straight away */
  try { if (vol && localStorage.getItem('sk_vol')) vol.value = localStorage.getItem('sk_vol'); } catch (e) {}

  if (audio && soundOnByDefault) {
    wanted = true;
    reflect();
    /* first a best-effort unmuted play (allowed on browsers that grant the
       media engagement); if the browser refuses, it falls back to rolling
       silently and the next real gesture lifts the mute */
    live = false;
    audio.muted = false;
    applyVol();
    var p0 = audio.play();
    if (p0 && p0.then) {
      p0.then(function () { live = true; }, function () { warm(); arm(); });
    } else if (audio.paused) {
      warm();
      arm();
    } else {
      live = true;
    }
  } else if (audio) {
    warm();
  }

  /* ---------------------------------------------------------- */
  /* INVERT — swaps the ink and the paper, keeps pink/cyan        */
  /* ---------------------------------------------------------- */
  var invBtn = document.getElementById('invertToggle');
  function setInvert(on) {
    document.body.classList.toggle('is-invert', on);
    if (invBtn) invBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', on ? '#000000' : '#ffffff');
    if (SK.setShellInvert) SK.setShellInvert(on);   // the PSP casing goes white
    if (typeof onScroll === 'function') onScroll();  // repaint the backdrop tone
    try { localStorage.setItem('sk_invert', on ? '1' : '0'); } catch (e) {}
  }
  if (invBtn) {
    invBtn.addEventListener('click', function () {
      setInvert(!document.body.classList.contains('is-invert'));
    });
  }
  try { if (localStorage.getItem('sk_invert') === '1') setInvert(true); } catch (e) {}

  /* ---------------------------------------------------------- */
  /* SCROLL ENGINE                                               */
  /* Three jobs: bleed the backdrop tone across section seams,   */
  /* drift each element at its own rate, and reveal type as it   */
  /* enters. Everything runs off one rAF loop.                   */
  /* ---------------------------------------------------------- */
  var backdrop = document.querySelector('.backdrop');
  var secs = [].slice.call(document.querySelectorAll('.sec'));
  var movers = [].slice.call(document.querySelectorAll('.el, .lay'));

  /* how far each piece drifts, as a fraction of the viewport */
  var DEPTH = {
    'el--star-a': 0.16, 'el--star-b': -0.13, 'el--dice': 0.07,
    'el--cd-a': 0.15, 'el--cd-b': -0.12, 'el--cards': 0.08,
    'lay--azuka': 0.04,
    'lay--abouth': -0.04, 'lay--bio': 0.035,
    'lay--contact': -0.05, 'lay--me': 0.05, 'lay--icons': 0.03
  };
  movers.forEach(function (m) {
    var d = 0;
    for (var k in DEPTH) if (m.classList.contains(k)) d = DEPTH[k];
    m.__d = d;
  });

  function toneOf(sec) { return sec.classList.contains('sec--dark') ? 1 : 0; }

  var ticking = false;
  function onScroll() {
    if (!ticking) { ticking = true; requestAnimationFrame(frame); }
  }

  function frame() {
    ticking = false;
    var vh = window.innerHeight;
    var mid = window.scrollY + vh * 0.5;

    /* --- backdrop tone, blended across a band at each seam --- */
    if (backdrop && secs.length) {
      var band = vh * 0.6;
      var tone = toneOf(secs[secs.length - 1]);
      for (var i = 0; i < secs.length; i++) {
        var top = secs[i].offsetTop, bot = top + secs[i].offsetHeight;
        if (mid >= top && mid < bot) {
          tone = toneOf(secs[i]);
          if (i < secs.length - 1 && mid > bot - band) {
            tone += (toneOf(secs[i + 1]) - tone) * ((mid - (bot - band)) / band);
          } else if (i > 0 && mid < top + band) {
            tone += (toneOf(secs[i - 1]) - tone) * (1 - (mid - top) / band);
          }
          break;
        }
      }
      var inv = document.body.classList.contains('is-invert');
      var v = Math.round((inv ? tone : 1 - tone) * 255);
      backdrop.style.backgroundColor = 'rgb(' + v + ',' + v + ',' + v + ')';
    }

    /* --- per-element drift --- */
    for (var j = 0; j < movers.length; j++) {
      var m = movers[j];
      if (!m.__d) continue;
      var r = m.parentNode.getBoundingClientRect();
      if (r.bottom < -vh || r.top > vh * 2) continue;      // far off-screen, skip
      var p = (r.top + r.height / 2 - vh / 2) / vh;        // -1 .. 1 through the viewport
      m.style.setProperty('--ty', (p * m.__d * vh).toFixed(1) + 'px');
    }
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  frame();

  /* reveal the type and the cut-outs as each section arrives */
  if ('IntersectionObserver' in window && !reduce) {
    var lays = [].slice.call(document.querySelectorAll('.lay, .el'));
    lays.forEach(function (n) { n.classList.add('rev'); });
    var ro = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('is-shown'); ro.unobserve(e.target); }
      });
    }, { threshold: 0, rootMargin: '0px 0px -6% 0px' });
    lays.forEach(function (n) { ro.observe(n); });

    /* Failsafe — nothing may be left hidden because an observer misfired.
       PER ELEMENT, not blanket: it only shows what is actually on screen, so a
       section further down still gets its animation when you reach it. An
       earlier build force-showed everything 2.5s after load and killed every
       reveal past the fold; the one before that left all body text invisible.
       Do not remove this, and do not turn it back into a blanket timeout. */
    var showIfNear = function () {
      var vh = window.innerHeight, live = 0;
      for (var z = 0; z < lays.length; z++) {
        var el = lays[z];
        if (el.classList.contains('is-shown')) continue;
        live++;
        var r = el.getBoundingClientRect();
        if (r.top < vh && r.bottom > 0) { el.classList.add('is-shown'); ro.unobserve(el); }
      }
      if (!live && guard) { clearInterval(guard); guard = null; }
    };
    var guard = setInterval(showIfNear, 900);
    showIfNear();
    window.addEventListener('scroll', showIfNear, { passive: true });
    window.addEventListener('resize', showIfNear, { passive: true });
  }

  /* ---------------------------------------------------------- */
  /* SMOOTH IN-PAGE NAV                                          */
  /* ---------------------------------------------------------- */
  document.querySelectorAll('[data-nav]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href');
      if (!id || id.charAt(0) !== '#') return;
      var t = document.querySelector(id);
      if (!t) return;
      e.preventDefault();
      t.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    });
  });

  /* ---------------------------------------------------------- */
  /* SECTION REVEALS                                             */
  /* ---------------------------------------------------------- */
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (en.isIntersecting) { en.target.classList.add('is-in'); io.unobserve(en.target); }
      });
    }, { threshold: 0.18 });
    document.querySelectorAll('.about, .contact').forEach(function (el) { io.observe(el); });
  }
})();

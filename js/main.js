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
    if (targetPct < 96) setTimeout(crawl, 90);
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
        crtFlash();
        typeHero();
        armSleep();
      }, 420);
    }
    SK.onReady(release);
    setTimeout(release, 9000);
  }

  requestAnimationFrame(tickPct);
  setTimeout(crawl, 200);

  /* terminal-style boot log — lines decrypt in one by one while the bar fills */
  var bootLog = document.getElementById('bootLog');
  var LOG_LINES = [
    'SHUTTERKIF OS v2.0.1 — BOOT',
    'mount //AZUKA',
    'decode glyph set · 8bit',
    'calibrate rgb[ ]',
    'link vcr · 24fps',
    'pull focus',
    'roll.'
  ];
  var logIdx = 0;
  function bootLogLine() {
    if (!bootLog || logIdx >= LOG_LINES.length) return;
    var d = document.createElement('div');
    d.textContent = '> ' + LOG_LINES[logIdx];
    bootLog.appendChild(d);
    requestAnimationFrame(function () { d.classList.add('on'); });
    logIdx++;
    if (logIdx < LOG_LINES.length) setTimeout(bootLogLine, 380);
  }
  if (bootLog) setTimeout(bootLogLine, 300);

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

  /* WebAudio hook for the visualizer — the track keeps playing untouched, we
     just tap the frequency spectrum through an analyser. The AudioContext is
     only ever created inside a real gesture, so it can always start. */
  var ACtx = null, analyser = null, freq = null;
  function bootViz() {
    if (ACtx || !audio) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ACtx = new AC();
      var src = ACtx.createMediaElementSource(audio);
      analyser = ACtx.createAnalyser();
      analyser.fftSize = 128;
      analyser.smoothingTimeConstant = 0.85;
      src.connect(analyser);
      analyser.connect(ACtx.destination);
      freq = new Uint8Array(analyser.frequencyBinCount);
      if (ACtx.state === 'suspended') ACtx.resume().catch(function () {});
    } catch (e) {}
  }

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
    bootViz();
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
    'lay--contact': -0.05, 'lay--me': 0.05
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
        if (en.isIntersecting) {
          en.target.classList.add('is-in');
          io.unobserve(en.target);
          en.target.querySelectorAll('.lay--abouth, .lay--contact, .lay--me').forEach(scramble);
        }
      });
    }, { threshold: 0.18 });
    document.querySelectorAll('.about, .contact').forEach(function (el) { io.observe(el); });
  }

  /* ---------------------------------------------------------- */
  /* SCRAMBLE — headings decrypt themselves from glitch glyphs    */
  /* the moment their section arrives. Text-content only, never    */
  /* the name (its ::before/::after ghosts mirror its content).    */
  /* ---------------------------------------------------------- */
  var GLYPHS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#*+<>/\\|;:!?$%&@';
  function scramble(el) {
    if (!el || !el.textContent) return;
    var final = el.textContent, len = final.length;
    if (!len) return;
    var frame = 0, total = 20;
    var timer = setInterval(function () {
      frame++;
      var out = '';
      for (var i = 0; i < len; i++) {
        var ch = final.charAt(i);
        out += (ch === ' ' || frame >= total || (i / len) < (frame / total) * 1.2)
          ? ch
          : GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
      }
      el.textContent = out;
      if (frame >= total) { clearInterval(timer); el.textContent = final; }
    }, 34);
  }

  /* ---------------------------------------------------------- */
  /* VISUALIZER — a live EQ meter bottom-left. Before a gesture   */
  /* unlocks the WebAudio context it shows a calm idle shimmer;   */
  /* once the analyser is live it rides the real frequency data.   */
  /* ---------------------------------------------------------- */
  var viz = document.getElementById('viz');
  if (viz) {
    var vctx = viz.getContext('2d');
    var vt0 = performance.now();
    function vizSize() {
      var d = Math.min(window.devicePixelRatio || 1, 2);
      var w = Math.min(220, window.innerWidth * 0.34), h = 46;
      viz.width = Math.round(w * d); viz.height = Math.round(h * d);
      viz.style.width = w + 'px'; viz.style.height = h + 'px';
      vctx.setTransform(d, 0, 0, d, 0, 0);
    }
    vizSize();
    window.addEventListener('resize', vizSize, { passive: true });
    (function vizDraw() {
      requestAnimationFrame(vizDraw);
      var w = viz.width / (Math.min(window.devicePixelRatio || 1, 2));
      var h = viz.height / (Math.min(window.devicePixelRatio || 1, 2));
      var t = (performance.now() - vt0) / 1000;
      vctx.clearRect(0, 0, w, h);
      if (analyser && freq && live) analyser.getByteFrequencyData(freq);
      var n = 24, gap = w / n, bw = gap * 0.6;
      for (var i = 0; i < n; i++) {
        var v = 0;
        if (analyser && freq && live) {
          v = freq[Math.floor((i + 0.5) * (freq.length / n))] / 255;
          v = Math.pow(v, 1.6);
        } else {
          v = 0.10 + 0.09 * Math.abs(Math.sin(t * 1.4 + i * 0.55));
        }
        var bh = Math.max(2, v * (h - 2));
        vctx.globalAlpha = 0.2 + v * 0.8;
        vctx.fillStyle = '#fff';
        vctx.fillRect(i * gap + (gap - bw) / 2, h - bh, bw, bh);
      }
      vctx.globalAlpha = 1;
    })();
  }

  /* ---------------------------------------------------------- */
  /* CURSOR — diamond core, opening ring on interactive targets,  */
  /* ghost that lags a beat. Fine pointers only.                  */
  /* ---------------------------------------------------------- */
  var fine = window.matchMedia('(hover:hover) and (pointer:fine)').matches;
  var cur = document.getElementById('cur');
  if (fine && cur) {
    document.documentElement.classList.add('has-cur');
    var curTrail = cur.querySelector('.cur__trail');
    var cx = window.innerWidth / 2, cy = window.innerHeight / 2;
    var tx = cx, ty = cy;
    var px = cx, py = cy, lastSpark = 0;
    window.addEventListener('pointermove', function (e) {
      cx = e.clientX; cy = e.clientY;
      cur.classList.add('is-on');
      cur.style.transform = 'translate(' + cx + 'px,' + cy + 'px)';
      var dist = Math.abs(cx - px) + Math.abs(cy - py);
      var now = performance.now();
      if (dist > 22 && now - lastSpark > 70) {
        lastSpark = now;
        spawnSpark(cx, cy, dist * 0.7);
      }
      px = cx; py = cy;
    }, { passive: true });
    window.addEventListener('pointerdown', function () { cur.classList.add('is-down'); });
    window.addEventListener('pointerup', function () { cur.classList.remove('is-down'); });
    document.addEventListener('mouseover', function (e) {
      var el = e.target;
      if (el && el.closest && el.closest('a,button,input,label,canvas,[data-nav],.rail__open')) cur.classList.add('is-hov');
    });
    document.addEventListener('mouseout', function (e) {
      var el = e.target;
      if (el && el.closest && el.closest('a,button,input,label,canvas,[data-nav],.rail__open')) cur.classList.remove('is-hov');
    });
    if (curTrail) {
      (function trailLoop() {
        tx += (cx - tx) * 0.14; ty += (cy - ty) * 0.14;
        curTrail.style.transform = 'translate(' + (tx - cx).toFixed(1) + 'px,' + (ty - cy).toFixed(1) + 'px)';
        requestAnimationFrame(trailLoop);
      })();
    }
  }

  /* ---------------------------------------------------------- */
  /* CURSOR SPARKS — glyphs fly off a fast-moving cursor          */
  /* ---------------------------------------------------------- */
  function spawnSpark(x, y, power) {
    var s = document.createElement('i');
    s.className = 'spark';
    s.style.left = (x - 2) + 'px';
    s.style.top = (y - 2) + 'px';
    var ang = Math.random() * Math.PI * 2;
    var d = (power || 14) * (0.6 + Math.random());
    s.style.setProperty('--sx', (Math.cos(ang) * d).toFixed(1) + 'px');
    s.style.setProperty('--sy', (Math.sin(ang) * d - 8).toFixed(1) + 'px');
    document.body.appendChild(s);
    s.addEventListener('animationend', function () { s.remove(); });
  }

  /* ---------------------------------------------------------- */
  /* CLICK RIPPLE — a small ring pulses out from every click.     */
  /* ---------------------------------------------------------- */
  if (fine) {
    document.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'touch') return;
      var r = document.createElement('i');
      r.className = 'rip';
      r.style.left = e.clientX + 'px';
      r.style.top = e.clientY + 'px';
      document.body.appendChild(r);
      requestAnimationFrame(function () { r.classList.add('is-go'); });
      r.addEventListener('animationend', function () { r.remove(); });
    });
  }

  /* ---------------------------------------------------------- */
  /* CHRONO — VCR clock + fake hit counter, top-left              */
  /* ---------------------------------------------------------- */
  var timeEl = document.getElementById('chronoTime');
  var hitsEl = document.getElementById('chronoHits');
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function tickClock() {
    if (timeEl) {
      var d = new Date();
      timeEl.textContent = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
      setTimeout(tickClock, 1000);
    }
  }
  tickClock();
  if (hitsEl) {
    var hits = 1;
    try { hits = (parseInt(localStorage.getItem('sk_hits'), 10) || 0) + 1; localStorage.setItem('sk_hits', String(hits)); } catch (e) {}
    hitsEl.textContent = 'HITS ' + String(1240 + hits + Math.floor(Math.random() * 5)).padStart(6, '0');
  }

  /* ---------------------------------------------------------- */
  /* SCROLL PROGRESS — the ink line hugging the bottom edge       */
  /* ---------------------------------------------------------- */
  var prog = document.getElementById('progress');
  function onProg() {
    if (!prog) return;
    var h = document.documentElement.scrollHeight - window.innerHeight;
    prog.style.transform = 'scaleX(' + (h > 0 ? Math.min(1, window.scrollY / h) : 0) + ')';
  }
  window.addEventListener('scroll', onProg, { passive: true });
  window.addEventListener('resize', onProg, { passive: true });
  onProg();

  /* ---------------------------------------------------------- */
  /* AMBIENT GLITCH TICK — the page jolts for a frame every so    */
  /* often, so it never quite looks still.                        */
  /* ---------------------------------------------------------- */
  setInterval(function () {
    if (document.hidden) return;
    document.body.classList.add('g-tick');
    setTimeout(function () { document.body.classList.remove('g-tick'); }, 240);
  }, 15000);

  /* ---------------------------------------------------------- */
  /* CONTACT SHEET — smooth drawer, no database. Submitting       */
  /* emails the request straight to the owner through FormSubmit's */
  /* AJAX endpoint — no public phone number anywhere.              */
  /* ---------------------------------------------------------- */
  var cta = document.getElementById('ctaOpen');
  var sheet = document.getElementById('sheet');
  var dim = document.getElementById('dim');
  var sheetClose = document.getElementById('sheetClose');
  var sheetForm = document.getElementById('contactForm');
  var sheetOk = document.getElementById('sheetOk');

  function openSheet() {
    if (!sheet || !dim) return;
    sheet.classList.add('is-open');
    dim.classList.add('is-on');
    sheet.setAttribute('aria-hidden', 'false');
    document.body.classList.add('is-sheet');
  }
  function closeSheet() {
    if (!sheet || !dim) return;
    sheet.classList.remove('is-open');
    dim.classList.remove('is-on');
    sheet.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('is-sheet');
  }
  if (cta) cta.addEventListener('click', openSheet);
  if (sheetClose) sheetClose.addEventListener('click', closeSheet);
  if (dim) dim.addEventListener('click', closeSheet);
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });

  if (sheetForm) {
    sheetForm.addEventListener('submit', function (e) {
      e.preventDefault();
      var fd = new FormData(sheetForm);
      var name = String(fd.get('name') || '').trim();
      var zweck = String(fd.get('zweck') || '').trim();
      var email = String(fd.get('email') || '').trim();
      var datum = String(fd.get('datum') || '').trim();
      var msg = 'AZUKA CONTACT\n\nname: ' + name + '\nzweck: ' + zweck + '\nemail: ' + email + '\ndatum: ' + datum;
      try {
        fetch('https://formsubmit.co/ajax/azukakun8@gmail.com', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify({
            _subject: 'azuka contact — ' + zweck,
            name: name, email: email, datum: datum, message: msg
          })
        }).catch(function () {});
      } catch (err) {}
      sheetForm.classList.add('is-gone');
      sheetOk.hidden = false;
      toast('SIGNAL TRANSMITTED ✦');
      setTimeout(function () {
        closeSheet();
        sheetForm.reset();
        sheetForm.classList.remove('is-gone');
        sheetOk.hidden = true;
      }, 4200);
    });
  }

  /* ---------------------------------------------------------- */
  /* CRT POWER-ON — after boot the screen snaps on once.          */
  /* ---------------------------------------------------------- */
  function crtFlash() {
    document.body.classList.add('is-crt');
    setTimeout(function () { document.body.classList.remove('is-crt'); }, 700);
  }

  /* ---------------------------------------------------------- */
  /* HERO TYPE-IN — "azuka." types itself the moment we go live.  */
  /* ---------------------------------------------------------- */
  function typeHero() {
    var h = document.querySelector('.azuka__in');
    if (!h) return;
    var word = 'azuka.', i = 0;
    h.textContent = '';
    (function step() {
      i++;
      h.textContent = word.slice(0, i);
      if (i < word.length) setTimeout(step, 90);
    })();
  }

  /* ---------------------------------------------------------- */
  /* SLEEP SCREEN — idle for a while and the machine dozes.       */
  /* ---------------------------------------------------------- */
  var sleepT = null;
  function armSleep() {
    if (document.body.classList.contains('is-sleep')) return;
    clearTimeout(sleepT);
    sleepT = setTimeout(function () { document.body.classList.add('is-sleep'); }, 20000);
  }
  function wakeSleep() {
    if (document.body.classList.contains('is-sleep')) {
      document.body.classList.remove('is-sleep');
      crtFlash();
    }
    armSleep();
  }
  ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'].forEach(function (t) {
    window.addEventListener(t, wakeSleep, { passive: true });
  });

  /* ---------------------------------------------------------- */
  /* WEB-AUDIO BLIPS — tiny generated sounds, no files.           */
  /* ---------------------------------------------------------- */
  function beep(freq, dur, type, vol) {
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      var ctx = ACtx || new AC();
      ACtx = ctx;
      var o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'square';
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol || 0.05, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (dur || 0.12));
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + (dur || 0.12) + 0.02);
      if (ctx.state === 'suspended') ctx.resume().catch(function () {});
    } catch (e) {}
  }
  var lastHov = 0;
  document.addEventListener('pointerdown', function () { beep(880, 0.05, 'square', 0.04); }, true);
  document.addEventListener('mouseover', function (e) {
    var el = e.target;
    if (!el || !el.closest || !el.closest('a,button,.rail__open,input,label,select')) return;
    var n = performance.now();
    if (n - lastHov > 40) { lastHov = n; beep(1320, 0.045, 'square', 0.022); }
  }, true);

  /* ---------------------------------------------------------- */
  /* FLASH + BURST — the shared fullscreen glyph and spark play.  */
  /* ---------------------------------------------------------- */
  var eggFlash = document.getElementById('eggFlash');
  function flash(text) {
    if (!eggFlash) return;
    eggFlash.querySelector('b').textContent = text;
    eggFlash.classList.remove('is-go');
    void eggFlash.offsetWidth;
    eggFlash.classList.add('is-go');
  }
  function burst(x, y, n, spread, power) {
    for (var i = 0; i < n; i++) spawnSpark(x + (Math.random() - 0.5) * spread, y + (Math.random() - 0.5) * spread * 0.7, power);
  }

  /* ---------------------------------------------------------- */
  /* TOAST — transient status line, bottom centre.                */
  /* ---------------------------------------------------------- */
  var toastEl = document.getElementById('toast');
  var toastT = null;
  function toast(msg) {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove('is-go');
    void toastEl.offsetWidth;
    toastEl.classList.add('is-go');
    clearTimeout(toastT);
    toastT = setTimeout(function () { toastEl.classList.remove('is-go'); }, 3200);
  }

  /* ---------------------------------------------------------- */
  /* SECRET CODES — every word does something. Words shorter than */
  /* five letters match the instant the buffer ends with them.    */
  /* ---------------------------------------------------------- */
  var buf = '';
  var FOUND = [];
  try { FOUND = JSON.parse(localStorage.getItem('sk_found')) || []; } catch (e) {}
  var SECRETS = {
    azuka: { name: 'the name', fx: doEgg },
    flip:  { name: 'mirror',     fx: toggleFlip },
    crash: { name: 'fatal',      fx: doCrash },
    psp:   { name: 'console',    fx: pspBurst },
    vcr:   { name: 'playback',   fx: vcrMode },
    ghost: { name: 'spectre',    fx: ghostMode },
    y2k:   { name: 'millennium', fx: y2kMode },
    music: { name: 'synth',      fx: toggleMusic }
  };
  function foundSecret(key) {
    if (FOUND.indexOf(key) === -1) {
      FOUND.push(key);
      try { localStorage.setItem('sk_found', JSON.stringify(FOUND)); } catch (e) {}
    }
    var se = document.getElementById('secrets');
    if (se) se.textContent = 'SECRETS ' + FOUND.length + '/' + Object.keys(SECRETS).length;
  }
  var se = document.getElementById('secrets');
  if (se) se.textContent = 'SECRETS ' + FOUND.length + '/' + Object.keys(SECRETS).length;

  function doEgg() {
    flash('AZUKA');
    burst(window.innerWidth / 2, window.innerHeight / 3, 42, 340, 30);
    document.body.classList.add('g-egg');
    setTimeout(function () { document.body.classList.remove('g-egg'); }, 950);
  }
  function toggleFlip() {
    var on = document.documentElement.classList.toggle('is-flip');
    toast(on ? 'MIRROR ON' : 'MIRROR OFF');
  }
  function doCrash() {
    document.body.classList.add('is-crash');
    setTimeout(function () {
      document.body.classList.remove('is-crash');
      reboot();
    }, 2600);
  }
  function reboot() {
    document.body.classList.add('is-booting');
    document.body.classList.remove('is-lit');
    if (boot) boot.classList.remove('is-done');
    bootDone = false;
    pct = 0; targetPct = 0; setPct(0);
    logIdx = 0;
    if (bootLog) bootLog.innerHTML = '';
    setTimeout(crawl, 200);
  }
  function pspBurst() {
    flash('PSP');
    burst(window.innerWidth / 2, window.innerHeight * 0.42, 30, 260, 24);
    if (SK.spin) SK.spin();
  }
  function vcrMode() {
    document.body.classList.add('is-vcr');
    setTimeout(function () { document.body.classList.remove('is-vcr'); }, 1900);
  }
  function ghostMode() {
    document.body.classList.add('is-ghost');
    setTimeout(function () { document.body.classList.remove('is-ghost'); }, 4000);
  }
  function y2kMode() {
    document.body.classList.add('is-y2k');
    setTimeout(function () { document.body.classList.remove('is-y2k'); }, 3000);
  }

  /* synth — "music" turns the keyboard into a pocket instrument */
  var synthOn = false;
  var NOTE = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25];
  function toggleMusic() {
    synthOn = !synthOn;
    document.body.classList.toggle('is-music', synthOn);
    toast(synthOn ? 'SYNTH ON — A..Z ARE NOTES' : 'SYNTH OFF');
    if (synthOn) beep(523.25, 0.15, 'square', 0.06);
  }

  /* the master key listener — capture phase, form fields ignored */
  function dust(x, y) {
    var s = document.createElement('i');
    s.className = 'kdust';
    s.textContent = GLYPHS.charAt(Math.floor(Math.random() * GLYPHS.length));
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    document.body.appendChild(s);
    s.addEventListener('animationend', function () { s.remove(); });
  }
  document.addEventListener('keydown', function (e) {
    if (!e.key || e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
    var t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    var k = e.key.toLowerCase();
    buf = (buf + k).slice(-5);
    if (synthOn && /^[a-z]$/.test(k)) {
      var idx = k.charCodeAt(0) - 97;
      beep(NOTE[idx % NOTE.length] * (1 + Math.floor(idx / NOTE.length)), 0.16, 'square', 0.045);
    }
    dust(20 + Math.random() * 180, 40 + Math.random() * 40);
    var hit = SECRETS[buf];
    if (hit) {
      var hitKey = buf;
      buf = '';
      hit.fx();
      foundSecret(hitKey);
    }
  }, true);

  /* three quick clicks on the AZUKA title do the same — keyboards can be
     focus-stealing, a mouse never is */
  var eggTitle = document.querySelector('.lay--azuka');
  var eggClicks = 0, eggClickTimer = null;
  if (eggTitle) {
    eggTitle.addEventListener('click', function () {
      eggClicks++;
      if (eggClickTimer) clearTimeout(eggClickTimer);
      eggClickTimer = setTimeout(function () { eggClicks = 0; }, 700);
      if (eggClicks >= 3) { eggClicks = 0; doEgg(); foundSecret('azuka'); }
    });
  }

  /* ---------------------------------------------------------- */
  /* RGB SPLIT — the element under the cursor glitches on click.  */
  /* ---------------------------------------------------------- */
  document.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'touch') return;
    var el = e.target;
    if (el && el.closest) {
      var g = el.closest('.lay,.el,.ctl__b,.cta,.frame,.badge,h1,h2,h3,p');
      if (g) {
        g.classList.add('is-glitch');
        setTimeout(function () { g.classList.remove('is-glitch'); }, 280);
      }
    }
  });

  /* ---------------------------------------------------------- */
  /* SCROLL RUBBERBAND — fast scroll springs the sections.        */
  /* ---------------------------------------------------------- */
  var lastY = window.scrollY, fastT = null;
  window.addEventListener('scroll', function () {
    var v = window.scrollY - lastY;
    lastY = window.scrollY;
    if (Math.abs(v) > 140) {
      document.body.classList.add('is-fast');
      clearTimeout(fastT);
      fastT = setTimeout(function () { document.body.classList.remove('is-fast'); }, 400);
    }
  }, { passive: true });

  /* ---------------------------------------------------------- */
  /* MAGNETIC BUTTONS — the get-in-touch and sheet close drift    */
  /* toward the cursor when it comes near.                        */
  /* ---------------------------------------------------------- */
  var magnetEls = [].slice.call(document.querySelectorAll('.cta,.sheet__x'));
  window.addEventListener('pointermove', function (e) {
    for (var i = 0; i < magnetEls.length; i++) {
      var m = magnetEls[i];
      if (!m.isConnected) continue;
      var r = m.getBoundingClientRect();
      var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      var dx = e.clientX - cx, dy = e.clientY - cy;
      var d = Math.sqrt(dx * dx + dy * dy);
      var px = '0px', py = '0px';
      if (d < 100 && d > 0.1) {
        var p = (100 - d) / 100;
        px = (dx / d * p * 7).toFixed(1) + 'px';
        py = (dy / d * p * 7).toFixed(1) + 'px';
      }
      m.style.setProperty('--mx', px);
      m.style.setProperty('--my', py);
    }
  }, { passive: true });

  /* ---------------------------------------------------------- */
  /* SYSTEM TERMINAL — fps / fake mem / uptime, top right.        */
  /* ---------------------------------------------------------- */
  var sysEl = document.getElementById('sys');
  var up0 = Date.now(), frames = 0, fps = 60, mem = 42;
  (function sysRaf() { requestAnimationFrame(sysRaf); frames++; })();
  if (sysEl) {
    setInterval(function () {
      fps = fps * 0.9 + frames * 0.1;
      frames = 0;
      mem = Math.max(28, Math.min(88, mem + (Math.random() - 0.5) * 6));
      var s = Math.floor((Date.now() - up0) / 1000);
      sysEl.textContent = 'SYS ' + Math.round(fps) + 'FPS\nMEM ' + Math.round(mem) + 'MB\nUP ' + pad2(Math.floor(s / 3600)) + ':' + pad2(Math.floor((s % 3600) / 60)) + ':' + pad2(s % 60);
    }, 1000);
  }

  /* ---------------------------------------------------------- */
  /* TAB TITLE — the tab follows the section you are in.          */
  /* ---------------------------------------------------------- */
  var TITLES = ['azuka. — film · direction · germany', 'azuka. — the machine', 'azuka. — about', 'azuka. — contact'];
  function syncTitle() {
    if (!secs.length) return;
    var mid = window.scrollY + window.innerHeight * 0.5;
    for (var i = 0; i < secs.length; i++) {
      var top = secs[i].offsetTop, bot = top + secs[i].offsetHeight;
      if (mid >= top && mid < bot) {
        var want = TITLES[i] || 'azuka.';
        if (document.title !== want) document.title = want;
        break;
      }
    }
  }
  window.addEventListener('scroll', syncTitle, { passive: true });
  syncTitle();

  /* ---------------------------------------------------------- */
  /* CONTEXT MENU — the page answers right-click.                 */
  /* ---------------------------------------------------------- */
  var ctx = document.getElementById('ctx');
  document.addEventListener('contextmenu', function (e) {
    e.preventDefault();
    if (!ctx) return;
    ctx.style.left = Math.min(e.clientX, window.innerWidth - (ctx.offsetWidth || 190) - 8) + 'px';
    ctx.style.top = Math.min(e.clientY, window.innerHeight - ctx.offsetHeight - 8) + 'px';
    ctx.hidden = false;
  });
  function closeCtx() { if (ctx) ctx.hidden = true; }
  if (ctx) {
    ctx.addEventListener('click', function (e) {
      var b = e.target;
      if (b && b.dataset && b.dataset.a) {
        if (b.dataset.a === 'load') { flash('LOADING DISC'); beep(523.25, 0.2, 'square', 0.05); }
        else if (b.dataset.a === 'coin') { flash('INSERT COIN'); beep(660, 0.2, 'square', 0.05); }
        else if (b.dataset.a === 'glitch') { vcrMode(); }
      }
      closeCtx();
    });
  }
  window.addEventListener('click', closeCtx);
  window.addEventListener('scroll', closeCtx, { passive: true });
  window.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeCtx(); });

  /* ---------------------------------------------------------- */
  /* SELECTION GLITCH — grabbing text shivers the page.           */
  /* ---------------------------------------------------------- */
  var selT = null;
  document.addEventListener('selectionchange', function () {
    var s = document.getSelection();
    if (s && s.toString().length > 0) {
      document.body.classList.add('is-sel');
      clearTimeout(selT);
      selT = setTimeout(function () { document.body.classList.remove('is-sel'); }, 400);
    }
  });

  /* ---------------------------------------------------------- */
  /* CHANNEL DIAL — cycles accent palettes.                       */
  /* ---------------------------------------------------------- */
  var chBtn = document.getElementById('chToggle');
  var CHS = ['', 'cyan', 'pink', 'green', 'amber'];
  var chIdx = 0;
  if (chBtn) {
    chBtn.addEventListener('click', function () {
      chIdx = (chIdx + 1) % CHS.length;
      var ch = CHS[chIdx];
      document.body.setAttribute('data-ch', ch);
      chBtn.setAttribute('aria-pressed', ch ? 'true' : 'false');
      toast(ch ? ('CHANNEL ' + ch.toUpperCase()) : 'CHANNEL MONO');
    });
  }
})();

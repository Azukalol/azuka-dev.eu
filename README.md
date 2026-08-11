# AHNAF AKIF — Portfolio

Y2K chrome / cyber-ice portfolio site. Hero with a reactive starfield, then a
real-time 3D PSP you can operate to browse the work — CRT-shaded screen that
lights the model it sits in.

## Run it locally

The site loads a `.glb` model over `fetch`, so opening `index.html` straight
from the file system will fail (browsers block `file://` module + asset
requests). Serve the folder instead:

```
# double-click this, or:
start-server.bat
```

…then open <http://localhost:8080>. Any static server works
(`npx serve`, `python -m http.server 8080`, VS Code Live Server).

## Publish to GitHub Pages

1. Create a repo named `<your-username>.github.io` (that name makes it your
   main page — a normal repo name would live at `/<repo>` instead).
2. Push the **contents** of this folder to the repo root, so `index.html` sits
   at the top level.
3. Settings → Pages → Source: `Deploy from a branch` → `main` / `root`.
4. It goes live at `https://<your-username>.github.io` in a minute or two.

```
git init
git add .
git commit -m "portfolio"
git branch -M main
git remote add origin https://github.com/<your-username>/<your-username>.github.io.git
git push -u origin main
```

`.nojekyll` is already included so GitHub serves every file as-is.

## Controls

| Input | Action |
|---|---|
| D-pad ← → (or arrow keys) | previous / next work |
| ✕ button, `Enter`, or the screen | open the post |
| ○ / △ | previous / next |
| ▢ / SELECT / HOME | jump to the profile section |
| drag on the canvas | rotate the machine |

## Editing the work

Everything shown on the screen comes from `js/data.js` — one object per item,
in order. Index `0` boots first. Drop a new image in `assets/works/`, add an
entry, done. `vertical: true` is only a hint; the screen letterboxes from the
real image dimensions either way and fills the gap with a blurred copy rather
than black bars.

## Structure

```
index.html
css/style.css
js/data.js     works list
js/bg.js       hero starfield
js/main.js     boot sequence, HUD, audio, nav
js/psp.js      three.js scene + CRT shader
assets/
  models/psp.glb
  audio/theme.mp3
  works/work0..6.jpg
  fonts/Blackbots.woff2
```

three.js loads from jsDelivr via an import map — no build step, no
`node_modules`.

## Credits / licences

- PSP model: `sony_psp.glb` (supplied). Check its original licence before
  publishing if it came from Sketchfab — most require attribution.
- Display face: Blackbots (web kit).
- Chakra Petch, Archivo, VT323 via Google Fonts (SIL OFL).
- Music: "Outta My Mind" — Monsune. Third-party recording; make sure you're
  comfortable with the rights position before putting it on a public site.
  Sound is off by default and toggleable.

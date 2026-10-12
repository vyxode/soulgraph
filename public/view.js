// Vista 3D: dibuja el grafo como una red neuronal y gestiona todo lo visual
// (halos, sinapsis, impulsos, nombres, destellos, anillo de selección y calidad gráfica).
// 3D view: draws the graph as a neural network and handles everything visual
// (halos, synapses, impulses, names, flashes, selection ring and graphics quality).

import { kindLabel } from './i18n.js';
import { mix, escapeHtml, pathOf, BG, LINK_COLORS, colorOfKind } from './util.js';

const { ForceGraph3D, THREE, UnrealBloomPass } = window.SoulVendor;

const FLASH_MS = 1600; // lo que dura un destello / how long a flash lasts
const LABEL_LAYOUT_MS = 200; // cada cuánto se recolocan los nombres / how often names are re-laid out
const MAX_LABELS = { off: 0, main: 120, all: 600 };
const BIG_KINDS = new Set(['root', 'game', 'service']);
const AMBIENT_IMPULSES = 60; // impulsos "de fondo" cuando no miras nada / background impulses when nothing is focused
const MIN_FPS = 33; // por debajo, se baja la resolución interna / below this, internal resolution drops
const GOOD_FPS = 55; // por encima un buen rato, se vuelve a subir / above this for a while, it goes back up

export function createView({ el, state, onNodeClick, onHover, onTooSlow }) {
  const linkEnd = (end) => (typeof end === 'object' ? end.id : end);
  const isDimmed = (id) => (state.focus && !state.focus.has(id)) || (state.matches && !state.matches.has(id));
  let quality = 'high';

  // ---------- Tamaño y color / Size and color ----------

  function sizeOf(n) {
    switch (n.kind) {
      case 'root': case 'game': return 30;
      case 'service': return 10;
      case 'folder': return 4;
      case 'group': return 3 + Math.log2(n.count || 1);
      case 'model': return 3;
      case 'remote': return 3;
      case 'function': return 0.8;
      case 'instance': return 1.2;
      default:
        if (n.lines) return 1.5 + Math.log2(1 + n.lines / 20) * 1.8;
        if (n.size) return 1.2 + Math.log10(1 + n.size / 1024);
        return 1.5;
    }
  }
  const radiusOf = (n) => Math.cbrt(sizeOf(n)) * 4;

  function flashAmount(id) {
    const flash = state.flashes.get(id);
    if (!flash) return 0;
    const left = 1 - (performance.now() - flash.start) / FLASH_MS;
    return left > 0 && left <= 1 ? Math.min(1, left * flash.strength) : 0;
  }

  function nodeColor(n) {
    let color = colorOfKind(n.kind);
    if (isDimmed(n.id)) color = mix(color, BG, 0.86);
    const flash = flashAmount(n.id);
    return flash ? mix(color, '#ffffff', flash) : color;
  }

  function linkColor(l) {
    const dim = isDimmed(linkEnd(l.source)) || isDimmed(linkEnd(l.target));
    const base = LINK_COLORS[l.type] || LINK_COLORS.contains;
    return dim ? mix(base, BG, 0.92) : base;
  }

  // ---------- Grafo / Graph ----------

  const Graph = ForceGraph3D({ controlType: 'orbit' })(el)
    .backgroundColor(BG)
    .showNavInfo(false)
    .nodeRelSize(4)
    .nodeVal(sizeOf)
    .nodeColor(nodeColor)
    .nodeLabel((n) => `<div class="tip"><b>${escapeHtml(n.name)}</b><span>${escapeHtml(kindLabel(n.kind))} · ${escapeHtml(pathOf(n, state.nodes))}</span></div>`)
    .nodeThreeObjectExtend(true)
    .nodeThreeObject(objectOf)
    .linkColor(linkColor)
    .linkWidth((l) => (l.type === 'contains' ? 0 : 0.6))
    // Las líneas las dibujamos nosotros de una vez (ver createLinkLines); la librería solo pinta
    // las conexiones que llevan impulsos en ese momento.
    // We draw the lines ourselves in one go (see createLinkLines); the library only draws the
    // links carrying impulses right now.
    .linkVisibility((l) => impulsesOf(l) > 0)
    .nodeOpacity(1) // opacas: se dibujan sin ordenar, mucho más rápido / opaque: drawn without sorting, much faster
    .linkDirectionalParticleSpeed(0.004)
    .linkDirectionalParticleWidth(1.3)
    .linkDirectionalParticleColor(linkColor)
    .cooldownTime(9000)
    .onNodeClick((n) => onNodeClick(n))
    .onNodeHover((n) => {
      // La librería sigue "viendo" el último punto aunque el ratón esté ya sobre un panel.
      // The library keeps "seeing" the last point even when the mouse is already over a panel.
      const node = pointerInside ? n : null;
      el.style.cursor = node ? 'pointer' : '';
      onHover(node);
    })
    .onBackgroundClick(() => onHover(null));

  // Al pasar del grafo a un panel no llega "fin de hover": lo forzamos para no dejar el resaltado pegado.
  // Moving from the graph onto a panel sends no "hover end": force it so the highlight doesn't get stuck.
  let pointerInside = false;
  el.addEventListener('pointerenter', () => { pointerInside = true; });
  el.addEventListener('pointerleave', () => {
    pointerInside = false;
    el.style.cursor = '';
    onHover(null);
  });

  Graph.d3Force('charge').strength(-45);
  Graph.d3Force('link').distance((l) => (l.type === 'contains' ? 20 : 46));
  Graph.d3Force('cluster', clusterForce(0.12));

  const scene = Graph.scene();
  const renderer = Graph.renderer();
  const composer = Graph.postProcessingComposer();
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.5, 0.14);
  // El brillo se calcula a mitad de resolución: se ve casi igual y cuesta la cuarta parte.
  // Bloom is computed at half resolution: it looks almost the same and costs a quarter.
  const fullSetSize = bloom.setSize.bind(bloom);
  bloom.setSize = (width, height) => fullSetSize(Math.max(1, Math.round(width / 2)), Math.max(1, Math.round(height / 2)));
  composer.addPass(bloom);

  // Fondo con profundidad: polvo de estrellas lejano + niebla que apaga lo que está lejos.
  // Background with depth: distant star dust + fog that dims what's far away.
  const stars = makeStars();
  scene.add(stars);
  const fog = new THREE.FogExp2(0x000000, 0.0011);

  addEventListener('resize', () => {
    Graph.width(innerWidth).height(innerHeight);
    halos.resize();
  });

  // No gastar batería con la pestaña oculta / Don't burn battery with the tab hidden
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) Graph.pauseAnimation();
    else Graph.resumeAnimation();
  });

  // Agrupa visualmente cada servicio (o carpeta de primer nivel) atrayendo sus nodos a su centro.
  // Visually groups each service (or top-level folder) by pulling its nodes to their center.
  function clusterForce(strength) {
    let nodes = [];
    const force = (alpha) => {
      const centers = new Map();
      for (const n of nodes) {
        if (!n.cluster) continue;
        const c = centers.get(n.cluster) || { x: 0, y: 0, z: 0, count: 0 };
        c.x += n.x; c.y += n.y; c.z += n.z || 0; c.count++;
        centers.set(n.cluster, c);
      }
      const k = strength * alpha;
      for (const n of nodes) {
        const c = n.cluster && centers.get(n.cluster);
        if (!c || c.count < 2) continue;
        n.vx += (c.x / c.count - n.x) * k;
        n.vy += (c.y / c.count - n.y) * k;
        n.vz += (c.z / c.count - (n.z || 0)) * k;
      }
    };
    force.initialize = (list) => { nodes = list; };
    return force;
  }

  // ---------- Halos: una sola nube de puntos para todos los nodos ----------
  // ---------- Halos: a single point cloud for every node ----------
  // Un sprite por nodo eran cientos de llamadas de dibujo; así es una sola.
  // One sprite per node meant hundreds of draw calls; this way it's just one.

  const halos = createHalos(renderer, Graph.camera());
  scene.add(halos.points);

  function haloTint(node) {
    if (quality !== 'high') return 0;
    const base = BIG_KINDS.has(node.kind) ? 0.16 : 0.3;
    return isDimmed(node.id) ? 0.05 : base + flashAmount(node.id) * 0.6;
  }

  function refreshHalos() {
    halos.paint((node) => nodeColor(node), haloTint);
  }

  // ---------- Líneas: dos objetos para todas las conexiones / Lines: two objects for every link ----------
  // Antes era un objeto (y una llamada de dibujo) por conexión; con miles de conexiones eso hundía los FPS.
  // It used to be one object (and one draw call) per link; with thousands of links that sank the FPS.

  const CURVATURE = 0.18;
  const structure = createLinkLines(1); // "contiene", rectas / "contains", straight
  const synapses = createLinkLines(8); // el resto, curvas en calidad alta / the rest, curved in high quality
  scene.add(structure.lines, synapses.lines);
  let lastLinks = [];

  function setLines(links) {
    lastLinks = links;
    structure.setLinks(links.filter((l) => l.type === 'contains'), 0);
    synapses.setLinks(links.filter((l) => l.type !== 'contains'), quality === 'high' ? CURVATURE : 0);
  }

  function refreshStructure() {
    structure.paint(linkColor);
    synapses.paint(linkColor);
  }

  // ---------- Objetos de cada nodo (solo para el nombre) / Per-node objects (names only) ----------

  const objects = new Map(); // id → { group, label, text }

  function objectOf(node) {
    let entry = objects.get(node.id);
    if (!entry) {
      entry = { group: new THREE.Group(), label: null, text: '' };
      objects.set(node.id, entry);
      scheduleLabels();
    }
    return entry.group;
  }

  function forget(ids) {
    for (const [id, entry] of objects) {
      if (ids.has(id)) continue;
      if (entry.label) disposeLabel(entry);
      objects.delete(id);
    }
  }

  // ---------- Impulsos / Impulses ----------
  // Solo en las conexiones de lo que miras, más unas pocas de fondo: cada impulso es un objeto más que dibujar.
  // Only on the links of what you're looking at, plus a few in the background: each impulse is one more object to draw.

  let ambient = new Set();
  function impulsesOf(l) {
    if (quality !== 'high' || (l.type !== 'requires' && l.type !== 'signal')) return 0;
    const center = state.hoverId || state.selectedId;
    if (center && (linkEnd(l.source) === center || linkEnd(l.target) === center)) return 3;
    return ambient.has(l) ? 1 : 0;
  }
  Graph.linkDirectionalParticles(impulsesOf);

  // Colores de esferas, halos, enlaces e impulsos / Colors of spheres, halos, links and impulses
  function refresh() {
    Graph.nodeColor(Graph.nodeColor())
      .linkColor(Graph.linkColor())
      .linkDirectionalParticles(Graph.linkDirectionalParticles())
      .linkVisibility(Graph.linkVisibility())
      .linkDirectionalParticleColor(Graph.linkDirectionalParticleColor());
    refreshHalos();
    refreshStructure();
    scheduleLabels();
  }

  // ---------- Nombres sin solaparse / Names that don't overlap ----------

  let labelsTimer = null;
  function scheduleLabels() {
    if (!labelsTimer) labelsTimer = setTimeout(layoutLabels, 0);
  }
  setInterval(() => { if (state.labels !== 'off') scheduleLabels(); }, LABEL_LAYOUT_MS);

  function labelPriority() {
    const visible = Graph.graphData().nodes;
    const ordered = [];
    const add = (id) => { if (id && !ordered.includes(id)) ordered.push(id); };
    // Lo que miras primero, luego su entorno, lo buscado y lo grande.
    // What you're looking at first, then its surroundings, the search hits and the big nodes.
    add(state.selectedId);
    add(state.hoverId);
    for (const id of [state.selectedId, state.hoverId]) for (const n of state.neighbors.get(id) || []) add(n);
    if (state.matches) for (const id of state.matches) add(id);
    if (state.labels === 'all') visible.slice().sort((a, b) => sizeOf(b) - sizeOf(a)).forEach((n) => add(n.id));
    else visible.filter((n) => BIG_KINDS.has(n.kind)).sort((a, b) => sizeOf(b) - sizeOf(a)).forEach((n) => add(n.id));
    return ordered;
  }

  function layoutLabels() {
    labelsTimer = null;
    const camera = Graph.camera();
    const width = el.clientWidth;
    const height = el.clientHeight;
    const placed = [];
    const shown = new Set();
    const limit = MAX_LABELS[state.labels] ?? 0;
    const forced = new Set([state.selectedId, state.hoverId]);
    const v = new THREE.Vector3();

    if (limit) {
      for (const id of labelPriority()) {
        if (shown.size >= limit) break;
        const node = state.nodes.get(id);
        const entry = objects.get(id);
        if (!node || !entry || node.x === undefined) continue;

        v.set(node.x, node.y, node.z || 0).project(camera);
        if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue; // detrás o fuera / behind or off-screen
        const big = BIG_KINDS.has(node.kind);
        const h = (big ? 0.026 : 0.02) * height;
        const w = h * (entry.label ? entry.label.userData.aspect : Math.max(3, node.name.length * 0.55));
        const box = { x: (v.x + 1) / 2 * width - w / 2, y: (1 - v.y) / 2 * height - h * 1.9, w, h };
        const overlaps = placed.some((p) => box.x < p.x + p.w && p.x < box.x + box.w && box.y < p.y + p.h && p.y < box.y + box.h);
        if (overlaps && !forced.has(id)) continue;
        placed.push(box);
        shown.add(id);
      }
    }

    for (const [id, entry] of objects) {
      const show = shown.has(id);
      const node = state.nodes.get(id);
      if (show && (!entry.label || entry.text !== node.name)) {
        if (entry.label) disposeLabel(entry);
        const big = BIG_KINDS.has(node.kind);
        entry.label = makeLabel(node.name, big ? 0.026 : 0.02);
        entry.label.position.y = radiusOf(node) + (big ? 6 : 3.5);
        entry.text = node.name;
        entry.group.add(entry.label);
      }
      if (entry.label) {
        entry.label.visible = show;
        entry.label.material.opacity = isDimmed(id) && !forced.has(id) ? 0.3 : 1;
      }
    }
  }

  function makeLabel(text, height) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const font = '600 44px system-ui, "Segoe UI", sans-serif';
    ctx.font = font;
    canvas.width = Math.ceil(ctx.measureText(text).width) + 32;
    canvas.height = 64;
    ctx.font = font;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.62)';
    ctx.beginPath();
    ctx.roundRect(0, 0, canvas.width, canvas.height, 32);
    ctx.fill();
    ctx.fillStyle = '#d9dcea';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 16, 34);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    // Tamaño fijo en pantalla, te acerques o no / Fixed on-screen size, however close you get
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, sizeAttenuation: false }));
    sprite.renderOrder = 10;
    sprite.userData.aspect = canvas.width / canvas.height;
    sprite.scale.set(height * sprite.userData.aspect, height, 1);
    return sprite;
  }

  function disposeLabel(entry) {
    entry.group.remove(entry.label);
    entry.label.material.map.dispose();
    entry.label.material.dispose();
    entry.label = null;
  }

  // ---------- Anillo de selección / Selection ring ----------

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1, 1.08, 64),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.visible = false;
  scene.add(ring);

  // Arranca en el siguiente fotograma, cuando ya existe todo lo de abajo / Starts next frame, once everything below exists
  requestAnimationFrame(function animate(time) {
    const node = state.selectedId && state.nodes.get(state.selectedId);
    ring.visible = Boolean(node && node.x !== undefined);
    if (ring.visible) {
      const pulse = quality === 'high' ? 1 + Math.sin(time / 380) * 0.06 : 1;
      const r = radiusOf(node) * 1.7 * pulse;
      ring.position.set(node.x, node.y, node.z || 0);
      ring.scale.set(r, r, r);
      ring.quaternion.copy(Graph.camera().quaternion); // siempre de cara / always facing you
    }
    stars.rotation.y = time * 0.000006;
    if (quality === 'high') halos.move();
    structure.move();
    synapses.move();
    governor.frame(time);
    requestAnimationFrame(animate);
  });

  // ---------- Destellos / Flashes ----------

  let flashTimer = null;
  function fire(ids) {
    const now = performance.now();
    const links = Graph.graphData().links;
    for (const id of ids) {
      state.flashes.set(id, { start: now, strength: 1.4 });
      for (const neighbour of state.neighbors.get(id) || []) {
        if (!state.flashes.has(neighbour)) state.flashes.set(neighbour, { start: now + 350, strength: 0.6 });
      }
      for (const l of links) {
        if (linkEnd(l.source) === id || linkEnd(l.target) === id) Graph.emitParticle(l);
      }
    }
    if (!flashTimer) flashTimer = setInterval(stepFlashes, 50);
  }

  function stepFlashes() {
    const now = performance.now();
    for (const [id, flash] of state.flashes) if (now - flash.start > FLASH_MS) state.flashes.delete(id);
    Graph.nodeColor(Graph.nodeColor());
    refreshHalos();
    if (!state.flashes.size) {
      clearInterval(flashTimer);
      flashTimer = null;
    }
  }

  // ---------- Calidad gráfica / Graphics quality ----------
  // "high": brillo, halos, niebla, estrellas, sinapsis curvas e impulsos.
  // "low": plano y ligero, para ordenadores modestos o grafos enormes.
  // "high": bloom, halos, fog, stars, curved synapses and impulses.
  // "low": flat and light, for modest computers or huge graphs.

  function setQuality(next) {
    quality = next;
    const high = quality === 'high';
    stars.visible = high;
    halos.points.visible = high;
    structure.lines.material.opacity = high ? 0.4 : 0.3;
    synapses.lines.material.opacity = high ? 0.6 : 0.45;
    setLines(lastLinks);
    scene.fog = high ? fog : null;
    governor.reset();
    Graph
      .nodeResolution(high ? 12 : 8)
      .linkOpacity(high ? 0.5 : 0.35)
      .linkCurvature((l) => (high && l.type !== 'contains' ? 0.18 : 0));
    refresh();
  }

  // ---------- Regulador: calidad alta sin bajar de ~30 FPS ----------
  // ---------- Governor: high quality without dropping below ~30 FPS ----------
  // Mide los FPS cada segundo. Si van justos, baja la resolución interna (y al final el brillo);
  // si sobran durante un rato, la vuelve a subir. Si ni así llega, avisa para pasar a "Ligeros".
  // Measures FPS every second. If they're tight it lowers the internal resolution (and finally
  // the bloom); if there's headroom for a while it raises it back. If even that isn't enough,
  // it reports it so the panel can switch to "Light".

  const governor = (() => {
    const maxRatio = Math.min(devicePixelRatio || 1, 1.5);
    const steps = [
      { ratio: maxRatio, bloom: true },
      { ratio: Math.min(maxRatio, 1.25), bloom: true },
      { ratio: 1, bloom: true },
      { ratio: 0.85, bloom: true },
      { ratio: 0.85, bloom: false },
      { ratio: 0.7, bloom: false },
    ].filter((step, i, all) => i === 0 || step.ratio < all[i - 1].ratio || step.bloom !== all[i - 1].bloom);

    let step = 0;
    let frames = 0;
    let windowStart = 0;
    let slow = 0;
    let fast = 0;
    let holdUntil = 0; // tras bajar, no subir enseguida / after stepping down, don't step up right away
    let warned = false;

    function apply() {
      const { ratio, bloom: useBloom } = quality === 'high' ? steps[step] : { ratio: 1, bloom: false };
      renderer.setPixelRatio(ratio);
      composer.setPixelRatio(ratio);
      composer.setSize(el.clientWidth, el.clientHeight);
      bloom.enabled = useBloom;
      halos.resize();
    }

    return {
      reset() {
        step = 0;
        slow = fast = 0;
        apply();
      },
      frame(time) {
        if (document.hidden || quality !== 'high') {
          windowStart = 0;
          return;
        }
        if (!windowStart) {
          windowStart = time;
          frames = 0;
          return;
        }
        frames++;
        if (time - windowStart < 1000) return;
        const fps = (frames * 1000) / (time - windowStart);
        windowStart = time;
        frames = 0;

        if (fps < MIN_FPS) {
          fast = 0;
          if (++slow >= 2 && step < steps.length - 1) {
            step++;
            slow = 0;
            holdUntil = time + 20000;
            apply();
          } else if (slow >= 3 && step === steps.length - 1 && !warned) {
            warned = true;
            onTooSlow();
          }
        } else if (fps > GOOD_FPS && step > 0) {
          slow = 0;
          if (++fast >= 6 && time > holdUntil) {
            step--;
            fast = 0;
            apply();
          }
        } else {
          slow = 0;
          fast = 0;
        }
      },
    };
  })();

  // ---------- Datos y cámara / Data and camera ----------

  let first = true;
  let fitted = false;
  function render(nodes, links) {
    forget(new Set(nodes.map((n) => n.id)));
    halos.setNodes(nodes, (n) => radiusOf(n) * (BIG_KINDS.has(n.kind) ? 2.6 : 4.2));
    // Unos pocos impulsos de fondo, repartidos por todo el grafo / A few background impulses spread across the graph
    const candidates = links.filter((l) => l.type === 'requires' || l.type === 'signal');
    const every = Math.max(1, Math.ceil(candidates.length / AMBIENT_IMPULSES));
    ambient = new Set(candidates.filter((_, i) => i % every === 0));
    // La primera vez se calcula la forma antes de enseñarla (la pantalla de carga lo tapa).
    // The first time the layout is computed before showing it (the loading screen covers it).
    Graph.warmupTicks(first ? Math.min(120, 20 + Math.round(nodes.length / 15)) : 0);
    Graph.graphData({ nodes, links });
    setLines(links);
    refreshHalos();
    refreshStructure();
    if (first) {
      Graph.zoomToFit(0, 80);
      // Y otra vez, suave, cuando la forma se asiente / And again, smoothly, once the layout settles
      const settle = () => {
        if (!fitted) Graph.zoomToFit(900, 80);
        fitted = true;
      };
      Graph.onEngineStop(settle);
      setTimeout(settle, 2500);
      // Tras la carga, los cambios se asientan antes para que el grafo no "baile" / After loading, changes settle faster so the graph doesn't "dance"
      Graph.d3AlphaDecay(0.045);
    }
    first = false;
    scheduleLabels();
  }

  function flyTo(node) {
    if (node.x === undefined) return;
    const distance = 90 + radiusOf(node) * 6;
    const ratio = 1 + distance / Math.max(1, Math.hypot(node.x, node.y, node.z || 0));
    Graph.cameraPosition({ x: node.x * ratio, y: node.y * ratio, z: (node.z || 0) * ratio }, node, 1100);
  }

  return {
    render,
    refresh,
    fire,
    flyTo,
    setQuality,
    fit: () => Graph.zoomToFit(900, 80),
    visibleNodes: () => Graph.graphData().nodes,
    get quality() { return quality; },
  };
}

// Muchas conexiones en un único THREE.LineSegments, con color por vértice y curva opcional.
// La curva imita la de 3d-force-graph para que coincida con la de los impulsos.
// Many links in a single THREE.LineSegments, with per-vertex color and an optional curve.
// The curve mimics 3d-force-graph's so it matches the impulses' path.
function createLinkLines(segments) {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45, depthWrite: false });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  const perLink = segments * 6; // 2 vértices × 3 coordenadas por segmento / 2 vertices × 3 coords per segment
  let links = [];
  let curvature = 0;
  let capacity = 0;
  const color = new THREE.Color();
  const end = (e) => (typeof e === 'object' ? e : null);

  function ensure(count) {
    if (count <= capacity) return;
    capacity = Math.max(256, 2 ** Math.ceil(Math.log2(count)));
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * perLink), 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(capacity * perLink), 3));
  }

  return {
    lines,
    setLinks(list, curve) {
      links = list;
      curvature = curve;
      ensure(list.length);
      geometry.setDrawRange(0, list.length * segments * 2);
    },
    move() {
      if (!capacity) return;
      const pos = geometry.attributes.position.array;
      for (let i = 0; i < links.length; i++) {
        const a = end(links[i].source);
        const b = end(links[i].target);
        if (!a || !b) continue; // la librería aún no ha enlazado los nodos / the library hasn't linked the nodes yet
        const ax = a.x || 0, ay = a.y || 0, az = a.z || 0;
        const bx = b.x || 0, by = b.y || 0, bz = b.z || 0;
        const dx = bx - ax, dy = by - ay, dz = bz - az;
        // Punto de control: punto medio desplazado en perpendicular / Control point: midpoint pushed sideways
        let cx = (ax + bx) / 2, cy = (ay + by) / 2, cz = (az + bz) / 2;
        if (curvature) {
          if (dx || dy) { cx += dy * curvature; cy -= dx * curvature; } else cx -= dz * curvature;
        }
        let px = ax, py = ay, pz = az;
        let o = i * perLink;
        for (let s = 1; s <= segments; s++) {
          const t = s / segments, u = 1 - t;
          const qx = u * u * ax + 2 * u * t * cx + t * t * bx;
          const qy = u * u * ay + 2 * u * t * cy + t * t * by;
          const qz = u * u * az + 2 * u * t * cz + t * t * bz;
          pos[o++] = px; pos[o++] = py; pos[o++] = pz;
          pos[o++] = qx; pos[o++] = qy; pos[o++] = qz;
          px = qx; py = qy; pz = qz;
        }
      }
      geometry.attributes.position.needsUpdate = true;
    },
    paint(colorOf) {
      if (!capacity) return;
      const colors = geometry.attributes.color.array;
      for (let i = 0; i < links.length; i++) {
        color.set(colorOf(links[i]));
        for (let v = 0; v < segments * 2; v++) colors.set([color.r, color.g, color.b], i * perLink + v * 3);
      }
      geometry.attributes.color.needsUpdate = true;
    },
  };
}

// Nube de halos: un único THREE.Points con tamaño y color por punto (shader propio).
// Halo cloud: a single THREE.Points with per-point size and color (custom shader).
function createHalos(renderer, camera) {
  const geometry = new THREE.BufferGeometry();
  const material = new THREE.ShaderMaterial({
    uniforms: { map: { value: makeGlowTexture() }, scale: { value: 1 } },
    vertexShader: `
      attribute float size;
      attribute vec3 tint;
      uniform float scale;
      varying vec3 vTint;
      void main() {
        vTint = tint;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size * scale / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying vec3 vTint;
      void main() {
        gl_FragColor = vec4(vTint * texture2D(map, gl_PointCoord).a, 1.0);
      }`,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 1;

  let nodes = [];
  let capacity = 0;
  const color = new THREE.Color();

  function ensure(count) {
    if (count <= capacity) return;
    capacity = Math.max(256, 2 ** Math.ceil(Math.log2(count)));
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(capacity), 1));
    geometry.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3));
  }

  return {
    points,
    setNodes(list, sizeOf) {
      nodes = list;
      ensure(list.length);
      const sizes = geometry.attributes.size.array;
      list.forEach((n, i) => { sizes[i] = sizeOf(n); });
      geometry.attributes.size.needsUpdate = true;
      geometry.setDrawRange(0, list.length);
    },
    move() {
      if (!capacity) return;
      const pos = geometry.attributes.position.array;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        pos[i * 3] = n.x || 0;
        pos[i * 3 + 1] = n.y || 0;
        pos[i * 3 + 2] = n.z || 0;
      }
      geometry.attributes.position.needsUpdate = true;
    },
    paint(colorOf, strengthOf) {
      if (!capacity) return;
      const tint = geometry.attributes.tint.array;
      for (let i = 0; i < nodes.length; i++) {
        const k = strengthOf(nodes[i]);
        color.set(colorOf(nodes[i]));
        tint[i * 3] = color.r * k;
        tint[i * 3 + 1] = color.g * k;
        tint[i * 3 + 2] = color.b * k;
      }
      geometry.attributes.tint.needsUpdate = true;
    },
    // Píxeles por unidad a distancia 1, según la altura real del lienzo / Pixels per unit at distance 1, from the real canvas height
    resize() {
      const height = renderer.domElement.height;
      material.uniforms.scale.value = height / (2 * Math.tan((camera.fov * Math.PI) / 360));
    },
  };
}

function makeGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.35)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(canvas);
}

function makeStars() {
  const count = 1400;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // Puntos repartidos en una cáscara esférica lejana / Points spread over a far spherical shell
    const r = 2500 + Math.random() * 2500;
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({ color: 0x8a8fa3, size: 2, sizeAttenuation: false, transparent: true, opacity: 0.55, fog: false, depthWrite: false });
  return new THREE.Points(geometry, material);
}

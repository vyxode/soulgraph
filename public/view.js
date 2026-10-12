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

export function createView({ el, state, onNodeClick, onHover }) {
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
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.85, 0.5, 0.14);
  Graph.postProcessingComposer().addPass(bloom);

  // Fondo con profundidad: polvo de estrellas lejano + niebla que apaga lo que está lejos.
  // Background with depth: distant star dust + fog that dims what's far away.
  const stars = makeStars();
  scene.add(stars);
  const fog = new THREE.FogExp2(0x000000, 0.0011);

  addEventListener('resize', () => {
    Graph.width(innerWidth).height(innerHeight);
    bloom.setSize(innerWidth, innerHeight);
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

  // ---------- Objetos de cada nodo: halo + nombre / Per-node objects: halo + name ----------

  const objects = new Map(); // id → { group, halo, label, text }
  const glowTexture = makeGlowTexture();

  function objectOf(node) {
    let entry = objects.get(node.id);
    if (!entry) {
      const group = new THREE.Group();
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({
        map: glowTexture, color: colorOfKind(node.kind), transparent: true, opacity: 0.5,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }));
      group.add(halo);
      entry = { group, halo, label: null, text: '' };
      objects.set(node.id, entry);
      scheduleLabels();
    }
    // Los nodos grandes llevan un halo más contenido para no deslumbrar / Big nodes get a tighter halo so they don't dazzle
    const r = radiusOf(node);
    const spread = BIG_KINDS.has(node.kind) ? 2.6 : 4.2;
    entry.halo.scale.set(r * spread, r * spread, 1);
    entry.halo.visible = quality === 'high';
    return entry.group;
  }

  function forget(ids) {
    for (const [id, entry] of objects) {
      if (ids.has(id)) continue;
      if (entry.label) disposeLabel(entry);
      entry.halo.material.dispose();
      objects.delete(id);
    }
  }

  // Colores de esferas, halos y enlaces / Colors of spheres, halos and links
  function refresh() {
    Graph.nodeColor(Graph.nodeColor()).linkColor(Graph.linkColor()).linkDirectionalParticleColor(Graph.linkDirectionalParticleColor());
    refreshHalos();
    scheduleLabels();
  }

  function refreshHalos() {
    if (quality !== 'high') return;
    for (const [id, entry] of objects) {
      const node = state.nodes.get(id);
      if (!node) continue;
      entry.halo.material.color.set(nodeColor(node));
      const base = BIG_KINDS.has(node.kind) ? 0.18 : 0.32;
      entry.halo.material.opacity = isDimmed(id) ? 0.06 : base + flashAmount(id) * 0.6;
    }
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

  (function animate(time) {
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
    requestAnimationFrame(animate);
  })(0);

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
    bloom.enabled = high;
    stars.visible = high;
    scene.fog = high ? fog : null;
    renderer.setPixelRatio(high ? Math.min(devicePixelRatio, 1.5) : 1);
    Graph
      .nodeResolution(high ? 14 : 8)
      .nodeOpacity(high ? 0.92 : 1)
      .linkOpacity(high ? 0.5 : 0.35)
      .linkCurvature((l) => (high && l.type !== 'contains' ? 0.18 : 0))
      .linkDirectionalParticles((l) => (high && (l.type === 'requires' || l.type === 'signal') ? 2 : 0));
    for (const entry of objects.values()) entry.halo.visible = high;
    refresh();
  }

  // Mide los FPS unos segundos; si va a trompicones, avisa para pasar a modo ligero.
  // Measures FPS for a few seconds; if it stutters, reports it so we can switch to light mode.
  function measureFps(seconds = 4) {
    return new Promise((resolve) => {
      let frames = 0;
      const start = performance.now();
      const tick = (now) => {
        frames++;
        if (now - start < seconds * 1000) requestAnimationFrame(tick);
        else resolve((frames * 1000) / (now - start));
      };
      requestAnimationFrame(tick);
    });
  }

  // ---------- Datos y cámara / Data and camera ----------

  let first = true;
  let fitted = false;
  function render(nodes, links) {
    forget(new Set(nodes.map((n) => n.id)));
    // La primera vez se calcula la forma antes de enseñarla (la pantalla de carga lo tapa).
    // The first time the layout is computed before showing it (the loading screen covers it).
    Graph.warmupTicks(first ? Math.min(120, 20 + Math.round(nodes.length / 15)) : 0);
    Graph.graphData({ nodes, links });
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
    measureFps,
    fit: () => Graph.zoomToFit(900, 80),
    visibleNodes: () => Graph.graphData().nodes,
    get quality() { return quality; },
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

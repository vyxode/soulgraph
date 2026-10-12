// Inspector: el panel lateral derecho con los detalles, el editor y las conexiones de un nodo.
// Inspector: the right side panel with a node's details, editor and connections.
//
// Tiene dos partes: la cabecera y las conexiones (se redibujan con cada cambio) y el contenido
// editable (se conserva para no perder lo que estás escribiendo).
// It has two parts: header and connections (redrawn on every change) and the editable
// content (kept so you don't lose what you're typing).

import { t, kindLabel, issueLabel } from './i18n.js';
import { h, api, toast, formatBytes, colorOfKind, pathOf, SCRIPT_KINDS } from './util.js';

export function createInspector({ state, select, setFocus }) {
  const panel = document.getElementById('inspector');
  const $ = (id) => document.getElementById(id);
  const editTarget = (node) => (node.kind === 'function' ? state.nodes.get(node.parent) || node : node);

  // ---------- Abrir y cerrar / Open and close ----------

  function confirmDiscard() {
    const dirty = (state.editor && state.editor.dirty) || (state.props && state.props.dirty);
    return !dirty || window.confirm(t('discard'));
  }

  function open(node, { line } = {}) {
    destroyEditor();
    state.props = null;
    panel.hidden = false;
    panel.replaceChildren(
      h('div', { class: 'insp-head', id: 'insp-head' }),
      h('div', { class: 'insp-body' },
        h('section', { id: 'insp-content' }),
        h('div', { id: 'insp-meta' })),
    );
    renderMeta();
    renderContent(node, line);
  }

  function close({ force = false } = {}) {
    if (!force && !confirmDiscard()) return;
    destroyEditor();
    state.selectedId = null;
    state.props = null;
    panel.hidden = true;
    setFocus(null);
  }

  function destroyEditor() {
    if (state.editor) state.editor.cm.destroy();
    state.editor = null;
  }

  // ---------- Cabecera y conexiones / Header and connections ----------

  function renderMeta() {
    const node = state.nodes.get(state.selectedId);
    if (!node) return;

    const chips = [
      kindLabel(node.kind),
      t(node.source),
      node.source === 'studio' && node.class && node.class !== kindLabel(node.kind) ? node.class : null,
      node.lines != null ? `${node.lines} ${t('lines')}` : null,
      node.size != null ? formatBytes(node.size) : null,
      node.disabled ? 'Disabled' : null,
    ].filter(Boolean);
    const issues = state.issues.filter((i) => i.ids.includes(node.id));

    const actions = [];
    if (node.source === 'studio' && node.kind !== 'game') {
      actions.push(h('button', {
        class: 'btn',
        type: 'button',
        text: t('openInStudio'),
        // Abre el script en la línea donde tienes el cursor / Opens the script at your cursor's line
        onclick: () => studioCommand({ type: 'open', id: node.id, line: state.editor ? state.editor.cm.currentLine() : undefined }),
      }));
    } else if (node.source === 'disk') {
      actions.push(h('button', {
        class: 'btn',
        type: 'button',
        text: t('copyPath'),
        onclick: () => navigator.clipboard.writeText(pathOf(node, state.nodes)).then(() => toast(t('copied'))),
      }));
    }

    $('insp-head').replaceChildren(
      h('div', { class: 'insp-title' },
        h('span', { class: 'dot', style: `color:${colorOfKind(node.kind)}` }),
        h('h1', { text: node.name }),
        h('button', { class: 'icon-btn', type: 'button', title: t('close'), 'aria-label': t('close'), onclick: () => close(), text: '✕' })),
      h('p', { class: 'insp-path', text: pathOf(node, state.nodes) }),
      h('div', { class: 'chips' },
        chips.map((c) => h('span', { class: 'chip', text: c })),
        issues.map((i) => h('span', { class: 'chip bad', text: `⚠ ${issueLabel(i.type)}${i.detail ? `: ${i.detail}` : ''}` }))),
      actions.length ? h('div', { class: 'actions' }, actions) : null,
    );

    $('insp-meta').replaceChildren(...metaSections(node));
  }

  function metaSections(node) {
    const sections = [];
    const id = node.id;

    if (node.symbols && node.symbols.length) {
      sections.push(h('section', {},
        h('h3', { text: `${t('defines')} (${node.symbols.length})` }),
        h('div', { class: 'chips' }, node.symbols.slice(0, 80).map((symbol) => {
          const fnId = `${id}#${symbol}`;
          return h('button', {
            class: 'chip',
            type: 'button',
            text: symbol,
            // Las funciones públicas son nodos; las locales llevan a su línea / Public functions are nodes; local ones jump to their line
            onclick: () => (state.nodes.has(fnId) ? select(fnId) : goToDefinition(symbol)),
          });
        }))));
    }

    const out = (type) => state.links.filter((l) => l.type === type && l.source === id).map((l) => l.target);
    const into = (type) => state.links.filter((l) => l.type === type && l.target === id).map((l) => l.source);
    const isEvent = node.kind === 'remote';

    const groups = [
      [t('uses'), out('requires')],
      [t('usedBy'), into('requires')],
      [t('callsTo'), out('calls')],
      [t('calledBy'), into('calls')],
      [isEvent ? t('firedBy') : t('fires'), isEvent ? into('signal') : out('signal')],
      [isEvent ? t('heardBy') : t('listensTo'), isEvent ? out('signal') : into('signal')],
      [t('mentions'), out('references')],
      [t('mentionedBy'), into('references')],
      [t('inside'), node.parent ? [node.parent] : []],
      [t('children'), out('contains')],
    ];

    for (const [title, ids] of groups) {
      const nodes = ids.map((x) => state.nodes.get(x)).filter(Boolean);
      if (!nodes.length) continue;
      const shown = nodes.slice(0, 60);
      sections.push(h('section', {},
        h('h3', { text: `${title} (${nodes.length})` }),
        h('div', { class: 'links-list' },
          shown.map((n) => h('button', { class: 'link-item', type: 'button', onclick: () => select(n.id) },
            h('span', { class: 'dot', style: `color:${colorOfKind(n.kind)}` }),
            h('span', { class: 'name', text: n.kind === 'function' ? `${state.nodes.get(n.parent)?.name || ''} · ${n.name}` : n.name }),
            h('span', { class: 'sub', text: kindLabel(n.kind) }))),
          nodes.length > shown.length ? h('span', { class: 'sub', text: `+${nodes.length - shown.length}` }) : null)));
    }
    return sections;
  }

  // ---------- Contenido / Content ----------

  function renderContent(node, line) {
    const box = $('insp-content');
    const target = editTarget(node);

    if (target.editable || (target.source === 'studio' && SCRIPT_KINDS.has(target.kind))) {
      box.replaceChildren(h('p', { class: 'empty', text: '…' }));
      loadEditor(node, line);
    } else if (node.source === 'studio' && node.kind !== 'game') {
      box.replaceChildren(propsForm(node));
    } else if (node.kind === 'image') {
      box.replaceChildren(h('img', { class: 'preview', alt: node.name, src: `/api/raw?id=${encodeURIComponent(node.id)}&v=${node.rev}` }));
    } else if (node.source === 'disk' && !['folder', 'root'].includes(node.kind) && node.size > 0) {
      box.replaceChildren(h('p', { class: 'empty', text: t('notEditable') }));
    } else {
      box.replaceChildren();
    }
  }

  // ---------- Editor de código / Code editor ----------

  async function loadEditor(node, line) {
    let data;
    try {
      data = await api(`/api/node?id=${encodeURIComponent(node.id)}`);
    } catch (err) {
      $('insp-content').replaceChildren(h('p', { class: 'empty', text: err.message }));
      return;
    }
    if (state.selectedId !== node.id) return; // ya se eligió otro nodo / another node was picked meanwhile
    if (typeof data.content !== 'string') {
      $('insp-content').replaceChildren(h('p', { class: 'empty', text: t('notEditable') }));
      return;
    }

    const target = editTarget(node);
    const host = h('div', { class: 'editor-host' });
    const banner = h('div', { class: 'banner', hidden: true });
    const status = h('span', { class: 'editor-state' });
    const saveBtn = h('button', { class: 'btn primary', type: 'button', text: t('save'), onclick: () => save() });

    $('insp-content').replaceChildren(h('div', { class: 'editor' }, banner, host, h('div', { class: 'editor-bar' }, status, saveBtn)));

    destroyEditor();
    const cm = window.SoulEditor.create({
      parent: host,
      doc: data.content,
      ext: target.source === 'studio' ? 'lua' : target.ext,
      onChange: updateDirty,
      onSave: () => save(),
    });
    state.editor = { id: node.id, editId: data.editId, base: data.base, original: data.content, dirty: false, cm, status, saveBtn, banner };
    updateDirty();

    if (line) cm.goToLine(line);
    else if (node.kind === 'function') goToDefinition(node.name);
  }

  // Salta a la línea donde se define una función / Jumps to the line where a function is defined
  function goToDefinition(symbol) {
    const ed = state.editor;
    if (!ed) return;
    const name = symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const pattern = new RegExp(`(function\\s+${name}\\s*\\(|${name}\\s*=\\s*function\\b)`);
    const index = ed.cm.getValue().split('\n').findIndex((text) => pattern.test(text));
    if (index >= 0) ed.cm.goToLine(index + 1);
  }

  function goToLine(line) {
    if (state.editor) state.editor.cm.goToLine(line);
  }

  function updateDirty() {
    const ed = state.editor;
    if (!ed) return;
    ed.dirty = ed.cm.getValue() !== ed.original;
    ed.status.textContent = ed.dirty ? `● ${t('unsaved')}` : '';
    ed.status.classList.toggle('dirty', ed.dirty);
    ed.saveBtn.disabled = !ed.dirty;
  }

  async function save() {
    const ed = state.editor;
    if (!ed || !ed.dirty) return;
    ed.status.textContent = t('saving');
    const content = ed.cm.getValue();
    try {
      const res = await api('/api/save', { method: 'POST', body: { id: ed.editId, content, base: ed.base } });
      ed.base = res.base;
      ed.original = content;
      ed.banner.hidden = true;
      updateDirty();
      toast(t('saved'));
    } catch (err) {
      updateDirty();
      if (err.status === 409) showConflict(err.data.content, err.data.base);
      else toast(err.status === 503 ? t('needsStudio') : `${t('error')}: ${err.message}`, true);
    }
  }

  // Alguien cambió el archivo mientras editabas: tú eliges qué versión gana.
  // Someone changed the file while you were editing: you choose which version wins.
  function showConflict(remoteContent, remoteBase) {
    const ed = state.editor;
    if (!ed) return;
    ed.banner.hidden = false;
    ed.banner.replaceChildren(
      h('span', { text: t('changedOutside') }),
      h('button', {
        class: 'btn',
        type: 'button',
        text: t('reload'),
        onclick: () => {
          ed.cm.setValue(remoteContent ?? '');
          ed.original = ed.cm.getValue();
          ed.base = remoteBase;
          ed.banner.hidden = true;
          updateDirty();
        },
      }),
      h('button', {
        class: 'btn',
        type: 'button',
        text: t('overwrite'),
        onclick: () => {
          ed.base = remoteBase;
          ed.banner.hidden = true;
          save();
        },
      }),
    );
  }

  // Tras cada actualización del grafo / After every graph update
  async function sync() {
    if (!state.selectedId) return;
    const node = state.nodes.get(state.selectedId);
    if (!node) {
      close({ force: true });
      return;
    }
    renderMeta();

    const ed = state.editor;
    const target = editTarget(node);
    if (ed && target.rev !== undefined && target.rev !== ed.base) {
      const data = await api(`/api/node?id=${encodeURIComponent(node.id)}`).catch(() => null);
      if (!data || state.editor !== ed || typeof data.content !== 'string') return;
      if (data.content === ed.cm.getValue()) {
        ed.base = data.base;
        ed.original = data.content;
        updateDirty();
      } else if (!ed.dirty) {
        // Cambio de fuera y no tocaste nada: se actualiza en vivo sin perder la posición.
        // Outside change and you didn't touch anything: update live keeping your position.
        ed.cm.setValue(data.content);
        ed.original = data.content;
        ed.base = data.base;
        updateDirty();
      } else {
        showConflict(data.content, data.base);
      }
    } else if (!ed && node.source === 'studio' && !(state.props && state.props.dirty)) {
      if (SCRIPT_KINDS.has(target.kind)) {
        if (!$('insp-content').querySelector('.editor')) renderContent(node);
      } else if (node.kind !== 'game') {
        $('insp-content').replaceChildren(propsForm(node));
      }
    }
  }

  // ---------- Propiedades de Studio / Studio properties ----------

  function propsForm(node) {
    const form = h('form', { class: 'props' });
    state.props = { id: node.id, dirty: false };
    const markDirty = () => { state.props.dirty = true; };

    const nameInput = h('input', { type: 'text', value: node.name, oninput: markDirty });
    form.append(h('label', { text: t('name') }), nameInput);

    const attrInputs = [];
    for (const [key, attr] of Object.entries(node.attrs || {})) {
      const type = attr && attr.type;
      let input;
      if (type === 'boolean') input = h('input', { type: 'checkbox', checked: attr.value === true, onchange: markDirty });
      else if (type === 'number') input = h('input', { type: 'number', step: 'any', value: attr.value, oninput: markDirty });
      else if (type === 'string') input = h('input', { type: 'text', value: attr.value, oninput: markDirty });
      else input = h('span', { class: 'readonly', text: `${attr && attr.value} (${type})` });
      form.append(h('label', { text: key }), input);
      if (input.tagName === 'INPUT') attrInputs.push([key, type, input]);
    }

    if (node.tags) form.append(h('label', { text: t('tags') }), h('span', { class: 'readonly', text: node.tags.join(', ') }));

    form.append(h('span'), h('div', { class: 'actions' }, h('button', { class: 'btn primary', type: 'submit', text: t('applyChanges') })));

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const attrs = {};
      for (const [key, type, input] of attrInputs) {
        if (type === 'boolean') attrs[key] = input.checked;
        else if (type === 'number') attrs[key] = Number(input.value);
        else attrs[key] = input.value;
      }
      if (await studioCommand({ type: 'props', id: node.id, name: nameInput.value, attrs })) state.props.dirty = false;
    });

    return h('section', {}, h('h3', { text: t('attributes') }), form);
  }

  async function studioCommand(body) {
    try {
      await api('/api/studio/command', { method: 'POST', body });
      toast('✓');
      return true;
    } catch (err) {
      toast(err.status === 503 ? t('needsStudio') : `${t('error')}: ${err.message}`, true);
      return false;
    }
  }

  return { open, close, sync, renderMeta, confirmDiscard, goToLine };
}

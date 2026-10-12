// Editor de código del panel (CodeMirror 6), empaquetado en public/vendor/editor-bundle.js.
// Panel code editor (CodeMirror 6), bundled into public/vendor/editor-bundle.js.
//
// Expone window.SoulEditor.create(...) con una API mínima para que app.js no dependa de CodeMirror.
// Exposes window.SoulEditor.create(...) with a tiny API so app.js doesn't depend on CodeMirror.

import { EditorState } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, highlightSpecialChars, rectangularSelection,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import {
  StreamLanguage, HighlightStyle, syntaxHighlighting, bracketMatching, indentOnInput, foldGutter, foldKeymap,
} from '@codemirror/language';
import { lua } from '@codemirror/legacy-modes/mode/lua';
import { javascript, json } from '@codemirror/legacy-modes/mode/javascript';
import { tags } from '@lezer/highlight';

// Lenguaje según la extensión / Language by extension
const LANGUAGES = {
  lua: () => StreamLanguage.define(lua),
  luau: () => StreamLanguage.define(lua),
  js: () => StreamLanguage.define(javascript),
  mjs: () => StreamLanguage.define(javascript),
  cjs: () => StreamLanguage.define(javascript),
  json: () => StreamLanguage.define(json),
};

// Colores a juego con el panel / Colors matching the panel
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: '#c792ea' },
  { tag: [tags.string, tags.special(tags.string)], color: '#c3e88d' },
  { tag: [tags.number, tags.bool, tags.null], color: '#f78c6c' },
  { tag: tags.comment, color: '#5c6488', fontStyle: 'italic' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: '#82aaff' },
  { tag: [tags.variableName, tags.propertyName], color: '#e8eaf2' },
  { tag: [tags.operator, tags.punctuation], color: '#89ddff' },
  { tag: tags.standard(tags.variableName), color: '#ffcb6b' },
]);

const theme = EditorView.theme({
  '&': { height: '100%', color: '#dfe3f0', backgroundColor: '#07080e', fontSize: '12px' },
  '.cm-scroller': { fontFamily: 'ui-monospace, "JetBrains Mono", "Cascadia Code", Consolas, monospace', lineHeight: '1.55' },
  '.cm-content': { caretColor: '#ffffff' },
  '.cm-cursor': { borderLeftColor: '#ffffff' },
  '.cm-gutters': { backgroundColor: '#07080e', color: '#4a5070', border: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(255,255,255,0.04)' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: '#c9cde0' },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': { backgroundColor: 'rgba(130,170,255,0.25) !important' },
  '.cm-selectionMatch': { backgroundColor: 'rgba(255,209,102,0.18)' },
  '.cm-matchingBracket': { backgroundColor: 'rgba(255,255,255,0.12)', outline: 'none' },
  '.cm-panels': { backgroundColor: '#0c0e18', color: '#e8eaf2', borderColor: 'rgba(255,255,255,0.12)' },
  '.cm-panels input, .cm-panels button': { color: '#e8eaf2' },
  '.cm-searchMatch': { backgroundColor: 'rgba(255,209,102,0.25)' },
  '.cm-searchMatch-selected': { backgroundColor: 'rgba(255,209,102,0.5)' },
  '.cm-flash-line': { backgroundColor: 'rgba(255,209,102,0.18)' },
}, { dark: true });

function create({ parent, doc, ext, onChange, onSave }) {
  const language = LANGUAGES[ext] ? [LANGUAGES[ext]()] : [];
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [
        lineNumbers(), foldGutter(), highlightActiveLineGutter(), highlightSpecialChars(), history(),
        drawSelection(), rectangularSelection(), indentOnInput(), bracketMatching(), closeBrackets(),
        highlightActiveLine(), highlightSelectionMatches(), syntaxHighlighting(highlight), theme,
        EditorState.tabSize.of(4),
        // El panel es estrecho: las líneas largas se parten / The panel is narrow: long lines wrap
        EditorView.lineWrapping,
        ...language,
        keymap.of([
          { key: 'Mod-s', preventDefault: true, run: () => { onSave(); return true; } },
          ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab,
        ]),
        EditorView.updateListener.of((update) => { if (update.docChanged) onChange(); }),
      ],
    }),
  });

  return {
    getValue: () => view.state.doc.toString(),

    // Cambia el texto sin perder la posición del cursor ni el scroll.
    // Replaces the text without losing the cursor position or the scroll.
    setValue(text) {
      const { head } = view.state.selection.main;
      const scroll = view.scrollDOM.scrollTop;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: text },
        selection: { anchor: Math.min(head, text.length) },
      });
      view.scrollDOM.scrollTop = scroll;
    },

    // Va a una línea (empieza en 1) y la centra / Goes to a line (1-based) and centers it
    goToLine(number) {
      const line = view.state.doc.line(Math.max(1, Math.min(number, view.state.doc.lines)));
      view.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
      view.focus();
    },

    currentLine: () => view.state.doc.lineAt(view.state.selection.main.head).number,
    focus: () => view.focus(),
    destroy: () => view.destroy(),
  };
}

window.SoulEditor = { create };

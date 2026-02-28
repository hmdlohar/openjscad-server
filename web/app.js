const statusEl = document.getElementById('status');
const logPanel = document.getElementById('logPanel');
const runBtn = document.getElementById('runBtn');
const newBtn = document.getElementById('newBtn');
const sampleSelect = document.getElementById('sampleSelect');
const loadSampleBtn = document.getElementById('loadSampleBtn');
const openBtn = document.getElementById('openBtn');
const saveBtn = document.getElementById('saveBtn');
const exportStlBtn = document.getElementById('exportStlBtn');
const fileInput = document.getElementById('fileInput');
const viewerCanvas = document.getElementById('viewerCanvas');
const splitter = document.getElementById('splitter');
const mainGrid = document.querySelector('.main-grid');
const editorPanel = document.querySelector('.editor-panel');
const viewerPanel = document.querySelector('.viewer-panel');

let editor;
let rafHandle;
let latestSolids = [];

let jscadApi;
let stlSerialize;

let THREE;
let OrbitControls;
let STLLoader;
let threeRenderer;
let threeScene;
let threeCamera;
let threeControls;
let stlLoader;
let modelGroup;

const defaultCode = `const { cuboid, sphere } = primitives
const { colorize } = colors
const { translate } = transforms
const { union } = booleans

function main() {
  const base = colorize([0.1, 0.6, 0.85], cuboid({ size: [38, 28, 8] }))
  const dome = colorize([0.95, 0.35, 0.18], translate([0, 0, 8], sphere({ radius: 12, segments: 48 })))
  return union(base, dome)
}

return main()
`;

const samples = {
  default: defaultCode,
  gearish: `const { cylinder, circle } = primitives
const { extrudeLinear } = extrusions
const { rotateZ, translate } = transforms
const { union, subtract } = booleans
const { colorize } = colors

function main() {
  const outer = cylinder({ height: 8, radius: 28, segments: 64 })
  const inner = cylinder({ height: 10, radius: 10, segments: 48 })
  const tooth2d = circle({ radius: 4, segments: 24 })

  const teeth = []
  for (let i = 0; i < 18; i++) {
    const angle = (Math.PI * 2 * i) / 18
    const tx = Math.cos(angle) * 28
    const ty = Math.sin(angle) * 28
    const tooth = extrudeLinear({ height: 8 }, tooth2d)
    teeth.push(rotateZ(angle, translate([tx, ty, 0], tooth)))
  }

  const body = union(outer, ...teeth)
  const wheel = subtract(body, inner)
  return colorize([0.15, 0.55, 0.85], wheel)
}

return main()
`,
  vase: `const { cylinder } = primitives
const { subtract, union } = booleans
const { translate } = transforms
const { colorize } = colors

function main() {
  const shellOuter = cylinder({ height: 62, radiusStart: 10, radiusEnd: 18, segments: 96 })
  const shellInner = translate([0, 0, 3], cylinder({ height: 58, radiusStart: 7.5, radiusEnd: 14.5, segments: 96 }))
  const ringA = translate([0, 0, 20], cylinder({ height: 2, radius: 19, segments: 96 }))
  const ringB = translate([0, 0, 38], cylinder({ height: 2, radius: 21, segments: 96 }))
  const shell = subtract(shellOuter, shellInner)
  return colorize([0.95, 0.45, 0.18], union(shell, ringA, ringB))
}

return main()
`
};

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? 'var(--error)' : 'var(--ok)';
}

function log(message) {
  logPanel.textContent = `${new Date().toLocaleTimeString()}  ${message}\n${logPanel.textContent}`;
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), delay);
  };
}

async function loadDependencies() {
  const [modelingMod, stlMod, threeMod, controlsMod, stlLoaderMod] = await Promise.all([
    import('https://esm.sh/@jscad/modeling'),
    import('https://esm.sh/@jscad/stl-serializer'),
    import('https://esm.sh/three@0.160.0'),
    import('https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js'),
    import('https://esm.sh/three@0.160.0/examples/jsm/loaders/STLLoader.js')
  ]);

  const modeling = modelingMod.default || modelingMod;
  jscadApi = {
    booleans: modeling.booleans,
    colors: modeling.colors,
    curves: modeling.curves,
    extrusions: modeling.extrusions,
    geometries: modeling.geometries,
    hulls: modeling.hulls,
    maths: modeling.maths,
    measurements: modeling.measurements,
    primitives: modeling.primitives,
    text: modeling.text,
    transforms: modeling.transforms,
    utils: modeling.utils
  };

  const stlApi = stlMod.default || stlMod;
  stlSerialize = stlApi.serialize;

  THREE = threeMod;
  OrbitControls = controlsMod.OrbitControls;
  STLLoader = stlLoaderMod.STLLoader;
}

function initThree() {
  threeRenderer = new THREE.WebGLRenderer({
    canvas: viewerCanvas,
    antialias: true,
    preserveDrawingBuffer: true
  });
  threeRenderer.setPixelRatio(Math.max(1, window.devicePixelRatio || 1));
  threeRenderer.setClearColor(0xf2f7ff, 1);

  threeScene = new THREE.Scene();

  threeCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 5000);
  threeCamera.position.set(140, -160, 120);
  threeCamera.up.set(0, 0, 1);

  threeControls = new OrbitControls(threeCamera, viewerCanvas);
  threeControls.target.set(0, 0, 0);
  threeControls.enableDamping = true;

  const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
  keyLight.position.set(160, -80, 220);
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.55);
  fillLight.position.set(-120, 120, 120);
  const ambient = new THREE.AmbientLight(0xffffff, 0.35);

  threeScene.add(keyLight, fillLight, ambient);

  const grid = new THREE.GridHelper(240, 24, 0x8da6c4, 0xc8d5e8);
  grid.rotateX(Math.PI / 2);
  threeScene.add(grid);

  const axes = new THREE.AxesHelper(80);
  threeScene.add(axes);

  modelGroup = new THREE.Group();
  threeScene.add(modelGroup);

  stlLoader = new STLLoader();

  const animate = () => {
    threeControls.update();
    threeRenderer.render(threeScene, threeCamera);
    rafHandle = requestAnimationFrame(animate);
  };

  cancelAnimationFrame(rafHandle);
  animate();

  resizeViewer();
}

function resizeViewer() {
  const rect = viewerCanvas.getBoundingClientRect();
  const width = Math.max(320, Math.floor(rect.width || 640));
  const height = Math.max(240, Math.floor(rect.height || 420));

  threeRenderer.setSize(width, height, false);
  threeCamera.aspect = width / height;
  threeCamera.updateProjectionMatrix();
}

function normalizeResult(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flat(Infinity).filter(Boolean);
  return [value];
}

function evaluateCode(source) {
  const fn = new Function(...Object.keys(jscadApi), `'use strict';\n${source}`);
  return fn(...Object.values(jscadApi));
}

function toArrayBuffer(part) {
  if (part instanceof ArrayBuffer) return part;
  if (ArrayBuffer.isView(part)) {
    return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength);
  }
  const text = typeof part === 'string' ? part : String(part);
  return new TextEncoder().encode(text).buffer;
}

function flattenParts(value) {
  if (Array.isArray(value)) return value.flat(Infinity);
  return [value];
}

function fitCameraToGroup(group) {
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return;

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1);
  const fov = (threeCamera.fov * Math.PI) / 180;
  const distance = maxDim / (2 * Math.tan(fov / 2));

  const offset = new THREE.Vector3(1.2, -1.4, 1.0).normalize().multiplyScalar(distance * 1.9);
  threeCamera.position.copy(center.clone().add(offset));
  threeControls.target.copy(center);
  threeCamera.near = Math.max(0.01, distance / 300);
  threeCamera.far = Math.max(5000, distance * 12);
  threeCamera.updateProjectionMatrix();
  threeControls.update();
}

function clearModelGroup() {
  while (modelGroup.children.length) {
    const child = modelGroup.children.pop();
    if (!child) break;
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) {
        child.material.forEach((mat) => mat.dispose());
      } else {
        child.material.dispose();
      }
    }
    modelGroup.remove(child);
  }
}

function renderSolids(solids) {
  clearModelGroup();

  const chunks = stlSerialize({ binary: false }, ...solids);
  const parts = flattenParts(chunks).map((part) => (typeof part === 'string' ? part : String(part)));
  const stlText = parts.join('\n');

  const geometry = stlLoader.parse(stlText);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x2d8fda,
    roughness: 0.38,
    metalness: 0.06
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  modelGroup.add(mesh);

  fitCameraToGroup(modelGroup);
  resizeViewer();
}

function runModel() {
  if (!editor || !jscadApi || !threeRenderer) {
    setStatus('Editor is not initialized yet.', true);
    return;
  }

  try {
    const result = evaluateCode(editor.getValue());
    const solids = normalizeResult(result);

    if (!solids.length) {
      throw new Error('main() returned no geometry.');
    }

    latestSolids = solids;
    renderSolids(solids);
    setStatus(`Rendered ${solids.length} solid(s)`);
    log(`Rendered ${solids.length} solid(s)`);
  } catch (error) {
    setStatus(error.message, true);
    log(`Error: ${error.message}`);
  }
}

function downloadText(filename, textContent) {
  const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function exportStl() {
  if (!latestSolids.length) {
    setStatus('Render a model before exporting STL.', true);
    return;
  }

  try {
    const data = stlSerialize({ binary: false }, ...latestSolids);
    const content = Array.isArray(data) ? data.join('\n') : String(data);
    downloadText('model.stl', content);
    log('Exported STL to model.stl');
  } catch (error) {
    setStatus(`STL export failed: ${error.message}`, true);
    log(`STL export failed: ${error.message}`);
  }
}

function importCodeFromFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    editor.setValue(String(reader.result || ''));
    runModel();
    log(`Imported code from ${file.name}`);
  };
  reader.onerror = () => setStatus('Could not read file.', true);
  reader.readAsText(file);
}

function monacoLoader() {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/monaco-editor@0.48.0/min/vs/loader.js';
    script.onload = () => {
      if (!window.require) {
        reject(new Error('Monaco loader did not initialize.'));
        return;
      }

      window.require.config({
        paths: {
          vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.48.0/min/vs'
        }
      });

      window.require(['vs/editor/editor.main'], () => resolve(window.monaco));
    };
    script.onerror = () => reject(new Error('Failed to load Monaco editor.'));
    document.head.appendChild(script);
  });
}

function buildNamespaceType(namespaceObject) {
  const lines = ['{'];
  const keys = Object.keys(namespaceObject || {}).sort();

  keys.forEach((key) => {
    const value = namespaceObject[key];
    if (typeof value === 'function') {
      lines.push(`  ${key}: (...args: any[]) => any;`);
    } else if (value && typeof value === 'object') {
      lines.push(`  ${key}: Record<string, any>;`);
    } else {
      lines.push(`  ${key}: any;`);
    }
  });

  lines.push('}');
  return lines.join('\n');
}

function buildDynamicApiDts(api) {
  const namespaces = Object.keys(api || {}).sort();
  const blocks = namespaces
    .map((name) => `declare const ${name}: ${buildNamespaceType(api[name])};`)
    .join('\n\n');

  return `${blocks}

/**
 * JSCAD code entrypoint should return one solid or an array of solids.
 */
declare function main(...args: any[]): any;
`;
}

function addTypeHints(monaco, api) {
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
    target: monaco.languages.typescript.ScriptTarget.ES2020,
    allowNonTsExtensions: true,
    noLib: false,
    checkJs: true,
    allowJs: true
  });
  monaco.languages.typescript.javascriptDefaults.setEagerModelSync(true);
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
    noSemanticValidation: false,
    noSyntaxValidation: false
  });

  const dynamicDts = buildDynamicApiDts(api);
  monaco.languages.typescript.javascriptDefaults.addExtraLib(dynamicDts, 'ts:jscad-api.generated.d.ts');

  monaco.languages.registerCompletionItemProvider('javascript', {
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      const rootSuggestions = Object.keys(api || {}).map((name) => ({
        label: name,
        kind: monaco.languages.CompletionItemKind.Variable,
        insertText: name,
        detail: 'JSCAD global namespace',
        range
      }));

      const snippetSuggestions = [
        {
          label: 'jscad-main-template',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: [
            'const { cuboid, sphere } = primitives',
            'const { union } = booleans',
            'const { translate } = transforms',
            '',
            'function main() {',
            '  const base = cuboid({ size: [30, 20, 8] })',
            '  const dome = translate([0, 0, 8], sphere({ radius: 10 }))',
            '  return union(base, dome)',
            '}',
            '',
            'return main()'
          ].join('\n'),
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Starter JSCAD model',
          range
        },
        {
          label: 'jscad-globals',
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: 'const { ${1:cuboid}, ${2:sphere} } = primitives',
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: 'Destructure from primitives',
          range
        }
      ];

      return { suggestions: [...rootSuggestions, ...snippetSuggestions] };
    }
  });
}

function wireUi() {
  const scheduleRun = debounce(runModel, 350);
  editor.onDidChangeModelContent(scheduleRun);

  runBtn.addEventListener('click', runModel);
  newBtn.addEventListener('click', () => {
    editor.setValue(defaultCode);
    runModel();
  });

  loadSampleBtn.addEventListener('click', () => {
    const key = sampleSelect.value;
    editor.setValue(samples[key] || defaultCode);
    runModel();
    log(`Loaded sample: ${key}`);
  });

  openBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const [file] = fileInput.files || [];
    if (file) importCodeFromFile(file);
    fileInput.value = '';
  });

  saveBtn.addEventListener('click', () => {
    downloadText('model.jscad', editor.getValue());
    log('Exported code to model.jscad');
  });

  exportStlBtn.addEventListener('click', exportStl);
  window.addEventListener('resize', () => {
    if (threeRenderer) resizeViewer();
  });

  if (splitter && mainGrid && editorPanel && viewerPanel) {
    splitter.addEventListener('pointerdown', (event) => {
      if (window.matchMedia('(max-width: 1024px)').matches) return;

      const gridRect = mainGrid.getBoundingClientRect();
      splitter.setPointerCapture(event.pointerId);

      const onMove = (moveEvent) => {
        const x = moveEvent.clientX - gridRect.left;
        const minLeft = 280;
        const minRight = 280;
        const maxLeft = Math.max(minLeft, gridRect.width - minRight - splitter.offsetWidth);
        const left = Math.min(maxLeft, Math.max(minLeft, x));
        const right = Math.max(minRight, gridRect.width - left - splitter.offsetWidth);

        editorPanel.style.flex = `0 0 ${left}px`;
        viewerPanel.style.flex = `0 0 ${right}px`;

        if (threeRenderer) resizeViewer();
      };

      const onUp = (upEvent) => {
        splitter.removeEventListener('pointermove', onMove);
        splitter.removeEventListener('pointerup', onUp);
        splitter.removeEventListener('pointercancel', onUp);
        try {
          splitter.releasePointerCapture(upEvent.pointerId);
        } catch {
          // no-op
        }
      };

      splitter.addEventListener('pointermove', onMove);
      splitter.addEventListener('pointerup', onUp);
      splitter.addEventListener('pointercancel', onUp);
    });
  }
}

async function boot() {
  setStatus('Loading editor and renderer...');

  const [monaco] = await Promise.all([monacoLoader(), loadDependencies()]);
  addTypeHints(monaco, jscadApi);

  initThree();

  editor = monaco.editor.create(document.getElementById('editor'), {
    value: defaultCode,
    language: 'javascript',
    theme: 'vs',
    automaticLayout: true,
    minimap: { enabled: false },
    fontSize: 14,
    roundedSelection: false,
    scrollBeyondLastLine: false,
    tabSize: 2
  });

  wireUi();
  runModel();
}

boot().catch((error) => {
  setStatus('Startup failed (check log)', true);
  log(`Startup failed: ${error.message}`);
  console.error(error);
});

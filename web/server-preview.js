const fileSelect = document.getElementById('fileSelect');
const refreshFilesBtn = document.getElementById('refreshFilesBtn');
const renderFileBtn = document.getElementById('renderFileBtn');
const statusEl = document.getElementById('status');
const logPanel = document.getElementById('logPanel');
const viewerCanvas = document.getElementById('viewerCanvas');
const paramsContainer = document.getElementById('paramsContainer');

let THREE;
let OrbitControls;
let STLLoader;
let threeRenderer;
let threeScene;
let threeCamera;
let threeControls;
let stlLoader;
let modelGroup;
let rafHandle;
let lastStlData = '';
let lastFileName = 'model.stl';

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? 'var(--error)' : 'var(--ok)';
}

function log(message) {
  logPanel.textContent = `${new Date().toLocaleTimeString()}  ${message}\n${logPanel.textContent}`;
}

async function loadThreeDeps() {
  const [threeMod, controlsMod, stlLoaderMod] = await Promise.all([
    import('https://esm.sh/three@0.160.0'),
    import('https://esm.sh/three@0.160.0/examples/jsm/controls/OrbitControls.js'),
    import('https://esm.sh/three@0.160.0/examples/jsm/loaders/STLLoader.js')
  ]);

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

function clearModelGroup() {
  while (modelGroup.children.length) {
    const child = modelGroup.children.pop();
    if (!child) break;
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((mat) => mat.dispose());
      else child.material.dispose();
    }
    modelGroup.remove(child);
  }
}

function fitCameraToGroup() {
  const box = new THREE.Box3().setFromObject(modelGroup);
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

function renderStl(stlText) {
  clearModelGroup();
  const geometry = stlLoader.parse(stlText);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    color: 0x2d8fda,
    roughness: 0.38,
    metalness: 0.06
  });
  const mesh = new THREE.Mesh(geometry, material);
  modelGroup.add(mesh);

  fitCameraToGroup();
  resizeViewer();
}

async function fetchModelFiles() {
  const response = await fetch('/api/model-files');
  if (!response.ok) throw new Error('Could not load model file list');

  const payload = await response.json();
  const files = Array.isArray(payload.files) ? payload.files : [];

  const previousValue = fileSelect.value;
  fileSelect.innerHTML = '';
  files.forEach((filePath) => {
    const option = document.createElement('option');
    option.value = filePath;
    option.textContent = filePath;
    fileSelect.appendChild(option);
  });

  if (!files.length) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '(no .js/.jscad files in models/)';
    fileSelect.appendChild(option);
  } else if (previousValue && files.includes(previousValue)) {
    fileSelect.value = previousValue;
  }

  log(`Found ${files.length} model file(s)`);
}

async function loadParameters() {
  const filePath = fileSelect.value;
  if (!filePath) return;

  try {
    const response = await fetch('/api/get-params', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filePath })
    });
    const data = await response.json();
    renderParameterInputs(data.params || []);
  } catch (err) {
    log(`Error loading parameters: ${err.message}`);
  }
}

function renderParameterInputs(params) {
  paramsContainer.innerHTML = '';
  if (params.length === 0) {
    paramsContainer.innerHTML = '<p class="empty-params">No parameters defined</p>';
    return;
  }

  params.forEach(p => {
    const item = document.createElement('div');
    item.className = 'param-item';

    const label = document.createElement('label');
    label.textContent = p.caption || p.name;
    item.appendChild(label);

    let input;
    if (p.type === 'choice') {
      input = document.createElement('select');
      p.values.forEach((val, i) => {
        const opt = document.createElement('option');
        opt.value = val;
        opt.textContent = (p.captions && p.captions[i]) ? p.captions[i] : val;
        if (val === p.initial) opt.selected = true;
        input.appendChild(opt);
      });
    } else if (p.type === 'text') {
      input = document.createElement('input');
      input.type = 'text';
      input.value = p.initial || '';
    } else if (p.type === 'number') {
      input = document.createElement('input');
      input.type = 'number';
      input.value = p.initial ?? 0;
      if (p.step !== undefined) input.step = p.step;
      if (p.min !== undefined) input.min = p.min;
      if (p.max !== undefined) input.max = p.max;
    } else if (p.type === 'checkbox' || p.type === 'bool') {
      input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = !!p.initial;
    }

    if (input) {
      input.dataset.name = p.name;
      input.dataset.type = p.type;
      item.appendChild(input);
    }

    paramsContainer.appendChild(item);
  });
}

function getCollectedParams() {
  const params = {};
  const inputs = paramsContainer.querySelectorAll('input, select');
  inputs.forEach(input => {
    const name = input.dataset.name;
    const type = input.dataset.type;
    let value;

    if (type === 'checkbox' || type === 'bool') {
      value = input.checked;
    } else if (type === 'number') {
      value = parseFloat(input.value);
    } else {
      value = input.value;
    }
    params[name] = value;
  });
  return params;
}

async function renderSelectedFile() {
  const filePath = fileSelect.value;
  if (!filePath) {
    setStatus('No model file selected.', true);
    return;
  }

  const params = getCollectedParams();
  setStatus('Rendering on server...');

  const response = await fetch('/api/server-render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ filePath, params })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Server render failed (${response.status})`);
  }

  renderStl(payload.stl || '');
  lastStlData = payload.stl || '';
  lastFileName = (filePath.split('/').pop() || 'model').replace(/\.[^/.]+$/, "") + '.stl';
  setStatus(`Rendered ${payload.solidsCount || 0} solid(s)`);
  log(`Rendered ${payload.filePath}`);
}

async function boot() {
  setStatus('Loading preview...');
  await loadThreeDeps();
  initThree();
  await fetchModelFiles();
  await loadParameters();

  refreshFilesBtn.addEventListener('click', async () => {
    try {
      await fetchModelFiles();
      await loadParameters();
      setStatus('File list refreshed');
    } catch (error) {
      setStatus(error.message, true);
      log(`Error: ${error.message}`);
    }
  });

  fileSelect.addEventListener('change', async () => {
    await loadParameters();
  });

  renderFileBtn.addEventListener('click', async () => {
    try {
      await renderSelectedFile();
    } catch (error) {
      setStatus(error.message, true);
      log(`Error: ${error.message}`);
    }
  });

  document.getElementById('downloadStlBtn').addEventListener('click', () => {
    if (!lastStlData) {
      setStatus('No STL available to download. Render first.', true);
      return;
    }
    const blob = new Blob([lastStlData], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = lastFileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
    log(`Downloaded ${lastFileName}`);
  });

  window.addEventListener('resize', () => {
    if (threeRenderer) resizeViewer();
  });

  if (fileSelect.value) {
    await renderSelectedFile();
  } else {
    setStatus('Add a .jscad file in models/ and refresh file list.');
  }
}

boot().catch((error) => {
  setStatus('Startup failed', true);
  log(`Startup failed: ${error.message}`);
  console.error(error);
});

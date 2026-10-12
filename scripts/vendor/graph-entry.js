// Librerías del grafo 3D, empaquetadas en public/vendor/graph-bundle.js.
// 3D graph libraries, bundled into public/vendor/graph-bundle.js.
import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

window.SoulVendor = { ForceGraph3D, THREE, UnrealBloomPass };

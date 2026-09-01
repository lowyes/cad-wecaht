const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const markerDir = path.join(root, 'miniprogram', 'assets', 'markers');
const modelDir = path.join(root, 'miniprogram', 'assets', 'assemblies', 'assembly_demo_0001');
const previewDir = path.join(root, 'miniprogram', 'assets', 'assembly-previews');
const sourceAssetDir = path.join(root, 'assets', 'assembly-demo');

function align4(buffer, fill = 0) {
  const padding = (4 - (buffer.length % 4)) % 4;
  return padding ? Buffer.concat([buffer, Buffer.alloc(padding, fill)]) : buffer;
}

function createBox(width, height, depth) {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const faces = [
    [[x,-y,-z],[x,-y,z],[x,y,z],[x,y,-z],[1,0,0]],
    [[-x,-y,z],[-x,-y,-z],[-x,y,-z],[-x,y,z],[-1,0,0]],
    [[-x,y,-z],[x,y,-z],[x,y,z],[-x,y,z],[0,1,0]],
    [[-x,-y,z],[x,-y,z],[x,-y,-z],[-x,-y,-z],[0,-1,0]],
    [[x,-y,z],[-x,-y,z],[-x,y,z],[x,y,z],[0,0,1]],
    [[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[0,0,-1]],
  ];
  const positions = [];
  const normals = [];
  const indices = [];
  faces.forEach((face, faceIndex) => {
    const normal = face[4];
    face.slice(0, 4).forEach((position) => {
      positions.push(...position);
      normals.push(...normal);
    });
    const offset = faceIndex * 4;
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  });
  return { positions, normals, indices };
}

function createCylinder(radius, height, segments = 32) {
  const positions = [];
  const normals = [];
  const indices = [];
  const half = height / 2;

  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    positions.push(x, -half, z, x, half, z);
    normals.push(Math.cos(angle), 0, Math.sin(angle), Math.cos(angle), 0, Math.sin(angle));
  }
  for (let i = 0; i < segments; i += 1) {
    const a = i * 2;
    const b = a + 1;
    const c = a + 2;
    const d = a + 3;
    indices.push(a, c, b, c, d, b);
  }

  const capStart = positions.length / 3;
  positions.push(0, half, 0, 0, -half, 0);
  normals.push(0, 1, 0, 0, -1, 0);
  for (let i = 0; i <= segments; i += 1) {
    const angle = (i / segments) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    positions.push(x, half, z, x, -half, z);
    normals.push(0, 1, 0, 0, -1, 0);
  }
  for (let i = 0; i < segments; i += 1) {
    const top = capStart + 2 + i * 2;
    const bottom = top + 1;
    indices.push(capStart, top, top + 2);
    indices.push(capStart + 1, bottom + 2, bottom);
  }
  return { positions, normals, indices };
}

function createGlb(geometry, color, name) {
  const positionArray = Float32Array.from(geometry.positions);
  const normalArray = Float32Array.from(geometry.normals);
  const indexArray = Uint16Array.from(geometry.indices);
  const positionBuffer = Buffer.from(positionArray.buffer);
  const normalBuffer = Buffer.from(normalArray.buffer);
  const indexBuffer = Buffer.from(indexArray.buffer);
  const positionOffset = 0;
  const normalOffset = align4(positionBuffer).length;
  const indexOffset = normalOffset + align4(normalBuffer).length;
  const binary = align4(Buffer.concat([
    align4(positionBuffer),
    align4(normalBuffer),
    align4(indexBuffer),
  ]));

  const points = geometry.positions.reduce((rows, value, index) => {
    const axis = index % 3;
    rows.min[axis] = Math.min(rows.min[axis], value);
    rows.max[axis] = Math.max(rows.max[axis], value);
    return rows;
  }, { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });

  const json = {
    asset: { version: '2.0', generator: 'CAD Vision deterministic assembly demo' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ name, mesh: 0 }],
    meshes: [{
      name,
      primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }],
    }],
    materials: [{
      name: `${name}-material`,
      pbrMetallicRoughness: {
        baseColorFactor: color,
        metallicFactor: 0.35,
        roughnessFactor: 0.32,
      },
    }],
    buffers: [{ byteLength: binary.length }],
    bufferViews: [
      { buffer: 0, byteOffset: positionOffset, byteLength: positionBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: normalOffset, byteLength: normalBuffer.length, target: 34962 },
      { buffer: 0, byteOffset: indexOffset, byteLength: indexBuffer.length, target: 34963 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: positionArray.length / 3, type: 'VEC3', min: points.min, max: points.max },
      { bufferView: 1, componentType: 5126, count: normalArray.length / 3, type: 'VEC3' },
      { bufferView: 2, componentType: 5123, count: indexArray.length, type: 'SCALAR' },
    ],
  };
  const jsonBuffer = align4(Buffer.from(JSON.stringify(json), 'utf8'), 0x20);
  const totalLength = 12 + 8 + jsonBuffer.length + 8 + binary.length;
  const header = Buffer.alloc(12);
  header.write('glTF', 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(totalLength, 8);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(jsonBuffer.length, 0);
  jsonHeader.write('JSON', 4);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(binary.length, 0);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, jsonHeader, jsonBuffer, binaryHeader, binary]);
}

function createDrawingSvg() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1200" viewBox="0 0 1600 1200">
  <rect width="1600" height="1200" fill="#ffffff"/>
  <g fill="none" stroke="#101820" stroke-width="5" stroke-linejoin="round">
    <rect x="26" y="26" width="1548" height="1148" stroke-width="3"/>
    <rect x="70" y="80" width="920" height="660"/>
    <rect x="210" y="570" width="640" height="95"/>
    <rect x="390" y="345" width="280" height="225"/>
    <rect x="460" y="205" width="140" height="140"/>
    <ellipse cx="530" cy="205" rx="70" ry="23"/>
    <ellipse cx="530" cy="345" rx="70" ry="23"/>
    <line x1="460" y1="205" x2="460" y2="345"/>
    <line x1="600" y1="205" x2="600" y2="345"/>
    <line x1="530" y1="140" x2="530" y2="690" stroke-width="2" stroke-dasharray="20 10 4 10"/>
    <line x1="170" y1="617" x2="890" y2="617" stroke-width="2" stroke-dasharray="20 10 4 10"/>
    <circle cx="530" cy="275" r="19" stroke-width="3"/>

    <rect x="1045" y="80" width="480" height="420"/>
    <rect x="1120" y="160" width="330" height="255"/>
    <rect x="1190" y="205" width="190" height="165"/>
    <circle cx="1285" cy="287" r="67"/>
    <circle cx="1285" cy="287" r="27"/>
    <line x1="1080" y1="287" x2="1490" y2="287" stroke-width="2" stroke-dasharray="20 10 4 10"/>
    <line x1="1285" y1="115" x2="1285" y2="460" stroke-width="2" stroke-dasharray="20 10 4 10"/>

    <line x1="210" y1="700" x2="850" y2="700" stroke-width="2"/>
    <line x1="210" y1="680" x2="210" y2="725" stroke-width="2"/>
    <line x1="850" y1="680" x2="850" y2="725" stroke-width="2"/>
    <path d="M210 700l25-10v20zM850 700l-25-10v20z" fill="#101820" stroke="none"/>
    <line x1="895" y1="205" x2="895" y2="665" stroke-width="2"/>
    <line x1="870" y1="205" x2="920" y2="205" stroke-width="2"/>
    <line x1="870" y1="665" x2="920" y2="665" stroke-width="2"/>
    <path d="M895 205l-10 25h20zM895 665l-10-25h20z" fill="#101820" stroke="none"/>

    <circle cx="300" cy="270" r="34"/>
    <line x1="324" y1="294" x2="410" y2="390" stroke-width="3"/>
    <circle cx="745" cy="285" r="34"/>
    <line x1="720" y1="310" x2="650" y2="390" stroke-width="3"/>
    <circle cx="950" cy="610" r="34"/>
    <line x1="916" y1="610" x2="850" y2="610" stroke-width="3"/>

    <rect x="70" y="790" width="920" height="330"/>
    <line x1="70" y1="870" x2="990" y2="870"/>
    <line x1="70" y1="950" x2="990" y2="950"/>
    <line x1="70" y1="1030" x2="990" y2="1030"/>
    <line x1="190" y1="790" x2="190" y2="1120"/>
    <line x1="650" y1="790" x2="650" y2="1120"/>
    <line x1="790" y1="790" x2="790" y2="1120"/>

    <rect x="1045" y="550" width="480" height="570"/>
    <line x1="1045" y1="930" x2="1525" y2="930"/>
    <line x1="1045" y1="1010" x2="1525" y2="1010"/>
    <line x1="1335" y1="930" x2="1335" y2="1120"/>
  </g>
  <g fill="#101820" font-family="Arial, 'Microsoft YaHei', sans-serif">
    <text x="100" y="130" font-size="34" font-weight="700">ASSEMBLY DEMO 0001</text>
    <text x="100" y="175" font-size="24">FRONT VIEW / 装配主视图</text>
    <text x="1080" y="130" font-size="24">TOP VIEW / 俯视图</text>
    <text x="510" y="735" font-size="25" text-anchor="middle">120</text>
    <text x="930" y="445" font-size="25" transform="rotate(90 930 445)">86</text>
    <text x="300" y="282" font-size="28" font-weight="700" text-anchor="middle">1</text>
    <text x="745" y="297" font-size="28" font-weight="700" text-anchor="middle">2</text>
    <text x="950" y="622" font-size="28" font-weight="700" text-anchor="middle">3</text>
    <text x="105" y="842" font-size="25" font-weight="700">ITEM</text>
    <text x="225" y="842" font-size="25" font-weight="700">PART NAME / 零件名称</text>
    <text x="688" y="842" font-size="25" font-weight="700">QTY</text>
    <text x="825" y="842" font-size="25" font-weight="700">MATERIAL</text>
    <text x="118" y="922" font-size="27">1</text><text x="225" y="922" font-size="27">PIN / 定位销</text><text x="706" y="922" font-size="27">1</text><text x="825" y="922" font-size="24">STEEL</text>
    <text x="118" y="1002" font-size="27">2</text><text x="225" y="1002" font-size="27">SUPPORT / 支座</text><text x="706" y="1002" font-size="27">1</text><text x="825" y="1002" font-size="24">AL 6061</text>
    <text x="118" y="1082" font-size="27">3</text><text x="225" y="1082" font-size="27">BASE / 底座</text><text x="706" y="1082" font-size="27">1</text><text x="825" y="1082" font-size="24">CAST IRON</text>
    <text x="1080" y="610" font-size="25">TECHNICAL NOTES</text>
    <text x="1080" y="660" font-size="22">1. REMOVE BURRS</text>
    <text x="1080" y="705" font-size="22">2. GENERAL TOL. ±0.2</text>
    <text x="1080" y="750" font-size="22">3. ASSEMBLE ITEMS 1–3</text>
    <text x="1080" y="800" font-size="22">SCALE  1 : 2</text>
    <text x="1080" y="850" font-size="22">DWG NO.  ASM-DEMO-0001</text>
    <text x="1075" y="980" font-size="30" font-weight="700">CAD VISION</text>
    <text x="1360" y="980" font-size="22">SHEET 1/1</text>
    <text x="1075" y="1060" font-size="26" font-weight="700">三零件装配示意图</text>
    <text x="1360" y="1060" font-size="22">REV A</text>
  </g>
</svg>`;
}

async function main() {
  fs.mkdirSync(markerDir, { recursive: true });
  fs.mkdirSync(modelDir, { recursive: true });
  fs.mkdirSync(previewDir, { recursive: true });
  fs.mkdirSync(sourceAssetDir, { recursive: true });

  const svg = createDrawingSvg();
  fs.writeFileSync(path.join(sourceAssetDir, 'assembly_demo_0001_target.svg'), svg);
  await sharp(Buffer.from(svg)).png().toFile(path.join(markerDir, 'assembly_demo_0001_target.png'));
  await sharp(Buffer.from(svg)).resize({ width: 960 }).png().toFile(path.join(previewDir, 'assembly_demo_0001.png'));

  fs.writeFileSync(path.join(modelDir, 'base.glb'), createGlb(createBox(2.4, 0.3, 1.2), [0.06, 0.52, 0.78, 1], 'base'));
  fs.writeFileSync(path.join(modelDir, 'support.glb'), createGlb(createBox(0.8, 0.72, 0.72), [0.18, 0.74, 0.48, 1], 'support'));
  fs.writeFileSync(path.join(modelDir, 'pin.glb'), createGlb(createCylinder(0.28, 0.72), [0.96, 0.42, 0.08, 1], 'pin'));
  console.log('Generated assembly_demo_0001 target, preview, and 3 GLB parts.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

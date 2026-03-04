/* Dual Letter Blocks Illusion and Triple Letter Blocks Ambigram
   Translated from SCAD to JSCAD
*/

const getParameterDefinitions = () => {
  return [
    { name: 'mode', type: 'choice', caption: 'Mode', values: [2, 3], captions: ['Dual', 'Triple'], initial: 2 },
    { name: 'String1', type: 'text', caption: 'Front String', initial: 'ASC' },
    { name: 'String2', type: 'text', caption: 'Side String', initial: 'DAS' },
    { name: 'String3', type: 'text', caption: 'Top String (Triple only)', initial: 'TRP' },
    { name: 'letterScaling', type: 'number', caption: 'Letter Scaling', initial: 1, step: 0.1 },
    { name: 'additionalSpacing', type: 'number', caption: 'Additional Spacing (%)', initial: 0.0, step: 0.1 },
    { name: 'baseHeight', type: 'number', caption: 'Base Height', initial: 3, step: 0.1 },
    { name: 'Scl', type: 'number', caption: 'Global Scale', initial: 1, step: 0.1 },
    { name: 'width_of_space_character', type: 'choice', caption: 'Space Width', values: ['minimal', 'maximal'], initial: 'minimal' },
    { name: 'add_base_characters_where', type: 'choice', caption: 'Add Base Characters', values: ['nowhere', 'front', 'back', 'front and back'], initial: 'nowhere' },
    { name: 'what_base_characters', type: 'text', caption: 'Base Characters', initial: '' },
    { name: 'BaseCharactersThickness', type: 'number', caption: 'Base Char Thickness', initial: 1.0, step: 0.1 }
  ];
};

/**
 * Creates 3D geometry for a single letter, scaled to fit a target rectangle.
 */
function extrudeLetter(letter, targetW, targetH, thickness, minWidth, mode, width_of_space_character) {
  if (!letter || letter === ' ' || letter === '') {
    const w = (mode === 2) ? Math.max(1.2, minWidth) : targetW;
    return primitives.cuboid({ 
      size: [w, targetH, thickness], 
      center: [w / 2, targetH / 2, thickness / 2] 
    });
  }

  const shapes = text.vectorText({ height: 10, input: letter });
  if (!shapes || shapes.length === 0) return primitives.cuboid({ size: [targetW, targetH, 1] });

  const segments = shapes.map((points) => {
    const p2 = geometries.path2.fromPoints({ closed: false }, points);
    const expanded = expansions.expand({ delta: 1.5, corners: 'round', segments: 12 }, p2);
    return extrusions.extrudeLinear({ height: thickness }, expanded);
  });
  
  const letter3D = booleans.union(segments);
  const bounds = measurements.measureBoundingBox(letter3D);
  const letterW = bounds[1][0] - bounds[0][0];
  const letterH = bounds[1][1] - bounds[0][1];

  const scaleX = (letterW > 0) ? targetW / letterW : 1;
  const scaleY = (letterH > 0) ? targetH / letterH : 1;
  
  let res = transforms.translate([-bounds[0][0], -bounds[0][1], 0], letter3D);
  res = transforms.scale([scaleX, scaleY, 1], res);
  
  return res;
}

/**
 * Creates a single block which is an intersection of 2 or 3 letters.
 */
function tripleLetterBlock(letter1, letter2, letter3, blockSize, blockHeight, minWidth, mode, width_of_space_character) {
  const l1 = extrudeLetter(letter1, blockSize, blockHeight, blockSize, minWidth, mode, width_of_space_character);
  const l1XZ = transforms.rotateX(Math.PI / 2, l1);
  const rotatedL1 = transforms.translate([0, blockSize, 0], l1XZ);

  const l2 = extrudeLetter(letter2, blockSize, blockHeight, blockSize, minWidth, mode, width_of_space_character);
  const l2YZ = transforms.rotateZ(Math.PI / 2, transforms.rotateX(Math.PI / 2, l2));
  const rotatedL2 = l2YZ;

  let solids = [rotatedL1, rotatedL2];

  if (mode === 3) {
    const l3 = extrudeLetter(letter3, blockSize, blockSize, blockHeight, minWidth, mode, width_of_space_character);
    solids.push(l3);
  }

  const boundingCube = primitives.cuboid({ 
    size: [blockSize, blockSize, blockHeight], 
    center: [blockSize / 2, blockSize / 2, blockHeight / 2] 
  });
  
  return booleans.intersect(boundingCube, ...solids);
}

function main(params) {
  // Merge defaults with passed params
  const defaults = {
    mode: 2,
    String1: 'ASC',
    String2: 'DAS',
    String3: 'TRP',
    letterScaling: 1,
    additionalSpacing: 0,
    baseHeight: 3,
    Scl: 1,
    width_of_space_character: 'minimal'
  };
  const p = Object.assign({}, defaults, params);

  const mode = Number(p.mode);
  const s1 = (p.String1 || "").toUpperCase();
  const s2 = (p.String2 || "").toUpperCase();
  const s3 = (p.String3 || "").toUpperCase();
  const length = Math.max(s1.length, s2.length, s3.length);
  
  const letterWidth = 16.5;
  const letterHeight = 21.37;
  const blockSize = (mode === 2) ? letterWidth : 20;
  const blockHeight = (mode === 2) ? 21.37 : blockSize;
  const myScale = p.letterScaling * 20 / blockHeight;
  const minWidth = (mode === 3 || p.width_of_space_character === "minimal") ? 1.2 / myScale : blockSize;
  
  const blockWidth = Math.sqrt(2 * blockSize * blockSize);
  const padWidth = blockWidth * 1.1;
  const defaultSpacing = (mode === 2) ? 0.9 : 1.05;
  const blockSpace = blockWidth * (defaultSpacing + (p.additionalSpacing / 100));
  const adjustedPadHeight = p.baseHeight / myScale;

  const endX = (length - 1) * blockSpace;

  let blocks = [];
  for (let i = 0; i < length; i++) {
    const b = tripleLetterBlock(s1[i] || ' ', s2[i] || ' ', s3[i] || ' ', blockSize, blockHeight, minWidth, mode, p.width_of_space_character);
    const rotated = transforms.rotateZ(-Math.PI / 4, b);
    const moved = transforms.translate([i * blockSpace, 0, adjustedPadHeight - 0.2], rotated);
    blocks.push(moved);
  }
  
  const combinedBlocks = booleans.union(blocks);
  
  let baseHull = null;
  if (p.baseHeight > 0) {
    const baseC1 = primitives.cylinder({ height: adjustedPadHeight, radius: padWidth / 2, segments: 50, center: [0, 0, adjustedPadHeight / 2] });
    const baseC2 = primitives.cylinder({ height: adjustedPadHeight, radius: padWidth / 2, segments: 50, center: [endX, 0, adjustedPadHeight / 2] });
    baseHull = hulls.hull(baseC1, baseC2);
  }

  let finalComponents = [];
  const shiftedBlocks = transforms.translate([-endX / 2 - blockWidth / 2, 0, 0], combinedBlocks);
  finalComponents.push(colors.colorize([0.17, 0.56, 0.85], shiftedBlocks));
  
  if (baseHull) {
    const shiftedBase = transforms.translate([-endX / 2, 0, 0], baseHull);
    finalComponents.push(colors.colorize([0.2, 0.2, 0.2], shiftedBase));
  }
  
  return finalComponents.map(s => {
    let t = transforms.rotateZ(Math.PI / 2, s);
    t = transforms.scale([p.Scl, p.Scl, p.Scl], t);
    t = transforms.scale([myScale, myScale, myScale], t);
    return t;
  });
}

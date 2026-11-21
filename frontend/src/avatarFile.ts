// Quick checks of an uploaded avatar (.glb) before it is saved. They mirror what TalkingHead needs, so a wrong file
// gets a clear message here instead of a blank avatar later. Only the small JSON header of the file is read.

export const MAX_AVATAR_MB = 60;

// TalkingHead looks these bones up by name (a "mixamorig" prefix is ignored)
const FINGERS = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'];
const REQUIRED_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  ...['Left', 'Right'].flatMap((side) => [
    `${side}Shoulder`, `${side}Arm`, `${side}ForeArm`, `${side}Hand`,
    ...FINGERS.flatMap((finger) => [1, 2, 3].map((joint) => `${side}Hand${finger}${joint}`)),
    `${side}UpLeg`, `${side}Leg`, `${side}Foot`, `${side}ToeBase`
  ])
];

export interface AvatarCheck {
  /** Set when the file can't be used */
  error?: string;
  /** Usable, but something may not work as expected */
  warnings: string[];
}

interface GltfJson {
  asset?: { generator?: string };
  nodes?: Array<{ name?: string }>;
  meshes?: Array<{ extras?: { targetNames?: string[] }; primitives?: Array<{ targets?: unknown[]; extras?: { targetNames?: string[] } }> }>;
}

// The same name clean-up three.js and TalkingHead apply when they load the file
const boneName = (name: string) => name.replace(/\s/g, '_').replace(/[[\].:/]/g, '').split('mixamorig').join('');

export async function checkAvatarFile(file: File): Promise<AvatarCheck> {
  const fail = (error: string): AvatarCheck => ({ error, warnings: [] });

  if (file.size > MAX_AVATAR_MB * 1024 * 1024) {
    return fail(`The file is ${(file.size / 1024 / 1024).toFixed(0)} MB. The limit is ${MAX_AVATAR_MB} MB; compress the textures and geometry first.`);
  }

  const header = new DataView(await file.slice(0, 20).arrayBuffer());
  if (header.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67) return fail('This is not a .glb file (binary glTF).');
  if (header.getUint32(4, true) !== 2) return fail('Only glTF 2.0 files are supported.');
  const jsonLength = header.getUint32(12, true);
  if (header.getUint32(16, true) !== 0x4e4f534a || jsonLength > 20 * 1024 * 1024) return fail('The file is damaged: its model description is missing.');

  let gltf: GltfJson;
  try {
    gltf = JSON.parse(await file.slice(20, 20 + jsonLength).text());
  } catch {
    return fail('The file is damaged: its model description could not be read.');
  }

  const names = new Set((gltf.nodes ?? []).map((node) => boneName(node.name ?? '')));
  const missing = REQUIRED_BONES.filter((bone) => !names.has(bone));
  if (missing.length) {
    const shown = missing.slice(0, 4).join(', ');
    return fail(`The skeleton is not Mixamo-compatible. Missing bones: ${shown}${missing.length > 4 ? ` and ${missing.length - 4} more` : ''}.`);
  }

  const primitives = (gltf.meshes ?? []).flatMap((mesh) => (mesh.primitives ?? []).map((primitive) => ({ mesh, primitive })));
  if (!primitives.some(({ primitive }) => primitive.targets?.length)) {
    // Avaturn's Type 1 avatars have a fixed face with no blend shapes; its Type 2 avatars have an animatable one
    if (/avaturn/i.test(gltf.asset?.generator ?? '')) {
      return fail(
        "This Avaturn avatar has no face blend shapes, so its mouth cannot move to the voice. That is how Avaturn's Type 1 (T1, fixed face) avatars are built. Export a Type 2 (T2) avatar instead."
      );
    }
    return fail('The model has no blend shapes (morph targets), which Echo needs to animate the face.');
  }

  const shapes = new Set(primitives.flatMap(({ mesh, primitive }) => [...(primitive.extras?.targetNames ?? mesh.extras?.targetNames ?? [])]));
  const warnings: string[] = [];
  if (shapes.size && !shapes.has('viseme_aa') && !shapes.has('jawOpen')) {
    warnings.push('No lip-sync blend shapes (viseme_aa or jawOpen) were found, so the avatar will load but its mouth will not move with the voice.');
  }
  return { warnings };
}

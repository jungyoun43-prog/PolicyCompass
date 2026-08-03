# VitaGraph 3D body assets

## `body-atlas-3d-v2.glb`

This GLB is derived from the MakeHuman Community core `base.obj` asset. The
source file header and MakeHuman asset license explicitly release the asset
under **Creative Commons CC0 1.0 Universal**.

- Source repository: https://github.com/makehumancommunity/makehuman
- Exact source revision: `a8bc2d54ff0ac92e78ff71431b1023eda42bf482`
- Exact source file: https://github.com/makehumancommunity/makehuman/blob/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/3dobjs/base.obj
- Shaping target: https://github.com/makehumancommunity/makehuman/blob/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/makehuman/data/targets/macrodetails/universal-male-young-averagemuscle-minweight.target
- Repository asset license: https://github.com/makehumancommunity/makehuman/blob/a8bc2d54ff0ac92e78ff71431b1023eda42bf482/LICENSE.ASSETS.md
- CC0 1.0 legal code: https://creativecommons.org/publicdomain/zero/1.0/legalcode

Only the closed `g body` surface is included. The source's `helper-genital`,
`helper-tights`, `helper-skirt`, eyes, teeth, eyelashes, hair, tongue, joint
markers, and every other helper group are excluded from the GLB.

VitaGraph v2 modifications:

- extracted and remapped the core body surface into a single render mesh;
- applied the official CC0 shaping target above at `0.40` weight, then gently
  softened chest and hip contours to reduce secondary sex cues;
- applied one Catmull-Clark subdivision pass, increasing silhouette fidelity
  around the face, fingers, toes, joints, and torso;
- generated smooth area-weighted vertex normals;
- gently softened hip and pelvic proportions into a continuous, sex-neutral
  clinical-mannequin surface without a separate garment or modesty mesh;
- preserved `+Y` as up, oriented the front toward `+Z`, scaled the body to
  exactly 1.80 m, placed the feet at `y=0`, and aligned depth with VitaGraph's
  body-map hotspots;
- applied one opaque, texture-free matte clinical-teal PBR material;
- omitted textures, UVs, rigs, animations, external buffers, and external
  resources.

The v2 geometry modifications and conversion metadata are also made available
under CC0 1.0 Universal. The result is a generic visual navigation aid and is
not an anatomically diagnostic model.

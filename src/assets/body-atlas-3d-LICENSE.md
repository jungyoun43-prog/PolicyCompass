# PolicyCompass 3D body assets

## `body-atlas-3d-v4.glb`

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

PolicyCompass v3 base modifications:

- extracted and remapped the core body surface into a single render mesh;
- applied the official CC0 shaping target above at `0.40` weight, then gently
  softened chest and hip contours to reduce secondary sex cues;
- applied one Catmull-Clark subdivision pass, increasing silhouette fidelity
  around the face, fingers, toes, joints, and torso;
- generated smooth area-weighted vertex normals;
- gently softened hip and pelvic proportions into a continuous, sex-neutral
  clinical-mannequin surface without a separate garment or modesty mesh;
- preserved `+Y` as up, oriented the front toward `+Z`, scaled the body to
  exactly 1.80 m, placed the feet at `y=0`, and aligned depth with PolicyCompass's
  body-map hotspots;
- applied a neutral gray, texture-free translucent clinical shell material;
- added original procedural navigation meshes for the brain, left and right
  lungs, heart, liver, stomach, left and right kidneys, and intestines;
- placed each organ as a separately named mesh and material so the application
  can render the internal-organ layer in its anatomical context;
- omitted textures, UVs, rigs, animations, external buffers, and external
  resources.

PolicyCompass v4 additionally scales and translates each organ mesh within the
closed body shell so the navigation anatomy stays visually contained from
front, side, and rear views. Every transformed organ vertex is checked against
the shell during regression testing. The reproducible containment pass is in
`scripts/tune-body-atlas-3d.mjs`.

The v3 body modifications, v4 presentation tuning, original procedural organ meshes, and conversion
metadata are also made available under CC0 1.0 Universal. The organ shapes and
positions are simplified for health-map orientation; the result is a generic
visual navigation aid and is not an anatomically diagnostic, surgical, or
radiological model.

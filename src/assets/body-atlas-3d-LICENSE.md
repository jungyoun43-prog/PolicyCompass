# VitaGraph 3D body asset

## `body-atlas-3d-v1.glb`

This GLB is derived from the MakeHuman Community `male_generic.obj` proxy mesh.
The source file and the encompassing MakeHuman assets repository explicitly
release the asset under **Creative Commons CC0 1.0 Universal**.

- Source repository: https://github.com/makehumancommunity/makehuman-assets
- Exact source revision: `8cf9645b975a98eea056b140df11a1d278da0d10`
- Exact source file: https://github.com/makehumancommunity/makehuman-assets/blob/8cf9645b975a98eea056b140df11a1d278da0d10/base/proxymeshes/male_generic/male_generic.obj
- Repository license text: https://github.com/makehumancommunity/makehuman-assets/blob/8cf9645b975a98eea056b140df11a1d278da0d10/LICENSE.txt
- CC0 1.0 legal code: https://creativecommons.org/publicdomain/zero/1.0/legalcode

The source header identifies the copyright holders at the CC0 release as Data
Collection AB, Joel Palmius, and Jonas Hauquier. Attribution is not required by
CC0, but this notice is retained for provenance.

VitaGraph modifications:

- converted the OBJ geometry to binary glTF 2.0;
- oriented it to face `+Z`, preserved `+Y` as up, scaled it to exactly 1.80 m,
  and placed the feet at `y=0`;
- generated smooth vertex normals and applied texture-free matte clinical-teal
  PBR materials;
- added an original opaque `ClinicalModestyShorts` mesh;
- omitted texture coordinates, helper meshes, joints, rigs, animations, and
  external resources.

The original modesty mesh and VitaGraph conversion metadata in this file are
also made available under CC0 1.0 Universal. The result is a generic visual
navigation aid and is not an anatomically diagnostic model.

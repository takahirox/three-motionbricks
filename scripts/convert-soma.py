"""Convert the native SOMA-X template body to a skinned glTF 2.0 binary.

Run: uv run --with numpy --with usd-core python scripts/convert-soma.py INPUT OUTPUT
The original joint hierarchy, rest orientations, bind matrices and strongest four
skin influences are retained. Geometry and translations become meters, Y up.
"""
import argparse
import json
from pathlib import Path
import struct

import numpy as np
from pxr import Usd, UsdGeom, UsdSkel


def convert(source, destination):
    stage = Usd.Stage.Open(str(source))
    if UsdGeom.GetStageUpAxis(stage) != "Y":
        raise ValueError("Expected the native Y-up SOMA template")
    unit = UsdGeom.GetStageMetersPerUnit(stage)
    skeleton = next(UsdSkel.Skeleton(p) for p in stage.Traverse() if p.IsA(UsdSkel.Skeleton))
    mesh = next(UsdGeom.Mesh(p) for p in stage.Traverse() if p.GetName() == "c_skin_mid")
    binding = UsdSkel.BindingAPI(mesh.GetPrim())
    joints = list(skeleton.GetJointsAttr().Get())
    parents = list(UsdSkel.Topology(joints).GetParentIndices())
    rest = np.array(skeleton.GetRestTransformsAttr().Get(), dtype=np.float64)
    bind = np.array(skeleton.GetBindTransformsAttr().Get(), dtype=np.float64)
    rest[:, :3, 3] = 0
    rest[:, 3, 3] = 1
    bind[:, :3, 3] = 0
    bind[:, 3, 3] = 1
    rest[:, 3, :3] *= unit
    bind[:, 3, :3] *= unit
    points = np.array(mesh.GetPointsAttr().Get(), dtype=np.float32) * unit
    geom_bind = np.array(binding.GetGeomBindTransformAttr().Get())
    if not np.allclose(geom_bind, np.eye(4)):
        raise ValueError("Expected identity mesh bind transform")
    counts = mesh.GetFaceVertexCountsAttr().Get()
    face_indices = list(mesh.GetFaceVertexIndicesAttr().Get())
    triangles, cursor = [], 0
    for count in counts:
        face = face_indices[cursor:cursor + count]
        triangles.extend((face[0], face[i], face[i + 1]) for i in range(1, count - 1))
        cursor += count
    triangles = np.array(triangles, dtype=np.uint32)
    if mesh.GetOrientationAttr().Get() == "leftHanded":
        triangles = triangles[:, [0, 2, 1]]
    normals = np.zeros_like(points)
    a, b, c = (points[triangles[:, i]] for i in range(3))
    face_normals = np.cross(b - a, c - a)
    for i in range(3):
        np.add.at(normals, triangles[:, i], face_normals)
    normals /= np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-10)

    size = binding.GetJointIndicesPrimvar().GetElementSize()
    indices = np.array(binding.GetJointIndicesPrimvar().ComputeFlattened()).reshape(-1, size)
    weights = np.array(binding.GetJointWeightsPrimvar().ComputeFlattened()).reshape(-1, size)
    mesh_joints = binding.GetJointsAttr().Get()
    mapping = np.array([joints.index(j) for j in mesh_joints], dtype=np.uint16)
    strongest = np.argsort(-weights, axis=1, kind="stable")[:, :4]
    skin_indices = mapping[np.take_along_axis(indices, strongest, axis=1)]
    skin_weights = np.take_along_axis(weights, strongest, axis=1).astype(np.float32)
    discarded = float(np.max(1 - skin_weights.sum(axis=1)))
    skin_weights /= skin_weights.sum(axis=1, keepdims=True)
    skin_indices[skin_weights == 0] = 0
    assert len(points) == len(skin_indices) and np.isfinite(skin_weights).all()

    blob = bytearray()
    views, accessors = [], []

    def accessor(array, component, kind, bounds=False, target=None):
        while len(blob) % 4:
            blob.append(0)
        array = np.ascontiguousarray(array)
        view = len(views)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": array.nbytes})
        if target is not None:
            views[-1]["target"] = target
        blob.extend(array.tobytes())
        entry = {"bufferView": view, "componentType": component, "count": len(array), "type": kind}
        if bounds:
            entry.update(min=array.min(axis=0).tolist(), max=array.max(axis=0).tolist())
        accessors.append(entry)
        return len(accessors) - 1

    position = accessor(points.astype('<f4'), 5126, "VEC3", True, target=34962)
    normal = accessor(normals.astype('<f4'), 5126, "VEC3", target=34962)
    joint_accessor = accessor(skin_indices.astype('<u2'), 5123, "VEC4", target=34962)
    weight_accessor = accessor(skin_weights.astype('<f4'), 5126, "VEC4", target=34962)
    index_accessor = accessor(triangles.flatten().astype('<u4'), 5125, "SCALAR", target=34963)
    inverse = np.linalg.inv(bind)
    inverse[:, :3, 3] = 0
    inverse[:, 3, 3] = 1
    inverse_bind = accessor(inverse.reshape(-1, 16).astype('<f4'), 5126, "MAT4")
    nodes = [{"name": name.split('/')[-1], "matrix": matrix.flatten().tolist()}
             for name, matrix in zip(joints, rest)]
    for node, matrix in zip(nodes, rest):
        if np.array_equal(matrix, np.eye(4)):
            del node["matrix"]
    for i, parent in enumerate(parents):
        if parent >= 0:
            nodes[parent].setdefault("children", []).append(i)
    nodes.append({"name": "SOMA native body", "mesh": 0, "skin": 0})
    document = {
        "asset": {"version": "2.0", "generator": "three-motionbricks native SOMA converter",
                  "copyright": "NVIDIA CORPORATION & AFFILIATES; Apache-2.0; see docs/assets.md"},
        "scene": 0, "scenes": [{"nodes": [0, len(joints)]}], "nodes": nodes,
        "skins": [{"joints": list(range(len(joints))), "skeleton": 0, "inverseBindMatrices": inverse_bind}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": position, "NORMAL": normal,
                     "JOINTS_0": joint_accessor, "WEIGHTS_0": weight_accessor},
                     "indices": index_accessor, "material": 0}]}],
        "materials": [{"name": "Clay", "pbrMetallicRoughness": {
            "baseColorFactor": [0.25, 0.62, 0.57, 1], "metallicFactor": 0, "roughnessFactor": 0.85}}],
        "buffers": [{"byteLength": len(blob)}], "bufferViews": views, "accessors": accessors,
    }
    encoded = json.dumps(document, separators=(',', ':')).encode()
    encoded += b' ' * (-len(encoded) % 4)
    blob += b'\0' * (-len(blob) % 4)
    glb = struct.pack('<III', 0x46546C67, 2, 28 + len(encoded) + len(blob))
    glb += struct.pack('<II', len(encoded), 0x4E4F534A) + encoded
    glb += struct.pack('<II', len(blob), 0x004E4942) + blob
    Path(destination).write_bytes(glb)
    print(json.dumps({"vertices": len(points), "triangles": len(triangles), "joints": len(joints),
                      "bytes": len(glb), "maximumDiscardedSkinWeight": discarded}, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    convert(args.input, args.output)

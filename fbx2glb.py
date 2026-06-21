"""
fbx2glb.py  —  Blender Python: FBX → GLB（仅动画，无多余数据）
用法：blender --background --python fbx2glb.py -- <input.fbx> <output.glb>
"""
import bpy, sys, os

argv = sys.argv
sep  = argv.index('--') + 1
src  = argv[sep]
dst  = argv[sep + 1]

# 空场景
bpy.ops.wm.read_factory_settings(use_empty=True)

# 导入 FBX
bpy.ops.import_scene.fbx(filepath=src, automatic_bone_orientation=True)

# 导出 GLB（只含动画+骨架，不含相机/灯光）
bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    export_animations=True,
    export_skins=True,
    export_cameras=False,
    export_lights=False,
    export_apply=False,
)
print('Done:', dst)

# SolidWorks 装配体资源

`assets/assembly_0001.glb` 来自 SolidWorks 导出的“爆炸视图_GLTF格式”资源包。

导入时完成了以下处理：

- 将多文件 `.gltf + .bin + 纹理` 合并为单个 GLB；
- 保留动画片段 `爆炸视图1`（4 秒、58 个位移动画节点）；
- 删除 XR-FRAME 不支持的 DDS 法线贴图引用和 SolidWorks 查看器私有元数据；
- 保留节点名称并对网格进行移动端简化与量化；
- 资源放在独立分包中，避免占用主包容量。

可复现的预处理命令：

```powershell
node tools/prepare_solidworks_gltf.js <源gltf> <同目录预处理gltf>
npx -y gltfpack@1.2.0 -i <预处理gltf> -o assembly_0001.glb -cc -tc -kn -si 0.35
node tools/dataset-manager/glb-animation-inspector.js assembly_0001.glb
```

“拆卸”正向播放原始轨道，“安装”倒向播放同一轨道。“分层”只是停在动画中段，
不是 SolidWorks 剖切动画。

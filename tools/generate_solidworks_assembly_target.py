"""Generate a deterministic AR target sheet from an animated SolidWorks GLB.

The output is a recognition candidate, not a manufacturing drawing: it contains
orthographic projections of the real GLB geometry but intentionally invents no
dimensions or tolerances.
"""

from __future__ import annotations

import argparse
import json
import math
import struct
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


COMPONENT_DTYPES = {
    5120: np.int8,
    5121: np.uint8,
    5122: np.int16,
    5123: np.uint16,
    5125: np.uint32,
    5126: np.float32,
}
TYPE_COMPONENTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT4": 16,
}


def load_glb(path: Path):
    data = path.read_bytes()
    if data[:4] != b"glTF" or struct.unpack_from("<I", data, 4)[0] != 2:
        raise ValueError("仅支持 glTF 2.0 GLB")
    offset = 12
    document = None
    binary = b""
    while offset + 8 <= len(data):
        length, chunk_type = struct.unpack_from("<II", data, offset)
        payload = data[offset + 8 : offset + 8 + length]
        if chunk_type == 0x4E4F534A:
            document = json.loads(payload.rstrip(b"\x00 \t\r\n").decode("utf-8"))
        elif chunk_type == 0x004E4942:
            binary = payload
        offset += 8 + length
    if document is None or not binary:
        raise ValueError("GLB 缺少 JSON 或 BIN 数据块")
    return document, binary


def read_accessor(document, binary, accessor_index):
    accessor = document["accessors"][accessor_index]
    view = document["bufferViews"][accessor["bufferView"]]
    dtype = np.dtype(COMPONENT_DTYPES[accessor["componentType"]]).newbyteorder("<")
    components = TYPE_COMPONENTS[accessor["type"]]
    count = accessor["count"]
    item_bytes = dtype.itemsize * components
    stride = view.get("byteStride", item_bytes)
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    if stride == item_bytes:
        values = np.frombuffer(binary, dtype=dtype, count=count * components, offset=start)
        values = values.reshape(count, components)
    else:
        values = np.ndarray(
            (count, components),
            dtype=dtype,
            buffer=binary,
            offset=start,
            strides=(stride, dtype.itemsize),
        )
    values = values.astype(np.float64, copy=True)
    if accessor.get("normalized"):
        info = np.iinfo(dtype)
        if info.min < 0:
            values = np.maximum(values / info.max, -1.0)
        else:
            values /= info.max
    return values[:, 0] if components == 1 else values


def quaternion_matrix(quaternion):
    x, y, z, w = quaternion
    length = math.sqrt(x * x + y * y + z * z + w * w) or 1.0
    x, y, z, w = x / length, y / length, z / length, w / length
    return np.array(
        [
            [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0],
            [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0],
            [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0],
            [0, 0, 0, 1],
        ],
        dtype=np.float64,
    )


def node_matrix(node):
    if "matrix" in node:
        return np.asarray(node["matrix"], dtype=np.float64).reshape(4, 4, order="F")
    translation = np.asarray(node.get("translation", [0, 0, 0]), dtype=np.float64)
    scale = np.asarray(node.get("scale", [1, 1, 1]), dtype=np.float64)
    matrix = quaternion_matrix(node.get("rotation", [0, 0, 0, 1]))
    matrix[:3, :3] = matrix[:3, :3] @ np.diag(scale)
    matrix[:3, 3] = translation
    return matrix


def collect_geometry(document, binary):
    triangles = []
    part_ids = []
    part_names = []
    mesh_cache = {}

    def mesh_triangles(mesh_index):
        if mesh_index in mesh_cache:
            return mesh_cache[mesh_index]
        result = []
        for primitive in document["meshes"][mesh_index].get("primitives", []):
            if primitive.get("mode", 4) != 4 or "POSITION" not in primitive.get("attributes", {}):
                continue
            positions = read_accessor(document, binary, primitive["attributes"]["POSITION"])
            if "indices" in primitive:
                indices = read_accessor(document, binary, primitive["indices"]).astype(np.int64)
            else:
                indices = np.arange(len(positions), dtype=np.int64)
            result.append(positions[indices[: len(indices) // 3 * 3]].reshape(-1, 3, 3))
        mesh_cache[mesh_index] = result
        return result

    scene_index = document.get("scene", 0)
    roots = document["scenes"][scene_index].get("nodes", [])

    def visit(node_index, parent_matrix, inherited_name=""):
        node = document["nodes"][node_index]
        world = parent_matrix @ node_matrix(node)
        name = node.get("name") or inherited_name
        if "mesh" in node:
            current_part = len(part_names)
            part_names.append(name or f"零件 {current_part + 1}")
            for local_triangles in mesh_triangles(node["mesh"]):
                points = local_triangles.reshape(-1, 3)
                homogeneous = np.column_stack((points, np.ones(len(points))))
                transformed = (world @ homogeneous.T).T[:, :3].reshape(-1, 3, 3)
                triangles.append(transformed)
                part_ids.append(np.full(len(transformed), current_part, dtype=np.int16))
        for child in node.get("children", []):
            visit(child, world, name)

    identity = np.eye(4, dtype=np.float64)
    for root in roots:
        visit(root, identity)
    if not triangles:
        raise ValueError("GLB 中没有可绘制的三角网格")
    return np.concatenate(triangles), np.concatenate(part_ids), part_names


def get_font(size, bold=False):
    candidates = [
        Path("C:/Windows/Fonts/msyhbd.ttc" if bold else "C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    ]
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size=size)
    return ImageFont.load_default()


def render_view(triangles, part_ids, size, basis, color_mode="technical"):
    width, height = size
    projected = triangles @ np.asarray(basis, dtype=np.float64).T
    xy = projected[:, :, :2]
    low = xy.reshape(-1, 2).min(axis=0)
    high = xy.reshape(-1, 2).max(axis=0)
    span = np.maximum(high - low, 1e-9)
    scale = min((width - 26) / span[0], (height - 26) / span[1])
    center = (low + high) * 0.5
    points = (xy - center) * scale
    points[:, :, 0] += width * 0.5
    points[:, :, 1] = height * 0.5 - points[:, :, 1]
    depth = projected[:, :, 2].mean(axis=1)
    order = np.argsort(depth)

    image = Image.new("RGB", size, "white")
    draw = ImageDraw.Draw(image)
    id_image = Image.new("L", size, 0)
    id_draw = ImageDraw.Draw(id_image)
    light = np.array([0.35, 0.45, 0.82], dtype=np.float64)
    light /= np.linalg.norm(light)
    normals = np.cross(
        triangles[:, 1] - triangles[:, 0], triangles[:, 2] - triangles[:, 0]
    )
    normal_lengths = np.linalg.norm(normals, axis=1)
    normals /= np.maximum(normal_lengths[:, None], 1e-12)

    for index in order:
        polygon = [tuple(value) for value in points[index]]
        area = abs(
            (polygon[1][0] - polygon[0][0]) * (polygon[2][1] - polygon[0][1])
            - (polygon[1][1] - polygon[0][1]) * (polygon[2][0] - polygon[0][0])
        )
        if area < 0.035:
            continue
        shade = 0.62 + 0.30 * abs(float(normals[index] @ light))
        if color_mode == "iso":
            palette = ((110, 170, 205), (130, 193, 174), (228, 166, 83), (146, 155, 205))
            base = palette[int(part_ids[index]) % len(palette)]
            fill = tuple(max(0, min(255, int(channel * shade))) for channel in base)
        else:
            base = (218, 230, 238)
            fill = tuple(int(channel * shade) for channel in base)
        draw.polygon(polygon, fill=fill)
        id_draw.polygon(polygon, fill=int(part_ids[index] % 253) + 2)

    ids = np.asarray(id_image)
    edges = np.zeros_like(ids, dtype=bool)
    edges[1:, :] |= ids[1:, :] != ids[:-1, :]
    edges[:, 1:] |= ids[:, 1:] != ids[:, :-1]
    edges &= ids != 0
    edge_image = Image.fromarray((edges * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3))
    image.paste((18, 32, 44), mask=edge_image)
    border = Image.new("L", size, 0)
    mask = id_image.point(lambda value: 255 if value else 0)
    expanded = mask.filter(ImageFilter.MaxFilter(5))
    contracted = mask.filter(ImageFilter.MinFilter(5))
    border_array = np.maximum(
        np.asarray(expanded, dtype=np.int16) - np.asarray(contracted, dtype=np.int16), 0
    ).astype(np.uint8)
    border = Image.fromarray(border_array)
    image.paste((4, 12, 20), mask=border)
    return image


def draw_labeled_view(canvas, view, box, label, fonts):
    left, top, right, bottom = box
    canvas.paste(view.resize((right - left, bottom - top), Image.Resampling.LANCZOS), (left, top))
    draw = ImageDraw.Draw(canvas)
    draw.rectangle(box, outline=(36, 55, 70), width=3)
    label_width = draw.textbbox((0, 0), label, font=fonts["small_bold"])[2]
    draw.rectangle((left + 14, top + 12, left + 34 + label_width, top + 52), fill=(10, 36, 54))
    draw.text((left + 24, top + 17), label, font=fonts["small_bold"], fill="white")


def build_sheet(triangles, part_ids, part_names, output):
    canvas = Image.new("RGB", (2200, 1600), (248, 250, 252))
    draw = ImageDraw.Draw(canvas)
    fonts = {
        "title": get_font(54, True),
        "subtitle": get_font(26),
        "view": get_font(25, True),
        "small": get_font(21),
        "small_bold": get_font(22, True),
        "tiny": get_font(18),
    }
    draw.rectangle((26, 26, 2174, 1574), outline=(8, 22, 34), width=6)
    draw.rectangle((48, 48, 2152, 158), fill=(7, 27, 43))
    draw.text((84, 70), "减速器总成 · 装配工程图", font=fonts["title"], fill="white")
    draw.text((1515, 78), "ASSEMBLY_0001", font=fonts["subtitle"], fill=(79, 215, 238))
    draw.text((1515, 114), "SOLIDWORKS GLB GEOMETRY", font=fonts["tiny"], fill=(185, 211, 225))

    front = render_view(triangles, part_ids, (1020, 600), ((1, 0, 0), (0, 1, 0), (0, 0, 1)))
    top = render_view(triangles, part_ids, (700, 445), ((1, 0, 0), (0, 0, 1), (0, 1, 0)))
    side = render_view(triangles, part_ids, (700, 445), ((0, 0, 1), (0, 1, 0), (1, 0, 0)))
    iso = render_view(
        triangles,
        part_ids,
        (1020, 560),
        ((0.707, 0, -0.707), (-0.408, 0.816, -0.408), (0.577, 0.577, 0.577)),
        "iso",
    )
    draw_labeled_view(canvas, front, (70, 190, 1090, 790), "正视图", fonts)
    draw_labeled_view(canvas, top, (1120, 190, 1820, 635), "俯视图", fonts)
    draw_labeled_view(canvas, side, (1120, 665, 1820, 1110), "右视图", fonts)
    draw_labeled_view(canvas, iso, (70, 820, 1090, 1380), "等轴测图", fonts)

    table_left, table_top, table_right, row_height = 1845, 190, 2128, 48
    draw.rectangle((table_left, table_top, table_right, 1380), fill="white", outline=(25, 43, 56), width=3)
    draw.rectangle((table_left, table_top, table_right, table_top + 58), fill=(19, 58, 78))
    draw.text((table_left + 18, table_top + 13), "主要零部件", font=fonts["small_bold"], fill="white")
    names = []
    for name in part_names:
        cleaned = name.split("-")[0].strip()
        if cleaned and cleaned not in names:
            names.append(cleaned)
        if len(names) >= 20:
            break
    for index, name in enumerate(names):
        y = table_top + 58 + index * row_height
        draw.line((table_left, y, table_right, y), fill=(142, 160, 171), width=2)
        draw.text((table_left + 12, y + 9), f"{index + 1:02d}", font=fonts["tiny"], fill=(17, 83, 112))
        short_name = name[3:].strip() if len(name) > 3 and name[:2].strip().isdigit() else name
        draw.text((table_left + 58, y + 9), short_name[:11], font=fonts["tiny"], fill=(24, 35, 43))

    title_top = 1412
    draw.rectangle((70, title_top, 2128, 1535), fill="white", outline=(14, 32, 45), width=3)
    columns = (70, 1110, 1480, 1810, 2128)
    for x in columns[1:-1]:
        draw.line((x, title_top, x, 1535), fill=(14, 32, 45), width=2)
    draw.text((92, title_top + 15), "识别目标：完整装配图请全部进入取景框", font=fonts["view"], fill=(12, 37, 54))
    draw.text((92, title_top + 64), "依据真实 GLB 几何生成 · 不含虚构尺寸 · 无四角定位码", font=fonts["small"], fill=(71, 91, 104))
    draw.text((1130, title_top + 17), "动画", font=fonts["tiny"], fill=(76, 91, 102))
    draw.text((1130, title_top + 54), "爆炸视图1 / 4s", font=fonts["small_bold"], fill=(16, 53, 72))
    draw.text((1500, title_top + 17), "动画节点", font=fonts["tiny"], fill=(76, 91, 102))
    draw.text((1500, title_top + 54), "58", font=fonts["title"], fill=(20, 112, 143))
    draw.text((1830, title_top + 17), "图号", font=fonts["tiny"], fill=(76, 91, 102))
    draw.text((1830, title_top + 54), "ASM-0001", font=fonts["small_bold"], fill=(16, 53, 72))

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, optimize=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("glb", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    document, binary = load_glb(args.glb)
    triangles, part_ids, part_names = collect_geometry(document, binary)
    build_sheet(triangles, part_ids, part_names, args.output)
    print(
        json.dumps(
            {
                "output": str(args.output.resolve()),
                "triangles": int(len(triangles)),
                "parts": int(len(part_names)),
                "width": 2200,
                "height": 1600,
            },
            ensure_ascii=False,
        )
    )


if __name__ == "__main__":
    main()

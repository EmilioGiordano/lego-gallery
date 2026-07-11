"""Prepare the downloaded Mecabricks 75192 scene for the browser renderer."""

from __future__ import annotations

import json
import math
import re
import zipfile
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "assets" / "falcon-mecabricks"
SOURCE_ZIP = ROOT / "assets" / "falcon-mecabricks.zip"
OUTPUT = ROOT / "assets" / "falcon"
OUTPUT_SCENE = OUTPUT / "scene.json"
OUTPUT_GEOMETRIES = OUTPUT / "geometries.zip"

IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def matrix_multiply(a: list[float], b: list[float]) -> list[float]:
    """Multiply two column-major 4x4 matrices."""
    return [
        sum(a[k * 4 + row] * b[column * 4 + k] for k in range(4))
        for column in range(4)
        for row in range(4)
    ]


def flatten_materials(payload: dict) -> dict[int, dict]:
    result: dict[int, dict] = {}
    for category in payload["data"]:
        kind = category.get("name", "solid")
        for material in category.get("materials", []):
            reference = int(material["reference"])
            rgb = material.get("rgb", "A3A2A4").lstrip("#")
            if len(rgb) != 6:
                rgb = "A3A2A4"
            result[reference] = {
                "hex": f"#{rgb.upper()}",
                "name": material.get("name", str(reference)),
                "kind": kind,
                "transparent": "trans" in kind.lower(),
            }
    return result


def normalized_color(value) -> tuple[int, ...]:
    if isinstance(value, list):
        return tuple(int(item) for item in value)
    if value is None:
        return (194,)
    return (int(value),)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)

    with (SOURCE / "model.json").open(encoding="utf-8") as file:
        payload = json.load(file)["data"]
    with (SOURCE / "materials.json").open(encoding="utf-8") as file:
        materials = flatten_materials(json.load(file))

    objects = payload["file"]["objects"]["list"]
    library = payload["library"]["official"]
    with zipfile.ZipFile(SOURCE_ZIP) as source_zip:
        available_files = set(source_zip.namelist())
    world_cache: dict[int, list[float]] = {}

    def world_matrix(index: int) -> list[float]:
        if index in world_cache:
            return world_cache[index]
        item = objects[index]
        local = item.get("6", IDENTITY)
        parent = item.get("4")
        world = (
            matrix_multiply(world_matrix(int(parent)), local)
            if parent is not None
            else list(local)
        )
        world_cache[index] = world
        return world

    def bag_number(index: int) -> int:
        current = objects[index].get("4")
        while current is not None:
            parent = objects[int(current)]
            name = parent.get("2", "")
            match = re.match(r"Bag\s+(\d+)", name, re.IGNORECASE)
            if match:
                return int(match.group(1))
            current = parent.get("4")
        return 0

    geometry_paths: dict[str, int] = {}
    geometry_sources: list[str] = []
    grouped: dict[tuple[int, tuple[int, ...]], list[dict]] = defaultdict(list)
    all_positions: list[tuple[float, float, float]] = []

    for index, item in enumerate(objects):
        if item.get("1") != "part":
            continue
        library_item = library[str(item["5"])]
        extra = library_item["extra"]
        geometry_name = extra.get("configuration") or Path(extra["mesh"]).stem
        source_path = f"geometries/{extra['version']}/{geometry_name}.json"
        if source_path not in available_files:
            fallback_name = re.sub(r"v\d+$", "", geometry_name)
            fallback_path = f"geometries/{extra['version']}/{fallback_name}.json"
            if fallback_path in available_files:
                source_path = fallback_path
            elif extra.get("type") == "flexible":
                length_match = re.search(r"(\d+)\s*mm", library_item["name"], re.IGNORECASE)
                module_match = re.search(r"(\d+)M", library_item["name"], re.IGNORECASE)
                length = (
                    float(length_match.group(1))
                    if length_match
                    else float(module_match.group(1)) * 8
                    if module_match
                    else 80.0
                )
                source_path = f"__flex__/{length:g}"
            else:
                raise FileNotFoundError(f"Missing geometry: {source_path}")
        if source_path not in geometry_paths:
            geometry_paths[source_path] = len(geometry_sources)
            geometry_sources.append(source_path)

        geometry_id = geometry_paths[source_path]
        colors = normalized_color(item.get("8"))
        matrix = world_matrix(index)
        position = (matrix[12], matrix[13], matrix[14])
        # The Mecabricks scene displays minifigures and accessories in a row
        # beside the ship. They are not part of the Falcon's final silhouette.
        if position[0] > 300:
            continue
        all_positions.append(position)
        grouped[(geometry_id, colors)].append(
            {
                "m": [round(float(value), 5) for value in matrix],
                "b": bag_number(index),
            }
        )

    minimum = [min(point[axis] for point in all_positions) for axis in range(3)]
    maximum = [max(point[axis] for point in all_positions) for axis in range(3)]
    center = [(minimum[axis] + maximum[axis]) / 2 for axis in range(3)]
    size = [maximum[axis] - minimum[axis] for axis in range(3)]

    used_materials = sorted(
        {
            reference
            for (_, colors) in grouped
            for reference in colors
        }
    )
    color_payload = {
        str(reference): materials.get(
            reference,
            {
                "hex": "#A3A2A4",
                "name": f"Material {reference}",
                "kind": "solid",
                "transparent": False,
            },
        )
        for reference in used_materials
    }

    groups = []
    for (geometry_id, colors), instances in grouped.items():
        groups.append(
            {
                "g": geometry_id,
                "c": list(colors),
                "i": instances,
            }
        )

    scene = {
        "metadata": {
            "name": "LEGO 75192 Millennium Falcon",
            "source": "https://mecabricks.com/en/models/87X2RWRqjZY",
            "parts": sum(len(group["i"]) for group in groups),
            "uniqueGeometries": len(geometry_sources),
            "groups": len(groups),
        },
        "bounds": {
            "min": [round(value, 4) for value in minimum],
            "max": [round(value, 4) for value in maximum],
            "center": [round(value, 4) for value in center],
            "size": [round(value, 4) for value in size],
        },
        "materials": color_payload,
        "geometries": [
            {"flex": float(source_path.split("/")[1])}
            if source_path.startswith("__flex__/")
            else {"path": f"g/{index}.json"}
            for index, source_path in enumerate(geometry_sources)
        ],
        "groups": groups,
    }

    with OUTPUT_SCENE.open("w", encoding="utf-8") as file:
        json.dump(scene, file, separators=(",", ":"))

    with zipfile.ZipFile(SOURCE_ZIP) as source_zip:
        missing = [
            path
            for path in geometry_sources
            if not path.startswith("__flex__/") and path not in available_files
        ]
        if missing:
            raise FileNotFoundError(f"Missing {len(missing)} geometries: {missing[:5]}")

        with zipfile.ZipFile(
            OUTPUT_GEOMETRIES,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        ) as output_zip:
            for index, source_path in enumerate(geometry_sources):
                if not source_path.startswith("__flex__/"):
                    output_zip.writestr(f"g/{index}.json", source_zip.read(source_path))

    bag_counts = Counter(
        instance["b"]
        for group in groups
        for instance in group["i"]
    )
    print(f"Prepared {scene['metadata']['parts']:,} pieces")
    print(f"Unique geometries: {len(geometry_sources):,}")
    print(f"Instance groups: {len(groups):,}")
    print(f"Bounds: {scene['bounds']['size']}")
    print(f"Bag counts: {dict(sorted(bag_counts.items()))}")
    print(f"Scene: {OUTPUT_SCENE.stat().st_size / 1024 / 1024:.2f} MB")
    print(f"Geometry archive: {OUTPUT_GEOMETRIES.stat().st_size / 1024 / 1024:.2f} MB")


if __name__ == "__main__":
    main()

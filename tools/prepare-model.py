"""Convert a Mecabricks scene into the compact runtime format used by the app."""

from __future__ import annotations

import argparse
import json
import re
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


@dataclass(frozen=True)
class ColorRules:
    remap: dict[int, int]
    black_keep_designs: frozenset[str] | None = None


@dataclass(frozen=True)
class SetProfile:
    model: Path
    materials: Path
    geometries: Path
    output: Path
    name: str
    source_url: str
    flexible_parts: dict[int, str] | None = None
    remove_falcon_displays: bool = False
    color_rules: ColorRules | None = None
    custom_materials: dict[int, dict[str, Any]] | None = None


PEARL_TITANIUM = 9001
LIGHT_BLUISH_GRAY = 9002

BATMOBILE_CUSTOM_MATERIALS = {
    PEARL_TITANIUM: {
        "hex": "#AEAFAF",
        "name": "Pearl Titanium",
        "kind": "pearlescent",
        "transparent": False,
    },
    LIGHT_BLUISH_GRAY: {
        "hex": "#B5B6B6",
        "name": "Light Bluish Gray",
        "kind": "solid",
        "transparent": False,
    },
}

# Black elements from manual pages 98–99 and ToyPro inventory.
BATMOBILE_BLACK_DESIGNS = frozenset(
    {
        "28964",  # platform base
        "95199",  # side guns
        "55981",  # rim
        "55982",  # rim
        "92402",  # tyre
        "56891",  # tyre
        "50231",  # cape
        "32018",  # technic 1x14
        "32316",  # technic 5M beam
        "3032",  # plate 4x6
        "3666",  # plate 1x6
        "11212",  # plate 3x3
        "4697",  # T-piece
        "93095",  # foot plate
        "19952",  # hinge base
        "19953",  # hinge top
        "11476",  # snap plate
        "99206",  # 2x2x2/3 knob plate
        "3673",  # connector peg
        "15712",  # rear light holder
        "2187",  # rear light holder variant
        "42446",  # rear light clip plate
        "95344",  # handle
        "393726",  # hinge brick base
        "6147050",  # slope inverted
        "6416444",  # hinge complete
        "6469445",  # modified 2x2 plate
        "6053077",  # curved slope
        "6104209",  # T-bar
        "6279875",  # technic pin
        "6170808",  # neck bracket
        "4142135",  # liftarm 1x5
        "4107558",  # brick 1x14 holes
        "28802",  # bracket 5x2 (6171066)
    }
)


PROFILES = {
    "millennium-falcon": SetProfile(
        model=ROOT / "assets" / "falcon-mecabricks" / "model.json",
        materials=ROOT / "assets" / "falcon-mecabricks" / "materials.json",
        geometries=ROOT / "assets" / "falcon-mecabricks.zip",
        output=ROOT / "assets" / "sets" / "millennium-falcon",
        name="LEGO 75192 Millennium Falcon",
        source_url="https://mecabricks.com/en/models/87X2RWRqjZY",
        flexible_parts={2007: "hose", 15085: "lattice"},
        remove_falcon_displays=True,
    ),
    "batmobile": SetProfile(
        model=ROOT / "model-sources" / "batmobile" / "model-response.json",
        materials=ROOT / "model-sources" / "batmobile" / "materials.json",
        geometries=ROOT / "model-sources" / "batmobile" / "geometries.zip",
        output=ROOT / "assets" / "sets" / "batmobile",
        name="LEGO 76331 Batman v Superman Batmobile",
        source_url="https://www.mecabricks.com/en/models/79a8M0nw28w",
        color_rules=ColorRules(
            remap={
                199: PEARL_TITANIUM,
                315: PEARL_TITANIUM,
                194: LIGHT_BLUISH_GRAY,
            },
            black_keep_designs=BATMOBILE_BLACK_DESIGNS,
        ),
        custom_materials=BATMOBILE_CUSTOM_MATERIALS,
    ),
}


def matrix_multiply(a: list[float], b: list[float]) -> list[float]:
    """Multiply two column-major 4x4 matrices."""
    return [
        sum(a[k * 4 + row] * b[column * 4 + k] for k in range(4))
        for column in range(4)
        for row in range(4)
    ]


def flatten_materials(payload: dict[str, Any]) -> dict[int, dict[str, Any]]:
    result: dict[int, dict[str, Any]] = {}
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


def normalized_color(value: Any) -> tuple[int, ...]:
    if isinstance(value, list):
        return tuple(int(item) for item in value)
    if value is None:
        return (194,)
    return (int(value),)


def apply_color_rules(
    rules: ColorRules | None,
    design_ref: str,
    colors: tuple[int, ...],
) -> tuple[int, ...]:
    if not rules:
        return colors
    remapped: list[int] = []
    for color in colors:
        if (
            color == 26
            and rules.black_keep_designs is not None
            and design_ref not in rules.black_keep_designs
        ):
            remapped.append(rules.remap.get(199, PEARL_TITANIUM))
        elif color in rules.remap:
            remapped.append(rules.remap[color])
        else:
            remapped.append(color)
    return tuple(remapped)


def part_design_reference(extra: dict[str, Any]) -> str:
    return str(
        extra.get("reference")
        or extra.get("configuration")
        or Path(extra.get("mesh", "unknown.json")).stem
    )


def load_payload(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as file:
        payload = json.load(file)
    data = payload.get("data", payload)
    if not {"file", "library"}.issubset(data):
        raise ValueError(f"{path} is not a supported Mecabricks scene")
    return data


def property_keys(payload: dict[str, Any]) -> dict[str, str]:
    keys = payload["file"]["objects"].get("keys", [])
    return {name: str(index) for index, name in enumerate(keys)}


def should_include_part(profile: SetProfile, position: tuple[float, float, float]) -> bool:
    if not profile.remove_falcon_displays:
        return True
    if position[0] > 300:
        return False
    if position[0] > 290 and position[1] < 20 and position[2] < -300:
        return False
    if position[0] > 230 and position[1] < 35 and position[2] > 280:
        return False
    return True


def prepare(profile: SetProfile) -> None:
    profile.output.mkdir(parents=True, exist_ok=True)
    output_scene = profile.output / "scene.json"
    output_geometries = profile.output / "geometries.zip"

    payload = load_payload(profile.model)
    with profile.materials.open(encoding="utf-8") as file:
        materials = flatten_materials(json.load(file))

    object_data = payload["file"]["objects"]
    objects = [
        {str(index): value for index, value in enumerate(item)}
        if isinstance(item, list)
        else item
        for item in object_data["list"]
    ]
    keys = property_keys(payload)
    library = payload["library"]["official"]
    with zipfile.ZipFile(profile.geometries) as source_zip:
        available_files = set(source_zip.namelist())
        configuration_geometries = {}
        for name in available_files:
            if not name.startswith("configurations/2/") or name.endswith("/"):
                continue
            configuration = json.loads(source_zip.read(name))
            geometry_file = configuration.get("geometry", {}).get("file")
            if geometry_file:
                configuration_geometries[name] = geometry_file

    type_key = keys["type"]
    name_key = keys["name"]
    parent_key = keys["parent"]
    id_key = keys["id"]
    matrix_key = keys["matrix"]
    color_key = keys["color"]
    values_key = keys.get("values")
    deformation_key = keys.get("v:1")
    world_cache: dict[int, list[float]] = {}

    def world_matrix(index: int) -> list[float]:
        if index in world_cache:
            return world_cache[index]
        item = objects[index]
        local = item.get(matrix_key, IDENTITY)
        parent = item.get(parent_key)
        world = (
            matrix_multiply(world_matrix(int(parent)), local)
            if parent is not None
            else list(local)
        )
        world_cache[index] = world
        return world

    def bag_number(index: int) -> int:
        current = objects[index].get(parent_key)
        while current is not None:
            parent = objects[int(current)]
            match = re.match(r"Bag\s+(\d+)", parent.get(name_key, ""), re.IGNORECASE)
            if match:
                return int(match.group(1))
            current = parent.get(parent_key)
        return 0

    geometry_paths: dict[str, int] = {}
    geometry_sources: list[str] = []
    flexible_descriptors: dict[str, dict[str, Any]] = {}
    grouped: dict[tuple[int, tuple[int, ...]], list[dict[str, Any]]] = defaultdict(list)
    all_positions: list[tuple[float, float, float]] = []

    for index, item in enumerate(objects):
        if item.get(type_key) != "part":
            continue
        part_id = int(item[id_key])
        library_item = library[str(part_id)]
        extra = library_item["extra"]

        if extra.get("type") == "flexible":
            flexible_parts = profile.flexible_parts or {}
            if part_id not in flexible_parts:
                continue
            flexible_values = item.get(values_key or "", {})
            points = flexible_values.get(deformation_key or "", [[]])[0][:4]
            if len(points) != 4 or any(len(point) != 3 for point in points):
                raise ValueError(f"Missing flexible control points for object {index}")
            descriptor = {
                "kind": flexible_parts[part_id],
                "points": [
                    [round(float(value), 4) for value in point]
                    for point in points
                ],
            }
            source_path = f"__flex__/{json.dumps(descriptor, separators=(',', ':'))}"
            flexible_descriptors[source_path] = descriptor
        else:
            geometry_name = extra.get("configuration") or Path(extra["mesh"]).stem
            source_path = f"geometries/{extra['version']}/{geometry_name}.json"
            if source_path not in available_files:
                configuration_path = (
                    f"configurations/{extra['version']}/{geometry_name}"
                )
                configured_geometry = configuration_geometries.get(configuration_path)
                if configured_geometry:
                    source_path = (
                        f"geometries/{extra['version']}/{configured_geometry}"
                    )
                fallback_name = re.sub(r"v\d+$", "", geometry_name)
                fallback_path = f"geometries/{extra['version']}/{fallback_name}.json"
                if source_path in available_files:
                    pass
                elif fallback_path in available_files:
                    source_path = fallback_path
                else:
                    raise FileNotFoundError(f"Missing geometry: {source_path}")

        if source_path not in geometry_paths:
            geometry_paths[source_path] = len(geometry_sources)
            geometry_sources.append(source_path)

        design_ref = part_design_reference(extra)
        colors = apply_color_rules(
            profile.color_rules,
            design_ref,
            normalized_color(item.get(color_key)),
        )
        matrix = world_matrix(index)
        position = (matrix[12], matrix[13], matrix[14])
        if not should_include_part(profile, position):
            continue
        all_positions.append(position)
        grouped[(geometry_paths[source_path], colors)].append(
            {
                "m": [round(float(value), 5) for value in matrix],
                "b": bag_number(index),
            }
        )

    if not all_positions:
        raise ValueError(f"No renderable parts found in {profile.model}")

    minimum = [min(point[axis] for point in all_positions) for axis in range(3)]
    maximum = [max(point[axis] for point in all_positions) for axis in range(3)]
    center = [(minimum[axis] + maximum[axis]) / 2 for axis in range(3)]
    size = [maximum[axis] - minimum[axis] for axis in range(3)]
    used_materials = sorted(
        reference
        for reference in {
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
    if profile.custom_materials:
        for reference, definition in profile.custom_materials.items():
            if reference in used_materials:
                color_payload[str(reference)] = definition
    groups = [
        {"g": geometry_id, "c": list(colors), "i": instances}
        for (geometry_id, colors), instances in grouped.items()
    ]
    scene = {
        "metadata": {
            "name": profile.name,
            "source": profile.source_url,
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
            {"flex": flexible_descriptors[source_path]}
            if source_path.startswith("__flex__/")
            else {"path": f"g/{index}.json"}
            for index, source_path in enumerate(geometry_sources)
        ],
        "groups": groups,
    }

    with output_scene.open("w", encoding="utf-8") as file:
        json.dump(scene, file, separators=(",", ":"))

    with zipfile.ZipFile(profile.geometries) as source_zip:
        with zipfile.ZipFile(
            output_geometries,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
        ) as output_zip:
            for index, source_path in enumerate(geometry_sources):
                if not source_path.startswith("__flex__/"):
                    output_zip.writestr(
                        f"g/{index}.json",
                        source_zip.read(source_path),
                    )

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
    print(f"Scene: {output_scene.stat().st_size / 1024 / 1024:.2f} MB")
    print(f"Geometry archive: {output_geometries.stat().st_size / 1024 / 1024:.2f} MB")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--set",
        choices=sorted(PROFILES),
        default="millennium-falcon",
        help="Set profile to convert (default: millennium-falcon)",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    prepare(PROFILES[args.set])


if __name__ == "__main__":
    main()

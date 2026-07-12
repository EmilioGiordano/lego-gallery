"""Build per-design color rules for the 76331 Batmobile from ToyPro inventory."""

from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOYPRO = Path(
    r"C:\Users\giord\.cursor\projects\c-Users-giord-Desktop-Code-Projects-Lego-animation\agent-tools\02dfa429-ef84-4ba8-b0b3-4e42e0930e1f.txt"
)

PEARL_TITANIUM = 9001
LIGHT_BLUISH_GRAY = 9002

CUSTOM_MATERIALS = {
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

SLUG_TO_MATERIAL = {
    "black": 26,
    "blue": 23,
    "yellow": 24,
    "trans-red": 41,
    "trans-black-2023": 375,
    "trans-clear": 40,
    "light-nougat": 283,
    "pearl-gold": 297,
    "pearl-dark-gray": PEARL_TITANIUM,
    "dark-bluish-gray": PEARL_TITANIUM,
    "light-bluish-gray": LIGHT_BLUISH_GRAY,
}

# Manual page 98–99 + user corrections missing from ToyPro.
MANUAL_ELEMENT_COLORS = {
    "6614120": "pearl-dark-gray",
    "6586478": "pearl-dark-gray",
    "6603150": "pearl-dark-gray",
    "6591913": "pearl-dark-gray",
    "6526592": "light-nougat",
    "6601630": "black",
    "6586476": "pearl-gold",
    "6586479": "trans-black-2023",
    "4619323": "black",
    "6245281": "black",
    "6115086": "black",
    "6534695": "black",
    "4517737": "black",
    "6109682": "black",
    "6589426": "black",
    "6171066": "black",
    "6514051": "trans-red",
    "6313116": "black",
    "6335388": "black",
    "6439039": "black",
    "393726": "black",
    "614126": "black",
    "6469445": "black",
    "6416444": "black",
    "6053077": "black",
    "6104209": "black",
    "6279875": "black",
    "6170808": "black",
    "4142135": "black",
    "4107558": "black",
    "303226": "black",
    "366626": "black",
    "6174917": "black",
}

# Design reference overrides when inventory matching is ambiguous.
DESIGN_OVERRIDES = {
    "28964": 26,  # platform base
    "95199": 26,  # side guns
    "55981": 26,  # rim
    "55982": 26,  # rim
    "92402": 26,  # tyre
    "56891": 26,  # tyre
    "50231": 26,  # cape
    "3320": PEARL_TITANIUM,  # batman cowl
    "115893": PEARL_TITANIUM,  # batman legs
    "3814": PEARL_TITANIUM,
    "3815": PEARL_TITANIUM,
    "3816": PEARL_TITANIUM,
    "3817": PEARL_TITANIUM,
    "3818v2": PEARL_TITANIUM,
    "3819v2": PEARL_TITANIUM,
    "3820v2": PEARL_TITANIUM,
    "78643": PEARL_TITANIUM,
    "8035": PEARL_TITANIUM,
    "3626d328": 283,
    "4073": 41,  # trans-red rear lights (when red)
    "18747": LIGHT_BLUISH_GRAY,
}


def norm(value: str) -> str:
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", " ", value)
    return re.sub(r"\s+", " ", value).strip()


def parse_toypro() -> tuple[dict[str, str], dict[str, str]]:
    text = TOYPRO.read_text(encoding="utf-8", errors="replace")
    blocks = re.split(r"LEGO® (\d+) ", text)[1:]
    colors: dict[str, str] = {}
    titles: dict[str, str] = {}
    for index in range(0, len(blocks), 2):
        element_id, body = blocks[index], blocks[index + 1]
        title = body.split("\n", 1)[0].strip()
        urls = re.findall(
            r"https://www\.toypro\.com/us/product/[^\s]+/([a-z0-9-]+)",
            body,
        )
        if urls:
            colors[element_id] = urls[0]
            titles[element_id] = title
    colors.update(MANUAL_ELEMENT_COLORS)
    return colors, titles


def design_reference(extra: dict) -> str:
    return str(
        extra.get("reference")
        or extra.get("configuration")
        or Path(extra.get("mesh", "unknown.json")).stem
    )


def main() -> None:
    element_colors, element_titles = parse_toypro()
    title_to_slug: dict[str, str] = {
        norm(title): slug for title, slug in zip(element_titles.values(), element_colors.values())
    }

    payload = json.loads(
        (ROOT / "model-sources/batmobile/model-response.json").read_text(encoding="utf-8")
    )
    objects = payload["data"]["file"]["objects"]["list"]
    keys = {
        name: str(index)
        for index, name in enumerate(payload["data"]["file"]["objects"]["keys"])
    }
    library = payload["data"]["library"]["official"]

    design_to_slug: dict[str, str] = {}
    unmatched: list[tuple[str, str]] = []

    for item in objects:
        if not isinstance(item, dict) or item.get(keys["type"]) != "part":
            continue
        part = library[str(item[keys["id"]])]
        ref = design_reference(part["extra"])
        if ref in DESIGN_OVERRIDES:
            continue
        name = norm(part["name"])
        slug = title_to_slug.get(name)
        if slug is None:
            for title, candidate in title_to_slug.items():
                if name in title or title in name:
                    slug = candidate
                    break
        if slug is None:
            unmatched.append((ref, part["name"]))
            continue
        if ref in design_to_slug and design_to_slug[ref] != slug:
            print(f"conflict {ref}: {design_to_slug[ref]} vs {slug} ({part['name']})")
        design_to_slug[ref] = slug

    design_to_material = {
        ref: SLUG_TO_MATERIAL[slug] for ref, slug in design_to_slug.items()
    }
    design_to_material.update(DESIGN_OVERRIDES)

    output = {
        "customMaterials": {str(key): value for key, value in CUSTOM_MATERIALS.items()},
        "designToMaterial": {ref: int(material) for ref, material in design_to_material.items()},
        "unmatched": unmatched,
    }
    out_path = ROOT / "tools" / "batmobile-color-map.json"
    out_path.write_text(json.dumps(output, indent=2), encoding="utf-8")
    print(f"Wrote {out_path}")
    print(f"Mapped designs: {len(design_to_material)}")
    print(f"Unmatched: {len(unmatched)}")
    for ref, name in unmatched:
        print(f"  - {ref}: {name}")


if __name__ == "__main__":
    main()

"""Compose existing evidence for visual QA; never alter business screenshots."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
from PIL import Image

def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--implementation", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--source-box", nargs=4, type=int)
    parser.add_argument("--implementation-box", nargs=4, type=int)
    args = parser.parse_args()
    source, implementation = Image.open(args.source).convert("RGB"), Image.open(args.implementation).convert("RGB")
    original = [source.size, implementation.size]
    if args.source_box:
        source = source.crop(tuple(args.source_box))
    if args.implementation_box:
        implementation = implementation.crop(tuple(args.implementation_box))
    composite = Image.new("RGB", (source.width + implementation.width + 24, max(source.height, implementation.height)), "white")
    composite.paste(source, (0, 0))
    composite.paste(implementation, (source.width + 24, 0))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.exists():
        raise FileExistsError("Preserve earlier QA passes: output already exists")
    composite.save(args.output)
    print(json.dumps({"source_pixels": original[0], "implementation_pixels": original[1], "comparison_pixels": composite.size, "resized": False}))

if __name__ == "__main__":
    main()

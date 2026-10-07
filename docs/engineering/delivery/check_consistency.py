#!/usr/bin/env python3
"""Read-only structural checks for the delivery documents; not business acceptance."""
from __future__ import annotations

import argparse
import json
import re
import unicodedata
from pathlib import Path
from urllib.parse import unquote


def heading_anchors(content: str) -> set[str]:
    result: set[str] = set()
    counts: dict[str, int] = {}
    for heading in re.findall(r"^#{1,6}\s+(.+?)\s*#*$", content, re.MULTILINE):
        title = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", heading).replace("`", "").lower()
        slug = "".join(char for char in title if char in "-_ " or unicodedata.category(char)[0] in "LN").replace(" ", "-")
        occurrence = counts.get(slug, 0)
        counts[slug] = occurrence + 1
        result.add(f"{slug}-{occurrence}" if occurrence else slug)
    result.update(re.findall(r'<a\s+(?:id|name)=["\x27]([^"\x27]+)', content))
    return result


def find_cycle(graph: dict[str, set[str]]) -> list[str]:
    complete: set[str] = set()
    active: list[str] = []

    def visit(node: str) -> list[str]:
        if node in active:
            return active[active.index(node):] + [node]
        if node in complete:
            return []
        active.append(node)
        for child in sorted(graph.get(node, set())):
            cycle = visit(child)
            if cycle:
                return cycle
        active.pop()
        complete.add(node)
        return []

    for node in sorted(graph):
        cycle = visit(node)
        if cycle:
            return cycle
    return []


def check(root: Path, allow_missing_private_evidence: bool = False) -> dict[str, object]:
    folder = root / "docs/engineering/delivery"
    paths = sorted(folder.glob("*.md"))
    docs = {path.name: path.read_text(encoding="utf-8") for path in paths}
    errors: list[str] = []
    definitions = {
        "WP": re.findall(r"^### (WP-\d{2})\b", docs["work-packages.md"], re.MULTILINE),
        "AC": re.findall(r"^\| (AC-\d{2}) \|", docs["acceptance-matrix.md"], re.MULTILINE),
        "CT": re.findall(r"^## (CT-\d{2})\b", docs["contract-checklist.md"], re.MULTILINE),
        "ER": re.findall(r"^\| (ER-\d{2}) /", docs["engineering-review.md"], re.MULTILINE),
    }
    for prefix, identifiers in definitions.items():
        if len(identifiers) != len(set(identifiers)):
            errors.append(f"duplicate {prefix} definition")
        for name, content in docs.items():
            refs = set(re.findall(rf"\b{prefix}-\d{{2}}\b", content))
            for missing in sorted(refs - set(identifiers)):
                errors.append(f"{name}: undefined {missing}")

    source = (root / "docs/requirements-alignment.md").read_text(encoding="utf-8")
    expected_requirements = set(re.findall(r"^### (R-\d{3})：", source, re.MULTILINE))
    trace_rows = re.findall(r"^\| (R-\d{3}) \|(.+)$", docs["requirement-coverage.md"], re.MULTILINE)
    actual_requirements = [identifier for identifier, _ in trace_rows]
    if len(actual_requirements) != len(set(actual_requirements)):
        errors.append("duplicate requirement row")
    if set(actual_requirements) != expected_requirements:
        errors.append(f"requirement coverage mismatch: missing={sorted(expected_requirements - set(actual_requirements))}, extra={sorted(set(actual_requirements) - expected_requirements)}")
    for identifier, row in trace_rows:
        if not re.search(r"WP-\d{2}", row) or not re.search(r"AC-\d{2}", row):
            errors.append(f"{identifier}: missing work package or acceptance mapping")

    graph: dict[str, set[str]] = {}
    package_table: list[str] = []
    dependency_section = docs["work-packages.md"].split("## 依赖及责任总表", 1)[1].split("## 各包交付卡", 1)[0]
    for line in dependency_section.splitlines():
        if not re.match(r"\| WP-\d{2} ", line):
            continue
        columns = [part.strip() for part in line.strip("|").split("|")]
        if len(columns) != 5:
            errors.append(f"invalid work package dependency row: {line}")
            continue
        identifier = columns[0].split()[0]
        package_table.append(identifier)
        graph[identifier] = set(re.findall(r"WP-\d{2}", " ".join(columns[3:5])))
    wp_set = set(definitions["WP"])
    if set(package_table) != wp_set or len(package_table) != len(wp_set):
        errors.append("work package definitions and dependency table differ")
    tracked = re.findall(r"^\| (WP-\d{2}) ", docs["delivery-tracker.md"], re.MULTILINE)
    if set(tracked) != wp_set or len(tracked) != len(wp_set):
        errors.append("work package definitions and tracker differ")
    cycle = find_cycle(graph)
    if cycle:
        errors.append("dependency cycle: " + " -> ".join(cycle))
    associated_ac: set[str] = set()
    cards = re.split(r"^### (WP-\d{2})\b", docs["work-packages.md"], flags=re.MULTILINE)
    for index in range(1, len(cards), 2):
        cases = set(re.findall(r"AC-\d{2}", cards[index + 1]))
        associated_ac.update(cases)
        if not cases:
            errors.append(f"{cards[index]}: no acceptance group")
    for orphan in sorted(set(definitions["AC"]) - associated_ac):
        errors.append(f"acceptance group has no work package: {orphan}")

    link_count = 0
    unavailable_private_evidence: list[str] = []
    private_roots = [(root / "artifacts/acceptance").resolve(), (root / "artifacts/review").resolve()]
    entry_paths = [root / name for name in ["README.md", "AGENTS.md", "CLAUDE.md", "CONTEXT.md", "DESIGN.md"]]
    product_paths = [path for path in (root / "product").rglob("*.md")
                     if not {"node_modules", "build", "dist", ".gradle"}.intersection(path.relative_to(root).parts)]
    link_paths = sorted(set((root / "docs").rglob("*.md")) | set(entry_paths) | set(product_paths))
    for path in link_paths:
        content = path.read_text(encoding="utf-8")
        for target in re.findall(r"\[[^\]\n]*\]\(([^)\n]+)\)", content):
            if re.match(r"[a-z][a-z0-9+.-]*:", target, re.IGNORECASE):
                continue
            target_path, _, fragment = unquote(target.strip("<>")).partition("#")
            destination = path.parent / target_path if target_path else path
            link_count += 1
            if not destination.exists():
                if allow_missing_private_evidence and any(destination.resolve().is_relative_to(base) for base in private_roots):
                    unavailable_private_evidence.append(f"{path.relative_to(root)}: unavailable private evidence {target}")
                else:
                    errors.append(f"{path.relative_to(root)}: missing link {target}")
            elif fragment and destination.suffix == ".md" and fragment not in heading_anchors(destination.read_text(encoding="utf-8")):
                errors.append(f"{path.relative_to(root)}: missing anchor {target}")
    return {
        "scope": "documentation_structure_only",
        "documents": len(paths),
        "link_documents": len(link_paths),
        "requirements": len(actual_requirements),
        "work_packages": len(wp_set),
        "acceptance_groups": len(definitions["AC"]),
        "contracts": len(definitions["CT"]),
        "risks": len(definitions["ER"]),
        "local_links_checked": link_count,
        "private_evidence_unavailable": unavailable_private_evidence,
        "errors": errors,
        "passed": not errors,
        "limitations": "不证明语义完整、开发完成或业务验收；不检查外部链接、服务及真机；CI 可报告缺失的私有验收/审查证据，但不据此证明证据存在或验收通过。",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[3])
    parser.add_argument("--allow-missing-private-evidence", action="store_true", help="Report unavailable ignored artifacts/acceptance and artifacts/review evidence separately in clean CI checkouts; all other missing links still fail")
    args = parser.parse_args()
    try:
        report = check(args.root.resolve(), args.allow_missing_private_evidence)
    except (OSError, KeyError, UnicodeError) as error:
        print(json.dumps({"scope": "documentation_structure_only", "passed": False, "error": str(error)}, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())

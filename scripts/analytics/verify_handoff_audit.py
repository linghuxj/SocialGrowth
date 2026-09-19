"""离线核对审计编号、链接及预算/容量跨文件一致性；不证明实际平台能力。"""

import argparse
import importlib.util
import json
import re
import sys
from collections import Counter
from decimal import Decimal
from math import ceil
from pathlib import Path
from urllib.parse import unquote


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def text(root: Path, name: str) -> str:
    return (root / name).read_text(encoding="utf-8")


def anchors(source: str) -> set[str]:
    found: set[str] = set()
    counts: Counter[str] = Counter()
    for heading in re.findall(r"^#{1,6}\s+(.+)$", source, re.M):
        slug = re.sub(r"[^\w\- ]", "", heading.lower()).replace(" ", "-")
        index = counts[slug]
        counts[slug] += 1
        found.add(f"{slug}-{index}" if index else slug)
    found.update(re.findall(r'<a\s+(?:id|name)="([^"]+)"', source))
    return found


def check_links(root: Path) -> tuple[int, int]:
    files = sorted(set(root.glob("*.md")) | set((root / "docs").rglob("*.md"))
                   | set((root / "artifacts/data").glob("*.md"))
                   | {root / "artifacts/reports/README.md"})
    total = 0
    errors: list[str] = []
    for path in files:
        source = path.read_text(encoding="utf-8")
        for target in re.findall(r"\[[^\]\n]+\]\(([^\s)]+)\)", source):
            if re.match(r"[a-zA-Z][\w+.-]*:", target):
                continue
            total += 1
            name, _, fragment = unquote(target).partition("#")
            destination = (path.parent / name).resolve() if name else path
            if not destination.exists():
                errors.append(f"{path.relative_to(root)}: missing {target}")
            elif fragment and destination.suffix == ".md":
                if fragment not in anchors(destination.read_text(encoding="utf-8")):
                    errors.append(f"{path.relative_to(root)}: missing anchor {target}")
    require(not errors, "\n".join(errors))
    return len(files), total


def check_ids(root: Path) -> Counter[str]:
    expected = {f"{prefix}-{n:02}" for prefix, size in
                [("RED", 6), ("ORA", 7), ("YEL", 19), ("GRN", 12)]
                for n in range(1, size + 1)}
    ledger = text(root, "docs/handoff/2026-09-19-audit-verification.md")
    rows = re.findall(r"^\| ((?:RED|ORA|YEL|GRN)-\d{2}) \| [^|]+ \| ([^|]+) \|", ledger, re.M)
    require(len(rows) == 44 and {key for key, _ in rows} == expected, "复核台账编号缺失/重复")
    original = text(root, "docs/handoff/2026-09-19-full-document-audit.md")
    for key, state in rows:
        if key.startswith(("RED", "ORA")):
            require(f"复核标注 {key}：{state.strip()}" in original, f"{key}缺原报告标注")
        else:
            row = re.search(rf"^\| {key} \|.*$", original, re.M)
            require(row is not None and f"**{state.strip()}**" in row[0], f"{key}表格状态不同步")
    old = text(root, "docs/handoff/2026-09-19-business-audit-closure.md")
    old_ids = re.findall(r"^\| ((?:H|M|L)-\d{2}) \|", old, re.M)
    expected_old = {f"{prefix}-{n:02}" for prefix, size in [("H", 16), ("M", 19), ("L", 10)]
                    for n in range(1, size + 1)}
    require(len(old_ids) == 45 and set(old_ids) == expected_old, "45项历史处置编号缺失/重复")
    stage = text(root, "docs/handoff/2026-09-19-product-stage-plan.md")
    pg = re.findall(r"^\| (PG-\d{2}) ", stage, re.M)
    require(len(pg) == 16 and set(pg) == {f"PG-{n:02}" for n in range(1, 17)}, "PG编号异常")
    cases = re.findall(r"^\| (C-\d{2}) ", text(root, "docs/product-first-loop-spec.md"), re.M)
    require(len(cases) == 14 and set(cases) == {f"C-{n:02}" for n in range(1, 15)}, "案例编号异常")
    return Counter(state.strip() for _, state in rows)


def money(value: str) -> tuple[Decimal, Decimal]:
    parts = value.strip().replace("**", "").split("–")
    return Decimal(parts[0]), Decimal(parts[-1])


def check_budget(root: Path) -> None:
    source = text(root, "docs/budget-summary.md")
    monthly = [line.strip("| ").split("|") for line in source.splitlines()
               if re.match(r"^\| 第 \d+ 月 \|", line)]
    require(len(monthly) == 12, "预算月份不完整")
    low = [Decimal(0)] * 6
    high = [Decimal(0)] * 6
    totals: list[tuple[Decimal, Decimal]] = []
    for index, row in enumerate(monthly, 1):
        require(row[0].strip() == f"第 {index} 月", "预算月份顺序/重复错误")
        values = [money(cell) for cell in row[1:]]
        require(len(values) == 6, "预算列数错误")
        require(sum(v[0] for v in values[:5]) == values[5][0], f"M{index}下沿错误")
        require(sum(v[1] for v in values[:5]) == values[5][1], f"M{index}上沿错误")
        totals.append(values[5])
        for column, (a, b) in enumerate(values):
            low[column] += a
            high[column] += b
    require(low == list(map(Decimal, [96, 12, 16, 32, 6, 162])), "年度下沿错误")
    require(high == list(map(Decimal, [96, 12, 16, 66, 6, 196])), "年度上沿错误")
    for a, b, label in [(0, 7, "第 1–7 月"), (7, 9, "第 8–9 月"), (9, 12, "第 10–12 月")]:
        match = re.search(rf"^\| {label} \| ([^|]+) \|", source, re.M)
        require(match is not None, f"{label}阶段表缺失")
        require(money(match[1]) == (sum(t[0] for t in totals[a:b]), sum(t[1] for t in totals[a:b])),
                f"{label}阶段费用错误")
    delivery = text(root, "docs/monthly-delivery.md")
    budgets = re.findall(r"^\| 第 \d+ 月 \|.*\| ([^|]+) \|$", delivery, re.M)
    require([money(v) for v in budgets] == totals, "月度交付与预算不一致")


def check_capacity(root: Path) -> None:
    data = json.loads(text(root, "artifacts/data/前三个月发布测算-数据.json"))
    spec = importlib.util.spec_from_file_location("capacity", root / "scripts/analytics/calc_launch_capacity.py")
    require(spec is not None and spec.loader is not None, "无法读取计算脚本")
    module = importlib.util.module_from_spec(spec)
    previous_bytecode = sys.dont_write_bytecode
    try:
        sys.dont_write_bytecode = True
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous_bytecode
    require(module.calculate() == data, "JSON未与脚本同步")
    require(data["both_platforms_plan"] == [240, 780, 2400], "当前规模情景发生未经记录的变化")
    require(data["both_platforms_realized"] == [216, 702, 2160], "成功量错误")
    require(data["independent_content"]["planned_total"] == 3420, "计划库存错误")
    require(data["independent_content"]["successful_total"] == 3078, "成功库存错误")
    for cohort, coefficient in zip(data["cohorts"], [108, 54, 27], strict=True):
        require(cohort["cumulative_view_coefficients"][-1] == coefficient, "季度观看系数错误")
        require(cohort["q_required_at_month3"] == {
            "expanded_3m": ceil(3_000_000 / coefficient), "full_10m": ceil(10_000_000 / coefficient)
        }, "观看门槛计算错误")
    report = text(root, "artifacts/data/3至20台真机设备-前三个月发布与准入测算.md")
    plan_rows = [line.split("|")[1:-1] for line in report.splitlines()
                 if re.match(r"^\| \*\*第 [123] 个月\*\*", line)]
    quantities = [[int(re.search(r"[\d,]+", cell)[0].replace(",", ""))
                   for cell in row[5:8]] for row in plan_rows]
    expected_quantities = [list(row) for row in zip(data["per_platform_plan"],
                            data["both_platforms_plan"], data["both_platforms_realized"], strict=True)]
    require(quantities == expected_quantities, "MD发布产能表与JSON不一致")
    required = re.findall(r"至少 \*\*([\d,]+) 次\*\*", report)
    require(required == ["27,778", "92,593"], "MD观看门槛与JSON不一致")
    require("27 + 54 + 54 × 50% = 108" in report, "MD观看分母不正确")
    require("**3,420 份**" in report and "**3,078 份**" in report, "MD库存口径未同步")
    require(not any(old in report for old in ["22,222", "74,074", "1,500~3,000", "内部工程实测综合参数"]),
            "MD仍含被替代数字或实测误称")
    view_rows = [line.split("|")[1:-1] for line in report.splitlines()
                 if "合格观看 |" in line or "公开观看 |" in line]
    expected_views = [values + [sum(values)] for scenario in data["monthly_views"].values()
                      for values in scenario.values()]
    actual_views = [[float(cell.strip().replace(",", "")) for cell in row[2:]] for row in view_rows]
    require(actual_views == expected_views, "MD观看表与JSON不一致")
    archived = text(root, "artifacts/data/15至50台设备-前三个月发布与准入测算.md")
    require("历史版本归档提示" in archived and "121.5q" in archived
            and "24,692" in archived and "82,305" in archived, "归档边界/原情景被破坏")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    root = parser.parse_args().root.resolve()
    counts = check_ids(root)
    check_budget(root)
    check_capacity(root)
    documents, links = check_links(root)
    print(json.dumps({"result": "PASS", "audit_items": 44, "states": dict(counts),
                      "historical_items": 45, "product_items": 16, "cases": 14,
                      "markdown_documents": documents, "local_links": links,
                      "budget": "12 months and 3 periods reconciled",
                      "capacity": "script / JSON / MD reconciled"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()

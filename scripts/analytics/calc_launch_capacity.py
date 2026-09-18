"""重算 3~5 台至 20 台纯真机设备前 3 个月发布产能与观看增长测算；不连接平台、不预测获批概率。"""
import json
from math import ceil
from pathlib import Path

REALIZATION = 0.9
CURRENT_MONTH_SHARE = 0.5
MONTH_DAYS = 30
# 最新基准：单机 1 FB + 1 YT
# 第 1 月：4 台设备（各平台 4 号，双平台 8 号，范围 3~5 台 / 6~10 号）
# 第 2 月：累计 9 台设备（新增 5 台，各平台 9 号，双平台 18 号，范围 8~10 台 / 16~20 号）
# 第 3 月：累计 20 台设备（新增 11 台，各平台 20 号，双平台 40 号）
COHORTS = [
    {"name": "首批试点(第1月投入-4台真机)", "accounts_per_platform": 4, "daily": [1, 2, 2]},
    {"name": "第2月爬坡新增(5台真机)", "accounts_per_platform": 5, "daily": [0, 1, 2]},
    {"name": "第3月规模化新增(11台真机)", "accounts_per_platform": 11, "daily": [0, 0, 2]},
]
SCENARIOS = {
    "低表现": {"facebook_public": 100, "youtube_qualified": 500},
    "工作假设": {"facebook_public": 300, "youtube_qualified": 2000},
    "较强表现": {"facebook_public": 1000, "youtube_qualified": 10000},
}


def monthly_weights(published):
    return [
        n * CURRENT_MONTH_SHARE
        + (published[m - 1] if m else 0) * (1 - CURRENT_MONTH_SHARE)
        for m, n in enumerate(published)
    ]


def calculate():
    plan = [
        sum(c["accounts_per_platform"] * c["daily"][m] * MONTH_DAYS for c in COHORTS)
        for m in range(3)
    ]
    actual = [n * REALIZATION for n in plan]
    weights = monthly_weights(actual)
    cohorts = []
    for c in COHORTS:
        per_account = [d * MONTH_DAYS * REALIZATION for d in c["daily"]]
        cohort_weights = monthly_weights(per_account)
        cumulative = [sum(cohort_weights[:m + 1]) for m in range(3)]
        cohorts.append({
            **c,
            "per_account_realized_posts": per_account,
            "cumulative_view_coefficients": cumulative,
            "q_required_at_month3": {
                "expanded_3m": ceil(3_000_000 / cumulative[-1]),
                "full_10m": ceil(10_000_000 / cumulative[-1]),
            },
            "month3_views_by_q": {
                str(q): cumulative[-1] * q for q in [500, 2000, 10000, 30000, 100000]
            },
        })
    return {
        "assumptions": {
            "month_days": MONTH_DAYS,
            "realization": REALIZATION,
            "current_month_share": CURRENT_MONTH_SHARE,
            "next_month_share": 1 - CURRENT_MONTH_SHARE,
            "long_tail_after_30_days": 0,
            "note": "参数为情景假设；FB公开观看与YT合格观看不得合并为同口径受众。",
        },
        "per_platform_plan": plan,
        "both_platforms_plan": [2 * n for n in plan],
        "per_platform_realized": actual,
        "both_platforms_realized": [2 * n for n in actual],
        "calendar_month_view_coefficients": weights,
        "monthly_views": {
            name: {metric: [w * q for w in weights] for metric, q in params.items()}
            for name, params in SCENARIOS.items()
        },
        "cohorts": cohorts,
    }


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[2]
    output = root / "artifacts/data/前三个月发布测算-数据.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(calculate(), ensure_ascii=False, indent=2) + "\n")
    print(output)

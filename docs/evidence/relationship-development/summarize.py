"""Summarize native relationship_balance output without discarding unfinished runs."""
import json
import math
import statistics
import sys
from pathlib import Path


def duration(rows, key):
    values = sorted(float(r[key]) for r in rows if r[key] != "unfinished")
    return {
        "observations": len(rows), "finished": len(values),
        "unfinished": len(rows) - len(values),
        "statistics_population": "completed observations only",
        "censoring_horizon_days": 56,
        "cohort_mean_lower_bound_days": (
            (sum(values) + 56 * (len(rows) - len(values))) / len(rows) if rows else None
        ),
        "mean_days": statistics.mean(values) if values else None,
        "median_days": statistics.median(values) if values else None,
        "p90_days": values[math.ceil(len(values) * .9) - 1] if values else None,
        "max_days": max(values) if values else None,
    }


def summarize(path):
    runs, pairs, effects, empty, recovery_effects, chains, active_chains = [], [], [], [], [], [], []
    needs, eligibility = [], []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        parts = line.split(",")
        if parts[0] not in ("RUN", "PAIR", "EFFECT", "EMPTY", "RECOVERY_EFFECT", "CHAIN", "CHAIN_ACTIVE", "NEED", "ELIGIBILITY"):
            continue
        row = {"scenario": parts[1], "seed": int(parts[2])}
        if parts[0] == "NEED":
            row.update(need=parts[3], **dict(p.split("=", 1) for p in parts[4:]))
            needs.append(row)
        elif parts[0] == "ELIGIBILITY":
            row.update(dict(p.split("=", 1) for p in parts[3:]))
            eligibility.append(row)
        elif parts[0] in ("CHAIN", "CHAIN_ACTIVE"):
            row.update(dict(p.split("=", 1) for p in parts[3:]))
            (chains if parts[0] == "CHAIN" else active_chains).append(row)
        elif parts[0] == "RECOVERY_EFFECT":
            row.update(cause=parts[3], events=int(parts[4]), actual=float(parts[5]))
            recovery_effects.append(row)
        elif parts[0] == "EMPTY":
            row.update(need=parts[3], activity=parts[4], **dict(p.split("=", 1) for p in parts[5:]))
            empty.append(row)
        elif parts[0] == "EFFECT":
            row.update(cause=parts[3], events=int(parts[4]),
                       requested=float(parts[5]), actual=float(parts[6]))
            effects.append(row)
        else:
            row.update(dict(p.split("=", 1) for p in parts[3 if parts[0] == "RUN" else 5:]))
            (runs if parts[0] == "RUN" else pairs).append(row)
    ordinary = [r for r in runs if r["scenario"] in ("shipped", "two", "three", "four")]

    def household(rows):
        def total(key):
            return sum(int(r.get(key, 0)) for r in rows)
        weeks = total("sims") * 8
        keys = {(r["scenario"], r["seed"]) for r in rows}
        chain_rows = [r for r in chains if (r["scenario"], r["seed"]) in keys]
        return {
            "runs": len(rows), "sim_weeks": weeks, "incidents": total("incidents"),
            "directional_contact_hours": sum(float(r["exposure_hours"]) for r in rows),
            "incidents_per_sim_week": total("incidents") / weeks if weeks else None,
            "emergencies": total("emergencies"), "player_directed": total("directed"),
            "non_incompatible_samples": total("samples"),
            "above_hostility_percent": 100 * total("healthy") / total("samples") if total("samples") else None,
            "wait_minutes": total("wait_minutes"),
            "max_wait_minutes": max((int(r["max_wait"]) for r in rows), default=0),
            "low_need_minutes": total("low_need_minutes"),
            "essential_empty_minutes": total("essential_empty_minutes"),
            "essential_empty_while_waiting": total("essential_empty_while_waiting"),
            "entry_wait_minutes": total("entry_wait_minutes"), "start_wait_minutes": total("start_wait_minutes"),
            "alive_at_end": total("alive"), "original_population": total("sims"),
            "chains_completed": total("chains_completed"),
            "chains_abandoned": total("chains_abandoned"),
            "chains_active_at_end": sum(int(r["active_at_end"]) for r in chain_rows) if chain_rows else None,
            "max_chain_age_minutes": max((int(r["max_age_minutes"]) for r in chain_rows), default=None),
            "max_chain_stall_minutes": max((int(r["max_stall_minutes"]) for r in chain_rows), default=None),
        }

    def contributions(rows):
        result = {}
        for row in rows:
            item = result.setdefault(row["cause"], {"events": 0, "actual": 0.0})
            item["events"] += row["events"]
            item["actual"] += row["actual"]
            if "requested" in row:
                item["requested"] = item.get("requested", 0.0) + row["requested"]
        return result

    recovery = {}
    for scenario in ("recovery0", "recovery5"):
        rows = [r for r in runs if r["scenario"] == scenario]
        recovery[scenario] = duration(rows, "recovery_days") | {
            "subsequent_incidents_during_recovery": sum(int(r.get("during_recovery", 0)) for r in rows),
            "subsequent_incidents_in_56_days": sum(int(r["subsequent"]) for r in rows),
            "effects_until_recovery": contributions([r for r in recovery_effects if r["scenario"] == scenario]),
        }
    incompatible = duration([p for p in pairs if p["scenario"] == "incompatible"], "hostile_day")
    for cause in ("SharedActivity", "Incompatibility", "Conversation", "Decay"):
        incompatible[cause] = sum(e["actual"] for e in effects if e["scenario"] == "incompatible" and e["cause"] == cause)
    empty_summary = {}
    for row in empty:
        key = ":".join(row[k] for k in ("scenario", "need", "activity"))
        item = empty_summary.setdefault(key, {"minutes": 0, "within_two_hours_of_privacy_wait": 0})
        item["minutes"] += int(row["minutes"])
        if row["recent_wait"] == "true":
            item["within_two_hours_of_privacy_wait"] += int(row["minutes"])
    return {"source": str(path), "seeds": sorted({r["seed"] for r in runs}),
            "scenario_runs": len(runs), "ordinary": household(ordinary),
            "layouts": {s: household([r for r in ordinary if r["scenario"] == s]) for s in ("shipped", "two", "three", "four")},
            "recovery": recovery, "incompatible": incompatible, "empty_needs_by_activity": empty_summary,
            "active_chains_at_end": active_chains,
            "critical_person_minutes": {s: {
                n: sum(int(r["critical_minutes"]) for r in needs if r["scenario"] == s and r["need"] == n)
                for n in sorted({r["need"] for r in needs})}
                for s in sorted({r["scenario"] for r in needs})},
            "first_positive_contact": [r for r in eligibility if r["scenario"].startswith("recovery")],
            "contributions": {s: contributions([e for e in effects if e["scenario"] == s]) for s in sorted({r["scenario"] for r in runs})}}


if __name__ == "__main__":
    print(json.dumps([summarize(Path(p)) for p in sys.argv[1:]], indent=2))

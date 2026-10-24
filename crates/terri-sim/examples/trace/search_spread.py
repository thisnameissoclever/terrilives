"""Runs the shipped household for one week under 200 careers seeds and
tabulates where Bill and Casey are hired and which schedules they hold
(plan Task 12 step 4, issue 296). Reads only the trace's JOB lines.

Build the trace first, then pass the built example, an output file and
optionally the number of seeds:

    cargo build --release -p terri-sim --example trace
    py -3 crates/terri-sim/examples/trace/search_spread.py <target>/release/examples/trace.exe spread.json 200
"""
import collections
import json
import pathlib
import re
import subprocess
import sys

EXE = sys.argv[1]
OUT = pathlib.Path(sys.argv[2])
SEEDS = range(int(sys.argv[3]) if len(sys.argv) > 3 else 200)
JOB = re.compile(r"^JOB (\w+): (?:(.+) \((\w+)\), shift (\w+) kind (\d) from (\d+) for (\d+) ticks, days mask (0b[01]+)|none)$")

rows = []
for seed in SEEDS:
    run = subprocess.run([EXE, "10080", "--careers-seed", str(seed)], capture_output=True, text=True)
    jobs = {}
    for line in run.stdout.splitlines():
        match = JOB.match(line.strip())
        if match:
            name = match.group(1)
            if match.group(3) is None:
                jobs[name] = None
            else:
                jobs[name] = {
                    "job": match.group(3), "shift": match.group(4), "kind": int(match.group(5)),
                    "schedule": [int(match.group(6)), int(match.group(7)), int(match.group(8), 2)],
                }
    rows.append({"seed": seed, "exit": run.returncode, "jobs": jobs})
    print(seed, run.returncode, {name: job and job["job"] for name, job in jobs.items()}, flush=True)

PATH_OF = {
    "office": "office", "cafe": "cafe", "night": "night_watch", "hospital": "hospital",
    "warehouse": "warehouse", "library": "library", "kitchen": "restaurant_kitchen", "buses": "buses",
}

def path_of(job_id):
    for prefix, path in PATH_OF.items():
        if job_id.startswith(prefix):
            return path
    return job_id

summary = {}
for name in ["Bill", "Casey"]:
    counts = collections.Counter(path_of(row["jobs"][name]["job"]) if row["jobs"].get(name) else "unemployed" for row in rows)
    summary[name] = {path: count / len(rows) for path, count in counts.most_common()}
def schedule(row, name):
    job = row["jobs"].get(name)
    return tuple(job["schedule"]) if job else None
all_three = sum(1 for row in rows if schedule(row, "Tim") is not None
                and schedule(row, "Tim") == schedule(row, "Bill") == schedule(row, "Casey"))
tim_bill = sum(1 for row in rows if schedule(row, "Bill") is not None and schedule(row, "Bill") == schedule(row, "Tim"))
bill_casey = sum(1 for row in rows if schedule(row, "Bill") is not None and schedule(row, "Bill") == schedule(row, "Casey"))
any_two = sum(1 for row in rows if len({s for s in (schedule(row, n) for n in ["Tim", "Bill", "Casey"]) if s is not None})
              < len([n for n in ["Tim", "Bill", "Casey"] if schedule(row, n) is not None]))
summary["runs"] = len(rows)
summary["nonzero_exits"] = sum(1 for row in rows if row["exit"] != 0)
summary["all_three_share"] = all_three / len(rows)
summary["tim_and_bill_share"] = tim_bill / len(rows)
summary["bill_and_casey_share"] = bill_casey / len(rows)
summary["at_least_two_share"] = any_two / len(rows)
OUT.write_text(json.dumps({"summary": summary, "rows": rows}, indent=1), encoding="utf-8")
print(json.dumps(summary, indent=1))

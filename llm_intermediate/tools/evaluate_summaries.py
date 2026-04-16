#!/usr/bin/env python3
"""
Evaluation metrics from saved llm_intermediate/results/eval_*.json

1) **Without references.jsonl** — still writes useful scores:
   - ROUGE-L F1 between short gauge `summary` and long `memorandum_summary`
     (lexical overlap; not a gold standard, but a reproducible number)
   - optional BLEU for the same pair
   (Does not aggregate `final_eval_accuracy_%` / `final_confidence`: those fields are
   not reliable thesis metrics.)

2) **With references.jsonl** — adds BLEU / ROUGE-L vs your gold `reference` text per entity_id.

References file: JSON lines or JSON array:
  { "entity_id": "ENT001", "reference": "Gold standard paragraph..." }

Usage:
  python tools/evaluate_summaries.py
  python tools/evaluate_summaries.py --reports results --refs results/references.jsonl
"""
from __future__ import annotations

import argparse
import json
import statistics
import sys
from pathlib import Path


def _load_refs(path: Path) -> dict[str, str]:
    raw = path.read_text(encoding="utf-8").strip()
    if not raw:
        return {}
    out: dict[str, str] = {}
    if raw.startswith("["):
        data = json.loads(raw)
        for item in data:
            eid = str(item.get("entity_id", "")).strip().lstrip("#")
            ref = str(item.get("reference", "")).strip()
            if eid and ref:
                out[eid] = ref
        return out
    for line in raw.splitlines():
        line = line.strip()
        if not line:
            continue
        item = json.loads(line)
        eid = str(item.get("entity_id", "")).strip().lstrip("#")
        ref = str(item.get("reference", "")).strip()
        if eid and ref:
            out[eid] = ref
    return out


def _norm_eid(eid) -> str:
    if eid is None:
        return ""
    s = str(eid).strip()
    return s[1:] if s.startswith("#") else s


def main() -> int:
    parser = argparse.ArgumentParser(description="Summary + model metrics from eval_*.json")
    root = Path(__file__).resolve().parents[1]
    parser.add_argument("--reports", type=Path, default=root / "results", help="Folder with eval_*.json")
    parser.add_argument(
        "--refs",
        type=Path,
        default=root / "results" / "references.jsonl",
        help="Optional JSONL / JSON array: entity_id + reference",
    )
    parser.add_argument("--out", type=Path, default=root / "results" / "summary_metrics_report.json")
    args = parser.parse_args()

    try:
        from sacrebleu.metrics import BLEU
        from rouge_score import rouge_scorer
    except ImportError:
        print("Install: pip install sacrebleu rouge-score", file=sys.stderr)
        return 1

    refs = _load_refs(args.refs) if args.refs.is_file() else {}
    if not refs:
        print(
            "No references.jsonl - using summary vs memorandum ROUGE/BLEU only (add references for gold metrics).",
            file=sys.stderr,
        )
        print(
            f"Optional: add gold lines to {args.refs} e.g. "
            '{"entity_id":"ENT029","reference":"Your gold summary..."}',
            file=sys.stderr,
        )

    bleu = BLEU()
    rouge = rouge_scorer.RougeScorer(["rougeL"], use_stemmer=True)

    rows: list[dict] = []
    rouge_pair: list[float] = []
    bleu_pair: list[float] = []

    for p in sorted(args.reports.glob("eval_*.json")):
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as e:
            print(f"Skip {p.name}: {e}", file=sys.stderr)
            continue
        eid = data.get("entity_id")
        eid_s = _norm_eid(eid)
        hyp = (data.get("summary") or "").strip()
        memo = (data.get("memorandum_summary") or data.get("advanced_details", {}).get("summary") or "").strip()
        ref_text = refs.get(eid_s) if eid_s else None

        rec: dict = {
            "file": p.name,
            "entity_id": eid,
            "bleu_vs_reference": None,
            "rougeL_f1_vs_reference": None,
            "reference_matched": bool(ref_text),
            "rougeL_f1_summary_vs_memo": None,
            "bleu_summary_vs_memo": None,
        }

        if ref_text and hyp:
            rec["bleu_vs_reference"] = round(bleu.sentence_score(hyp, [ref_text]).score, 4)
            rs = rouge.score(ref_text, hyp)
            rec["rougeL_f1_vs_reference"] = round(rs["rougeL"].fmeasure, 4)

        if hyp and memo:
            try:
                rs2 = rouge.score(memo, hyp)
                r2 = round(rs2["rougeL"].fmeasure, 4)
                rec["rougeL_f1_summary_vs_memo"] = r2
                rouge_pair.append(r2)
            except Exception:
                pass
            try:
                b2 = round(bleu.sentence_score(hyp, [memo]).score, 4)
                rec["bleu_summary_vs_memo"] = b2
                bleu_pair.append(b2)
            except Exception:
                pass

        rows.append(rec)

    def _mean(xs: list[float]) -> float | None:
        return round(statistics.mean(xs), 4) if xs else None

    def _stdev(xs: list[float]) -> float | None:
        return round(statistics.stdev(xs), 4) if len(xs) > 1 else None

    bleus_ref = [r["bleu_vs_reference"] for r in rows if r["bleu_vs_reference"] is not None]
    rouges_ref = [r["rougeL_f1_vs_reference"] for r in rows if r["rougeL_f1_vs_reference"] is not None]

    summary = {
        "reports_scanned": len(rows),
        "with_reference": sum(1 for r in rows if r["reference_matched"]),
        "mean_rougeL_summary_vs_memorandum": _mean(rouge_pair),
        "stdev_rougeL_summary_vs_memorandum": _stdev(rouge_pair),
        "mean_bleu_summary_vs_memorandum": _mean(bleu_pair),
        "mean_bleu_vs_reference": _mean([float(x) for x in bleus_ref]) if bleus_ref else None,
        "mean_rougeL_f1_vs_reference": _mean([float(x) for x in rouges_ref]) if rouges_ref else None,
        "per_file": rows,
        "notes": {
            "summary_vs_memo": "ROUGE-L / BLEU between gauge summary and memorandum (overlap diagnostic; not human gold).",
            "reference": "When references.jsonl is provided, BLEU/ROUGE compare gauge summary to your reference line per entity_id.",
            "excluded": "Per-file final_eval_accuracy_% and final_confidence from eval JSON are omitted from this report (misleading or constant).",
        },
    }
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {args.out}")
    print(
        f"Aggregate: rougeL_summary_vs_memo_mean={summary['mean_rougeL_summary_vs_memorandum']} "
        f"bleu_summary_vs_memo_mean={summary['mean_bleu_summary_vs_memorandum']}",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

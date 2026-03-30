# MetaDock Evaluation Guide

This document describes the `evals/` layout and which scripts/datasets correspond to internal evaluation results.

## Rule of thumb

- **tests/** – Engineering correctness (unit/integration). Run to verify the codebase.
- **evals/** – Experiment reproducibility. Run to reproduce reported metrics.

## evals/datasets/

| File | Purpose |
|------|--------|
| **rag_qa.jsonl** | Static QA dataset: one JSON object per line with `question`, `answer`, `evidence`. Used for RAG accuracy / groundedness. |
| **workflow_s1.json** | S1 Genome Assembly (e.g. SPAdes+QUAST) input config: data paths, optional expected thresholds. Used for workflow success rate and biology metrics. |

Add more datasets here (e.g. `workflow_s2.json`, `rag_qa_v2.jsonl`) as needed; document in this file which script uses them.

## evals/scripts/

| Script | Purpose | Output target |
|--------|--------|---------------|
| **run_rag_eval.py** | Offline RAG evaluation: load `rag_qa.jsonl`, run Adaptive RAG (or API), compute Accuracy / Groundedness. | `results/rag_eval.json` (recommended). |
| **run_workflow_eval.js** | Calls workflow run API (e.g. `/api/run-generic-workflow`) with config from `workflow_s1.json` (or other), collects Success Rate and biology metrics. | `results/workflow_eval.json` (recommended). |

## How to run

- **RAG eval:**  
  `python evals/scripts/run_rag_eval.py [--dataset evals/datasets/rag_qa.jsonl] [--output results/rag_eval.json]`  
  (Implement the eval loop and metrics inside the script as needed.)

- **Workflow eval:**  
  `node evals/scripts/run_workflow_eval.js [--config evals/datasets/workflow_s1.json]`  
  (Implement API call and metric aggregation; ensure `data_paths` in the config point to valid inputs. By convention, write output to `results/workflow_eval.json`.)

## Output convention (recommended)

Current repository does not include a fixed report/dashboard pipeline. Use this lightweight convention for now:

- `results/rag_eval.json` for RAG eval output
- `results/workflow_eval.json` for workflow eval output

Create `results/` on demand if it does not exist.

## Mapping to evaluation outputs

In this section, list explicitly which script + dataset produces which result, for example:

- **RAG benchmark summary:** `run_rag_eval.py` with `evals/datasets/rag_qa.jsonl` -> `results/rag_eval.json`.
- **S1 Genome Assembly success rate:** `run_workflow_eval.js` with `evals/datasets/workflow_s1.json` -> `results/workflow_eval.json`.

Update this mapping when you add new evaluation outputs.

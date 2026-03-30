# MetaDock Prompt Assets

Main prompt files live under `backend-agent/prompts/` as YAML.
Prompt loading is centralized in `backend-agent/prompt_loader.py` and consumed primarily by `core/adaptive_rag.py`.

## File overview

| File | Purpose | Used by |
|------|--------|--------|
| **routing.yaml** | Query routing: vectorstore vs web_search vs general_llm. System (structured + text) and human template. | `adaptive_rag._setup_prompts()` (route_prompt) |
| **grading.yaml** | Document relevance (`grade_document`), hallucination (`hallucination`), answer quality (`grade_answer`). Each with system_structured / system_text and human. | `adaptive_rag` (grade_prompt, hallucination_prompt, answer_prompt) |
| **rag_general.yaml** | Query rewrite, general LLM identity, web search, RAG context answer, title generation, title summarization. | `adaptive_rag` (rewrite, general, web_search, rag, title_generation, title_summarize) |
| **workflow_planning.yaml** | Workflow-planning prompt draft. | Currently not the primary planner path (core logic is in `core/workflow_planner.py`) |
| **viz_codegen.yaml** | Visualization codegen prompt template. | Current `bioinfo_agent.py` still includes inline prompt assembly in parts of viz flow |

## Schema (convention)

- Each YAML can have a header: `# version: 1.0`, `# last_updated: ...`, `# related_experiments: ...`.
- Blocks look like:
  - `system: "..."` and/or `system_structured` / `system_text` for routing/grading variants.
  - `human: "..."` with placeholders e.g. `{question}`, `{document}`, `{generation}`.

`prompt_loader.py` default behavior:

- Resolves prompt directory relative to itself (`backend-agent/prompts/`).
- Supports block loading by `subkey`.
- Supports dual-variant loading (`system_structured` and `system_text`) for grading/routing style prompts.

Example:

```yaml
routing:
  system_text: |
    You are a professional bioinformatics question routing expert...
  human: "{question}"
grade_answer:
  system_text: |
    You are an expert at evaluating answer quality...
  human: "User question: {question}\n\nAI Answer: {generation}"
```

## Mapping to evaluation experiments

When you report evaluation outputs, cite the prompt file and (if possible) line range so results are reproducible:

- **Query routing benchmark:** `routing.yaml` (routing block), version 1.0.
- **RAG accuracy / groundedness benchmark:** `grading.yaml` (grade_document, hallucination, grade_answer) and `rag_general.yaml` (rag block). Example note: "Benchmark uses routing_v1 + grading_v1 + rag_general_v1 prompts."

Update this section when you add new experiments or prompt versions.

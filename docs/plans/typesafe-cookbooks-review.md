# TypeSafe cookbooks → HAIP applicability review

**Date:** 2026-09-24  
**Scope:** HAIP (`apps/api`, related dashboard import) plus sister Remy / HAIP Cloud surfaces that share the operator AI path.  
**Method:** TypeSafe agent skill + [cookbooks index](https://docs.typesafe.ai/cookbooks) / [patterns](https://docs.typesafe.ai/patterns.md); code inventory of fragile semantic judgments (prompt-and-parse, keyword NLP, single-threshold autopilot, regex grounding).  
**Out of scope for this doc:** Implementing TypeSafe SDK calls. A parallel harden pass may land code changes separately — treat this as the cookbook map, not a merge plan for their branch.

## Verdict

HAIP’s core revenue/ops agents are correctly **deterministic**. TypeSafe does not replace occupancy math, z-scores, or folio rules. The fragile surfaces are where free text or “confidence” stands in for a typed judgment:

| Priority | Surface | Best cookbook / pattern |
| ---: | --- | --- |
| P0 | Review topic / sentiment → draft confidence → autopilot | [Hierarchical classification](https://docs.typesafe.ai/cookbooks/hierarchical_classification.md), [Classification using confidence](https://docs.typesafe.ai/cookbooks/classification_using_confidence.md), [Confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing.md) |
| P0 | Single autopilot confidence threshold for all agents | [Composite scoring](https://docs.typesafe.ai/patterns/composite-scoring.md) + confidence-gated routing (policy in code, per-agent gates) |
| P1 | `LlmService` ask-for-JSON + slice-and-parse | [Structure recovery](https://docs.typesafe.ai/cookbooks/autoformat.md), [Function calling](https://docs.typesafe.ai/cookbooks/function_calling.md) |
| P1 | Numeric grounding heuristic | Keep code-first; optionally [Citation check](https://docs.typesafe.ai/cookbooks/citation_check.md) / [LLM guardrails](https://docs.typesafe.ai/cookbooks/llm_guardrails.md) for claim↔number support — do not rush a model in front of a fail-closed regex |
| P1 | Remy domain router (JSON tool list) / Cloud channel coach (regex intents) | [Skill suggestion](https://docs.typesafe.ai/cookbooks/skill_suggestion.md), [Intent routing](https://docs.typesafe.ai/patterns/intent-routing.md), [Speculative fan-out](https://docs.typesafe.ai/patterns/fan-out.md) |
| P2 | Guest / OTA / CSV column matching | [Entity alignment](https://docs.typesafe.ai/cookbooks/entity_alignment.md), [Re-ranking](https://docs.typesafe.ai/cookbooks/rerank_typesafe.md) |
| P2 | Spec-only property dedup (`specs/4-2-…`) | Entity alignment (spec + playground first; no merge module yet) |
| Defer | Demand / pricing / overbooking / AR / HK math | Leave alone — composite scoring only if you split **semantic** risk axes from numeric EV |

## What to leave alone

- Deterministic agent engines under `apps/api/src/modules/agent/{demand,pricing,overbooking,channel-mix,cancellation,ar-collections,housekeeping,group-pickup,night-audit}/` for their **numeric** models.
- Night-audit z-score / rule predicates — confidence stamping is the weak part, not the math.
- Connect GPT Actions (`tools/haip-connect-gpt/`) — already a typed HTTP surface; Function calling is a product fit, not a fragility fix.
- Guest lifecycle email templates — intentional non-LLM.

---

## P0 — Review response NLP

**Code:** `apps/api/src/modules/agent/review-response/review-response.models.ts`

Today:

- `classifySentiment(rating)` ignores review text (stars only).
- `extractTopics` uses `TOPIC_KEYWORDS` + `lower.includes(kw)` (substring false positives: `"AC"`, `"bar"`).
- `generateResponseDraft` sets `confidence = 0.70 + topicCoverage * 0.20` — coverage of keyword hits, not draft quality.

**Cookbook fit**

| Cookbook / pattern | How it maps |
| --- | --- |
| Hierarchical classification | Topic tree (amenities → food/parking/wifi; room_quality → …) with parallel Choice / multi-Noul labels |
| Classification using confidence | Report fine topic only when Choice confidence is high; else parent category or “unclassified” |
| Citation check | After template assembly: does each addressed topic’s paragraph actually support what the guest wrote? |
| Self-consistency (nouls / choices) | Double-run sentiment/topics; disagree → human review before autopilot post |
| Confidence-gated routing | Autopilot posts only when topic + sentiment judgments clear a threshold; else draft stays pending |

**Suggested question shape (sketch — constants live in one file if implemented)**

- Per topic: Noul “does the guest discuss {topic}?” (multi-label; independent).
- Sentiment: Choice `positive | mixed | negative` over review text + rating as state.
- Draft gate: Score “safe to auto-publish” or Noul “draft addresses every high-urgency complaint.”

---

## P0 — Autopilot single threshold

**Code:** `apps/api/src/modules/agent/agent.service.ts` (`runAgent`)

```ts
const threshold = parseFloat(config.autopilotConfidenceThreshold ?? '0.85');
const shouldAutoExecute =
  config.mode === 'autopilot' && rec.confidence >= threshold;
```

One scalar gates pricing opens, review posts, night-audit notifications, AR chase, etc. Agent “confidence” values are not comparable (keyword coverage vs fixed `0.7` stamps vs calibrated cancel probability).

**Cookbook / pattern fit**

- **Composite scoring:** keep domain numbers in code; if you need a cross-agent gate, score independent axes (correctness risk, blast radius, reversibility) and combine weights in code — do not ask one model for “is this safe?”
- **Confidence-gated routing:** per-`agentType` thresholds and actions (execute / queue / notify) in policy code; TypeSafe only where the input is semantic (reviews, free-text coach).

**Do not** send occupancy/ADR payloads to TypeSafe to re-decide rates.

---

## P1 — HAIP AI explain (prompt-and-parse)

**Code:** `apps/api/src/modules/llm/llm.service.ts`

- System prompt demands `{"rationale","suggestions"}`.
- `parse()` slices first `{`…last `}` then `JSON.parse`.
- Fail-soft to `null` (good); still a classic prompt-and-parse fragility.

**Cookbook fit:** Structure recovery (recover block types / fields from messy model text) or replace the free-form explain path with Function calling–style closed fields. Prefer keeping Ollama for prose **after** structured fields are fixed, or skip model JSON entirely and template rationale from numbers.

---

## P1 — Grounding heuristic

**Code:** `apps/api/src/modules/llm/grounding.ts`

`significantNumbers` + `isSupported` are explicitly heuristic (sign via words, ratio↔percent, ≥25 bare integers). Structural win is already `numericPayload` (no free text in the prompt).

**Cookbook fit:** Citation check / LLM guardrails can judge “does this claim assert an unsupported figure?” when regex is ambiguous. Default recommendation: **extend unit tests and code rules first**; add TypeSafe only for residual cases you measure.

---

## P1 — Remy router & HAIP Cloud channel coach

**Sister repos (not in this tree, same product surface):**

| Surface | Path (sister) | Fragility |
| --- | --- | --- |
| Remy domain router | `remy/.../router/remy-router.ts` | LLM returns JSON domain array; recovered via `/\[[^\]]*\]/` — fail → full tool dump |
| Cloud channel coach | `haip-cloud/.../remyChannelCoach.js` | Regex intent (`status \| connect_cm \| ota_guide \| …`) — no calibrated confidence |

**Cookbook fit:** Skill suggestion (rank ≤1 domain / skill from a large catalog), Intent routing (Choice intent + Score complexity → code / wizard / human), Speculative fan-out (ask domain candidates + “needs guest tools?” in one call).

---

## P2 — Entity matching & import

| Surface | Path | Cookbook |
| --- | --- | --- |
| Guest find-or-create (exact email) | Connect / inbound reservation services | Entity alignment (name/phone soft match with Score + disagreement Nouls) |
| OTA source substring map | `review-ingest` utils (`includes('booking')` …) | Classification using confidence / Choice over closed source enum |
| Dashboard CSV headers | `apps/dashboard/src/pages/Import.tsx` | Entity alignment + Remy-style column mapper; Autoresearch only if you train on labeled exports |
| Property dedup | `specs/4-2-property-deduplication.yaml` only | Entity alignment playground questions; **spec-only** until product owns merge |

---

## P2 — Agent heuristic “confidence” stamps

Examples: night-audit fixed confidences; overbooking `confidence: 0.7`; connect insights `high|medium|low` labels; review draft coverage formula.

**Cookbook fit:** Classification using confidence + confidence-gated routing for **staff notify / autopilot**, not for replacing EV formulas. Composite scoring when multiple semantic dimensions (severity × novelty × guest impact) should drive rank.

---

## Cookbook index → HAIP cheat sheet

| TypeSafe cookbook / pattern | Applicable in HAIP? | First target |
| --- | --- | --- |
| Self-consistency (nouls / choices) | Yes | Review sentiment/topics before auto-post |
| Parallel questions | Yes | Review multi-topic Nouls; Remy speculative domains |
| Re-ranking | Later | Universal search / help corpus if semantic search ships |
| Line-by-line search | Later | Help / KB lookup |
| Structure recovery | Yes | `LlmService.parse`, Remy JSON scrapes |
| Function calling | Yes | Remy tools; Connect-shaped actions |
| Skill suggestion | Yes (Remy) | Domain / tool subset selection |
| Entity alignment | Yes | Guests, CSV columns, property dedup spec |
| Classifying RAG passages | Later | Help explain grounding |
| Citation check | Yes | Explain grounding; review draft↔guest text |
| LLM guardrails | Yes | In/out of HAIP AI explain; review auto-post |
| SDE cascade | Optional | Migration column / date fields |
| Date / pre-parsed value extraction | Optional | Import cells, channel free-text dates |
| Hierarchical classification | Yes | Review topics |
| Classification using confidence | Yes | Review, OTA source, autopilot gates |
| Autoresearch feature discovery | Later | Only with labeled outcomes |
| Speculative fan-out | Yes | Remy router; RM sub-signals if ever semantic |
| Confidence-gated routing | Yes | Autopilot + staff notify |
| Composite scoring | Yes (policy) | Cross-agent risk axes in code |
| Intent routing | Yes | Channel coach; future inbound guest messaging |

---

## Recommended sequence (analysis → product)

1. **Policy in code first:** per-agent autopilot thresholds / risk tiers (no API key required). Aligns confidence-gated routing pattern.
2. **Review topics + sentiment:** replace keyword/`includes` with typed questions; keep template assembly in code; gate auto-post on confidence.
3. **Remy / Cloud coach:** Intent routing + Skill suggestion — highest user-visible win for free text.
4. **Explain/grounding:** harden parse & tests; TypeSafe citation check only where regex false-flags.
5. **Entity alignment:** CSV + guest soft-match after review/router paths prove thresholds on real data.

Validate every threshold on hotel data. Cookbook numbers are examples, not merge policy.

## Related docs

- TypeSafe skill: https://docs.typesafe.ai/agent-skill.md  
- Cookbooks: https://docs.typesafe.ai/cookbooks.md  
- Patterns: https://docs.typesafe.ai/patterns.md  
- HAIP agent module: `apps/api/src/modules/agent/`  
- HAIP AI: `apps/api/src/modules/llm/`

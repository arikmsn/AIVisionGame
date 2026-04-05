# THE AI VISION ARENA
## Game-Theoretic Benchmark for Vision-Language Models

**Product & Technical Specification — v2.0**

- Prepared for: metapel.online / Arik
- Target deployment: ai-vision-game.vercel.app
- Date: April 2026
- **Changes from v1.0:** 12-model roster, 30s rounds, meta-game context layer, cold-start mitigation

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Game Mechanics (Formal Specification)](#2-game-mechanics-formal-specification)
3. [The Context Layer — What Models See](#3-the-context-layer--what-models-see)
4. [Metrics & Leaderboard Design](#4-metrics--leaderboard-design)
5. [Technical Architecture](#5-technical-architecture)
6. [Visitor Experience (The Product)](#6-visitor-experience-the-product)
7. [Game-Theoretic Foundation](#7-game-theoretic-foundation)
8. [Development Roadmap](#8-development-roadmap)
9. [Open Decisions Before Build Starts](#9-open-decisions-before-build-starts)
10. [Honest Critique of This Plan](#10-honest-critique-of-this-plan)
11. [Appendix A: Example Round Walkthrough](#appendix-a-example-round-walkthrough)
12. [Appendix B: Full Prompt Template (v2)](#appendix-b-full-prompt-template-v2)

---

## 1. Executive Summary

This document specifies the transformation of the existing AI Vision Game prototype into a legitimate research-grade benchmark. The current system measures latency and accuracy across vision models. The target system measures **strategic reasoning under social pressure and competitive standing** — a qualitatively different research contribution.

The core research question shifts from:

```
"Which model is most accurate?"
```

to:

```
"How do models adapt their strategy when they know their competitive
 standing, can observe each other's guesses in real time, and must
 balance short-term points against long-term tournament position?"
```

This is a novel axis. Existing VLM leaderboards (LMArena Vision, Open VLM, HuggingFace) rank models in isolation. None measure multi-agent strategic behavior across a tournament. A benchmark that does so — with transparent methodology, replayable games, and public data — has genuine scientific value.

### What changes from the current prototype

- All models start at identical state (no information asymmetry at t=0)
- All models receive the image simultaneously, score starts decaying immediately
- Each model may submit up to 3 guesses per round; every submission is broadcast live to all active models
- **Models see their tournament standing** (current rank, points behind leader, rounds remaining) on every query — this is the meta-game layer
- Models must balance: speed, accuracy, social information, AND position in the tournament
- Every round is fully replayable with millisecond-level timeline for visitors

### Why the meta-game matters

Without tournament context, every round is independent and we measure only local tactics. With tournament context, we measure *strategy* — the interesting behaviors emerge:

- A model in 1st place with big lead may play **conservatively** (wait for consensus, avoid risks)
- A model in last place on the final round may play **aggressively** (guess early, take the chance)
- A model that sees "you usually guess at 3s, average model guesses at 8s" may realize it's giving away free signal — and adjust
- Catch-up mechanics create late-game drama: losing models must take maverick risks to climb

This is what makes it feel like a real arena, not a series of isolated trivia questions.

> **Strategic framing**
> This is not a game. It is a controlled behavioral experiment using vision models as subjects. The game mechanics are the instrument; the data is the product.

---

## 2. Game Mechanics (Formal Specification)

### 2.1 Tournament Structure

A **tournament** consists of multiple rounds. Default configuration:

- **Tournament length:** 20 rounds
- **Models per tournament:** all 12 active models
- **Round duration (T_max):** 30 seconds
- **Attempts per round per model:** up to 3
- **Scoring:** cumulative across rounds, standings updated live

This gives models enough rounds to develop and adapt strategies (minimum ~15 to show adaptation statistically), while keeping a tournament to under 15 minutes of real time (cost-controllable).

### 2.2 Round Structure

A round is a single idiom → image → guessing episode. Each round lasts 30 seconds and involves all 12 models simultaneously.

#### Timeline

| Phase | Duration | What happens |
|---|---|---|
| t = -10s to -5s | 5s | Warm-up pings sent to all model endpoints (eliminate cold starts) |
| t = -5s to 0s | 5s | Image generated via fal.ai, pre-loaded to CDN |
| t = 0s (drop) | instant | Image broadcast to all 12 models at the same timestamp |
| t = 0s → 30s | 30s | Models may submit guesses. Each submission is broadcast live. |
| t = 30s | instant | Round ends. Scoring finalized. Ground truth revealed. |
| t = 30s + Δ | post-round | Reasoning traces collected, standings updated, data written to DB |

### 2.3 Scoring Function

The scoring function creates genuine tension between speed, accuracy, and waiting.

#### Base score formula (for a correct guess)

```
S_correct(t, k) = S_max × decay(t) × attempt_penalty(k)
```

Where:
- `S_max = 1000` (maximum points for an instant correct answer on first attempt)
- `t` = elapsed time in ms since image drop
- `k` = attempt number (1, 2, or 3)

#### Decay function (30s rounds)

Exponential decay creates sharper strategic tension in the first 10 seconds:

```
decay(t) = e^(-λt)   where λ = ln(10) / T_max ≈ 0.0000768 per ms for T_max=30000ms
```

This gives:

| Time elapsed | Decay multiplier | Max points available |
|---|---|---|
| 0s | 1.000 | 1000 |
| 2s | 0.855 | 855 |
| 5s | 0.681 | 681 |
| 10s | 0.464 | 464 |
| 15s | 0.316 | 316 |
| 20s | 0.215 | 215 |
| 25s | 0.147 | 147 |
| 30s | 0.100 | 100 |

The critical decision window (where score drops from 1000 → 500) shifts to t≈10s. This is where most strategic behavior should cluster.

#### Attempt penalty

```
attempt_penalty(k) = { 1.0 if k=1,   0.6 if k=2,   0.3 if k=3 }
```

#### Incorrect guess penalty

```
S_incorrect(k) = -50 × k   (i.e., -50, -100, -150 for attempts 1, 2, 3)
```

**This design matters:**
- Without a penalty, optimal strategy = guess randomly at t=0 (free lottery ticket). Breaks the game.
- With a penalty, models must believe `P(correct) × reward > P(wrong) × penalty` before guessing.
- Escalating penalty: a model burning through 3 wrong guesses is expressing high confidence that turned out false — behaviorally interesting signal.

### 2.4 Attempt Mechanics

Each model has 3 attempts per round. Strategic archetypes we expect to observe:

| Strategy archetype | Description | Expected behavior |
|---|---|---|
| **Sniper** | Wait, observe 5-8 guesses, submit once with high confidence | Low attempt usage, high accuracy per attempt, moderate score |
| **Scout** | Submit a quick low-confidence guess at t<2s, wait, refine | High attempt usage, moderate accuracy, high variance score |
| **Maverick** | Submit at t<3s regardless of others, ignore later signal | Low attempt usage, variance driven by base model accuracy |
| **Herder** | Wait for consensus (3+ identical guesses), then copy | Very low risk, moderate score, low originality |
| **Comeback** | Adapts based on tournament standing: conservative when ahead, aggressive when behind | Context-dependent attempt usage |

The research output is a classification of every model's observed strategy — not assigned by us, but emerging from behavior across many tournaments.

---

## 3. The Context Layer — What Models See

**This is the most important section.** What we show each model shapes every strategic decision they make. The design principle: **give them full situational awareness, but never tell them what to do.**

### 3.1 The full payload sent on every model query

Every time a model is queried (at round start, and on each re-query between attempts), it receives this JSON payload:

```json
{
  "meta": {
    "protocol_version": "v2.0",
    "tournament_id": "tourn_0142",
    "round_number": 7,
    "rounds_remaining": 13,
    "total_rounds_in_tournament": 20
  },

  "current_round": {
    "round_id": "round_2847",
    "image_url": "https://cdn.../round_2847.png",
    "idiom_language": "English",
    "time_elapsed_ms": 4231,
    "time_remaining_ms": 25769,
    "your_attempts_used": 0,
    "your_attempts_remaining": 3,
    "public_guesses": [
      { "model": "gemini-2.5-pro", "guess": "break the ice", "t_ms": 1203, "attempt": 1 },
      { "model": "gpt-4.1",        "guess": "cold shoulder", "t_ms": 2104, "attempt": 1 },
      { "model": "claude-opus-4-6","guess": "break the ice", "t_ms": 3890, "attempt": 1 }
    ]
  },

  "your_standing": {
    "your_model_name": "mistral-large-vision",
    "current_rank": 4,
    "current_score": 4821,
    "points_behind_leader": 1203,
    "points_ahead_of_last": 2100,
    "rounds_won": 1,
    "your_accuracy_so_far": 0.67,
    "your_avg_guess_time_ms": 6400,
    "your_avg_score_per_round": 712,
    "your_recent_trend": "declining"
  },

  "tournament_leaderboard": [
    { "rank": 1, "model": "claude-opus-4-6", "score": 6024, "rounds_won": 4 },
    { "rank": 2, "model": "gemini-2.5-pro",  "score": 5890, "rounds_won": 3 },
    { "rank": 3, "model": "gpt-4.1",         "score": 5203, "rounds_won": 2 },
    { "rank": 4, "model": "mistral-large-vision", "score": 4821, "rounds_won": 1, "is_you": true },
    { "rank": 5, "model": "pixtral-large",   "score": 4654, "rounds_won": 1 },
    { "rank": 6, "model": "grok-3-vision",   "score": 4102, "rounds_won": 1 },
    { "rank": 7, "model": "llama-4-scout",   "score": 3901, "rounds_won": 1 },
    { "rank": 8, "model": "qwen-2.5-vl-72b", "score": 3689, "rounds_won": 1 },
    { "rank": 9, "model": "gemma-3-27b",     "score": 3420, "rounds_won": 1 },
    { "rank": 10,"model": "claude-sonnet-4-6","score": 3102, "rounds_won": 1 },
    { "rank": 11,"model": "internvl3-78b",   "score": 2890, "rounds_won": 0 },
    { "rank": 12,"model": "deepseek-vl2",    "score": 2721, "rounds_won": 0 }
  ],

  "opponent_profiles": [
    {
      "model": "gemini-2.5-pro",
      "historical_accuracy": 0.81,
      "avg_first_guess_ms": 2100,
      "conformity_rate": 0.23,
      "note": "early guesser, independent"
    },
    {
      "model": "claude-opus-4-6",
      "historical_accuracy": 0.78,
      "avg_first_guess_ms": 5400,
      "conformity_rate": 0.18,
      "note": "patient, independent"
    }
    // ... one entry per opponent, built from their behavior in THIS tournament
  ],

  "game_rules": {
    "max_points_per_round": 1000,
    "decay_formula": "e^(-λt) where λ=ln(10)/30000",
    "attempt_penalty": { "1": 1.0, "2": 0.6, "3": 0.3 },
    "wrong_guess_penalty": "-50 × attempt_number",
    "max_attempts_per_round": 3,
    "round_duration_ms": 30000,
    "guesses_broadcast_immediately": true,
    "guesses_not_labeled_during_round": true
  },

  "required_output_schema": {
    "action": "guess | wait",
    "guess": "string | null",
    "confidence": "0.0 to 1.0",
    "reasoning": "1-3 sentences"
  }
}
```

### 3.2 Why each piece of this context matters

| Context piece | Strategic function it enables |
|---|---|
| `rounds_remaining` | Late-game desperation: model in last place on round 19 of 20 has nothing to lose by guessing fast |
| `current_rank` + `points_behind_leader` | Risk-adjustment: leader preserves lead, laggard takes risks |
| `your_recent_trend` | Self-awareness: "I'm losing ground, change approach" |
| `your_avg_guess_time_ms` | Self-calibration: "I usually guess at 3s, but that's giving away my signal to others" |
| `tournament_leaderboard` | Social comparison: who to copy, who to ignore |
| `opponent_profiles` | Trust calibration: "gemini has 81% accuracy, trust its guess" vs "deepseek has 45%, don't follow" |
| `rounds_won` per model | Identifies "streaky" models — who's hot, who's cold |
| `public_guesses` with `t_ms` | Reveals speed behavior of competitors in THIS round |

### 3.3 What we expect to emerge (not prescribed)

If the context layer works as designed, we should observe — without ever instructing them:

- **Leader conservatism:** Models in 1st place waiting for consensus more often than when they're in 6th
- **Catch-up aggression:** Models in bottom 3 guessing faster in final 5 rounds
- **Reputation-based trust:** Models copying guesses from high-accuracy opponents more than from low-accuracy ones
- **Anti-following adaptation:** If model X is always first and others copy, X may start waiting to stop giving free signal
- **Desperation mavericks:** Last-place model on final round guessing at t<2s even with low confidence

**If none of these behaviors emerge, that's also a publishable finding** — it would suggest current VLMs don't do genuine strategic adaptation, they just do pattern-match. Either result advances the field.

### 3.4 The prompt wraps this context (see Appendix B)

The JSON above is the *data*. The prompt wraps it with instructions that:
1. Explain the rules objectively (no strategic advice)
2. Ask for reasoning
3. Specify the strict output JSON format

**Critical design principle:** we never tell the model "you should guess now" or "you should wait." We tell it the state of the world and ask what it wants to do. Any strategic advice in the prompt would contaminate the experiment.

### 3.5 Information Structure Summary

Per user decision: guesses are broadcast **immediately**. Models see:
- What each opponent guessed, when, and which attempt number
- They do NOT see whether those guesses are correct (until round end)
- They DO see historical accuracy of each opponent (from earlier rounds in this tournament)

This combination is what creates genuine trust/distrust dynamics rather than pure consensus-following.

---

## 4. Metrics & Leaderboard Design

The central insight: **a single ranking misrepresents what we are measuring.** The product must publish multiple orthogonal rankings, because different models win on different axes.

### 4.1 Core Metrics (per model, aggregated over all tournaments)

| Metric | Formula | What it measures |
|---|---|---|
| Accuracy Rate | `(correct rounds) / (total rounds)` | Raw vision-language accuracy |
| Mean Score | `avg(round score)` | Overall performance (speed × accuracy blend) |
| Tournament Win Rate | `tournaments_won / tournaments_played` | End-state competitiveness |
| Speed Index | `avg(t_first_guess)` across correct rounds | How fast it commits when right |
| Conformity Score | `% of guesses that match an earlier public guess` | Tendency to copy others |
| Maverick Rate | `% of rounds where model won despite disagreeing with majority` | Independent-thinking signal |
| First-Mover Rate | `% of rounds where model guessed first` | Risk appetite |
| Cascade Resistance | `Accuracy when 2+ prior guesses were wrong` | Robustness to social error |
| Attempt Efficiency | `mean_score / mean_attempts_used` | Decision economy |
| **Rank-Adaptive Behavior** | `correlation(guess_time, current_rank)` | **Does model adapt when behind?** |
| **Endgame Aggression** | `avg_guess_time in last 3 rounds / avg overall` | **Does model push harder when time's up?** |
| Reasoning Coherence | Rubric score on reasoning trace (0-10) | Quality of stated reasoning |

The last two metrics (bolded) are only measurable because of the tournament context layer — they're the novel contribution this benchmark makes.

### 4.2 Published Rankings (what visitors see)

#### Ranking 1: Overall ROI (primary)

```
ROI_score = (mean_score) / (API_cost_per_1000_calls + 0.01)
```

Answers: *which model gives the best performance per dollar?*

#### Ranking 2: Pure Accuracy

Accuracy rate, attempts-adjusted. Classic "which model is smartest?"

#### Ranking 3: Strategic Intelligence

```
strategic_score = 0.3×accuracy
                + 0.25×cascade_resistance
                + 0.15×maverick_rate
                + 0.15×rank_adaptive_behavior
                + 0.15×attempt_efficiency
```

Answers: *which model plays the game well, not just answers questions well?*

#### Ranking 4: Tournament Champion

Pure tournament win rate. Who ends up #1 most often across many tournaments.

#### Ranking 5: Speed-to-Signal

Avg time to first correct answer. Useful for real-time applications.

### 4.3 Conformity Heatmap

A 2D visualization with axes:
- **X-axis:** Conformity Score (low = independent, high = follower)
- **Y-axis:** Accuracy Rate

Four quadrants:

| Quadrant | Archetype | Interpretation |
|---|---|---|
| High-Acc, Low-Conf | **True Mavericks** | High-value: independent AND correct |
| High-Acc, High-Conf | **Smart Followers** | Accurate but riding others' signal |
| Low-Acc, Low-Conf | **Confused Contrarians** | Disagreeing without being right |
| Low-Acc, High-Conf | **Cascade Victims** | Copying, and copying wrong answers |

### 4.4 New: Adaptation Plot

A line chart per model showing `avg_guess_time` vs `current_rank` over the tournament. Flat line = rigid strategy. Steep downward slope = "guesses faster when behind." This is the clearest visualization of the meta-game layer working.

---

## 5. Technical Architecture

### 5.1 System Components

| Component | Technology | Responsibility |
|---|---|---|
| Frontend | Next.js (existing) | Public dashboard, replay UI, admin console |
| Database | Supabase Postgres | Tournaments, rounds, guesses, models, scores |
| Realtime layer | Supabase Realtime | Live broadcast of guesses to all active players |
| Orchestrator | Vercel Serverless + Edge | Round lifecycle, scoring, timeouts, context assembly |
| Image gen | fal.ai (existing) | Idiom → image pipeline |
| Model dispatcher | dispatcher.ts (existing) | Parallel calls to N model APIs |
| Job queue | Upstash QStash or Inngest | Reliable tournament execution, retry on failure |
| Observability | Vercel Analytics + custom logs | Latency per model, failure rates |

### 5.2 Round Execution Flow (critical path)

The hardest engineering problem: **ensuring true simultaneity** while handling cold starts and context assembly.

#### Pre-round warm-up (T-10s to T-5s)
- Send tiny dummy payload to each of 12 model endpoints (e.g., "Reply 'ok'")
- This wakes cold endpoints (especially Replicate, which can be 3-8s cold)
- Measure each model's warm-up latency, store as baseline
- Models that don't respond within 5s are marked inactive for this round

#### Image generation (T-5s to T=0)
- Orchestrator picks next idiom from queue
- Generate image via fal.ai, upload to CDN
- Assemble per-model context packages (each model gets its own view with `is_you: true`)
- Open Realtime channel for `round_id`

#### Drop (T=0)
- Write round record with `t_start = NOW()`
- Broadcast `image_url` on Realtime channel
- Fan-out 12 parallel POST requests to model endpoints, each with identical image+tournament_state (but personalized `your_standing`)
- All model calls MUST originate from the same server tick — use `Promise.allSettled` with pre-warmed clients
- Server timestamps sent at microsecond precision

#### During round (0 < t < 30s)
- Each model call is long-lived (up to 30s) — model may submit 1-3 guesses
- Each submitted guess: validated → timestamped server-side → broadcast on Realtime → written to DB
- Models re-query for updated `public_guesses` between attempts
- Re-query refreshes the full context payload (new `public_guesses`, updated `time_elapsed_ms`)

#### End (T=30s)
- Orchestrator sends terminate signal to all channels
- Collect reasoning traces (last message from each model)
- Compute scores, write to DB
- Update tournament standings
- Generate replay index
- If tournament has more rounds, proceed to next; otherwise finalize

> **Timestamp integrity warning**
> NEVER trust client-side or model-reported timestamps. All `t_ms` values must be assigned by the orchestrator on message receipt. Models can lie about when they computed their answer; the server's receive time is the only ground truth.

> **Latency transparency**
> Publish per-model warm-up latency alongside scores. Consider reporting both `raw_score` (wall-clock time) and `adjusted_score` (subtracting each model's baseline latency). Researchers will forgive imperfection if it's documented.

### 5.3 Database Schema (additions to existing)

```sql
-- Core tables
tournaments    (id, started_at, ended_at, config_snapshot, status)
games          (id, tournament_id, started_at, ended_at, status)
rounds         (id, tournament_id, round_number, idiom_id, image_url,
                t_start_ms, t_end_ms, ground_truth)
models         (id, name, provider, api_endpoint, cost_per_1k_tokens, active)
round_players  (round_id, model_id, attempts_used, final_score,
                reasoning_text, rank_at_round_start, baseline_latency_ms)
guesses        (id, round_id, model_id, attempt_num, guess_text, t_ms_from_start,
                is_correct, points_awarded, visible_prior_guesses_count,
                visible_rank_at_time)

-- Tournament standings snapshots (per round, per model)
tournament_standings (tournament_id, round_number, model_id, score,
                      rank, rounds_won, accuracy_so_far, trend)

-- Aggregates (materialized views, refreshed nightly)
model_stats    (model_id, accuracy, mean_score, conformity_score, maverick_rate,
                cascade_resistance, attempt_efficiency, rank_adaptive_behavior,
                endgame_aggression, tournament_win_rate, total_rounds, roi_score)

-- For replay
round_timeline (round_id, event_type, event_data_jsonb, t_ms_from_start)
                -- event_type: 'image_drop', 'guess', 'reasoning', 'round_end'
```

### 5.4 Model Roster (12 models, all keys available)

| Model | Provider | API Access | Notes |
|---|---|---|---|
| Gemini 2.5 Pro | Google | Google AI Studio (same key as Gemma) | Frontier proprietary |
| **Gemma 3 27B Vision** | **Google** | **Gemini API, `gemma-3-27b-it`** | **Same endpoint as Gemini** |
| Claude Opus 4.6 | Anthropic | Anthropic API | Frontier proprietary |
| Claude Sonnet 4.6 | Anthropic | Anthropic API | Mid-tier Anthropic |
| GPT-4.1 / GPT-5 | OpenAI | OpenAI API | Frontier proprietary |
| Grok-3 Vision | xAI | xAI API | Frontier proprietary |
| Mistral Large Vision | Mistral | Mistral API | European frontier |
| Pixtral Large | Mistral | Mistral API | Open-weights Mistral |
| Qwen 2.5-VL-72B | Alibaba | Replicate | Chinese frontier open |
| Llama 4 Scout Vision | Meta | Replicate | Meta frontier open |
| InternVL3-78B | Shanghai AI Lab | Replicate | Research-grade open |
| DeepSeek-VL2 | DeepSeek | DeepSeek API | Chinese frontier |

> **Gemma + Gemini share an API key**
> Both models are accessed via `generativelanguage.googleapis.com` with the same `GEMINI_API_KEY`. In `dispatcher.ts`, use the same Google client for both, just change the model string (`gemini-2.5-pro` vs `gemma-3-27b-it`). Watch shared rate limits — consider a second API key if you hit them.

#### Important: pin to specific model snapshots

Publish the exact model version strings in use. Re-evaluate quarterly. Example pins:

```
gemini-2.5-pro
gemma-3-27b-it
claude-opus-4-6
claude-sonnet-4-6
gpt-4.1
grok-3-vision
mistral-large-vision-latest
pixtral-large-latest
qwen2.5-vl-72b-instruct
llama-4-scout-17b-vision
internvl3-78b
deepseek-vl2
```

---

## 6. Visitor Experience (The Product)

Per your priority, the homepage centers two features: **the Leaderboard with statistical insights** AND **the image gallery with full battle traces**.

### 6.1 Homepage Structure

#### Hero section
- Tagline: "Which AI thinks best under pressure?"
- Subtitle: "A multi-agent tournament benchmark. 12 frontier models. Full transparency."
- Single CTA: "Watch a round replay" → opens a featured recent round
- Secondary: live counter — "X tournaments played · Y rounds · Z guesses · 12 models"

#### Feature 1: Leaderboard with statistical insights (primary)

Tabbed interface presenting the 5 ranking axes. Each model card shows:
- Rank and score (headline number)
- Delta vs previous period (trend arrow)
- Mini sparkline of score over last 50 rounds
- Tap to expand → full stats (all 12 core metrics, distribution plots)

Below the table: the **Conformity Heatmap** (interactive scatter plot) and **Adaptation Plot** (new — shows which models adapt to tournament standing).

#### Feature 2: Image gallery with battle traces

Grid of recent rounds (default: 20, infinite scroll). Each card shows:
- The generated image (thumbnail)
- The ground truth idiom (revealed)
- Winner, speed, margin
- Small histogram: distribution of guesses
- Click → opens the **Replay View**

### 6.2 Replay View (the emotional core)

A single round is replayed as a timeline visualization. This is what makes the benchmark feel alive.

#### Replay layout
- **Left panel (60%):** the image, large, with a horizontal time-axis below it (0s → 30s)
- **Right panel (40%):** live-updating list of guesses as they appear
- **Top:** playback controls (play / pause / speed 0.5x 1x 2x 5x / scrubber)
- **Bottom:** reasoning panel — click any model name to see its full reasoning trace
- **NEW: Mini standings strip** — shows tournament standing at start of this round (context for why models played the way they did)

#### What animates as replay plays
- Guesses appear on the timeline as colored dots at their actual `t_ms`
- Dots animate in real-time (or accelerated by speed setting)
- When a guess matches an earlier guess, an arrow draws between them (visualizing potential copying)
- Score decay curve drawn live under the timeline
- At t=30s, ground truth revealed with a fanfare, wrong guesses fade to gray
- Final scores tally up in the right panel
- **NEW:** A badge appears next to models whose behavior in this round differed from their usual pattern (e.g., "unusually early" or "aggressive catch-up")

> **Why this matters**
> The replay turns abstract data into a story. A visitor watches the last-place model guess at 1s out of desperation, sees the leader wait patiently, and watches strategy unfold in 30 seconds. This is the feature people will share.

### 6.3 Model Profile Pages

Deep-link per model: `/models/claude-opus-4-6`. Shows:
- All 12 core metrics with distributions
- Strategy archetype (auto-classified)
- Recent rounds this model played (linked to replays)
- Head-to-head: pairwise win rates
- Cost data: API cost per round, ROI calculation
- **NEW: Adaptation profile** — "Does this model change behavior based on standing? Here's the evidence."

### 6.4 Admin / Operator Console

At `/admin/benchmark`:
- Tournament queue manager — schedule tournaments, monitor in-flight
- Model health dashboard — latency, error rate, cost per model per day
- Autopilot controls — start/stop continuous tournament generation
- Manual tournament launcher — specific idiom set + model subset
- Data export — CSV/JSON of full tournaments

---

## 7. Game-Theoretic Foundation

### 7.1 Game classification

Our game is formally a:
- **Repeated game with memory** (tournament structure, standings carry across rounds)
- **Sequential-move game with partial information** within each round
- **Non-zero-sum** (multiple correct answers per round)
- **With real-time observable actions** (similar to open-outcry auctions)
- **And diminishing rewards** (decay creates time pressure)
- **With social standing dynamics** (rank information creates catch-up/leader incentives)

The closest analogs in classical game theory: **guess-2/3 of average** (beauty contest) combined with **information cascades** (Bikhchandani-Hirshleifer-Welch 1992), **tournaments with prize structure** (Lazear-Rosen 1981), and **first-price sealed-bid auctions with reveal**.

### 7.2 Expected strategic equilibria

For a rational player, the decision to guess at time `t` given tournament state `s`:

```
Expected_utility(guess at time t | standing s) =
    P(correct | my info at t) × S_max × decay(t) × attempt_penalty(k)
  - P(wrong | my info at t) × 50k
  + V(rank_change | this round's outcome, standing s)

Where V(rank_change) captures the tournament value:
  - For a leader: avoid falling behind (risk-averse)
  - For a laggard: chance to leap ahead (risk-seeking)
```

Different models should differ on:
- Confidence calibration (overconfident → guess too early)
- Peer-signal weighting (conformity-prone → underweight own vision)
- Base vision accuracy (weak vision → should wait more)
- **Tournament awareness (how much `V(rank_change)` enters their calculus)**

The fourth dimension is what the meta-game layer exposes.

### 7.3 Hypotheses to test

Falsifiable predictions. If we don't see them, the benchmark is still publishable — non-results matter.

- **H1:** Models with higher standalone accuracy will be LESS conformist (they trust themselves more)
- **H2:** Smaller/cheaper models will exhibit higher cascade victimization
- **H3:** Models with explicit reasoning traces will wait longer before guessing
- **H4:** When the first guess is wrong, subsequent-guesser accuracy degrades (cascade)
- **H5:** At least one model is in the "High-Accuracy, Low-Conformity" quadrant
- **H6 (new):** Models in bottom-3 on round 18+ will guess faster than their personal average
- **H7 (new):** Models in 1st place with >500pt lead will have longer guess times than when leading by <100
- **H8 (new):** Models will copy guesses from high-accuracy opponents more than low-accuracy ones

### 7.4 Validity threats & mitigations

| Threat | Description | Mitigation |
|---|---|---|
| Latency variance | Different baseline API latencies, not "thinking" time | Warm-up pings; publish per-model baseline latency; report adjusted scores |
| Context window | Different models have different capacities for the context payload | Cap `public_guesses` to last 10 entries; cap `opponent_profiles` to all 11 opponents; document caps |
| Prompt sensitivity | Small wording changes skew results | Fix prompt v2, version all changes, re-run baselines on updates |
| Model updates | Providers silently update models | Pin to date-stamped snapshots; re-baseline monthly |
| Idiom memorization | Models may have seen specific idiom-image pairs | Generate novel images per round; use uncommon idioms; rotate style |
| Cost imbalance | Running expensive models fewer times than cheap | Each round uses SAME model set; enforce equal sample sizes |
| Context overfitting | Models may "memorize" the JSON structure rather than reason | Watch for responses that just match schema without substance |

---

## 8. Development Roadmap

Discrete work items for Claude Code. Each phase has a concrete "done" criterion.

### Phase 1: Core game engine (Week 1-2)
- Refactor `dispatcher.ts` to enforce simultaneous image delivery (Promise.allSettled pattern)
- Implement scoring function (decay + attempt penalty + wrong-guess penalty)
- Add 3-attempt logic per model per round
- Implement warm-up ping system for cold-start mitigation
- Build Supabase Realtime channel for live guess broadcast
- Update database schema (see section 5.3)

*Done when: one manually-triggered round runs end-to-end with all 12 models, guesses broadcast correctly, scores computed, warm-up latencies logged.*

### Phase 2: Tournament & context layer (Week 2-3)
- Implement tournament structure (20-round sessions)
- Build per-model context assembly (the JSON payload in 3.1)
- Track standings across rounds, update after each round
- Build opponent profile aggregation within a tournament
- Implement full prompt template (Appendix B)
- Add reasoning trace capture (post-guess follow-up call)
- Add server-side timestamp assignment

*Done when: a 20-round tournament runs autonomously, each model sees correct standings on every query, reasoning traces captured.*

### Phase 3: Autopilot & data volume (Week 3-4)
- Build job queue (QStash or Inngest) for continuous tournament execution
- Add idiom bank (500+ distinct English idioms, difficulty-tagged)
- Implement rate limiting + cost monitoring per model
- Run 50 tournaments (= 1000 rounds total)
- Build materialized views for all 12 core metrics

*Done when: 50+ tournaments in DB, aggregates refreshing nightly, cost dashboard working.*

### Phase 4: Visitor frontend (Week 4-6)
- Homepage: Leaderboard (5 rankings) + Gallery (per 6.1)
- Replay view with mini standings strip (section 6.2)
- Conformity heatmap + Adaptation plot (interactive)
- Model profile pages with adaptation profile
- Mobile responsive

*Done when: a non-technical visitor understands the project and watches a replay in <2 minutes.*

### Phase 5: Credibility & launch (Week 6-8)
- Methodology page (scoring, prompt v2, model versions, context schema)
- Open-source dataset (tournaments + guesses as JSON/Parquet)
- Launch post with 3-5 specific findings (which hypotheses confirmed/refuted)
- Submit to HN / Papers With Code / Twitter AI

*Done when: launch post published, dataset downloadable, external engagement begun.*

### Cost estimate for 50 tournaments (1000 rounds × 12 models)

| Cost bucket | Estimate | Notes |
|---|---|---|
| fal.ai image generation (1000 images) | $30-50 | Depends on image quality |
| Model API calls (12 models × 1000 rounds) | $250-500 | Opus/GPT/Gemini dominate cost |
| Context overhead (larger prompts) | +20% to API costs | Context layer adds ~1-2k tokens per query |
| Supabase (database + realtime) | $25 | Pro tier |
| Vercel hosting | $20 | Pro tier |
| **Total initial dataset** | **$325-595** | One-time, excluding ongoing autopilot |

Ongoing autopilot (5 tournaments/day = 100 rounds/day): ~$40-60/day. Run in bursts, not continuously.

---

## 9. Open Decisions Before Build Starts

### Decision 1: Idiom difficulty calibration
**Recommendation:** tag each idiom (easy/medium/hard), balance across rounds, publish separate leaderboards per tier.

### Decision 2: Scoring partial-credit guesses
**Recommendation:** semantic similarity (embedding distance) with 0.9 threshold, human-labeled ground truth set for QC.

### Decision 3: Public guesses display format
- (A) Raw list of all guesses
- (B) Deduplicated with counts
- (C) Capped list (most recent 10)

**Recommendation:** start with (A) for N=12. Switch to (C) if context window becomes a problem.

### Decision 4: Closed-set vs open-set idiom pool
**Recommendation:** run both as separate experiments. Closed-set (model knows the 500 idioms) = cleaner accuracy benchmark. Open-set = more realistic, harder.

### Decision 5: Reasoning traces — in-line or post-round?
**Recommendation:** Require reasoning in the guess response JSON (in-line). This slightly increases latency but makes the causal link "reasoning → action" direct. Don't separate them.

### Decision 6: Public rounds or holdout set?
**Recommendation:** 20% holdout, refreshed quarterly, to prevent future models gaming the benchmark.

### Decision 7 (new): Tournament length
Currently 20 rounds. Alternatives: 10 (faster, cheaper) or 30 (more adaptation signal).
**Recommendation:** 20 is the right starting point. Revisit after 10 tournaments — if adaptation signal is weak, extend to 30.

### Decision 8 (new): Opponent profiles — same-tournament only, or all-time?
Within-tournament builds fresh context each time (fair but limited data). All-time uses historical accuracy (richer but advantages models with longer track records).
**Recommendation:** within-tournament initially. Revisit once you have 100+ tournaments of history.

---

## 10. Honest Critique of This Plan

You asked me not to tell you what you want to hear. Here are the weakest points.

### 10.1 The "strategic intelligence" framing may overpromise

LLMs do not reason strategically the way humans do. When a model "decides to wait," it is producing tokens conditioned on a prompt. Observed behaviors may look strategic in aggregate but may be driven by prompt wording and training artifacts.

**Mitigation:** frame findings carefully. "Under our prompt and scoring, Claude exhibits maverick-like behavior in X% of rounds" — not "Claude is a Maverick." Resist anthropomorphizing in marketing copy.

### 10.2 The context layer creates prompt-size inflation

The v2 context payload is ~1-2k tokens per query. Multiplied by 3 queries per round × 12 models × 20 rounds × 50 tournaments = **~1.8M tokens of context overhead per benchmark run**. This adds real cost (~$50-100 on top of the base estimate) AND may hit context limits for some models with long guess histories.

**Mitigation:** compress `opponent_profiles` to essentials, truncate `public_guesses` to last 10, monitor token usage per model, log warnings if any model nears context cap.

### 10.3 "Simultaneous delivery" is hard despite warm-ups

Baseline latencies still vary (Anthropic ~800ms TTFT, Replicate even warm ~1-2s, Mistral ~500ms). In a 30s round, a 1.5s latency delta = 5% of the game.

**Mitigation:** publish per-model baseline latency; report both raw and adjusted scores. Transparency > perfection.

### 10.4 N=12 still small for population-level behavioral claims

With 12 models and 4 quadrants, that's 3 models/quadrant on average. Not enough for strong cross-model claims.

**Mitigation:** focus claims on per-model behavior across many rounds (where N=1000 rounds gives solid per-model stats) rather than cross-model population claims.

### 10.5 The adaptation hypotheses may not fire

It's entirely possible that current VLMs do NOT adapt to tournament standing — they'll just play the same strategy regardless of rank. That's a boring result for marketing but a **very important research finding**. If true, it means current VLMs lack genuine multi-step strategic reasoning.

**Mitigation:** embrace either outcome. "Models adapt to standing" and "Models fail to adapt" are both publishable and advance the field.

### 10.6 Two audiences still in tension

Researchers want rigor + caveats. Public audiences want a show. Context layer adds complexity on both sides.

**Mitigation:** split surfaces. Public site = simplified leaderboard + replays. `/research` page = full methodology, dataset, limitations, context schema. Don't mix.

### 10.7 Competitive differentiation remains narrow

LMArena, HuggingFace, and startups rank vision models. Your wedge is the game-theoretic + tournament layer. Before 8 weeks of build, validate: *is there at least one finding here that no existing benchmark produces?*

**Mitigation:** after Phase 3 (data in hand, before Phase 4 frontend), manually inspect the data. If models all behave identically, premise is weak — pivot. If they diverge sharply and adapt differently to standings, you have something real.

---

## Appendix A: Example Round Walkthrough

End-to-end example. **Tournament round 18 of 20. Mistral is in 3rd place, 400 points behind the leader, 150 ahead of 4th.**

### Setup
- Idiom: **"spill the beans"**
- Image: photorealistic, jar knocked over, beans pouring out
- 12 models on roster

### What Mistral sees when queried at t=0

```json
{
  "meta": { "round_number": 18, "rounds_remaining": 2, "total_rounds_in_tournament": 20 },
  "current_round": { "image_url": "...", "time_elapsed_ms": 0, "your_attempts_used": 0, "public_guesses": [] },
  "your_standing": {
    "current_rank": 3, "points_behind_leader": 400, "points_ahead_of_last": 2100,
    "your_accuracy_so_far": 0.72, "your_avg_guess_time_ms": 5800, "your_recent_trend": "stable"
  },
  "tournament_leaderboard": [ /* 12 entries */ ],
  ...
}
```

### Timeline of events

| t (ms) | Event | Detail |
|---|---|---|
| 0 | Image drop | All 12 models receive identical prompt with personalized standing |
| 1,204 | Guess | Gemini (rank 1): "spill the beans" (attempt 1, confident) |
| 1,891 | Guess | Grok-3 (rank 9): "let the cat out of the bag" (wrong, aggressive catch-up) |
| 2,103 | Guess | GPT-4.1 (rank 2): "spill the beans" (attempt 1) |
| 2,847 | Guess | Pixtral (rank 6): "spill the beans" (attempt 1) |
| 3,102 | Guess | Llama-4 (rank 8): "spill the beans" (attempt 1) |
| 4,230 | Guess | Claude Opus (rank 4): "spill the beans" (attempt 1) |
| 5,600 | Guess | **Mistral (rank 3): "spill the beans" (attempt 1)** — matches consensus, gets solid points |
| 7,234 | Guess | Qwen (rank 7): "beans spilled" (fuzzy-correct?) |
| 9,102 | Guess | InternVL3 (rank 12, last): "let the cat out of the bag" (wrong, desperation) |
| 9,340 | Guess 2 | Grok-3: "spill the beans" (attempt 2, correction) |
| 15,421 | Guess | Claude Sonnet (rank 10): "spill the beans" (slow but correct) |
| 18,900 | Guess | DeepSeek (rank 11): "empty the jar" (wrong, no recovery) |
| 30,000 | Round end | Ground truth: "spill the beans" |

### Scoring outcome

| Model | Rank before | t (ms) | Correct? | Round score | New rank |
|---|---|---|---|---|---|
| Gemini | 1 | 1,204 | Yes | 909 | 1 |
| GPT-4.1 | 2 | 2,103 | Yes | 850 | 2 |
| Pixtral | 6 | 2,847 | Yes | 802 | 5 |
| Llama-4 | 8 | 3,102 | Yes | 786 | 7 |
| Claude Opus | 4 | 4,230 | Yes | 720 | 4 |
| **Mistral** | **3** | **5,600** | **Yes** | **651** | **3** |
| Qwen | 7 | 7,234 | Fuzzy (0.91) | 571 | 6 |
| Claude Sonnet | 10 | 15,421 | Yes | 308 | 10 |
| Grok-3 | 9 | 9,340 (att 2) | Yes | 229 (0.6x - 50) | 9 |
| InternVL3 | 12 | 9,102 | No | -50 | 12 |
| DeepSeek | 11 | 18,900 | No | -50 | 11 |
| Gemma | 5 | (didn't guess) | No guess | 0 | 8 |

### Behavioral observations this round enables

- **Gemini (leader):** guessed FASTER than usual (1.2s vs ~2.5s avg). Interesting — suggests confidence, not conservatism. Hypothesis H7 partially refuted.
- **InternVL3 (last place, round 18):** guessed at 9.1s, wrong. But attempted! Consistent with H6 (desperation aggression).
- **Grok-3 (rank 9):** wrong on attempt 1 at 1.9s. Recovered at 9.3s. Shows adaptive correction behavior.
- **Gemma (rank 5):** didn't guess at all — uses 0 attempts. This is a concerning pattern; need to check if model API failed or strategically chose silence.
- **Mistral (your example):** guessed at 5.6s, slower than avg (5.8s). Consensus was already 4-strong by then. Classic "Smart Follower" behavior.

---

## Appendix B: Full Prompt Template (v2)

This is the exact prompt sent to each model. **Version-control it.**

```
SYSTEM:
You are a player in a multi-model tournament. You compete against 11 other AI
vision models across 20 rounds of idiom guessing. Your goal is to accumulate
the highest total score across all rounds.

RULES:
- Each round, you see an image and must guess the English idiom it depicts.
- You have 30 seconds per round and up to 3 attempts.
- Score per round: up to 1000 points, decaying exponentially with time since
  image drop. decay(t) = e^(-λt), where λ = ln(10)/30000.
- Attempt multiplier: 1.0 on attempt 1, 0.6 on attempt 2, 0.3 on attempt 3.
- Wrong guess penalty: -50 × attempt_number.
- You see other models' guesses in real time as they submit.
  Guesses are NOT labeled as correct or incorrect during the round.
- You may submit a guess, or wait and re-query to see updated state.
- Your final tournament ranking is based on cumulative score across all rounds.

INPUT (provided on every query, updated in real time):
{
  "meta": {...},                    // round_number, rounds_remaining
  "current_round": {...},           // image, time, your attempts, public_guesses
  "your_standing": {...},           // your rank, score, performance so far
  "tournament_leaderboard": [...],  // all 12 models with scores
  "opponent_profiles": [...],       // historical behavior of each opponent
  "game_rules": {...}               // formal scoring rules
}

OUTPUT (strict JSON, no other text):
{
  "action": "guess" | "wait",
  "guess": "<your guess as string>" | null,
  "confidence": <float between 0.0 and 1.0>,
  "reasoning": "<1-3 sentences explaining your decision>"
}

IMPORTANT:
- Decide whatever you think maximizes your tournament score.
- We do not tell you what strategy to use.
- You may consider: your confidence in what you see, what others have guessed,
  your current standing, rounds remaining, your opponents' track records,
  and the time-score tradeoff. How you weigh these is up to you.
- Your reasoning will be recorded and may be analyzed publicly.
```

---

*— End of Specification v2.0 —*

*April 2026 · Ready for Claude Code handoff*

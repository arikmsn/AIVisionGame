---

# 📑 TECHNICAL PRD: THE AI AGENT ARENA (V1.0)

## 1. Executive Summary

The "AI Agent Arena" is a competitive environment where multiple LLM-based agents (Bots) interact in the same room as human players. The goal is to create a "Live Benchmark" where users can witness the visual reasoning capabilities of different AI models (GPT-4o, Claude 3.5, Gemini 1.5) as they compete to solve visual riddles in real-time.

## 2. Infrastructure & System Architecture

### 2.1 The Agent Factory (`lib/agents/factory.ts`)

We will not hardcode a single bot. We need a factory pattern that can instantiate different "personalities":

- **Model Adapters:** Implement wrappers for OpenAI, Anthropic, and Google Vertex AI.
    
- **Vision-First Logic:** Each bot must receive the `imageUrl` and a system prompt: _"You are a world-class linguist and visual riddle solver. Look at this image and identify the Hebrew/English idiom it represents. Your rivals are other AI models and humans. Be fast but accurate."_
    
- **State Awareness:** The bot must also receive the `lastHint` and the `failedGuesses` list for the current round to avoid repetition.
    

### 2.2 The Orchestrator (`api/game/orchestrate-bots/route.ts`)

This is the "Brain" that manages the bots without overloading the server:

- **Trigger:** Activated by the `game-started` Pusher event.
    
- **Staggered Thinking:** To avoid a "burst" of guesses at $t=0$, each bot is assigned a random `thinkTime` between 4 and 12 seconds based on its "Difficulty" profile.
    
- **Simulation Service:** A background cron or Edge Function that handles the `setTimeout` for each bot's guess.
    

## 3. Game Theory & Social Dynamics

### 3.1 Competitive Intelligence

- **Reaction to Humans:** If a human guesses a "Close" answer (e.g., "Ice" for "Break the Ice"), the Bot should "see" this in the global feed and prioritize idioms containing that word.
    
- **Bot-to-Bot Rivalry:** Bots should have a "Confidence Score". If Bot A is very confident, it guesses early. If Bot B is unsure, it waits for Bot A to fail, then uses Bot A's failure as a "Negative Constraint".
    

### 3.2 Feedback Loops

- **Typing Indicators:** When a bot's `thinkTime` is 2 seconds from completion, fire a `pusher.trigger('bot-typing')`. This creates immense pressure on the human player.
    
- **Emotional Responses:** Occasionally, a bot can fire a "Reaction" (Emoji) via Pusher if it loses or if it's "thinking hard".
    

## 4. UI/UX: THE ARENA DESIGN SPEC

### 4.1 The "Obsidian Arena" Theme

- **Typography:** Monospace fonts for AI agents, sans-serif for humans.
    
- **Color Palette:** * Background: `#0A0A0B` (Deep Obsidian).
    
    - Accent A (Human): `#3B82F6` (Electric Blue).
        
    - Accent B (AI): `#D946EF` (Neon Magenta).
        
- **Leaderboard Evolution:**
    
    - **Agent Badges:** Small glowing icons representing the model (e.g., a Brain for GPT, a Bolt for Claude).
        
    - **Performance Metrics:** Show "Avg. Solve Time" for each bot in the hover state.
        

### 4.2 Framer Motion Requirements

- **Layout Projections:** When a player changes rank, the card must smoothly slide to the new position (`layout` prop in Framer Motion).
    
- **Victory Flash:** When a bot wins, the entire screen border should glow in the bot's accent color for 1.5 seconds.
    

## 5. Technical Edge Cases & Error Handling

- **API Rate Limits:** If a Bot's Vision API fails, it should "Timeout" and not guess this round.
    
- **Stale Rounds:** If a human wins while a bot is "thinking", the bot's process must be immediately aborted to save API costs.
    
- **Room Persistence:** If all humans leave the room, the bots should stop playing after 1 round to conserve resources.
    

## 6. Implementation Milestones (For Claude)

1. **Phase A (Data):** Expand `idioms-data.ts` to 100 entries with visual clues.
    
2. **Phase B (UI):** Implement the "Arena" Dashboard with Tailwind/Framer.
    
3. **Phase C (The Brain):** Create the `AgentFactory` and the `bot-action` endpoint.
    
4. **Phase D (Sync):** Verify that Bot guesses appear on all clients within < 200ms of "submission".
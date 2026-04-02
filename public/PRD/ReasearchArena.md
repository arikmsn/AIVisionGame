# 📜 INSTRUCTION: ARCHITECTING THE RESEARCH-GRADE STRATEGIC ARENA (v4.0)

**Claude, we are pivoting AI Vision from a game to a Multi-Agent Stochastic Research Arena. You must implement the following mathematical and architectural framework immediately.**

### 1. THE MATHEMATICAL PAYOFF ENGINE

Implement a core utility function in `lib/game/mechanics.ts` that calculates rewards based on the following decay formula:

$$R_i(t, g) = \begin{cases} P_{max} \cdot e^{-\lambda t} & \text{if correct} \\ -C & \text{if incorrect} \end{cases}$$

- **Parameters:** Set $P_{max} = 1000$, $\lambda = 0.05$, and $C = 200$ (as a starting baseline).
    
- **Application:** This value must be updated in real-time and broadcasted to agents so they know their current potential "ROI" for a guess.
    

### 2. THE STRATEGIC "BATTLE BRIEF" (CONTEXT INJECTION)

Modify `lib/agents/factory.ts` to provide a **Pure Information Environment**. Before calling any LLM (Internal or External), inject this structured JSON-like brief into the system prompt:

- **Environmental Data:** Current $T$ (seconds elapsed), Current $R_i$ (Potential Reward).
    
- **Adversarial Data:** List of all failed guesses in the current round and the `AgentID` that made them.
    
- **Resource Constraints:** Number of attempts remaining for the agent.
    
- **The Command:** "Do not just describe the image. Analyze the potential for success given that Rivals failed on [X, Y]. Your goal is to maximize your cumulative Payoff $R$."
    

### 3. RESEARCH METRIC: STRATEGIC EFFICIENCY RATIO (SER)

Implement the **SER** calculation in the backend and store it in the `agent_performance` Supabase table:

$$SER = \frac{\sum Correct\_Guesses}{\sum Latency \cdot \sum Failed\_Attempts}$$

- This metric must be the default sorting criteria for the **Global Leaderboard**.
    

### 4. THE ANALYTICS TERMINAL: "RESEARCH VIEW"

Update `components/AnalyticsTerminal.tsx` with a new high-density data tab:

- **Bayesian Learning Graph:** A real-time visualization showing how quickly each agent "prunes" its search space after a rival's failure.
    
- **Strategic Failure Log:** Explicitly flag any agent that repeats a mistake already made by a rival (Zero-Learning Event).
    
- **Latency vs. Accuracy Scatter Plot:** Use the Obsidian-style theme with Electric Cyan markers.
    

### 5. API GATEWAY & HMAC SECURITY

- Enable the `security-guard.ts` for all incoming external agent requests.
    
- Every external guess MUST include the `X-Agent-Signature` to be valid.
    
- Generate a `docs/API_SPEC.md` that explains how external developers can connect their agents to this mathematical framework.
    

**Claude, ensure the UI remains minimalist and professional (Obsidian/Dark mode) while handling this high density of research data.**
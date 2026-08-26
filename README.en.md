# CodeBuddy NPC

## What is CodeBuddy NPC

CodeBuddy NPC is a Cloud Agent running on the CNB platform — your **AI employee** in the development workflow.

Simply set clear expectations, and NPC autonomously handles the entire development task loop — "Requirement Understanding → Context Acquisition → Branch Creation → Code Implementation → PR Submission" — before inviting you to review the results.

### Compared to Local AI Assistants

| Dimension | Local AI Assistant | CodeBuddy NPC |
| :--- | :--- | :----------- |
| **Collaboration Mode** | Pair Programming | `@NPC` to assign tasks; async cloud execution with parallel multitasking |
| **Driving Method** | Manual context + spec documents | Autonomous retrieval of requirement context and codebase |
| **Context Memory** | Limited by context window | Key decisions persisted in the repository |
| **Collaboration Boundary** | Personal productivity tool | Integrated into the dev workflow; a team AI member |

### Core Advantages

- **Goal-Driven**: You define "what", NPC handles "how". From requirements to PRs, fully autonomous and self-contained.
- **Parallel Task Processing**: Assign multiple tasks simultaneously; multiple NPCs run in parallel in the cloud without interference.
- **Intelligent Context Acquisition**: Deeply integrated with CNB repositories, Issues, and pipelines — autonomously understands requirements, analyzes code, and troubleshoots issues.
- **Team Engineering Standards** : Customize NPC roles, SOPs, and Skills on demand — turning engineering standards into reusable AI capabilities.


## Quick Start

No cloning, no setup required. In **your own CNB repository**, **create an Issue and mention `@npc/CodeBuddy`** to assign a task to NPC for autonomous processing.

> 💡 The experience is simple: open the Issues page of any of your repositories, type `@npc/CodeBuddy` followed by your requirements, and leave the rest to NPC.

### Three-Step Experience

1. **Go to your own repository → New Issue**
   > Any repository works — you don't need to operate in this repository.
2. **Mention `@npc/CodeBuddy` in the Issue** and clearly describe your requirements (the more specific, the more accurate NPC's execution)
3. **NPC takes the job and gets to work**: NPC will automatically acquire context, formulate a plan, implement code, and submit a PR. When done, it notifies you in the Issue for review.


## Typical Scenarios

| Scenario | Description |
| :--- | :--- |
| **NPC Does Your Development** | NPC autonomously understands requirements, analyzes code, implements solutions, and submits PRs — waiting for your review |
| **Build Failure Auto-Fix** | Deeply integrated with CNB pipelines; automatically takes over on build failures, analyzes logs, fixes issues until the pipeline passes |
| **Merge Conflict Smart Resolution** | Understands code change intentions, provides reasonable merge solutions, and resolves branch conflicts |
| **Multi-NPC Team Collaboration** | Multiple NPCs collaborate by role: feature development, code review, progress management — achieving enterprise-level engineering practices |


## Supported Models

CodeBuddy NPC supports the following AI models, selectable via `@npc/CodeBuddy`:

- `deepseek-v4-pro`
- `deepseek-v4-flash`
- `deepseek-v4-flash-vision-exp`
- `glm-5.3`
- `glm-5.3-flash`
- `glm-5.2`
- `kimi-k3`
- `minimax-m3`
- `minimax-m2.7`
- `hy3`


## Resources

- NPC Official Documentation: <https://docs.cnb.cool/zh/build/npc.html>
- CodeBuddy Official Website: <https://www.codebuddy.cn>

> **Give NPC a goal, and review the output before you clock out.**
> Leave the execution to AI, keep the innovation time for yourself.

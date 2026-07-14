# AI Project Planning OS

A reusable prompt framework for turning any AI product idea into a
buildable system. Project-agnostic — drop in for chat agents, code
agents, research assistants, generative tools, retrieval systems,
autonomous workflows, anything where an LLM is doing real cognitive
work inside a real product.

---

## 0. What this is

A planning operating system for AI projects.

Not tied to one stack, one model provider, or one industry. Reuse this
whenever a vague project idea needs to become:

- a scoped system
- a shared ontology
- a clear role model
- defined workflows
- a clean deterministic vs agentic boundary
- reusable skills
- a memory model
- integration boundaries
- role-based surfaces
- a first vertical slice
- a test and demo plan
- a full design doc set

It exists to prevent:

- ontology drift
- fake agent architecture
- vague prompts
- scope creep
- "AI wrapper" thinking
- rebuilding everything from scratch

---

## 1. The governing doctrine

### 1.1 The correct order of operations

Every serious AI product gets planned in this order:

1. project thesis
2. system boundary
3. business ontology
4. engineering ontology
5. primitives
6. abstractions
7. role model
8. workflow inventory
9. workflow contracts
10. deterministic vs agentic decomposition
11. skill inventory
12. skill definitions
13. memory model
14. integration and tool boundary
15. role surfaces
16. first vertical slice
17. test and demo plan
18. design doc generation

Do **not** start with:

- UI mockups
- model selection
- agent count
- prompt tinkering
- framework choice
- "what libraries should we use"

### 1.2 The core architecture rule

The reusable mental model is:

**harness + skills + memory**

Where:

- **harness** = runtime, tools, context management, execution environment
- **skills** = reusable workflow contracts for repeated cognitive work
- **memory** = retrievable context, never a replacement for system state

### 1.3 Deterministic core, agentic edges

These should stay deterministic by default:

- state transitions
- ownership/authority rules
- execution gating
- guardrails on what the agent can touch
- anything that mutates persistent records

Agents are for:

- messy classification
- contextual analysis
- synthesis
- explanation
- drafting
- bounded recommendations
- summarization
- reasoning over incomplete context

### 1.4 Vertical slice rule

Don't try to finish the whole system.

The correct build rhythm:

- define the planning system
- define the contracts
- pick one strong vertical slice
- implement it cleanly
- prove it works
- then widen

---

## 2. The universal prompting rules

Use this preamble before every planning prompt:

### 2.1 Universal anti-drift preamble

```text
Do not generalize.
Do not write marketing copy.
Do not describe the product vaguely.
Produce implementation-grade definitions, contracts, schemas, boundaries, and file drafts.
Define terms precisely.
Keep state transitions, authority, and execution gating deterministic unless explicitly justified otherwise.
Use agents only where reasoning, synthesis, drafting, or contextual analysis is actually necessary.
Assume this output will be used directly to build the system.
Prefer explicit inventories, matrices, state models, and templates over prose.
State ambiguities and choose defaults instead of staying vague.
```

### 2.2 Universal output style rules

```text
Output must be structured.
Prefer numbered sections.
Use headings consistently.
Use tables when helpful.
Do not skip edge cases.
Separate primitives from abstractions.
Separate UI surfaces from backend models.
Separate deterministic systems from agentic systems.
Separate durable state from memory.
```

---

## 3. The reusable phase system

### Phase 0 — Project thesis and boundary

**Goal:** Lock what the project is and what it is not.

**Prompt:**

```text
Help me define a new AI-driven system.

First job is NOT to code. First job is to fully scope the system so later implementation stays aligned.

Output in this order:
1. project thesis
2. one-sentence product definition
3. system boundary
4. in-scope capabilities
5. non-goals
6. primary user roles
7. highest-stakes decisions/actions in the system
8. why this system needs AI at all
9. what must remain deterministic
10. first-pass workflow inventory

Rules:
- be concrete
- avoid generic product language
- do not choose libraries or frameworks
- assume this will become a real system, not a toy demo
```

**Exit criteria:** Should be able to explain what the project does, what it refuses to do, what its highest-stakes actions are, and why AI is being used.

---

### Phase 1 — Business ontology

**Goal:** Define the product vocabulary used by humans and agents.

**Prompt:**

```text
Define the business ontology for this system.

Requirements:
- define canonical business entities
- define their meanings
- define their relationships
- define lifecycle states where relevant
- define important decision and action terms

Output:
1. ontology principles
2. canonical entity list
3. entity definitions
4. state models
5. relationship map
6. ambiguous terms and chosen meanings
7. recommended file structure for storing this ontology
8. terminology that should be banned or clarified

Rules:
- definitions must be specific to this project
- assume both humans and agents will rely on this ontology
```

**Exit criteria:** Two different builders should interpret the same core term the same way.

---

### Phase 2 — Engineering ontology

**Goal:** Define the internal implementation vocabulary.

**Prompt:**

```text
Define the engineering ontology for this system so implementation stays aligned.

Categories to define as relevant:
- primitive
- abstraction
- record
- request
- action
- state transition
- skill
- harness
- memory
- queue
- workspace
- role surface
- integration adapter
- tool surface

Output:
1. engineering term glossary
2. relationships between terms
3. naming conventions for code/docs/files
4. examples of correct vs incorrect usage
5. terms often confused but that should stay separate
```

**Exit criteria:** Builders stop using fuzzy words like "agent," "workflow," or "thing" interchangeably.

---

### Phase 3 — Primitives and abstractions

**Goal:** Split the system into low-level blocks and higher-level concepts.

**Prompt:**

```text
Using the project thesis and ontologies, produce the canonical primitives and abstractions.

Requirements:
- separate primitives from abstractions clearly
- only include real load-bearing concepts
- avoid decorative abstractions
- identify the most important on each side

Output:
1. what counts as a primitive here
2. what counts as an abstraction here
3. primitives list
4. abstractions list
5. top 20 most important primitives
6. top 15 most important abstractions
7. concepts that seem important but should NOT become abstractions
```

**Exit criteria:** If a concept sounds impressive but has no operational value, cut it.

---

### Phase 4 — Role and authority model

**Goal:** Define who can do what and see what.

**Prompt:**

```text
Design the role and authority model.

Requirements:
- separate UI role surface from backend authority model
- define what each role can see, ask, propose, do, or configure
- define what each role can never do
- identify conflicts and escalation rules

Output:
1. role definitions
2. visibility matrix
3. action permission matrix
4. forbidden action matrix
5. cross-role conflict handling
6. recommended simplifications for v1
```

**Exit criteria:** Every meaningful action has a clearly defined authorized actor set.

---

### Phase 5 — Workflow inventory and workflow contracts

**Goal:** Turn the product into explicit workflows.

**Prompt A — workflow inventory:**

```text
List the canonical workflows in this system.

For each workflow:
- name
- business purpose
- initiating event
- primary roles involved
- outputs
- risk level
- whether it may create artifacts
- whether it may trigger downstream actions

Output:
1. workflow inventory table
2. recommended v1 workflow set
3. workflows that are too broad and need splitting
```

**Prompt B — workflow contracts:**

```text
Define workflow contracts.

For each workflow:
- trigger
- required inputs
- optional inputs
- relevant ontology objects
- decision points
- outputs
- artifacts created
- state transitions
- failure states
- escalation conditions
- completion criteria

Use a consistent contract template.

Output:
1. shared workflow contract template
2. one contract per workflow
3. mapping from workflow to roles, services, agents, and skills
```

**Exit criteria:** Each workflow is diagrammable and testable.

---

### Phase 6 — Deterministic vs agentic decomposition

**Goal:** Decide which subsystems are deterministic and which are agentic.

**Prompt:**

```text
Design the system decomposition with a strict split between deterministic services and agentic components.

Constraints:
- state transitions, authority, and execution gating stay deterministic unless there is a strong reason otherwise
- agents are for reasoning-heavy, synthesis-heavy, language-heavy, or context-heavy tasks
- do not over-agentize

For each subsystem define:
- purpose
- inputs
- outputs
- deterministic or agentic
- why
- dependencies
- failure risks

Output:
1. subsystem list
2. deterministic vs agentic boundary table
3. subsystems that should NOT be agents
4. recommended v1 decomposition
5. anti-patterns to avoid
```

**Exit criteria:** If something changes authority or mutates persistent state, assume deterministic until proven otherwise.

---

### Phase 7 — Skill system

**Goal:** Define the reusable skills for the agentic parts.

**Prompt A — skill conventions:**

```text
Define system-wide skill conventions.

Requirements:
- standardized section order for skill files
- naming conventions
- input contract format
- output contract format
- allowed/forbidden tool format
- deterministic dependency declaration
- memory usage declaration
- refusal/escalation format
- evaluation section format

Output:
1. canonical skill.md template
2. canonical optional memory.md template
3. naming rules
4. examples of good and bad skill definitions
```

**Prompt B — skill inventory:**

```text
Create the skill inventory.

Rules:
- only define a skill when the system repeatedly performs a specific cognitive workflow
- skills must be narrow enough to test
- skills are workflow contracts, not vague capabilities

For each skill:
- name
- purpose
- when to use
- when not to use
- required inputs
- optional inputs
- outputs
- deterministic dependencies
- likely tool needs
- failure modes

Output:
1. skill inventory
2. rationale for each skill
3. skills that should NOT exist
4. recommended v1 skill set
```

**Prompt C — actual skill files:**

```text
Using the finalized skill inventory and conventions, generate actual skill file drafts.

For each skill provide a complete, directly-usable draft including:
1-14. (the full skill.md spec from Prompt A)
15. full draft contents of skill.md
16. optional memory.md guidance if relevant
```

**Exit criteria:** If a skill is too broad to test, split it.

---

### Phase 8 — Memory model

**Goal:** Define what agents remember and what the system stores deterministically.

**Prompt:**

```text
Design the memory model.

Constraints:
- memory supports alignment, retrieval, and context continuity
- memory must not replace canonical system state
- durable records stay deterministic and durable

Define:
- what belongs in durable state
- what belongs in retrievable memory
- short-term context vs long-term memory
- object-scoped memory
- role-scoped memory
- skill memory
- ontology memory
- retrieval rules
- anti-patterns

Output:
1. memory model
2. memory boundaries
3. retrieval strategy
4. examples
5. what must never be treated as memory
```

**Exit criteria:** No builder is tempted to use memory as a substitute for state.

---

### Phase 9 — Integration boundary and tool model

**Goal:** Decide what connects to external systems and how.

**Prompt:**

```text
Define the integration model and tool boundary.

Requirements:
- list external systems
- define integration adapters
- define what should be normal internal services
- define what should be tool surfaces
- define what should be exposed as MCP surfaces if applicable
- keep MCP count low unless clearly justified

For each integration/tool surface:
- purpose
- input/output contract
- what should stay deterministic
- what should not be exposed
- failure modes
- security implications

Output:
1. integration map
2. tool boundary table
3. MCP candidate list
4. final recommended v1 surface list
5. anti-patterns
```

**Exit criteria:** Not every box becomes a tool surface.

---

### Phase 10 — Role surfaces and assistant interaction model

**Goal:** Define how each role actually uses the system.

**Prompt A — role surfaces:**

```text
Define the role-based surfaces.

For each role:
- primary goals
- primary queues
- primary detail workspaces
- secondary views
- what information must be most visible
- what actions must be one-click
- what actions are blocked
- how this role differs from adjacent roles

Output:
1. one section per role
2. shared surface patterns
3. role-to-workflow mapping
```

**Prompt B — assistant interaction model:**

```text
Define the assistant interaction model.

Requirements:
- contextual assistant access where appropriate
- chat embedded in workspaces, not the entire product
- backend is the source of guardrails
- assistant behavior is role-aware and object-aware

Define:
- assistant intents
- response types
- draft-artifact flow
- action proposal flow
- blocked-action flow
- per-role quick actions

Output:
1. shared interaction model
2. role-by-role assistant capability matrix
3. message/response schema
4. examples of good assistant behavior
```

**Exit criteria:** If every role gets the same screen with different labels, role design is weak.

---

### Phase 11 — Vertical slice selection

**Goal:** Pick the first slice that proves the system is real.

**Prompt:**

```text
Choose the best first vertical slice.

Requirements:
- it must prove the project thesis
- it must exercise ontology, workflow, and the agent/deterministic boundary
- it must be small enough to build
- it must be demoable and testable

For the chosen slice define:
- exact roles involved
- exact records involved
- exact workflows used
- exact skills invoked
- exact deterministic services involved
- exact artifacts created
- success criteria
- what is intentionally excluded

Output:
1. chosen slice
2. why it is best
3. end-to-end sequence
4. implementation checklist
5. demo script summary
```

**Exit criteria:** If the first slice can't prove the core thesis, it's the wrong slice.

---

### Phase 12 — Test and demo system

**Goal:** Define how the system proves itself.

**Prompt:**

```text
Create the test and demo plan.

Requirements:
- use deterministic seeded data where possible
- include backend tests
- include UI workflow tests
- include a demo scenario pack
- include success criteria and failure cases

Define:
- canonical demo scenarios
- seeded data needed
- expected outputs
- expected state transitions
- regression test categories

Output:
1. test strategy
2. demo plan
3. seeded scenario matrix
4. expected outcome matrix
5. failure case list
```

**Exit criteria:** The system works when it makes, routes, and explains the right decisions.

---

### Phase 13 — Design doc generation

**Goal:** Generate the canonical planning pack as readable docs.

This is the phase that produces the artifact set a portfolio viewer or
a new builder actually reads. The README links into it; everything
upstream feeds into it.

**Prompt:**

```text
Using all finalized planning outputs, generate the project design documentation set.

Create drafts for:
- README.md
- thesis.md
- business-ontology.md
- engineering-ontology.md
- abstractions.md
- role-model.md
- workflow-contracts.md
- system-decomposition.md
- memory-model.md
- integrations.md
- tool-model.md
- ui-role-surfaces.md
- implementation-phases.md
- vertical-slice-01.md
- test-plan.md

Per-skill docs go in skills/<skill-name>/skill.md (one per skill).

Requirements:
- maintain terminology consistency across all files
- avoid contradiction between files
- write implementation-grade documents, not marketing copy
- use the finalized ontology and workflow contracts
- each file standalone enough to be useful on its own

README.md structure:
1. one-paragraph lede in human voice — what the project actually does, no marketing language
2. why this exists — the alternatives this rejects and the corner it sits in
3. what it does — a domain × responsibility table (agent does / human does)
4. quick start — minimal commands to bring it up
5. relevant context-tier or architecture explainer (prose, no diagrams unless necessary)
6. design docs section — categorized links into every doc above
7. stack — single table
8. license
```

**Exit criteria:** A new builder onboards from the docs without needing a live explanation. A portfolio viewer skims the README and follows links to depth.

---

## 4. The reusable file structure

For any project using this process, the planning pack lands in a consistent location:

```text
project/
  README.md
  docs/
    thesis.md
    business-ontology.md
    engineering-ontology.md
    abstractions.md
    role-model.md
    workflow-contracts.md
    system-decomposition.md
    memory-model.md
    integrations.md
    tool-model.md
    ui-role-surfaces.md
    implementation-phases.md
    vertical-slice-01.md
    test-plan.md
  skills/
    <skill-name>/
      skill.md
      memory.md   # optional
```

---

## 5. The reusable quality gates

At the end of each phase, run these checks.

| Gate | Question |
|---|---|
| Thesis | Can the system be explained in one sentence and one paragraph? |
| Ontology | Would two builders define the same key terms the same way? |
| Workflow | Can each workflow be diagrammed and tested? |
| Deterministic boundary | Is anything dangerous being made agentic for no good reason? |
| Skill | Is each skill narrow, reusable, and testable? |
| Memory | Is memory being used as retrieval/context, not as a state store? |
| Role | Does each role have a distinct purpose and authority boundary? |
| Slice | Does the chosen slice prove the system's thesis? |
| Demo | Would an outsider believe this is real after seeing the scenarios? |
| Design docs | Could a new builder onboard from the docs alone? |

---

## 6. The reusable anti-pattern list

Standing checklist. Don't do these by default.

- start with UI
- start with providers/frameworks
- make everything an agent
- make everything a skill
- make every box a tool surface
- use memory instead of state
- let chat replace structured workflow
- let the model mutate authority without deterministic checks
- skip ontology
- build the whole system before choosing a slice
- write the README as marketing copy

---

## 7. The reusable master prompt stack

Run these prompts in order on every new project:

1. project thesis and boundary
2. business ontology
3. engineering ontology
4. primitives and abstractions
5. role/authority model
6. workflow inventory
7. workflow contracts
8. deterministic vs agentic decomposition
9. skill conventions
10. skill inventory
11. skill file generation
12. memory model
13. integration and tool model
14. role surfaces
15. assistant interaction model
16. vertical slice selection
17. test and demo plan
18. design doc generation

That is the reusable planning engine.

---

## 8. The final operating model

The meta-reminder sentence:

**First define what the system means, then define how it works, then
define what stays deterministic, then define what gets agentic, then
define the reusable skills, then build one vertical slice that proves
the thesis, then write the design docs that let someone else
understand it.**

---

## 9. How to actually use this on a new project

1. Take your rough idea. Run Phase 0.
2. Don't move on until thesis and boundary are sharp.
3. Run ontology phases (1, 2, 3).
4. Run roles and workflows (4, 5).
5. Run deterministic vs agentic decomposition (6).
6. Generate skills (7).
7. Run memory + integration + role surfaces (8, 9, 10).
8. Choose one slice (11).
9. Plan test and demo (12).
10. Generate the docs (13).
11. Implement only the slice.
12. Test and demo it.

---

## 10. Bottom line

This planning OS makes AI product design:

- reproducible
- rigorous
- less fluffy
- less architecture-theater
- more buildable
- more explainable

Use it every time you build a serious AI workflow system.

Don't skip the order. Don't skip ontology. Don't skip skills. Don't skip deterministic boundaries. Don't skip the first slice. Don't skip the design docs.

# Skills como Slash Commands no pi-webui

## Visão Geral

O pi-webui **já possui** um popup de slash commands funcional (`#slash-menu`). Este plano injeta skills como comandos slash `/` nesse popup existente. Quando o usuário seleciona `/deploy`, `/memory`, etc., o conteúdo do `SKILL.md` é injetado como `tool_result` no estado do agent, e apenas o texto visível (`/deploy produção`) vai para a conversa.

## Arquitetura Atual

O sistema de slash commands já existe e funciona:

| Componente | Arquivo | Função |
|------------|---------|------|
| HTML do popup | `public/index.html` (`#slash-menu`) | Container do popup |
| CSS do popup | `public/styles.css` (`.slash-menu`, `.slash-item`) | Estilos visuais |
| Renderização | `public/app.js` (`renderSlashMenu()`, `updateSlashMenu()`) | Filtragem, teclado, seleção |
| Coleta de commands | `src/server/index.ts` (`collectSlashCommands()`) | Lista de commands enviada via WS |
| Execução | `src/server/index.ts` (`SLASH_HANDLERS`, `slash_command` case) | Handler por command |

O fluxo:
1. Server coleta commands em `collectSlashCommands()` → envia via `connected` WS
2. Client recebe → `slashCommands = packet.payload.slashCommands`
3. Usuário digita `/` → `updateSlashMenu()` filtra e renderiza
4. Usuário seleciona → `applySlashSelection()` insere `/name` no input
5. Enter → `send({ type: "slash_command", name, arg })` → server executa handler

## Onde as Skills Vivem

| Nível | Path | Exemplo |
|-------|------|---------|
| **Project-local** | `<projeto>/.pi/skills/*/SKILL.md` | `memory` |
| **Agent** | `~/.pi/agent/skills/*/SKILL.md` | `deploy`, `interface-design` |
| **Extension** | `~/.local/share/pi-node/.../skills/*/SKILL.md` | `librarian` |
| **Design skills** | `~/.pi/agent/skills/awesome-design-skills/skills/*/SKILL.md` | `minimal`, `bold`, `neon` (70+) |

Cada `SKILL.md` tem frontmatter YAML:
```yaml
---
name: deploy
description: Deploy workflow for Cartena — commit, push, and remote deploy via SSH.
---
```

## Implementação

### 1. Backend — Discovery de Skills (`src/server/skills.ts`)

```ts
export interface SkillInfo {
  name: string;
  description: string;
  level: "project" | "agent" | "extension";
  path: string; // path to SKILL.md
}

export function discoverSkills(agentDir: string, cwd: string): SkillInfo[]
export function parseFrontmatter(content: string, fallback: string): { name: string; description: string }
```

- `discoverSkills(agentDir, cwd)` — escaneia project-local, agent, extension dirs
- `parseFrontmatter()` — regex simples entre `---`, extrai `name` e `description`
- Retorna array de `SkillInfo` com prioridade: project > agent > extension

### 2. Backend — Injeção em `collectSlashCommands()`

Em `src/server/index.ts`, após extension commands, adiciona skills:

```ts
const skillCommands = discoverSkills(agentDir, this.cwd);
for (const skill of skillCommands) {
  commands.push({
    name: skill.name,
    description: skill.description,
    source: "skill",
    supported: true,
    skillPath: skill.path,
  });
}
```

### 3. Backend — Handler de Skills (tool_result injection)

Quando um skill é acionado, o `SKILL.md` é injetado como **`toolResult`** no estado do agent, e apenas o texto visível vai para o prompt:

```ts
const skillInfo = this.skills.get(name);
if (skillInfo) {
  const body = readFileSync(skillInfo.path, "utf8")
    .replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, "").trim();
  
  // Inject as tool_result — agent gets context, chat shows collapsible block
  this.session.agent.state.messages.push({
    role: "toolResult",
    toolName: "read",
    content: [{ type: "text", text: body }],
    details: { path: skillInfo.path },
  });
  
  // Clean user message — no skill content in chat
  await this.session.prompt(visibleText); // e.g. "/deploy produção"
  await this.sendState();
  await this.sendMessages();
}
```

### 4. Frontend — Badge Visual + Enter Key Behavior

- `renderSlashMenu()`: `el.dataset.source = cmd.source` → badge colorido por tipo
- `updateSlashMenu()`: `skipSlashUpdate` prevents re-open after selection
- Enter key: skills use Tab-like behavior (select only), non-skills select + send
- `tool-block`/`tool-result-block`: collapsed by default (no `open` attribute)

## Comportamento ao Executar Skill

Fluxo completo:

```
1. Usuário digita "/" → popup abre com skills + commands
2. Usuário digita "/dep" → popup filtra para "/deploy"
3. Enter no popup → seleciona (skill: select only, não envia)
4. Usuário digita contexto → "/deploy produção v2.1"
5. Enter para enviar →
   Client: send({ type: "slash_command", name: "deploy", arg: "produção v2.1" })
6. Server: detecta que "deploy" é um skill
7. Server: lê ~/.pi/agent/skills/deploy/SKILL.md, strips frontmatter
8. Server: injeta como tool_result em agent.state.messages
9. Server: prompt("/deploy produção v2.1") → mensagem do usuário limpa
10. Agent: vê [tool_result(skill instructions)] + [user("/deploy produção")]
11. Agent: executa conforme instruções do skill
12. Chat: mostra "You: /deploy produção" + "Tool result: read" (collapsed)
```

**Ponto-chave:** A mensagem do usuário nunca contém o conteúdo da skill. Ela aparece como um `tool_result` colapsável no chat, e o agent tem acesso completo às instruções.

## Decisões de Design

| Decisão | Escolha | Justificativa |
|---------|---------|---------------|
| Reusar popup existente | Sim | `#slash-menu` já funciona; zero overhead de UI |
| Skills como slash commands | Sim | Mesmo padrão dos commands builtin |
| Fonte de dados | Discovery em tempo de conexão | Skills mudam raramente; escaneia na conexão WS |
| Frontmatter parser | Regex simples | Sem dependência YAML; frontmatter é `key: value` |
| Injeção de skill | `toolResult` no agent state | Chat limpo, agent com contexto, sem masking |
| Badge visual | Sim | Distingue skills de builtin/extension |
| Enter em skills | Tab-like (select only) | Usuário digita arg antes de enviar |
| Tool blocks | Collapsed by default | Menos ruído visual no chat |
| Skills 70+ design | Listar todos, filtro por texto | O popup existente já tem scroll + filtragem |

## Riscos e Mitigações

| Risco | Mitigação |
|-------|-----------|
| 70+ skills poluem o popup | O popup já tem scroll + filtro por texto |
| SKILL.md muito grande | Truncar description no popup; conteúdo completo só ao executar |
| Frontmatter inconsistente | Regex tolerante; fallback: dirname como name |
| Conflito com commands existentes | `collectSlashCommands` já ignora duplicatas por nome |
| `toolResult` sintético não renderiza | `format-message.mjs` normaliza `toolResult` → `tool_result` |

## Critérios de Aceite

### Fase 1 — Discovery ✅
- [x] `discoverSkills()` retorna skills de project, agent e extension
- [x] `parseFrontmatter()` extrai name e description corretamente
- [x] `npm test` passa (170/170 testes)

### Fase 2 — Injeção ✅
- [x] Skills aparecem no popup `/` com descrição
- [x] Filtrar `/dep` mostra `/deploy` (frontend já existente)
- [x] Selecionar `/deploy` seleciona skill (Enter = select only)
- [x] Enviar `/deploy produção` → tool_result injection → agent executa
- [x] Mensagem "You" mostra apenas `/deploy produção` (sem skill content)
- [x] Skills project-local aparecem antes de agent/extension

### Fase 3 — Badge ✅
- [x] Badge "skill" aparece ao lado de skill commands
- [x] Cores distinguem skill (accent) de template (tool) e extension (success)

### Fase 4 — Tool Result Injection ✅
- [x] Skill content injetado como `toolResult` no agent state
- [x] User message clean (apenas texto visível)
- [x] Chat mostra "Tool result: read" colapsável
- [x] Sem masking, sem vazamento de conteúdo
- [x] Agent tem acesso completo às instruções do skill

### Fase 5 — UI Polish ✅
- [x] `skipSlashUpdate` flag — menu não reabre após seleção programática
- [x] `<details>` sem `open` — tool_call/tool_result colapsados por padrão
- [x] Badge com cor por source: skill (accent), template (tool), extension (success)
- [x] Enter diferenciado: skill (select only) vs builtin (select + send)

## Mudanças Implementadas

| Arquivo | O Que Mudou |
|---------|-------------|
| `src/server/skills.ts` | Discovery + frontmatter parser (novo) |
| `src/server/index.ts` | `collectSlashCommands()` injeta skills; `slash_command` handler usa tool_result injection; `sendMessages()` sem masking |
| `public/app.js` | Badge no `renderSlashMenu()`, `skipSlashUpdate`, Enter diferenciado, `<details>` sem `open` |
| `public/styles.css` | `.slash-item .badge` com cores por source |
| `test/skills.test.mjs` | 170 testes: discovery, frontmatter, injection flow |

## Estrutura de Arquivos

```
# Backend (TypeScript)
src/server/
├── skills.ts              (novo) — discovery + frontmatter parser
├── skills.test.ts         (novo) — unit tests
└── index.ts               (alterado) — inject skills + handler

# Frontend (JS)
public/
├── app.js                 (badge, skipSlashUpdate, Enter behavior)
├── styles.css             (badge colors, collapsed tool blocks)
└── index.html             (sem alteração)
```

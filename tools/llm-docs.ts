// Genera la documentación para LLMs a partir de las mismas fuentes que la ayuda de la app.
// No se enlaza desde la UI: queda publicada en rutas conocidas para que un agente la lea
// con solo entrar al sitio (convención llms.txt + formato "Agent Skill").
//
//   /llms.txt          índice corto (https://llmstxt.org)
//   /llms-full.txt     guía para agentes + referencia completa de sintaxis
//   /skill/SKILL.md    la misma guía como skill (frontmatter name/description)
//   /skill/SINTAXIS.md referencia de sintaxis (en español), adjunta a la skill

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

const SKILL_DESCRIPTION =
  'Create, edit and share Gantt charts as plain text with the GanttMaker DSL (sections, tasks, owners, ' +
  'dependencies, milestones, sprints and views). Use when the user asks for a project plan, roadmap, ' +
  'timeline, schedule, sprint plan or Gantt chart, or shares a .gantt file or a GanttMaker link.';

export function buildLlmDocs(root: string): Record<string, string> {
  const guide = readFileSync(resolve(root, 'docs/LLM.md'), 'utf8').trim();
  const syntax = readFileSync(resolve(root, 'docs/SINTAXIS.md'), 'utf8').trim();

  const index = `# GanttMaker

> Client-side web app that turns a small plain-text DSL into interactive Gantt charts (similar in spirit to Mermaid). No server, no API: the diagram is the text. Agents can write diagrams and give users a link that opens them (\`#src=\` + URL-encoded text).

Read the agent guide first; it contains the full syntax, rules and a checklist.

## Docs

- [Agent guide + full syntax](llms-full.txt): everything an LLM needs in one file
- [Agent skill](skill/SKILL.md): the guide packaged as a skill (name/description frontmatter)
- [Syntax reference (Spanish)](skill/SINTAXIS.md): the same reference shown in the app's help panel

## Optional

- Links: \`APP_URL#src=<encodeURIComponent(diagram)>\` opens the diagram in a new space; \`#code=\` links are lz-string compressed (created by the app's share button)
`;

  const skill = `---
name: ganttmaker
description: ${SKILL_DESCRIPTION}
---

${guide}

## Additional reference

The complete user-facing syntax reference (in Spanish) is in [SINTAXIS.md](SINTAXIS.md).
`;

  const full = `${guide}

---

# Referencia completa de sintaxis (español)

${syntax.replace(/^# .*\n/, '')}
`;

  return {
    'llms.txt': index,
    'llms-full.txt': full,
    'skill/SKILL.md': skill,
    'skill/SINTAXIS.md': syntax + '\n',
  };
}

function contentType(file: string): string {
  return file.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8';
}

/** Plugin de Vite: sirve los archivos en desarrollo y los emite en el build. */
export function llmDocsPlugin(): Plugin {
  let root = process.cwd();
  return {
    name: 'ganttmaker-llm-docs',
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0].replace(/^\/+/, '');
        const files = buildLlmDocs(root); // se relee en cada pedido: siempre al día con docs/
        if (!(path in files)) return next();
        res.setHeader('Content-Type', contentType(path));
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(files[path]);
      });
    },
    generateBundle() {
      for (const [fileName, source] of Object.entries(buildLlmDocs(root))) {
        this.emitFile({ type: 'asset', fileName, source });
      }
    },
  };
}

# GanttMaker — Investigación y propuesta de features

## 1. Referencias

| Referencia | Qué copiar | Qué evitar |
|---|---|---|
| **Mermaid Live** | Editor de código a la izquierda, render en vivo a la derecha, URL compartible con el estado codificado, export SVG/PNG, errores de sintaxis en línea | Gantt de Mermaid es solo lectura: no se arrastra nada, sin responsables, estilos limitados |
| **Excalidraw** | Canvas fluido con pan/zoom, local-first (autoguardado en el navegador), historial deshacer/rehacer, atajos, tema claro/oscuro, `.excalidraw` JSON, links de colaboración, biblioteca | Es dibujo libre; aquí necesitamos estructura (fechas, dependencias) |
| **PlantUML Gantt** | Sintaxis casi en lenguaje natural ("starts at", "lasts 5 days"), recursos asignables | Sintaxis verbosa |
| **Mermaid Gantt** | `dateFormat`, `axisFormat`, `section`, `after`, `crit/active/done/milestone`, `excludes` | Es difícil recordar el orden `id, inicio, duración` |
| **TeamGantt / GanttPRO / Instagantt** | Drag & drop, dependencias, ruta crítica, línea base, vista de carga de trabajo, snapshots públicos, IA para generar plan | Son pesadas, de pago, no basadas en código |

## 2. Features de mercado a considerar

**Núcleo (MVP)**
- Editor de código con resaltado, autocompletado y errores en línea.
- Render SVG en vivo, con sincronización bidireccional código ⇄ UI.
- Tareas, secciones/grupos, hitos, dependencias (`after`), duración o fechas.
- Responsables: persona o equipo, con color y avatar/iniciales.
- Estados: pendiente, en curso, hecho, bloqueado; % de avance.
- Zoom de escala temporal (día, semana, mes, trimestre, año).
- Exportar SVG, PNG, PDF, y compartir enlace.
- Autoguardado local, deshacer/rehacer, tema claro/oscuro.

**Interactividad**
- Arrastrar barra para mover, bordes para redimensionar, arrastrar a otra fila para reordenar o cambiar de sección.
- Crear dependencia arrastrando de una barra a otra.
- Selección múltiple, snap a la grilla, atajos de teclado, menú contextual.
- Al editar con la UI se reescribe el código de forma mínima (el diff es legible).
- Animaciones con spring/ease en mover, expandir/colapsar, zoom y cambios de escala.

**Nivel de detalle y personalización** (requisito propio)
- **Vistas** independientes por caso de uso dentro del mismo archivo: `view ejecutivo`, `view equipo`, `view qa`. Cada una define escala, qué niveles mostrar, filtros por responsable/etiqueta, columnas, colores y densidad.
- Colapsar secciones por nivel (portfolio → proyecto → fase → tarea → subtarea).
- Temas y tokens: colores, tipografía, altura de fila, radios, grilla, líneas de hoy/hitos.
- Columnas configurables (responsable, inicio, fin, duración, %).

**Planificación avanzada (fase 2)**
- Calendario laboral: fines de semana, feriados, vacaciones por persona.
- Ruta crítica y holgura calculadas.
- Línea base vs plan actual.
- Carga de trabajo por persona/equipo (heatmap, alertas de sobreasignación).
- Tipos de dependencia FS/SS/FF/SF con retraso (lag).
- Rangos de fechas relativos ("after api +2d").

**Colaboración e integración (fase 3)**
- Colaboración en tiempo real (CRDT, tipo Excalidraw).
- Import/export: Mermaid gantt, CSV, JSON, Jira/Asana/Linear, ICS, MS Project.
- Generación de plan con IA a partir de texto en lenguaje natural.
- Embeds (iframe/imagen) y snapshots públicos de solo lectura.
- Comentarios en tareas, historial de versiones.

## 3. Propuesta de sintaxis (DSL "gantt-as-code")

Principios: pocas palabras clave, una tarea por línea, orden libre de atributos, todo opcional salvo el nombre.

```
gantt "Lanzamiento App"
start 2026-11-02
calendar mon-fri, skip 2026-12-25
scale week

team Backend   #4f8cff
team Diseño    #ff7ab6
person Ana     @Backend
person Luis    @Diseño

section Descubrimiento
  Entrevistas      @Luis    5d
  Requisitos       @Ana     3d  after Entrevistas
  Revisión ✓       milestone after Requisitos

section Desarrollo
  API              @Backend 10d after Requisitos  #crit
  UI               @Diseño  8d  after Requisitos  60%
  Integración      @Ana     5d  after API, UI     status:blocked
  Lanzamiento      milestone 2026-12-18

view ejecutivo
  show section, milestone
  scale month

view equipo
  show all
  filter @Backend
  scale day
```

Reglas: `@` responsable, `#` etiqueta/color, `5d` duración, `60%` avance, `after X` dependencia, fecha ISO inicio, `milestone` hito. Los comentarios usan `//`.

## 4. Stack sugerido

- **Vite + TypeScript** (sin servidor, desplegable estático).
- **Preact o Svelte** para UI liviana; **SVG** para el render del Gantt (export nítido).
- **CodeMirror 6** para el editor (resaltado, autocompletado, linter propio).
- Parser propio (hecho a mano o Lezer) → AST → modelo → render; escritura inversa AST → texto con ediciones mínimas.
- **Motion One / Web Animations** o `framer-motion` equivalente para animaciones; `@use-gesture` para drag.
- Persistencia: `localStorage`/IndexedDB + estado en la URL (comprimido).
- Tests con Vitest, e2e con Playwright.

## 5. Hoja de ruta

1. ✅ Parser + modelo + render + editor en vivo (split view).
2. ✅ Interacción: mover/redimensionar/reordenar/anidar con reescritura de código.
3. ✅ Equipos, personas, estados, dependencias visuales (crear arrastrando, quitar con clic).
4. ✅ Vistas y nivel de detalle, temas, columnas, filtros, densidad, color.
5. ✅ Export SVG/PNG, compartir por URL, deshacer/rehacer, atajos, importar Mermaid. ⏳ PDF.
6. ✅ Calendario y feriados. ⏳ Ruta crítica calculada, línea base, vista de carga de trabajo.
7. ✅ Documentación integrada. ⏳ Colaboración en tiempo real, múltiples documentos.

> La sintaxis implementada difiere en detalles de la propuesta de la sección 3 (estados con `#done` / `#active` / `#blocked` en lugar de `status:`, niveles con `detail`, elementos con `show` / `hide`). La referencia vigente es [SINTAXIS.md](SINTAXIS.md).

## Fuentes
- [Mermaid Gantt docs (mirror)](https://docs.paradime.io/app-help/integrations/mermaid-js/gantt-diagrams)
- [Guía Mermaid Gantt](https://macmdviewer.com/blog/mermaid-gantt-chart-guide)
- [Top Gantt software 2026 — Instagantt](https://www.instagantt.com/guides/top-gantt-chart-software)
- [Instagantt vs GanttPRO](https://www.instagantt.com/compare/ganttpro)
- [Mermaid / PlantUML / Excalidraw](https://dasroot.net/posts/2026/04/creating-technical-diagrams-mermaid-plantuml-excalidraw/)

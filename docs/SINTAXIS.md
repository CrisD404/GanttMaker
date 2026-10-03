# Sintaxis de GanttMaker

GanttMaker dibuja un diagrama de Gantt a partir de texto. **Una línea = una instrucción.** Todo lo que hacés con el mouse (mover, estirar, conectar, renombrar) se escribe en el código, y todo lo que escribís en el código se ve al instante en el gráfico.

```
gantt "Mi proyecto"
start 2026-11-02

section Diseño
  Bocetos @Ana 5d
  Prototipo @Ana 3d
  Aprobación milestone

section Desarrollo
  API @Luis 10d after Bocetos #crit
  App @Sofía 8d after Prototipo 40%
```

> **Regla de oro:** `@` es *quién*, `#` es *qué tipo* (estado, etiqueta o color), un número con `d` o `w` es *cuánto dura*, y `after` es *después de qué*.

## Resumen rápido

| Escribís | Significa |
|---|---|
| `gantt "Título"` | Título del diagrama |
| `start 2026-11-02` | Fecha de inicio del proyecto |
| `section Nombre` | Agrupa las tareas que siguen |
| `Tarea 5d` | Tarea de 5 días hábiles |
| `Tarea 2w` | Tarea de 2 semanas hábiles |
| `Tarea 2026-11-10` | Empieza en esa fecha |
| `Tarea 2026-11-10..2026-11-20` | Inicio y fin exactos |
| `@Ana` | Responsable (persona o equipo) |
| `after Diseño, API` | Empieza cuando terminan esas tareas |
| `60%` | Avance |
| `milestone` | Hito (un punto en el tiempo) |
| `#done` `#active` `#blocked` | Estado |
| `#crit` | Tarea crítica |
| `#backend` | Etiqueta libre (para filtrar) |
| `#ff7ab6` | Color propio de la barra |
| `sprints 2w` | Sprints de 2 semanas (escala `sprint`) |
| `view Nombre` | Vista con su propio detalle, escala y filtros |
| `// comentario` | Se ignora |

## Tareas

Una tarea es **un nombre seguido de atributos**, en cualquier orden:

```
section Desarrollo
  Diseño de base de datos @Luis 3d #backend
  Endpoints de pagos 8d @Luis after Diseño de base de datos 25%
```

- El nombre termina en el primer atributo (`@`, `#`, duración, fecha, `after`, `milestone`, `%`).
- Si el nombre contiene algo que parece un atributo, ponelo **entre comillas**: `"Fase 2d" 3d`.
- Si no indicás duración, la tarea dura **1 día**.

### Orden por defecto

Si una tarea no tiene fecha ni `after`, **empieza cuando termina la anterior** de su mismo grupo. La primera tarea de cada sección empieza en la fecha `start` del proyecto. Así podés escribir una lista y ya tenés un cronograma:

```
section Lanzamiento
  QA 5d
  Correcciones 3d
  Publicación 1d
```

### Duraciones y fechas

| Forma | Ejemplo | Notas |
|---|---|---|
| Días hábiles | `5d` | Saltea fines de semana y feriados según `calendar` |
| Semanas | `2w` | 2 × días hábiles por semana |
| Fecha de inicio | `2026-11-10` | Si cae en día no laborable, se corre al siguiente |
| Inicio y fin | `2026-11-10..2026-11-20` | El fin es inclusivo. También vale `2026-11-10 -> 2026-11-20` |

### Dependencias

`after` recibe una o varias tareas separadas por coma. La tarea empieza **cuando terminan todas**:

```
  Integración 5d after API, App
```

Las referencias usan el **nombre** de la tarea (sin distinguir mayúsculas). Si querés un identificador corto, agregá `id:`:

```
  Autenticación con proveedores externos id:auth 5d
  Pantalla de login 3d after auth
```

Si una tarea tiene fecha **y** `after`, la fecha es "no antes de": empieza en la fecha indicada o cuando terminen sus dependencias, lo que ocurra después.

### Hitos

Un hito marca un momento (entrega, aprobación, lanzamiento). Se dibuja como un rombo:

```
  Beta lista milestone after Integración
  Lanzamiento milestone 2026-12-18
```

`0d` también crea un hito.

### Subtareas

Indentá para crear subtareas. La tarea padre se calcula sola: empieza con su primera subtarea y termina con la última.

```
section Desarrollo
  API
    Modelo de datos 3d
    Autenticación 5d
  App
    Navegación 5d
    Pantallas 10d
```

## Responsables

Asigná personas o equipos con `@`. Podés asignar varios: `@Ana @Luis`.

Declararlos es **opcional**, pero te permite elegir colores y armar equipos:

```
team Backend #5b5bf7
team Diseño #ec4899
person Ana @Diseño
person Luis @Backend #0ea5e9
person "María José" @Diseño
```

- Un `@Nombre` que no fue declarado se crea automáticamente como persona.
- Si filtrás por un equipo (`filter @Backend`), también aparecen las tareas de sus personas.
- Nombres con espacios van entre comillas: `@"María José"`.

## Estados y etiquetas

| Etiqueta | Efecto |
|---|---|
| `#done` | Terminada (barra atenuada con ✓). También `100%` |
| `#active` | En curso |
| `#blocked` | Bloqueada (barra rayada) |
| `#crit` | Crítica (borde rojo, flechas rojas entre críticas) |
| `#cualquier-cosa` | Etiqueta libre, útil para filtrar vistas |
| `#f59e0b` o `#f90` | Color propio de la barra |

## Calendario

```
start 2026-11-02          // inicio del proyecto
calendar mon-fri          // días laborables (por defecto lunes a viernes)
holiday 2026-12-25, 2026-12-31
holiday 2026-12-24..2026-12-26
today 2026-11-15          // opcional: fija la fecha de "hoy"
```

`calendar` acepta `mon-fri`, `mon-sat`, `all` o una lista: `mon,tue,thu`. Días: `mon tue wed thu fri sat sun`.

## Sprints

Definí la cadencia de tus sprints y usá la escala `sprint`:

```
gantt "Producto Q4"
start 2026-10-05
sprints 2w "Sprint {n}" first 14
scale sprint

section Pagos
  API de pagos @Marta 6d
  Checkout @Diego 5d after API de pagos
```

| Forma | Significa |
|---|---|
| `sprints 2w` | Sprints de 2 semanas desde el lunes de la semana de `start` |
| `sprints 10d` | Duración en **días corridos** (no hábiles) |
| `sprints 2w from 2026-10-07` | Primer sprint en otra fecha |
| `sprints 2w "Iteración {n}"` | Nombre con número (`{n}`) |
| `sprints 2w first 14` | La numeración arranca en 14 (para continuar la del equipo) |
| `sprint "Hardening" 2026-12-01..2026-12-12` | Sprint con fechas propias (también `sprint Hardening 2026-12-01 1w`) |

- Si hay sprints con fechas propias (`sprint …`), se usan esos y la cadencia se ignora.
- Con la escala `sprint` el encabezado muestra los sprints arriba. En otras escalas aparece una **fila de sprints** extra y bandas alternadas en el gráfico (se ocultan con `hide sprints`).
- Si elegís la escala *Sprint* sin declarar nada, se usan sprints de 2 semanas.
- Clic derecho en el encabezado → **Sprints** para configurarlos sin escribir código.

## Vistas y nivel de detalle

Un mismo plan sirve a públicos distintos. Los **ajustes** se escriben en el nivel superior (vista *Principal*) o dentro de un bloque `view`, que hereda de la principal y cambia solo lo que indique:

```
scale week
density normal

view Ejecutivo
  scale month
  detail sections
  columns none
  hide avatars, deps

view Equipo Backend
  filter @Backend
  detail all
  columns owner, start, end, duration, progress

view Riesgos
  filter #crit #blocked
  color status
```

Cada vista aparece como una pestaña sobre el gráfico. Los controles de la barra (escala, detalle, columnas…) **escriben en la vista activa**.

| Ajuste | Valores | Para qué |
|---|---|---|
| `scale` | `day` `week` `sprint` `month` `quarter` `year` | Escala de tiempo. Sin indicar, se elige sola según la duración. El zoom (Ctrl + rueda) la afina y el eje se adapta |
| `detail` | `sections` `tasks` `subtasks` `all` o `1` `2` `3`… | Cuántos niveles mostrar. Los niveles ocultos se resumen en la barra del padre (con sus hitos) |
| `columns` | `owner` `start` `end` `duration` `progress` o `none` | Columnas de la grilla izquierda |
| `show` / `hide` | `deps` `today` `weekends` `progress` `avatars` `labels` `grid` `sprints` o `all` | Elementos visuales |
| `density` | `compact` `normal` `comfortable` | Alto de las filas |
| `color` | `owner` `section` `status` | Criterio de color de las barras |
| `filter` | `@responsable` `#etiqueta` `"texto"` | Solo tareas que coinciden (responsables **y** etiquetas **y** texto) |
| `range` | `2026-11-01..2026-12-31` | Recorta el período visible |

## Usar la interfaz

| Acción | Cómo |
|---|---|
| Mover una tarea | Arrastrá la barra |
| Cambiar duración | Arrastrá el borde derecho (o el izquierdo para cambiar el inicio) |
| Crear dependencia | Pasá el mouse por la barra y arrastrá el punto ● de la derecha hasta otra tarea |
| Ver dependencias | Pasá el mouse por una barra: se resaltan sus flechas y las tareas conectadas |
| Quitar dependencia | Clic en la flecha → botón ✕, Supr o doble clic |
| Editar todo | Clic en la barra abre el panel de edición |
| Reordenar / anidar | Arrastrá el asa ⋮⋮ de la fila: arriba/abajo de otra fila, en el centro para hacerla subtarea, sobre una sección para moverla ahí |
| Colapsar | Flecha ▾ junto al nombre, o doble clic en la barra resumen |
| Desplazarse | Arrastrá el fondo del gráfico, el encabezado o la zona vacía de la grilla. Desde cualquier lugar: **Espacio + arrastrar** o el **botón del medio** |
| Zoom | Ctrl + rueda del mouse, los botones − / +, o doble clic en el encabezado |
| Abrir archivos | Arrastrá un `.gantt` o un Gantt de **Mermaid** a la ventana (se abre en un espacio nuevo) |

### Doble clic: acción rápida según el lugar

| Dónde | Qué hace |
|---|---|
| Espacio vacío del gráfico | Crea una tarea **en esa fecha**, junto a esa fila, y te deja escribir el nombre |
| Barra de una tarea o hito | Renombrar ahí mismo |
| Barra de una sección o tarea padre | Colapsar / expandir |
| Flecha de dependencia | Quitarla |
| Avatar de un responsable | Filtrar por esa persona o equipo |
| Encabezado (mes, semana, sprint…) | Zoom animado para ver ese período completo |
| Nombre en la grilla | Renombrar |
| Celda de responsable, inicio, fin, duración o avance | Editarla en línea |
| Fila de sección | Renombrar la sección |
| Debajo de las filas (grilla) | Nueva tarea en la última sección |
| Pestaña de vista / espacio libre de pestañas | Renombrar la vista / crear una vista nueva |
| Espacio en la lista de Espacios | Renombrarlo |

### Clic derecho: menú contextual

Hay un menú en cada parte de la pantalla: **tareas** (editar, agregar, estado, crítica, color, filtrar, eliminar), **secciones** (agregar, renombrar, color, ajustar zoom), **espacio vacío** (tarea u hito en esa fecha, escala), **flechas** (ir al origen/destino, quitar), **encabezado** (escala, ajustar, configurar sprints), **títulos de columnas** (elegir columnas), **pestañas** (renombrar, duplicar, eliminar) y **espacios** (abrir, renombrar, duplicar, eliminar).

### Filtros rápidos (dock)

El dock flotante de abajo filtra **al instante y sin tocar el código**, para explorar mientras mirás el gráfico:

- **Buscar** por nombre, responsable o etiqueta (tecla `/`).
- **Responsables**: clic en los avatares (un equipo incluye a sus personas). Se ven los primeros 5; el resto está en **+N**, con búsqueda.
- **Estados**: críticas, en curso, bloqueadas, hechas, hitos y tus etiquetas.
- El botón del **ojo** alterna entre **ocultar** lo que no coincide o **atenuarlo** para verlo en contexto.
- El botón **Guardar** (disquete) escribe el filtro en el código de la vista activa (`filter …`).
- Se pliega con la flecha o la tecla `F`.

## Presentar

El botón **Presentar** (o la tecla `P`) muestra el gantt a pantalla completa, encuadrado y **de solo lectura**: nada se mueve por accidente. Abajo aparece un dock que se oculta solo cuando no movés el mouse:

| Herramienta | Tecla | Qué hace |
|---|---|---|
| Mover y destacar | `V` | Arrastrá para desplazarte. **Clic en una tarea** para destacarla junto con sus dependencias (el resto se atenúa) |
| Puntero láser | `L` | Un punto rojo con estela para señalar |
| Foco | `F` | Oscurece todo salvo un círculo que sigue al puntero (`[` `]` o Alt + rueda cambian el tamaño) |
| Zoom | `+` `-` `0` | Acercar, alejar y encuadrar todo el proyecto |
| Vista | `←` `→` | Pasar de una vista a otra (principal, ejecutiva, por equipo…) |
| Tema | `T` | Claro u oscuro (el claro suele verse mejor en proyectores) |
| Salir | `Esc` | Termina la presentación |

## Espacios

Cada **espacio** es un diagrama independiente guardado en tu navegador. Desde el botón *Espacios* (arriba a la izquierda) podés:

- Cambiar de espacio (cada uno recuerda su vista activa y su propio historial de deshacer).
- Crear uno **en blanco** o desde una **plantilla**: lanzamiento de app, producto por sprints, evento o conferencia, obra de construcción, campaña de marketing e implementación SaaS, cada una con vista previa.
- Renombrar (doble clic), duplicar o eliminar (con *Deshacer*).

### Tus datos

Todo se guarda **automáticamente en este navegador** (el indicador *Guardado* de arriba lo confirma). Tus espacios siguen ahí cada vez que vuelvas **con el mismo navegador**, mientras no borres sus datos. Además:

- GanttMaker pide al navegador **almacenamiento persistente**, para que no lo borre al liberar espacio (si lo concede, el indicador muestra un escudo).
- Se guarda también al cerrar o cambiar de pestaña, y si lo tenés abierto en dos pestañas se mantienen sincronizadas.
- Para llevar tus espacios a otro navegador o equipo usá *Archivo → Copia de seguridad de espacios*.

### Tutorial

La primera vez se muestra un recorrido por lo esencial. Lo repetís cuando quieras desde el botón **?** → *Repetir tutorial*.

Los enlaces compartidos y los archivos que abrís también llegan como espacios nuevos: nunca pisan lo que ya tenías.

### Atajos de teclado

| Tecla | Acción |
|---|---|
| `Ctrl+Z` / `Ctrl+Shift+Z` | Deshacer / rehacer (UI y código comparten historial) |
| `←` `→` | Mover la tarea seleccionada 1 día (`Shift`: 5 días) |
| `↑` `↓` | Seleccionar la tarea anterior / siguiente |
| `Enter` | Abrir el panel de edición |
| `Alt+Enter` | Nueva tarea debajo |
| `F2` | Renombrar |
| `Ctrl+D` | Duplicar |
| `Supr` | Eliminar (la tarea o la flecha seleccionada) |
| `1`…`6` | Escala día / semana / sprint / mes / trimestre / año |
| `+` `-` `0` | Zoom |
| `Shift+1` | Ajustar el zoom a todo el proyecto |
| `T` | Ir a hoy |
| `P` | Presentar |
| `Espacio` + arrastrar | Desplazarse por el gráfico |
| `/` | Buscar en el dock de filtros |
| `F` | Mostrar/ocultar el dock de filtros |
| `E` | Mostrar/ocultar el código |
| `?` | Esta ayuda |
| `Ctrl+Espacio` | Sugerencias en el editor |

## Guardar y compartir

- **Autoguardado:** cada espacio se guarda en tu navegador mientras escribís. No hay servidor: nada sale de tu equipo.
- **Compartir:** el botón *Compartir* copia un enlace que **contiene el diagrama completo** (comprimido en la URL). Quien lo abre lo recibe en un espacio nuevo.
- **Archivo → Descargar código** guarda un `.gantt` (texto plano, ideal para Git).
- **Exportar SVG / PNG** genera una imagen de la vista activa.
- **Importar Mermaid:** abrí o arrastrá un archivo con un `gantt` de Mermaid y se convierte automáticamente.
- **Copia de seguridad:** *Archivo → Copia de seguridad de espacios* descarga todos tus espacios en un `.json`; abrilo (o arrastralo) en otro navegador para recuperarlos.

## Descargar la app

Botón **App** (arriba a la derecha):

- **Instalar como aplicación:** se abre en su propia ventana, funciona **sin conexión**, abre archivos `.gantt` y comparte los espacios con la versión web.
- **Archivo HTML sin conexión:** toda la app en un solo archivo (`ganttmaker.html`). Abrilo con doble clic, sin internet ni instalación. Sus datos se guardan en el navegador donde lo abras: para moverlos usá la copia de seguridad.

## Ejemplo completo

```
gantt "Lanzamiento App Móvil"
start 2026-10-05
calendar mon-fri
holiday 2026-12-08, 2026-12-25

team Producto #8b5cf6
team Backend #5b5bf7
team Mobile #14b8a6
person Ana @Producto
person Luis @Backend
person Sofía @Mobile

section Descubrimiento
  Entrevistas con usuarios @Ana 5d #done
  Benchmark de mercado @Ana 3d #done
  Definición de alcance @Producto 2d after Entrevistas con usuarios, Benchmark de mercado 100%
  Alcance aprobado milestone

section Desarrollo
  API
    Modelo de datos @Luis 3d after Alcance aprobado
    Autenticación @Luis 5d #crit
  App
    Pantallas principales @Sofía 10d after Alcance aprobado
  Beta interna milestone after API, App

view Ejecutivo
  scale month
  detail sections
  columns none
```

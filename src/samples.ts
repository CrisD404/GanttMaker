export const SAMPLE = `gantt "Lanzamiento App Móvil"
start 2026-10-05
calendar mon-fri
holiday 2026-12-08, 2026-12-25

// Responsables: equipos y personas (los colores son opcionales)
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

section Diseño
  Wireframes @Ana 5d after Alcance aprobado 80% #active
  Sistema de diseño @Ana 4d after Alcance aprobado 40%
  Prototipo navegable @Ana 3d after Wireframes, Sistema de diseño

section Desarrollo
  API
    Modelo de datos @Luis 3d after Alcance aprobado
    Autenticación @Luis 5d #crit
    Endpoints de pagos @Luis 8d #crit
  App
    Navegación y layout @Sofía 5d after Prototipo navegable
    Pantallas principales @Sofía 10d
    Integración con API @Sofía 5d after Endpoints de pagos #crit
  Beta interna milestone after API, App

section Lanzamiento
  QA y corrección de bugs @Mobile 8d after Beta interna #crit
  Publicación en tiendas @Mobile 3d #crit
  Salida al mercado milestone

// Vistas: el mismo plan con otro nivel de detalle
view Ejecutivo
  scale month
  detail sections
  columns none
  hide avatars

view Backend
  filter @Backend
  scale week
  columns owner, start, end, duration, progress
`;

export const SAMPLE_SPRINTS = `gantt "Producto Q4 · por sprints"
start 2026-10-05
calendar mon-fri
// Cadencia de 2 semanas; la numeración continúa la del equipo
sprints 2w "Sprint {n}" first 14
scale sprint

team Plataforma #0ea5e9
team Web #8b5cf6
person Marta @Plataforma
person Diego @Web
person Lucía @Web

section Épica: Pagos
  Diseño de la API de pagos @Marta 4d #done
  Integración con la pasarela @Marta 6d #active 50%
  Pantalla de checkout @Diego 5d after Diseño de la API de pagos #active 30%
  Pruebas end-to-end @Lucía 3d after Integración con la pasarela, Pantalla de checkout
  Pagos en producción milestone #crit

section Épica: Perfil de usuario
  Modelo de perfil @Marta 3d after Integración con la pasarela
  Edición de perfil @Diego 5d after Pantalla de checkout
  Preferencias y notificaciones @Lucía 4d after Edición de perfil
  Perfil disponible milestone

section Calidad
  Hardening y deuda técnica @Plataforma 1w after Pagos en producción #crit
  Release Q4 milestone after Hardening y deuda técnica, Perfil disponible

view Planning
  scale sprint
  detail tasks
  columns owner, duration, progress

view Roadmap
  scale month
  detail sections
  columns none
`;

export const EMPTY = `gantt "Mi proyecto"
start ${new Date().toISOString().slice(0, 10)}

section Fase 1
  Primera tarea 3d
  Segunda tarea 5d
  Entrega milestone
`;

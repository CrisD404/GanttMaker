// Plantillas: casos de uso típicos listos para adaptar. Todas compilan sin errores (ver tests).
import { EMPTY, SAMPLE, SAMPLE_SPRINTS } from './samples';

export interface Template {
  id: string;
  title: string;
  description: string;
  /** Qué muestra de GanttMaker (se ven como etiquetas). */
  features: string[];
  icon: string;
  text: string;
}

const EVENT = `gantt "Conferencia anual de producto"
start 2026-11-02
calendar mon-fri
holiday 2026-12-08, 2026-12-25

team Producción #f97316
team Marketing #ec4899
team Contenido #8b5cf6
person Carla @Producción
person Martín @Marketing
person Julia @Contenido

section Planificación
  Objetivos y presupuesto @Carla 3d #done
  Reserva de la sede @Carla 5d #done
  Fecha y sede confirmadas milestone #crit

section Contenido
  Convocatoria a oradores @Julia 10d after Fecha y sede confirmadas 70% #active
  Selección de charlas @Julia 5d
  Agenda publicada milestone

section Marketing
  Identidad visual del evento @Martín 5d after Fecha y sede confirmadas 60% #active
  Sitio web e inscripciones @Martín 8d
  Campaña de difusión @Marketing 4w after Agenda publicada, Sitio web e inscripciones

section Logística
  Catering y técnica @Carla 6d after Agenda publicada
  Acreditaciones y kits @Producción 5d
  Ensayo general @Producción 1d after Catering y técnica, Acreditaciones y kits #crit
  Día del evento milestone #crit

view Comité
  scale month
  detail sections
  columns none

view Marketing
  filter @Marketing
  columns owner, start, end, progress
`;

const CONSTRUCTION = `gantt "Construcción de vivienda"
start 2027-02-01
// En obra se trabaja de lunes a sábado
calendar mon-sat
holiday 2027-02-15..2027-02-16, 2027-03-24

team Obra #f59e0b
team Instalaciones #0ea5e9
team Terminaciones #22c55e
person Romero @Obra
person Gómez @Instalaciones
person Sosa @Terminaciones

section Proyecto y permisos
  Planos y cómputos @Romero 10d #done
  Aprobación municipal 15d after Planos y cómputos #crit
  Permiso de obra milestone #crit

section Estructura
  Movimiento de suelos @Obra 5d after Permiso de obra
  Fundaciones @Obra 8d #crit
  Estructura de hormigón @Obra 3w #crit
  Mampostería @Romero 2w

section Instalaciones
  Eléctrica @Gómez 8d after Mampostería
  Sanitaria y gas @Instalaciones 8d after Mampostería
  Inspección de instalaciones milestone after Eléctrica, Sanitaria y gas

section Terminaciones
  Revoques y yesería @Sosa 10d after Inspección de instalaciones
  Pisos y revestimientos @Terminaciones 8d
  Pintura @Sosa 6d
  Entrega de llaves milestone #crit

view Cliente
  scale month
  detail sections
  columns none
  hide avatars, weekends

view Semanal
  scale week
  color status
  columns owner, start, end, duration
`;

const MARKETING = `gantt "Campaña de lanzamiento"
start 2027-01-11
calendar mon-fri

team Marketing #ec4899
team Diseño #8b5cf6
team Datos #14b8a6
person Paula @Marketing
person Tomás @Diseño
person Inés @Datos

section Estrategia
  Brief y objetivos @Paula 3d #done
  Investigación de audiencia @Inés 5d #done
  Mensajes clave @Paula 3d after Brief y objetivos, Investigación de audiencia 50% #active
  Estrategia aprobada milestone #crit

section Creatividades
  Concepto creativo @Tomás 5d after Estrategia aprobada #crit
  Piezas para redes @Tomás 8d
  Video de lanzamiento @Diseño 2w after Concepto creativo #crit
  Landing page @Tomás 6d after Concepto creativo

section Medios
  Plan de medios @Paula 4d after Estrategia aprobada
  Campañas pagas @Marketing 3d after Plan de medios, Piezas para redes
  Lanzamiento milestone after Video de lanzamiento, Landing page, Campañas pagas #crit

section Medición
  Tablero de métricas @Inés 5d after Plan de medios
  Optimización semanal @Datos 3w after Lanzamiento
  Informe final @Inés 3d #crit

view Ejecutivo
  scale month
  detail sections
  columns none

view Estado
  color status
  columns owner, progress
`;

const SAAS = `gantt "Implementación para cliente"
start 2026-11-16
calendar mon-fri
holiday 2026-12-25, 2027-01-01
sprints 2w

team Consultoría #5b5bf7
team Soporte #14b8a6
team Cliente #f59e0b
person Valeria @Consultoría
person Bruno @Soporte
person "Equipo IT" @Cliente

section Inicio
  Kickoff con el cliente @Valeria 1d #done
  Relevamiento de procesos @Valeria 5d #done
  Plan aprobado milestone #crit

section Configuración
  Plataforma
    Configuración de la cuenta @Valeria 5d after Plan aprobado 70% #active
    Roles y permisos @Valeria 3d
  Integraciones
    API del ERP @Bruno 8d after Plan aprobado #crit
    Single sign-on @"Equipo IT" 4d #blocked

section Migración
  Limpieza de datos @"Equipo IT" 6d after Plan aprobado
  Migración de prueba @Bruno 3d after Limpieza de datos, Plataforma
  Validación con el cliente @Cliente 4d #crit
  Migración final @Bruno 2d #crit

section Puesta en marcha
  Material de capacitación @Valeria 5d after Plataforma
  Sesiones con usuarios @Valeria 4d after Material de capacitación, Migración de prueba
  Go-live milestone after Migración final, Sesiones con usuarios, Integraciones #crit
  Soporte reforzado @Soporte 2w after Go-live
  Cierre del proyecto milestone

view Cliente
  scale sprint
  detail tasks
  columns none
  hide avatars

view Equipo interno
  filter @Consultoría @Soporte
  columns owner, start, end, progress
`;

export const TEMPLATES: Template[] = [
  {
    id: 'blank',
    title: 'En blanco',
    description: 'Una sección con un par de tareas y un hito para arrancar de cero.',
    features: ['Mínimo'],
    icon: 'filePlus',
    text: EMPTY,
  },
  {
    id: 'app',
    title: 'Lanzamiento de app',
    description: 'Del descubrimiento a las tiendas: equipos, subtareas, dependencias, hitos y una vista ejecutiva.',
    features: ['Equipos', 'Subtareas', 'Vistas', 'Hitos'],
    icon: 'sparkle',
    text: SAMPLE,
  },
  {
    id: 'sprints',
    title: 'Producto por sprints',
    description: 'Épicas planificadas en sprints de 2 semanas con numeración continua, planning y roadmap.',
    features: ['Sprints', 'Épicas', 'Avance'],
    icon: 'calendar',
    text: SAMPLE_SPRINTS,
  },
  {
    id: 'event',
    title: 'Evento o conferencia',
    description: 'Sede, oradores, difusión y logística hasta el día del evento, con una vista para el comité.',
    features: ['Hitos', 'Filtro por equipo', 'Feriados'],
    icon: 'users',
    text: EVENT,
  },
  {
    id: 'construction',
    title: 'Obra de construcción',
    description: 'Permisos, estructura, instalaciones y terminaciones con calendario de lunes a sábado.',
    features: ['Ruta crítica', 'Lunes a sábado', 'Vista cliente'],
    icon: 'layers',
    text: CONSTRUCTION,
  },
  {
    id: 'marketing',
    title: 'Campaña de marketing',
    description: 'Estrategia, creatividades, medios y medición; con vista ejecutiva y vista por estado.',
    features: ['Estados', 'Color por estado', 'Dependencias'],
    icon: 'target',
    text: MARKETING,
  },
  {
    id: 'saas',
    title: 'Implementación SaaS',
    description: 'Onboarding de un cliente: configuración, integraciones, migración y go-live por sprints.',
    features: ['Subtareas', 'Bloqueos', 'Sprints', 'Cliente'],
    icon: 'grid',
    text: SAAS,
  },
];

# MiCalorías Estable — PWA local para iPhone (Versión Recuperada y Aislada)

Copia independiente y congelada de la versión funcional anterior (commit `d8893d0`), aislada para permitir su uso seguro mientras se estabiliza la versión 4.0.

- **URL de producción**: `https://cristopherce08.github.io/AppCalorias-Estable/`
- **Base IndexedDB aislada**: `micalorias-estable-local-v1`
- **Cache Storage aislado**: `micalorias-estable-shell-v1`

Aplicación web progresiva gratuita, privada y local, sin backend, sin cuentas de usuario, sin notificaciones y sin servicios externos. Todos los datos y registros se guardan en **IndexedDB** en el iPhone que la abre y funciona sin conexión mediante **Service Worker**.

## Novedades de la Versión 3.1
- **Actualización transparente en pantalla de inicio de iOS**: Detección automática de nuevas versiones publicadas en GitHub Pages mediante `ServiceWorkerRegistration.update()` al abrir la aplicación y al volver a primer plano desde la multitarea de iPhone.
- **Activación segura sin interrupción**: Si hay formularios activos o alimentos en preparación, la aplicación no interrumpe el registro y muestra un aviso discreto («Nueva versión disponible — Actualizar»). Si la aplicación está inactiva o se reanuda, se actualiza automáticamente.
- **Prevención de bucles y descargas limpias**: Estrategia de recarga controlada (`controllerchange` con bandera única) y obtención forzada de recursos limpios (`cache: 'reload'`).
- **Preservación total de datos**: Las actualizaciones de la shell renuevan únicamente el código en caché estática sin alterar IndexedDB ni las configuraciones locales.

## Novedades de la Versión 3.0
- **Calculadora de gasto calórico**: Estimación determinista del gasto energético en reposo (RMR) y mantenimiento diario (TDEE) mediante la ecuación validada **Mifflin-St Jeor (1990)** con multiplicadores de actividad física poblacionales.
- **Resultados informativos y metas opcionales**:
  - Opción A: Consulta informativa de mantenimiento que se muestra como referencia en «Hoy», sin barras de progreso ni obligaciones.
  - Opción B: Establecer voluntariamente como meta diaria con diálogo de confirmación y ajuste manual.
  - Escenarios orientativos: Mantenimiento, reducción gradual conservadora y aumento gradual conservador (destinado a adultos; advertencias para menores, embarazo o lactancia).
- **Seguimiento semanal de peso («Mi peso»)**:
  - Registro de peso corporal en kg con fecha y notas.
  - Cálculo de cambio reciente vs. medición anterior y cambio total acumulado.
  - Gráfica de evolución responsive en SVG nativo (100% offline) con filtros por período (4 semanas, 3 meses, todo el historial) y tabla de datos accesible.
- **Actualización inteligente de la estimación**: Al registrar un nuevo peso más reciente, la estimación de mantenimiento se recalcula automáticamente si existe un perfil. Las metas calóricas activas **nunca se modifican solas**, mostrando en su lugar una sugerencia opcional para revisar o mantener el objetivo.
- **Seguimiento dual de calorías y proteínas**: Registro por ingrediente con cálculo por peso (g/ml) o porciones (scoop, lata, rebanada, unidad, etc.).
- **Biblioteca «Mis alimentos»**: Guardado de ingredientes recurrentes con favoritos y porciones personalizadas.
- **Retrocompatibilidad total**: Migración automática y compatibilidad de respaldos JSON versión 1.0, 2.0 y 3.0 sin pérdida de datos.

## Instalación en iPhone desde Safari

1. Abre la URL en **Safari en tu iPhone**:
   `https://cristopherce08.github.io/AppCalorias-Estable/`
2. Espera a que cargue por completo para registrar el Service Worker y guardar los archivos en caché.
3. Pulsa el botón **Compartir** de Safari (icono del cuadrado con flecha hacia arriba).
4. Selecciona **«Añadir a pantalla de inicio»** → pulsa **«Añadir»**.
5. Abre **MiCalorías** desde el icono en tu pantalla de inicio.
6. Funciona completamente sin conexión (puedes activar el Modo Avión para verificarlo).

## Dónde se almacenan los datos

Se almacenan exclusivamente en el **IndexedDB** de la PWA en tu iPhone. No se transmite ningún dato a servidores externos. Para proteger tu información ante limpiezas de almacenamiento de iOS, exporta periódicamente una copia desde **Ajustes → Exportar copia de seguridad** y guárdala en la app **Archivos** o en **iCloud Drive**.

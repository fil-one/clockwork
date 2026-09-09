import type { MessageCatalog } from "./en";

/** Spanish interface copy. Identifiers, legal records and user data are not translated. */
export const es = {
  "quotes.form.description":
    "Elige una oferta, indica la capacidad y el plazo y revisa el borrador.",
  "quotes.form.offerHelp":
    "Elige una oferta disponible para la región que necesitas.",
  "quotes.form.reviewTitle": "Revisa tu borrador",
  "quotes.form.reviewDescription":
    "Al crear el borrador se calcula el precio. Después, abre el borrador guardado para preparar su documento y emitir la oferta. Podrás revisarla antes de aceptar un pedido.",
  "quotes.form.expiryHelp": "Usa tu fecha y hora locales.",
  "quotes.form.expiryFuture":
    "Elige un vencimiento posterior a la hora actual.",
  "quotes.form.stageTerms": "Capacidad, plazo y vencimiento",
  "quotes.form.stageReview": "Revisar borrador",
  "quotes.form.partnerDescription":
    "Elige una oferta y un cliente final e indica tu precio de reventa. Fil One calcula tu precio de transferencia al crear el borrador.",

  "quotes.issue.title": "Completa esta oferta",
  "quotes.issue.description":
    "Prepara el documento de la oferta guardada para que se pueda aceptar. Emitir una oferta no crea un pedido.",
  "quotes.issue.action": "Preparar y emitir oferta",
  "quotes.issue.working": "Preparando oferta…",
  "quotes.issue.retry": "Continuar esta oferta",
  "quotes.issue.accept": "Revisar y aceptar pedido",
  "quotes.issue.refresh":
    "Actualiza esta página para comprobar la oferta y tu acceso e inténtalo de nuevo.",
  "quotes.issue.pricingReview":
    "Es necesario revisar el precio de este borrador antes de emitirlo. Contacta con tu equipo de Fil One.",
  "quotes.issue.documentUnavailable":
    "No se pudo verificar el documento. No se ha emitido ninguna oferta. Inténtalo de nuevo.",
  "quotes.issue.rendering":
    "El documento sigue preparándose. Continúa esta oferta para comprobarlo de nuevo.",
  "quotes.issue.synchronizing":
    "La oferta se ha emitido. Su estado aún se está actualizando; continúa para comprobarlo.",

  "cp.common.loadingTitle": "Cargando registros",
  "cp.common.loadingBody": "Se están recuperando los registros más recientes.",
  "cp.common.emptyTitle": "Todavía no hay nada aquí",
  "cp.common.emptyBody":
    "Los registros aparecerán cuando comience la actividad en esta cuenta.",
  "cp.common.noMatchTitle": "Ningún registro coincide con estos filtros",
  "cp.common.noMatchBody": "Borra o cambia un filtro para ver más resultados.",
  "cp.common.permissionTitle": "Tu rol no permite acceder a esta información",
  "cp.common.permissionBody":
    "Pide al titular de la cuenta que te conceda el acceso necesario.",
  "cp.common.errorTitle": "No se pudieron cargar los registros",
  "cp.common.errorBody": "Inténtalo de nuevo. Se han conservado tus filtros.",
  "cp.common.freshnessCurrent": "Los registros están actualizados",
  "cp.common.freshnessReadAt": "Lectura",
  "cp.common.freshnessStaleTitle":
    "Estos registros podrían estar desactualizados.",
  "cp.common.freshnessStaleBody":
    "Los datos de esta página aún no se han sincronizado con su fuente, por lo que podría faltar algún cambio reciente. Actualiza antes de actuar.",
  "cp.common.freshnessAction": "Actualizar registros",
  "cp.common.freshnessPartialTitle":
    "Solo se pudo leer parte de esta colección.",
  "cp.common.freshnessPartialBody":
    "Esta cuenta tiene más registros en este canal de los que se pueden recuperar en una sola lectura. Las filas siguientes son las actualizadas más recientemente. El recuento, los filtros, los totales y la ordenación solo abarcan los registros leídos: una lista ordenada por valor puede estar bien ordenada y aun así omitir el registro de mayor valor. Se ha notificado la lectura incompleta; actualizar no recuperará el resto.",
  "cp.common.unsavedTitle": "¿Salir sin guardar?",
  "cp.common.unsavedBody":
    "Todavía no se ha enviado nada de este formulario al servidor. Si sales, se descartará todo lo introducido.",
  "cp.common.unsavedDiscard": "Descartar y salir",
  "cp.common.unsavedKeep": "Seguir editando",
  "cp.customer.dashboardGreeting": "Te damos la bienvenida de nuevo",
  "cp.customer.dashboardDescription":
    "Atiende primero los plazos comerciales y después revisa el rendimiento de la cuenta.",
  "cp.customer.attentionTitle": "Requiere atención",
  "cp.customer.attentionDescriptionOne":
    "{count} elemento requiere una decisión o seguimiento.",
  "cp.customer.attentionDescriptionOther":
    "{count} elementos requieren una decisión o seguimiento.",
  "cp.customer.attentionDescriptionNone":
    "No hay elementos que requieran una decisión o seguimiento.",
  "cp.customer.termTitle": "Periodo comercial actual",
  "cp.customer.serviceRollup": "Resumen de periodos de servicio",
  "cp.customer.metricsTitle": "Decisiones de un vistazo",
  "cp.customer.activityTitle": "Actividad reciente",
  "cp.customer.accountTitle": "Configuración de la cuenta",
  "cp.customer.accountDescription":
    "Gestiona tu organización, las personas y los requisitos de compra.",
  "cp.customer.quotePermissionNote":
    "El titular o un administrador de la cuenta puede crear cotizaciones.",
  "cp.customer.accountPermissionNote":
    "El titular o un administrador de la cuenta gestiona usuarios, compras y solicitudes de baja.",
  "cp.customer.collections.amendments.description":
    "Consulta los cambios solicitados y completados en los servicios activos.",
  "cp.customer.collections.amendments.searchPlaceholder":
    "Buscar modificaciones",
  "cp.customer.collections.users.description":
    "Consulta quién puede ver y aprobar operaciones comerciales.",
  "cp.customer.collections.users.searchPlaceholder": "Buscar usuarios",
  "cp.customer.collections.procurement.description":
    "Mantén actualizados el envío de facturas, el alta de proveedores y los justificantes fiscales.",
  "cp.customer.collections.procurement.searchPlaceholder":
    "Buscar registros de compras",
  "cp.customer.collections.marketplace.title": "Compras en el marketplace",
  "cp.customer.collections.marketplace.description":
    "Sigue las ofertas privadas y el cumplimiento notificado por el proveedor.",
  "cp.customer.collections.marketplace.searchPlaceholder":
    "Buscar ofertas del marketplace",
  "cp.customer.collections.support.description":
    "Sigue las incidencias de clientes; el proveedor de soporte sigue siendo la fuente de referencia.",
  "cp.customer.collections.support.searchPlaceholder":
    "Buscar solicitudes de soporte",
  "cp.commercial.quoteStages.0": "Oferta y región",
  "cp.commercial.quoteStages.1":
    "Capacidad, duración, canal directo y vencimiento",
  "cp.commercial.quoteStages.2": "Revisar y emitir",
  "cp.commercial.quoteSummary": "Resumen de la cotización",
  "cp.commercial.reviewIssue": "Revisar y emitir",
  "cp.commercial.agreementAuthority":
    "Confirmo que tengo autorización para vincular a esta entidad jurídica mediante este acuerdo.",
  "cp.commercial.agreementReview": "Revisar y aceptar el acuerdo",
  "cp.commercial.orderReview": "Revisar el compromiso resultante",
  "cp.commercial.orderConfirmation":
    "He revisado la cotización emitida, el acuerdo aplicable, la orden de compra, el inicio y el fin del servicio y el compromiso resultante.",
  "cp.commercial.orderTermsHelp":
    "Las condiciones del pedido provienen de la cotización emitida {quoteReference}, versión {quoteVersion}, y de {agreementTitle}, versión {agreementVersion}. La referencia de una orden de compra no sustituye ni modifica esas condiciones fijadas.",
  "cp.commercial.orderArtifactRetention":
    "El formulario de pedido generado y la evidencia de su aceptación se conservan durante {years} años desde el instante de aceptación registrado.",
  "cp.commercial.estimatedSpend": "Gasto estimado",
  "cp.commercial.invoiceTruth": "Importe facturado",
  "cp.commercial.paymentTruth": "Estado del pago",
  "cp.commercial.paymentWebhook":
    "Notificado por el webhook del proveedor de pagos",
  "cp.commercial.externalPayment":
    "Continuarás con el proveedor de pagos. La factura solo se marcará como pagada cuando el proveedor lo confirme.",
  "cp.commercial.confirmMutation": "Revisar y confirmar",
  "cp.partner.deskDescription":
    "Atiende los plazos del acuerdo y resuelve las tareas urgentes de clientes antes de revisar el rendimiento.",
  "cp.partner.agreementClock": "Plazos del acuerdo de socio",
  "cp.partner.urgentTitle": "Tareas urgentes del socio",
  "cp.partner.transferPrice": "Precio de transferencia de Fil One",
  "cp.partner.partnerPrice": "Precio de reventa del socio",
  "cp.partner.merchantOfRecord": "Vendedor responsable de la transacción",
  "cp.partner.boundary":
    "El precio de transferencia es privado para el socio. El cliente final ve el precio de reventa fijado por el socio.",
  "cp.partner.renewalReview": "Revisar la renovación antes de confirmar",
  "cp.partner.registrationReview": "Revisar el registro de la oportunidad",
  "app.pageLoaded": "{page}. Página cargada.",

  "operations.stale":
    "Se requiere actualizar {channels}. Abre el espacio de trabajo antes de decidir.",
  "operations.cases.one": "{count} caso",
  "operations.cases.other": "{count} casos",
  "operations.priority.one": "{count} caso requiere atención prioritaria.",
  "operations.priority.other": "{count} casos requieren atención prioritaria.",
  "operations.records.one": "{count} registro",
  "operations.records.other": "{count} registros",
  "operations.providerSummary":
    "Operaciones de proveedores: {operations}. Bajas de servicios: {terminations}.",
  "operations.invoiceSummary":
    "Facturas vencidas: {overdue}. Facturas pendientes: {open}.",
  "operations.orders.one": "{count} pedido",
  "operations.orders.other": "{count} pedidos",
  "operations.exports.one": "{count} exportación",
  "operations.exports.other": "{count} exportaciones",
  "approval.reviewApprove": "Revisar aprobación",
  "approval.reviewReject": "Revisar rechazo",

  "ui.0": "Estado operativo",
  "ui.1":
    "El trabajo que requiere atención en aprobaciones, cobros, aprovisionamiento, renovaciones e informes.",
  "ui.2": "Resumen del trabajo",
  "ui.3":
    "Trabajo priorizado de los equipos a los que das soporte, con acceso directo a cada espacio.",
  "ui.4": "Resumen del trabajo operativo",
  "ui.5": "Abrir mi cola",
  "ui.6": "Indicador",
  "ui.7": "Resumen",
  "ui.8": "Área",
  "ui.9": "Actualizado",
  "ui.10": "Acción",
  "ui.11": "Aprobaciones",
  "ui.12": "Aprovisionamiento",
  "ui.13": "Cobros",
  "ui.14": "Renovaciones",
  "ui.15": "Informes",
  "ui.16": "desactualizado",
  "ui.17": "Trabajo en cola",
  "ui.18": "Abrir la cola",
  "ui.19": "Abrir aprovisionamiento",
  "ui.20": "Sin importe registrado",
  "ui.21": "Abrir cobros",
  "ui.22": "Preaviso de renovación",
  "ui.23":
    "Pedidos cuya fecha contractual de preaviso ya pasó o vence en los próximos 30 días.",
  "ui.24": "Abrir renovaciones",
  "ui.25": "Exportaciones de informes",
  "ui.26": "Exportaciones registradas en tu sesión de operador.",
  "ui.27": "Abrir informes",
  "ui.28": "Operaciones internas",
  "ui.29": "Estado de los datos",
  "ui.30": "Actualizado",
  "ui.31": "Requiere actualización",
  "ui.32": "No disponible temporalmente",
  "ui.33": "No disponible en este espacio de trabajo",
  "ui.34": "Al menos un registro ha superado su plazo de actualización.",
  "ui.35":
    "Verifica los datos con el registro de origen antes de tomar una decisión.",
  "ui.36": "Plazos de preaviso de renovación",
  "ui.37":
    "Pedidos agrupados por el tiempo restante hasta su preaviso contractual, con el canal y la facturación registrados.",
  "ui.38": "Sobre el valor de renovación",
  "ui.39":
    "Facturado hasta la fecha muestra el valor facturado por pedido. Las previsiones se mantienen separadas de esta lista de renovaciones.",
  "ui.40": "Facturado hasta la fecha",
  "ui.41": "No hay facturas registradas para este pedido",
  "ui.42": "Canal no registrado",
  "ui.43": "No hay pedidos en este plazo.",
  "ui.44": "Prioridad de cobros",
  "ui.45":
    "Facturas pendientes ordenadas por exposición y antigüedad, con las correcciones que puede solicitar un aprobador financiero.",
  "ui.46": "Orden de prioridad",
  "ui.47":
    "Primero el importe pendiente más alto, después los días de retraso y la referencia. Los importes en otra moneda se ordenan, pero nunca se suman al total.",
  "ui.48": "Acciones de cobro",
  "ui.49":
    "Abre cada factura para consultar pagos, disputas y correcciones disponibles.",
  "ui.50": "Total de facturas pendientes",
  "ui.51": "Vencido",
  "ui.52": "Mayor antigüedad de vencimiento",
  "ui.53": "No registrado",
  "ui.54": "Facturas pendientes",
  "ui.55":
    "Importe, antigüedad, estado y correcciones disponibles para cada factura.",
  "ui.56": "Facturas pendientes ordenadas por importe y días de retraso",
  "ui.57": "No hay facturas pendientes que requieran gestión de cobro.",
  "ui.58": "Trabajo de aprovisionamiento",
  "ui.59":
    "Sigue el trabajo de proveedores, las bajas de servicios, los reintentos y las tareas que requieren atención.",
  "ui.60": "El trabajo detenido se gestiona en Recuperación.",
  "ui.61":
    "Abre Recuperación para reintentar o abandonar el trabajo que agotó sus intentos automáticos.",
  "ui.62": "Abrir la cola de recuperación",
  "ui.63": "Operaciones de proveedores",
  "ui.64": "Bajas de servicios",
  "ui.65": "Riesgo alto",
  "ui.66": "Registros de aprovisionamiento",
  "ui.67":
    "Registros de aprovisionamiento ordenados por riesgo e intentos realizados",
  "ui.68":
    "No hay trabajo de aprovisionamiento que requiera atención en este espacio.",
  "ui.69": "Intentos",
  "ui.70": "No corresponde",
  "ui.71": "Informes operativos",
  "ui.72":
    "Exportaciones registradas en tu sesión de operador y exportaciones disponibles para generar.",
  "ui.73": "Exportaciones de informes registradas",
  "ui.74": "Exportaciones de informes, más recientes primero",
  "ui.75":
    "No hay exportaciones de informes en tu ámbito de operador. Genera una exportación abajo para registrarla.",
  "ui.76": "Todos los informes disponibles",
  "ui.77": "Documento registrado",
  "ui.78": "Aún no hay documento registrado",
  "ui.79": "Exportaciones disponibles",
  "ui.80":
    "Registro de informes del contrato de la API de comercio. Se generan a petición; esta página no almacena resultados ni indica su actualidad.",
  "ui.81": "ARR y MRR",
  "ui.82": "Facturación y cobros",
  "ui.83": "Liquidación de comisiones",
  "ui.84": "Las exportaciones se generan a petición",
  "ui.85":
    "Elige un informe y el ámbito de cuentas abajo. Las exportaciones completadas permanecen en el historial.",
  "ui.86": "Buscar",
  "ui.87": "Filtros",
  "ui.88": "Estado",
  "ui.89": "Riesgo",
  "ui.90": "Responsable",
  "ui.91": "Ordenar",
  "ui.92": "Vista",
  "ui.93": "Filas por página",
  "ui.94": "Anterior",
  "ui.95": "Siguiente",
  "ui.96": "Detalles técnicos",
  "ui.97": "Documentos",
  "ui.98": "Pruebas de auditoría",
  "ui.99": "Cadena documental",
  "ui.100": "Resumen comercial",
  "ui.101": "Estado del plazo",
  "ui.102": "Próxima acción",
  "ui.103": "Espacio del cliente",
  "ui.104": "Organización",
  "ui.105": "Usuarios y acceso",
  "ui.106":
    "Revisa roles, autoridad de aprobación, estado de MFA e invitaciones pendientes.",
  "ui.107": "Compras",
  "ui.108":
    "Administra el envío de facturas, el alta de proveedores, las órdenes de compra y los justificantes fiscales.",
  "ui.109": "Baja",
  "ui.110":
    "Revisa la recuperación de datos, la facturación final, las exclusiones de conservación y la autoridad de desmantelamiento.",
  "ui.111": "Guardar",
  "ui.112": "Cancelar",
  "ui.113": "Todos",
  "ui.114": "Ninguno",
  "ui.115": "Motivo",
  "ui.116": "Pruebas",
  "ui.117": "Referencia",
  "ui.118": "Cuenta",
  "ui.119": "Importe",
  "ui.120": "Moneda",
  "ui.121": "Fecha",
  "ui.122": "Versión",
  "ui.123": "Detalles",
  "ui.124": "Actualizar",
  "ui.125": "Reintentar",
  "ui.126": "Cerrar",
  "ui.127": "Cargando…",
  "ui.128": "Sin resultados",

  "settings.title": "Configuración",
  "settings.description": "Personaliza tu espacio de trabajo.",
  "settings.language": "Idioma",
  "settings.language.description":
    "Elige el idioma de la interfaz. Tu preferencia se guarda en este navegador para futuras visitas.",
  "settings.language.label": "Idioma de la interfaz",
  "settings.save": "Guardar idioma",
  "settings.saving": "Guardando…",
  "settings.saved": "Idioma guardado.",
  "settings.error": "Elige un idioma disponible e inténtalo de nuevo.",
  "settings.language.records":
    "Los nombres, los datos introducidos y los documentos contractuales originales conservan su idioma original.",

  "app.name": "Fil One",
  "app.product": "Comercio",
  "app.demo": "Entorno de demostración",
  "app.demo.short": "Demo",
  "app.demo.reset.success": "Datos de demostración restaurados.",
  "app.demo.reset.confirm.title": "¿Restablecer el entorno de demostración?",
  "app.demo.reset.confirm.description":
    "Se restaurarán todos los espacios de demostración a su estado inicial y se recargará la página.",
  "app.demo.reset.confirm.detail":
    "Se eliminarán los cambios de la demostración y el trabajo sin guardar de esta página.",
  "app.demo.reset.confirm.action": "Restablecer demo",
  "app.demo.reset.confirm.cancel": "Conservar el estado actual",
  "demo.access.eyebrow": "Acceso a la demostración",
  "demo.access.title": "Introduce la contraseña de la demostración",
  "demo.access.description":
    "Introduce la contraseña que recibiste para explorar Fil One Commerce.",
  "demo.access.password": "Contraseña",
  "demo.access.submit": "Continuar",
  "demo.access.invalid": "La contraseña no coincide. Inténtalo de nuevo.",
  "demo.landing.eyebrow": "Demostración guiada",
  "demo.landing.title": "Elige el perfil con el que quieres acceder",
  "demo.landing.description":
    "Cada perfil abre Fil One Commerce en su área de trabajo. Puedes cambiar de perfil desde el panel de demostración.",
  "demo.landing.start": "Comenzar como {name}",
  "demo.landing.internal": "Personal de Fil One",
  "demo.landing.external": "Clientes y socios",
  "demo.panel.title": "Controles de demostración",
  "demo.panel.open": "Abrir controles de demostración",
  "demo.panel.close": "Cerrar controles de demostración",
  "demo.panel.persona": "Sesión iniciada como",
  "demo.panel.journey": "Recorrido",
  "demo.panel.reset": "Restaurar datos de demostración",
  "demo.panel.resetting": "Restableciendo…",
  "demo.panel.reset.failed":
    "No se pudieron restablecer los datos de demostración.",
  "demo.panel.browse": "Todos los perfiles",
  "app.verifyAuthentication": "Verificar identidad para cambios sensibles",
  "app.signOut": "Cerrar sesión",
  "app.skip": "Ir al contenido principal",
  "app.nav.primary": "Navegación principal",
  "app.nav.secondary": "Cuenta y ayuda",
  "app.nav.open": "Abrir navegación",
  "app.nav.title": "Navegación",
  "app.nav.description": "Explora todas las secciones.",
  "app.nav.close": "Cerrar navegación",
  "app.search": "Buscar",
  "app.search.hint": "Cuentas, pedidos, facturas o documentos",
  "app.command": "Abrir menú de comandos",
  "app.command.title": "Búsqueda y comandos",
  "app.command.description":
    "Encuentra una sección, inicia una tarea frecuente o abre un registro reciente.",
  "app.command.searchLabel": "Buscar secciones, acciones y registros",
  "app.command.noResults":
    "Sin resultados. Prueba con un identificador, una cuenta o una acción.",
  "app.command.group.navigation": "Navegación",
  "app.command.group.actions": "Acciones",
  "app.command.group.records": "Registros",
  "app.command.action.customerQuote":
    "Configura la capacidad, el plazo y los detalles comerciales.",
  "app.command.action.inviteUser":
    "Administra el acceso a la organización actual.",
  "app.command.action.registerDeal":
    "Protege una nueva oportunidad comercial de un socio.",
  "app.command.action.partnerQuote":
    "Prepara los precios para un cliente final.",
  "app.command.action.globalSearch": "Busca cuentas y registros operativos.",
  "app.command.action.reviewApprovals":
    "Abre la cola de aprobaciones y excepciones.",
  "app.command.shortcut": "Comando K",
  "app.help": "Ayuda",
  "app.help.description": "Guías, soporte y estado del servicio",
  "app.help.internal": "Requisitos externos y guía operativa",
  "app.help.internal.description":
    "Consulta los requisitos de activación, sus responsables y las instrucciones operativas",
  "app.account.switch": "Cambiar de organización",
  "app.account.switched": "Se cambió a {account}.",
  "app.account.choose.title": "Elige una organización",
  "app.account.choose.description":
    "Selecciona una organización activa autorizada para tu identidad de WorkOS.",
  "app.account.choose.empty.title": "No hay organizaciones autorizadas",
  "app.account.choose.empty.description":
    "Esta identidad no tiene una membresía comercial activa. Un administrador puede conceder acceso, o puedes cerrar sesión y usar otra identidad.",
  "app.profile": "Abrir menú del perfil",
  "app.requestId": "Solicitud {id}",
  "app.footer":
    "Los registros comerciales de Fil One se sincronizan con el registro operativo.",
  "app.offline":
    "No tienes conexión. La información guardada sigue disponible; los cambios esperarán a que se restablezca la conexión.",
  "app.online":
    "Conexión restablecida. Ya puedes enviar los cambios pendientes.",
  "session.expired.title": "Tu sesión terminó de forma segura",
  "session.expired.description":
    "Vuelve a iniciar sesión para continuar. Los borradores siguen guardados en este dispositivo.",
  "session.expired.action": "Volver a iniciar sesión",
  "session.mfa.title": "Una verificación más",
  "session.mfa.description":
    "Tu rol requiere autenticación multifactor antes de habilitar las acciones comerciales.",
  "session.mfa.action": "Verificar identidad",
  "session.permission.title": "Tu rol no tiene acceso a esta vista",
  "session.permission.description":
    "Cambia de organización o pide a un propietario que actualice tu rol comercial.",
  "session.permission.action": "Volver al panel",
  "nav.dashboard": "Resumen",
  "nav.buy": "Comprar",
  "nav.payg": "Pago por uso y pruebas",
  "nav.agreements": "Acuerdos",
  "nav.quotes": "Cotizaciones",
  "nav.orders": "Pedidos",
  "nav.services": "Servicios activos",
  "nav.pocs": "Pruebas de concepto",
  "nav.billing": "Facturación",
  "nav.amendments": "Modificaciones",
  "nav.marketplace": "Marketplace",
  "nav.support": "Soporte",
  "nav.account": "Cuenta",
  "nav.partner.home": "Panel del socio",
  "nav.partner.portfolio": "Clientes finales",
  "nav.partner.registrations": "Registro de oportunidades",
  "nav.partner.quotes": "Cotizaciones de socios",
  "nav.partner.billing": "Facturación consolidada",
  "nav.partner.commissions": "Comisiones",
  "nav.partner.renewals": "Renovaciones",
  "nav.partner.disputes": "Disputas",
  "nav.partner.marketplace": "Marketplace",
  "nav.partner.sandboxes": "Entornos de prueba y POC",
  "nav.partner.brand": "Marca y dominios",
  "nav.partner.enablement": "Recursos para socios",
  "nav.partner.support": "Soporte",
  "nav.internal.home": "Operaciones",
  "nav.internal.search": "Búsqueda global",
  "nav.internal.queues": "Colas y aprobaciones",
  "nav.internal.renewals": "Gestión de renovaciones",
  "nav.internal.collections": "Cobros",
  "nav.internal.provisioning": "Aprovisionamiento",
  "nav.internal.recovery": "Recuperación",
  "nav.internal.webhookReplay": "Reejecución de webhooks",
  "nav.internal.migrations": "Migraciones",
  "nav.internal.reports": "Informes",
  "nav.internal.revenue": "Ingresos y canal",
  "nav.internal.billingReconciliation": "Conciliación de facturación",
  "nav.internal.status": "Estado de integraciones",
  "nav.internal.unhandledErrors": "Errores no controlados",
  "nav.internal.agreements": "Versiones de acuerdos",
  "nav.internal.approvals": "Revisión de aprobaciones",
  "nav.internal.priceBooks": "Listas de precios",
  "nav.internal.paygRequests": "Solicitudes de servicio",
  "nav.internal.paygOffers": "Pago por uso y pruebas",
  "nav.internal.capabilities": "Funciones habilitadas",
  "nav.internal.providers": "Referencias de proveedores",
  "nav.internal.catalog": "Asignaciones del catálogo",
  "nav.internal.channelPolicy": "Política de canal",
  "nav.internal.gates": "Requisitos externos",
  "nav.internal.assisted": "Modo asistido",
  "nav.group.pricing": "Precios",
  "nav.group.legal": "Registro legal",
  "nav.group.service": "Servicio",
  "nav.group.organization": "Organización",
  "nav.group.partner.dealFlow": "Oportunidades",
  "nav.group.partner.revenue": "Ingresos",
  "nav.group.partner.channel": "Canal",
  "nav.group.internal.queues": "Colas de excepciones",
  "nav.group.internal.providerRecovery": "Recuperación de proveedores",
  "nav.group.internal.administration": "Administración",
  "action.view": "Ver detalles",
  "action.review": "Revisar",
  "action.retry": "Intentar de nuevo",
  "action.returnHome": "Volver a tu panel",
  "action.cancel": "Cancelar",
  "action.download": "Descargar PDF",
  "action.createQuote": "Crear cotización",
  "action.invite": "Invitar usuario",
  "action.open": "Abrir registro",
  "action.register": "Registrar oportunidad",
  "common.status": "Estado",
  "common.updated": "Última actualización",
  "common.term": "Plazo",
  "status.active": "Activo",
  "status.inNotice": "En plazo de preaviso",
  "status.awaiting": "Pendiente de acción",
  "status.review": "Requiere revisión",
  "status.paid": "Pagado",
  "status.ready": "Listo",
  "status.pending": "Pendiente",
  "status.provisioning": "En aprovisionamiento",
  "status.blocked": "Bloqueado",
  "status.complete": "Completado",
  "status.draft": "Borrador",
  "status.signed": "Firmado",
  "dashboard.eyebrow": "Estado de la cuenta",
  "dashboard.description":
    "Actividad comercial, estado del servicio y próximas fechas contractuales de Northstar Archive Labs.",
  "dashboard.chain": "Actividad reciente",
  "dashboard.activeServices": "Servicios activos",
  "dashboard.empty.obligations":
    "No hay decisiones pendientes. Los plazos comerciales aparecerán aquí cuando se acerquen.",
  "dashboard.empty.services":
    "Aún no hay servicios activos. Los pedidos aceptados aparecerán al comenzar el aprovisionamiento.",
  "dashboard.empty.activity":
    "No se ha registrado actividad de la cuenta en este período.",
  "dashboard.empty.capacity":
    "La capacidad contratada, el uso actual y los 30 días anteriores aparecerán cuando se informe el consumo medido.",
  "dashboard.openQuotes": "Cotizaciones abiertas",
  "dashboard.invoiceDue": "Factura pendiente",
  "dashboard.daysToNotice": "Días hasta el plazo de preaviso",
  "agreements.eyebrow": "Registro legal",
  "agreements.title": "Acuerdos",
  "agreements.description":
    "Condiciones formalizadas, pruebas de firma, versiones aplicables y fechas de renovación en un solo registro.",
  "agreements.execute": "Formalizar un acuerdo",
  "agreements.execute.binding":
    "Confirma el título, la versión, las condiciones aprobadas exactas y tu autoridad para vincular a {account}.",
  "agreements.execute.source": "Formalización bajo el acuerdo {reference}",
  "agreements.execute.validation.authority":
    "Introduce el cargo con autoridad de firma para esta entidad legal.",
  "agreements.execute.validation.attestation":
    "Confirma tu autoridad para vincular a esta entidad legal antes de formalizar el acuerdo.",
  "agreements.execute.accepted":
    "Acuerdo formalizado. La prueba de tu autoridad consta en el registro.",
  "agreements.execute.acceptedLink": "Abrir el acuerdo formalizado",
  "quotes.eyebrow": "Precios con confianza",
  "quotes.title": "Cotizaciones",
  "quotes.description":
    "Las versiones emitidas e inmutables permanecen vinculadas a su lista de precios, acuerdo y pedido.",
  "quotes.builder.title": "Crear cotización",
  "quotes.builder.description":
    "Configura el servicio; la API de comercio sigue siendo la fuente de precios y decisiones de aprobación.",
  "quotes.builder.account.description": "Cuenta autorizada para esta sesión",
  "quotes.builder.origin.revision": "Revisa la cotización {reference}",
  "quotes.builder.origin.poc": "Convierte la prueba de concepto {reference}",
  "quotes.builder.origin.unavailable":
    "El registro indicado está fuera de esta cuenta. El borrador comienza sin datos de origen.",
  "quotes.builder.created":
    "Borrador con precio creado. Podrás emitirlo cuando su documento esté preparado y vinculado.",
  "quotes.builder.createdLink": "Abrir el borrador creado",
  "orders.eyebrow": "Del compromiso al servicio",
  "orders.title": "Pedidos y servicios",
  "orders.description":
    "Órdenes de compra, aprovisionamiento, derechos, uso, modificaciones y plazos sin volver a introducir datos.",
  "orders.amendment": "Solicitar modificación",
  "orders.accept.source": "Cotización aceptada {reference} · versión {version}",
  "orders.accept.agreement.unknown":
    "No consta un acuerdo vigente para esta cuenta.",
  "orders.accept.unavailable.title":
    "No se ha seleccionado una cotización que se pueda aceptar",
  "orders.accept.unavailable.description":
    "La aceptación del pedido comienza con una cotización aceptada de esta cuenta. Elige una del registro de cotizaciones.",
  "orders.accept.unavailable.action": "Abrir registro de cotizaciones",
  "orders.accept.validation.po":
    "Introduce la referencia de la orden de compra.",
  "orders.accept.validation.serviceStart":
    "Elige la fecha de inicio del servicio.",
  "orders.accept.validation.authority":
    "Introduce el cargo con autoridad de aceptación.",
  "orders.accept.validation.confirmation":
    "Confirma el compromiso revisado antes de aceptarlo.",
  "orders.accept.created":
    "Pedido creado. Su compromiso y estado de aprovisionamiento ya constan en el registro oficial.",
  "orders.accept.createdLink": "Abrir el pedido creado",
  "orders.accept.prepared":
    "Formulario de pedido solicitado. El compromiso se creará cuando el documento esté generado y vinculado a la cotización.",
  "orders.accept.preparedLink": "Seguir esta aceptación en pedidos",
  "orders.accept.failed": "No se pudo aceptar el pedido. No se modificó nada.",
  "pocs.eyebrow": "Pruebas seguras",
  "pocs.title": "Pruebas de concepto",
  "pocs.description":
    "Entornos aislados con límites, hitos, criterios de éxito, costos y una conversión que conserva los datos.",
  "billing.eyebrow": "Facturación clara y trazable",
  "billing.title": "Facturación y pagos",
  "billing.description":
    "Las facturas incluyen el pedido y la orden de compra de origen, recibos, abonos, antigüedad, tratamiento fiscal y medios de pago.",
  "billing.aging": "Antigüedad de cuentas por cobrar",
  "account.eyebrow": "Controles de la organización",
  "account.title": "Cuenta, usuarios y compras",
  "account.description":
    "Identidad legal, roles de aprobación, cuentas por pagar, alta de proveedores, documentación fiscal y baja segura.",
  "account.users": "Usuarios y roles",
  "account.procurement": "Perfil de compras",
  "account.offboarding": "Baja y certificados",
  "account.owner": "Propietario de la cuenta",
  "account.billingContact": "Contacto de facturación",
  "account.people": "Personas con acceso",
  "account.invitations": "Invitaciones pendientes",
  "account.unassigned": "No registrado",
  "account.areas.users.meta.one": "{count} persona con acceso",
  "account.areas.users.meta.other": "{count} personas con acceso",
  "account.areas.procurement.meta.one": "{count} requisito registrado",
  "account.areas.procurement.meta.other": "{count} requisitos registrados",
  "account.areas.offboarding.meta":
    "Se requiere confirmación para cada solicitud",
  "account.offboarding.service": "Servicio",
  "account.offboarding.empty.title":
    "No hay servicios disponibles para dar de baja",
  "account.offboarding.empty.description":
    "La baja comienza desde un pedido activo de esta cuenta. Los compromisos activos aparecen en pedidos y servicios.",
  "account.offboarding.empty.action": "Abrir pedidos y servicios",
  "account.offboarding.validation.effectiveAt":
    "Elige la fecha y hora de efecto solicitadas.",
  "account.offboarding.validation.confirmation":
    "Confirma las medidas de conservación y aprobación revisadas antes de enviar.",
  "account.offboarding.requested":
    "Solicitud de baja enviada para aprobación. Tu servicio sigue funcionando.",
  "account.offboarding.requestedLink":
    "Abrir el registro del servicio afectado",
  "account.offboarding.failed": "No se pudo enviar la solicitud de baja.",
  "partner.eyebrow": "Primero, los plazos del acuerdo",
  "partner.title": "Panel del socio",
  "partner.description":
    "Tu acuerdo aplicable tiene prioridad; los servicios activos de clientes finales continúan bajo las condiciones que siguen vigentes.",
  "partner.portfolio.title": "Cartera de clientes finales",
  "partner.portfolio.description":
    "Uso, aprovisionamiento, exposición por plazos y próxima acción de cada cliente final atribuido.",
  "partner.registration.title": "Registro de oportunidades y disputas",
  "partner.registration.description":
    "Plazos de protección, decisiones, reclamaciones en competencia y desempates registrados por canal.",
  "partner.quotes.title": "Cotizaciones de socios y reventa",
  "partner.quotes.description":
    "Los precios de transferencia son privados; los documentos de reventa para clientes muestran únicamente el precio que estableces.",
  "partner.billing.title": "Facturación consolidada",
  "partner.billing.description":
    "Una factura al socio, agrupada por cliente final, con exposición agregada y sin contacto comercial con el cliente final.",
  "partner.commissions.title": "Comisiones y estados de cuenta",
  "partner.commissions.description":
    "Las comisiones por referidos se acumulan sobre ingresos netos cobrados; los estados descuentan reembolsos, abonos y contracargos.",
  "partner.renewals.title": "Renovaciones de socios",
  "partner.renewals.description":
    "Actúa por cliente final antes de que venza el preaviso; Fil One confirma la acción sin contactar comercialmente a los clientes de reventa.",
  "partner.sandboxes.title": "Entornos de prueba para socios",
  "partner.sandboxes.description":
    "Entornos gratuitos, limitados y con vencimiento que usan el mismo proceso de aprovisionamiento.",
  "partner.brand.title": "Marca y dominios personalizados",
  "partner.brand.description":
    "Prepara marcas intercambiables, colores aprobados, identidad de cotizaciones y verificación de dominios sin cambiar registros legales.",
  "partner.marketplace.title": "Estado del marketplace",
  "partner.marketplace.description":
    "Consulta de ofertas, compradores, cumplimiento y desembolsos de AWS, Azure y Google Cloud Marketplace.",
  "partner.access.title":
    "No tienes membresía de socio en la organización seleccionada",
  "partner.access.description":
    "Este espacio se abre para organizaciones que tu identidad puede representar. Cambia de organización o solicita acceso a un administrador de socios.",
  "partner.access.action": "Cambiar de organización",
  "partner.detail.notFound.title": "Este registro del socio no está disponible",
  "partner.detail.notFound.description":
    "La referencia es desconocida o está fuera de tus cuentas autorizadas.",
  "partner.detail.notFound.action": "Volver a la lista",
  "partner.detail.notRecorded": "No registrado",
  "partner.detail.reference": "Referencia",
  "partner.detail.position": "Posición comercial",
  "partner.detail.milestone": "Próximo hito",
  "partner.detail.owner": "Responsable",
  "partner.detail.risk": "Riesgo comercial",
  "partner.detail.portfolio.eyebrow": "Registro comercial del cliente final",
  "partner.detail.portfolio.term": "Servicio y plazo comercial",
  "partner.detail.term.unavailable.title":
    "No consta un plazo de servicio para este cliente final",
  "partner.detail.term.unavailable.description":
    "El plazo transcurrido, el preaviso y la fecha de finalización aparecerán cuando un pedido o acuerdo los publique.",
  "partner.detail.transfer.description":
    "El costo privado de Fil One para este canal. Procede de la lista de precios aprobada y nunca se muestra al cliente final.",
  "partner.detail.resale.description":
    "El precio que el socio establece y presenta al cliente final indicado.",
  "partner.detail.merchant.description":
    "La parte que contrata con el cliente final y le factura en este canal.",
  "partner.detail.quote.eyebrow": "Cotización de reventa del socio",
  "partner.detail.quote.boundary": "Separación de precios de la cotización",
  "partner.detail.quote.actions": "Acciones válidas para esta cotización",
  "partner.detail.quote.edit": "Editar borrador",
  "partner.detail.quote.revise": "Crear revisión",
  "partner.detail.quote.issue.title": "La emisión está condicionada",
  "partner.detail.quote.issue.description":
    "El equipo de operaciones de canal debe preparar documentos separados para el cliente y el socio antes de emitir esta oferta. Contacta con soporte para socios para continuar.",
  "partner.detail.quote.cancel.title": "La cancelación no está disponible aquí",
  "partner.detail.quote.cancel.description":
    "Operaciones de canal gestiona la cancelación de cotizaciones de socios. Contacta con el equipo para cancelar esta cotización.",
  "partner.detail.quote.download.title": "La descarga depende del proveedor",
  "partner.detail.quote.download.description":
    "El enlace al documento inmutable aparece cuando el servicio devuelve un documento conservado y visible para el socio.",
  "partner.detail.projection.record": "ID del registro",
  "partner.detail.projection.version": "Versión del registro",
  "partner.quote.new.disabled.unconfirmed":
    "Confirma la revisión anterior para crear el borrador con precio.",
  "partner.quote.new.disabled.created":
    "El borrador con precio ya se creó. Ábrelo desde las cotizaciones para continuar.",
  "partner.quote.new.success":
    "Se ha creado el borrador con precio. Ábrelo para revisar los precios guardados y los siguientes pasos.",
  "partner.quote.new.failure": "No se pudo crear la cotización.",
  "support.title": "Consulta de soporte",
  "support.description":
    "Tickets asociados a esta cuenta en modo de solo lectura. Sigue usando el canal habitual para nuevas solicitudes.",
  "internal.eyebrow": "Administración interna",
  "internal.title": "Operaciones comerciales",
  "internal.description":
    "Un registro operativo para cuentas, excepciones, aprobaciones, recuperaciones, renovaciones y conciliación.",
  "internal.search.title": "Búsqueda global",
  "internal.search.description":
    "Encuentra cuentas y registros operativos agrupados por tipo.",
  "internal.assisted.title": "Ejecución asistida",
  "internal.assisted.description":
    "Ejecuta acciones de clientes o socios con un motivo, identidad del actor conservada y el mismo flujo contractual.",
  "internal.queues.title": "Colas de excepciones y aprobaciones",
  "internal.queues.description":
    "Precios, asuntos legales, crédito, verificaciones, disputas, registros, POC, acciones destructivas y migraciones con responsables titulares y suplentes.",
  "internal.priceBooks.title": "Administración de listas de precios",
  "internal.priceBooks.description":
    "Tarifas en USD, EUR y GBP con fechas de vigencia, niveles de transferencia, códigos fiscales, excesos y márgenes mínimos.",
  "internal.agreements.title":
    "Administración de acuerdos y contratos del cliente",
  "internal.agreements.description":
    "Plantillas aprobadas por asesoría legal, contratos del cliente, negociaciones, condiciones clave, pruebas de formalización y versiones inmutables.",
  "internal.provisioning.title": "Recuperación de aprovisionamiento",
  "internal.provisioning.description":
    "Inspecciona los intentos persistentes, clasifica fallos y reejecuta de forma segura con la clave de idempotencia original.",
  "internal.collections.title": "Cobros y disputas",
  "internal.collections.description":
    "Reclamaciones de pago, antigüedad, suspensión con conservación, plazos de pruebas, abonos, reembolsos y contracargos.",
  "internal.renewals.title": "Centro de renovaciones",
  "internal.renewals.description":
    "Exposición a 30, 60–90 y 180 días de contratos directos, canalizados por socios y acuerdos de socios.",
  "internal.reports.title": "Informes y conciliación",
  "internal.reports.description":
    "Previsión, capacidad, bajas, canal, embudo, margen y conciliación triple con exportaciones trazables.",
  "internal.migrations.title": "Revisión de migraciones",
  "internal.migrations.description":
    "Resuelve las coincidencias ambiguas de cuentas existentes antes de crear registros o solicitar aceptación.",
  "internal.gates.title": "Estado de requisitos externos",
  "internal.gates.description":
    "Pruebas de activación para credenciales, asuntos legales, comercio, impuestos, proveedores, aprovisionamiento, dominios, marca, aprobadores y desmantelamiento.",
  "signing.eyebrow": "Formalización segura",
  "signing.title": "Revisar y firmar",
  "signing.description":
    "Se conserva tu posición mientras se abre el proveedor de firma. Ningún acuerdo se activa hasta que se confirme y verifique la finalización.",
  "signing.redirect": "Continuar a la firma segura",
  "signing.embedded": "Firma integrada",
  "signing.loading":
    "Preparando la sesión de firma y comprobando la versión exacta del documento.",
  "signing.failed":
    "El proveedor de firma no respondió. Tu acuerdo no ha cambiado.",
  "signing.recover": "Reconectar con la firma",
  "signing.returned":
    "Firma verificada. El documento formalizado y el certificado de finalización ya están en el registro del acuerdo.",
  "signing.unverified":
    "La respuesta no coincide con el sobre y el hash del documento esperados. El acuerdo no ha cambiado.",
  "states.eyebrow": "Experiencia resistente a fallos",
  "states.title": "Cada estado tiene un siguiente paso seguro",
  "states.description":
    "Respuestas para latencia, ausencia, datos parciales, trabajo optimista, validación, acceso, concurrencia, conectividad y fallos de proveedores.",
  "state.loading.title": "Preparando la vista de la cuenta",
  "state.loading.description":
    "Los plazos de acuerdos y los registros financieros llegan por separado; las secciones disponibles se muestran primero.",
  "state.empty.title": "Aún no hay registros",
  "state.empty.description":
    "Comienza con una cotización. Todo lo demás parte de ella.",
  "state.partial.title": "Los datos de uso se han retrasado temporalmente",
  "state.partial.description":
    "Los registros comerciales están actualizados hasta las 16:00 UTC. Los datos de uso se completarán sin cambiar los totales.",
  "state.success.title": "El registro está completo",
  "state.success.description":
    "El documento inmutable, el evento de auditoría y la notificación se crearon juntos.",
  "state.validation.title": "Revisa el valor resaltado",
  "state.validation.description":
    "La capacidad contratada debe alcanzar el mínimo de la oferta seleccionada.",
  "state.stale.title": "Hay una versión más reciente",
  "state.stale.description":
    "Tu borrador se conserva. Revisa la última versión antes de volver a aplicarlo.",
  "state.recoverable.title": "El proveedor necesita otro intento",
  "state.recoverable.description":
    "No se creó una acción duplicada. El reintento usa la clave de idempotencia original.",
  "state.notFound.title": "Esa página no está disponible",
  "state.notFound.description":
    "La dirección puede haber cambiado o el registro ya no ser visible para esta cuenta.",
  "state.fatal.title": "Esta acción no puede continuar",
  "state.fatal.description":
    "Recarga para consultar el último registro antes de reintentar. Si el problema continúa, contacta con soporte e indica el ID de solicitud.",
  "detail.eyebrow": "Registro de documento",
  "detail.description":
    "Identificadores, referencias aplicables, pruebas, documentos y últimos eventos de auditoría de esta versión inmutable.",
  "detail.provenance": "Procedencia del registro",
  "detail.upstream": "Documento de origen",
  "detail.version": "Versión comercial",
  "detail.hash": "Hash del contenido",
  "detail.documents": "Documentos relacionados",
  "detail.audit": "Historial de auditoría",
  "chart.usage": "Capacidad almacenada en los últimos seis meses",
  "chart.spend": "Gasto facturado en los últimos seis meses",
  "chart.capacity": "Capacidad contratada y aprovisionada por región",
  "chart.axis.month": "Mes",
  "chart.axis.value": "Valor",
  "term.annual": "Servicio anual contratado",
  "term.partner": "Acuerdo de socio Meridian",
  "term.rollup": "Resumen de plazos de la cuenta",
  "term.count.one": "{count} plazo activo",
  "term.count.other": "{count} plazos activos",
  "term.next": "Próxima fecha de finalización",
  "term.none": "Sin plazos activos",
  "term.archive": "Archivo principal",
  "term.replica": "Réplica de cumplimiento de Madrid",
  "states.optimistic.title": "El cambio se muestra mientras se verifica",
  "states.optimistic.description":
    "Si el contrato lo rechaza, se restaura el valor anterior y el foco pasa a la explicación.",
  "states.offline.title": "Guardado hasta recuperar la conexión",
  "states.offline.description":
    "Los registros de solo lectura siguen disponibles; no se presupone que se haya completado ninguna acción monetaria o contractual.",
  "format.tax.us": "Impuesto sobre las ventas",
  "format.tax.eu": "IVA",
  "format.tax.uk": "IVA",
  "projection.action.readOnly":
    "Solo lectura. El propietario de la cuenta o el aprobador asignado puede actuar sobre este registro.",
  "projection.action.pending": "Enviando…",
  "projection.action.submitting": "Enviando {action} a la API de comercio.",
  "projection.action.queued":
    "{action} está en cola. Esperando el resultado oficial.",
  "projection.action.applied":
    "{action} se aplicó en la versión oficial {version}.",
  "projection.action.appliedUnknownVersion":
    "{action} se aplicó. No se devolvió la versión oficial.",
  "projection.action.rejected":
    "{action} no se aplicó. La API de comercio devolvió {status}: {code}.",
  "projection.action.timeout":
    "{action} sigue en curso. El resultado aún no está confirmado y el registro podría cambiar.",
  "projection.action.rechecking": "Comprobando el resultado de {action}.",
  "projection.action.recheck": "Volver a comprobar el resultado",
  "projection.action.conflict":
    "El registro cambió. Actualiza antes de reintentar.",
  "projection.action.confirm.title": "¿{action}?",
  "projection.action.confirm.description":
    "Se aplica a {record} en la versión {version}.",
  "projection.action.confirm.detail":
    "El comando se ejecuta sobre el registro oficial y se anota en la auditoría. Revertirlo requiere otra acción autorizada.",
  "projection.action.confirm.cancel": "Conservar el registro sin cambios",
  "projection.action.accept": "Aceptar",
  "projection.action.addContact": "Añadir contacto",
  "projection.action.addRole": "Añadir rol",
  "projection.action.applyAmendment": "Aplicar modificación",
  "projection.action.approveException": "Aprobar excepción",
  "projection.action.consolidate": "Consolidar facturas",
  "projection.action.create": "Crear registro",
  "projection.action.evaluateDunning": "Evaluar reclamación de pago",
  "projection.action.executeAgreement": "Aceptar y formalizar",
  "projection.action.expire": "Dar por vencido ahora",
  "projection.action.issue": "Emitir",
  "projection.action.markUncollectible": "Marcar como incobrable",
  "projection.action.openInvoice": "Abrir factura",
  "projection.action.pay": "Registrar pago",
  "projection.action.prepareArtifact": "Preparar documento",
  "projection.action.convertPoc": "Convertir en cotización de pago",
  "projection.action.price": "Calcular precio de esta cotización",
  "projection.action.rejectException": "Rechazar excepción",
  "projection.action.requestTeardown": "Solicitar desmantelamiento",
  "projection.action.requestRenewal": "Solicitar renovación",
  "projection.action.revise": "Crear revisión",
  "projection.action.setPartnerCredit": "Establecer crédito del socio",
  "projection.action.setPaymentTerms": "Establecer condiciones de pago",
  "projection.action.update": "Actualizar detalles",
  "projection.action.void": "Anular factura",
  "signing.agreementId": "ID del acuerdo",
  "signing.agreementReference": "Referencia del acuerdo",
  "signing.serverSelected":
    "El servidor selecciona tu cuenta, identidad del firmante y documento inmutable a partir de este acuerdo guardado.",
  "signing.startEmbedded": "Iniciar firma integrada",
  "signing.accepted":
    "Sobre aceptado. El acuerdo permanece inactivo hasta verificar una respuesta firmada del proveedor.",
  "signing.continue": "Continuar al proveedor de firma aprobado",
  "signing.frame": "Proveedor de firma electrónica segura",
  "signing.checking": "Comprobando el estado guardado del sobre…",
  "signing.download": "Descargar acuerdo firmado",
  "signing.pending.title": "Firma pendiente",
  "signing.pending.description":
    "El proveedor aún no ha confirmado la finalización de la firma.",
  "signing.refresh": "Actualizar estado",
  "signing.declined.title": "Firma rechazada",
  "signing.expired.title": "Sesión de firma vencida",
  "signing.unchanged":
    "El acuerdo no ha cambiado. Abre su registro para revisar los siguientes pasos.",
  "signing.agreements": "Volver a acuerdos",
  "signing.missingState":
    "La respuesta de firma no contiene una referencia de estado oficial.",
  "signing.unverifiable":
    "El servidor no pudo verificar el estado de la firma.",
  "signing.requestFailed":
    "La solicitud de firma falló. El acuerdo no ha cambiado.",
  "signing.choose.title": "Elige primero un acuerdo",
  "signing.choose.description":
    "La firma comienza desde un acuerdo autorizado para que el servidor seleccione la versión exacta del documento.",
  "signing.demo.eyebrow": "Servicio de firma de demostración",
  "signing.demo.title": "Firmar documento",
  "signing.demo.description":
    "Simula al proveedor de firma. Al firmar se completa el sobre y se vuelve a Fil One, donde se ejecuta la conciliación real de la respuesta.",
  "signing.demo.document": "Documento",
  "signing.demo.signer": "Firmante",
  "signing.demo.envelope": "Sobre",
  "signing.demo.action": "Firmar documento",
  "signing.demo.unavailable.title": "Esta sesión de firma no está disponible",
  "signing.demo.unavailable.description":
    "El estado de firma es desconocido o ha vencido. Comienza de nuevo desde el registro del acuerdo.",
  "workflow.confirm.title": "Confirma esta decisión",
  "workflow.confirm.description":
    "Esta decisión se registra con los identificadores anteriores.",
  "workflow.confirm.detail":
    "Comprueba los identificadores, el motivo y la referencia de pruebas. Rechazar o solicitar un desmantelamiento cierra la vía comercial actual; solo una nueva decisión la reabre.",
  "workflow.confirm.cancel": "Conservar el registro sin cambios",
  "workflow.confirm.action": "Confirmar y enviar",
} satisfies MessageCatalog;

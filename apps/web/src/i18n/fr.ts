import type { MessageCatalog } from "./en";

/** French interface copy; contractual documents retain their original language. */
export const fr = {
  "cp.common.loadingTitle": "Chargement des données",
  "cp.common.loadingBody":
    "Les données les plus récentes sont en cours de récupération.",
  "cp.common.emptyTitle": "Aucun élément pour le moment",
  "cp.common.emptyBody":
    "Les données apparaîtront dès le début de l’activité sur ce compte.",
  "cp.common.noMatchTitle": "Aucun résultat ne correspond à ces filtres",
  "cp.common.noMatchBody":
    "Supprimez ou modifiez un filtre pour voir plus de résultats.",
  "cp.common.permissionTitle":
    "Votre rôle ne permet pas d’accéder à ces informations",
  "cp.common.permissionBody":
    "Demandez au propriétaire du compte de vous accorder l’accès requis.",
  "cp.common.errorTitle": "Impossible de charger les données",
  "cp.common.errorBody": "Réessayez. Vos filtres ont été conservés.",
  "cp.common.freshnessCurrent": "Les données sont à jour",
  "cp.common.freshnessReadAt": "Lecture",
  "cp.common.freshnessStaleTitle": "Ces données sont peut-être obsolètes.",
  "cp.common.freshnessStaleBody":
    "Les données de cette page ne sont pas encore synchronisées avec leur source. Une modification récente peut donc manquer. Actualisez avant toute action.",
  "cp.common.freshnessAction": "Actualiser les données",
  "cp.common.freshnessPartialTitle":
    "Seule une partie de cette liste a pu être chargée.",
  "cp.common.freshnessPartialBody":
    "Ce compte contient plus de données dans ce canal qu’une seule lecture ne peut en renvoyer. Les lignes ci-dessous sont les plus récemment mises à jour. Le nombre de résultats, les filtres, les totaux et le tri portent uniquement sur les données lues : une liste correctement triée par valeur peut omettre l’élément de plus grande valeur. La lecture incomplète a été signalée ; actualiser ne chargera pas le reste.",
  "cp.common.unsavedTitle": "Quitter sans enregistrer ?",
  "cp.common.unsavedBody":
    "Aucune donnée de ce formulaire n’a encore été envoyée au serveur. Quitter supprimera toute votre saisie.",
  "cp.common.unsavedDiscard": "Abandonner et quitter",
  "cp.common.unsavedKeep": "Continuer la modification",
  "cp.customer.dashboardGreeting": "Heureux de vous revoir",
  "cp.customer.dashboardDescription":
    "Traitez d’abord les échéances commerciales, puis examinez les performances du compte.",
  "cp.customer.attentionTitle": "À traiter",
  "cp.customer.attentionDescriptionOne":
    "{count} élément nécessite une décision ou un suivi.",
  "cp.customer.attentionDescriptionOther":
    "{count} éléments nécessitent une décision ou un suivi.",
  "cp.customer.attentionDescriptionNone":
    "Aucun élément ne nécessite de décision ou de suivi.",
  "cp.customer.termTitle": "Période contractuelle en cours",
  "cp.customer.serviceRollup": "Synthèse des périodes de service",
  "cp.customer.metricsTitle": "Vue d’ensemble des décisions",
  "cp.customer.activityTitle": "Activité récente",
  "cp.customer.accountTitle": "Paramètres du compte",
  "cp.customer.accountDescription":
    "Gérez votre organisation, ses membres et ses exigences d’achat.",
  "cp.customer.quotePermissionNote":
    "Un propriétaire ou un administrateur du compte peut créer des devis.",
  "cp.customer.accountPermissionNote":
    "Un propriétaire ou un administrateur du compte gère les utilisateurs, les achats et les demandes de clôture.",
  "cp.customer.collections.amendments.description":
    "Suivez les modifications demandées et effectuées sur les services actifs.",
  "cp.customer.collections.amendments.searchPlaceholder":
    "Rechercher des avenants",
  "cp.customer.collections.users.description":
    "Consultez les personnes autorisées à voir et à approuver les opérations commerciales.",
  "cp.customer.collections.users.searchPlaceholder":
    "Rechercher des utilisateurs",
  "cp.customer.collections.procurement.description":
    "Tenez à jour l’acheminement des factures, l’intégration des fournisseurs et les justificatifs fiscaux.",
  "cp.customer.collections.procurement.searchPlaceholder":
    "Rechercher des dossiers d’achat",
  "cp.customer.collections.marketplace.title": "Achats sur la place de marché",
  "cp.customer.collections.marketplace.description":
    "Suivez les offres privées et l’exécution déclarée par le fournisseur.",
  "cp.customer.collections.marketplace.searchPlaceholder":
    "Rechercher des offres sur la place de marché",
  "cp.customer.collections.support.description":
    "Suivez les problèmes clients ; le prestataire d’assistance reste la source de référence.",
  "cp.customer.collections.support.searchPlaceholder":
    "Rechercher des tickets d’assistance",
  "cp.commercial.quoteStages.0": "Offre et région",
  "cp.commercial.quoteStages.1": "Capacité, durée, canal direct et expiration",
  "cp.commercial.quoteStages.2": "Vérifier et émettre",
  "cp.commercial.quoteSummary": "Récapitulatif du devis",
  "cp.commercial.reviewIssue": "Vérifier et émettre",
  "cp.commercial.agreementAuthority":
    "Je confirme être habilité à engager cette entité juridique au titre de cet accord.",
  "cp.commercial.agreementReview": "Vérifier et accepter l’accord",
  "cp.commercial.orderReview": "Vérifier l’engagement qui en découle",
  "cp.commercial.orderConfirmation":
    "J’ai vérifié le devis accepté, l’accord applicable, le bon de commande, les dates de début et de fin du service et l’engagement qui en découle.",
  "cp.commercial.orderTermsHelp":
    "Les conditions de la commande proviennent du devis accepté {quoteReference}, version {quoteVersion}, et de {agreementTitle}, version {agreementVersion}. Une référence de bon de commande ne remplace ni ne modifie ces conditions fixées.",
  "cp.commercial.orderArtifactRetention":
    "Le bon de commande généré et les preuves de son acceptation sont conservés pendant {years} ans à compter de l’instant d’acceptation enregistré.",
  "cp.commercial.estimatedSpend": "Dépense estimée",
  "cp.commercial.invoiceTruth": "Montant facturé",
  "cp.commercial.paymentTruth": "Statut du paiement",
  "cp.commercial.paymentWebhook":
    "Signalé par le webhook du prestataire de paiement",
  "cp.commercial.externalPayment":
    "Vous allez poursuivre auprès du prestataire de paiement. La facture ne sera marquée comme payée qu’après sa confirmation.",
  "cp.commercial.confirmMutation": "Vérifier et confirmer",
  "cp.partner.deskDescription":
    "Respectez les échéances de l’accord et traitez les urgences clients avant d’examiner les performances.",
  "cp.partner.agreementClock": "Échéances de l’accord partenaire",
  "cp.partner.urgentTitle": "Tâches partenaires urgentes",
  "cp.partner.transferPrice": "Prix de transfert Fil One",
  "cp.partner.partnerPrice": "Prix de revente du partenaire",
  "cp.partner.merchantOfRecord": "Vendeur officiel de la transaction",
  "cp.partner.boundary":
    "Le prix de transfert reste confidentiel pour le partenaire. Le client final voit le prix de revente fixé par le partenaire.",
  "cp.partner.renewalReview": "Vérifier le renouvellement avant de confirmer",
  "cp.partner.registrationReview": "Vérifier l’enregistrement de l’opportunité",
  "app.pageLoaded": "{page}. Page chargée.",

  "operations.stale":
    "Actualisation nécessaire pour {channels}. Ouvrez l’espace avant de décider.",
  "operations.cases.one": "{count} dossier",
  "operations.cases.other": "{count} dossiers",
  "operations.priority.one":
    "{count} dossier nécessite une intervention prioritaire.",
  "operations.priority.other":
    "{count} dossiers nécessitent une intervention prioritaire.",
  "operations.records.one": "{count} enregistrement",
  "operations.records.other": "{count} enregistrements",
  "operations.providerSummary":
    "Opérations fournisseurs : {operations}. Résiliations de services : {terminations}.",
  "operations.invoiceSummary":
    "Factures en retard : {overdue}. Factures ouvertes : {open}.",
  "operations.orders.one": "{count} commande",
  "operations.orders.other": "{count} commandes",
  "operations.exports.one": "{count} export",
  "operations.exports.other": "{count} exports",
  "approval.reviewApprove": "Examiner l’approbation",
  "approval.reviewReject": "Examiner le refus",

  "ui.0": "État opérationnel",
  "ui.1":
    "Le travail nécessitant une intervention en matière d’approbations, de recouvrement, de provisionnement, de renouvellements et de rapports.",
  "ui.2": "Vue d’ensemble du travail",
  "ui.3":
    "Le travail prioritaire des équipes que vous accompagnez, avec un accès direct à chaque espace.",
  "ui.4": "Vue d’ensemble des opérations",
  "ui.5": "Ouvrir ma file",
  "ui.6": "Indicateur",
  "ui.7": "Résumé",
  "ui.8": "Domaine",
  "ui.9": "Mis à jour",
  "ui.10": "Action",
  "ui.11": "Approbations",
  "ui.12": "Provisionnement",
  "ui.13": "Recouvrement",
  "ui.14": "Renouvellements",
  "ui.15": "Rapports",
  "ui.16": "obsolète",
  "ui.17": "Travail en file",
  "ui.18": "Ouvrir la file",
  "ui.19": "Ouvrir le provisionnement",
  "ui.20": "Aucun montant enregistré",
  "ui.21": "Ouvrir le recouvrement",
  "ui.22": "Préavis de renouvellement",
  "ui.23":
    "Commandes dont la date contractuelle de préavis est passée ou arrive dans les 30 jours.",
  "ui.24": "Ouvrir les renouvellements",
  "ui.25": "Exports de rapports",
  "ui.26": "Exports enregistrés pour votre session opérateur.",
  "ui.27": "Ouvrir les rapports",
  "ui.28": "Opérations internes",
  "ui.29": "État des données",
  "ui.30": "À jour",
  "ui.31": "À actualiser",
  "ui.32": "Temporairement indisponible",
  "ui.33": "Indisponible dans cet espace de travail",
  "ui.34": "Au moins un enregistrement a dépassé son délai d’actualisation.",
  "ui.35":
    "Vérifiez les informations dans le document source avant de prendre une décision.",
  "ui.36": "Périodes de préavis de renouvellement",
  "ui.37":
    "Commandes regroupées selon le délai restant avant leur préavis contractuel, avec le canal et la facturation enregistrés.",
  "ui.38": "À propos de la valeur de renouvellement",
  "ui.39":
    "Le montant facturé à ce jour indique la valeur facturée par commande. Les prévisions restent distinctes de cette liste de renouvellements.",
  "ui.40": "Facturé à ce jour",
  "ui.41": "Aucune facture enregistrée pour cette commande",
  "ui.42": "Canal non enregistré",
  "ui.43": "Aucune commande sur cette période.",
  "ui.44": "Priorité du recouvrement",
  "ui.45":
    "Factures ouvertes classées par exposition et ancienneté, avec les corrections qu’un approbateur financier peut demander.",
  "ui.46": "Ordre de priorité",
  "ui.47":
    "Montant ouvert le plus élevé, puis jours de retard et référence de facture. Les montants dans une autre devise sont classés mais jamais additionnés au total.",
  "ui.48": "Actions de recouvrement",
  "ui.49":
    "Ouvrez chaque facture pour consulter les paiements, litiges et corrections disponibles.",
  "ui.50": "Total des factures ouvertes",
  "ui.51": "En retard",
  "ui.52": "Retard le plus ancien",
  "ui.53": "Non enregistré",
  "ui.54": "Factures ouvertes",
  "ui.55":
    "Montant, ancienneté, état et corrections disponibles pour chaque facture.",
  "ui.56": "Factures ouvertes classées par montant puis par jours de retard",
  "ui.57": "Aucune facture ouverte ne nécessite de recouvrement.",
  "ui.58": "Travail de provisionnement",
  "ui.59":
    "Suivez le travail des fournisseurs, les résiliations de services, les nouvelles tentatives et les tâches nécessitant une intervention.",
  "ui.60": "Le travail arrêté est géré dans Reprise.",
  "ui.61":
    "Ouvrez l’espace Reprise pour relancer ou abandonner le travail ayant épuisé ses tentatives automatiques.",
  "ui.62": "Ouvrir la file de reprise",
  "ui.63": "Opérations fournisseurs",
  "ui.64": "Résiliations de services",
  "ui.65": "Risque élevé",
  "ui.66": "Enregistrements de provisionnement",
  "ui.67":
    "Enregistrements de provisionnement classés par risque puis par tentatives effectuées",
  "ui.68":
    "Aucune tâche de provisionnement ne nécessite d’intervention dans cet espace.",
  "ui.69": "Tentatives",
  "ui.70": "Sans objet",
  "ui.71": "Rapports opérationnels",
  "ui.72":
    "Exports enregistrés pour votre session opérateur et exports disponibles à générer.",
  "ui.73": "Exports de rapports enregistrés",
  "ui.74": "Exports de rapports, les plus récents d’abord",
  "ui.75":
    "Aucun export de rapport dans votre périmètre opérateur. Générez un export ci-dessous pour l’enregistrer.",
  "ui.76": "Tous les rapports disponibles",
  "ui.77": "Document enregistré",
  "ui.78": "Aucun document enregistré pour le moment",
  "ui.79": "Exports disponibles",
  "ui.80":
    "Registre des rapports du contrat de l’API commerciale. Ils sont générés sur demande ; cette page ne conserve aucun résultat en cache et n’en indique pas la fraîcheur.",
  "ui.81": "ARR et MRR",
  "ui.82": "Facturation et recouvrement",
  "ui.83": "Règlement des commissions",
  "ui.84": "Les exports sont générés sur demande",
  "ui.85":
    "Choisissez un rapport et un périmètre de comptes ci-dessous. Les exports terminés restent disponibles dans l’historique.",
  "ui.86": "Rechercher",
  "ui.87": "Filtres",
  "ui.88": "État",
  "ui.89": "Risque",
  "ui.90": "Responsable",
  "ui.91": "Trier",
  "ui.92": "Vue",
  "ui.93": "Lignes par page",
  "ui.94": "Précédent",
  "ui.95": "Suivant",
  "ui.96": "Détails techniques",
  "ui.97": "Documents",
  "ui.98": "Preuves d’audit",
  "ui.99": "Chaîne documentaire",
  "ui.100": "Synthèse commerciale",
  "ui.101": "État de la durée contractuelle",
  "ui.102": "Prochaine action",
  "ui.103": "Espace client",
  "ui.104": "Organisation",
  "ui.105": "Utilisateurs et accès",
  "ui.106":
    "Consultez les rôles, pouvoirs d’approbation, l’état de l’authentification multifacteur et les invitations en attente.",
  "ui.107": "Achats",
  "ui.108":
    "Gérez l’envoi des factures, le référencement des fournisseurs, les bons de commande et les justificatifs fiscaux.",
  "ui.109": "Sortie",
  "ui.110":
    "Examinez la récupération des données, la facturation finale, les exclusions de conservation et le pouvoir de démantèlement.",
  "ui.111": "Enregistrer",
  "ui.112": "Annuler",
  "ui.113": "Tous",
  "ui.114": "Aucun",
  "ui.115": "Motif",
  "ui.116": "Preuves",
  "ui.117": "Référence",
  "ui.118": "Compte",
  "ui.119": "Montant",
  "ui.120": "Devise",
  "ui.121": "Date",
  "ui.122": "Version",
  "ui.123": "Détails",
  "ui.124": "Actualiser",
  "ui.125": "Réessayer",
  "ui.126": "Fermer",
  "ui.127": "Chargement…",
  "ui.128": "Aucun résultat",

  "settings.title": "Paramètres",
  "settings.description": "Personnalisez votre espace de travail.",
  "settings.language": "Langue",
  "settings.language.description":
    "Choisissez la langue de l’interface. Votre préférence est enregistrée dans ce navigateur pour vos prochaines visites.",
  "settings.language.label": "Langue de l’interface",
  "settings.save": "Enregistrer la langue",
  "settings.saving": "Enregistrement…",
  "settings.saved": "Langue enregistrée.",
  "settings.error": "Choisissez une langue disponible et réessayez.",
  "settings.language.records":
    "Les noms, les données saisies et les documents contractuels originaux conservent leur langue d’origine.",

  "app.name": "Fil One",
  "app.product": "Commerce",
  "app.demo": "Environnement de démonstration",
  "app.demo.short": "Démo",
  "app.demo.reset.success": "Données de démonstration restaurées.",
  "app.demo.reset.confirm.title": "Réinitialiser la démonstration ?",
  "app.demo.reset.confirm.description":
    "Tous les espaces de démonstration retrouveront leur état initial et la page sera rechargée.",
  "app.demo.reset.confirm.detail":
    "Vos modifications de démonstration et tout travail non enregistré sur cette page seront supprimés.",
  "app.demo.reset.confirm.action": "Réinitialiser la démo",
  "app.demo.reset.confirm.cancel": "Conserver l’état actuel",
  "demo.access.eyebrow": "Accès à la démonstration",
  "demo.access.title": "Saisissez le mot de passe de démonstration",
  "demo.access.description":
    "Saisissez le mot de passe qui vous a été communiqué pour découvrir Fil One Commerce.",
  "demo.access.password": "Mot de passe",
  "demo.access.submit": "Continuer",
  "demo.access.invalid": "Ce mot de passe ne correspond pas. Réessayez.",
  "demo.landing.eyebrow": "Démonstration guidée",
  "demo.landing.title": "Choisissez le profil avec lequel vous connecter",
  "demo.landing.description":
    "Chaque profil ouvre Fil One Commerce sur son domaine de travail. Vous pouvez changer de profil depuis le panneau de démonstration.",
  "demo.landing.start": "Commencer en tant que {name}",
  "demo.landing.internal": "Personnel de Fil One",
  "demo.landing.external": "Clients et partenaires",
  "demo.panel.title": "Commandes de démonstration",
  "demo.panel.open": "Ouvrir les commandes de démonstration",
  "demo.panel.close": "Fermer les commandes de démonstration",
  "demo.panel.persona": "Connecté en tant que",
  "demo.panel.journey": "Parcours",
  "demo.panel.reset": "Restaurer les données de démonstration",
  "demo.panel.resetting": "Réinitialisation…",
  "demo.panel.reset.failed":
    "Les données de démonstration n’ont pas pu être réinitialisées.",
  "demo.panel.browse": "Tous les profils",
  "app.verifyAuthentication":
    "Vérifier votre identité pour les modifications sensibles",
  "app.signOut": "Se déconnecter",
  "app.skip": "Aller au contenu principal",
  "app.nav.primary": "Navigation principale",
  "app.nav.secondary": "Compte et aide",
  "app.nav.open": "Ouvrir la navigation",
  "app.nav.title": "Navigation",
  "app.nav.description": "Parcourir toutes les rubriques.",
  "app.nav.close": "Fermer la navigation",
  "app.search": "Rechercher",
  "app.search.hint": "Comptes, commandes, factures ou documents",
  "app.command": "Ouvrir le menu de commandes",
  "app.command.title": "Recherche et commandes",
  "app.command.description":
    "Trouvez une rubrique, lancez une tâche courante ou ouvrez un enregistrement récent.",
  "app.command.searchLabel":
    "Rechercher des rubriques, des actions et des enregistrements",
  "app.command.noResults":
    "Aucun résultat. Essayez un identifiant, un compte ou une action.",
  "app.command.group.navigation": "Navigation",
  "app.command.group.actions": "Actions",
  "app.command.group.records": "Enregistrements",
  "app.command.action.customerQuote":
    "Configurez la capacité, la durée et les modalités commerciales.",
  "app.command.action.inviteUser": "Gérez l’accès à l’organisation actuelle.",
  "app.command.action.registerDeal":
    "Protégez une nouvelle opportunité partenaire.",
  "app.command.action.partnerQuote":
    "Établissez les tarifs pour un client final.",
  "app.command.action.globalSearch":
    "Recherchez des comptes et des enregistrements opérationnels.",
  "app.command.action.reviewApprovals":
    "Ouvrez la file des approbations et des exceptions.",
  "app.command.shortcut": "Commande K",
  "app.help": "Aide",
  "app.help.description": "Guides, assistance et état du service",
  "app.help.internal": "Prérequis externes et consignes opérationnelles",
  "app.help.internal.description":
    "Consultez les prérequis d’activation, les responsables et les consignes opérationnelles",
  "app.account.switch": "Changer d’organisation",
  "app.account.switched": "Organisation sélectionnée : {account}.",
  "app.account.choose.title": "Choisissez une organisation",
  "app.account.choose.description":
    "Sélectionnez une organisation active autorisée pour votre identité WorkOS.",
  "app.account.choose.empty.title": "Aucune organisation autorisée",
  "app.account.choose.empty.description":
    "Cette identité ne dispose d’aucune appartenance commerciale active. Un administrateur peut vous accorder un accès, ou vous pouvez vous déconnecter et utiliser une autre identité.",
  "app.profile": "Ouvrir le menu du profil",
  "app.requestId": "Requête {id}",
  "app.footer":
    "Les enregistrements commerciaux Fil One sont synchronisés avec le registre opérationnel.",
  "app.offline":
    "Vous êtes hors ligne. Les informations enregistrées restent disponibles ; les modifications attendront le rétablissement de la connexion.",
  "app.online":
    "Connexion rétablie. Vous pouvez envoyer les modifications en attente.",
  "session.expired.title": "Votre session s’est terminée en toute sécurité",
  "session.expired.description":
    "Reconnectez-vous pour continuer. Les brouillons sont toujours enregistrés sur cet appareil.",
  "session.expired.action": "Se reconnecter",
  "session.mfa.title": "Une vérification supplémentaire",
  "session.mfa.description":
    "Votre rôle exige une authentification multifacteur avant de pouvoir effectuer des actions commerciales.",
  "session.mfa.action": "Vérifier votre identité",
  "session.permission.title": "Votre rôle ne permet pas d’accéder à cette vue",
  "session.permission.description":
    "Changez d’organisation ou demandez à un propriétaire de modifier votre rôle commercial.",
  "session.permission.action": "Revenir au tableau de bord",
  "nav.dashboard": "Vue d’ensemble",
  "nav.buy": "Acheter",
  "nav.payg": "Paiement à l’usage et essais",
  "nav.agreements": "Accords",
  "nav.quotes": "Devis",
  "nav.orders": "Commandes",
  "nav.services": "Services actifs",
  "nav.pocs": "Preuves de concept",
  "nav.billing": "Facturation",
  "nav.amendments": "Avenants",
  "nav.marketplace": "Marketplace",
  "nav.support": "Assistance",
  "nav.account": "Compte",
  "nav.partner.home": "Espace partenaire",
  "nav.partner.portfolio": "Clients finaux",
  "nav.partner.registrations": "Enregistrement d’opportunités",
  "nav.partner.quotes": "Devis partenaires",
  "nav.partner.billing": "Facturation consolidée",
  "nav.partner.commissions": "Commissions",
  "nav.partner.renewals": "Renouvellements",
  "nav.partner.disputes": "Litiges",
  "nav.partner.marketplace": "Marketplace",
  "nav.partner.sandboxes": "Environnements de test et POC",
  "nav.partner.brand": "Marque et domaines",
  "nav.partner.enablement": "Ressources partenaires",
  "nav.partner.support": "Assistance",
  "nav.internal.home": "Opérations",
  "nav.internal.search": "Recherche globale",
  "nav.internal.queues": "Files et approbations",
  "nav.internal.renewals": "Gestion des renouvellements",
  "nav.internal.collections": "Recouvrement",
  "nav.internal.provisioning": "Provisionnement",
  "nav.internal.recovery": "Reprise",
  "nav.internal.webhookReplay": "Réexécution des webhooks",
  "nav.internal.migrations": "Migrations",
  "nav.internal.reports": "Rapports",
  "nav.internal.revenue": "Revenus et canal",
  "nav.internal.billingReconciliation": "Rapprochement de facturation",
  "nav.internal.status": "État des intégrations",
  "nav.internal.unhandledErrors": "Erreurs non gérées",
  "nav.internal.agreements": "Versions des accords",
  "nav.internal.approvals": "Examen des approbations",
  "nav.internal.priceBooks": "Grilles tarifaires",
  "nav.internal.paygRequests": "Demandes de service",
  "nav.internal.paygOffers": "Paiement à l’usage et essais",
  "nav.internal.capabilities": "Fonctionnalités activées",
  "nav.internal.providers": "Références des fournisseurs",
  "nav.internal.catalog": "Correspondances du catalogue",
  "nav.internal.channelPolicy": "Politique de canal",
  "nav.internal.gates": "Prérequis externes",
  "nav.internal.assisted": "Mode assisté",
  "nav.group.pricing": "Tarification",
  "nav.group.legal": "Dossier juridique",
  "nav.group.service": "Service",
  "nav.group.organization": "Organisation",
  "nav.group.partner.dealFlow": "Opportunités",
  "nav.group.partner.revenue": "Revenus",
  "nav.group.partner.channel": "Canal",
  "nav.group.internal.queues": "Files d’exceptions",
  "nav.group.internal.providerRecovery": "Reprise des fournisseurs",
  "nav.group.internal.administration": "Administration",
  "action.view": "Voir les détails",
  "action.review": "Examiner",
  "action.retry": "Réessayer",
  "action.returnHome": "Revenir à votre tableau de bord",
  "action.cancel": "Annuler",
  "action.download": "Télécharger le PDF",
  "action.createQuote": "Créer un devis",
  "action.invite": "Inviter un utilisateur",
  "action.open": "Ouvrir l’enregistrement",
  "action.register": "Enregistrer une opportunité",
  "common.status": "État",
  "common.updated": "Dernière mise à jour",
  "common.term": "Durée",
  "status.active": "Actif",
  "status.inNotice": "En période de préavis",
  "status.awaiting": "Action attendue",
  "status.review": "À examiner",
  "status.paid": "Payé",
  "status.ready": "Prêt",
  "status.pending": "En attente",
  "status.provisioning": "En cours de provisionnement",
  "status.blocked": "Bloqué",
  "status.complete": "Terminé",
  "status.draft": "Brouillon",
  "status.signed": "Signé",
  "dashboard.eyebrow": "État du compte",
  "dashboard.description":
    "Activité commerciale, état du service et prochaines échéances contractuelles de Northstar Archive Labs.",
  "dashboard.chain": "Activité récente",
  "dashboard.activeServices": "Services actifs",
  "dashboard.empty.obligations":
    "Aucune décision n’est nécessaire pour le moment. Les échéances commerciales apparaîtront ici à leur approche.",
  "dashboard.empty.services":
    "Aucun service n’est encore actif. Les commandes acceptées apparaîtront dès le début du provisionnement.",
  "dashboard.empty.activity":
    "Aucune activité du compte n’a été enregistrée sur cette période.",
  "dashboard.empty.capacity":
    "La capacité souscrite, l’usage actuel et les 30 jours précédents apparaîtront une fois l’usage mesuré communiqué pour ce compte.",
  "dashboard.openQuotes": "Devis ouverts",
  "dashboard.invoiceDue": "Facture à régler",
  "dashboard.daysToNotice": "Jours avant la période de préavis",
  "agreements.eyebrow": "Dossier juridique",
  "agreements.title": "Accords",
  "agreements.description":
    "Conditions conclues, preuves de signature, versions applicables et échéances de renouvellement dans un même dossier.",
  "agreements.execute": "Conclure un accord",
  "agreements.execute.binding":
    "Confirmez le titre, la version, les conditions exactes approuvées et votre pouvoir d’engager {account}.",
  "agreements.execute.source": "Conclusion au titre de l’accord {reference}",
  "agreements.execute.validation.authority":
    "Saisissez la fonction disposant du pouvoir de signature pour cette entité juridique.",
  "agreements.execute.validation.attestation":
    "Confirmez votre pouvoir d’engager cette entité juridique avant de conclure l’accord.",
  "agreements.execute.accepted":
    "Accord conclu. La preuve de votre pouvoir de signature figure au dossier.",
  "agreements.execute.acceptedLink": "Ouvrir l’accord conclu",
  "quotes.eyebrow": "Des prix en toute confiance",
  "quotes.title": "Devis",
  "quotes.description":
    "Les versions émises et immuables restent liées à leur grille tarifaire, leur accord et leur commande.",
  "quotes.builder.title": "Créer un devis",
  "quotes.builder.description":
    "Configurez le service ; l’API commerciale reste la source des tarifs et des décisions d’approbation.",
  "quotes.builder.account.description": "Compte autorisé pour cette session",
  "quotes.builder.origin.revision": "Révision du devis {reference}",
  "quotes.builder.origin.poc": "Conversion de la preuve de concept {reference}",
  "quotes.builder.origin.unavailable":
    "L’enregistrement indiqué est extérieur à ce compte. Le brouillon commence sans données d’origine.",
  "quotes.builder.created":
    "Brouillon chiffré créé. Vous pourrez l’émettre lorsque son document sera préparé et lié.",
  "quotes.builder.createdLink": "Ouvrir le brouillon créé",
  "orders.eyebrow": "De l’engagement au service",
  "orders.title": "Commandes et services",
  "orders.description":
    "Bons de commande, provisionnement, droits, usage, avenants et échéances sans ressaisie.",
  "orders.amendment": "Demander un avenant",
  "orders.accept.source": "Devis accepté {reference} · version {version}",
  "orders.accept.agreement.unknown":
    "Aucun accord actif applicable n’est enregistré pour ce compte.",
  "orders.accept.unavailable.title":
    "Aucun devis pouvant être accepté n’est sélectionné",
  "orders.accept.unavailable.description":
    "L’acceptation d’une commande commence par un devis accepté de ce compte. Choisissez-en un dans le registre des devis.",
  "orders.accept.unavailable.action": "Ouvrir le registre des devis",
  "orders.accept.validation.po": "Saisissez la référence du bon de commande.",
  "orders.accept.validation.serviceStart":
    "Choisissez la date de début du service.",
  "orders.accept.validation.authority":
    "Saisissez la fonction disposant du pouvoir d’acceptation.",
  "orders.accept.validation.confirmation":
    "Confirmez l’engagement examiné avant d’accepter.",
  "orders.accept.created":
    "Commande créée. Son engagement et son état de provisionnement font désormais foi.",
  "orders.accept.createdLink": "Ouvrir la commande créée",
  "orders.accept.prepared":
    "Formulaire de commande demandé. Votre engagement sera créé une fois le document généré et lié au devis.",
  "orders.accept.preparedLink": "Suivre cette acceptation dans les commandes",
  "orders.accept.failed":
    "La commande n’a pas pu être acceptée. Aucune modification n’a été effectuée.",
  "pocs.eyebrow": "Tester en toute sécurité",
  "pocs.title": "Preuves de concept",
  "pocs.description":
    "Environnements isolés avec plafonds, jalons, critères de réussite, coûts et conversion préservant les données.",
  "billing.eyebrow": "Une facturation claire et traçable",
  "billing.title": "Facturation et paiements",
  "billing.description":
    "Les factures indiquent la commande et le bon de commande d’origine, les reçus, les avoirs, l’ancienneté, le traitement fiscal et les moyens de paiement.",
  "billing.aging": "Balance âgée des créances clients",
  "account.eyebrow": "Gestion de l’organisation",
  "account.title": "Compte, utilisateurs et achats",
  "account.description":
    "Identité juridique, rôles d’approbation, comptabilité fournisseurs, référencement, justificatifs fiscaux et sortie sécurisée.",
  "account.users": "Utilisateurs et rôles",
  "account.procurement": "Profil d’achats",
  "account.offboarding": "Sortie et certificats",
  "account.owner": "Propriétaire du compte",
  "account.billingContact": "Contact de facturation",
  "account.people": "Personnes autorisées",
  "account.invitations": "Invitations en attente",
  "account.unassigned": "Non enregistré",
  "account.areas.users.meta.one": "{count} personne autorisée",
  "account.areas.users.meta.other": "{count} personnes autorisées",
  "account.areas.procurement.meta.one": "{count} exigence enregistrée",
  "account.areas.procurement.meta.other": "{count} exigences enregistrées",
  "account.areas.offboarding.meta": "Confirmation requise pour chaque demande",
  "account.offboarding.service": "Service",
  "account.offboarding.empty.title":
    "Aucun service ne peut faire l’objet d’une sortie",
  "account.offboarding.empty.description":
    "La sortie commence depuis une commande active de ce compte. Les engagements actifs figurent dans les commandes et services.",
  "account.offboarding.empty.action": "Ouvrir les commandes et services",
  "account.offboarding.validation.effectiveAt":
    "Choisissez la date et l’heure de prise d’effet demandées.",
  "account.offboarding.validation.confirmation":
    "Confirmez les garanties de conservation et d’approbation examinées avant l’envoi.",
  "account.offboarding.requested":
    "Demande de sortie envoyée pour approbation. Votre service fonctionne toujours.",
  "account.offboarding.requestedLink": "Ouvrir le service concerné",
  "account.offboarding.failed": "La demande de sortie n’a pas pu être envoyée.",
  "partner.eyebrow": "Les échéances de l’accord d’abord",
  "partner.title": "Espace partenaire",
  "partner.description":
    "Votre accord applicable est prioritaire ; les services actifs des clients finaux continuent selon les clauses qui restent en vigueur.",
  "partner.portfolio.title": "Portefeuille de clients finaux",
  "partner.portfolio.description":
    "Usage, provisionnement, exposition aux échéances et prochaine action pour chaque client final attribué.",
  "partner.registration.title": "Enregistrement d’opportunités et litiges",
  "partner.registration.description":
    "Périodes de protection, délais de décision, demandes concurrentes et arbitrages enregistrés par canal.",
  "partner.quotes.title": "Devis partenaires et de revente",
  "partner.quotes.description":
    "Les prix de transfert restent privés ; les documents de revente destinés aux clients n’affichent que le prix que vous fixez.",
  "partner.billing.title": "Facturation consolidée",
  "partner.billing.description":
    "Une facture au partenaire, regroupée par client final, avec exposition globale et sans contact commercial avec le client final.",
  "partner.commissions.title": "Commissions et relevés",
  "partner.commissions.description":
    "Les commissions d’apporteur sont calculées sur les revenus nets encaissés ; les relevés déduisent remboursements, avoirs et rétrofacturations.",
  "partner.renewals.title": "Renouvellements partenaires",
  "partner.renewals.description":
    "Agissez pour chaque client final avant la fin du préavis ; Fil One confirme l’action sans contacter commercialement les clients de revente.",
  "partner.sandboxes.title": "Environnements de test partenaires",
  "partner.sandboxes.description":
    "Des environnements gratuits, plafonnés et temporaires utilisent le même processus de provisionnement des droits.",
  "partner.brand.title": "Marque et domaines personnalisés",
  "partner.brand.description":
    "Préparez les marques interchangeables, les couleurs approuvées, l’identité des devis et la vérification des domaines sans modifier les dossiers juridiques.",
  "partner.marketplace.title": "État de la marketplace",
  "partner.marketplace.description":
    "Consultation des offres, acheteurs, exécutions et versements des marketplaces AWS, Azure et Google Cloud.",
  "partner.access.title":
    "Aucune appartenance partenaire pour l’organisation sélectionnée",
  "partner.access.description":
    "Cet espace s’ouvre pour une organisation que votre identité est autorisée à représenter. Changez d’organisation ou demandez votre ajout à un administrateur partenaire.",
  "partner.access.action": "Changer d’organisation",
  "partner.detail.notFound.title":
    "Cet enregistrement partenaire n’est pas disponible",
  "partner.detail.notFound.description":
    "Cette référence est inconnue ou extérieure à vos comptes autorisés.",
  "partner.detail.notFound.action": "Revenir à la liste",
  "partner.detail.notRecorded": "Non enregistré",
  "partner.detail.reference": "Référence",
  "partner.detail.position": "Position commerciale",
  "partner.detail.milestone": "Prochain jalon",
  "partner.detail.owner": "Responsable",
  "partner.detail.risk": "Risque commercial",
  "partner.detail.portfolio.eyebrow": "Dossier commercial du client final",
  "partner.detail.portfolio.term": "Service et durée commerciale",
  "partner.detail.term.unavailable.title":
    "Aucune durée de service n’est enregistrée pour ce client final",
  "partner.detail.term.unavailable.description":
    "La durée écoulée, la période de préavis et la date de fin apparaîtront lorsqu’une commande ou un accord les publiera.",
  "partner.detail.transfer.description":
    "Le coût privé de Fil One pour ce canal. Il provient de la grille tarifaire approuvée et n’est jamais montré au client final.",
  "partner.detail.resale.description":
    "Le prix fixé par le partenaire et présenté au client final indiqué.",
  "partner.detail.merchant.description":
    "La partie qui contracte avec le client final et le facture sur ce canal.",
  "partner.detail.quote.eyebrow": "Devis de revente partenaire",
  "partner.detail.quote.boundary": "Séparation des prix du devis",
  "partner.detail.quote.actions": "Actions valides pour ce devis",
  "partner.detail.quote.edit": "Modifier le brouillon",
  "partner.detail.quote.revise": "Créer une révision",
  "partner.detail.quote.issue.title": "L’émission est soumise à conditions",
  "partner.detail.quote.issue.description":
    "Fil One prépare et lie d’abord des documents distincts pour le client final et le partenaire. L’action apparaît lorsque les deux sont prêts, puis ouvre l’examen et la confirmation.",
  "partner.detail.quote.cancel.title": "L’annulation n’est pas disponible ici",
  "partner.detail.quote.cancel.description":
    "Les opérations de canal gèrent l’annulation des devis partenaires. Contactez-les pour annuler ce devis.",
  "partner.detail.quote.download.title":
    "Le téléchargement dépend du fournisseur",
  "partner.detail.quote.download.description":
    "Le lien immuable apparaît lorsque le service documentaire renvoie un document conservé et visible par le partenaire.",
  "partner.detail.projection.record": "ID de l’enregistrement",
  "partner.detail.projection.version": "Version de l’enregistrement",
  "partner.quote.new.disabled.unconfirmed":
    "Confirmez l’examen ci-dessus pour créer le brouillon chiffré.",
  "partner.quote.new.disabled.created":
    "Le brouillon chiffré a été créé. Ouvrez-le depuis la liste des devis pour continuer.",
  "partner.quote.new.success":
    "Brouillon créé à partir des tarifs du serveur. Vérifiez le prix de transfert renvoyé avant d’utiliser l’action Émettre.",
  "partner.quote.new.failure": "Le devis n’a pas pu être créé.",
  "support.title": "Suivi de l’assistance",
  "support.description":
    "Tickets liés à ce compte en lecture seule. Continuez à utiliser le canal habituel pour les nouvelles demandes.",
  "internal.eyebrow": "Administration interne",
  "internal.title": "Opérations commerciales",
  "internal.description":
    "Un registre opérationnel pour les comptes, exceptions, approbations, reprises, renouvellements et rapprochements.",
  "internal.search.title": "Recherche globale",
  "internal.search.description":
    "Trouvez des comptes et des enregistrements opérationnels regroupés par type.",
  "internal.assisted.title": "Exécution assistée",
  "internal.assisted.description":
    "Exécutez les actions client ou partenaire avec un motif, l’identité de l’acteur conservée et le même processus contractuel.",
  "internal.queues.title": "Files d’exceptions et approbations",
  "internal.queues.description":
    "Tarification, juridique, crédit, vérifications, litiges, enregistrement, POC, actions destructives et migrations avec responsables principaux et suppléants.",
  "internal.priceBooks.title": "Administration des grilles tarifaires",
  "internal.priceBooks.description":
    "Tarifs en USD, EUR et GBP datés, paliers de transfert, codes fiscaux, dépassements et marges minimales.",
  "internal.agreements.title": "Administration des accords et contrats clients",
  "internal.agreements.description":
    "Modèles approuvés par le conseil juridique, contrats clients, négociations, conditions clés, preuves de conclusion et versions immuables.",
  "internal.provisioning.title": "Reprise du provisionnement",
  "internal.provisioning.description":
    "Examinez les tentatives persistantes, classez les défaillances et relancez en toute sécurité avec la clé d’idempotence d’origine.",
  "internal.collections.title": "Recouvrement et litiges",
  "internal.collections.description":
    "Relances de paiement, balance âgée, suspension tenant compte de la conservation, délais de preuves, avoirs, remboursements et rétrofacturations.",
  "internal.renewals.title": "Centre des renouvellements",
  "internal.renewals.description":
    "Exposition à 30, 60–90 et 180 jours des contrats directs, apportés par des partenaires et des accords partenaires.",
  "internal.reports.title": "Rapports et rapprochement",
  "internal.reports.description":
    "Prévisions, capacité, attrition, canal, entonnoir, marge et rapprochement à trois voies avec exports traçables.",
  "internal.migrations.title": "Examen des migrations",
  "internal.migrations.description":
    "Résolvez les correspondances ambiguës de comptes existants avant toute création d’enregistrement ou demande d’acceptation.",
  "internal.gates.title": "État des prérequis externes",
  "internal.gates.description":
    "Preuves d’activation pour les identifiants, le juridique, le commercial, la fiscalité, les fournisseurs, le provisionnement, les domaines, la marque, les approbateurs et le démantèlement.",
  "signing.eyebrow": "Conclusion sécurisée",
  "signing.title": "Examiner et signer",
  "signing.description":
    "Votre position est conservée pendant l’ouverture du fournisseur de signature. Aucun accord n’est actif avant réception et vérification de la confirmation.",
  "signing.redirect": "Continuer vers la signature sécurisée",
  "signing.embedded": "Signature intégrée",
  "signing.loading":
    "Préparation de la session de signature et vérification de la version exacte du document.",
  "signing.failed":
    "Le fournisseur de signature n’a pas répondu. Votre accord reste inchangé.",
  "signing.recover": "Se reconnecter à la signature",
  "signing.returned":
    "Signature vérifiée. Le document conclu et le certificat de finalisation figurent dans le dossier de l’accord.",
  "signing.unverified":
    "La réponse ne correspond pas à l’enveloppe et à l’empreinte du document attendues. L’accord reste inchangé.",
  "states.eyebrow": "Une expérience résiliente",
  "states.title": "Chaque état propose une suite sûre",
  "states.description":
    "Réponses prévues pour la latence, l’absence, les données partielles, le travail optimiste, la validation, l’accès, la concurrence, la connectivité et les défaillances des fournisseurs.",
  "state.loading.title": "Préparation de la vue du compte",
  "state.loading.description":
    "Les échéances contractuelles et les données financières arrivent séparément ; les sections disponibles s’affichent d’abord.",
  "state.empty.title": "Aucun enregistrement pour le moment",
  "state.empty.description":
    "Commencez par un devis. Tout le reste en découle.",
  "state.partial.title": "Les données d’usage sont temporairement retardées",
  "state.partial.description":
    "Les données commerciales sont à jour jusqu’à 16 h UTC. L’usage sera complété sans modifier les totaux.",
  "state.success.title": "L’enregistrement est complet",
  "state.success.description":
    "Le document immuable, l’événement d’audit et la notification ont été créés ensemble.",
  "state.validation.title": "Vérifiez la valeur mise en évidence",
  "state.validation.description":
    "La capacité souscrite doit atteindre le minimum de l’offre sélectionnée.",
  "state.stale.title": "Une version plus récente est disponible",
  "state.stale.description":
    "Votre brouillon est conservé. Examinez la dernière version avant de l’appliquer à nouveau.",
  "state.recoverable.title": "Le fournisseur nécessite une nouvelle tentative",
  "state.recoverable.description":
    "Aucune action en double n’a été créée. La nouvelle tentative utilise la clé d’idempotence d’origine.",
  "state.notFound.title": "Cette page n’est pas disponible",
  "state.notFound.description":
    "L’adresse a peut-être changé, ou l’enregistrement n’est plus visible pour ce compte.",
  "state.fatal.title": "Cette action ne peut pas continuer",
  "state.fatal.description":
    "Rechargez pour consulter le dernier enregistrement avant de réessayer. Si le problème persiste, contactez l’assistance avec l’ID de requête.",
  "detail.eyebrow": "Dossier documentaire",
  "detail.description":
    "Identifiants, références applicables, preuves, documents et derniers événements d’audit de cette version immuable.",
  "detail.provenance": "Origine de l’enregistrement",
  "detail.upstream": "Document source",
  "detail.version": "Version commerciale",
  "detail.hash": "Empreinte du contenu",
  "detail.documents": "Documents associés",
  "detail.audit": "Historique d’audit",
  "chart.usage": "Capacité stockée au cours des six derniers mois",
  "chart.spend": "Dépenses facturées au cours des six derniers mois",
  "chart.capacity": "Capacité souscrite et provisionnée par région",
  "chart.axis.month": "Mois",
  "chart.axis.value": "Valeur",
  "term.annual": "Service annuel souscrit",
  "term.partner": "Accord partenaire Meridian",
  "term.rollup": "Synthèse des durées du compte",
  "term.count.one": "{count} durée active",
  "term.count.other": "{count} durées actives",
  "term.next": "Prochaine date de fin",
  "term.none": "Aucune durée active",
  "term.archive": "Archive principale",
  "term.replica": "Réplique de conformité de Madrid",
  "states.optimistic.title": "Modification affichée pendant sa vérification",
  "states.optimistic.description":
    "Si le contrat la refuse, la valeur précédente est rétablie et le focus passe à l’explication.",
  "states.offline.title": "Enregistré en attendant la reconnexion",
  "states.offline.description":
    "Les enregistrements en lecture seule restent disponibles ; aucune action financière ou contractuelle n’est présumée terminée.",
  "format.tax.us": "Taxe sur les ventes",
  "format.tax.eu": "TVA",
  "format.tax.uk": "TVA",
  "projection.action.readOnly":
    "Lecture seule. Un propriétaire du compte ou l’approbateur désigné peut agir sur cet enregistrement.",
  "projection.action.pending": "Envoi…",
  "projection.action.submitting": "Envoi de {action} à l’API commerciale.",
  "projection.action.queued":
    "{action} est en file d’attente. En attente du résultat faisant foi.",
  "projection.action.applied":
    "{action} a été appliqué à la version faisant foi {version}.",
  "projection.action.appliedUnknownVersion":
    "{action} a été appliqué. La version faisant foi n’a pas été renvoyée.",
  "projection.action.rejected":
    "{action} n’a pas été appliqué. L’API commerciale a renvoyé {status} : {code}.",
  "projection.action.timeout":
    "{action} est toujours en cours. Le résultat n’est pas encore confirmé ; l’enregistrement peut donc encore changer.",
  "projection.action.rechecking": "Vérification du résultat de {action}.",
  "projection.action.recheck": "Vérifier à nouveau le résultat",
  "projection.action.conflict":
    "L’enregistrement a changé. Actualisez avant de réessayer.",
  "projection.action.confirm.title": "{action} ?",
  "projection.action.confirm.description":
    "Cette action concerne {record} à la version {version}.",
  "projection.action.confirm.detail":
    "La commande s’exécute sur l’enregistrement faisant foi et est consignée dans l’audit. Son annulation nécessite une action autorisée distincte.",
  "projection.action.confirm.cancel": "Conserver l’enregistrement inchangé",
  "projection.action.accept": "Accepter",
  "projection.action.addContact": "Ajouter un contact",
  "projection.action.addRole": "Ajouter un rôle",
  "projection.action.applyAmendment": "Appliquer l’avenant",
  "projection.action.approveException": "Approuver l’exception",
  "projection.action.consolidate": "Consolider les factures",
  "projection.action.create": "Créer un enregistrement",
  "projection.action.evaluateDunning": "Évaluer les relances",
  "projection.action.executeAgreement": "Accepter et conclure",
  "projection.action.expire": "Faire expirer maintenant",
  "projection.action.issue": "Émettre",
  "projection.action.markUncollectible": "Marquer comme irrécouvrable",
  "projection.action.openInvoice": "Ouvrir la facture",
  "projection.action.pay": "Enregistrer le paiement",
  "projection.action.prepareArtifact": "Préparer le document",
  "projection.action.convertPoc": "Convertir en devis payant",
  "projection.action.price": "Chiffrer ce devis",
  "projection.action.rejectException": "Refuser l’exception",
  "projection.action.requestTeardown": "Demander le démantèlement",
  "projection.action.requestRenewal": "Demander le renouvellement",
  "projection.action.revise": "Créer une révision",
  "projection.action.setPartnerCredit": "Définir le crédit partenaire",
  "projection.action.setPaymentTerms": "Définir les conditions de paiement",
  "projection.action.update": "Mettre à jour les détails",
  "projection.action.void": "Annuler la facture",
  "signing.agreementId": "ID de l’accord",
  "signing.agreementReference": "Référence de l’accord",
  "signing.serverSelected":
    "Le serveur sélectionne votre compte, l’identité du signataire et le document immuable à partir de cet accord enregistré.",
  "signing.startEmbedded": "Démarrer la signature intégrée",
  "signing.accepted":
    "Enveloppe acceptée. L’accord reste inactif jusqu’à la vérification d’un retour signé du fournisseur.",
  "signing.continue": "Continuer vers le fournisseur de signature approuvé",
  "signing.frame": "Fournisseur de signature électronique sécurisée",
  "signing.checking": "Vérification de l’état enregistré de l’enveloppe…",
  "signing.download": "Télécharger l’accord signé",
  "signing.pending.title": "Signature en attente",
  "signing.pending.description":
    "Le fournisseur n’a pas encore confirmé la finalisation de la signature.",
  "signing.refresh": "Actualiser l’état",
  "signing.declined.title": "Signature refusée",
  "signing.expired.title": "Session de signature expirée",
  "signing.unchanged":
    "L’accord reste inchangé. Ouvrez son dossier pour consulter les prochaines étapes.",
  "signing.agreements": "Revenir aux accords",
  "signing.missingState":
    "Le retour de signature ne contient aucune référence d’état faisant foi.",
  "signing.unverifiable":
    "Le serveur n’a pas pu vérifier l’état de la signature.",
  "signing.requestFailed":
    "La demande de signature a échoué. L’accord reste inchangé.",
  "signing.choose.title": "Choisissez d’abord un accord",
  "signing.choose.description":
    "La signature commence depuis un accord autorisé afin que le serveur sélectionne la version exacte du document.",
  "signing.demo.eyebrow": "Service de signature de démonstration",
  "signing.demo.title": "Signer le document",
  "signing.demo.description":
    "Ce service simule le fournisseur de signature. La signature complète l’enveloppe et vous ramène à Fil One, où le rapprochement réel du retour s’exécute.",
  "signing.demo.document": "Document",
  "signing.demo.signer": "Signataire",
  "signing.demo.envelope": "Enveloppe",
  "signing.demo.action": "Signer le document",
  "signing.demo.unavailable.title":
    "Cette session de signature n’est pas disponible",
  "signing.demo.unavailable.description":
    "L’état de signature est inconnu ou a expiré. Recommencez depuis le dossier de l’accord.",
  "workflow.confirm.title": "Confirmez cette décision",
  "workflow.confirm.description":
    "Cette décision est enregistrée avec les identifiants ci-dessus.",
  "workflow.confirm.detail":
    "Vérifiez les identifiants, le motif et la référence des preuves. Un refus ou une demande de démantèlement ferme la voie commerciale actuelle ; seule une nouvelle décision la rouvre.",
  "workflow.confirm.cancel": "Conserver l’enregistrement inchangé",
  "workflow.confirm.action": "Confirmer et envoyer",
} satisfies MessageCatalog;

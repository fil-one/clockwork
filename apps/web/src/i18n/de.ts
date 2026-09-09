import type { MessageCatalog } from "./en";

export const de = {
  "quotes.form.description":
    "Wählen Sie ein Angebot, Kapazität und Laufzeit. Prüfen Sie anschließend den Entwurf.",
  "quotes.form.offerHelp":
    "Wählen Sie ein verfügbares Angebot für Ihre gewünschte Region.",
  "quotes.form.reviewTitle": "Entwurf prüfen",
  "quotes.form.reviewDescription":
    "Beim Erstellen des Entwurfs wird Ihr Preis berechnet. Öffnen Sie dann den gespeicherten Entwurf, um das Dokument vorzubereiten und das Angebot auszustellen. Vor Annahme einer Bestellung können Sie es prüfen.",
  "quotes.form.expiryHelp":
    "Verwenden Sie Ihr lokales Datum und Ihre lokale Uhrzeit.",
  "quotes.form.expiryFuture":
    "Wählen Sie einen Ablaufzeitpunkt in der Zukunft.",
  "quotes.form.stageTerms": "Kapazität, Laufzeit und Ablauf",
  "quotes.form.stageReview": "Entwurf prüfen",
  "quotes.form.partnerDescription":
    "Wählen Sie ein Angebot und einen Endkunden und legen Sie Ihren Wiederverkaufspreis fest. Fil One berechnet beim Erstellen des Entwurfs Ihren Transferpreis.",

  "quotes.issue.title": "Angebot fertigstellen",
  "quotes.issue.description":
    "Bereiten Sie das Dokument dieses gespeicherten Angebots zur Annahme vor. Durch die Ausstellung entsteht noch keine Bestellung.",
  "quotes.issue.action": "Angebot vorbereiten und ausstellen",
  "quotes.issue.working": "Angebot wird vorbereitet…",
  "quotes.issue.retry": "Dieses Angebot fortsetzen",
  "quotes.issue.accept": "Bestellung prüfen und annehmen",
  "quotes.issue.refresh":
    "Aktualisieren Sie diese Seite, um das Angebot und Ihre Zugriffsrechte zu prüfen. Versuchen Sie es dann erneut.",
  "quotes.issue.pricingReview":
    "Vor der Ausstellung muss der Preis dieses Entwurfs geprüft werden. Wenden Sie sich an Ihr Fil One-Team.",
  "quotes.issue.documentUnavailable":
    "Das Angebotsdokument konnte nicht verifiziert werden. Es wurde kein Angebot ausgestellt. Versuchen Sie es erneut.",
  "quotes.issue.rendering":
    "Das Dokument wird noch vorbereitet. Setzen Sie dieses Angebot fort, um erneut zu prüfen.",
  "quotes.issue.synchronizing":
    "Das Angebot wurde ausgestellt. Der Status wird noch aktualisiert. Setzen Sie fort, um erneut zu prüfen.",

  "cp.common.loadingTitle": "Datensätze werden geladen",
  "cp.common.loadingBody": "Die neuesten Datensätze werden abgerufen.",
  "cp.common.emptyTitle": "Noch keine Einträge",
  "cp.common.emptyBody":
    "Datensätze erscheinen, sobald die Arbeit an diesem Konto beginnt.",
  "cp.common.noMatchTitle": "Keine Datensätze entsprechen diesen Filtern",
  "cp.common.noMatchBody":
    "Entfernen oder ändern Sie einen Filter, um weitere Ergebnisse zu sehen.",
  "cp.common.permissionTitle":
    "Diese Informationen sind für Ihre Rolle nicht verfügbar",
  "cp.common.permissionBody":
    "Bitten Sie einen Kontoinhaber, Ihnen den erforderlichen Zugriff zu gewähren.",
  "cp.common.errorTitle": "Datensätze konnten nicht geladen werden",
  "cp.common.errorBody":
    "Versuchen Sie es erneut. Ihre Filter wurden beibehalten.",
  "cp.common.freshnessCurrent": "Datensätze sind aktuell",
  "cp.common.freshnessReadAt": "Abgerufen",
  "cp.common.freshnessStaleTitle":
    "Diese Datensätze sind möglicherweise veraltet.",
  "cp.common.freshnessStaleBody":
    "Die Daten dieser Seite sind noch nicht mit ihrer Quelle synchronisiert. Aktuelle Änderungen können fehlen. Aktualisieren Sie die Seite, bevor Sie handeln.",
  "cp.common.freshnessAction": "Datensätze aktualisieren",
  "cp.common.freshnessPartialTitle":
    "Nur ein Teil dieser Sammlung konnte abgerufen werden.",
  "cp.common.freshnessPartialBody":
    "Dieses Konto enthält in diesem Kanal mehr Datensätze, als ein einzelner Abruf zurückgibt. Unten stehen die zuletzt aktualisierten Datensätze. Ergebniszahl, Filter, Summen und Sortierung beziehen sich nur auf die abgerufenen Daten: Eine korrekt nach Wert sortierte Liste kann trotzdem den wertmäßig größten Datensatz auslassen. Der unvollständige Abruf wurde gemeldet; erneutes Laden liefert die übrigen Daten nicht.",
  "cp.common.unsavedTitle": "Ohne Speichern verlassen?",
  "cp.common.unsavedBody":
    "Noch keine Eingaben dieses Formulars wurden an den Server gesendet. Beim Verlassen werden alle Eingaben verworfen.",
  "cp.common.unsavedDiscard": "Verwerfen und verlassen",
  "cp.common.unsavedKeep": "Weiter bearbeiten",
  "cp.customer.dashboardGreeting": "Willkommen zurück",
  "cp.customer.dashboardDescription":
    "Bearbeiten Sie zuerst geschäftliche Fristen und prüfen Sie danach die Kontoleistung.",
  "cp.customer.attentionTitle": "Handlungsbedarf",
  "cp.customer.attentionDescriptionOne":
    "{count} Eintrag erfordert eine Entscheidung oder Nachverfolgung.",
  "cp.customer.attentionDescriptionOther":
    "{count} Einträge erfordern eine Entscheidung oder Nachverfolgung.",
  "cp.customer.attentionDescriptionNone":
    "Keine Einträge erfordern eine Entscheidung oder Nachverfolgung.",
  "cp.customer.termTitle": "Aktuelle Vertragslaufzeit",
  "cp.customer.serviceRollup": "Übersicht der Servicelaufzeiten",
  "cp.customer.metricsTitle": "Entscheidungen im Überblick",
  "cp.customer.activityTitle": "Letzte Aktivitäten",
  "cp.customer.accountTitle": "Kontoeinstellungen",
  "cp.customer.accountDescription":
    "Verwalten Sie Ihre Organisation, Personen und Einkaufsanforderungen.",
  "cp.customer.quotePermissionNote":
    "Ein Kontoinhaber oder Administrator kann Angebote erstellen.",
  "cp.customer.accountPermissionNote":
    "Ein Kontoinhaber oder Administrator verwaltet Benutzer, Beschaffung und Offboarding-Anfragen.",
  "cp.customer.collections.amendments.description":
    "Verfolgen Sie angeforderte und abgeschlossene Änderungen an aktiven Diensten.",
  "cp.customer.collections.amendments.searchPlaceholder": "Änderungen suchen",
  "cp.customer.collections.users.description":
    "Sehen Sie, wer geschäftliche Vorgänge einsehen und genehmigen kann.",
  "cp.customer.collections.users.searchPlaceholder": "Benutzer suchen",
  "cp.customer.collections.procurement.description":
    "Halten Sie Rechnungsweiterleitung, Lieferantenaufnahme und Steuernachweise aktuell.",
  "cp.customer.collections.procurement.searchPlaceholder":
    "Beschaffungsdatensätze suchen",
  "cp.customer.collections.marketplace.title": "Marketplace-Käufe",
  "cp.customer.collections.marketplace.description":
    "Verfolgen Sie private Angebote und die vom Anbieter gemeldete Erfüllung.",
  "cp.customer.collections.marketplace.searchPlaceholder":
    "Marketplace-Angebote suchen",
  "cp.customer.collections.support.description":
    "Verfolgen Sie Kundenprobleme; der Supportanbieter bleibt die maßgebliche Informationsquelle.",
  "cp.customer.collections.support.searchPlaceholder": "Supporttickets suchen",
  "cp.commercial.quoteStages.0": "Angebot und Region",
  "cp.commercial.quoteStages.1":
    "Kapazität, Laufzeit, Direktvertrieb und Ablauf",
  "cp.commercial.quoteStages.2": "Prüfen und ausstellen",
  "cp.commercial.quoteSummary": "Angebotsübersicht",
  "cp.commercial.reviewIssue": "Prüfen und ausstellen",
  "cp.commercial.agreementAuthority":
    "Ich bestätige, dass ich berechtigt bin, diese juristische Person an diese Vereinbarung zu binden.",
  "cp.commercial.agreementReview": "Vereinbarung prüfen und annehmen",
  "cp.commercial.orderReview": "Resultierende Verpflichtung prüfen",
  "cp.commercial.orderConfirmation":
    "Ich habe das angenommene Angebot, die maßgebliche Vereinbarung, die Bestellung, den Servicebeginn, das Serviceende und die resultierende Verpflichtung geprüft.",
  "cp.commercial.orderTermsHelp":
    "Die Auftragsbedingungen stammen aus dem angenommenen Angebot {quoteReference}, Version {quoteVersion}, und {agreementTitle}, Version {agreementVersion}. Eine Bestellreferenz ersetzt oder ändert diese festgelegten Bedingungen nicht.",
  "cp.commercial.orderArtifactRetention":
    "Das erzeugte Auftragsformular und der Annahmenachweis werden ab dem erfassten Annahmezeitpunkt für {years} Jahre aufbewahrt.",
  "cp.commercial.estimatedSpend": "Geschätzte Ausgaben",
  "cp.commercial.invoiceTruth": "Rechnungsbetrag",
  "cp.commercial.paymentTruth": "Zahlungsstatus",
  "cp.commercial.paymentWebhook": "Vom Webhook des Zahlungsanbieters gemeldet",
  "cp.commercial.externalPayment":
    "Sie fahren beim Zahlungsanbieter fort. Die Rechnung wird erst nach dessen Bestätigung als bezahlt markiert.",
  "cp.commercial.confirmMutation": "Prüfen und bestätigen",
  "cp.partner.deskDescription":
    "Behalten Sie Vertragsfristen im Blick und erledigen Sie dringende Kundenaufgaben, bevor Sie die Leistung prüfen.",
  "cp.partner.agreementClock": "Fristen der Partnervereinbarung",
  "cp.partner.urgentTitle": "Dringende Partneraufgaben",
  "cp.partner.transferPrice": "Fil One Verrechnungspreis",
  "cp.partner.partnerPrice": "Wiederverkaufspreis des Partners",
  "cp.partner.merchantOfRecord": "Verantwortlicher Verkäufer",
  "cp.partner.boundary":
    "Der Verrechnungspreis bleibt dem Partner vorbehalten. Der Endkunde sieht den vom Partner festgelegten Wiederverkaufspreis.",
  "cp.partner.renewalReview": "Verlängerung vor Bestätigung prüfen",
  "cp.partner.registrationReview": "Deal-Registrierung prüfen",
  "app.pageLoaded": "{page}. Seite geladen.",

  "operations.stale":
    "Aktualisierung für {channels} nötig. Öffnen Sie den Bereich vor einer Entscheidung.",
  "operations.cases.one": "{count} Fall",
  "operations.cases.other": "{count} Fälle",
  "operations.priority.one":
    "{count} Fall erfordert vorrangige Aufmerksamkeit.",
  "operations.priority.other":
    "{count} Fälle erfordern vorrangige Aufmerksamkeit.",
  "operations.records.one": "{count} Datensatz",
  "operations.records.other": "{count} Datensätze",
  "operations.providerSummary":
    "Anbietervorgänge: {operations}. Dienstbeendigungen: {terminations}.",
  "operations.invoiceSummary":
    "Überfällige Rechnungen: {overdue}. Offene Rechnungen: {open}.",
  "operations.orders.one": "{count} Auftrag",
  "operations.orders.other": "{count} Aufträge",
  "operations.exports.one": "{count} Export",
  "operations.exports.other": "{count} Exporte",
  "approval.reviewApprove": "Freigabe prüfen",
  "approval.reviewReject": "Ablehnung prüfen",

  "ui.0": "Betriebszustand",
  "ui.1":
    "Aufgaben mit Handlungsbedarf bei Freigaben, Forderungen, Bereitstellung, Verlängerungen und Berichten.",
  "ui.2": "Arbeitsübersicht",
  "ui.3":
    "Priorisierte Aufgaben Ihrer Teams mit direktem Zugang zu jedem Arbeitsbereich.",
  "ui.4": "Operative Arbeitsübersicht",
  "ui.5": "Meine Warteschlange öffnen",
  "ui.6": "Indikator",
  "ui.7": "Zusammenfassung",
  "ui.8": "Bereich",
  "ui.9": "Aktualisiert",
  "ui.10": "Aktion",
  "ui.11": "Freigaben",
  "ui.12": "Bereitstellung",
  "ui.13": "Forderungsmanagement",
  "ui.14": "Verlängerungen",
  "ui.15": "Berichte",
  "ui.16": "veraltet",
  "ui.17": "Wartende Aufgaben",
  "ui.18": "Warteschlange öffnen",
  "ui.19": "Bereitstellung öffnen",
  "ui.20": "Kein Betrag erfasst",
  "ui.21": "Forderungsmanagement öffnen",
  "ui.22": "Verlängerungsmitteilung",
  "ui.23":
    "Aufträge, deren vertraglicher Mitteilungstermin verstrichen ist oder in den nächsten 30 Tagen liegt.",
  "ui.24": "Verlängerungen öffnen",
  "ui.25": "Berichtsexporte",
  "ui.26": "Für Ihre Bedienersitzung erfasste Exporte.",
  "ui.27": "Berichte öffnen",
  "ui.28": "Interner Betrieb",
  "ui.29": "Datenstatus",
  "ui.30": "Aktuell",
  "ui.31": "Aktualisierung erforderlich",
  "ui.32": "Vorübergehend nicht verfügbar",
  "ui.33": "In diesem Arbeitsbereich nicht verfügbar",
  "ui.34":
    "Mindestens ein Datensatz hat sein Aktualisierungsintervall überschritten.",
  "ui.35":
    "Prüfen Sie vor einer Entscheidung alle betroffenen Daten am Ursprungsdatensatz.",
  "ui.36": "Verlängerungs-Mitteilungsfristen",
  "ui.37":
    "Aufträge nach Zeit bis zum vertraglichen Mitteilungstermin, mit erfasstem Vertriebsweg und Abrechnung.",
  "ui.38": "Zum Verlängerungswert",
  "ui.39":
    "Bisher abgerechnet zeigt den Rechnungswert je Auftrag. Prognosewerte sind von dieser Verlängerungsliste getrennt.",
  "ui.40": "Bisher abgerechnet",
  "ui.41": "Keine Rechnungen für diesen Auftrag erfasst",
  "ui.42": "Vertriebsweg nicht erfasst",
  "ui.43": "Keine Aufträge in diesem Zeitfenster.",
  "ui.44": "Forderungspriorität",
  "ui.45":
    "Offene Rechnungen nach Risiko und Alter, mit Korrekturen, die Finanzfreigebende beantragen können.",
  "ui.46": "Prioritätsreihenfolge",
  "ui.47":
    "Höchster offener Betrag, dann Verzugstage, dann Rechnungsreferenz. Andere Währungen werden geordnet, aber nie addiert.",
  "ui.48": "Forderungsaktionen",
  "ui.49":
    "Öffnen Sie jede Rechnung für Zahlungshistorie, Streitfälle und Korrekturen.",
  "ui.50": "Summe offener Rechnungen",
  "ui.51": "Überfällig",
  "ui.52": "Längster Verzug",
  "ui.53": "Nicht erfasst",
  "ui.54": "Offene Rechnungen",
  "ui.55": "Betrag, Alter, Status und verfügbare Korrekturen je Rechnung.",
  "ui.56": "Offene Rechnungen nach Betrag und Verzugstagen",
  "ui.57": "Keine offenen Rechnungen erfordern Forderungsmaßnahmen.",
  "ui.58": "Bereitstellungsaufgaben",
  "ui.59":
    "Anbieteraufgaben, Dienstbeendigungen, Wiederholungen und Aufgaben mit Handlungsbedarf verfolgen.",
  "ui.60": "Gestoppte Aufgaben werden in Wiederherstellung bearbeitet.",
  "ui.61":
    "Öffnen Sie Wiederherstellung, um Aufgaben nach ausgeschöpften automatischen Versuchen erneut zu versuchen oder aufzugeben.",
  "ui.62": "Wiederherstellungswarteschlange öffnen",
  "ui.63": "Anbietervorgänge",
  "ui.64": "Dienstbeendigungen",
  "ui.65": "Hohes Risiko",
  "ui.66": "Bereitstellungsdatensätze",
  "ui.67": "Bereitstellungsdatensätze nach Risiko und verbrauchten Versuchen",
  "ui.68": "Keine Bereitstellungsaufgaben erfordern hier Aufmerksamkeit.",
  "ui.69": "Versuche",
  "ui.70": "Nicht zutreffend",
  "ui.71": "Betriebsberichte",
  "ui.72":
    "Für Ihre Sitzung erfasste Berichtsexporte und aktuell verfügbare Exporte.",
  "ui.73": "Erfasste Berichtsexporte",
  "ui.74": "Berichtsexporte, neueste zuerst",
  "ui.75":
    "Keine Berichtsexporte in Ihrem Bedienerbereich. Ein unten erzeugter Export wird erfasst.",
  "ui.76": "Alle unterstützten Berichte",
  "ui.77": "Dokument erfasst",
  "ui.78": "Noch kein Dokument erfasst",
  "ui.79": "Unterstützte Exporte",
  "ui.80":
    "Berichtsregister des Commerce-API-Vertrags. Jeder Bericht wird auf Anfrage erstellt; diese Seite speichert keine Ergebnisse und behauptet keine Aktualität.",
  "ui.81": "ARR und MRR",
  "ui.82": "Abrechnung und Forderungsmanagement",
  "ui.83": "Provisionsabrechnung",
  "ui.84": "Exporte werden bei Bedarf erstellt",
  "ui.85":
    "Wählen Sie Bericht und Kontobereich. Abgeschlossene Exporte bleiben im Verlauf verfügbar.",
  "ui.86": "Suchen",
  "ui.87": "Filter",
  "ui.88": "Status",
  "ui.89": "Risiko",
  "ui.90": "Verantwortlich",
  "ui.91": "Sortieren",
  "ui.92": "Ansicht",
  "ui.93": "Zeilen pro Seite",
  "ui.94": "Zurück",
  "ui.95": "Weiter",
  "ui.96": "Technische Details",
  "ui.97": "Dokumente",
  "ui.98": "Audit-Nachweise",
  "ui.99": "Dokumentenkette",
  "ui.100": "Geschäftsübersicht",
  "ui.101": "Laufzeitstatus",
  "ui.102": "Nächste Aktion",
  "ui.103": "Kundenbereich",
  "ui.104": "Organisation",
  "ui.105": "Benutzer und Zugriff",
  "ui.106":
    "Rollen, Freigabebefugnisse, MFA-Status und offene Einladungen prüfen.",
  "ui.107": "Beschaffung",
  "ui.108":
    "Rechnungszustellung, Lieferantenaufnahme, Bestellungen und Steuernachweise verwalten.",
  "ui.109": "Austritt",
  "ui.110":
    "Datenabruf, Schlussabrechnung, Aufbewahrungsausnahmen und Rückbaubefugnis prüfen.",
  "ui.111": "Speichern",
  "ui.112": "Abbrechen",
  "ui.113": "Alle",
  "ui.114": "Keine",
  "ui.115": "Begründung",
  "ui.116": "Nachweise",
  "ui.117": "Referenz",
  "ui.118": "Konto",
  "ui.119": "Betrag",
  "ui.120": "Währung",
  "ui.121": "Datum",
  "ui.122": "Version",
  "ui.123": "Details",
  "ui.124": "Aktualisieren",
  "ui.125": "Erneut versuchen",
  "ui.126": "Schließen",
  "ui.127": "Wird geladen…",
  "ui.128": "Keine Ergebnisse",
  "settings.title": "Einstellungen",
  "settings.description": "Passen Sie Ihren Arbeitsbereich an.",
  "settings.language": "Sprache",
  "settings.language.description":
    "Wählen Sie die Sprache der Benutzeroberfläche. Ihre Auswahl wird für künftige Besuche in diesem Browser gespeichert.",
  "settings.language.label": "Sprache der Benutzeroberfläche",
  "settings.save": "Sprache speichern",
  "settings.saving": "Wird gespeichert…",
  "settings.saved": "Sprache gespeichert.",
  "settings.error":
    "Wählen Sie eine unterstützte Sprache und versuchen Sie es erneut.",
  "settings.language.records":
    "Namen, eingegebene Daten und ursprüngliche Vertragsdokumente behalten ihre Originalsprache.",
  "app.name": "Fil One",
  "app.product": "Commerce",
  "app.demo": "Demo-Umgebung",
  "app.demo.short": "Demo",
  "app.demo.reset.success": "Demo-Daten wiederhergestellt.",
  "app.demo.reset.confirm.title": "Demo-Umgebung zurücksetzen?",
  "app.demo.reset.confirm.description":
    "Alle Demo-Arbeitsbereiche werden auf ihren Ausgangszustand zurückgesetzt und die Seite wird neu geladen.",
  "app.demo.reset.confirm.detail":
    "Ihre Demo-Änderungen und nicht gespeicherten Arbeiten auf dieser Seite werden entfernt.",
  "app.demo.reset.confirm.action": "Demo zurücksetzen",
  "app.demo.reset.confirm.cancel": "Aktuellen Zustand beibehalten",
  "demo.access.eyebrow": "Demo-Zugang",
  "demo.access.title": "Demo-Passwort eingeben",
  "demo.access.description":
    "Geben Sie das erhaltene Passwort ein, um Fil One Commerce zu erkunden.",
  "demo.access.password": "Passwort",
  "demo.access.submit": "Weiter",
  "demo.access.invalid":
    "Das Passwort stimmt nicht überein. Versuchen Sie es erneut.",
  "demo.landing.eyebrow": "Geführte Demo",
  "demo.landing.title": "Wählen Sie Ihr Anmeldeprofil",
  "demo.landing.description":
    "Jedes Profil öffnet Fil One Commerce im zugehörigen Arbeitsbereich. Sie können jederzeit im Demo-Bereich wechseln.",
  "demo.landing.start": "Als {name} starten",
  "demo.landing.internal": "Fil One-Mitarbeitende",
  "demo.landing.external": "Kunden und Partner",
  "demo.panel.title": "Demo-Steuerung",
  "demo.panel.open": "Demo-Steuerung öffnen",
  "demo.panel.close": "Demo-Steuerung schließen",
  "demo.panel.persona": "Angemeldet als",
  "demo.panel.journey": "Rundgang",
  "demo.panel.reset": "Demo-Daten wiederherstellen",
  "demo.panel.resetting": "Wird zurückgesetzt…",
  "demo.panel.reset.failed":
    "Die Demo-Daten konnten nicht zurückgesetzt werden.",
  "demo.panel.browse": "Alle Profile",
  "app.verifyAuthentication": "Identität für sensible Änderungen bestätigen",
  "app.signOut": "Abmelden",
  "app.skip": "Zum Hauptinhalt springen",
  "app.nav.primary": "Hauptnavigation",
  "app.nav.secondary": "Konto und Hilfe",
  "app.nav.open": "Navigation öffnen",
  "app.nav.title": "Navigation",
  "app.nav.description": "Alle Bereiche durchsuchen.",
  "app.nav.close": "Navigation schließen",
  "app.search": "Suchen",
  "app.search.hint": "Konten, Aufträge, Rechnungen oder Dokumente",
  "app.command": "Befehlsmenü öffnen",
  "app.command.title": "Suche und Befehle",
  "app.command.description":
    "Finden Sie einen Bereich, starten Sie häufige Aufgaben oder öffnen Sie einen aktuellen Datensatz.",
  "app.command.searchLabel": "Navigation, Aktionen und Datensätze durchsuchen",
  "app.command.noResults":
    "Keine Ergebnisse. Versuchen Sie eine ID, ein Konto oder eine Aktion.",
  "app.command.group.navigation": "Navigation",
  "app.command.group.actions": "Aktionen",
  "app.command.group.records": "Datensätze",
  "app.command.action.customerQuote":
    "Kapazität, Laufzeit und Geschäftsbedingungen konfigurieren.",
  "app.command.action.inviteUser":
    "Zugriff auf die aktuelle Organisation verwalten.",
  "app.command.action.registerDeal": "Eine neue Partnerchance schützen.",
  "app.command.action.partnerQuote": "Preise für einen Endkunden erstellen.",
  "app.command.action.globalSearch":
    "Konten und operative Datensätze durchsuchen.",
  "app.command.action.reviewApprovals":
    "Freigaben und Ausnahme-Warteschlange öffnen.",
  "app.command.shortcut": "Befehl K",
  "app.help": "Hilfe",
  "app.help.description": "Anleitungen, Support und Dienststatus",
  "app.help.internal": "Externe Voraussetzungen und Betriebshinweise",
  "app.help.internal.description":
    "Aktivierungsvoraussetzungen, Verantwortliche und Betriebshinweise prüfen",
  "app.account.switch": "Organisation wechseln",
  "app.account.switched": "Zu {account} gewechselt.",
  "app.account.choose.title": "Organisation auswählen",
  "app.account.choose.description":
    "Wählen Sie eine aktive Organisation, die für Ihre angemeldete WorkOS-Identität autorisiert ist.",
  "app.account.choose.empty.title": "Keine autorisierten Organisationen",
  "app.account.choose.empty.description":
    "Diese Identität hat keine aktive Commerce-Mitgliedschaft. Ein Administrator kann Zugriff gewähren, oder Sie melden sich mit einer anderen Identität an.",
  "app.profile": "Profilmenü öffnen",
  "app.requestId": "Anfrage {id}",
  "app.footer":
    "Die Commerce-Datensätze von Fil One werden mit dem Betriebsregister synchronisiert.",
  "app.offline":
    "Sie sind offline. Gespeicherte Informationen bleiben verfügbar; Änderungen warten auf eine Verbindung.",
  "app.online":
    "Verbindung wiederhergestellt. Ausstehende Änderungen können jetzt gesendet werden.",
  "session.expired.title": "Ihre Sitzung wurde sicher beendet",
  "session.expired.description":
    "Melden Sie sich erneut an. Entwürfe bleiben auf diesem Gerät gespeichert.",
  "session.expired.action": "Erneut anmelden",
  "session.mfa.title": "Eine weitere Bestätigung",
  "session.mfa.description":
    "Ihre Rolle erfordert eine Mehrfaktor-Authentifizierung vor kommerziellen Aktionen.",
  "session.mfa.action": "Identität bestätigen",
  "session.permission.title":
    "Diese Ansicht ist für Ihre Rolle nicht verfügbar",
  "session.permission.description":
    "Wechseln Sie die Organisation oder bitten Sie einen Eigentümer, Ihre Commerce-Rolle anzupassen.",
  "session.permission.action": "Zum Dashboard",
  "nav.dashboard": "Übersicht",
  "nav.buy": "Kaufen",
  "nav.payg": "Nutzungsabhängige Zahlung und Tests",
  "nav.agreements": "Vereinbarungen",
  "nav.quotes": "Angebote",
  "nav.orders": "Aufträge",
  "nav.services": "Aktive Dienste",
  "nav.pocs": "Machbarkeitsnachweise",
  "nav.billing": "Abrechnung",
  "nav.amendments": "Vertragsänderungen",
  "nav.marketplace": "Marketplace",
  "nav.support": "Support",
  "nav.account": "Konto",
  "nav.partner.home": "Partnerbereich",
  "nav.partner.portfolio": "Endkunden",
  "nav.partner.registrations": "Chancenregistrierung",
  "nav.partner.quotes": "Partnerangebote",
  "nav.partner.billing": "Konsolidierte Abrechnung",
  "nav.partner.commissions": "Provisionen",
  "nav.partner.renewals": "Verlängerungen",
  "nav.partner.disputes": "Streitfälle",
  "nav.partner.marketplace": "Marketplace",
  "nav.partner.sandboxes": "Testumgebungen und POCs",
  "nav.partner.brand": "Marke und Domains",
  "nav.partner.enablement": "Partnerressourcen",
  "nav.partner.support": "Support",
  "nav.internal.home": "Betrieb",
  "nav.internal.search": "Globale Suche",
  "nav.internal.queues": "Warteschlangen und Freigaben",
  "nav.internal.renewals": "Verlängerungsverwaltung",
  "nav.internal.collections": "Forderungsmanagement",
  "nav.internal.provisioning": "Bereitstellung",
  "nav.internal.recovery": "Wiederherstellung",
  "nav.internal.webhookReplay": "Webhook-Wiederholung",
  "nav.internal.migrations": "Migrationen",
  "nav.internal.reports": "Berichte",
  "nav.internal.revenue": "Umsatz und Vertriebskanal",
  "nav.internal.billingReconciliation": "Abrechnungsabgleich",
  "nav.internal.status": "Integrationsstatus",
  "nav.internal.unhandledErrors": "Unbehandelte Fehler",
  "nav.internal.agreements": "Vereinbarungsversionen",
  "nav.internal.approvals": "Freigabeprüfung",
  "nav.internal.priceBooks": "Preislisten",
  "nav.internal.paygRequests": "Dienstanfragen",
  "nav.internal.paygOffers": "Nutzungsabhängige Zahlung und Tests",
  "nav.internal.capabilities": "Freigeschaltete Funktionen",
  "nav.internal.providers": "Anbieterreferenzen",
  "nav.internal.catalog": "Katalogzuordnungen",
  "nav.internal.channelPolicy": "Vertriebskanalrichtlinie",
  "nav.internal.gates": "Externe Voraussetzungen",
  "nav.internal.assisted": "Assistierter Modus",
  "nav.group.pricing": "Preisgestaltung",
  "nav.group.legal": "Rechtsakte",
  "nav.group.service": "Dienst",
  "nav.group.organization": "Organisation",
  "nav.group.partner.dealFlow": "Geschäftschancen",
  "nav.group.partner.revenue": "Umsatz",
  "nav.group.partner.channel": "Vertriebskanal",
  "nav.group.internal.queues": "Ausnahme-Warteschlangen",
  "nav.group.internal.providerRecovery": "Anbieterwiederherstellung",
  "nav.group.internal.administration": "Verwaltung",
  "action.view": "Details anzeigen",
  "action.review": "Prüfen",
  "action.retry": "Erneut versuchen",
  "action.returnHome": "Zu Ihrem Dashboard",
  "action.cancel": "Abbrechen",
  "action.download": "PDF herunterladen",
  "action.createQuote": "Angebot erstellen",
  "action.invite": "Benutzer einladen",
  "action.open": "Datensatz öffnen",
  "action.register": "Chance registrieren",
  "common.status": "Status",
  "common.updated": "Zuletzt aktualisiert",
  "common.term": "Laufzeit",
  "status.active": "Aktiv",
  "status.inNotice": "In der Kündigungsfrist",
  "status.awaiting": "Aktion ausstehend",
  "status.review": "Prüfung erforderlich",
  "status.paid": "Bezahlt",
  "status.ready": "Bereit",
  "status.pending": "Ausstehend",
  "status.provisioning": "In Bereitstellung",
  "status.blocked": "Blockiert",
  "status.complete": "Abgeschlossen",
  "status.draft": "Entwurf",
  "status.signed": "Unterzeichnet",
  "dashboard.eyebrow": "Kontostatus",
  "dashboard.description":
    "Geschäftsaktivität, Dienststatus und nächste Vertragsdaten für Northstar Archive Labs.",
  "dashboard.chain": "Letzte Aktivität",
  "dashboard.activeServices": "Aktive Dienste",
  "dashboard.empty.obligations":
    "Derzeit ist keine Entscheidung nötig. Anstehende Geschäftsfristen erscheinen hier.",
  "dashboard.empty.services":
    "Noch kein Dienst aktiv. Angenommene Aufträge erscheinen hier, sobald die Bereitstellung beginnt.",
  "dashboard.empty.activity":
    "In diesem Zeitraum wurde keine Kontoaktivität erfasst.",
  "dashboard.empty.capacity":
    "Vertragliche Kapazität, aktuelle Nutzung und die letzten 30 Tage erscheinen, sobald Messdaten für dieses Konto vorliegen.",
  "dashboard.openQuotes": "Offene Angebote",
  "dashboard.invoiceDue": "Fällige Rechnung",
  "dashboard.daysToNotice": "Tage bis zur Kündigungsfrist",
  "agreements.eyebrow": "Rechtsakte",
  "agreements.title": "Vereinbarungen",
  "agreements.description":
    "Vereinbarte Bedingungen, Signaturnachweise, maßgebliche Versionen und Verlängerungsfristen in einer Akte.",
  "agreements.execute": "Vereinbarung abschließen",
  "agreements.execute.binding":
    "Bestätigen Sie Titel, Version, genau genehmigte Bedingungen und Ihre Befugnis, {account} zu binden.",
  "agreements.execute.source": "Abschluss gemäß Vereinbarung {reference}",
  "agreements.execute.validation.authority":
    "Geben Sie die Funktion mit Zeichnungsbefugnis für diese Rechtsperson an.",
  "agreements.execute.validation.attestation":
    "Bestätigen Sie vor Abschluss Ihre Befugnis, diese Rechtsperson zu binden.",
  "agreements.execute.accepted":
    "Vereinbarung abgeschlossen. Ihr Befugnisnachweis ist dokumentiert.",
  "agreements.execute.acceptedLink": "Abgeschlossene Vereinbarung öffnen",
  "quotes.eyebrow": "Verlässliche Preise",
  "quotes.title": "Angebote",
  "quotes.description":
    "Unveränderliche ausgegebene Versionen bleiben mit Preisliste, Vereinbarung und Auftrag verknüpft.",
  "quotes.builder.title": "Angebot erstellen",
  "quotes.builder.description":
    "Konfigurieren Sie den Dienst; Preise und Freigaben stammen weiterhin aus der Commerce-API.",
  "quotes.builder.account.description": "Für diese Sitzung autorisiertes Konto",
  "quotes.builder.origin.revision": "Überarbeitet Angebot {reference}",
  "quotes.builder.origin.poc": "Wandelt Machbarkeitsnachweis {reference} um",
  "quotes.builder.origin.unavailable":
    "Der referenzierte Datensatz liegt außerhalb dieses Kontos. Der Entwurf beginnt ohne Ausgangsdaten.",
  "quotes.builder.created":
    "Bepreister Entwurf erstellt. Die Ausgabe ist möglich, sobald das Dokument vorbereitet und verknüpft ist.",
  "quotes.builder.createdLink": "Erstellten Entwurf öffnen",
  "orders.eyebrow": "Von der Zusage zum Dienst",
  "orders.title": "Aufträge und Dienste",
  "orders.description":
    "Bestellungen, Bereitstellung, Berechtigungen, Nutzung, Änderungen und Laufzeiten ohne erneute Eingabe.",
  "orders.amendment": "Vertragsänderung anfordern",
  "orders.accept.source":
    "Angenommenes Angebot {reference} · Version {version}",
  "orders.accept.agreement.unknown":
    "Für dieses Konto ist keine aktive maßgebliche Vereinbarung erfasst.",
  "orders.accept.unavailable.title": "Kein annehmbares Angebot ausgewählt",
  "orders.accept.unavailable.description":
    "Die Auftragsannahme beginnt mit einem angenommenen Angebot dieses Kontos. Wählen Sie es im Angebotsregister aus.",
  "orders.accept.unavailable.action": "Angebotsregister öffnen",
  "orders.accept.validation.po": "Geben Sie die Bestellreferenz ein.",
  "orders.accept.validation.serviceStart": "Wählen Sie den Dienstbeginn.",
  "orders.accept.validation.authority":
    "Geben Sie die Funktion mit Annahmebefugnis an.",
  "orders.accept.validation.confirmation":
    "Bestätigen Sie die geprüfte Verpflichtung vor der Annahme.",
  "orders.accept.created":
    "Auftrag erstellt. Verpflichtung und Bereitstellungsstatus sind nun maßgeblich erfasst.",
  "orders.accept.createdLink": "Erstellten Auftrag öffnen",
  "orders.accept.prepared":
    "Auftragsformular angefordert. Die Verpflichtung entsteht, sobald das Dokument erstellt und mit dem Angebot verknüpft ist.",
  "orders.accept.preparedLink": "Annahme unter Aufträge verfolgen",
  "orders.accept.failed":
    "Der Auftrag konnte nicht angenommen werden. Nichts wurde geändert.",
  "pocs.eyebrow": "Sicher erproben",
  "pocs.title": "Machbarkeitsnachweise",
  "pocs.description":
    "Isolierte Umgebungen mit Grenzen, Meilensteinen, Erfolgskriterien, Kosten und datenerhaltendem Übergang.",
  "billing.eyebrow": "Klare, nachvollziehbare Abrechnung",
  "billing.title": "Abrechnung und Zahlungen",
  "billing.description":
    "Rechnungen verweisen auf Auftrag und Bestellung sowie Belege, Gutschriften, Alter, Steuern und Zahlungswege.",
  "billing.aging": "Altersstruktur der Forderungen",
  "account.eyebrow": "Organisationsverwaltung",
  "account.title": "Konto, Benutzer und Beschaffung",
  "account.description":
    "Rechtsidentität, Freigaberollen, Kreditorenrouting, Lieferantenaufnahme, Steuernachweise und sicherer Austritt.",
  "account.users": "Benutzer und Rollen",
  "account.procurement": "Beschaffungsprofil",
  "account.offboarding": "Austritt und Bescheinigungen",
  "account.owner": "Kontoinhaber",
  "account.billingContact": "Abrechnungskontakt",
  "account.people": "Zugriffsberechtigte",
  "account.invitations": "Ausstehende Einladungen",
  "account.unassigned": "Nicht erfasst",
  "account.areas.users.meta.one": "{count} Person mit Zugriff",
  "account.areas.users.meta.other": "{count} Personen mit Zugriff",
  "account.areas.procurement.meta.one": "{count} Anforderung erfasst",
  "account.areas.procurement.meta.other": "{count} Anforderungen erfasst",
  "account.areas.offboarding.meta": "Bestätigung für jede Anfrage erforderlich",
  "account.offboarding.service": "Dienst",
  "account.offboarding.empty.title": "Kein Dienst für den Austritt verfügbar",
  "account.offboarding.empty.description":
    "Der Austritt beginnt bei einem aktiven Auftrag dieses Kontos. Aktive Verpflichtungen stehen unter Aufträge und Dienste.",
  "account.offboarding.empty.action": "Aufträge und Dienste öffnen",
  "account.offboarding.validation.effectiveAt":
    "Wählen Sie Datum und Uhrzeit des gewünschten Wirksamwerdens.",
  "account.offboarding.validation.confirmation":
    "Bestätigen Sie vor dem Senden die geprüften Aufbewahrungs- und Freigabesicherungen.",
  "account.offboarding.requested":
    "Austrittsanfrage zur Freigabe gesendet. Ihr Dienst läuft weiter.",
  "account.offboarding.requestedLink": "Betroffenen Dienstdatensatz öffnen",
  "account.offboarding.failed":
    "Die Austrittsanfrage konnte nicht gesendet werden.",
  "partner.eyebrow": "Vereinbarungsfristen zuerst",
  "partner.title": "Partnerbereich",
  "partner.description":
    "Ihre maßgebliche Vereinbarung hat Vorrang; aktive Endkundendienste laufen unter fortgeltenden Bedingungen weiter.",
  "partner.portfolio.title": "Endkundenportfolio",
  "partner.portfolio.description":
    "Nutzung, Bereitstellung, Laufzeitrisiken und nächste Aktionen für alle zugeordneten Endkunden.",
  "partner.registration.title": "Chancenregistrierung und Streitfälle",
  "partner.registration.description":
    "Schutzfristen, Entscheidungsfristen, konkurrierende Ansprüche und dokumentierte Stichentscheide je Vertriebskanal.",
  "partner.quotes.title": "Partner- und Wiederverkaufsangebote",
  "partner.quotes.description":
    "Transferpreise bleiben vertraulich; Wiederverkaufsdokumente für Kunden zeigen nur Ihren festgelegten Preis.",
  "partner.billing.title": "Konsolidierte Abrechnung",
  "partner.billing.description":
    "Eine Rechnung an den Partner, nach Endkunden gruppiert, mit Gesamtrisiko und ohne Geschäftskontakt zum Endkunden.",
  "partner.commissions.title": "Provisionen und Abrechnungen",
  "partner.commissions.description":
    "Empfehlungsprovisionen entstehen auf netto vereinnahmte Umsätze; Abrechnungen berücksichtigen Erstattungen, Gutschriften und Rückbelastungen.",
  "partner.renewals.title": "Partnerverlängerungen",
  "partner.renewals.description":
    "Handeln Sie je Endkunde vor Fristablauf; Fil One bestätigt ohne kommerzielle Kontaktaufnahme zu Wiederverkaufskunden.",
  "partner.sandboxes.title": "Partner-Testumgebungen",
  "partner.sandboxes.description":
    "Kostenlose, begrenzte und befristete Umgebungen nutzen denselben Berechtigungsprozess.",
  "partner.brand.title": "Marke und eigene Domains",
  "partner.brand.description":
    "Bereiten Sie austauschbare Marken, genehmigte Farben, Angebotsidentität und Domainprüfung vor, ohne Rechtsakten zu ändern.",
  "partner.marketplace.title": "Marketplace-Status",
  "partner.marketplace.description":
    "Angebots-, Käufer-, Erfüllungs- und Auszahlungsstatus aus AWS, Azure und Google Cloud Marketplace, nur lesbar.",
  "partner.access.title":
    "Keine Partnermitgliedschaft für die gewählte Organisation",
  "partner.access.description":
    "Dieser Bereich gehört zu einer Organisation, die Sie vertreten dürfen. Wechseln Sie die Organisation oder bitten Sie einen Partneradministrator um Mitgliedschaft.",
  "partner.access.action": "Organisation wechseln",
  "partner.detail.notFound.title":
    "Dieser Partnerdatensatz ist nicht verfügbar",
  "partner.detail.notFound.description":
    "Die Referenz ist unbekannt oder liegt außerhalb Ihrer autorisierten Konten.",
  "partner.detail.notFound.action": "Zurück zur Liste",
  "partner.detail.notRecorded": "Nicht erfasst",
  "partner.detail.reference": "Referenz",
  "partner.detail.position": "Geschäftliche Position",
  "partner.detail.milestone": "Nächster Meilenstein",
  "partner.detail.owner": "Verantwortlich",
  "partner.detail.risk": "Geschäftsrisiko",
  "partner.detail.portfolio.eyebrow": "Geschäftsakte des Endkunden",
  "partner.detail.portfolio.term": "Dienst und Geschäftslaufzeit",
  "partner.detail.term.unavailable.title":
    "Keine Dienstlaufzeit für diesen Endkunden erfasst",
  "partner.detail.term.unavailable.description":
    "Abgelaufene Laufzeit, Kündigungsfrist und Enddatum erscheinen, sobald ein Auftrag oder eine Vereinbarung sie veröffentlicht.",
  "partner.detail.transfer.description":
    "Vertrauliche Fil One-Kosten für diesen Vertriebsweg, aus der genehmigten Preisliste; niemals für den Endkunden sichtbar.",
  "partner.detail.resale.description":
    "Der vom Partner festgelegte und dem benannten Endkunden angebotene Preis.",
  "partner.detail.merchant.description":
    "Die Partei, die in diesem Kanal mit dem Endkunden Verträge schließt und abrechnet.",
  "partner.detail.quote.eyebrow": "Partner-Wiederverkaufsangebot",
  "partner.detail.quote.boundary": "Preisabgrenzung des Angebots",
  "partner.detail.quote.actions": "Zulässige Aktionen für dieses Angebot",
  "partner.detail.quote.edit": "Entwurf bearbeiten",
  "partner.detail.quote.revise": "Revision erstellen",
  "partner.detail.quote.issue.title": "Ausgabe unterliegt Voraussetzungen",
  "partner.detail.quote.issue.description":
    "Das Channel-Team muss vor der Ausstellung getrennte Kunden- und Partnerdokumente vorbereiten. Wenden Sie sich an den Partnersupport, um fortzufahren.",
  "partner.detail.quote.cancel.title": "Stornierung hier nicht verfügbar",
  "partner.detail.quote.cancel.description":
    "Partnerangebote werden durch den Kanalbetrieb storniert. Wenden Sie sich zur Stornierung an dieses Team.",
  "partner.detail.quote.download.title": "Download vom Anbieter abhängig",
  "partner.detail.quote.download.description":
    "Der unveränderliche Dokumentlink erscheint, sobald der Dokumentdienst ein aufbewahrtes partnerseitig sichtbares Dokument liefert.",
  "partner.detail.projection.record": "Datensatz-ID",
  "partner.detail.projection.version": "Datensatzversion",
  "partner.quote.new.disabled.unconfirmed":
    "Bestätigen Sie die obige Prüfung, um den bepreisten Entwurf zu erstellen.",
  "partner.quote.new.disabled.created":
    "Der bepreiste Entwurf wurde erstellt. Öffnen Sie ihn in der Angebotsliste.",
  "partner.quote.new.success":
    "Der bepreiste Entwurf wurde erstellt. Öffnen Sie ihn, um die gespeicherten Preise und nächsten Schritte zu prüfen.",
  "partner.quote.new.failure": "Das Angebot konnte nicht erstellt werden.",
  "support.title": "Supportübersicht",
  "support.description":
    "Tickets dieses Kontos sind nur lesbar. Nutzen Sie für neue Anfragen weiterhin den bestehenden Supportkanal.",
  "internal.eyebrow": "Interne Verwaltung",
  "internal.title": "Commerce-Betrieb",
  "internal.description":
    "Ein Betriebsregister für Konten, Ausnahmen, Freigaben, Wiederherstellungen, Verlängerungen und Abgleich.",
  "internal.search.title": "Globale Suche",
  "internal.search.description":
    "Konten und operative Datensätze nach Typ gruppiert finden.",
  "internal.assisted.title": "Assistierte Ausführung",
  "internal.assisted.description":
    "Führen Sie Kunden- oder Partneraktionen mit Begründung, erhaltener Akteuridentität und demselben vertraglich geregelten Ablauf aus.",
  "internal.queues.title": "Ausnahme-Warteschlangen und Freigaben",
  "internal.queues.description":
    "Preis-, Rechts-, Kredit-, Prüfungs-, Streit-, Registrierungs-, POC-, destruktive und Migrationsaufgaben mit Haupt- und Stellvertretung.",
  "internal.priceBooks.title": "Preislistenverwaltung",
  "internal.priceBooks.description":
    "Datierte Tarife in USD, EUR und GBP, Transferstufen, Steuercodes, Mehrverbrauchspreise und Mindestmargen.",
  "internal.agreements.title": "Vereinbarungs- und Kundenvertragsverwaltung",
  "internal.agreements.description":
    "Juristisch genehmigte Vorlagen, Kundenverträge, Verhandlungsstand, Kernbedingungen, Abschlussnachweise und unveränderliche Versionen.",
  "internal.provisioning.title": "Bereitstellungswiederherstellung",
  "internal.provisioning.description":
    "Persistente Versuche prüfen, Anbieterfehler einordnen und sicher mit dem ursprünglichen Idempotenzschlüssel erneut ausführen.",
  "internal.collections.title": "Forderungsmanagement und Streitfälle",
  "internal.collections.description":
    "Mahnwesen, Forderungsalter, aufbewahrungsbewusste Sperrung, Nachweisfristen, Gutschriften, Erstattungen und Rückbelastungen.",
  "internal.renewals.title": "Verlängerungszentrale",
  "internal.renewals.description":
    "Risiken in 30, 60–90 und 180 Tagen für direkte, vermittelte und Partnervereinbarungen.",
  "internal.reports.title": "Berichte und Abgleich",
  "internal.reports.description":
    "Prognose, Kapazität, Abwanderung, Kanal, Trichter, Marge und Dreifachabgleich mit nachvollziehbaren Exporten.",
  "internal.migrations.title": "Migrationsprüfung",
  "internal.migrations.description":
    "Mehrdeutige Kontozuordnungen vor Datensatzerstellung oder Annahmeanfrage klären.",
  "internal.gates.title": "Status externer Voraussetzungen",
  "internal.gates.description":
    "Aktivierungsnachweise für Zugangsdaten, Recht, Handel, Steuern, Anbieter, Bereitstellung, Domains, Marke, Freigaben und Rückbau.",
  "signing.eyebrow": "Sicherer Abschluss",
  "signing.title": "Prüfen und unterzeichnen",
  "signing.description":
    "Ihre Position bleibt beim Öffnen des Signaturanbieters erhalten. Keine Vereinbarung wird vor bestätigtem Abschluss aktiv.",
  "signing.redirect": "Zur sicheren Unterzeichnung",
  "signing.embedded": "Eingebettete Unterzeichnung",
  "signing.loading":
    "Signatursitzung vorbereiten und genaue Dokumentversion prüfen.",
  "signing.failed":
    "Der Signaturanbieter hat nicht geantwortet. Ihre Vereinbarung bleibt unverändert.",
  "signing.recover": "Signaturverbindung wiederherstellen",
  "signing.returned":
    "Signatur bestätigt. Das unterzeichnete Dokument und die Abschlussbescheinigung sind in der Vereinbarungsakte.",
  "signing.unverified":
    "Die Rückmeldung passt nicht zum erwarteten Umschlag und Dokument-Hash. Die Vereinbarung bleibt unverändert.",
  "states.eyebrow": "Robuste Benutzererfahrung",
  "states.title": "Jeder Zustand hat einen sicheren nächsten Schritt",
  "states.description":
    "Definierte Reaktionen auf Verzögerungen, fehlende oder teilweise Daten, optimistische Änderungen, Validierung, Zugriff, Parallelität, Verbindung und Anbieterfehler.",
  "state.loading.title": "Kontoansicht wird erstellt",
  "state.loading.description":
    "Vertragsfristen und Finanzdaten treffen unabhängig ein; verfügbare Bereiche erscheinen zuerst.",
  "state.empty.title": "Noch keine Datensätze",
  "state.empty.description":
    "Beginnen Sie mit einem Angebot. Alles Weitere folgt daraus.",
  "state.partial.title": "Nutzungsdaten vorübergehend verzögert",
  "state.partial.description":
    "Geschäftsdaten sind bis 16:00 UTC aktuell. Nutzungsdaten werden ergänzt, ohne Summen zu ändern.",
  "state.success.title": "Datensatz vollständig",
  "state.success.description":
    "Unveränderliches Dokument, Audit-Ereignis und Benachrichtigung wurden gemeinsam erstellt.",
  "state.validation.title": "Markierten Wert prüfen",
  "state.validation.description":
    "Die zugesagte Kapazität muss das Mindestangebot erfüllen.",
  "state.stale.title": "Neuere Version verfügbar",
  "state.stale.description":
    "Ihr Entwurf bleibt erhalten. Prüfen Sie vor erneutem Anwenden die neueste Version.",
  "state.recoverable.title": "Der Anbieter benötigt einen weiteren Versuch",
  "state.recoverable.description":
    "Keine doppelte Aktion erstellt. Der erneute Versuch nutzt den ursprünglichen Idempotenzschlüssel.",
  "state.notFound.title": "Diese Seite ist nicht verfügbar",
  "state.notFound.description":
    "Die Adresse wurde möglicherweise geändert oder der Datensatz ist für dieses Konto nicht mehr sichtbar.",
  "state.fatal.title": "Diese Aktion kann nicht fortgesetzt werden",
  "state.fatal.description":
    "Laden Sie den aktuellen Datensatz vor einem weiteren Versuch neu. Bei anhaltenden Problemen nennen Sie dem Support die Anfrage-ID.",
  "detail.eyebrow": "Dokumentakte",
  "detail.description":
    "Kennungen, maßgebliche Referenzen, Nachweise, Dokumente und aktuelle Audit-Ereignisse dieser unveränderlichen Version.",
  "detail.provenance": "Datensatzherkunft",
  "detail.upstream": "Ursprungsdokument",
  "detail.version": "Geschäftsversion",
  "detail.hash": "Inhalts-Hash",
  "detail.documents": "Zugehörige Dokumente",
  "detail.audit": "Audit-Verlauf",
  "chart.usage": "Gespeicherte Kapazität der letzten sechs Monate",
  "chart.spend": "Abgerechnete Ausgaben der letzten sechs Monate",
  "chart.capacity": "Zugesagte und bereitgestellte Kapazität nach Region",
  "chart.axis.month": "Monat",
  "chart.axis.value": "Wert",
  "term.annual": "Jährlicher vertraglich zugesagter Dienst",
  "term.partner": "Meridian-Partnervereinbarung",
  "term.rollup": "Laufzeitenübersicht des Kontos",
  "term.count.one": "{count} aktive Laufzeit",
  "term.count.other": "{count} aktive Laufzeiten",
  "term.next": "Nächstes Enddatum",
  "term.none": "Keine aktiven Laufzeiten",
  "term.archive": "Primärarchiv",
  "term.replica": "Compliance-Replikat Madrid",
  "states.optimistic.title": "Änderung wird während der Prüfung angezeigt",
  "states.optimistic.description":
    "Lehnt der Vertrag sie ab, wird der alte Wert wiederhergestellt und der Fokus zur Erklärung verschoben.",
  "states.offline.title": "Für Wiederverbindung gespeichert",
  "states.offline.description":
    "Lesbare Datensätze bleiben verfügbar; keine Geld- oder Vertragsaktion gilt automatisch als abgeschlossen.",
  "format.tax.us": "Verkaufssteuer",
  "format.tax.eu": "Umsatzsteuer",
  "format.tax.uk": "Umsatzsteuer",
  "projection.action.readOnly":
    "Nur lesbar. Ein Kontoinhaber oder der zugewiesene Freigebende kann handeln.",
  "projection.action.pending": "Wird gesendet…",
  "projection.action.submitting": "{action} wird an die Commerce-API gesendet.",
  "projection.action.queued":
    "{action} ist eingereiht. Das maßgebliche Ergebnis steht aus.",
  "projection.action.applied":
    "Aktion angewendet: {action}. Maßgebliche Version: {version}.",
  "projection.action.appliedUnknownVersion":
    "Aktion angewendet: {action}. Die maßgebliche Version wurde nicht zurückgegeben.",
  "projection.action.rejected":
    "{action} wurde nicht angewendet. API-Antwort: {status}: {code}.",
  "projection.action.timeout":
    "{action} läuft noch. Das Ergebnis ist unbestätigt; der Datensatz kann sich noch ändern.",
  "projection.action.rechecking": "Ergebnis von {action} wird geprüft.",
  "projection.action.recheck": "Ergebnis erneut prüfen",
  "projection.action.conflict":
    "Datensatz geändert. Vor erneutem Versuch aktualisieren.",
  "projection.action.confirm.title": "{action}?",
  "projection.action.confirm.description":
    "Gilt für {record} in Version {version}.",
  "projection.action.confirm.detail":
    "Der Befehl wirkt auf den maßgeblichen Datensatz und wird protokolliert. Eine Rücknahme erfordert eine separate autorisierte Aktion.",
  "projection.action.confirm.cancel": "Datensatz unverändert lassen",
  "projection.action.accept": "Annehmen",
  "projection.action.addContact": "Kontakt hinzufügen",
  "projection.action.addRole": "Rolle hinzufügen",
  "projection.action.applyAmendment": "Vertragsänderung anwenden",
  "projection.action.approveException": "Ausnahme genehmigen",
  "projection.action.consolidate": "Rechnungen zusammenfassen",
  "projection.action.create": "Datensatz erstellen",
  "projection.action.evaluateDunning": "Mahnverfahren prüfen",
  "projection.action.executeAgreement": "Annehmen und abschließen",
  "projection.action.expire": "Jetzt ablaufen lassen",
  "projection.action.issue": "Ausgeben",
  "projection.action.markUncollectible": "Als uneinbringlich markieren",
  "projection.action.openInvoice": "Rechnung öffnen",
  "projection.action.pay": "Zahlung erfassen",
  "projection.action.prepareArtifact": "Dokument vorbereiten",
  "projection.action.convertPoc": "In kostenpflichtiges Angebot umwandeln",
  "projection.action.price": "Angebot bepreisen",
  "projection.action.rejectException": "Ausnahme ablehnen",
  "projection.action.requestTeardown": "Rückbau anfordern",
  "projection.action.requestRenewal": "Verlängerung anfordern",
  "projection.action.revise": "Revision erstellen",
  "projection.action.setPartnerCredit": "Partnerkredit festlegen",
  "projection.action.setPaymentTerms": "Zahlungsbedingungen festlegen",
  "projection.action.update": "Details aktualisieren",
  "projection.action.void": "Rechnung stornieren",
  "signing.agreementId": "Vereinbarungs-ID",
  "signing.agreementReference": "Vereinbarungsreferenz",
  "signing.serverSelected":
    "Konto, Unterzeichneridentität und unveränderliches Dokument werden vom Server aus dieser gespeicherten Vereinbarung gewählt.",
  "signing.startEmbedded": "Eingebettete Unterzeichnung starten",
  "signing.accepted":
    "Umschlag angenommen. Die Vereinbarung bleibt inaktiv, bis die signierte Anbieterrückmeldung geprüft ist.",
  "signing.continue": "Zum genehmigten Signaturanbieter",
  "signing.frame": "Sicherer E-Signatur-Anbieter",
  "signing.checking": "Gespeicherter Umschlagstatus wird geprüft…",
  "signing.download": "Unterzeichnete Vereinbarung herunterladen",
  "signing.pending.title": "Signatur ausstehend",
  "signing.pending.description":
    "Der Anbieter hat den Signaturabschluss noch nicht bestätigt.",
  "signing.refresh": "Status aktualisieren",
  "signing.declined.title": "Signatur abgelehnt",
  "signing.expired.title": "Signatursitzung abgelaufen",
  "signing.unchanged":
    "Die Vereinbarung bleibt unverändert. Öffnen Sie die Akte für die nächsten Schritte.",
  "signing.agreements": "Zurück zu Vereinbarungen",
  "signing.missingState":
    "Die Signaturrückmeldung enthält keine maßgebliche Statusreferenz.",
  "signing.unverifiable":
    "Der Server konnte den Signaturstatus nicht bestätigen.",
  "signing.requestFailed":
    "Signaturanfrage fehlgeschlagen. Die Vereinbarung bleibt unverändert.",
  "signing.choose.title": "Zuerst eine Vereinbarung wählen",
  "signing.choose.description":
    "Die Unterzeichnung beginnt bei einer autorisierten Vereinbarung, damit der Server die genaue Dokumentversion wählt.",
  "signing.demo.eyebrow": "Demo-Signaturdienst",
  "signing.demo.title": "Dokument unterzeichnen",
  "signing.demo.description":
    "Dies simuliert den Signaturanbieter. Unterzeichnung schließt den Umschlag ab und kehrt zur echten Rückmeldungsabstimmung in Fil One zurück.",
  "signing.demo.document": "Dokument",
  "signing.demo.signer": "Unterzeichner",
  "signing.demo.envelope": "Signaturumschlag",
  "signing.demo.action": "Dokument unterzeichnen",
  "signing.demo.unavailable.title": "Diese Signatursitzung ist nicht verfügbar",
  "signing.demo.unavailable.description":
    "Signaturstatus unbekannt oder abgelaufen. Beginnen Sie erneut in der Vereinbarungsakte.",
  "workflow.confirm.title": "Diese Entscheidung bestätigen",
  "workflow.confirm.description":
    "Diese Entscheidung wird mit den oben genannten Kennungen erfasst.",
  "workflow.confirm.detail":
    "Prüfen Sie Kennungen, Begründung und Nachweisreferenz. Ablehnung oder Rückbauanfrage beendet den aktuellen Geschäftsweg; nur eine neue Entscheidung öffnet ihn wieder.",
  "workflow.confirm.cancel": "Datensatz unverändert lassen",
  "workflow.confirm.action": "Bestätigen und senden",
} satisfies MessageCatalog;

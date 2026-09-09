import type { MessageCatalog } from "./en";

export const pt = {
  "quotes.form.description":
    "Escolha uma oferta, defina a capacidade e o prazo e revise o rascunho.",
  "quotes.form.offerHelp":
    "Escolha uma oferta disponível para a região desejada.",
  "quotes.form.reviewTitle": "Revise seu rascunho",
  "quotes.form.reviewDescription":
    "A criação do rascunho calcula seu preço. Depois, abra o rascunho salvo para preparar o documento e emitir a cotação. Você poderá revisá-la antes de aceitar um pedido.",
  "quotes.form.expiryHelp": "Use sua data e hora locais.",
  "quotes.form.expiryFuture":
    "Escolha um vencimento posterior ao horário atual.",
  "quotes.form.stageTerms": "Capacidade, prazo e vencimento",
  "quotes.form.stageReview": "Revisar rascunho",
  "quotes.form.partnerDescription":
    "Escolha uma oferta e um cliente final e defina seu preço de revenda. A Fil One calcula seu preço de transferência ao criar o rascunho.",

  "quotes.issue.title": "Concluir esta cotação",
  "quotes.issue.description":
    "Prepare o documento da cotação salva para que ela possa ser aceita. Emitir uma cotação não cria um pedido.",
  "quotes.issue.action": "Preparar e emitir cotação",
  "quotes.issue.working": "Preparando cotação…",
  "quotes.issue.retry": "Continuar esta cotação",
  "quotes.issue.accept": "Revisar e aceitar pedido",
  "quotes.issue.refresh":
    "Atualize esta página para verificar a cotação e seu acesso e tente novamente.",
  "quotes.issue.pricingReview":
    "O preço deste rascunho precisa ser revisado antes da emissão. Entre em contato com sua equipe da Fil One.",
  "quotes.issue.documentUnavailable":
    "Não foi possível verificar o documento. Nenhuma cotação foi emitida. Tente novamente.",
  "quotes.issue.rendering":
    "O documento ainda está sendo preparado. Continue esta cotação para verificar novamente.",
  "quotes.issue.synchronizing":
    "A cotação foi emitida. O status ainda está sendo atualizado; continue para verificar novamente.",

  "cp.common.loadingTitle": "Carregando registros",
  "cp.common.loadingBody": "Os registros mais recentes estão sendo obtidos.",
  "cp.common.emptyTitle": "Ainda não há nada aqui",
  "cp.common.emptyBody":
    "Os registros aparecerão quando as atividades desta conta começarem.",
  "cp.common.noMatchTitle": "Nenhum registro corresponde a estes filtros",
  "cp.common.noMatchBody":
    "Remova ou altere um filtro para ver mais resultados.",
  "cp.common.permissionTitle":
    "Seu perfil não permite acessar estas informações",
  "cp.common.permissionBody":
    "Peça a um titular da conta que conceda o acesso necessário.",
  "cp.common.errorTitle": "Não foi possível carregar os registros",
  "cp.common.errorBody": "Tente novamente. Seus filtros foram mantidos.",
  "cp.common.freshnessCurrent": "Os registros estão atualizados",
  "cp.common.freshnessReadAt": "Leitura",
  "cp.common.freshnessStaleTitle":
    "Estes registros podem estar desatualizados.",
  "cp.common.freshnessStaleBody":
    "Os dados desta página ainda não foram sincronizados com a origem, então uma alteração recente pode estar ausente. Atualize antes de agir.",
  "cp.common.freshnessAction": "Atualizar registros",
  "cp.common.freshnessPartialTitle": "Só foi possível ler parte desta coleção.",
  "cp.common.freshnessPartialBody":
    "Esta conta tem mais registros neste canal do que uma única leitura pode retornar. As linhas abaixo são as atualizadas mais recentemente. A contagem, os filtros, os totais e a ordenação abrangem apenas os registros lidos: uma lista corretamente ordenada por valor ainda pode omitir o registro de maior valor. A leitura incompleta foi comunicada; atualizar não retornará o restante.",
  "cp.common.unsavedTitle": "Sair sem salvar?",
  "cp.common.unsavedBody":
    "Nada deste formulário foi enviado ao servidor ainda. Ao sair, tudo o que foi preenchido será descartado.",
  "cp.common.unsavedDiscard": "Descartar e sair",
  "cp.common.unsavedKeep": "Continuar editando",
  "cp.customer.dashboardGreeting": "Boas-vindas de volta",
  "cp.customer.dashboardDescription":
    "Atenda primeiro aos prazos comerciais e depois analise o desempenho da conta.",
  "cp.customer.attentionTitle": "Requer atenção",
  "cp.customer.attentionDescriptionOne":
    "{count} item requer uma decisão ou acompanhamento.",
  "cp.customer.attentionDescriptionOther":
    "{count} itens requerem uma decisão ou acompanhamento.",
  "cp.customer.attentionDescriptionNone":
    "Nenhum item requer uma decisão ou acompanhamento.",
  "cp.customer.termTitle": "Período contratual atual",
  "cp.customer.serviceRollup": "Resumo dos períodos de serviço",
  "cp.customer.metricsTitle": "Visão geral das decisões",
  "cp.customer.activityTitle": "Atividade recente",
  "cp.customer.accountTitle": "Configurações da conta",
  "cp.customer.accountDescription":
    "Gerencie sua organização, as pessoas e os requisitos de compra.",
  "cp.customer.quotePermissionNote":
    "Um titular ou administrador da conta pode criar cotações.",
  "cp.customer.accountPermissionNote":
    "Um titular ou administrador da conta gerencia usuários, compras e solicitações de encerramento.",
  "cp.customer.collections.amendments.description":
    "Acompanhe alterações solicitadas e concluídas nos serviços ativos.",
  "cp.customer.collections.amendments.searchPlaceholder": "Buscar alterações",
  "cp.customer.collections.users.description":
    "Veja quem pode visualizar e aprovar operações comerciais.",
  "cp.customer.collections.users.searchPlaceholder": "Buscar usuários",
  "cp.customer.collections.procurement.description":
    "Mantenha atualizados o encaminhamento de faturas, o cadastro de fornecedores e os comprovantes fiscais.",
  "cp.customer.collections.procurement.searchPlaceholder":
    "Buscar registros de compras",
  "cp.customer.collections.marketplace.title": "Compras no marketplace",
  "cp.customer.collections.marketplace.description":
    "Acompanhe ofertas privadas e o cumprimento informado pelo provedor.",
  "cp.customer.collections.marketplace.searchPlaceholder":
    "Buscar ofertas do marketplace",
  "cp.customer.collections.support.description":
    "Acompanhe os problemas dos clientes; o provedor de suporte continua sendo a fonte oficial das informações.",
  "cp.customer.collections.support.searchPlaceholder":
    "Buscar chamados de suporte",
  "cp.commercial.quoteStages.0": "Oferta e região",
  "cp.commercial.quoteStages.1": "Capacidade, prazo, canal direto e vencimento",
  "cp.commercial.quoteStages.2": "Revisar e emitir",
  "cp.commercial.quoteSummary": "Resumo da cotação",
  "cp.commercial.reviewIssue": "Revisar e emitir",
  "cp.commercial.agreementAuthority":
    "Confirmo que tenho autorização para vincular esta pessoa jurídica a este contrato.",
  "cp.commercial.agreementReview": "Revisar e aceitar o contrato",
  "cp.commercial.orderReview": "Revisar o compromisso resultante",
  "cp.commercial.orderConfirmation":
    "Revisei a cotação emitida, o contrato aplicável, o pedido de compra, o início e o término do serviço e o compromisso resultante.",
  "cp.commercial.orderTermsHelp":
    "Os termos do pedido vêm da cotação emitida {quoteReference}, versão {quoteVersion}, e de {agreementTitle}, versão {agreementVersion}. Uma referência de pedido de compra não substitui nem altera esses termos fixados.",
  "cp.commercial.orderArtifactRetention":
    "O formulário de pedido gerado e a evidência de sua aceitação são mantidos por {years} anos a partir do instante de aceitação registrado.",
  "cp.commercial.estimatedSpend": "Gasto estimado",
  "cp.commercial.invoiceTruth": "Valor faturado",
  "cp.commercial.paymentTruth": "Status do pagamento",
  "cp.commercial.paymentWebhook":
    "Informado pelo webhook do provedor de pagamentos",
  "cp.commercial.externalPayment":
    "Você continuará com o provedor de pagamentos. A fatura só será marcada como paga após a confirmação do provedor.",
  "cp.commercial.confirmMutation": "Revisar e confirmar",
  "cp.partner.deskDescription":
    "Cuide dos prazos do contrato e resolva as tarefas urgentes dos clientes antes de analisar o desempenho.",
  "cp.partner.agreementClock": "Prazos do contrato de parceiro",
  "cp.partner.urgentTitle": "Tarefas urgentes do parceiro",
  "cp.partner.transferPrice": "Preço de transferência da Fil One",
  "cp.partner.partnerPrice": "Preço de revenda do parceiro",
  "cp.partner.merchantOfRecord": "Vendedor responsável pela transação",
  "cp.partner.boundary":
    "O preço de transferência é privado para o parceiro. O cliente final vê o preço de revenda definido pelo parceiro.",
  "cp.partner.renewalReview": "Revisar a renovação antes de confirmar",
  "cp.partner.registrationReview": "Revisar o registro da oportunidade",
  "app.pageLoaded": "{page}. Página carregada.",

  "operations.stale":
    "É necessário atualizar {channels}. Abra o espaço antes de decidir.",
  "operations.cases.one": "{count} caso",
  "operations.cases.other": "{count} casos",
  "operations.priority.one": "{count} caso precisa de atenção prioritária.",
  "operations.priority.other": "{count} casos precisam de atenção prioritária.",
  "operations.records.one": "{count} registro",
  "operations.records.other": "{count} registros",
  "operations.providerSummary":
    "Operações de provedores: {operations}. Encerramentos de serviços: {terminations}.",
  "operations.invoiceSummary":
    "Faturas vencidas: {overdue}. Faturas abertas: {open}.",
  "operations.orders.one": "{count} pedido",
  "operations.orders.other": "{count} pedidos",
  "operations.exports.one": "{count} exportação",
  "operations.exports.other": "{count} exportações",
  "approval.reviewApprove": "Revisar aprovação",
  "approval.reviewReject": "Revisar rejeição",

  "ui.0": "Saúde operacional",
  "ui.1":
    "Trabalho que exige atenção em aprovações, cobranças, provisionamento, renovações e relatórios.",
  "ui.2": "Visão geral do trabalho",
  "ui.3":
    "Trabalho priorizado das equipes que você apoia, com acesso direto a cada espaço.",
  "ui.4": "Visão geral do trabalho operacional",
  "ui.5": "Abrir minha fila",
  "ui.6": "Indicador",
  "ui.7": "Resumo",
  "ui.8": "Área",
  "ui.9": "Atualizado",
  "ui.10": "Ação",
  "ui.11": "Aprovações",
  "ui.12": "Provisionamento",
  "ui.13": "Cobranças",
  "ui.14": "Renovações",
  "ui.15": "Relatórios",
  "ui.16": "desatualizado",
  "ui.17": "Trabalho na fila",
  "ui.18": "Abrir a fila",
  "ui.19": "Abrir provisionamento",
  "ui.20": "Nenhum valor registrado",
  "ui.21": "Abrir cobranças",
  "ui.22": "Aviso de renovação",
  "ui.23":
    "Pedidos cujo aviso contratual já venceu ou vence nos próximos 30 dias.",
  "ui.24": "Abrir renovações",
  "ui.25": "Exportações de relatórios",
  "ui.26": "Exportações registradas na sua sessão de operador.",
  "ui.27": "Abrir relatórios",
  "ui.28": "Operações internas",
  "ui.29": "Status dos dados",
  "ui.30": "Atualizado",
  "ui.31": "Precisa atualizar",
  "ui.32": "Temporariamente indisponível",
  "ui.33": "Indisponível neste espaço",
  "ui.34": "Pelo menos um registro passou do prazo de atualização.",
  "ui.35": "Confira os dados no registro de origem antes de decidir.",
  "ui.36": "Prazos de aviso de renovação",
  "ui.37":
    "Pedidos agrupados pelo tempo até o aviso contratual, com canal e faturamento registrados.",
  "ui.38": "Sobre o valor de renovação",
  "ui.39":
    "Faturado até hoje mostra o valor por pedido. Previsões permanecem separadas desta lista de renovações.",
  "ui.40": "Faturado até hoje",
  "ui.41": "Nenhuma fatura registrada neste pedido",
  "ui.42": "Canal não registrado",
  "ui.43": "Nenhum pedido neste período.",
  "ui.44": "Prioridade de cobranças",
  "ui.45":
    "Faturas abertas por exposição e antiguidade, com correções que um aprovador financeiro pode solicitar.",
  "ui.46": "Ordem de prioridade",
  "ui.47":
    "Maior valor aberto, dias de atraso e referência. Valores em outra moeda são ordenados, mas nunca somados ao total.",
  "ui.48": "Ações de cobrança",
  "ui.49":
    "Abra cada fatura para revisar pagamentos, contestações e correções disponíveis.",
  "ui.50": "Total de faturas abertas",
  "ui.51": "Vencido",
  "ui.52": "Maior atraso",
  "ui.53": "Não registrado",
  "ui.54": "Faturas abertas",
  "ui.55": "Valor, antiguidade, status e correções disponíveis em cada fatura.",
  "ui.56": "Faturas abertas por valor e dias de atraso",
  "ui.57": "Nenhuma fatura aberta precisa de cobrança.",
  "ui.58": "Trabalho de provisionamento",
  "ui.59":
    "Acompanhe provedores, encerramentos, novas tentativas e itens que exigem atenção.",
  "ui.60": "O trabalho interrompido é tratado em Recuperação.",
  "ui.61":
    "Abra Recuperação para tentar novamente ou abandonar trabalhos que esgotaram as tentativas automáticas.",
  "ui.62": "Abrir fila de recuperação",
  "ui.63": "Operações de provedores",
  "ui.64": "Encerramentos de serviços",
  "ui.65": "Alto risco",
  "ui.66": "Registros de provisionamento",
  "ui.67": "Registros de provisionamento por risco e tentativas usadas",
  "ui.68": "Nenhum provisionamento exige atenção neste espaço.",
  "ui.69": "Tentativas",
  "ui.70": "Não se aplica",
  "ui.71": "Relatórios operacionais",
  "ui.72":
    "Exportações registradas na sua sessão e exportações disponíveis para gerar agora.",
  "ui.73": "Exportações de relatórios registradas",
  "ui.74": "Exportações de relatórios, mais recentes primeiro",
  "ui.75":
    "Nenhuma exportação no seu escopo de operador. Gere uma abaixo para registrá-la.",
  "ui.76": "Todos os relatórios disponíveis",
  "ui.77": "Documento registrado",
  "ui.78": "Nenhum documento registrado ainda",
  "ui.79": "Exportações disponíveis",
  "ui.80":
    "Registro de relatórios do contrato da API comercial. Cada um é gerado sob demanda; esta página não guarda resultados em cache nem informa sua atualização.",
  "ui.81": "ARR e MRR",
  "ui.82": "Faturamento e cobranças",
  "ui.83": "Liquidação de comissões",
  "ui.84": "Exportações são geradas sob demanda",
  "ui.85":
    "Escolha um relatório e escopo de contas abaixo. Exportações concluídas ficam no histórico.",
  "ui.86": "Buscar",
  "ui.87": "Filtros",
  "ui.88": "Status",
  "ui.89": "Risco",
  "ui.90": "Responsável",
  "ui.91": "Ordenar",
  "ui.92": "Visualização",
  "ui.93": "Linhas por página",
  "ui.94": "Anterior",
  "ui.95": "Próximo",
  "ui.96": "Detalhes técnicos",
  "ui.97": "Documentos",
  "ui.98": "Evidências de auditoria",
  "ui.99": "Cadeia documental",
  "ui.100": "Resumo comercial",
  "ui.101": "Estado do prazo",
  "ui.102": "Próxima ação",
  "ui.103": "Espaço do cliente",
  "ui.104": "Organização",
  "ui.105": "Usuários e acesso",
  "ui.106":
    "Revise papéis, autoridade de aprovação, estado de MFA e convites pendentes.",
  "ui.107": "Compras",
  "ui.108":
    "Gerencie envio de faturas, cadastro de fornecedores, ordens de compra e comprovantes fiscais.",
  "ui.109": "Encerramento",
  "ui.110":
    "Revise recuperação dos dados, faturamento final, exclusões de retenção e autoridade de desativação.",
  "ui.111": "Salvar",
  "ui.112": "Cancelar",
  "ui.113": "Todos",
  "ui.114": "Nenhum",
  "ui.115": "Motivo",
  "ui.116": "Evidências",
  "ui.117": "Referência",
  "ui.118": "Conta",
  "ui.119": "Valor",
  "ui.120": "Moeda",
  "ui.121": "Data",
  "ui.122": "Versão",
  "ui.123": "Detalhes",
  "ui.124": "Atualizar",
  "ui.125": "Tentar novamente",
  "ui.126": "Fechar",
  "ui.127": "Carregando…",
  "ui.128": "Nenhum resultado",
  "settings.title": "Configurações",
  "settings.description": "Personalize seu espaço de trabalho.",
  "settings.language": "Idioma",
  "settings.language.description":
    "Escolha o idioma da interface. Sua preferência será salva neste navegador para as próximas visitas.",
  "settings.language.label": "Idioma da interface",
  "settings.save": "Salvar idioma",
  "settings.saving": "Salvando…",
  "settings.saved": "Idioma salvo.",
  "settings.error": "Escolha um idioma disponível e tente novamente.",
  "settings.language.records":
    "Nomes, dados inseridos e documentos contratuais originais permanecem no idioma original.",
  "app.name": "Fil One",
  "app.product": "Comércio",
  "app.demo": "Ambiente de demonstração",
  "app.demo.short": "Demo",
  "app.demo.reset.success": "Dados de demonstração restaurados.",
  "app.demo.reset.confirm.title": "Redefinir o ambiente de demonstração?",
  "app.demo.reset.confirm.description":
    "Todos os espaços de demonstração voltarão ao estado inicial e a página será recarregada.",
  "app.demo.reset.confirm.detail":
    "Suas alterações na demonstração e o trabalho não salvo nesta página serão removidos.",
  "app.demo.reset.confirm.action": "Redefinir demo",
  "app.demo.reset.confirm.cancel": "Manter estado atual",
  "demo.access.eyebrow": "Acesso à demonstração",
  "demo.access.title": "Digite a senha de demonstração",
  "demo.access.description":
    "Digite a senha recebida para explorar o Fil One Commerce.",
  "demo.access.password": "Senha",
  "demo.access.submit": "Continuar",
  "demo.access.invalid": "A senha não confere. Tente novamente.",
  "demo.landing.eyebrow": "Demonstração guiada",
  "demo.landing.title": "Escolha o perfil de acesso",
  "demo.landing.description":
    "Cada perfil abre o Fil One Commerce na sua área de trabalho. Troque de perfil a qualquer momento no painel de demonstração.",
  "demo.landing.start": "Começar como {name}",
  "demo.landing.internal": "Equipe Fil One",
  "demo.landing.external": "Clientes e parceiros",
  "demo.panel.title": "Controles da demonstração",
  "demo.panel.open": "Abrir controles da demonstração",
  "demo.panel.close": "Fechar controles da demonstração",
  "demo.panel.persona": "Conectado como",
  "demo.panel.journey": "Jornada",
  "demo.panel.reset": "Restaurar dados da demonstração",
  "demo.panel.resetting": "Redefinindo…",
  "demo.panel.reset.failed":
    "Não foi possível redefinir os dados da demonstração.",
  "demo.panel.browse": "Todos os perfis",
  "app.verifyAuthentication": "Verificar identidade para alterações sensíveis",
  "app.signOut": "Sair",
  "app.skip": "Ir para o conteúdo principal",
  "app.nav.primary": "Navegação principal",
  "app.nav.secondary": "Conta e ajuda",
  "app.nav.open": "Abrir navegação",
  "app.nav.title": "Navegação",
  "app.nav.description": "Explore todas as seções.",
  "app.nav.close": "Fechar navegação",
  "app.search": "Buscar",
  "app.search.hint": "Contas, pedidos, faturas ou documentos",
  "app.command": "Abrir menu de comandos",
  "app.command.title": "Busca e comandos",
  "app.command.description":
    "Encontre uma seção, inicie tarefas comuns ou abra um registro recente.",
  "app.command.searchLabel": "Buscar seções, ações e registros",
  "app.command.noResults":
    "Nenhum resultado. Tente um ID, uma conta ou uma ação.",
  "app.command.group.navigation": "Navegação",
  "app.command.group.actions": "Ações",
  "app.command.group.records": "Registros",
  "app.command.action.customerQuote":
    "Configure capacidade, prazo e detalhes comerciais.",
  "app.command.action.inviteUser": "Gerencie o acesso à organização atual.",
  "app.command.action.registerDeal":
    "Proteja uma nova oportunidade de parceiro.",
  "app.command.action.partnerQuote": "Monte os preços para um cliente final.",
  "app.command.action.globalSearch": "Busque contas e registros operacionais.",
  "app.command.action.reviewApprovals": "Abra a fila de aprovações e exceções.",
  "app.command.shortcut": "Comando K",
  "app.help": "Ajuda",
  "app.help.description": "Guias, suporte e status do serviço",
  "app.help.internal": "Pré-requisitos externos e orientações operacionais",
  "app.help.internal.description":
    "Revise pré-requisitos de ativação, responsáveis e orientações",
  "app.account.switch": "Trocar organização",
  "app.account.switched": "Alterado para {account}.",
  "app.account.choose.title": "Escolha uma organização",
  "app.account.choose.description":
    "Selecione uma organização ativa autorizada para sua identidade WorkOS.",
  "app.account.choose.empty.title": "Nenhuma organização autorizada",
  "app.account.choose.empty.description":
    "Esta identidade não tem vínculo comercial ativo. Um administrador pode conceder acesso, ou você pode sair e usar outra identidade.",
  "app.profile": "Abrir menu do perfil",
  "app.requestId": "Solicitação {id}",
  "app.footer":
    "Os registros comerciais do Fil One são sincronizados com o registro operacional.",
  "app.offline":
    "Você está offline. As informações salvas continuam disponíveis; as alterações aguardarão a conexão.",
  "app.online":
    "Conexão restabelecida. As alterações pendentes já podem ser enviadas.",
  "session.expired.title": "Sua sessão foi encerrada com segurança",
  "session.expired.description":
    "Entre novamente para continuar. Os rascunhos continuam salvos neste dispositivo.",
  "session.expired.action": "Entrar novamente",
  "session.mfa.title": "Mais uma verificação",
  "session.mfa.description":
    "Seu papel exige autenticação multifator antes de permitir ações comerciais.",
  "session.mfa.action": "Verificar identidade",
  "session.permission.title":
    "Esta visualização não está disponível para seu papel",
  "session.permission.description":
    "Troque de organização ou peça a um proprietário que atualize seu papel comercial.",
  "session.permission.action": "Voltar ao painel",
  "nav.dashboard": "Visão geral",
  "nav.buy": "Comprar",
  "nav.payg": "Pagamento por uso e testes",
  "nav.agreements": "Acordos",
  "nav.quotes": "Propostas",
  "nav.orders": "Pedidos",
  "nav.services": "Serviços ativos",
  "nav.pocs": "Provas de conceito",
  "nav.billing": "Faturamento",
  "nav.amendments": "Aditivos",
  "nav.marketplace": "Marketplace",
  "nav.support": "Suporte",
  "nav.account": "Conta",
  "nav.partner.home": "Espaço do parceiro",
  "nav.partner.portfolio": "Clientes finais",
  "nav.partner.registrations": "Registro de oportunidades",
  "nav.partner.quotes": "Propostas de parceiros",
  "nav.partner.billing": "Faturamento consolidado",
  "nav.partner.commissions": "Comissões",
  "nav.partner.renewals": "Renovações",
  "nav.partner.disputes": "Contestações",
  "nav.partner.marketplace": "Marketplace",
  "nav.partner.sandboxes": "Ambientes de teste e POCs",
  "nav.partner.brand": "Marca e domínios",
  "nav.partner.enablement": "Recursos para parceiros",
  "nav.partner.support": "Suporte",
  "nav.internal.home": "Operações",
  "nav.internal.search": "Busca global",
  "nav.internal.queues": "Filas e aprovações",
  "nav.internal.renewals": "Gestão de renovações",
  "nav.internal.collections": "Cobranças",
  "nav.internal.provisioning": "Provisionamento",
  "nav.internal.recovery": "Recuperação",
  "nav.internal.webhookReplay": "Reexecução de webhooks",
  "nav.internal.migrations": "Migrações",
  "nav.internal.reports": "Relatórios",
  "nav.internal.revenue": "Receita e canal",
  "nav.internal.billingReconciliation": "Conciliação de faturamento",
  "nav.internal.status": "Status das integrações",
  "nav.internal.unhandledErrors": "Erros não tratados",
  "nav.internal.agreements": "Versões de acordos",
  "nav.internal.approvals": "Revisão de aprovações",
  "nav.internal.priceBooks": "Tabelas de preços",
  "nav.internal.paygRequests": "Solicitações de serviço",
  "nav.internal.paygOffers": "Pagamento por uso e testes",
  "nav.internal.capabilities": "Funcionalidades habilitadas",
  "nav.internal.providers": "Referências de provedores",
  "nav.internal.catalog": "Mapeamentos do catálogo",
  "nav.internal.channelPolicy": "Política de canal",
  "nav.internal.gates": "Pré-requisitos externos",
  "nav.internal.assisted": "Modo assistido",
  "nav.group.pricing": "Preços",
  "nav.group.legal": "Registro jurídico",
  "nav.group.service": "Serviço",
  "nav.group.organization": "Organização",
  "nav.group.partner.dealFlow": "Oportunidades",
  "nav.group.partner.revenue": "Receita",
  "nav.group.partner.channel": "Canal",
  "nav.group.internal.queues": "Filas de exceções",
  "nav.group.internal.providerRecovery": "Recuperação de provedores",
  "nav.group.internal.administration": "Administração",
  "action.view": "Ver detalhes",
  "action.review": "Revisar",
  "action.retry": "Tentar novamente",
  "action.returnHome": "Voltar ao seu painel",
  "action.cancel": "Cancelar",
  "action.download": "Baixar PDF",
  "action.createQuote": "Criar proposta",
  "action.invite": "Convidar usuário",
  "action.open": "Abrir registro",
  "action.register": "Registrar oportunidade",
  "common.status": "Status",
  "common.updated": "Última atualização",
  "common.term": "Prazo",
  "status.active": "Ativo",
  "status.inNotice": "Em prazo de aviso",
  "status.awaiting": "Aguardando ação",
  "status.review": "Requer revisão",
  "status.paid": "Pago",
  "status.ready": "Pronto",
  "status.pending": "Pendente",
  "status.provisioning": "Em provisionamento",
  "status.blocked": "Bloqueado",
  "status.complete": "Concluído",
  "status.draft": "Rascunho",
  "status.signed": "Assinado",
  "dashboard.eyebrow": "Situação da conta",
  "dashboard.description":
    "Atividade comercial, saúde dos serviços e próximas datas contratuais da Northstar Archive Labs.",
  "dashboard.chain": "Atividade recente",
  "dashboard.activeServices": "Serviços ativos",
  "dashboard.empty.obligations":
    "Nenhuma decisão é necessária agora. Os prazos comerciais aparecerão aqui quando se aproximarem.",
  "dashboard.empty.services":
    "Nenhum serviço está ativo. Os pedidos aceitos aparecerão quando o provisionamento começar.",
  "dashboard.empty.activity":
    "Nenhuma atividade da conta foi registrada neste período.",
  "dashboard.empty.capacity":
    "A capacidade contratada, o uso atual e os últimos 30 dias aparecerão após o envio do uso medido desta conta.",
  "dashboard.openQuotes": "Propostas abertas",
  "dashboard.invoiceDue": "Fatura a pagar",
  "dashboard.daysToNotice": "Dias até o prazo de aviso",
  "agreements.eyebrow": "Registro jurídico",
  "agreements.title": "Acordos",
  "agreements.description":
    "Termos firmados, provas de assinatura, versões aplicáveis e prazos de renovação no mesmo registro.",
  "agreements.execute": "Firmar um acordo",
  "agreements.execute.binding":
    "Confirme título, versão, termos exatos aprovados e sua autoridade para vincular {account}.",
  "agreements.execute.source": "Formalização conforme o acordo {reference}",
  "agreements.execute.validation.authority":
    "Informe o cargo com autoridade de assinatura para esta entidade jurídica.",
  "agreements.execute.validation.attestation":
    "Confirme sua autoridade para vincular esta entidade jurídica antes de firmar o acordo.",
  "agreements.execute.accepted":
    "Acordo firmado. A comprovação de sua autoridade está registrada.",
  "agreements.execute.acceptedLink": "Abrir o acordo firmado",
  "quotes.eyebrow": "Preços com confiança",
  "quotes.title": "Propostas",
  "quotes.description":
    "As versões emitidas e imutáveis continuam vinculadas à tabela de preços, ao acordo e ao pedido.",
  "quotes.builder.title": "Criar proposta",
  "quotes.builder.description":
    "Configure o serviço; a API comercial continua sendo a fonte dos preços e das aprovações.",
  "quotes.builder.account.description": "Conta autorizada para esta sessão",
  "quotes.builder.origin.revision": "Revisa a proposta {reference}",
  "quotes.builder.origin.poc": "Converte a prova de conceito {reference}",
  "quotes.builder.origin.unavailable":
    "O registro indicado está fora desta conta. O rascunho começa sem dados de origem.",
  "quotes.builder.created":
    "Rascunho com preço criado. Você poderá emiti-lo quando o documento estiver preparado e vinculado.",
  "quotes.builder.createdLink": "Abrir o rascunho criado",
  "orders.eyebrow": "Do compromisso ao serviço",
  "orders.title": "Pedidos e serviços",
  "orders.description":
    "Ordens de compra, provisionamento, direitos, uso, aditivos e prazos sem redigitação.",
  "orders.amendment": "Solicitar aditivo",
  "orders.accept.source": "Proposta aceita {reference} · versão {version}",
  "orders.accept.agreement.unknown":
    "Nenhum acordo ativo aplicável está registrado para esta conta.",
  "orders.accept.unavailable.title": "Nenhuma proposta aceitável selecionada",
  "orders.accept.unavailable.description":
    "A aceitação do pedido começa por uma proposta aceita desta conta. Escolha uma no registro de propostas.",
  "orders.accept.unavailable.action": "Abrir registro de propostas",
  "orders.accept.validation.po": "Informe a referência da ordem de compra.",
  "orders.accept.validation.serviceStart":
    "Escolha a data de início do serviço.",
  "orders.accept.validation.authority":
    "Informe o cargo com autoridade de aceitação.",
  "orders.accept.validation.confirmation":
    "Confirme o compromisso revisado antes de aceitar.",
  "orders.accept.created":
    "Pedido criado. O compromisso e o estado de provisionamento agora são oficiais.",
  "orders.accept.createdLink": "Abrir o pedido criado",
  "orders.accept.prepared":
    "Formulário de pedido solicitado. O compromisso será criado quando o documento for gerado e vinculado à proposta.",
  "orders.accept.preparedLink": "Acompanhar esta aceitação em pedidos",
  "orders.accept.failed":
    "Não foi possível aceitar o pedido. Nada foi alterado.",
  "pocs.eyebrow": "Teste com segurança",
  "pocs.title": "Provas de conceito",
  "pocs.description":
    "Ambientes isolados com limites, marcos, critérios de sucesso, custos e conversão que preserva os dados.",
  "billing.eyebrow": "Faturamento claro e rastreável",
  "billing.title": "Faturamento e pagamentos",
  "billing.description":
    "As faturas incluem pedido e ordem de compra de origem, recibos, créditos, antiguidade, tratamento fiscal e meios de pagamento.",
  "billing.aging": "Antiguidade das contas a receber",
  "account.eyebrow": "Controles da organização",
  "account.title": "Conta, usuários e compras",
  "account.description":
    "Identidade jurídica, papéis de aprovação, contas a pagar, cadastro de fornecedores, comprovantes fiscais e encerramento seguro.",
  "account.users": "Usuários e papéis",
  "account.procurement": "Perfil de compras",
  "account.offboarding": "Encerramento e certificados",
  "account.owner": "Proprietário da conta",
  "account.billingContact": "Contato de faturamento",
  "account.people": "Pessoas com acesso",
  "account.invitations": "Convites pendentes",
  "account.unassigned": "Não registrado",
  "account.areas.users.meta.one": "{count} pessoa com acesso",
  "account.areas.users.meta.other": "{count} pessoas com acesso",
  "account.areas.procurement.meta.one": "{count} requisito registrado",
  "account.areas.procurement.meta.other": "{count} requisitos registrados",
  "account.areas.offboarding.meta":
    "Confirmação obrigatória em cada solicitação",
  "account.offboarding.service": "Serviço",
  "account.offboarding.empty.title":
    "Nenhum serviço disponível para encerramento",
  "account.offboarding.empty.description":
    "O encerramento começa em um pedido ativo desta conta. Compromissos ativos aparecem em pedidos e serviços.",
  "account.offboarding.empty.action": "Abrir pedidos e serviços",
  "account.offboarding.validation.effectiveAt":
    "Escolha a data e a hora de vigência solicitadas.",
  "account.offboarding.validation.confirmation":
    "Confirme as salvaguardas de retenção e aprovação revisadas antes de enviar.",
  "account.offboarding.requested":
    "Solicitação de encerramento enviada para aprovação. Seu serviço continua funcionando.",
  "account.offboarding.requestedLink": "Abrir o registro do serviço afetado",
  "account.offboarding.failed":
    "Não foi possível enviar a solicitação de encerramento.",
  "partner.eyebrow": "Prazos do acordo primeiro",
  "partner.title": "Espaço do parceiro",
  "partner.description":
    "Seu acordo aplicável vem primeiro; os serviços ativos dos clientes finais continuam sob as condições que permanecem vigentes.",
  "partner.portfolio.title": "Carteira de clientes finais",
  "partner.portfolio.description":
    "Uso, provisionamento, exposição a prazos e próxima ação de cada cliente final atribuído.",
  "partner.registration.title": "Registro de oportunidades e contestações",
  "partner.registration.description":
    "Prazos de proteção, decisões, reivindicações concorrentes e desempates registrados por canal.",
  "partner.quotes.title": "Propostas de parceiros e revenda",
  "partner.quotes.description":
    "Os preços de transferência são privados; os documentos de revenda para clientes mostram apenas o preço que você definiu.",
  "partner.billing.title": "Faturamento consolidado",
  "partner.billing.description":
    "Uma fatura ao parceiro, agrupada por cliente final, com exposição agregada e sem contato comercial com o cliente final.",
  "partner.commissions.title": "Comissões e demonstrativos",
  "partner.commissions.description":
    "As comissões de indicação são calculadas sobre a receita líquida recebida; os demonstrativos descontam reembolsos, créditos e estornos por contestação.",
  "partner.renewals.title": "Renovações de parceiros",
  "partner.renewals.description":
    "Aja por cliente final antes do fim do aviso; a Fil One confirma a ação sem contatar comercialmente os clientes de revenda.",
  "partner.sandboxes.title": "Ambientes de teste para parceiros",
  "partner.sandboxes.description":
    "Ambientes gratuitos, limitados e temporários usam o mesmo fluxo de provisionamento de direitos.",
  "partner.brand.title": "Marca e domínios personalizados",
  "partner.brand.description":
    "Prepare marcas intercambiáveis, cores aprovadas, identidade das propostas e verificação de domínios sem alterar registros jurídicos.",
  "partner.marketplace.title": "Status do marketplace",
  "partner.marketplace.description":
    "Consulta de ofertas, compradores, execução e repasses dos marketplaces AWS, Azure e Google Cloud.",
  "partner.access.title": "Sem vínculo de parceiro na organização selecionada",
  "partner.access.description":
    "Este espaço abre para uma organização que você pode representar. Troque de organização ou peça a um administrador para adicionar seu vínculo.",
  "partner.access.action": "Trocar organização",
  "partner.detail.notFound.title":
    "Este registro de parceiro não está disponível",
  "partner.detail.notFound.description":
    "A referência é desconhecida ou está fora das suas contas autorizadas.",
  "partner.detail.notFound.action": "Voltar à lista",
  "partner.detail.notRecorded": "Não registrado",
  "partner.detail.reference": "Referência",
  "partner.detail.position": "Posição comercial",
  "partner.detail.milestone": "Próximo marco",
  "partner.detail.owner": "Responsável",
  "partner.detail.risk": "Risco comercial",
  "partner.detail.portfolio.eyebrow": "Registro comercial do cliente final",
  "partner.detail.portfolio.term": "Serviço e prazo comercial",
  "partner.detail.term.unavailable.title":
    "Nenhum prazo de serviço registrado para este cliente final",
  "partner.detail.term.unavailable.description":
    "O prazo decorrido, o aviso e a data final aparecerão quando um pedido ou acordo os publicar.",
  "partner.detail.transfer.description":
    "Custo privado da Fil One neste canal, retornado pela tabela aprovada e nunca mostrado ao cliente final.",
  "partner.detail.resale.description":
    "Preço definido pelo parceiro e apresentado ao cliente final indicado.",
  "partner.detail.merchant.description":
    "A parte que contrata e fatura o cliente final neste canal.",
  "partner.detail.quote.eyebrow": "Proposta de revenda do parceiro",
  "partner.detail.quote.boundary": "Separação de preços da proposta",
  "partner.detail.quote.actions": "Ações válidas para esta proposta",
  "partner.detail.quote.edit": "Editar rascunho",
  "partner.detail.quote.revise": "Criar revisão",
  "partner.detail.quote.issue.title": "A emissão está condicionada",
  "partner.detail.quote.issue.description":
    "A equipe de operações de canais deve preparar documentos separados para o cliente e o parceiro antes de emitir esta cotação. Entre em contato com o suporte a parceiros para continuar.",
  "partner.detail.quote.cancel.title":
    "O cancelamento não está disponível aqui",
  "partner.detail.quote.cancel.description":
    "O cancelamento de propostas de parceiros é tratado pelas operações de canal. Contate a equipe para cancelar esta proposta.",
  "partner.detail.quote.download.title": "O download depende do provedor",
  "partner.detail.quote.download.description":
    "O link imutável aparece quando o serviço documental retorna um documento retido e visível ao parceiro.",
  "partner.detail.projection.record": "ID do registro",
  "partner.detail.projection.version": "Versão do registro",
  "partner.quote.new.disabled.unconfirmed":
    "Confirme a revisão acima para criar o rascunho com preço.",
  "partner.quote.new.disabled.created":
    "O rascunho com preço foi criado. Abra-o na lista de propostas para continuar.",
  "partner.quote.new.success":
    "O rascunho com preço foi criado. Abra-o para revisar os preços salvos e os próximos passos.",
  "partner.quote.new.failure": "Não foi possível criar a proposta.",
  "support.title": "Consulta de suporte",
  "support.description":
    "Tickets desta conta em modo somente leitura. Continue usando o canal de suporte existente para novas solicitações.",
  "internal.eyebrow": "Administração interna",
  "internal.title": "Operações comerciais",
  "internal.description":
    "Um registro operacional para contas, exceções, aprovações, recuperações, renovações e conciliação.",
  "internal.search.title": "Busca global",
  "internal.search.description":
    "Encontre contas e registros operacionais agrupados por tipo.",
  "internal.assisted.title": "Execução assistida",
  "internal.assisted.description":
    "Execute ações de clientes ou parceiros com motivo, identidade do ator preservada e o mesmo fluxo contratual.",
  "internal.queues.title": "Filas de exceções e aprovações",
  "internal.queues.description":
    "Preços, jurídico, crédito, verificações, contestações, registros, POCs, ações destrutivas e migrações com responsáveis titulares e suplentes.",
  "internal.priceBooks.title": "Administração de tabelas de preços",
  "internal.priceBooks.description":
    "Tarifas em USD, EUR e GBP com vigência, faixas de transferência, códigos fiscais, excedentes e margens mínimas.",
  "internal.agreements.title":
    "Administração de acordos e contratos de clientes",
  "internal.agreements.description":
    "Modelos aprovados pelo jurídico, contratos de clientes, negociações, termos essenciais, provas de formalização e versões imutáveis.",
  "internal.provisioning.title": "Recuperação de provisionamento",
  "internal.provisioning.description":
    "Inspecione tentativas persistentes, classifique falhas e reexecute com segurança usando a chave de idempotência original.",
  "internal.collections.title": "Cobranças e contestações",
  "internal.collections.description":
    "Cobranças por prazo, antiguidade, suspensão com retenção, prazos de evidências, créditos, reembolsos e estornos por contestação.",
  "internal.renewals.title": "Central de renovações",
  "internal.renewals.description":
    "Exposição em 30, 60–90 e 180 dias de contratos diretos, originados por parceiros e acordos de parceiros.",
  "internal.reports.title": "Relatórios e conciliação",
  "internal.reports.description":
    "Previsão, capacidade, cancelamentos, canal, funil, margem e conciliação tripla com exportações rastreáveis.",
  "internal.migrations.title": "Revisão de migrações",
  "internal.migrations.description":
    "Resolva correspondências ambíguas de contas antes de criar registros ou solicitar aceitação.",
  "internal.gates.title": "Status dos pré-requisitos externos",
  "internal.gates.description":
    "Evidências de ativação para credenciais, jurídico, comércio, impostos, provedores, provisionamento, domínios, marca, aprovadores e desativação.",
  "signing.eyebrow": "Formalização segura",
  "signing.title": "Revisar e assinar",
  "signing.description":
    "Sua posição é preservada enquanto o provedor de assinatura abre. Nenhum acordo fica ativo antes do retorno e da verificação da conclusão.",
  "signing.redirect": "Continuar para assinatura segura",
  "signing.embedded": "Assinatura integrada",
  "signing.loading":
    "Preparando a sessão de assinatura e conferindo a versão exata do documento.",
  "signing.failed":
    "O provedor de assinatura não respondeu. Seu acordo permanece inalterado.",
  "signing.recover": "Reconectar à assinatura",
  "signing.returned":
    "Assinatura verificada. O documento firmado e o certificado de conclusão estão no registro do acordo.",
  "signing.unverified":
    "O retorno não corresponde ao envelope e ao hash esperados. O acordo permanece inalterado.",
  "states.eyebrow": "Experiência resiliente",
  "states.title": "Cada estado tem um próximo passo seguro",
  "states.description":
    "Respostas para latência, ausência, dados parciais, alterações otimistas, validação, acesso, concorrência, conexão e falhas de provedores.",
  "state.loading.title": "Preparando a visualização da conta",
  "state.loading.description":
    "Prazos contratuais e registros financeiros chegam separadamente; as seções disponíveis aparecem primeiro.",
  "state.empty.title": "Nenhum registro ainda",
  "state.empty.description":
    "Comece com uma proposta. Todo o resto parte dela.",
  "state.partial.title": "Dados de uso temporariamente atrasados",
  "state.partial.description":
    "Os registros comerciais estão atualizados até 16:00 UTC. O uso será preenchido sem alterar os totais.",
  "state.success.title": "O registro está completo",
  "state.success.description":
    "O documento imutável, o evento de auditoria e a notificação foram criados juntos.",
  "state.validation.title": "Revise o valor destacado",
  "state.validation.description":
    "A capacidade contratada deve atingir o mínimo da oferta selecionada.",
  "state.stale.title": "Há uma versão mais recente",
  "state.stale.description":
    "Seu rascunho está preservado. Revise a versão mais recente antes de aplicar novamente.",
  "state.recoverable.title": "O provedor precisa de outra tentativa",
  "state.recoverable.description":
    "Nenhuma ação duplicada foi criada. A nova tentativa usa a chave de idempotência original.",
  "state.notFound.title": "Esta página não está disponível",
  "state.notFound.description":
    "O endereço pode ter mudado ou o registro pode não estar mais visível nesta conta.",
  "state.fatal.title": "Esta ação não pode continuar",
  "state.fatal.description":
    "Recarregue para conferir o registro atual antes de tentar novamente. Se persistir, contate o suporte com o ID da solicitação.",
  "detail.eyebrow": "Registro documental",
  "detail.description":
    "Identificadores, referências aplicáveis, evidências, documentos e eventos de auditoria desta versão imutável.",
  "detail.provenance": "Origem do registro",
  "detail.upstream": "Documento de origem",
  "detail.version": "Versão comercial",
  "detail.hash": "Hash do conteúdo",
  "detail.documents": "Documentos relacionados",
  "detail.audit": "Histórico de auditoria",
  "chart.usage": "Capacidade armazenada nos últimos seis meses",
  "chart.spend": "Gastos faturados nos últimos seis meses",
  "chart.capacity": "Capacidade contratada e provisionada por região",
  "chart.axis.month": "Mês",
  "chart.axis.value": "Valor",
  "term.annual": "Serviço anual contratado",
  "term.partner": "Acordo de parceiro Meridian",
  "term.rollup": "Resumo dos prazos da conta",
  "term.count.one": "{count} prazo ativo",
  "term.count.other": "{count} prazos ativos",
  "term.next": "Próxima data final",
  "term.none": "Nenhum prazo ativo",
  "term.archive": "Arquivo principal",
  "term.replica": "Réplica de conformidade de Madri",
  "states.optimistic.title": "Alteração exibida enquanto é verificada",
  "states.optimistic.description":
    "Se o contrato rejeitar, o valor anterior será restaurado e o foco irá para a explicação.",
  "states.offline.title": "Salvo para reconexão",
  "states.offline.description":
    "Os registros somente leitura continuam disponíveis; nenhuma ação financeira ou contratual é considerada concluída.",
  "format.tax.us": "Imposto sobre vendas",
  "format.tax.eu": "IVA",
  "format.tax.uk": "IVA",
  "projection.action.readOnly":
    "Somente leitura. Um proprietário da conta ou o aprovador designado pode agir neste registro.",
  "projection.action.pending": "Enviando…",
  "projection.action.submitting": "Enviando {action} à API comercial.",
  "projection.action.queued":
    "{action} está na fila. Aguardando o resultado oficial.",
  "projection.action.applied":
    "Ação aplicada: {action}. Versão oficial: {version}.",
  "projection.action.appliedUnknownVersion":
    "Ação aplicada: {action}. A versão oficial não foi retornada.",
  "projection.action.rejected":
    "{action} não foi aplicado. A API comercial retornou {status}: {code}.",
  "projection.action.timeout":
    "{action} ainda está em andamento. O resultado não foi confirmado e o registro pode mudar.",
  "projection.action.rechecking": "Verificando o resultado de {action}.",
  "projection.action.recheck": "Verificar resultado novamente",
  "projection.action.conflict":
    "O registro mudou. Atualize antes de tentar novamente.",
  "projection.action.confirm.title": "{action}?",
  "projection.action.confirm.description":
    "Aplica-se a {record} na versão {version}.",
  "projection.action.confirm.detail":
    "O comando atua no registro oficial e é registrado na auditoria. Revertê-lo exige outra ação autorizada.",
  "projection.action.confirm.cancel": "Manter registro inalterado",
  "projection.action.accept": "Aceitar",
  "projection.action.addContact": "Adicionar contato",
  "projection.action.addRole": "Adicionar papel",
  "projection.action.applyAmendment": "Aplicar aditivo",
  "projection.action.approveException": "Aprovar exceção",
  "projection.action.consolidate": "Consolidar faturas",
  "projection.action.create": "Criar registro",
  "projection.action.evaluateDunning": "Avaliar cobrança",
  "projection.action.executeAgreement": "Aceitar e firmar",
  "projection.action.expire": "Expirar agora",
  "projection.action.issue": "Emitir",
  "projection.action.markUncollectible": "Marcar como incobrável",
  "projection.action.openInvoice": "Abrir fatura",
  "projection.action.pay": "Registrar pagamento",
  "projection.action.prepareArtifact": "Preparar documento",
  "projection.action.convertPoc": "Converter em proposta paga",
  "projection.action.price": "Calcular preço da proposta",
  "projection.action.rejectException": "Rejeitar exceção",
  "projection.action.requestTeardown": "Solicitar desativação",
  "projection.action.requestRenewal": "Solicitar renovação",
  "projection.action.revise": "Criar revisão",
  "projection.action.setPartnerCredit": "Definir crédito do parceiro",
  "projection.action.setPaymentTerms": "Definir condições de pagamento",
  "projection.action.update": "Atualizar detalhes",
  "projection.action.void": "Anular fatura",
  "signing.agreementId": "ID do acordo",
  "signing.agreementReference": "Referência do acordo",
  "signing.serverSelected":
    "O servidor seleciona sua conta, a identidade do signatário e o documento imutável a partir deste acordo salvo.",
  "signing.startEmbedded": "Iniciar assinatura integrada",
  "signing.accepted":
    "Envelope aceito. O acordo permanece inativo até a verificação do retorno assinado do provedor.",
  "signing.continue": "Continuar para o provedor de assinatura aprovado",
  "signing.frame": "Provedor seguro de assinatura eletrônica",
  "signing.checking": "Verificando o status salvo do envelope…",
  "signing.download": "Baixar acordo assinado",
  "signing.pending.title": "Assinatura pendente",
  "signing.pending.description":
    "O provedor ainda não confirmou a conclusão da assinatura.",
  "signing.refresh": "Atualizar status",
  "signing.declined.title": "Assinatura recusada",
  "signing.expired.title": "Sessão de assinatura expirada",
  "signing.unchanged":
    "O acordo permanece inalterado. Abra o registro para revisar os próximos passos.",
  "signing.agreements": "Voltar aos acordos",
  "signing.missingState":
    "O retorno da assinatura não contém uma referência de estado oficial.",
  "signing.unverifiable":
    "O servidor não conseguiu verificar o estado da assinatura.",
  "signing.requestFailed":
    "A solicitação de assinatura falhou. O acordo permanece inalterado.",
  "signing.choose.title": "Escolha um acordo primeiro",
  "signing.choose.description":
    "A assinatura começa em um acordo autorizado para o servidor selecionar a versão exata do documento.",
  "signing.demo.eyebrow": "Serviço de assinatura de demonstração",
  "signing.demo.title": "Assinar documento",
  "signing.demo.description":
    "Simula o provedor de assinatura. Assinar conclui o envelope e retorna ao Fil One, onde ocorre a conciliação real do retorno.",
  "signing.demo.document": "Documento",
  "signing.demo.signer": "Signatário",
  "signing.demo.envelope": "Envelope",
  "signing.demo.action": "Assinar documento",
  "signing.demo.unavailable.title":
    "Esta sessão de assinatura não está disponível",
  "signing.demo.unavailable.description":
    "O estado da assinatura é desconhecido ou expirou. Recomece pelo registro do acordo.",
  "workflow.confirm.title": "Confirme esta decisão",
  "workflow.confirm.description":
    "Esta decisão é registrada com os identificadores acima.",
  "workflow.confirm.detail":
    "Confira identificadores, motivo e referência de evidências. Uma recusa, rejeição ou solicitação de desativação encerra o caminho comercial atual; apenas uma nova decisão o reabre.",
  "workflow.confirm.cancel": "Manter registro inalterado",
  "workflow.confirm.action": "Confirmar e enviar",
} satisfies MessageCatalog;

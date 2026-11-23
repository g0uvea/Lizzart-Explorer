import type { AppLanguage } from '$lib/types';

export interface LanguageOption {
	code: AppLanguage;
	name: string;
	nativeName: string;
}

export interface CountryOption {
	code: string;
	name: Record<AppLanguage, string>;
}

export const SUPPORTED_LANGUAGES: LanguageOption[] = [
	{ code: 'en', name: 'English', nativeName: 'English' },
	{ code: 'pt', name: 'Portuguese', nativeName: 'Português' },
	{ code: 'es', name: 'Spanish', nativeName: 'Español' }
];

// Country list (strictly countries, no states/sub-regions)
export const SUPPORTED_COUNTRIES: CountryOption[] = [
	{ code: 'US', name: { en: 'United States', pt: 'Estados Unidos', es: 'Estados Unidos' } },
	{ code: 'BR', name: { en: 'Brazil', pt: 'Brasil', es: 'Brasil' } },
	{ code: 'PT', name: { en: 'Portugal', pt: 'Portugal', es: 'Portugal' } },
	{ code: 'CA', name: { en: 'Canada', pt: 'Canadá', es: 'Canadá' } },
	{ code: 'GB', name: { en: 'United Kingdom', pt: 'Reino Unido', es: 'Reino Unido' } },
	{ code: 'DE', name: { en: 'Germany', pt: 'Alemanha', es: 'Alemania' } },
	{ code: 'FR', name: { en: 'France', pt: 'França', es: 'Francia' } },
	{ code: 'ES', name: { en: 'Spain', pt: 'Espanha', es: 'España' } },
	{ code: 'IT', name: { en: 'Italy', pt: 'Itália', es: 'Italia' } },
	{ code: 'NL', name: { en: 'Netherlands', pt: 'Países Baixos', es: 'Países Bajos' } },
	{ code: 'CH', name: { en: 'Switzerland', pt: 'Suíça', es: 'Suiza' } },
	{ code: 'SE', name: { en: 'Sweden', pt: 'Suécia', es: 'Suecia' } },
	{ code: 'NO', name: { en: 'Norway', pt: 'Noruega', es: 'Noruega' } },
	{ code: 'PL', name: { en: 'Poland', pt: 'Polônia', es: 'Polonia' } },
	{ code: 'IE', name: { en: 'Ireland', pt: 'Irlanda', es: 'Irlanda' } },
	{ code: 'MX', name: { en: 'Mexico', pt: 'México', es: 'México' } },
	{ code: 'AR', name: { en: 'Argentina', pt: 'Argentina', es: 'Argentina' } },
	{ code: 'CL', name: { en: 'Chile', pt: 'Chile', es: 'Chile' } },
	{ code: 'CO', name: { en: 'Colombia', pt: 'Colômbia', es: 'Colombia' } },
	{ code: 'PE', name: { en: 'Peru', pt: 'Peru', es: 'Perú' } },
	{ code: 'UY', name: { en: 'Uruguay', pt: 'Uruguai', es: 'Uruguay' } },
	{ code: 'JP', name: { en: 'Japan', pt: 'Japão', es: 'Japón' } },
	{ code: 'KR', name: { en: 'South Korea', pt: 'Coreia do Sul', es: 'Corea del Sur' } },
	{ code: 'SG', name: { en: 'Singapore', pt: 'Singapura', es: 'Singapur' } },
	{ code: 'IN', name: { en: 'India', pt: 'Índia', es: 'India' } },
	{ code: 'AU', name: { en: 'Australia', pt: 'Austrália', es: 'Australia' } },
	{ code: 'NZ', name: { en: 'New Zealand', pt: 'Nova Zelândia', es: 'Nueva Zelanda' } },
	{ code: 'ZA', name: { en: 'South Africa', pt: 'África do Sul', es: 'Sudáfrica' } },
	{ code: 'AE', name: { en: 'United Arab Emirates', pt: 'Emirados Árabes Unidos', es: 'Emiratos Árabes Unidos' } },
	{ code: 'AO', name: { en: 'Angola', pt: 'Angola', es: 'Angola' } },
	{ code: 'MZ', name: { en: 'Mozambique', pt: 'Moçambique', es: 'Mozambique' } }
];

const DICTIONARY = {
	en: {
		// Setup
		'setup.badge': 'First Initialization',
		'setup.title': 'Create Administrator Account',
		'setup.subtitle':
			'No administrator account was found in MariaDB. Configure the primary administrator and base Language & Country for the application.',
		'setup.username_label': 'Username (immutable once created)',
		'setup.username_hint': 'Use only lowercase letters, numbers, dot, hyphen or underscore.',
		'setup.first_name': 'First Name',
		'setup.last_name': 'Last Name',
		'setup.password': 'Password',
		'setup.password_placeholder': 'Min. 8 characters',
		'setup.confirm_password': 'Confirm Password',
		'setup.confirm_placeholder': 'Repeat password',
		'setup.language': 'Base Application Language',
		'setup.country': 'Country',
		'setup.locale_hint':
			'This sets the initial language and country for all users (each user can customize theirs later).',
		'setup.info_banner':
			'Initial Administrator account (no workspace attached yet). Create and connect workspaces in the Admin Panel.',
		'setup.submit': 'Complete Setup & Sign In',
		'setup.submitting': 'Configuring...',
		'setup.password_mismatch': 'Passwords do not match.',

		// Login
		'login.subtitle': 'Private cloud storage & workspaces',
		'login.username': 'Username',
		'login.password': 'Password',
		'login.submit': 'Access Cloud',
		'login.submitting': 'Verifying...',
		'login.confirm_2fa': 'Confirm 2FA Code',
		'login.2fa_title': 'Two-Factor Verification (2FA)',
		'login.2fa_subtitle': 'Enter the 6-digit code from your authenticator app for',
		'login.2fa_code': '6-Digit Code',
		'login.back': '← Back to username and password',
		'login.security_footer': 'Protected by EdDSA (Ed25519), Argon2id, AES-256-GCM and anti-reuse rotation.',

		// Sidebar & Layout
		'nav.storage': 'Storage',
		'nav.files': 'Files',
		'nav.recent': 'Recent',
		'nav.starred': 'Starred',
		'nav.shared': 'Shared',
		'nav.trash': 'Trash',
		'nav.apps_section': 'Apps',
		'nav.notes': 'Notes',
		'nav.admin_section': 'Administration & Infra',
		'nav.admin_panel': 'Admin Panel',
		'nav.plugins': 'Plugins',
		'nav.mc_servers': 'MC Servers',
		'nav.preferences': 'Preferences',
		'nav.settings': 'Settings',
		'nav.your_workspaces': 'Your Workspaces',
		'nav.manage_workspaces': 'Manage Workspaces',
		'nav.no_workspace': 'No workspace',
		'nav.create_connect_admin': 'Create / Connect in Admin',
		'nav.waiting_admin': 'Awaiting assignment by Admin',
		'nav.quota_by_ws': 'Quota managed per Workspace',
		'nav.of': 'of',
		'nav.sign_out': 'Sign Out',
		'role.manager': 'Manager',
		'role.editor': 'Editor',
		'role.viewer': 'Viewer',
		'role.admin': 'Administrator',
		'role.user': 'User',

		// Plugins
		'plugins.title': 'Plugins & Extensions',
		'plugins.subtitle': 'Install or remove user applications (Apps) and internal administration modules.',
		'plugins.filter_all': 'All Plugins',
		'plugins.installed': 'Installed',
		'plugins.not_installed': 'Not Installed',
		'plugins.install': 'Install Plugin',
		'plugins.uninstall': 'Uninstall',
		'plugins.open_app': 'Open Module',
		'plugins.notes_title': 'Personal Notes',
		'plugins.notes_desc':
			'Simplified Notion/Obsidian-style Markdown workspace. Notes live inside each workspace but are strictly private to their creator (invisible in the Files tab) unless explicitly shared via user permission or public link.',
		'plugins.mc_title': 'MC Servers',
		'plugins.mc_desc':
			'Internal administrative shell for managing Minecraft server instances, live console, player permissions, and server files.',
		'plugins.access_all_users': 'Available to all workspace users',
		'plugins.access_admin_only': 'Restricted to Administrators only',
		'plugins.isolated_per_ws': 'Isolated per user & workspace',
		'plugins.install_hint_apps': 'Appears under the "Apps" section in the sidebar',
		'plugins.install_hint_admin': 'Appears under "Administration & Infra" for admins',

		// Notes App
		'notes.new_note': 'New Note',
		'notes.new_short': 'New',
		'notes.search_placeholder': 'Search notes in this workspace...',
		'notes.my_notes': 'My Notes',
		'notes.empty_title': 'No personal notes yet',
		'notes.empty_subtitle': 'Your Markdown notes live in this workspace and are visible only to you.',
		'notes.privacy_badge': 'Private to you • Hidden from Files tab',
		'notes.select_or_create': 'Select or create a Markdown note',
		'notes.isolated_explanation':
			'Each note is saved as a .md file inside the active workspace, visible only to you unless you share it.',
		'notes.share': 'Share',
		'notes.save': 'Save',
		'notes.saved': 'Saved',

		// Explorer
		'explorer.no_ws_title': 'No Workspace Connected',
		'explorer.no_ws_admin':
			'Accounts and Workspaces are independent. Create a dedicated workspace and connect your account (or your team) via the Admin Panel.',
		'explorer.no_ws_user':
			'Your account has not been linked to any workspace yet. Ask an administrator to connect you to a workspace.',
		'explorer.open_admin': 'Open Admin Panel',
		'explorer.view_shared': 'View Shared With Me',
		'explorer.search_placeholder': 'Search in current view...',
		'explorer.new_folder': 'New Folder',
		'explorer.upload': 'Upload',
		'explorer.empty_trash': 'Empty Trash',
		'explorer.empty_folder': 'This folder is empty',
		'explorer.name': 'Name',
		'explorer.size': 'Size',
		'explorer.modified': 'Modified',
		'explorer.actions': 'Actions',
		'explorer.unlimited': 'Unlimited',

		// Profile / Settings
		'profile.title': 'Settings',
		'profile.subtitle': 'Manage your account details, 2FA security, language, country, and system appearance.',
		'profile.tab_account': 'Account & Locale',
		'profile.tab_appearance': 'Appearance',
		'profile.connected_workspaces': 'Connected Workspaces',
		'profile.member_since': 'Member since',
		'profile.remove_photo': 'Remove photo',
		'profile.account_data': 'Account & Regional Preferences',
		'profile.username_immutable': 'Username (immutable)',
		'profile.first_name': 'First Name',
		'profile.last_name': 'Last Name',
		'profile.language': 'Language',
		'profile.country': 'Country',
		'profile.profile_photo': 'Profile Photo',
		'profile.upload_new_image': 'Upload New Image',
		'profile.uploading': 'Uploading...',
		'profile.save_account': 'Save Account & Locale',
		'profile.saving': 'Saving...',
		'profile.change_password': 'Change Password',
		'profile.current_password': 'Current password',
		'profile.new_password': 'New password (min. 8)',
		'profile.confirm_password': 'Confirm password',
		'profile.update_password': 'Update Password'
	},
	pt: {
		// Setup
		'setup.badge': 'Primeira Inicialização',
		'setup.title': 'Criar Conta Administradora',
		'setup.subtitle':
			'Nenhuma conta administradora foi encontrada no banco MariaDB. Configure o administrador principal e o Idioma e País base da aplicação.',
		'setup.username_label': 'Usuário (imutável após criado)',
		'setup.username_hint': 'Use apenas letras minúsculas, números, ponto, hífen ou underline.',
		'setup.first_name': 'Nome',
		'setup.last_name': 'Sobrenome',
		'setup.password': 'Senha',
		'setup.password_placeholder': 'Mín. 8 caracteres',
		'setup.confirm_password': 'Confirmar Senha',
		'setup.confirm_placeholder': 'Repita a senha',
		'setup.language': 'Idioma Base da Aplicação',
		'setup.country': 'País',
		'setup.locale_hint':
			'Define o idioma e país iniciais para todos os usuários (cada usuário poderá alterar o seu depois).',
		'setup.info_banner':
			'Conta Administradora inicial (sem workspace vinculada). Crie e conecte workspaces pelo Painel Admin.',
		'setup.submit': 'Concluir Setup e Entrar',
		'setup.submitting': 'Configurando...',
		'setup.password_mismatch': 'As senhas não coincidem.',

		// Login
		'login.subtitle': 'Armazenamento em nuvem privado & workspaces',
		'login.username': 'Usuário',
		'login.password': 'Senha',
		'login.submit': 'Acessar Nuvem',
		'login.submitting': 'Verificando...',
		'login.confirm_2fa': 'Confirmar Código 2FA',
		'login.2fa_title': 'Verificação em 2 Etapas (2FA)',
		'login.2fa_subtitle': 'Digite o código de 6 dígitos do seu autenticador para',
		'login.2fa_code': 'Código de 6 dígitos',
		'login.back': '← Voltar para usuário e senha',
		'login.security_footer': 'Protegido por EdDSA (Ed25519), Argon2id, AES-256-GCM e rotação anti-reuso.',

		// Sidebar & Layout
		'nav.storage': 'Armazenamento',
		'nav.files': 'Arquivos',
		'nav.recent': 'Recentes',
		'nav.starred': 'Favoritos',
		'nav.shared': 'Compartilhados',
		'nav.trash': 'Lixeira',
		'nav.apps_section': 'Apps',
		'nav.notes': 'Anotações',
		'nav.admin_section': 'Administração & Infra',
		'nav.admin_panel': 'Painel Admin',
		'nav.plugins': 'Plugins',
		'nav.mc_servers': 'Servidores MC',
		'nav.preferences': 'Preferências',
		'nav.settings': 'Configurações',
		'nav.your_workspaces': 'Suas Workspaces',
		'nav.manage_workspaces': 'Gerenciar Workspaces',
		'nav.no_workspace': 'Nenhuma workspace',
		'nav.create_connect_admin': 'Criar / Conectar no Admin',
		'nav.waiting_admin': 'Aguardando vínculo pelo Admin',
		'nav.quota_by_ws': 'Cota gerenciada por Workspace',
		'nav.of': 'de',
		'nav.sign_out': 'Sair',
		'role.manager': 'Gestor',
		'role.editor': 'Editor',
		'role.viewer': 'Leitor',
		'role.admin': 'Administrador',
		'role.user': 'Usuário',

		// Plugins
		'plugins.title': 'Central de Plugins',
		'plugins.subtitle': 'Instale ou remova aplicativos de uso geral (Apps) e módulos internos de administração.',
		'plugins.filter_all': 'Todos os Plugins',
		'plugins.installed': 'Instalado',
		'plugins.not_installed': 'Não instalado',
		'plugins.install': 'Instalar Plugin',
		'plugins.uninstall': 'Desinstalar',
		'plugins.open_app': 'Abrir Módulo',
		'plugins.notes_title': 'Anotações Pessoais',
		'plugins.notes_desc':
			'App de anotações pessoais em Markdown estilo Notion/Obsidian simplificado. Os arquivos .md vivem na workspace atual, mas ficam ocultos da aba Arquivos e visíveis somente para o próprio usuário, a menos que ele compartilhe.',
		'plugins.mc_title': 'Servidores MC',
		'plugins.mc_desc':
			'Módulo administrativo interno para gerenciamento de instâncias Minecraft, console em tempo real, permissões e arquivos.',
		'plugins.access_all_users': 'Disponível para todos os usuários',
		'plugins.access_admin_only': 'Acesso exclusivo para Administradores',
		'plugins.isolated_per_ws': 'Isolado por usuário & workspace',
		'plugins.install_hint_apps': 'Adiciona à categoria "Apps" na barra lateral',
		'plugins.install_hint_admin': 'Adiciona em "Administração & Infra" para admins',

		// Notes App
		'notes.new_note': 'Nova Anotação',
		'notes.new_short': 'Nova',
		'notes.search_placeholder': 'Buscar anotações nesta workspace...',
		'notes.my_notes': 'Minhas Notas',
		'notes.empty_title': 'Nenhuma anotação pessoal',
		'notes.empty_subtitle': 'Suas notas em Markdown vivem nesta workspace e são visíveis só para você.',
		'notes.privacy_badge': 'Visível só para você • Oculto de Arquivos',
		'notes.select_or_create': 'Selecione ou crie uma anotação em Markdown',
		'notes.isolated_explanation':
			'Cada anotação é um arquivo .md salvo nesta workspace, visível apenas para você (a menos que você compartilhe ou gere um link público).',
		'notes.share': 'Compartilhar',
		'notes.save': 'Salvar',
		'notes.saved': 'Salvo',

		// Explorer
		'explorer.no_ws_title': 'Nenhuma Workspace Conectada',
		'explorer.no_ws_admin':
			'Contas e Workspaces são independentes. Crie uma workspace com cota dedicada e conecte sua conta (ou sua equipe) pelo Painel Admin.',
		'explorer.no_ws_user':
			'Sua conta ainda não foi vinculada a nenhuma workspace. Peça a um administrador para conectá-lo a uma workspace.',
		'explorer.open_admin': 'Abrir Painel Admin',
		'explorer.view_shared': 'Ver Compartilhados Comigo',
		'explorer.search_placeholder': 'Buscar na visualização atual...',
		'explorer.new_folder': 'Nova Pasta',
		'explorer.upload': 'Enviar',
		'explorer.empty_trash': 'Esvaziar Lixeira',
		'explorer.empty_folder': 'Esta pasta está vazia',
		'explorer.name': 'Nome',
		'explorer.size': 'Tamanho',
		'explorer.modified': 'Modificado',
		'explorer.actions': 'Ações',
		'explorer.unlimited': 'Ilimitado',

		// Profile / Settings
		'profile.title': 'Configurações',
		'profile.subtitle': 'Gerencie os dados da sua conta, segurança 2FA, idioma, país e aparência do sistema.',
		'profile.tab_account': 'Conta & Idioma',
		'profile.tab_appearance': 'Aparência',
		'profile.connected_workspaces': 'Workspaces Conectadas',
		'profile.member_since': 'Membro desde',
		'profile.remove_photo': 'Remover foto',
		'profile.account_data': 'Dados da Conta & Idioma/País',
		'profile.username_immutable': 'Usuário (imutável)',
		'profile.first_name': 'Nome',
		'profile.last_name': 'Sobrenome',
		'profile.language': 'Idioma',
		'profile.country': 'País',
		'profile.profile_photo': 'Foto de Perfil',
		'profile.upload_new_image': 'Enviar Nova Imagem',
		'profile.uploading': 'Enviando...',
		'profile.save_account': 'Salvar Dados e Idioma',
		'profile.saving': 'Salvando...',
		'profile.change_password': 'Alterar Senha',
		'profile.current_password': 'Senha atual',
		'profile.new_password': 'Nova senha (mín. 8)',
		'profile.confirm_password': 'Confirmar senha',
		'profile.update_password': 'Atualizar Senha'
	},
	es: {
		// Setup
		'setup.badge': 'Primera Inicialización',
		'setup.title': 'Crear Cuenta Administradora',
		'setup.subtitle':
			'No se encontró ninguna cuenta administradora en MariaDB. Configure el administrador principal y el Idioma y País base de la aplicación.',
		'setup.username_label': 'Usuario (inmutable después de creado)',
		'setup.username_hint': 'Use solo letras minúsculas, números, punto, guión o guión bajo.',
		'setup.first_name': 'Nombre',
		'setup.last_name': 'Apellido',
		'setup.password': 'Contraseña',
		'setup.password_placeholder': 'Mín. 8 caracteres',
		'setup.confirm_password': 'Confirmar Contraseña',
		'setup.confirm_placeholder': 'Repita la contraseña',
		'setup.language': 'Idioma Base de la Aplicación',
		'setup.country': 'País',
		'setup.locale_hint':
			'Define el idioma y país iniciales para todos los usuarios (cada usuario podrá cambiar el suyo después).',
		'setup.info_banner':
			'Cuenta Administradora inicial (sin workspace vinculada). Cree y conecte workspaces en el Panel Admin.',
		'setup.submit': 'Completar Configuración y Entrar',
		'setup.submitting': 'Configurando...',
		'setup.password_mismatch': 'Las contraseñas no coinciden.',

		// Login
		'login.subtitle': 'Almacenamiento privado en la nube y workspaces',
		'login.username': 'Usuario',
		'login.password': 'Contraseña',
		'login.submit': 'Acceder a la Nube',
		'login.submitting': 'Verificando...',
		'login.confirm_2fa': 'Confirmar Código 2FA',
		'login.2fa_title': 'Verificación en 2 Pasos (2FA)',
		'login.2fa_subtitle': 'Ingrese el código de 6 dígitos de su autenticador para',
		'login.2fa_code': 'Código de 6 dígitos',
		'login.back': '← Volver a usuario y contraseña',
		'login.security_footer': 'Protegido por EdDSA (Ed25519), Argon2id, AES-256-GCM y rotación anti-reuso.',

		// Sidebar & Layout
		'nav.storage': 'Almacenamiento',
		'nav.files': 'Archivos',
		'nav.recent': 'Recientes',
		'nav.starred': 'Favoritos',
		'nav.shared': 'Compartidos',
		'nav.trash': 'Papelera',
		'nav.apps_section': 'Apps',
		'nav.notes': 'Notas',
		'nav.admin_section': 'Administración e Infra',
		'nav.admin_panel': 'Panel Admin',
		'nav.plugins': 'Plugins',
		'nav.mc_servers': 'Servidores MC',
		'nav.preferences': 'Preferencias',
		'nav.settings': 'Configuración',
		'nav.your_workspaces': 'Tus Workspaces',
		'nav.manage_workspaces': 'Gestionar Workspaces',
		'nav.no_workspace': 'Ninguna workspace',
		'nav.create_connect_admin': 'Crear / Conectar en Admin',
		'nav.waiting_admin': 'Esperando asignación del Admin',
		'nav.quota_by_ws': 'Cuota gestionada por Workspace',
		'nav.of': 'de',
		'nav.sign_out': 'Salir',
		'role.manager': 'Gestor',
		'role.editor': 'Editor',
		'role.viewer': 'Lector',
		'role.admin': 'Administrador',
		'role.user': 'Usuario',

		// Plugins
		'plugins.title': 'Central de Plugins',
		'plugins.subtitle': 'Instale o elimine aplicaciones de uso general (Apps) y módulos internos de administración.',
		'plugins.filter_all': 'Todos los Plugins',
		'plugins.installed': 'Instalado',
		'plugins.not_installed': 'No instalado',
		'plugins.install': 'Instalar Plugin',
		'plugins.uninstall': 'Desinstalar',
		'plugins.open_app': 'Abrir Módulo',
		'plugins.notes_title': 'Notas Personales',
		'plugins.notes_desc':
			'Aplicación de notas personales en Markdown estilo Notion/Obsidian simplificado. Los archivos .md viven en la workspace actual, ocultos de la pestaña Archivos y visibles solo para su creador, a menos que se compartan.',
		'plugins.mc_title': 'Servidores MC',
		'plugins.mc_desc':
			'Módulo administrativo interno para gestionar instancias de Minecraft, consola en vivo, permisos y archivos.',
		'plugins.access_all_users': 'Disponible para todos los usuarios',
		'plugins.access_admin_only': 'Acceso exclusivo para Administradores',
		'plugins.isolated_per_ws': 'Aislado por usuario y workspace',
		'plugins.install_hint_apps': 'Se añade a la categoría "Apps" en la barra lateral',
		'plugins.install_hint_admin': 'Se añade en "Administración e Infra" para admins',

		// Notes App
		'notes.new_note': 'Nueva Nota',
		'notes.new_short': 'Nueva',
		'notes.search_placeholder': 'Buscar notas en esta workspace...',
		'notes.my_notes': 'Mis Notas',
		'notes.empty_title': 'Sin notas personales aún',
		'notes.empty_subtitle': 'Tus notas en Markdown viven en esta workspace y son visibles solo para ti.',
		'notes.privacy_badge': 'Visible solo para ti • Oculto de Archivos',
		'notes.select_or_create': 'Selecciona o crea una nota en Markdown',
		'notes.isolated_explanation':
			'Cada nota es un archivo .md guardado en esta workspace, visible solo para ti (a menos que la compartas o generes un enlace público).',
		'notes.share': 'Compartir',
		'notes.save': 'Guardar',
		'notes.saved': 'Guardado',

		// Explorer
		'explorer.no_ws_title': 'Ninguna Workspace Conectada',
		'explorer.no_ws_admin':
			'Las cuentas y Workspaces son independientes. Cree una workspace con cuota dedicada y conecte su cuenta (o su equipo) desde el Panel Admin.',
		'explorer.no_ws_user':
			'Su cuenta aún no ha sido vinculada a ninguna workspace. Pida a un administrador que lo conecte a una workspace.',
		'explorer.open_admin': 'Abrir Panel Admin',
		'explorer.view_shared': 'Ver Compartidos Conmigo',
		'explorer.search_placeholder': 'Buscar en la vista actual...',
		'explorer.new_folder': 'Nueva Carpeta',
		'explorer.upload': 'Subir',
		'explorer.empty_trash': 'Vaciar Papelera',
		'explorer.empty_folder': 'Esta carpeta está vacía',
		'explorer.name': 'Nombre',
		'explorer.size': 'Tamaño',
		'explorer.modified': 'Modificado',
		'explorer.actions': 'Acciones',
		'explorer.unlimited': 'Ilimitado',

		// Profile / Settings
		'profile.title': 'Configuración',
		'profile.subtitle': 'Gestione los datos de su cuenta, seguridad 2FA, idioma, país y apariencia del sistema.',
		'profile.tab_account': 'Cuenta e Idioma',
		'profile.tab_appearance': 'Apariencia',
		'profile.connected_workspaces': 'Workspaces Conectadas',
		'profile.member_since': 'Miembro desde',
		'profile.remove_photo': 'Eliminar foto',
		'profile.account_data': 'Datos de la Cuenta e Idioma/País',
		'profile.username_immutable': 'Usuario (inmutable)',
		'profile.first_name': 'Nombre',
		'profile.last_name': 'Apellido',
		'profile.language': 'Idioma',
		'profile.country': 'País',
		'profile.profile_photo': 'Foto de Perfil',
		'profile.upload_new_image': 'Subir Nueva Imagen',
		'profile.uploading': 'Subiendo...',
		'profile.save_account': 'Guardar Datos e Idioma',
		'profile.saving': 'Guardando...',
		'profile.change_password': 'Cambiar Contraseña',
		'profile.current_password': 'Contraseña actual',
		'profile.new_password': 'Nueva contraseña (mín. 8)',
		'profile.confirm_password': 'Confirmar contraseña',
		'profile.update_password': 'Actualizar Contraseña'
	}
} as const;

export type TranslationKey = keyof (typeof DICTIONARY)['en'];

class I18nStore {
	language = $state<AppLanguage>('en');
	country = $state<string>('US');

	init(lang?: AppLanguage | null, countryCode?: string | null) {
		const nextLang: AppLanguage =
			lang === 'en' || lang === 'pt' || lang === 'es' ? lang : this.language;
		const nextCountry =
			countryCode && countryCode.length === 2 ? countryCode.toUpperCase() : this.country;

		if (this.language !== nextLang) {
			this.language = nextLang;
		}
		if (this.country !== nextCountry) {
			this.country = nextCountry;
		}
		const tag = `${nextLang}-${nextCountry}`;
		if (typeof document !== 'undefined' && document.documentElement.lang !== tag) {
			document.documentElement.lang = tag;
		}
	}

	setLocale(lang: AppLanguage, countryCode?: string) {
		const nextCountry =
			countryCode && countryCode.length === 2 ? countryCode.toUpperCase() : this.country;
		if (this.language !== lang) {
			this.language = lang;
		}
		if (this.country !== nextCountry) {
			this.country = nextCountry;
		}
		const tag = `${lang}-${nextCountry}`;
		if (typeof document !== 'undefined' && document.documentElement.lang !== tag) {
			document.documentElement.lang = tag;
		}
	}

	get bcp47(): string {
		return `${this.language}-${this.country}`;
	}

	t(key: TranslationKey): string {
		return DICTIONARY[this.language]?.[key] ?? DICTIONARY.en[key] ?? key;
	}

	countryName(code: string): string {
		const found = SUPPORTED_COUNTRIES.find((c) => c.code === code.toUpperCase());
		if (!found) return code.toUpperCase();
		return found.name[this.language] || found.name.en;
	}
}

export const i18n = new I18nStore();

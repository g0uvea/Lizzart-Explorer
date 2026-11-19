import { ensureDatabaseReady, getPool } from './index';

async function main() {
	console.log('[Lizzart Explorer] Inicializando banco MariaDB...');
	await ensureDatabaseReady();
	console.log('[Lizzart Explorer] Banco de dados pronto e populado!');
	await getPool().end();
}

main().catch((err) => {
	console.error('[Lizzart Explorer] Falha ao inicializar MariaDB:', err);
	process.exit(1);
});

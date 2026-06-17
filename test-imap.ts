// test-imap.ts
import { ImapFlow } from 'imapflow';
import dotenv from 'dotenv';

// Carrega as variáveis do .env
dotenv.config();

const client = new ImapFlow({
  host: process.env.IMAP_HOST!,
  port: Number(process.env.IMAP_PORT),
  secure: true,
  auth: {
    user: process.env.IMAP_USER!,
    pass: process.env.IMAP_PASS!,
  },
  // Configuração TLS: usa a flag global --use-system-ca se definida
  // ou utiliza o certificate store do Windows por padrão
  tls: {
    // Se a flag --use-system-ca estiver ativa, o Node já usará o store do Windows.
    // Portanto, podemos deixar rejectUnauthorized como true (padrão).
    // Se quiser forçar o uso do sistema, pode definir:
    // rejectUnauthorized: true,
  },
});

async function testConnection() {
  try {
    console.log('🔌 Conectando ao servidor IMAP...');
    await client.connect();
    console.log('✅ Conectado com sucesso!');

    // Lista as caixas de correio (opcional)
    const mailboxes = await client.list();
    console.log(`📬 Caixas de correio encontradas: ${mailboxes.length}`);
    mailboxes.slice(0, 5).forEach((mb) => {
      console.log(`  - ${mb.name} (${Array.from(mb.flags).join(', ')})`);
    });

    await client.close();
    console.log('🔒 Conexão fechada.');
  } catch (err) {
    console.error('❌ Erro na conexão IMAP:', err);
    process.exitCode = 1;
  }
}

testConnection();
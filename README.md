# Match-3 com Pagamento Pix (Mercado Pago)

Jogo Match-3 com **loja de moedas em reais (R$ 1 a R$ 5)** e pagamento via **Pix**
integrado pelo Mercado Pago.

## Estrutura

```
match3-backend/           <- Backend Node.js (Express)
  server.js               <- Servidor + endpoints da API
  pix.js                  <- Integração com a API Pix do Mercado Pago
  .env                    <- Suas credenciais (nunca compartilhe!)
  package.json
match3/                   <- Jogo (front-end)
  index.html              <- Versão ligada ao backend (paga via Pix)
  Match3.html             <- Versão antiga (pagamento simulado)
```

## Como funciona o Pix

1. Jogador escolhe um pacote (R$1, R$3 ou R$5) e toca em comprar
2. O backend cria uma **ordem Pix** no Mercado Pago
3. O jogador vê o **QR Code** (ou copia o código) e paga no banco
4. O backend confirma o pagamento (webhook + consulta) e **entrega as moedas**

## Pré-requisitos

- **Node.js 18+** (ou Bun) instalado
- **Conta no Mercado Pago** (https://www.mercadopago.com.br)

## Passo 1: Criar a aplicação no Mercado Pago

1. Acesse https://www.mercadopago.com.br/developers
2. Menu **"Minhas aplicações"** → **"Criar aplicação"**
3. Copie o **Access Token** (use o de PRODUÇÃO para receber pagamentos reais)
4. Cole no arquivo `.env`:
   ```
   MP_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxxxxxxx
   ```

> Para testar sem dinheiro real, use o **Access Token de TESTE** do painel.

## Passo 2: Configurar o .env

Copie o exemplo e edite:

```bash
cp .env.example .env
```

Ajuste `BASE_URL` para a URL pública onde o servidor ficará hospedado
(em produção: `https://seusite.com`). Isso é necessário para o webhook.

## Passo 3: Instalar e rodar

```bash
cd match3-backend
npm install        # ou: bun install
npm start          # ou: bun run server.js
```

O servidor sobe em `http://localhost:3000` e serve o jogo + API.
Abra o jogo no celular (na mesma rede) acessando o IP do computador:
`http://SEU_IP:3000`

## Endpoints da API

| Método | Rota                      | Função                              |
|--------|---------------------------|-------------------------------------|
| POST   | `/api/create-pix`         | Cria ordem Pix (QR Code)            |
| GET    | `/api/payment-status/:id` | Consulta status do pagamento        |
| POST   | `/api/webhook/mp`         | Recebe confirmação do Mercado Pago  |
| GET    | `/api/balance/:id`        | Consulta saldo do jogador           |
| POST   | `/api/add`                | Adiciona moedas (ganhas jogando)    |
| POST   | `/api/spend`              | Gasta moedas (compra boost)         |
| GET    | `/api/packs`              | Lista pacotes                        |

## Configurar o Webhook no Mercado Pago

No painel de developer do Mercado Pago, na sua aplicação, cadastre o webhook:
- URL: `https://SEUSITE.com/api/webhook/mp`
- Evento: **Pagamentos (payment)**

> Importante: o webhook **só funciona se o servidor tiver URL pública (HTTPS)**.
> Em produção, hospede em um serviço como Vercel, Render, Railway ou um VPS.

## ⚠️ Para produção (importante)

- **Banco de dados**: o backend guarda saldo em memória (some ao reiniciar).
  Troque `users`/`payments` (Map) por um banco (SQLite/Postgres) para persistir.
- **Segurança**: nunca exponha o Access Token. O `player` usa um `userId`
  simples; em produção gere/salve de forma segura do lado do servidor.
- **Email do pagador**: em `pix.js` o email é fixo; idealmente use o do jogador.

## Sobre as taxas do Mercado Pago

Sem mensalidade. Taxa por transação Pix (valores aproximados):
~R$ 0,49 + ~0,99% por venda. Confira os valores atuais no site do Mercado Pago.

## 🚀 Publicar o jogo na internet (grátis)

Para os pagamentos funcionarem automaticamente, o backend precisa de uma
**URL pública (HTTPS)** para o webhook. A forma mais simples e grátis:

> **Render (Web Service) + Neon (Postgres)**
> Banco de dados que NÃO expira e servidor sempre ativo.

### 1. Criar repositório GitHub
1. Crie uma conta grátis em https://github.com e um **repositório novo** (público ou privado).
2. No seu computador, dentro da pasta `match3-backend`, envie os arquivos
   (o `.gitignore` já exclui o `.env` com o token).

### 2. Criar o banco de dados (Neon - grátis e permanente)
1. Crie conta em https://neon.tech (login com Google/GitHub).
2. Crie um **projeto** → copie a **connection string** (começa com `postgresql://...`).
3. Guarde — será colada no Render como `DATABASE_URL`.

### 3. Subir o servidor (Render)
1. Crie conta em https://render.com (login com GitHub).
2. **New → Blueprint** → escolha seu repositório.
3. O Render lê o `render.yaml` e cria o serviço `match3`.
4. Em **Environment**, preencha:
   - `MP_ACCESS_TOKEN` = seu token de produção
   - `DATABASE_URL` = connection string do Neon
   - `BASE_URL` = `https://SEU-SERVIDOR.onrender.com` (a URL que o Render gerar)
5. **Deploy**. Ao terminar, o jogo estará em `https://SEU-SERVIDOR.onrender.com`.

### 4. Registrar o webhook no Mercado Pago
1. Em https://www.mercadopago.com.br/developers, na sua aplicação → **Webhooks**.
2. Adicione: `https://SEU-SERVIDOR.onrender.com/api/webhook/mp` com o evento **Pagamentos**.

### 5. Testar
1. Abra `https://SEU-SERVIDOR.onrender.com` no celular.
2. Toque em um pacote, pague o Pix e veja as moedas caírem.

> ⚠️ Se você mantém o jogo rodando local (PC), veja a seção "Rodar local" acima.

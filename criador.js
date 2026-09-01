// Criador de Vídeos — serviço que gera vídeos de divulgação (Node puro:
// sharp gera os frames PNG a partir de SVG, ffmpeg-static monta o MP4).
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFile } = require('child_process');
const sharp = require('sharp');

const FFMPEG = require('ffmpeg-static');
const W = 720, H = 1280;

const CFG = {
  freeLimit: 3,
  videoDir: process.env.VIDEO_DIR || path.join(os.homedir(), 'divulgacao', 'videos'),
  paletasLivres: ['roxo', 'azul'],
  precos: [
    { id: 'vitalicio', nome: 'Acesso Vitalício', brl: 30, code: 'LIB_VIT' },
    { id: 'mensal', nome: 'Acesso Mensal', brl: 10, code: 'LIB_MES' }
  ]
};

const PALETAS = {
  roxo:  { bg: '#170f2e', accent: '#34206e', c2: '#231444', gold: '#ffd700' },
  azul:  { bg: '#0a193c', accent: '#193c82', c2: '#0f284e', gold: '#ffd700' },
  verde: { bg: '#0a2819', accent: '#1e6e3c', c2: '#124626', gold: '#ffd700' },
  rosa:  { bg: '#320f28', accent: '#78235a', c2: '#4e193c', gold: '#ffd700' },
  ouro:  { bg: '#3c2305', accent: '#8c5a0a', c2: '#5c3708', gold: '#ffd700' },
  casa:  { bg: '#28190f', accent: '#643c19', c2: '#41270f', gold: '#ffd700' }
};

const SUGESTOES = {
  doceria:  { e: '🍰', frases: ['Doces caseiros deliciosos', 'Encomende agora mesmo!', 'Feito com amor, todo dia'] },
  salao:    { e: '💇', frases: ['Transforme seu visual', 'Agende seu horário', 'Os melhores profissionais'] },
  roupas:   { e: '👗', frases: ['Moda que você vai amar', 'Novidades toda semana', 'Vista-se bem, viva melhor'] },
  jogo:     { e: '🎮', frases: ['Entre e jogue grátis', 'Prêmios todo dia', 'Diversão garantida'] },
  comida:   { e: '🍕', frases: ['Peça já o seu', 'Muito sabor e preço bom', 'Entrega rápida na sua casa'] },
  academia: { e: '💪', frases: ['Seja sua melhor versão', 'Treine com os melhores', 'Matrícula aberta'] },
  geral:    { e: '🪙', frases: ['Confira nossas ofertas', 'Você vai amar', 'Chama agora no WhatsApp'] }
};

const usos = {};

function sugerir(tipo) {
  const c = SUGESTOES[tipo] || SUGESTOES.geral;
  return { emoji: c.e, frases: c.frases };
}

function getUso(userId) {
  usos[userId] = usos[userId] || { count: 0, liberado: false };
  return usos[userId];
}

function podeGerar(userId) {
  const u = getUso(userId);
  return u.liberado || u.count < CFG.freeLimit;
}

function esc(t) {
  return String(t || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function svgFrame(nome, f1, f2, emoji, pal, marcaAgua) {
  const p = PALETAS[pal] || PALETAS.roxo;
  const marca = marcaAgua ? `<text x="360" y="1235" font-size="26" fill="#d4cdf0" text-anchor="middle" font-family="sans-serif" font-weight="bold">Criado com CriadorPro</text>` : '';
  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="${p.bg}"/>
    <circle cx="640" cy="90" r="260" fill="${p.accent}"/>
    <circle cx="80" cy="1150" r="220" fill="${p.accent}"/>
    <circle cx="600" cy="900" r="150" fill="${p.c2}"/>
    <rect x="30" y="40" width="${W-60}" height="130" rx="24" fill="#ffffff" fill-opacity="0.15"/>
    <text x="360" y="120" font-size="40" fill="${p.gold}" text-anchor="middle" font-family="sans-serif" font-weight="bold">${esc(nome.toUpperCase())}</text>
    <text x="360" y="420" font-size="200" text-anchor="middle">${emoji}</text>
    <text x="360" y="660" font-size="60" fill="${p.gold}" text-anchor="middle" font-family="sans-serif" font-weight="bold">${esc(f1)}</text>
    <text x="360" y="760" font-size="40" fill="#ffffff" text-anchor="middle" font-family="sans-serif">${esc(f2)}</text>
    <rect x="60" y="1050" width="${W-120}" height="90" rx="24" fill="#2ecc71"/>
    <text x="360" y="1108" font-size="36" fill="#0a0f0a" text-anchor="middle" font-family="sans-serif" font-weight="bold">SAIBA MAIS 👉</text>
    ${marca}
  </svg>`;
}

function gerarPngFrame(svg) {
  return sharp(Buffer.from(svg)).png().toBuffer();
}

function gerarVideo(userId, data) {
  return new Promise(async (resolve, reject) => {
    try {
      const { nome, f1, f2, emoji, paleta } = data;
      if (!nome) return reject(new Error('Nome do negócio obrigatório'));
      const pal = PALETAS[paleta] ? paleta : 'roxo';

      const u = getUso(userId);
      const marcaAgua = !u.liberado; // só paga remove marca

      const slides = [
        [nome, f1 || 'Frase principal', f2 || 'Frase secundária', emoji || '🪙'],
        [nome, 'Vem conferir!', 'Você vai amar', '✨'],
        [nome, 'GRÁTIS até brinde', 'Chama agora', '🎁']
      ];

      const framesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'criador-'));
      const pngs = [];
      for (let i = 0; i < slides.length; i++) {
        const [n, a, b, e] = slides[i];
        const svg = svgFrame(n, a, b, e, pal, marcaAgua);
        const png = await gerarPngFrame(svg);
        const file = path.join(framesDir, `f${i}.png`);
        fs.writeFileSync(file, png);
        pngs.push(file);
      }

      fs.mkdirSync(CFG.videoDir, { recursive: true });
      const nomeArq = `vid_${Date.now()}_${String(userId).slice(0,12)}.mp4`;
      const out = path.join(CFG.videoDir, nomeArq);

      // monta vídeo: cada PNG dura 2s (concat demuxer + diretiva duration)
      const listFile = path.join(framesDir, 'list.txt');
      const lines = [];
      for (let i = 0; i < pngs.length; i++) {
        const f = pngs[i].replace(/\\/g, '/').replace(/'/g, "'\\''");
        lines.push(`file '${f}'`);
        lines.push(`duration 2`);
      }
      // concat demuxer precisa de um arquivo extra de fechamento
      lines.push(`file '${pngs[pngs.length-1].replace(/\\/g, '/').replace(/'/g, "'\\''")}'`);
      fs.writeFileSync(listFile, lines.join('\n'));

      const ffArgs = ['-f', 'concat', '-safe', '0', '-i', listFile, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-y', out];
      execFile(FFMPEG, ffArgs, { timeout: 60000 }, (err) => {
        try { fs.rmSync(framesDir, { recursive: true, force: true }); } catch {}
        if (err) return reject(new Error('Falha ao gerar vídeo: ' + (err.message || '').slice(0,200)));
        resolve({ arquivo: nomeArq, videoUrl: `/api/criador/video/${nomeArq}` });
      });
    } catch (err) {
      reject(new Error('Erro interno ao gerar vídeo: ' + err.message));
    }
  });
}

function status(userId) {
  const u = getUso(userId);
  return {
    freeLimit: CFG.freeLimit,
    usado: u.count,
    liberado: u.liberado,
    restam: u.liberado ? -1 : Math.max(0, CFG.freeLimit - u.count),
    paletasLivres: CFG.paletasLivres,
    precos: CFG.precos
  };
}

module.exports = { CFG, status, getUso, podeGerar, gerarVideo, sugerir, videoDir: CFG.videoDir };

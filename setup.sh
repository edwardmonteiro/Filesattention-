#!/usr/bin/env bash
#
# setup.sh — Script de setup rápido para AFS Local
# Uso: chmod +x setup.sh && ./setup.sh
#

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║  AFS Local — Agentic File System Setup           ║"
echo "║  Context Engineering para LLMs                   ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# --------------------------------------------------
# 1. Verificar pré-requisitos
# --------------------------------------------------
info "Verificando pré-requisitos..."

if ! command -v node &>/dev/null; then
  echo "❌ Node.js não encontrado. Instale v18+ de https://nodejs.org"
  echo "   Ou via nvm: curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash"
  echo "                nvm install 20"
  exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo "❌ Node.js v18+ necessário (encontrado: $(node -v))"
  exit 1
fi
ok "Node.js $(node -v)"

if ! command -v npm &>/dev/null; then
  echo "❌ npm não encontrado"
  exit 1
fi
ok "npm $(npm -v)"

# --------------------------------------------------
# 2. Instalar dependências
# --------------------------------------------------
info "Instalando dependências..."
npm install --silent 2>/dev/null
ok "Dependências instaladas"

# --------------------------------------------------
# 3. Compilar TypeScript
# --------------------------------------------------
info "Compilando TypeScript..."
npx tsc
ok "Build completo em dist/"

# --------------------------------------------------
# 4. Inicializar banco de dados
# --------------------------------------------------
info "Inicializando AFS..."
node dist/index.js init
ok "Banco SQLite criado em data/afs.sqlite"

# --------------------------------------------------
# 5. Rodar testes
# --------------------------------------------------
info "Rodando testes..."
npx vitest run --reporter=dot 2>&1 | tail -5
ok "Testes passaram"

# --------------------------------------------------
# 6. Dados de exemplo
# --------------------------------------------------
info "Adicionando dados de exemplo..."

node dist/index.js memory add \
  -t fact \
  -k "linguagem:typescript" \
  -v "TypeScript é um superset tipado de JavaScript, compilado para JS puro"

node dist/index.js memory add \
  -t fact \
  -k "conceito:context-engineering" \
  -v "Context engineering trata o contexto do LLM como infraestrutura governada: persistente, versionada, composável e rastreável"

node dist/index.js memory add \
  -t fact \
  -k "conceito:token-budget" \
  -v "O token budget é a restrição fundamental — todo contexto deve caber na janela finita do modelo"

node dist/index.js memory add \
  -t procedural \
  -k "tool:busca-semantica" \
  -v '{"name":"semantic_search","description":"Busca por similaridade semântica na memória","input":{"query":"string","type":"string?"}}'

node dist/index.js memory add \
  -t user \
  -k "pref:idioma:principal" \
  -v '{"key":"principal","value":"pt-br","category":"idioma"}'

node dist/index.js memory add \
  -t episodic \
  -k "sessao:setup-inicial" \
  -v "Sessão de setup inicial do AFS. Sistema inicializado, dados de exemplo carregados, testes passando."

ok "6 memórias de exemplo adicionadas"

# --------------------------------------------------
# 7. Mostrar status final
# --------------------------------------------------
echo ""
echo "════════════════════════════════════════════════════"
node dist/index.js status
echo "════════════════════════════════════════════════════"

echo ""
echo -e "${GREEN}✅ Setup completo!${NC}"
echo ""
echo "Comandos disponíveis:"
echo ""
echo "  node dist/index.js status                    # Ver status geral"
echo "  node dist/index.js memory search \"context\"   # Buscar memórias"
echo "  node dist/index.js memory list -t fact        # Listar fatos"
echo "  node dist/index.js memory add -t fact -k KEY -v VALUE"
echo "  node dist/index.js mount ./docs               # Montar diretório"
echo "  node dist/index.js index ./docs ./src          # Indexar para RAG"
echo "  node dist/index.js history                     # Ver histórico"
echo "  node dist/index.js consolidate                 # Deduplicar memórias"
echo "  node dist/index.js log                         # Ver log de operações"
echo ""
echo "Para desenvolvimento:"
echo ""
echo "  npm run dev -- status         # Rodar sem compilar (via tsx)"
echo "  npm test                      # Rodar testes"
echo "  npm run test:watch            # Testes em modo watch"
echo ""

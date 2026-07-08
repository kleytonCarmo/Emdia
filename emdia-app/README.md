# EmDia — Controle de pagamentos para personal trainers

App mobile-first para controlar pagamentos, sessões e cobranças de alunos.
Planos mensais/trimestrais/semestrais/anuais, créditos, projetos, duplas,
lembretes com desconto por antecipação, PIX copia-e-cola e cartão recorrente.

## Como publicar (100% pelo navegador, sem terminal)

### 1. Subir para o GitHub
1. Acesse github.com → **New repository** → nome `emdia` → Create.
2. Na página do repo, clique em **uploading an existing file**.
3. Arraste TODOS os arquivos desta pasta (mantendo a pasta `src/` com os
   arquivos dentro dela). Dica: no upload dá para arrastar a pasta inteira.
4. **Commit changes**.

### 2. Publicar no Vercel
1. Acesse vercel.com → **Add New → Project**.
2. Importe o repositório `emdia`.
3. O Vercel detecta Vite sozinho — não mude nada. **Deploy**.
4. Pronto: seu link fica algo como `emdia.vercel.app`.

### 3. Primeiro uso
- O app abre com alunos de demonstração (bom para mostrar em grupos).
- Para usar de verdade: botão **PIX** na barra inferior → preencha sua
  chave PIX, nome e cidade → **Apagar dados de demonstração / zerar app**.
- Os dados ficam salvos no aparelho (localStorage). Próxima etapa do
  roadmap: login + banco de dados (Supabase) para virar SaaS multiusuário.

## Estrutura
- `src/App.jsx` — todo o app (UI + lógica + camada de dados isolada)
- `src/main.jsx` — bootstrap do React
- `index.html` — entrada, tema e viewport mobile

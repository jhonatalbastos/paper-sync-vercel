# 🚀 Laboratório Vercel: Paper-Sync (FECD)

Bem-vindo à versão de alta performance do seu ecossistema GTD. Este repositório contém a transição do Streamlit para o **Next.js + Python FastAPI**, otimizado para o Vercel.

## 📂 Estrutura do Projeto

- `/src/app`: Frontend em Next.js (App Router). Dashboard Premium.
- `/api`: Backend em Python (FastAPI). O "cérebro" que gerencia Microsoft Graph, PDF e Visão.
- `/legacy`: Backup do seu código Streamlit original (`app.py`).
- `/public`: Assets, logos e templates.

## 🛠️ Configuração Inicial

1. **Dependências**:
   ```bash
   npm install
   ```

2. **Variáveis de Ambiente**:
   O arquivo `.env` na raiz já foi configurado com suas chaves do Azure.

3. **Desenvolvimento Local**:
   Para rodar o Next.js e a API Python simultaneamente:
   ```bash
   npx vercel dev
   ```

## 🌐 Deploy no Vercel

1. Crie um novo projeto no dashboard do Vercel.
2. Conecte este repositório do GitHub.
3. Certifique-se de adicionar as variáveis do arquivo `.env` nas configurações de "Environment Variables" do Vercel.

---
**FECD Premium Ecosystem** | *Potencializando a produtividade através da integração analógico-digital.*

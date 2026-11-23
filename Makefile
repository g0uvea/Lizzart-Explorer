SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

IMAGE_NAME ?= lizzart-explorer:latest
CONTAINER_NAME ?= lizzart-explorer
VOLUME_NAME ?= lizzart_data
PORT ?= 3000
E2E_PORT ?= 3845
DIST_DIR ?= dist
EXPORT_FILE := $(DIST_DIR)/lizzart-explorer-allinone.tar.gz

.PHONY: help install dev build start db-init reset check test test-docker \
        docker-build deploy docker-load docker-up docker-down docker-logs clean

help: ## Mostra todos os comandos disponíveis
	@echo ""
	@echo "Lizzart Explorer — Comandos disponíveis:"
	@echo ""
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36mmake %-14s\033[0m %s\n", $$1, $$2}'
	@echo ""

install: ## Instala as dependências do projeto com Bun
	bun install

dev: ## Executa o servidor de desenvolvimento local (http://localhost:5173)
	bun run dev

db-init: ## Inicializa/atualiza o schema no MariaDB local configurado no .env
	bun run db:init

reset: ## Reseta completamente o ambiente de desenvolvimento (banco MariaDB, storage local e cache) para testar do zero (/setup)
	bun run scripts/reset-dev.ts

build: ## Gera o build de produção SvelteKit (build/)
	bun run build

start: build ## Compila e inicia o servidor de produção local (http://localhost:$(PORT))
	PORT=$(PORT) bun run start

check: ## Executa verificação de tipos TypeScript/Svelte (svelte-check)
	bun run check

test: ## Executa a suíte E2E contra um servidor já ativo (use TEST_BASE_URL=...)
	bun run test:e2e

test-docker: docker-build ## Sobe container temporário (MariaDB+App), roda toda a suíte E2E e limpa ao final
	@set -euo pipefail; \
	TEST_CONTAINER="lizzart-e2e-test"; \
	TEST_VOL="lizzart-e2e-vol"; \
	cleanup() { \
		docker rm -f "$$TEST_CONTAINER" >/dev/null 2>&1 || true; \
		docker volume rm "$$TEST_VOL" >/dev/null 2>&1 || true; \
	}; \
	trap cleanup EXIT; \
	cleanup; \
	echo "[Make] Subindo container de teste na porta $(E2E_PORT)..."; \
	docker run -d --name "$$TEST_CONTAINER" -p 127.0.0.1:$(E2E_PORT):3000 -v "$$TEST_VOL:/data" $(IMAGE_NAME) >/dev/null; \
	READY=0; \
	for _ in $$(seq 1 60); do \
		if curl -fsS "http://127.0.0.1:$(E2E_PORT)/api/health" >/dev/null 2>&1; then \
			READY=1; \
			break; \
		fi; \
		sleep 0.5; \
	done; \
	if [ "$$READY" -ne 1 ]; then \
		echo "[Make] ERRO: Container não ficou saudável a tempo."; \
		docker logs "$$TEST_CONTAINER"; \
		exit 1; \
	fi; \
	TEST_BASE_URL="http://127.0.0.1:$(E2E_PORT)" bun run test:e2e

docker-build: ## Constrói a imagem Docker unificada (MariaDB + Aplicação)
	docker build -t $(IMAGE_NAME) .

deploy: ## Gera a imagem Docker unificada e exporta o pacote .tar.gz + .sha256 em dist/
	IMAGE_NAME=$(IMAGE_NAME) OUT_DIR=$(DIST_DIR) bash scripts/export-docker.sh

docker-load: ## Importa a imagem exportada ($(EXPORT_FILE)) para o Docker local
	docker load -i $(EXPORT_FILE)

docker-up: ## Sobe o container unificado em produção na porta $(PORT) com volume $(VOLUME_NAME)
	docker compose up -d

docker-down: ## Para e remove o container unificado (mantém o volume de dados)
	docker compose down

docker-logs: ## Exibe os logs em tempo real do container unificado
	docker compose logs -f

clean: ## Remove artefatos temporários de build (.svelte-kit, build, dist)
	rm -rf .svelte-kit build $(DIST_DIR)

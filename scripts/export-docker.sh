#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${IMAGE_NAME:-lizzart-explorer:latest}"
OUT_DIR="${OUT_DIR:-dist}"
OUT_FILE="${OUT_DIR}/lizzart-explorer-allinone.tar.gz"

mkdir -p "${OUT_DIR}"

echo "[Lizzart Docker] Construindo imagem unificada (MariaDB + Lizzart Explorer): ${IMAGE_NAME}..."
docker build -t "${IMAGE_NAME}" .

echo "[Lizzart Docker] Exportando imagem compactada para ${OUT_FILE}..."
docker save "${IMAGE_NAME}" | gzip -6 > "${OUT_FILE}"

sha256sum "${OUT_FILE}" > "${OUT_FILE}.sha256"

SIZE_HUMAN=$(du -h "${OUT_FILE}" | cut -f1)
echo "[Lizzart Docker] Exportação concluída!"
echo "  Arquivo : ${OUT_FILE} (${SIZE_HUMAN})"
echo "  SHA-256 : $(cat "${OUT_FILE}.sha256")"
echo ""
echo "Para importar em qualquer máquina com Docker:"
echo "  docker load -i ${OUT_FILE}"
echo "  docker run -d --name lizzart-explorer -p 3000:3000 -v lizzart_data:/data --restart unless-stopped ${IMAGE_NAME}"

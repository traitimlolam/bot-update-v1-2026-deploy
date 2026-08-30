# ---- Build stage: cài đủ cả devDependencies để chạy tsc ----
FROM node:20-slim AS build
WORKDIR /app

COPY package.json ./
RUN npm install

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- Runtime stage: chỉ chứa production deps + code đã build ----
FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev

COPY --from=build /app/dist ./dist

# Cloud Run tự inject biến PORT (mặc định 8080) — src/index.ts đã đọc process.env.PORT,
# không hard-code cổng nên không cần sửa gì thêm khi deploy.
EXPOSE 8080

# KHÔNG copy .env hay secrets/*.json vào image (đã loại trừ qua .dockerignore). Trên Cloud Run:
# - Các biến FB_*/GOOGLE_SHEET_ID/FIRESTORE_PROJECT_ID: set qua `--set-env-vars` hoặc Secret Manager.
# - GOOGLE_SERVICE_ACCOUNT_JSON_PATH: để TRỐNG (không set) — service dùng Application Default
#   Credentials từ service account gắn cho chính Cloud Run service (mục "getSheetsClient"/"getApp").
CMD ["node", "dist/index.js"]

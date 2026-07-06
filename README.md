# Color Walk 拼贴编辑器

一个面向小红书拼贴图的本地编辑器。生产模式使用 Node 服务提供静态页面、OpenAI 视觉识图代理和 GPS 反查代理；预览模式仍可用 Nginx 静态挂载快速查看页面。

## 本地运行

OpenAI 识图会读取环境变量 `OPENAI_API_KEY`，也会自动加载项目根目录的 `.env.local` 或 `.env`。没有密钥时，编辑器的手动文案、拼贴、导出和 GPS 坐标读取仍然可用，只有 `AI识图` 会提示失败。

```bash
npm start
```

默认访问地址是 `http://localhost:3000`。如需换模型或端口：

```bash
OPENAI_VISION_MODEL=gpt-5.5 PORT=3001 npm start
```

## 生产部署

生产模式会构建 Node 镜像，将 `index.html`、`src/`、`server/` 和 `server.js` 打包进镜像。

```bash
docker compose up --build -d
```

默认访问地址是 `http://localhost:8080`。如需修改宿主机端口：

```bash
APP_PORT=3000 docker compose up --build -d
```

如果要在容器里启用 AI 识图，请把 `OPENAI_API_KEY` 作为环境变量传给 Compose。GPS 反查代理默认使用可识别的 Color Walk User-Agent；公开部署时可用 `GEOCODE_USER_AGENT` 替换成你自己的应用标识。

停止服务：

```bash
docker compose down
```

## 开发预览模式

预览模式使用独立的 `docker-compose.preview.yml`，不构建镜像，而是把当前源码只读挂载进 Nginx 容器。它会挂载 `nginx.preview.conf` 作为预览专用主配置，避免本地文件权限较严格时出现 Nginx 403。修改文件后刷新浏览器即可看到变化。预览模式不包含 `/api/analyze-image`，完整 AI 功能请用 `npm start` 或生产服务。

```bash
docker compose -f docker-compose.preview.yml up
```

默认访问地址是 `http://localhost:5173`。如需修改预览端口：

```bash
PREVIEW_PORT=3001 docker compose -f docker-compose.preview.yml up
```

停止预览：

```bash
docker compose -f docker-compose.preview.yml down
```

## 校验

```bash
npm test
node --check src/app.js src/exif.js src/geocode.js src/draft.js server.js server/vision.js
docker compose config
docker compose -f docker-compose.preview.yml config
```

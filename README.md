# Color Walk 拼贴编辑器

一个带内置 Node 服务的 Color Walk 拼贴编辑器。前端负责图片拼贴、色盘和封面文字编辑；Node 服务负责静态资源托管和安全代理 AI 坐标解析，避免在浏览器暴露 `OPENAI_API_KEY`。

## 生产部署

生产模式会构建一个 Node 镜像，将 `index.html`、`src/` 和 `server.js` 打包进镜像。AI 坐标解析会复用 `.env.local` 中的 `OPENAI_API_KEY`。

```bash
docker compose up --build -d
```

默认访问地址是 `http://localhost:8080`。如需修改宿主机端口：

```bash
APP_PORT=3000 docker compose up --build -d
```

停止服务：

```bash
docker compose down
```

## 开发预览模式

预览模式使用独立的 `docker-compose.preview.yml`，把当前源码只读挂载进 Node 容器。修改前端文件后刷新浏览器即可看到变化。

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

## 本地运行

```bash
npm start
```

默认监听 `http://localhost:8080`，启动时会读取 `.env.local`。可通过 `PORT=3000 npm start` 改端口。

## 校验

```bash
npm test
docker compose config
docker compose -f docker-compose.preview.yml config
```

# Color Walk 拼贴编辑器

一个纯前端静态应用，可以直接用 Docker Compose 部署或启动本地预览。

## 生产静态部署

生产模式会构建一个 Nginx 静态镜像，将 `index.html` 和 `src/` 打包进镜像。

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

预览模式使用独立的 `docker-compose.preview.yml`，不构建镜像，而是把当前源码只读挂载进 Nginx 容器。它会挂载 `nginx.preview.conf` 作为预览专用主配置，避免本地文件权限较严格时出现 Nginx 403。修改文件后刷新浏览器即可看到变化。

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
docker compose config
docker compose -f docker-compose.preview.yml config
```

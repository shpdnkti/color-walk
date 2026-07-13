# Color Walk 拼贴编辑器

一个面向小红书拼贴图的本地编辑器。生产模式使用 Node 服务提供静态页面、OpenAI 视觉识图代理和 GPS 反查代理；预览模式仍可用 Nginx 静态挂载快速查看页面。

## 本地运行

OpenAI 识图会读取环境变量 `OPENAI_API_KEY`，也会自动加载项目根目录的 `.env.local` 或 `.env`。可用 `OPENAI_BASE_URL` 指向 OpenAI 兼容代理或自建网关，用 `OPENAI_VISION_MODEL` 调整模型，用 `OPENAI_REQUEST_TIMEOUT_MS` 调整请求超时。没有密钥时，编辑器的手动文案、拼贴、导出和 GPS 坐标读取仍然可用，只有 `AI识图` 会提示失败。

```bash
npm ci
npm start
```

默认访问地址是 `http://localhost:3000`。如需换 OpenAI 接口、模型、超时或端口：

```bash
OPENAI_BASE_URL=https://api.openai.com/v1 OPENAI_VISION_MODEL=gpt-5.5 OPENAI_REQUEST_TIMEOUT_MS=90000 PORT=3001 npm start
```

`OPENAI_BASE_URL` 填 API 根路径即可，服务端会自动追加 `/responses`。

## 生产部署

生产模式会构建 Node 镜像，将 `index.html`、`src/`、`server/`、`server.js` 和 `libheif-js@1.19.8` 的浏览器 WASM bundle 打包进镜像。HEIC 原图只在浏览器 Worker 内解码，不上传服务端。

```bash
docker compose up --build -d
```

默认访问地址是 `http://localhost:8080`。如需修改宿主机端口：

```bash
APP_PORT=3000 docker compose up --build -d
```

如果要在容器里启用 AI 识图，请把 `OPENAI_API_KEY` 作为环境变量传给 Compose。Compose 也会透传 `OPENAI_BASE_URL`、`OPENAI_VISION_MODEL` 和 `OPENAI_REQUEST_TIMEOUT_MS`，其中 `OPENAI_BASE_URL` 默认是 `https://api.openai.com/v1`。GPS 反查代理默认使用 OpenStreetMap/Nominatim，并带上可识别的 Color Walk User-Agent；公开部署时可用 `GEOCODE_REVERSE_URL` 指向自建或兼容的反查服务，用 `GEOCODE_USER_AGENT` 替换成你自己的应用标识。

### HEIC 与 CSP

Node 服务和预览 Nginx 都发送生产 CSP，其中脚本策略必须保留：

```text
script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'
```

`'wasm-unsafe-eval'` 只允许 WebAssembly 编译；不得加入 `'unsafe-eval'`，也不得恢复内联脚本。若前置 CDN/反向代理覆盖响应头，应原样保留仓库配置的 `Content-Security-Policy`。浏览器运行时从同源 `/vendor/libheif/libheif-bundle.mjs` 加载解码器。

生产验收命令：

```bash
npm ci
npm test
npm run test:heic-worker
npm run test:heic-upload
npm run test:heic-progressive
npm run test:image-aspect
COLOR_WALK_HEIC_RUNS=3 npm run bench:heic-first-preview

docker compose up --build -d
curl -sI http://127.0.0.1:8080/ | grep -i content-security-policy
curl -sI http://127.0.0.1:8080/vendor/libheif/libheif-bundle.mjs | grep -i content-type
```

故障诊断优先检查以下信号：浏览器 `securitypolicyviolation` 事件、Worker `fatal` / `decode-error` 消息、控制台 Worker 错误、解码器资源的 404 或错误 MIME，以及页面“图片读取失败”状态。`test:heic-upload` 会同时断言没有 CSP 违规、Worker 错误和页面错误。

停止服务：

```bash
docker compose down
```

## 开发预览模式

预览模式使用独立的 `docker-compose.preview.yml`，不构建镜像，而是把当前源码只读挂载进 Nginx 容器。它会挂载 `nginx.preview.conf` 作为预览专用主配置，避免本地文件权限较严格时出现 Nginx 403。修改文件后刷新浏览器即可看到变化。预览模式不包含 `/api/analyze-image`，完整 AI 功能请用 `npm start` 或生产服务。

```bash
npm ci
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

## 微信小程序

小程序源码位于 `miniprogram/`。在微信开发者工具中选择“导入项目”，项目目录打开仓库根目录，工具会读取根目录的 `project.config.json`，小程序根目录为 `miniprogram/`，默认入口页是 `pages/editor/editor`。

接口地址在 `miniprogram/config.js` 中配置：

```js
module.exports = {
  apiBaseUrl: '',
};
```

本地联调时可把 `apiBaseUrl` 改成你的 Node 服务地址，例如 `http://localhost:3000`。如果要在小程序真机或 CI 环境访问接口，请使用 HTTPS 域名并在微信公众平台配置合法域名。

CI 使用 `.github/workflows/wechat-miniprogram.yml`。push 和 pull request 会执行 `npm ci`、默认测试、严格 CSP HEIC 上传/Worker/渐进上传/方向回归、首张可编辑预览性能门禁和 `miniprogram:validate`。手动发布需要在 GitHub Actions 的 workflow dispatch 中选择 `preview` 或 `upload`，并配置以下 Secrets：

- `WECHAT_MINIPROGRAM_APPID`
- `WECHAT_MINIPROGRAM_PRIVATE_KEY`
- `WECHAT_MINIPROGRAM_API_BASE_URL`，必须是 HTTPS 地址，用于注入小程序发布包里的 `apiBaseUrl`

可选发布参数包括版本号和说明，对应 `WECHAT_MINIPROGRAM_VERSION` 与 `WECHAT_MINIPROGRAM_DESC`。本地也可以直接运行：

```bash
npm run miniprogram:validate
npm install --no-save miniprogram-ci@2.1.31
WECHAT_MINIPROGRAM_APPID=wx... WECHAT_MINIPROGRAM_PRIVATE_KEY="$(cat private.key)" WECHAT_MINIPROGRAM_API_BASE_URL=https://api.example.com npm run miniprogram:preview
```

## 校验

```bash
npm test
npm run miniprogram:validate
node --check src/app.js src/exif.js src/geocode.js src/draft.js server.js server/vision.js
docker compose config
docker compose -f docker-compose.preview.yml config
```

导出/预览一致性有一个可选浏览器冒烟检查，不会随默认 `npm test` 运行。需要本机已有 Playwright 浏览器二进制时再启用；没有浏览器工具时脚本会跳过，不会访问外部网络。

```bash
COLOR_WALK_RUN_EXPORT_PREVIEW_SMOKE=1 npm run test:export-preview
```

图片宽高比回归覆盖横图、竖图、方图、带方向信息的 HEIC、全部输出比例、缩放/拖动、草稿恢复和两种导出路径：

```bash
npm run test:image-aspect
npm run test:image-crop-drag
```

HEIC 上传回归检查默认使用仓库内无元数据的匿名样本；也可以指定本地原图复测，原图只在浏览器内读取，不会提交到仓库：

```bash
COLOR_WALK_HEIC_FIXTURE=/path/to/photo.heic npm run test:heic-upload
```

Issue #5 的固定性能样本是 `test/fixtures/performance-4032x3024.heic`（4032×3024，SHA-256 `f62eb5df1493ee5454db0746384d29e6ddb33f01892a692eb01e1088993bc70a`）。在同一台机器、Playwright 1.61.1 / Chromium 149.0.7827.55 下各运行 5 次，冷启动“选择完成到首张可编辑预览”中位数从 `ae0e102` 的 1789.1ms 降至 `eccfa10` 的 1087.4ms，降低 39.2%；同页热上传中位数为 673.6ms → 727.5ms。候选冷启动原始数据为 `1145.3, 1152.0, 1063.8, 1077.0, 1087.4ms`。

每次冷启动使用新的 Chromium 进程和 BrowserContext 并清理缓存；热上传在同页重置编辑器后复测。基准以文件输入框的 `change` 为起点，以预览已解码、照片卡片和裁切滑杆可操作并经过两个 `requestAnimationFrame` 为终点。提供基线 JSON 时，冷启动中位数改善不足 30% 会直接失败；默认还要求冷启动中位数不超过 1500ms，且任一冷/热运行的帧间隔或 Long Task 不超过 150ms：

最终 5 次报告的冷/热最大帧间隔为 66.7/50.0ms，最大 Long Task 为 53/0ms，全部低于 150ms 门槛。

```bash
COLOR_WALK_HEIC_RUNS=5 COLOR_WALK_HEIC_OUTPUT=/tmp/heic-candidate.json \
  COLOR_WALK_HEIC_BASELINE=artifacts/issue-5-heic-baseline.json npm run bench:heic-first-preview

npm run test:upload-enrichment
npm run test:heic-progressive
```

Worker 预热、串行解码和加载失败属于可选浏览器测试，不随默认 npm test 启动 Chromium：

    npm run test:heic-worker

严格 CSP 解码器选型、同机对比、兼容性与集成约束见 [HEIC 解码器选型与验证](docs/performance/heic-decoder-selection.md)；原有性能口径见 [HEIC 首张可编辑预览性能基准](docs/performance/heic-first-preview.md)。

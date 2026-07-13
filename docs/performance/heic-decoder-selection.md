# HEIC 解码器选型与验证

对应 GitHub Issues #13、#14、#15。结论：使用 `libheif-js@1.19.8` 的 `libheif-wasm/libheif-bundle.mjs`，由现有同源模块 Worker 直接调用；不保留旧解码器双链路。

## 选型结论

| 项目 | 旧链路 | 选定链路 |
| --- | --- | --- |
| 依赖 | `heic-to@1.5.2` | `libheif-js@1.19.8` |
| 许可证 | LGPL-3.0 | LGPL-3.0 |
| 生产运行时文件 | 2,996,445 bytes | 1,461,926 bytes |
| gzip 参考大小 | 737,398 bytes | 520,724 bytes |
| 动态 JS 执行 | 旧构建不满足目标 CSP | 静态扫描无 `eval()` / `new Function()` |
| CSP | 旧部署未锁定 | 仅需 `'wasm-unsafe-eval'`，不需要 `'unsafe-eval'` |

选定方案直接输出 RGBA `ImageData`，再在 Worker 的 `OffscreenCanvas` 中编码为 JPEG。相较旧运行时，原始文件减少 51.2%，gzip 参考大小减少 29.4%。`'wasm-unsafe-eval'` 只开放 WASM 编译，比允许通用 JS 动态执行的 `'unsafe-eval'` 更窄；参见 [MDN script-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)。

## 正确性与 CSP 验证

Playwright 1.61.1 / Chromium 149.0.7827.55 下通过：

| 匿名样本 | 断言 |
| --- | --- |
| `upload.heic`，424 bytes | JPEG 预览为 96×72，可提取主色并导出 |
| 注入 `irot=1` 的方向样本 | 输出 72×96，四角标记按顺时针方向落位 |
| `performance-4032x3024.heic`，510,794 bytes | 输出 4032×3024，首张预览可编辑 |

旧链路和选定链路均通过同一套比例、方向、像素角点和两种导出路径断言。选定链路还在实际响应头 `script-src 'self' 'wasm-unsafe-eval'` 下完成上传、预览和导出；`securitypolicyviolation`、Worker 错误、页面错误均为空。首次解码器请求被主动中断后，新 Worker 可恢复并成功完成第二次上传。

复测命令：

```bash
npm run test:heic-upload
COLOR_WALK_HEIC_FAIL_FIRST_DECODER=1 npm run test:heic-upload
npm run test:heic-worker
npm run test:image-aspect
```

## 性能对比

环境：Apple M4 Pro、macOS 15.6、Node 24.14.0、Chromium 149.0.7827.55；固定 4032×3024 匿名样本，各 5 次。

| 链路 | 冷启动原始值（ms） | 冷启动中位数 | 热上传中位数 | 最大帧间隔 | 最大 Long Task |
| --- | --- | ---: | ---: | ---: | ---: |
| 旧链路 | 409.8, 411.0, 406.6, 407.0, 415.3 | 409.8ms | 240.0ms | 16.8ms | 0ms |
| `libheif-js` | 326.8, 324.7, 323.2, 315.6, 323.6 | 323.6ms | 287.1ms | 16.8ms | 0ms |

候选冷启动中位数降低 21.0%；热上传中位数增加 19.6%，但仍低于 300ms。持续门禁采用跨 CI 主机可复现的上限：冷启动中位数不超过 1500ms，最大帧间隔和 Long Task 均不超过 150ms。基准脚本使用匿名样本，不读取或上传用户照片。

```bash
COLOR_WALK_HEIC_RUNS=5 COLOR_WALK_HEIC_OUTPUT=/tmp/heic-candidate.json \
  npm run bench:heic-first-preview
```

## 浏览器兼容性

- 已自动验证：Chromium 149；因此 Chrome/Edge 的当前 Chromium 路径是发布门禁。
- 运行条件：同源模块 Worker、WebAssembly、`OffscreenCanvas`、`convertToBlob({ type: 'image/jpeg' })`。`convertToBlob()` 可在 Worker 使用，MDN 将其标记为 2023 年 3 月起广泛可用：[OffscreenCanvas.convertToBlob](https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvas/convertToBlob)。
- Firefox 与 Safari 尚未进入本仓库自动化矩阵；发布到这些浏览器前需手工跑上述上传和方向回归。缺少任一运行条件时应进入现有单文件失败/批次部分成功路径，而不是上传原图到服务端。

## 集成约束

- Worker 消息保持 `ready`、`fatal`、`decoded`、`decode-error`、`dominant-color`；应用层无需双协议。
- Worker 内和应用层均保持串行解码，单项超时从真正开始解码时计时。
- 预热必须完成后才发送 `ready`；加载、预热或运行失败由应用终止 Worker，并在下次请求创建新实例。
- 取消活动上传会终止 Worker 并拒绝待处理请求；空闲预热 Worker 可复用。
- 混合批次按文件隔离失败，已成功的 JPG/PNG/HEIC 保留。
- HEIC 原始 `File` 只通过 `postMessage` 进入浏览器 Worker；服务端仅交付静态解码器资源。

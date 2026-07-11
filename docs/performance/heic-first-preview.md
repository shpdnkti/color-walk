# HEIC 首张可编辑预览性能基准

对应 GitHub Issue #5。优化前基线固定为 ae0e102（Fix HEIC image uploads），不是尚未支持 HEIC 的 master。

## 固定样本

- 文件：test/fixtures/performance-4032x3024.heic
- 尺寸：4032×3024（12.2 MP）
- 大小：510,794 bytes
- SHA-256：f62eb5df1493ee5454db0746384d29e6ddb33f01892a692eb01e1088993bc70a
- 来源：使用 FFmpeg testsrc2 生成的合成测试图，再由 libheif/x265 编码；无人物、EXIF 或位置数据。

## 测量口径

- Playwright 1.61.1 / Chromium 149.0.7827.55，视口 1024×900。
- 起点：文件输入框 capture-phase change 事件。
- 终点：首张预览图片已解码、照片卡片裁切滑杆可用，再经过两个 requestAnimationFrame。
- 冷缓存：每次新建 Chromium 进程和 BrowserContext，清浏览器缓存；共 5 次。
- 热缓存：同页先预热一次，只重置编辑器、不刷新页面；共 5 次。
- 模拟用户打开文件选择器后 750ms 完成选择；这段时间不计入“选择完成到首张预览”，但允许上传意图预加载解码器。
- 同时记录最大帧间隔、Long Task、解码器请求数、运行环境和每次原始值；冷/热任一运行超过 150ms 响应门槛即失败。

## 结果

| 版本 | 冷缓存 5 次（ms） | 冷缓存中位数 | 热缓存 5 次（ms） | 热缓存中位数 |
| --- | --- | ---: | --- | ---: |
| ae0e102 基线 | 1874.7, 1789.1, 1781.4, 1803.6, 1789.0 | 1789.1 ms | 896.1, 636.3, 673.6, 625.0, 700.9 | 673.6 ms |
| eccfa10 Issue #5 候选 | 1145.3, 1152.0, 1063.8, 1077.0, 1087.4 | 1087.4 ms | 880.8, 759.0, 727.5, 673.8, 612.1 | 727.5 ms |

冷缓存中位数降低 39.2%，超过验收要求的 30%。热缓存 5 次上传均未再次请求解码器模块。最终报告的冷/热最大帧间隔为 66.7/50.0ms，最大 Long Task 为 53/0ms。

原始报告：

- [优化前基线](../../artifacts/issue-5-heic-baseline.json)
- [优化后候选](../../artifacts/issue-5-heic-candidate.json)

## 复测

    COLOR_WALK_HEIC_OUTPUT=/tmp/candidate.json \
    COLOR_WALK_HEIC_BASELINE=artifacts/issue-5-heic-baseline.json \
    npm run bench:heic-first-preview

脚本会在提供基线时计算降幅，并在冷缓存中位数降幅低于 30% 时失败；默认还要求冷/热任一运行的最大帧间隔和 Long Task 均不超过 150ms。可用 COLOR_WALK_HEIC_APP_ROOT 指向 detached worktree，以同一 harness 复测旧提交。

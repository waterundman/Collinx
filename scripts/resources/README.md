# 资源收集目录（可脚本下载部分）

**清单**：`manifest.json`（id / url / license / verified 逐条标注）
**运行**：`node scripts/resources/fetch.mjs <id...|all>`（Node 18+，零依赖）
**落盘**：仓库根 `resources/<id>/`（已 gitignore，不入库；幂等，重复运行跳过已下载）

## 清单速览

| id | 类别 | 名称 | verified |
|----|------|------|----------|
| fluidr3-gm | SF2 音色库 | FluidR3_GM（GM 事实标准 ~140MB） | 未实测（站点 403 → 手动，见 MANUAL.md §0） |
| generaluser-gs | SF2 音色库 | GeneralUser GS（轻量 ~30MB） | 未实测 |
| surge-xt | VST3 插件 | Surge XT（开源合成器） | 未实测（repo 已修正为 surge-xt） |
| dexed | VST3 插件 | Dexed（DX7 复刻） | 未实测 |
| odin2 | VST3 插件 | Odin 2 | 未实测 |

> 维护规约：新增资源 = 在 manifest.json 追加条目（id/url/license/verified 必填）；
> 链接失效时回填新直链并更新 verified。**不可脚本下载的资源见同目录 `MANUAL.md`**。

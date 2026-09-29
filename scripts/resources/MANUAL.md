# 资源收集名录 — 不可脚本化部分

> 配套：可脚本下载的资源（开源 VST3 等）见 `scripts/resources/`（manifest 驱动，`node scripts/resources/fetch.mjs all`）。
> 本文档收录**必须人工操作**的资源：需注册账号、走安装器、站点反爬（403）、或按需逐条挑选的。每条标注获取方式与授权。

## 0. SF2 音色库（站点 403 屏蔽脚本 → 浏览器手动下载）

| 资源 | 获取方式 | 授权 |
|------|----------|------|
| FluidR3_GM（GM 事实标准 ~140MB） | 浏览器打开 https://musical-artifacts.com/artifacts/738/FluidR3_GM.sf2 | 免费可再分发 |
| GeneralUser GS（轻量 ~30MB） | https://musical-artifacts.com/artifacts/904/GeneralUser_GS_v1.471.sf2 | 免费 |
| 备选聚合 | https://www.polyphone.io/en/soundfonts / musical-artifacts.com | 逐条看授权 |

> 上述两条 manifest 里也有（脚本会尝试），实测 403 → **直接浏览器下载**后放入 `resources/<id>/` 即可被工作流复用。


## 1. 免费音源（需注册账号 / 官方安装器 → 不可脚本化）

| 资源 | 类型 | 获取方式 | 授权 | 说明 |
|------|------|----------|------|------|
| Spitfire LABS | 音源（多乐器） | 官网注册 → 装 Splice/自行安装器 | 免费（可商用） | 音质标杆，编曲首选入门 |
| BBC Symphony Orchestra Discover | 乐团音源 | 注册 → 官方安装器 | 免费（可商用，需等待或问卷） | 完整管弦编制 |
| Orchestral Tools Layers | 管弦音源 | 注册 → SINE 客户端 | 免费 | 分层乐器，快速原型 |
| Native Instruments Komplete Start | 合成器+采样合集 | 注册 → Native Access | 免费 | 行业标准生态入口 |
| Vital Audio | 波表合成器 | 注册 → 安装器（免费版功能完整） | 免费（Pro 收费） | Serus 级波表引擎 |
| UVI Workstation + Falcon Intro | 采样播放器 | 注册 → UVI 安装器 | 免费 | 采样宿主 |
| Valhalla Supermassive | 效果（混响/延迟） | 官网直下（需填邮箱链接） | 免费 | 效果链常驻 |

## 2. 商业音源（制作正式曲目时的升级路径）

| 资源 | 类型 | 价格量级 | 说明 |
|------|------|----------|------|
| Omnisphere | 合成器旗舰 | $$$ | 合成器天花板 |
| Kontakt + 管弦库（Spitfire BBC SO Core/Pro、Cinesamples、VSL） | 管弦 | $$-$$$$ | 正式管弦制作 |
| Nexus / Serum 2 | 合成器 | $$ | 流行/电子 |
| Toontrack EZdrummer / Superior Drummer | 鼓 | $$ | 鼓组工作流标杆 |

## 3. 采样素材站（网页逐条下载 → 半手工）

| 站点 | 内容 | 授权注意 |
|------|------|----------|
| Freesound.org | 各类采样（CC 授权） | 逐条看 CC 协议（部分要求署名/NC） |
| Polyphone SoundFonts | SF2 音色库合集 | 逐条看授权 |
| MusicalArtifacts.com | SF2/SFZ/音色 | 逐条看授权 |
| SampleSwap | 采样包 | 免费非商用居多 |
| Looperman | Loop/采样 | 免费需署名，商用看条目 |

## 4. MIDI 素材（编曲参考 / 导入用）

| 站点 | 内容 | 授权注意 |
|------|------|----------|
| BitMidi | 免费 MIDI 曲库 | 逐条看授权（多为个人上传） |
| MuseScore.com | 乐谱 + MIDI 导出 | 部分需 Pro，版权属原作者 |
| Free-scores.com | 公版乐谱 MIDI | 公版作品安全 |

## 维护规约

- 新增条目：按类目追加表格行，**必填**获取方式与授权（无授权信息不入册）。
- 资源进入正式产品管线（如 SF2 内嵌播放）前，先核对该资源授权是否允许随软件分发。
- 上线清单（可脚本部分）与本文档的分工：**能一条命令拿到的进 manifest.json，要人操作的进这里**。

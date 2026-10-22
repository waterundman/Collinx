# Collinx

Agent原生编曲软件，将创作目标、音乐对象、视图对象、渲染对象、审美记忆对象全部放入统一工程图中。

## 语言

**Project Graph**:
有类型的属性图，连接所有音乐对象，支持版本控制和分支管理。
_避免_: 工程图、项目图、Graph

**DiffEnvelope**:
Agent操作的输出格式，包含操作摘要、领域解释、证据引用、风险标记。
_避免_: diff、差异、变更包

**Taste Genome**:
用户审美在可解释层、分布层、嵌入层上的长期记忆模型。
_避免_: 口味库、品味库、审美模型

**Composition Layer**:
保存"写了什么" - 音符、和弦、节奏、曲式结构。
_避免_: 作曲层、创作层

**Notation Layer**:
保存"怎么看" - 谱面、布局、分谱。
_避免_: 记谱层、谱面层

**Performance Layer**:
保存"怎么演" - 演奏控制、速度曲线、力度变化。
_避免_: 演奏层、表现层

**Audio Layer**:
保存"怎么听" - 混音、效果、导出。
_避免_: 音频层、声音层

**Agent**:
直接操作Project Graph的智能体，不是代替用户点按钮。
_避免_: 助手、AI、机器人

**Planner**:
拆解目标、选择工具、组织子任务、控制上下文窗口的Agent。
_避免_: 规划器、计划器

**Composer**:
生成旋律、和声、动机变形、句法连续性的Agent。
_避免_: 作曲器、作曲家

**Arranger**:
将pattern扩展为section、设计hook前后密度、段落对比的Agent。
_避免_: 编曲器、编曲家

**Orchestrator**:
处理配器、声部展开、可演奏性、register冲突的Agent。
_避免_: 配器器、配器师

**Mixing Agent**:
处理增益结构、路由、空间、动态、导出版本比较的Agent。
_避免_: 混音器、混音师

**Engraving Agent**:
处理版面、分谱、冲突清理、可读性的Agent。
_避免_: 排版器、排版师

**Teaching Agent**:
解释理由、给出对比案例、根据用户水平降维说明的Agent。
_避免_: 教学器、教师

**TasteMemory Agent**:
导出后分析、证据管理、口味参数更新与回滚的Agent。
_避免_: 记忆器、口味管理器

**FX Chain**:
效果器链，按顺序处理音频信号的一系列效果器。
_避免_: 效果链、FX链

**Bus**:
音频总线，用于路由和混合多个音频信号。
_避免_: 总线、母线

**Send**:
发送，将音频信号发送到另一个总线或效果器。
_避免_: 发送端、送出

**Mixer Track**:
混音轨道，包含增益、声像、静音、独奏、效果链等控制。
_避免_: 混音轨、轨道

**Channel Strip**:
通道条，单个混音轨道的完整控制界面。
_避免_: 通道、声道

**Piano Roll**:
钢琴卷帘，用于编辑MIDI音符的界面。
_避免_: 钢琴窗、音符编辑器

**Arrangement**:
编排，将各个section组织成完整歌曲的过程。
_避免_: 排列、编曲

**Score**:
乐谱，用音乐符号表示音乐的文档。
_避免_: 谱面、谱子

**Part**:
分谱，为单个乐器或声部提取的乐谱。
_避免_: 声部、分谱

**Motif**:
动机，短小的音乐片段，用于发展和变化。
_避免_: 动机、主题

**Phrase**:
乐句，由多个动机组成的较长音乐片段。
_避免_: 乐句、短语

**Section**:
段落，歌曲中的一个部分，如intro、verse、chorus等。
_避免_: 段落、部分

**Tempo Map**:
速度图，定义歌曲中各个位置的速度。
_避免_: 速度表、BPM图

**Time Signature**:
拍号，定义每小节的拍数和拍子类型。
_避免_: 拍号、节拍

**Key Signature**:
调号，定义歌曲的调性。
_避免_: 调号、调性

**Automation**:
自动化，随时间变化的参数控制。
_避免_: 自动化、曲线

**Export**:
导出，将工程文件转换为其他格式。
_避免_: 导出、输出

**Import**:
导入，将其他格式的文件加载到工程中。
_避免_: 导入、输入

**Undo**:
撤销，取消上一步操作。
_避免_: 撤销、回退

**Redo**:
重做，重新执行被撤销的操作。
_避免_: 重做、恢复

**Branch**:
分支，工程的一个独立版本线。
_避免_: 分支、分叉

**Revision**:
修订，工程的一个版本快照。
_避免_: 版本、修订

**Merge**:
合并，将多个分支或修订合并在一起。
_避免_: 合并、融合

**Conflict**:
冲突，多个修改相互矛盾的情况。
_避免_: 冲突、矛盾

**Resolution**:
解决，处理冲突的过程。
_避免_: 解决、处理

**Validation**:
验证，检查数据或操作是否符合规则。
_避免_: 验证、校验

**Serialization**:
序列化，将数据结构转换为可存储或传输的格式。
_避免_: 序列化、打包

**Deserialization**:
反序列化，将存储或传输的格式转换为数据结构。
_避免_: 反序列化、解包

## 关系

- **Project Graph** 包含多个 **Composition Unit**
- **Composition Unit** 包含多个 **Note Event**
- **Note Event** 属于某个 **Track**
- **Track** 包含多个 **FX Slot**
- **FX Slot** 属于某个 **FX Chain**
- **FX Chain** 属于某个 **Mixer Track**
- **Mixer Track** 路由到 **Bus**
- **Bus** 发送到 **Send**
- **Send** 连接到另一个 **Bus** 或 **FX Chain**
- **Agent** 操作 **Project Graph** 生成 **DiffEnvelope**
- **DiffEnvelope** 包含多个 **Operation**
- **Operation** 修改 **Project Graph** 的节点或边
- **Taste Genome** 包含多个 **Taste Parameter**
- **Taste Parameter** 由 **Evidence** 更新
- **Evidence** 来自 **Export Version**
- **Export Version** 是 **Project Graph** 的一个快照

## 示例对话

> **开发者**: 当用户修改Mixer Track的增益时，我们需要更新Project Graph吗？
> **领域专家**: 是的，而且如果用户确认了这个修改，我们要将变更写入Taste Genome的证据库。

> **开发者**: Agent生成的DiffEnvelope需要用户确认才能应用吗？
> **领域专家**: 是的，默认所有Agent都只拥有proposal_only权限，真正能修改工程主分支的需要UI层确认。

> **开发者**: Taste Genome的更新需要什么条件？
> **领域专家**: 只有显式确认的导出后证据才进入主Genome，未确认信号只能进入tentative buffer。
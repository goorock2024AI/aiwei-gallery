# 艾维美术馆

Project ID：`goorock2024AI--aiwei-gallery`。原 Repo：https://github.com/goorock2024AI/aiwei-gallery 。创建时间未知。

本项目是艾维美术馆的全馆资料与 Agent 工作入口，连接运营管理系统、项目策划与注册表、展览活动、内容传播、空间及商业合作。美术馆定位为“美术馆 + 艺术空间 + 轻画廊”；工作目标是建立可持续营收体系，以真实经营数据和统一业务口径支持管理判断。

范围包括全馆资料索引、既有 Agent 规则、运营系统及需求和交付资料，以及展览、内容、空间、合作与行政资料。业务验收、预算、对外承诺和正式上线仍由馆长或授权人确认。运营管理 2.0 以统一业务口径和基础汇总为目标，复杂经营分析驾驶舱属于后续 3.0 范围。

定义依据：[INDEX.md](INDEX.md)、[CLAUDE.md](CLAUDE.md)、[AIWEI.md](AIWEI.md)、[总协调工作盘](00_工作台/AI运营团队/总协调工作盘.md)、[运营系统 PRD](00_工作台/运营数据管理/艾维美术馆运营数据管理系统-PRD.md) 与 [DEVELOPMENT.md](DEVELOPMENT.md)。INDEX 中旧 Repo owner 以实际 origin 为准；未改变旧文档。PRD 是运营子系统资料，不能替代全馆项目定义。

当前工作是原地补齐 Agent OS 接入标准。业务代码、资料、其他 Agent 规则及既有未提交工作保持原状。运营系统 2.0 当前开发入口为 `codex/operations-v2`，实际工作区以 `git worktree list` 为准；本目录的 2.0 文档是早期规划副本。该分支开发文档截至 2026-10-03 记录 rc.9 已发布待观察，正式切换仍待业务验收与馆长确认；此处不把历史记录推断为今日线上核验结果。

机器入口是根目录 `agentos.yaml`，Current State 仅维护 status、current_focus、next_action、blockers 四项当前值。Usage 固定在 `.agentos/usage.yaml`。

本地 main 与 origin/main 已分叉；接入文件最初推送到 `codex/agentos-onboarding`。默认分支接入以远端 main 为基线，只加入上述三个文件，不合并本地无关历史差异，保留原目录和未提交工作。Agent OS 从 GitHub 默认分支读取入口；正式接入以 First Sync 与 Contract Validation 成功为准。

Project Agent 执行项目工作、维护 Repo 和 Current State；Agent OS 负责跨项目积累、Memory 与 Relationship。既有项目工作规则继续生效，本入口限定 Agent OS 长期回流，不替代内部执行流程。

正式 Output 必须有用户确认事实及明确版本依据。普通文件、草稿、上线记录与 Agent 回答不自动转为成果。正文留在唯一 Canonical Source：文档默认飞书，代码/配置 GitHub，大型媒体可用 COS；ima 仅负责发现。本次不搬迁现有资料，也不复制正文建立第二个权威来源。

回流是 Delta。只有重要 A → B 与真实 Evaluation 才进入 Change；评价缺失保持 null，没有相关事实变化时为 `write_back: none`。本次目录补齐不作为业务成果或重要认知变化登记。长期回流记录不包含 Task/Sprint/Gantt、独立 Decision、完整聊天、Reasoning、Tool Calls 或执行流水；Skill 仅记录稳定外部引用。

有明确新工作 Intent 时，已接入 Runtime 按需 Pull Context。实际采用并影响工作后才记录 Usage。Shared Usage 条目仅有 id、handoff_id、target_type（memory/output）、target_id、impact；交接来源使用原 handoff_id，其他明确来源写 null，impact 说明实际情境和影响，同情境不因新 ID 或新交接重复记录。Skill Usage 仅有 provider、external_skill_id，按组合去重，不附时间、调用次数或过程。

已读取同级 AgentOS 项目的 `docs/PROTOCOL-DRAFT.md`（Runtime 技术协议草案）。该草案规定正式成果在 `.agentos/outputs.yaml` 使用 `agentos.outputs.draft.v0.1` 声明，Contract outputs 仅列对应稳定 ID；重要变化在 `.agentos/changes.yaml` 使用 `agentos.changes.draft.v0.1`，评价为 null 或真实 signal/evidence。两部分仍是技术草案，后续有确认事实时需按届时协议校验。本次没有充分的正式成果确认依据或应回流的重要变化，outputs 保持空列表，不创建空声明文件；已有成果与依据留在原处。

2026-10-09 已核验生产 Agent OS 自动发现默认分支的本项目，First Sync 与 Contract Validation 成功，Usage 校验通过；项目身份与原 Repo 匹配，contract/usage 无同步错误。输出与变化声明未提供，符合当前无正式回流事实的状态。此结果不代表 Context、Memory 或外部来源授权闭环已经完成。

待补事项：取得 Agent OS 提供的 First Cross-Project Delta；未来逐项确认正式 Output 的版本、用户确认依据与 Canonical Source，再按当前技术协议声明。没有取得 Delta 不等于已提供空 Context；不自行猜测跨项目经验或关联。本次不发起 Bootstrap，也不登记 Repo 地址。

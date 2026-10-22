# 周经营复盘工作台：运行及发布回退说明

候选：WEEKLY-MGMT-20261022，经营闭环扩展1.0，保留周报标准版1.0及基准规则1.0.0。仅本地实现，未生产部署或实际群发。

## 已确认的安排

馆长于2026-10-22确认：周一12:00资料截止、13:00准备、14:00 Agent分析、15:00管理员复核、16:00发布；行动默认负责人管理员，后台逐项反馈；周报与日报同一企业微信内部群；总评价、目标/预测口径或行动实质变化由复核人确认后简短更正。没有增加无人审核发布授权。

## 每周操作

1. 在经营分析报告进入“周经营复盘工作台”，选择上一完整周的周一。先填写上期最多三项行动的执行情况、证据、观察结果及建议。反馈追加记录；执行≠有效，缺反馈明确待确认。管理员未明确分派给具体人员时，负责人保留管理员；确实尚未确认的行动显式写待指定。
2. 准备并下载资料。包内财务指标来自一次REPEATABLE READ正式快照，七天日报读取截止前最新修订，保留编号/版本/SHA、原天气库存、日结状态与截止。没有的日期不补零，暂报/待修订列待办。缺完整日报不能复核成正式报告。日报收入不累加作为周收入。
3. 将准备包交给Agent，按示例schema生成 `{analysis,report}`。先判断，再证据与经营含义，重点两三项；kind区分fact/explanation/hypothesis。不能将同步变化当原因，不能编造缺货/天气/营销数据。
4. 导入分析稿，管理员对财务、日报状态、行动及预测复核后点“确认已人工复核”。补录、日报修订、行动新反馈、月目标或财务变化使来源检查失败时，重新准备资料；旧快照保留。分析稿再修改会撤销复核状态。
5. 点“正式发布”。服务端只接受已复核且内容完全一致的分析稿，事务内保存报告、行动、预测方法/基准、静态HTML校验、发布审计和唯一摘要待办。重复提交同一run返回原报告，不新增摘要；已发布run不能编辑。修订另开准备记录，report.supersedes指向最新版本。
6. 开关启用后由worker处理摘要，或管理员处理待发/明确失败的受控重试。初始和更正都是纯文字，不发图。后者必须在分析稿声明importantCorrection=true并提供具体原因，经过同一次人工复核。小文字修订只归档。投递不确定时先查群内及后台attempts，不点重发、不伪造accepted；当前版本刻意不提供“一键解除不确定”接口。

## 分析稿结构

`report`沿用标准版：title、summary、ruleVersion、sections[四章+附录]、weekly[标准版1.0表格、附录及来源]，修订另加supersedes。程序覆盖五项核心行和月进度，依据结构化值计算，避免正文展示字符串充当计算源。

`analysis`包括：

- judgments：两至三项，judgment/evidence/implication/kind。
- reviewText：对上期行动和经营情况的复核说明；actionReviewAdvice按index、recommendation(pending/continue/adjust/stop)、reason保存建议，不修改反馈事实。
- actions：最多三项action/measure/owner/due/nextReview；due限定下周，未确认owner显式填待指定。
- forecast：下周start/end/value、统一全馆basis=all-income-business-date-v1、methodVersion、sampleCutoff、drivers[name/direction/evidence/sourceDate]。样本不晚于本周期末，证据不晚于资料实际截止；无证据的方向用unknown，不编造倍率。自动保存“上周同日七天合计”基准，不依据实际收入改旧预测。
- currentTarget、nextTarget、targetAuthority=director、monthAllocations[month/weeklyAmount/allocationReason]。月目标从馆长配置daily_brief_month_targets取；分月数额须覆盖下周月份且合计精确，本周指标承接原已发值，不因预测下调自动改目标。
- importantCorrection及correctionReason：只用于管理员确认的重要变更。

误差按实际−预测及相对预测偏差率展示，零预测不算比例。按方法和口径分别聚合平均绝对误差，与简单基准比较。每周初始已发预测入样一次，修订预测并列留存；样本早于预测周、发布不晚于周一16:00才进入有效误差样本。历史重建/超时发布保留记录但不混算。少于4期明确样本不足；即使达到4期也只描述历史误差，不宣称方法已证实有效。跨月周保持七天，月收入另从业务日期取，不累加周总额。

## 定时节点与待办

两个开关默认false：WEEKLY_PREPARE_ENABLED、WEEKLY_SEND_ENABLED。WEEKLY_USE_DAILY_CHANNEL=true复用服务器受保护的现有日报群Webhook；不将密钥写入示例、日志或前端。可单独指定WEEKLY_WECOM_WEBHOOK但更换渠道须另行确认；已经尝试投递的事件绑定渠道摘要，不能换群重发。

12:00 worker封存财务与日报，13:00自动准备阶段读取该封存包，不在13:00倒填12:00。错过截止不伪装成功，返回cutoff_missed，需人工决定重新准备的实际截止时间。14:00/15:00/16:00保留Agent、复核、发布待办；worker不调用模型也不发布。持续每5分钟只处理已经正式发布的outbox和有限退避；不发送缺资料草稿。候选timer Persistent=false避免补跑旧时间点；文件未安装生产。

Agent分析目前由馆长/管理员在Codex发起，系统只准备材料、显示待办，不代表已接通自动Agent执行器。数据库/任务故障通过服务失败日志和工作台暴露，独立外部提醒渠道尚未配置；不承诺故障时会主动群通知。

## 本地验证与启动

本地独立PostgreSQL克隆配置在忽略目录tmp/m3-05-test.json；必须127.0.0.1:55435，测试仅创建/删除自身测试库。`node scripts/check-weekly-management.js`覆盖HTTP权限/连续周/修订/投递及Edge手机打印，所有群发送使用假fetch。浏览器依赖按工作区运行时提供，未用用户浏览器登录会话。不要把测试用Webhook改为真实渠道。

## 生产发布（本轮未执行）

1. 先获得代码部署、迁移及启用各自授权；按共享发布服务当前active SHA复核基线，不执行旧/opt/aiwei整包静态覆盖。
2. 备份数据库、report-archive私有卷、active SHA、配置和现有timer，校验恢复目录与SHA。仅暂存本任务文件，核对既有未提交变更，禁止整包带入。
3. 追加幂等SQL 20261022_weekly_management.sql（五表），不修改经营事实、不改历史日报及预测。deploy-report-migrate已接此迁移，Docker复制所有模块；init.sql、app/dist及根dist同步。
4. 发布候选，开关保持false；核healthy、静态SHA、登录/角色权限、旧报告文件读取与跨月筛选、工作台待办。不得将开关false的测试当真实投递成功。未来经授权确认渠道后，安装候选service/timer及分别打开准备/发送；不在未授权时发送测试消息。

## 保留式回退

触发：来源错接、漏复核发布、重复群发、投递不确定被重试、读写权限异常、静态文件校验错误或持续任务失败。负责人：获授权系统维护人，运营复核负责人管理员。

先关闭周报准备与发送、停周报timer（现有日报三个timer保持原授权状态，不一并停）；等待正在进行的投递结束，若中断将sending视为uncertain。恢复上一healthy应用SHA，保留五张周报表、来源/静态归档卷、全部事件与尝试，禁止整库覆盖、删除报告或预测。回退后旧程序没有周报摘要发送器，不安装临时补发脚本。再次上线先核对accepted/uncertain，不能清空账本重跑。数据库/文件备份只有在专项恢复授权后使用，不作为日常应用回退。

剩余配置：生产部署和迁移授权、准备/发送开关启用、群渠道指纹核对、Agent执行器/人工发起职责和独立故障提醒。出报时间、管理员负责/后台反馈、同日报群及重要更正标准已确认，不再重复询问。


发布候选rc.22：API与worker统一读取/run/aiwei-config/weekly-management.json（WEEKLY_CONFIG_FILE可显式指定）；开关默认false，同群复用时只在发送启用后读取受保护的daily-brief.json中的Webhook。配置不从接口输出。此次部署保持开关关闭、timer不安装。Nginx新增工作台HTML挂载。

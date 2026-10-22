# DAILY-LOOP-20261022 本地交付证据

状态：**本地验证通过，未生产发布**。任务授权到现状只读核查、本地实现/验证及发布回退准备；本轮没有生产迁移、启用新提醒、实际群发或发布分支推送。保留所有此前未提交工作。

## 当前生产事实

2026-10-22只读SSH核查：共享发布active=6ed04fa1b8ae928926b6bf67fcce6891531fea24，healthy；日报/发送开关true、模型false；原timer active，17:58/17:59准备、18:00—18:20纯文字投递。已有日报与text/image历史账本；image是历史记录，不代表现行还发图片。原库存显式closeHour=18。负责人和独立提醒配置尚未确认，不能宣称已主动通知。

旧日报说明中“未上线”和rc.19仅为历史状态；references/runtime-facts.md及daily-brief-setup.md已更新当前基线，并区分本轮尚未部署的增强。

## 改动及验收对应

- daily-brief-policy.js：未批准的阈值建议、零/小额基数、分类调账、日结重新打开、重要备料变化、差异消息、窗口边界。
- daily-brief-lifecycle.js：日期级advisory锁、旧text账本bootstrap、首次outbox、独立更正序号、最后接口接受基线、合并/频率限制、有限重试及不确定阻断、每日deadline与故障记录、逐次尝试。
- daily-brief-dispatch.js：保留旧调用入口但转同一日期级outbox，不再存在并行的brief_id发送实现。群发仍只text。
- daily-brief-runner.js、scripts/daily-brief-worker.js：tick/check/review及只归档reconcile；生成结束重新读时钟；后台check不依赖生成任务同一systemd单元。
- sql/20261022_daily_delivery_loop.sql：四张追加幂等表outbox/attempts/followup/incidents。daily-brief-migrate.js及Dockerfile接入新模块和迁移。新表不开放通用REST写。
- daily-brief-core.js、daily-brief-template.js：真实数据截止时间、日结状态；历史修订注明真实修订统计日期，不把今日时刻拼成历史日的假截止时间。仍使用原快照/修订/私有HTML和PNG机制。
- daily-brief-api.js及app/daily-brief.html、app/js/daily-brief-page.js：管理员/编辑可按日期查询状态/异常/attempts；viewer403；明确接口接受≠成员收到、提醒未配置。无报告也能查询后台状态。app/dist/根dist对应文件同步。
- coffee-forecast.js：共享默认closeHour=17.5；不覆盖显式18。inventory-inbox.js支持0.5小时步长；沿用原settings API的版本检查及审计。未生产改参数，未另造日报库存公式。
- references/aiwei-daily-{review,check}.{service,timer}：候选复核及独立检查单元，未安装生产。运行说明列明窗口、缺项、保留式回退及旧账本兼容边界。

## 验证结果

| 验证 | 结果 |
|---|---|
| scripts/check-daily-delivery-loop.js | 41项通过，真实localhost PostgreSQL隔离克隆，0外部消息 |
| scripts/check-daily-briefs.js | 18项HTTP通过；viewer/admin/editor、匿名、非法日期；修订及周资料；真实Edge手机日报及管理员状态界面，pageErrors=0 |
| scripts/check-coffee-inventory-integration.js | 56项HTTP及真实Edge桌面/390/320px；原settings保存17.5及step=0.5通过；收入指纹不变 |
| scripts/check-coffee-forecast.js | 15项原库存/预测计算场景通过 |
| scripts/check-dist-sync.js | app/dist关键文件一致 |
| 工作区/语法 | codex/operations-v2 guard通过；新增模块、worker、API及界面JS node --check通过 |
| timer表达式 | 服务器仅执行只读systemd-analyze calendar，3种新增日历表达式均exit=0；未复制/安装任何新systemd单元 |

41项包含：17:58无外发、首次纯文字、暂报截止/未日结、18:01新版本不再整篇重发、未批准阈值阻断、连续补录合并为净变化、日结完成仅归档、小额仅归档、分类对调总额不变仍提议更正、每日次数上限、限流5分钟退避/3次耗尽、确定失败/未知投递均不盲重发、更正独立失败及未知状态、缺报告和生成异常、旧accepted导入、并发锁、历史只归档、次日截止、跨零库存和不倒填、日结重开、旧快照保留、每次网络尝试留痕、慢生成越过截止不发送、接口响应结束时刻迟到识别。

测试输出在忽略目录tmp/daily-delivery-loop/result.json、tmp/daily-brief-20261021/result.json和daily-followup-admin-mobile.png、tmp/coffee-inventory/result.json。本机原55435测试数据库离线，经确认本地专用目录后启动PostgreSQL17；各套件仅克隆并删除自己的测试库，未连接生产数据库写入。测试使用提供的假fetch及固定天气，模型关闭。Browser插件未提供，按前端测试技能回落本地Playwright/Edge。

开发中发现并修正：测试把数据库count文本与数值严格比较导致假失败、库存接口config实际位于result.config、前端换行转义错误、历史截止日期展示错误。最终验证已通过，不把早先失败描述成生产缺陷。

## 待配置及上线边界

1. 指定负责人及独立提醒渠道；当前仅写异常表、后台状态和服务失败日志，尚未主动外发提醒。数据库/主机故障时仍需独立外部监控。
2. 更正规则建议absolute=50元、ratio=5%、smallBase=200元；库存500克/25%，静默10分钟/最多合并30分钟、每报告日期最多2条。approved默认false，未经馆长确认不改true。
3. 生产库存18→17.5需经授权通过原设置接口留痕，不由本轮擅自改写。
4. 新增表、服务及timer均待本轮发布授权。原生产每日18点安排保持原样，不能把本地检查和更正当作已经在线运行。

完整发布/回退方案见references/20261022-daily-delivery-loop.md。关键回退顺序：停全部日报/复核/检查timer及发送开关→恢复上一healthy应用及原单元→保留新旧账本、快照和审计；旧发送器不能立刻在当天重启，否则可能漏读新outbox并重复整篇。核对当天记录后，原则上下一营业日再恢复。无整库恢复、无删除历史表或文件。

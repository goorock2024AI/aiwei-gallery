'use strict';
require('../daily-brief-runner').run().catch(()=>{console.error('日报任务失败；请查看发送与更正后台及系统服务日志。未输出凭据。');process.exitCode=1;});

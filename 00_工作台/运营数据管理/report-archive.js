// Immutable report files are private to the API container, never the public uploads mount.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const renderer = require('./operations-report-html');
const root = () => process.env.REPORT_ARCHIVE_DIR || '/tmp/aiwei-report-archive';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function filename(artifact) {
  if (!artifact || !/^[a-f0-9-]{36}\.html$/.test(artifact.file) || !/^[a-f0-9]{64}$/.test(artifact.sha256)) throw Error('报告文件索引无效');
  return path.join(root(), artifact.file);
}
function write(report) {
  if (!/^[a-f0-9-]{36}$/.test(report.id)) throw Error('报告编号无效');
  const content = renderer.render(report);
  const artifact = { file: report.id + '.html', sha256: hash(content), bytes: Buffer.byteLength(content), format: 'static-html-v1' };
  fs.mkdirSync(root(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filename(artifact), content, { flag: 'wx', mode: 0o600 });
  return artifact;
}
function read(artifact) {
  const content = fs.readFileSync(filename(artifact));
  if (hash(content) !== artifact.sha256) throw Error('报告文件校验失败');
  return content;
}
function discard(artifact) { fs.unlinkSync(filename(artifact)); }
async function context(db, start, end) {
  const rows = (await db.query(`SELECT r.id,r.title,r.summary,r.content,r.packet_id,p.start_date,p.end_date,p.sha256
    FROM operations_analysis_reports r JOIN operations_analysis_packets p ON p.id=r.packet_id
    WHERE r.content->>'reportType'='weekly' AND p.start_date<=$2 AND p.end_date>=$1
    AND NOT EXISTS(SELECT 1 FROM operations_analysis_reports n WHERE n.content->>'supersedes'=r.id)
    ORDER BY p.start_date,r.id`, [start, end])).rows;
  return {
    basis: '月度指标按自然月从经营事实重新计算；周报仅提供历史判断、假设、行动和待核实事项，跨月周不得整周累加。',
    reports: rows.map(r => ({ id:r.id, title:r.title, summary:r.summary, start:r.start_date, end:r.end_date,
      crossesBoundary:r.start_date<start||r.end_date>end, packetId:r.packet_id, sourceSha256:r.sha256,
      sections:r.content.sections, actions:r.content.actions, weekly:r.content.weekly,
      reportVersion:r.content.reportVersion||1, artifact:r.content.artifact||null }))
  };
}
module.exports = { write, read, discard, context, hash };

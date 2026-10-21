-- 保留式回退：恢复旧应用镜像和静态文件，保留两个表及全部记录。
-- 不DROP表，不清库存流水；如需物理删除，必须另行导出备份并获得授权。
BEGIN;
SELECT COUNT(*) AS retained_events FROM coffee_inventory_events;
COMMIT;

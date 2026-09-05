SELECT COUNT(1) AS hotfix_expense_rows
FROM expense
WHERE id LIKE 'codex_hotfix_expense_%';

SELECT reimbursement_status, COUNT(1)
FROM expense
GROUP BY reimbursement_status
ORDER BY reimbursement_status;

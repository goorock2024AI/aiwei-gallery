'use strict';
const {spawnSync}=require('node:child_process');
for(const file of ['/app/coffee-migrate.js','/app/scripts/daily-brief-migrate.js','/app/scripts/weekly-management-migrate.js','/app/scripts/space-execution-migrate.js','/app/scripts/space-project-workflow-migrate.js']){const r=spawnSync(process.execPath,[file],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}

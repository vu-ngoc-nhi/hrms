-- LOCAL DEVELOPMENT/TEST ONLY. Runs once when the Docker volume is first initialized.
-- The password is a PUBLIC, disposable development-only value: not a secret, never reuse it for staging/production.
-- The application role owns no schema and has no DDL rights.
CREATE ROLE hrms_app LOGIN PASSWORD 'hrms_local_dev_only';
CREATE DATABASE hrms_test OWNER hrms_owner;
REVOKE ALL ON DATABASE hrms_dev FROM PUBLIC;
REVOKE ALL ON DATABASE hrms_test FROM PUBLIC;
GRANT CONNECT ON DATABASE hrms_dev TO hrms_app;
GRANT CONNECT ON DATABASE hrms_test TO hrms_app;
